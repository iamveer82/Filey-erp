// Local-only data backend. Implements the subset of the supabase-js client the
// app actually uses, backed by on-device storage, so every existing `sb().from(...)`
// call site works unchanged and no data ever leaves the machine.
//
// ponytail: one JSON array per collection, loaded/saved whole, stored in the
// existing SQLite kv_cache table (Tauri) or localStorage (browser dev). Single-user
// desktop → collections are small and writes are serial, so whole-array
// read-modify-write is fine. Move to row-level SQL only if a table grows big
// enough to lag.

import { invoke } from "@tauri-apps/api/core";

const hasTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type Row = Record<string, any>;
type Result = { data: any; error: any };

// ---- storage backend: collection name -> Row[] ----------------------------

async function loadColl(coll: string): Promise<Row[]> {
  const key = "localdb:" + coll;
  try {
    if (hasTauri) {
      const v = await invoke<string | null>("cache_get", { key });
      return v ? (JSON.parse(v) as Row[]) : [];
    }
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as Row[]) : [];
  } catch {
    return [];
  }
}

async function saveColl(coll: string, rows: Row[]): Promise<void> {
  const key = "localdb:" + coll;
  const json = JSON.stringify(rows);
  if (hasTauri) await invoke("cache_set", { key, value: json });
  else localStorage.setItem(key, json);
}

const nextId = (rows: Row[]): number =>
  rows.reduce((m, r) => (typeof r.id === "number" && r.id > m ? r.id : m), 0) + 1;

// ---- query builder --------------------------------------------------------

type Op = "select" | "insert" | "update" | "upsert" | "delete";
type Filter =
  | { kind: "eq"; col: string; val: any }
  | { kind: "lte"; col: string; val: any }
  | { kind: "contains"; col: string; val: any };

class LocalBuilder implements PromiseLike<Result> {
  private op: Op = "select";
  private filters: Filter[] = [];
  private matchObj: Row | null = null;
  private payload: Row[] = [];
  private orders: { col: string; asc: boolean }[] = [];
  private limitN?: number;
  private want: "no" | "single" | "maybe" = "no";
  private returnRows = false; // a write followed by .select()
  private conflictKey?: string;

  constructor(private coll: string) {}

  select(_cols?: string): this {
    if (this.op !== "select") this.returnRows = true;
    return this;
  }
  insert(rows: Row | Row[]): this {
    this.op = "insert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  update(patch: Row): this {
    this.op = "update";
    this.payload = [patch];
    return this;
  }
  upsert(rows: Row | Row[], opts?: { onConflict?: string }): this {
    this.op = "upsert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.conflictKey = opts?.onConflict;
    return this;
  }
  delete(): this {
    this.op = "delete";
    return this;
  }

