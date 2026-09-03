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
import { PUSH_SET } from "./syncTables";

const hasTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type Row = Record<string, any>;
type Result = { data: any; error: any };

// ---- storage backend: collection name -> Row[] ----------------------------

/** Parsed collections, kept between reads.
 *
 *  Reading a collection used to mean an IPC hop, a SQLite read and a JSON.parse
 *  of the WHOLE array — every time. One screen does that a dozen times over the
 *  same table and an agent turn does it far more, all on the main thread, which
 *  is a large part of why the app stopped repainting under load. This process is
 *  the only writer, so between writes the parsed array IS the stored state and
 *  the round trip buys nothing.
 *
 *  The raw JSON rides along so replaceColl can compare against what's stored
 *  without re-serialising it.
 *
 *  Rows handed out are shared and read-only by contract. That takes nothing
 *  away: mutating a returned row never reached storage before either — only
 *  saveColl writes — so any code doing it was already a no-op bug.
 *
 *  DESKTOP ONLY. Under Tauri this process owns the SQLite store, so a parsed
 *  collection stays true until we write it. In a browser a second tab writes
 *  the same localStorage key behind our back and a stale memo would serve rows
 *  another tab deleted. Browser mode re-reads; localStorage is synchronous and
 *  it is not where the cost was. */
const memo = new Map<string, { rows: Row[]; json: string }>();

/** Forget everything cached. Exported for tests and for a restore, which
 *  replaces the database underneath us. */
export function clearLocalCache(): void {
  memo.clear();
  blobs.clear();
  hashOf.clear();
  journalMemo = null;
}

/* ---- big-field blob split ------------------------------------------------
 *
 *  Every invoice_docs row snapshots the company logo as a base64 data URL, on
 *  purpose: an issued tax document has to keep the logo it was issued with.
 *  But a collection is stored as ONE JSON array, so writing a single invoice
 *  re-serialised every logo of every invoice ever. Measured: 2000 docs with a
 *  150KB logo each is a 308MB string built on the main thread per save, then
 *  shipped over IPC to SQLite. With the logos hoisted out it is 0.6MB.
 *
 *  So oversized string fields are stored once, under their own key, and the row
 *  keeps a {__blob} marker. Keys are content hashes, so the same logo on 2000
 *  invoices is one stored blob and re-saving writes nothing new.
 *
 *  Rows with an inline string (everything written before this existed) still
 *  load unchanged — hydrate only touches markers. */
const BLOB_MIN = 8192;
const BLOB_KEY = (h: string) => `localdb:blob:${h}`;
type BlobRef = { __blob: string };

/** Blob payloads by hash. Content-addressed, so an entry is never stale. */
const blobs = new Map<string, string>();

/** The same lookup backwards, so a save doesn't re-hash a payload it has
 *  already seen. Without it, writing one row of a 2000-invoice collection
 *  hashed the logo 2000 times — trading the big serialisation for a big scan.
 *  hydrate hands every row the same string instance, and V8 caches a string's
 *  hash on the instance, so these lookups stay cheap. */
const hashOf = new Map<string, string>();

const isBlobRef = (v: any): v is BlobRef =>
  !!v && typeof v === "object" && typeof (v as BlobRef).__blob === "string";

/** Two mixed 32-bit passes plus the length. Not cryptographic — it only has to
 *  make a collision between two of a company's own logos implausible, and a
 *  content hash keeps every writer (another tab included) agreeing on the key
 *  without coordination. */
function hashString(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x1000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = (Math.imul(b + c, 0x85ebca6b) ^ (b >>> 13)) >>> 0;
  }
  return `${a.toString(36)}${b.toString(36)}${s.length.toString(36)}`;
}

async function putBlob(key: string, value: string): Promise<void> {
  if (hasTauri) await invoke("cache_set", { key, value });
  else localStorage.setItem(key, value);
}

