/**
 * Local (offline) backend for the MCP server — talks to the desktop app's
 * SQLite file directly, so every tool works with no Supabase project, no
 * network, and no account.
 *
 * The desktop app does NOT store ERP data in relational tables: `src/lib/localdb.ts`
 * keeps one JSON array per collection inside the `kv_cache` table, under the key
 * `localdb:<collection>`. So this module opens that file, reads/writes those JSON
 * blobs, and re-implements the slice of the supabase-js query builder that
 * `tools.ts` uses — letting the tool code run unchanged against either backend.
 *
 * ponytail: `node:sqlite` (stdlib, Node >= 22.5) instead of better-sqlite3 — no
 * native dependency to build. Whole-array read-modify-write mirrors what the app
 * itself does; a write races only if the app writes the SAME collection in the
 * same instant (last writer wins). Move to row-level SQL only if that ever bites.
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type Row = Record<string, any>;
type Result = { data: any; error: any };

/** Tauri bundle identifier — decides the default app-data folder. */
const APP_IDENTIFIER = "com.iamvi.filey-erp";

/** Same folder Tauri's `app_data_dir()` resolves to for this identifier. */
export function defaultDataDir(): string {
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"),
      APP_IDENTIFIER
    );
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", APP_IDENTIFIER);
  }
  return path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"),
    APP_IDENTIFIER
  );
}

/**
 * Full path to filey-erp.db, or null when the desktop app has never run here.
 * Mirrors `src-tauri/src/modules/storage.rs::data_dir` — a `data_dir.txt`
 * pointer file redirects to a user-chosen folder.
 */
export function resolveDbPath(): string | null {
  const explicit = process.env.FILEY_LOCAL_DB;
  if (explicit) return fs.existsSync(explicit) ? explicit : null;

  const base = defaultDataDir();
  let dir = base;
  try {
    const pointer = fs.readFileSync(path.join(base, "data_dir.txt"), "utf8").trim();
    if (pointer && fs.statSync(pointer).isDirectory()) dir = pointer;
  } catch {
    /* no pointer file → the default app-data dir */
  }
  const file = path.join(dir, "filey-erp.db");
  return fs.existsSync(file) ? file : null;
}

// ---- storage: collection name <-> JSON blob in kv_cache --------------------

class Store {
  private db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    // The desktop app may hold the write lock; wait rather than fail instantly.
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS kv_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')))"
    );
  }

  private get(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM kv_cache WHERE key = ?").get(key) as
      | { value?: string }
      | undefined;
    return row?.value ?? null;
  }

  private put(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO kv_cache (key, value, updated_at) VALUES (?, ?, datetime('now')) " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
      )
      .run(key, value);
  }

  /** Rows of a collection. Read fresh every time — the desktop app writes the
   *  same file concurrently, and stale reads would show the agent old data. */
  read(coll: string): Row[] {
    const raw = this.get("localdb:" + coll);
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? (v as Row[]) : [];
    } catch {
      return []; // corrupt blob → behave like an empty collection
    }
  }

  /** Persist a collection and mark the written rows dirty so the app's next
   *  sync pushes them to the cloud (see src/lib/localdb.ts journalMark). */
  write(coll: string, rows: Row[], changedIds: unknown[]): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.put("localdb:" + coll, JSON.stringify(rows));
      this.mark(coll, changedIds);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /** Append to the app's sync journal. ponytail: no PUSH_SET check here — that
   *  list lives in the app's TS source. Marking a collection the cloud doesn't
   *  take just leaves an entry the pusher ignores. */
  private mark(coll: string, ids: unknown[]): void {
    let j: { v: number; tables: Record<string, { all?: boolean; changed: any[]; deleted: any[] }> } = {
      v: 0,
      tables: {},
    };
    try {
      const raw = this.get("syncjournal");
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed.v === "number" && parsed.tables) j = parsed;
    } catch {
      /* corrupt journal → start fresh; a full re-push is idempotent */
    }
    j.v++;
    const entry = (j.tables[coll] ??= { changed: [], deleted: [] });
    if (!Array.isArray(entry.changed)) entry.changed = [];
    if (!Array.isArray(entry.deleted)) entry.deleted = [];
    for (const id of ids) if (id != null && !entry.changed.includes(id)) entry.changed.push(id);
    this.put("syncjournal", JSON.stringify(j));
  }
}

// ---- query builder --------------------------------------------------------

type Cmp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "like" | "ilike" | "in" | "is";
interface Filter {
  col: string;
  op: Cmp;
  val: any;
}