  eq(col: string, val: any): this {
    this.filters.push({ kind: "eq", col, val });
    return this;
  }
  lte(col: string, val: any): this {
    this.filters.push({ kind: "lte", col, val });
    return this;
  }
  contains(col: string, val: any): this {
    this.filters.push({ kind: "contains", col, val });
    return this;
  }
  match(obj: Row): this {
    this.matchObj = obj;
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orders.push({ col, asc: opts?.ascending !== false });
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  single(): this {
    this.want = "single";
    return this;
  }
  maybeSingle(): this {
    this.want = "maybe";
    return this;
  }

  private matches(r: Row): boolean {
    for (const f of this.filters) {
      if (f.kind === "eq" && r[f.col] !== f.val) return false;
      if (f.kind === "lte" && !(r[f.col] <= f.val)) return false;
      if (f.kind === "contains") {
        const cell = r[f.col];
        if (Array.isArray(f.val)) {
          if (!Array.isArray(cell) || !f.val.every((v) => cell.includes(v)))
            return false;
        } else if (f.val && typeof f.val === "object") {
          if (!cell || typeof cell !== "object") return false;
          for (const k of Object.keys(f.val))
            if (cell[k] !== f.val[k]) return false;
        }
      }
    }
    if (this.matchObj)
      for (const k of Object.keys(this.matchObj))
        if (r[k] !== this.matchObj[k]) return false;
    return true;
  }

  private async exec(): Promise<Result> {
    try {
      let rows = await loadColl(this.coll);
      let result: any = null;

      if (this.op === "select") {
        let out = rows.filter((r) => this.matches(r));
        if (this.orders.length) {
          // Stable multi-key sort (primary key first), matching PostgREST.
          out = [...out].sort((a, b) => {
            for (const o of this.orders) {
              const av = a[o.col];
              const bv = b[o.col];
              if (av == null && bv == null) continue;
              if (av == null) return 1; // nulls last
              if (bv == null) return -1;
              if (av < bv) return o.asc ? -1 : 1;
              if (av > bv) return o.asc ? 1 : -1;
            }
            return 0;
          });
        }
        if (this.limitN != null) out = out.slice(0, this.limitN);
        result = out;
      } else if (this.op === "insert" || this.op === "upsert") {
        const written: Row[] = [];
        for (const p of this.payload) {
          let row: Row = { ...p };
          if (this.op === "upsert") {
            const key = this.conflictKey || "id";
            const idx = rows.findIndex(
              (r) => row[key] != null && r[key] === row[key]
            );
            if (idx >= 0) {
              row = { ...rows[idx], ...row };
              rows[idx] = row;
              written.push(row);
              continue;
            }
          }
          if (row.id == null) row.id = nextId(rows);
          if (row.created_at == null) row.created_at = new Date().toISOString();
          rows.push(row);
          written.push(row);
        }
        await saveColl(this.coll, rows);
        result = this.returnRows ? written : null;
      } else if (this.op === "update") {
        const patch = this.payload[0] || {};
        const written: Row[] = [];
        rows = rows.map((r) => {
          if (this.matches(r)) {
            const u = { ...r, ...patch };
            written.push(u);
            return u;
          }
          return r;
        });
        await saveColl(this.coll, rows);
        result = this.returnRows ? written : null;
      } else if (this.op === "delete") {
        rows = rows.filter((r) => !this.matches(r));
        await saveColl(this.coll, rows);
        result = null;
      }

      if (this.want !== "no") {
        const arr = Array.isArray(result) ? result : result == null ? [] : [result];
        if (this.want === "single" && arr.length === 0)
          return { data: null, error: { message: "No rows found", code: "PGRST116" } };
        result = arr.length ? arr[0] : null;
      }
      return { data: result, error: null };
    } catch (e: any) {
      return { data: null, error: { message: String(e?.message || e) } };
    }
  }

  then<R1 = Result, R2 = never>(
    onF?: ((v: Result) => R1 | PromiseLike<R1>) | null,
    onR?: ((e: any) => R2 | PromiseLike<R2>) | null
  ): PromiseLike<R1 | R2> {
    return this.exec().then(onF as any, onR as any);
  }
}

// ---- rpc ------------------------------------------------------------------
// adjust_product_stock / adjust_account_balance both have JS read-modify-write
// fallbacks in api.ts that run when the rpc errors — so returning an error here
// makes them work locally with no extra code. The other two are cloud/sharing
// features with no local meaning.
async function localRpc(name: string): Promise<Result> {
  return {
    data: null,
    error: { message: `rpc "${name}" is not available in local mode` },
  };
}

// ---- auth: single on-device user, no real authentication ------------------
const LOCAL_USER = {
  id: "local-user",
  email: "local@device",
  user_metadata: { full_name: "Local User" },
  app_metadata: {},
};
const LOCAL_SESSION = { user: LOCAL_USER, access_token: "local" };
const ok = (data: any): Result => ({ data, error: null });

const localAuth = {
  async getSession() {
    return ok({ session: LOCAL_SESSION });
  },
  async getUser() {
    return ok({ user: LOCAL_USER });
  },
  onAuthStateChange(cb: (event: string, session: any) => void) {
    cb("SIGNED_IN", LOCAL_SESSION);
    return { data: { subscription: { unsubscribe() {} } } };
  },
  async signInWithPassword() {
    return ok({ user: LOCAL_USER, session: LOCAL_SESSION });
  },
  async signUp() {
    return ok({ user: LOCAL_USER, session: LOCAL_SESSION });
  },
  async signInWithOtp() {
    return ok({});
  },
  async verifyOtp() {
    return ok({ user: LOCAL_USER, session: LOCAL_SESSION });
  },
  async resend() {
    return ok({});
  },
  async updateUser() {
    return ok({ user: LOCAL_USER });
  },
  async signOut() {
    return { error: null };
  },
};

// ---- storage: file bytes kept as base64 blobs in the local store ----------
// ponytail: base64 in the kv_cache table, one row per path, surfaced as data:
// URLs. Fine for a single-user desktop (invoices/PDFs are small). Move to real
// files-on-disk (Tauri fs) only if blobs grow big enough to bloat the DB.

interface Blob64 {
  mime: string;
  b64: string;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk)
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

async function blobGet(path: string): Promise<Blob64 | null> {
  const key = "fileblob:" + path;
  try {
    const raw = hasTauri
      ? await invoke<string | null>("cache_get", { key })
      : localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Blob64) : null;
  } catch {
    return null;
  }
}

async function blobSet(path: string, val: Blob64 | null): Promise<void> {
  const key = "fileblob:" + path;
  const json = val ? JSON.stringify(val) : ""; // "" = tombstone (no kv delete cmd)
  if (hasTauri) await invoke("cache_set", { key, value: json });
  else if (val) localStorage.setItem(key, json);
  else localStorage.removeItem(key);
}

function localStorageApi() {
  return {
    from: (_bucket: string) => ({
      async upload(path: string, blob: Blob, opts?: { contentType?: string }) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        await blobSet(path, {
          mime: opts?.contentType || (blob as any).type || "application/octet-stream",
          b64: bytesToB64(bytes),
        });
        return { data: { path }, error: null };
      },
      async remove(paths: string[]) {
        for (const p of paths) await blobSet(p, null);
        return { data: null, error: null };
      },
      async createSignedUrl(path: string) {
        const b = await blobGet(path);
        if (!b) return { data: null, error: { message: "File not found" } };
        return { data: { signedUrl: `data:${b.mime};base64,${b.b64}` }, error: null };
      },
      async download(path: string) {
        const b = await blobGet(path);
        if (!b) return { data: null, error: { message: "File not found" } };
        const bin = atob(b.b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return { data: new Blob([bytes], { type: b.mime }), error: null };
      },
      getPublicUrl(_path: string) {
        return { data: { publicUrl: "" } };
      },
    }),
  };
}

export const localClient = {
  from: (coll: string) => new LocalBuilder(coll),
  rpc: (name: string) => localRpc(name),
  auth: localAuth,
  storage: localStorageApi(),
  channel: () => {
    const ch = { on: () => ch, subscribe: () => ch };
    return ch;
  },
  removeChannel: () => {},
};