/** Never throws, and tells the two failure cases apart.
 *
 *  `null`      — the store answered, and there is no such blob. Gone for good.
 *  `undefined` — the read itself failed. The blob may well still be there.
 *
 *  Both matter. loadColl's catch turns any throw into an EMPTY collection, so a
 *  failed logo read would blank every invoice on screen; and substituting ""
 *  for a blob that is merely unreadable right now would let the next save
 *  write that "" back and destroy the logo for real. */
async function getBlob(h: string): Promise<string | null | undefined> {
  const hit = blobs.get(h);
  if (hit != null) return hit;
  try {
    const key = BLOB_KEY(h);
    const v = hasTauri
      ? await invoke<string | null>("cache_get", { key })
      : localStorage.getItem(key);
    if (v != null) {
      blobs.set(h, v);
      hashOf.set(v, h); // so re-saving these rows doesn't re-hash the payload
    }
    return v;
  } catch {
    return undefined;
  }
}

/** Rows as they go to storage: oversized strings replaced by markers, with the
 *  payloads written out first. Returns the JSON actually stored. */
async function dehydrate(rows: Row[]): Promise<string> {
  const pending: Promise<void>[] = [];
  const added: string[] = [];
  const out = rows.map((r) => {
    let copy: Row | null = null;
    for (const k of Object.keys(r)) {
      const v = r[k];
      if (typeof v !== "string" || v.length < BLOB_MIN) continue;

      // A hit here means this exact value produced this hash before — Map keys
      // compare by value — so no verification is needed on the common path.
      const known = hashOf.get(v);
      const h = known ?? hashString(v);
      const held = blobs.get(h);

      if (held === undefined) {
        blobs.set(h, v);
        added.push(h);
        pending.push(putBlob(BLOB_KEY(h), v));
      } else if (known === undefined && held !== v) {
        // Two different payloads, one hash. Vanishingly unlikely, but pointing
        // an invoice at another image is not a thing to leave to chance, and
        // this branch only runs when we were hashing anyway. Leave it inline.
        continue;
      }
      if (known === undefined) hashOf.set(v, h);

      copy ??= { ...r };
      copy[k] = { __blob: h } as BlobRef;
    }
    return copy ?? r;
  });

  // Payloads land before the rows that point at them, so a crash in between
  // leaves an unreferenced blob rather than a row referencing nothing.
  try {
    if (pending.length) await Promise.all(pending);
  } catch (e) {
    // A blob that never reached storage must not stay cached claiming it did.
    // This process would keep serving it from memory, the next one would find
    // the marker pointing at nothing, and no save would ever retry the write
    // because the cache said the payload was already there.
    for (const h of added) blobs.delete(h);
    throw e;
  }
  return JSON.stringify(out);
}

/** The inverse: markers swapped back for their payloads.
 *
 *  A blob the store says is gone resolves to "" rather than leaking
 *  `[object Object]` into an <img src>. One that merely failed to read keeps
 *  its marker: dehydrate passes a non-string straight through, so the reference
 *  survives the round trip instead of being saved away as "". */
async function hydrate(rows: Row[]): Promise<Row[]> {
  let touched = false;
  const out: Row[] = [];
  for (const r of rows) {
    let copy: Row | null = null;
    for (const k of Object.keys(r)) {
      const v = r[k];
      if (!isBlobRef(v)) continue;
      const payload = await getBlob(v.__blob);
      if (payload === undefined) continue; // unreadable now — keep the marker
      copy ??= { ...r };
      copy[k] = payload ?? "";
      touched = true;
    }
    out.push(copy ?? r);
  }
  return touched ? out : rows;
}

// ponytail: blobs are never garbage-collected — deleting the last invoice that
// used a logo leaves the logo behind. A company has a handful of these ever, so
// the leak is bounded and small. Sweep unreferenced keys on restore if that
// ever stops being true.