/** PostgREST coerces text<->number in filters, and the local store is
 *  schemaless (ids are numbers locally, uuid strings once synced). Compare
 *  stringified so a numeric id still matches a string id. */
function looseEq(a: any, b: any): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a === "object" || typeof b === "object") return false;
  return String(a) === String(b);
}

/** Ordered comparison. Numbers compare numerically, everything else as text
 *  (ISO dates sort correctly that way). Returns null when not comparable. */
function cmp(a: any, b: any): number | null {
  if (a == null || b == null) return null;
  const na = Number(a);
  const nb = Number(b);
  if (a !== "" && b !== "" && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** SQL LIKE pattern -> RegExp. `%` = any run, `_` = one char. */
function likeRegex(pattern: string, caseInsensitive: boolean): RegExp {
  const escaped = String(pattern).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = escaped.replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${body}$`, caseInsensitive ? "is" : "s");
}

function testFilter(row: Row, f: Filter): boolean {
  const cell = row[f.col];
  switch (f.op) {
    case "eq":
      return looseEq(cell, f.val);
    case "neq":
      return !looseEq(cell, f.val);
    case "in":
      return (f.val as any[]).some((v) => looseEq(cell, v));
    case "is": {
      // PostgREST `is.null` / `is.true` / `is.false`. A key the app never wrote
      // is absent rather than null — both count as null here.
      const want = String(f.val).toLowerCase();
      if (want === "null") return cell == null;
      if (want === "true") return cell === true;
      if (want === "false") return cell === false;
      return false;
    }
    case "like":
    case "ilike":
      return cell == null ? false : likeRegex(f.val, f.op === "ilike").test(String(cell));
    default: {
      const c = cmp(cell, f.val);
      if (c === null) return false;
      if (f.op === "gt") return c > 0;
      if (f.op === "gte") return c >= 0;
      if (f.op === "lt") return c < 0;
      return c <= 0; // lte
    }
  }
}

/** Parse one PostgREST `or=` term, e.g. `name.ilike.%acme%`. */
function parseOrTerm(term: string): Filter | null {
  const first = term.indexOf(".");
  const second = term.indexOf(".", first + 1);
  if (first < 1 || second < 0) return null;
  const col = term.slice(0, first);
  const op = term.slice(first + 1, second) as Cmp;
  const val = term.slice(second + 1);
  const known: Cmp[] = ["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is"];
  return known.includes(op) ? { col, op, val } : null;
}

/** Raised once, the first time an org_id filter is dropped (see LocalBuilder.eq). */
let warnedOrgIdDropped = false;

class LocalBuilder implements PromiseLike<Result> {
  private op: "select" | "insert" = "select";  private filters: Filter[] = [];
  private orGroups: Filter[][] = [];
  private payload: Row[] = [];
  private orders: { col: string; asc: boolean }[] = [];
  private limitN?: number;
  private columns: string[] | null = null; // null = every column
  private want: "many" | "single" | "maybe" = "many";
  private returnRows = false;

  constructor(
    private store: Store,
    private coll: string,
    private identity: { userId?: string; orgId?: string }
  ) {}

  select(cols?: string): this {
    if (this.op !== "select") this.returnRows = true;
    const spec = (cols ?? "*").trim();
    this.columns = spec === "*" || spec === "" ? null : spec.split(",").map((c) => c.trim()).filter(Boolean);
    return this;
  }

  insert(rows: Row | Row[]): this {
    this.op = "insert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  eq(col: string, val: any): this {
    // WHY the tenant filter is dropped here: the whole local database belongs
    // to one org, and rows created while offline carry no org_id at all —
    // honouring an org_id filter would silently hide exactly those rows. In
    // local mode the file's own permissions are the security boundary, not the
    // org column. Every other filter applies normally. Warned once per process
    // so nobody has to discover this from missing query results.
    if (col === "org_id") {
      if (!warnedOrgIdDropped) {
        warnedOrgIdDropped = true;
        console.warn(
          "[filey-erp-mcp] local mode ignores org_id filters — offline rows carry no " +
            "org_id; file permissions on filey-erp.db are the boundary"
        );
      }
      return this;
    }
    return this.push({ col, op: "eq", val });
  }
  neq(col: string, val: any): this {
    return this.push({ col, op: "neq", val });
  }
  gt(col: string, val: any): this {
    return this.push({ col, op: "gt", val });
  }
  gte(col: string, val: any): this {
    return this.push({ col, op: "gte", val });
  }
  lt(col: string, val: any): this {
    return this.push({ col, op: "lt", val });
  }
  lte(col: string, val: any): this {
    return this.push({ col, op: "lte", val });
  }
  like(col: string, pattern: string): this {
    return this.push({ col, op: "like", val: pattern });
  }
  ilike(col: string, pattern: string): this {
    return this.push({ col, op: "ilike", val: pattern });
  }
  in(col: string, vals: any[]): this {
    return this.push({ col, op: "in", val: vals });
  }
  or(spec: string): this {
    const group = spec
      .split(",")
      .map(parseOrTerm)
      .filter((f): f is Filter => f !== null);
    if (group.length) this.orGroups.push(group);
    return this;
  }

  private push(f: Filter): this {
    this.filters.push(f);
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
    for (const f of this.filters) if (!testFilter(r, f)) return false;
    for (const g of this.orGroups) if (!g.some((f) => testFilter(r, f))) return false;
    return true;
  }

  private project(rows: Row[]): Row[] {
    const cols = this.columns;
    if (!cols) return rows;
    return rows.map((r) => {
      const out: Row = {};
      for (const c of cols) out[c] = r[c];
      return out;
    });
  }

  private exec(): Result {
    try {
      const rows = this.store.read(this.coll);

      if (this.op === "insert") {
        // Ids are assigned the same way the desktop app does it (max + 1) so
        // MCP-created rows are indistinguishable from app-created ones.
        let next = rows.reduce((m, r) => (typeof r.id === "number" && r.id > m ? r.id : m), 0) + 1;
        const written: Row[] = [];
        for (const p of this.payload) {
          const row: Row = { ...p };
          if (row.id == null) row.id = next++;
          if (row.created_at == null) row.created_at = new Date().toISOString();
          // Stamp ownership the way the app's own writes do. Dropped when
          // unknown, so a bogus value can never reach the cloud on sync.
          if (this.identity.userId) row.user_id ??= this.identity.userId;
          else delete row.user_id;
          if (this.identity.orgId) row.org_id ??= this.identity.orgId;
          else delete row.org_id;
          rows.push(row);
          written.push(row);
        }
        this.store.write(
          this.coll,
          rows,
          written.map((r) => r.id)
        );
        return this.shape(this.returnRows ? this.project(written) : null);
      }

      let out = rows.filter((r) => this.matches(r));
      if (this.orders.length) {
        out = [...out].sort((a, b) => {
          for (const o of this.orders) {
            const av = a[o.col];
            const bv = b[o.col];
            if (av == null && bv == null) continue;
            if (av == null) return 1; // nulls last, like PostgREST
            if (bv == null) return -1;
            const c = cmp(av, bv) ?? 0;
            if (c !== 0) return o.asc ? c : -c;
          }
          return 0;
        });
      }
      if (this.limitN != null) out = out.slice(0, this.limitN);
      return this.shape(this.project(out));
    } catch (e: any) {
      return { data: null, error: { message: String(e?.message ?? e) } };
    }
  }

  private shape(result: any): Result {
    if (this.want === "many") return { data: result, error: null };
    const arr = Array.isArray(result) ? result : result == null ? [] : [result];
    if (this.want === "single" && arr.length === 0) {
      return { data: null, error: { message: "No rows found", code: "PGRST116" } };
    }
    return { data: arr.length ? arr[0] : null, error: null };
  }

  then<R1 = Result, R2 = never>(
    onF?: ((v: Result) => R1 | PromiseLike<R1>) | null,
    onR?: ((e: any) => R2 | PromiseLike<R2>) | null
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.exec()).then(onF as any, onR as any);
  }
}

// ---- client ---------------------------------------------------------------

export interface LocalClient {
  from(coll: string): LocalBuilder;
}

/**
 * A supabase-js-shaped client over the desktop database. `identity` is stamped
 * onto inserted rows; resolve it with {@link readLocalIdentity}.
 */
export function createLocalClient(
  file: string,
  identity: { userId?: string; orgId?: string } = {}
): LocalClient {
  const store = new Store(file);
  return { from: (coll: string) => new LocalBuilder(store, coll, identity) };
}

/** The signed-in desktop user, read from the local `profiles` collection.
 *  Empty when the app has only ever run offline without a profile. */
export function readLocalIdentity(file: string): { userId: string; orgId: string } {
  const store = new Store(file);
  const profile = store.read("profiles")[0] ?? {};
  return {
    userId: typeof profile.id === "string" ? profile.id : "",
    orgId: typeof profile.org_id === "string" ? profile.org_id : "",
  };
}