export async function loadColl(coll: string): Promise<Row[]> {
  const hit = hasTauri ? memo.get(coll) : undefined;
  if (hit) return hit.rows;
  const key = "localdb:" + coll;
  try {
    const v = hasTauri
      ? await invoke<string | null>("cache_get", { key })
      : localStorage.getItem(key);
    const rows = await hydrate(v ? (JSON.parse(v) as Row[]) : []);
    // json stays the STORED form (markers, not payloads) so replaceColl keeps
    // comparing like with like.
    if (hasTauri) memo.set(coll, { rows, json: v ?? "[]" });
    return rows;
  } catch {
    // Don't memo a failed read — the next call should try again.
    return [];
  }
}

async function saveColl(coll: string, rows: Row[]): Promise<void> {
  const key = "localdb:" + coll;
  const json = await dehydrate(rows);
  if (!hasTauri) {
    localStorage.setItem(key, json);
    return;
  }
  try {
    // Cache only what actually reached storage. A write that fails (disk full,
    // DB locked) must not leave the UI reading rows nobody saved.
    await invoke("cache_set", { key, value: json });
    memo.set(coll, { rows, json });
  } catch (e) {
    memo.delete(coll);
    throw e;
  }
}

/** Overwrite a collection from the cloud (pull-sync) WITHOUT journalling —
 *  journalling it would echo the pulled rows straight back up on the next
 *  push. Returns true when the stored data actually changed. */
export async function replaceColl(coll: string, rows: Row[]): Promise<boolean> {
  const next = await dehydrate(rows);
  // Compare against the stored JSON rather than re-serialising what's already
  // there: a pull that changes nothing used to parse AND stringify every table.
  await loadColl(coll); // fills memo.json; free once warm
  const current = hasTauri
    ? memo.get(coll)?.json
    : (localStorage.getItem("localdb:" + coll) ?? "[]");
  if (current === next) return false;
  const key = "localdb:" + coll;
  if (!hasTauri) {
    localStorage.setItem(key, next);
    return true;
  }
  try {
    await invoke("cache_set", { key, value: next });
    memo.set(coll, { rows, json: next });
  } catch (e) {
    memo.delete(coll);
    throw e;
  }
  return true;
}

const nextId = (rows: Row[]): number =>
  rows.reduce((m, r) => (typeof r.id === "number" && r.id > m ? r.id : m), 0) + 1;

// ---- sync journal ----------------------------------------------------------
// Records which collections changed — per row: changed ids + deleted ids —
// since the last cloud push, so sync.ts uploads only the rows that moved.
// Row-level matters once several users/devices share one cloud org: pushing a
// whole collection would overwrite teammates' newer rows with stale copies.
// Presence of a table key = dirty; `all` = push every row (first seed, legacy
// journals); `v` bumps on every write so the pusher can detect writes that
// landed mid-sync and keep the journal instead of clearing it.

export type SyncJournal = {
  v: number;
  tables: Record<string, { all?: boolean; changed: any[]; deleted: any[] }>;
};

const JOURNAL_KEY = "syncjournal";

// Same deal as the collection memo above: journalMark reads and rewrites the
// whole journal on every single row write, so saving an invoice with 20 lines
// was 40 IPC round trips on the main thread.
let journalMemo: SyncJournal | null = null;

async function journalLoad(): Promise<SyncJournal> {
  if (hasTauri && journalMemo) return journalMemo;
  try {
    const raw = hasTauri
      ? await invoke<string | null>("cache_get", { key: JOURNAL_KEY })
      : localStorage.getItem(JOURNAL_KEY);
    const j = raw ? JSON.parse(raw) : null;
    if (j && typeof j.v === "number" && j.tables) {
      for (const t of Object.keys(j.tables)) {
        const e = j.tables[t];
        // Journals written before row-level tracking meant "whole collection".
        if (!Array.isArray(e.changed)) {
          e.changed = [];
          e.all = true;
        }
        if (!Array.isArray(e.deleted)) e.deleted = [];
      }
      journalMemo = j as SyncJournal;
      return journalMemo;
    }
  } catch {
    /* corrupt journal → start fresh; worst case a full re-push (idempotent) */
  }
  journalMemo = { v: 0, tables: {} };
  return journalMemo;
}

async function journalSave(j: SyncJournal): Promise<void> {
  const json = JSON.stringify(j);
  if (!hasTauri) {
    localStorage.setItem(JOURNAL_KEY, json);
    return;
  }
  journalMemo = j;
  try {
    await invoke("cache_set", { key: JOURNAL_KEY, value: json });
  } catch (e) {
    // journalCommit clears pushed tables before saving. Keeping an unpersisted
    // clear in memory would drop rows that never reached the cloud, so fall
    // back to storage — the worst it costs is re-pushing, which is idempotent.
    journalMemo = null;
    throw e;
  }
}

/** Mark rows dirty and notify the auto-sync scheduler. Bare call (no opts) or
 *  `all: true` marks the whole collection. `silent` skips the write event —
 *  used when re-marking failed pushes, so a permanently bad row can't put the
 *  scheduler in a hot retry loop. No-op for collections the cloud doesn't take. */
export async function journalMark(
  coll: string,
  opts?: { changed?: any[]; deleted?: any[]; all?: boolean; silent?: boolean }
): Promise<void> {
  if (!PUSH_SET.has(coll)) return;
  const j = await journalLoad();
  j.v++;
  const entry = (j.tables[coll] ??= { changed: [], deleted: [] });
  if (opts?.all || (!opts?.changed && !opts?.deleted)) entry.all = true;
  // Set membership, not Array.includes: a bulk import marks thousands of ids
  // against a list that is already thousands long, and the quadratic scan was
  // the import's own bottleneck.
  const push = (list: any[], ids: any[]): void => {
    if (!ids.length) return;
    const seen = new Set(list);
    for (const id of ids) {
      if (id == null || seen.has(id)) continue;
      seen.add(id);
      list.push(id);
    }
  };
  push(entry.changed, opts?.changed ?? []);
  push(entry.deleted, opts?.deleted ?? []);
  await journalSave(j);
  if (!opts?.silent && typeof window !== "undefined")
    window.dispatchEvent(new Event("filey:local-write"));
}

export async function journalSnapshot(): Promise<SyncJournal> {
  return journalLoad();
}

/** Clear pushed tables from the journal — but only if nothing wrote since the
 *  snapshot (`v` unchanged). Otherwise leave it; the next debounced sync
 *  re-pushes, and upserts make that harmless. */
export async function journalCommit(v: number, tables: string[]): Promise<void> {
  const j = await journalLoad();
  if (j.v !== v) return;
  for (const t of tables) delete j.tables[t];
  await journalSave(j);
}

// ---- query builder --------------------------------------------------------

type Op = "select" | "insert" | "update" | "upsert" | "delete";
type Filter =
  | { kind: "eq"; col: string; val: any }
  | { kind: "lte"; col: string; val: any }
  | { kind: "in"; col: string; val: any[] }
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
  /** Match any of a set of values. Uses the same loose comparison as eq(), so
   *  an id that came back from storage as a string still matches a number. */
  in(col: string, vals: any[]): this {
    this.filters.push({ kind: "in", col, val: vals });
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

  // PostgREST coerces text↔number in filters (a `?id=eq.5` matches int 5). The
  // shim is schemaless, so mirror that with a stringified compare — otherwise a
  // string route param (`"5"`) silently fails to match a numeric stored id and
  // the row vanishes with no error. ponytail: String() compare, enough for
  // id/owner/status scalars; revisit if a column ever needs strict-type equality.
  private looseEq(a: any, b: any): boolean {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a === "object" || typeof b === "object") return false;
    return String(a) === String(b);
  }

  private matches(r: Row): boolean {
    for (const f of this.filters) {
      if (f.kind === "eq" && !this.looseEq(r[f.col], f.val)) return false;
      if (f.kind === "lte" && !(r[f.col] <= f.val)) return false;
      if (f.kind === "in" && !f.val.some((v) => this.looseEq(r[f.col], v)))
        return false;
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
        if (!this.looseEq(r[k], this.matchObj[k])) return false;
    return true;
  }

  private async exec(): Promise<Result> {
    try {
      // loadColl hands back the cached array itself, so a write works on a copy:
      // insert/upsert splice in place, and mutating the cache before the store
      // has accepted the write would show rows that a failed save never kept.
      let rows = await loadColl(this.coll);
      if (this.op !== "select") rows = [...rows];
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
        await journalMark(this.coll, { changed: written.map((r) => r.id) });
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
        await journalMark(this.coll, { changed: written.map((r) => r.id) });
        result = this.returnRows ? written : null;
      } else if (this.op === "delete") {
        const removed = rows.filter((r) => this.matches(r));
        rows = rows.filter((r) => !this.matches(r));
        await saveColl(this.coll, rows);
        await journalMark(this.coll, { deleted: removed.map((r) => r.id) });
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

// ---- storage: file bytes ---------------------------------------------------
// Desktop (Tauri): real files on disk under {data_dir}/files — bytes stay out of
// the SQLite DB and never leave the machine (privacy + no DB bloat). Browser dev
// (no Tauri): base64 in localStorage. Old desktop installs that stored base64 in
// kv_cache are migrated to disk lazily on first read.

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

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const EXT_MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
};
const mimeFromPath = (p: string) =>
  EXT_MIME[p.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

// Old kv-backed base64 store (browser fallback + migration source).
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

// Real files-on-disk via Tauri. ponytail: bytes sent as a number[] (JSON) — fine
// for documents up to a few MB; switch to a raw ArrayBuffer/Channel transfer if
// users start storing very large files.
async function diskWrite(path: string, bytes: Uint8Array): Promise<void> {
  await invoke("blob_write", { path, bytes: Array.from(bytes) });
}
async function diskRead(path: string): Promise<Uint8Array | null> {
  try {
    const arr = await invoke<number[]>("blob_read", { path });
    return arr ? Uint8Array.from(arr) : null;
  } catch {
    return null; // missing file
  }
}
async function diskDelete(path: string): Promise<void> {
  try {
    await invoke("blob_delete", { path });
  } catch {
    /* ignore */
  }
}

/** Read bytes for a storage key. Desktop: disk, migrating an old kv base64 blob
 *  on first read. Browser: kv base64. */
export async function readBlobBytes(path: string): Promise<Uint8Array | null> {
  if (hasTauri) {
    const disk = await diskRead(path);
    if (disk) return disk;
    const old = await blobGet(path); // migrate legacy base64 blob → disk
    if (old) {
      const bytes = b64ToBytes(old.b64);
      await diskWrite(path, bytes);
      await blobSet(path, null);
      return bytes;
    }
    return null;
  }
  const b = await blobGet(path);
  return b ? b64ToBytes(b.b64) : null;
}

function localStorageApi() {
  return {
    from: (_bucket: string) => ({
      async upload(path: string, blob: Blob, opts?: { contentType?: string }) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (hasTauri) await diskWrite(path, bytes);
        else
          await blobSet(path, {
            mime: opts?.contentType || (blob as any).type || mimeFromPath(path),
            b64: bytesToB64(bytes),
          });
        return { data: { path }, error: null };
      },
      async remove(paths: string[]) {
        for (const p of paths) {
          if (hasTauri) await diskDelete(p);
          else await blobSet(p, null);
        }
        return { data: null, error: null };
      },
      async createSignedUrl(path: string) {
        const bytes = await readBlobBytes(path);
        if (!bytes) return { data: null, error: { message: "File not found" } };
        return {
          data: { signedUrl: `data:${mimeFromPath(path)};base64,${bytesToB64(bytes)}` },
          error: null,
        };
      },
      async download(path: string) {
        const bytes = await readBlobBytes(path);
        if (!bytes) return { data: null, error: { message: "File not found" } };
        return {
          // Fresh ArrayBuffer-backed copy so it satisfies BlobPart under strict TS.
          data: new Blob([new Uint8Array(bytes)], { type: mimeFromPath(path) }),
          error: null,
        };
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
