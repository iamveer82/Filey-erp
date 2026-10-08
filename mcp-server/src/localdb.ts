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
 * native dependency to build. Insert reads, row allocation and journal updates
 * share one SQLite transaction so concurrent MCP writers cannot lose changes.
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
    if (raw === null) return [];
    try {
      const v = JSON.parse(raw);
      if (!Array.isArray(v) || v.some((row) => !row || typeof row !== "object" || Array.isArray(row))) throw new Error();
      return v as Row[];
    } catch {
      throw new Error(`Local collection ${coll} is damaged. Repair or restore it before writing; existing data was preserved.`);
    }
  }

  /** Persist a collection and mark the written rows dirty so the app's next
   *  sync pushes them to the cloud (see src/lib/localdb.ts journalMark). */
  insert(coll: string, payload: Row[], identity: { userId?: string; orgId?: string }): Row[] {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const written = this.insertRows(coll, payload, identity);
      this.db.exec("COMMIT");
      return written;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  private insertRows(coll: string, payload: Row[], identity: { userId?: string; orgId?: string }): Row[] {
      const rows = this.read(coll);
      let next = rows.reduce((m, r) => (typeof r.id === "number" && r.id > m ? r.id : m), 0) + 1;
      const written = payload.map((p) => {
        const row: Row = { ...p };
        if (row.id == null) row.id = next++;
        if (typeof row.id === "number" && (!Number.isSafeInteger(row.id) || row.id <= 0))
          throw new Error("The local record ID range is exhausted or invalid. Existing records were preserved.");
        if (rows.some((existing) => looseEq(existing.id, row.id))) throw new Error("A local row with this ID already exists.");
        row.created_at ??= new Date().toISOString();
        if (identity.userId) row.user_id = identity.userId;
        else delete row.user_id;
        if (identity.orgId) row.org_id = identity.orgId;
        else delete row.org_id;
        const numberColumn: Record<string, string> = { invoice_docs: "number", quotations: "number", purchase_orders: "po_number", orders: "order_number", payment_receipts: "number" };
        const column = numberColumn[coll];
        if (column) {
          const number = row[column];
          if (typeof number !== "string" || !number.trim() || number.length > 160 || /[\u0000-\u001f\u007f]/.test(number))
            throw new Error("Enter a valid document number before saving.");
          if (rows.some(existing => (!existing.org_id || !row.org_id || existing.org_id === row.org_id) &&
            typeof existing[column] === "string" && existing[column].trim().toLowerCase() === number.trim().toLowerCase()))
            throw new Error("This document number is already in use. Choose another number.");
        }
        rows.push(row);
        return row;
      });
      this.put("localdb:" + coll, JSON.stringify(rows));
      this.mark(coll, written.map((r) => r.id));
      return written;
  }

  reserveNumber(args: Record<string, any>, identity: { userId?: string; orgId?: string }): string {
    const actor = identity.userId ?? "", org = identity.orgId ?? "";
    if (args.p_actor !== actor || args.p_org !== org) throw new Error("Document number workspace access denied.");
    const shapes: Record<string, [string, string, string]> = {
      invoice: ["invoice_docs", "number", "invoice"], purchase_invoice: ["invoice_docs", "number", "invoice"],
      quote: ["quotations", "number", "quote"], purchase_order: ["purchase_orders", "po_number", "purchase_order"],
    };
    const shape = shapes[args.p_kind];
    const pattern = args.p_pattern;
    const year = args.p_year;
    if (!shape || typeof pattern !== "string" || pattern.length > 120 || /[\u0000-\u001f\u007f]/.test(pattern)
      || !Number.isInteger(year) || year < 1900 || year > 9999 || typeof args.p_request !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.p_request))
      throw new Error("Invalid document number request.");
    const tokens = [...pattern.matchAll(/\{([0-9]+)\}/g)];
    if (tokens.length !== 1 || tokens[0][1].length > 12) throw new Error("Number format needs one bounded counter.");
    const token = tokens[0][0];
    const resolved = pattern.replace(/\{YYYY\}/gi, String(year)).replace(/\{YY\}/gi, String(year).slice(-2));
    const tokenIndex = resolved.indexOf(token);
    const prefix = resolved.slice(0, tokenIndex), suffix = resolved.slice(tokenIndex + token.length);
    const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matcher = new RegExp(`^${escape(prefix)}([0-9]+)${escape(suffix)}$`, "i");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const [table, column, namespace] = shape;
      const ledger = this.read("document_number_reservations");
      const reservations = ledger.filter(row => row.namespace === namespace &&
        (row.org_id === org || (!row.org_id && (row.scope === `${org}:user:${actor}` || (!org && !row.scope)))));
      const previous = reservations.find(row => row.request_id === args.p_request);
      if (previous) {
        if ((previous.user_id ?? previous.scope?.split(":user:").at(-1) ?? "") !== actor || previous.pattern !== pattern || previous.year !== year
          || typeof previous.number !== "string") throw new Error("Number request was already used differently.");
        this.db.exec("COMMIT"); return previous.number;
      }
      const numbers = [...reservations.map(row => row.number),
        ...this.read(table).filter(row => !row.org_id || row.org_id === org).map(row => row[column])];
      let max = 0;
      for (const number of numbers) {
        const match = typeof number === "string" && number.match(matcher);
        if (match) {
          const value = Number(match[1]);
          if (!Number.isSafeInteger(value)) throw new Error("Document number counter exhausted.");
          max = Math.max(max, value);
        }
      }
      const sequence = Math.max(max + 1, Number(tokens[0][1]) || 1);
      if (!Number.isSafeInteger(sequence)) throw new Error("Document number counter exhausted.");
      const number = prefix + String(sequence).padStart(tokens[0][1].length, "0") + suffix;
      if (numbers.some(value => typeof value === "string" && value.trim().toLowerCase() === number.trim().toLowerCase()))
        throw new Error("Document number collision.");
      const id = crypto.randomUUID();
      ledger.push({ id, scope: `${org}:user:${actor}`, org_id: org, user_id: actor, namespace,
        request_id: args.p_request, pattern, year, number, created_at: new Date().toISOString() });
      // Reservations are device-private and never enter the cloud sync journal.
      this.put("localdb:document_number_reservations", JSON.stringify(ledger));
      this.db.exec("COMMIT"); return number;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  saveDocument(table: string, header: Row, items: Row[], identity: { userId?: string; orgId?: string }): unknown {
    const children: Record<string, [string, string]> = {
      invoice_docs: ["invoice_doc_items", "invoice_id"],
      quotations: ["quotation_items", "quotation_id"],
      purchase_orders: ["purchase_order_items", "po_id"],
    };
    const child = children[table];
    if (!child || !header || typeof header !== "object" || Array.isArray(header) || header.status !== "draft" ||
      !Array.isArray(items) || items.length < 1 || items.length > 500 ||
      items.some(item => !item || typeof item !== "object" || Array.isArray(item))) throw new Error("Invalid draft document payload.");
    const strip = (row: Row) => Object.fromEntries(Object.entries(row).filter(([key]) =>
      !["id", "user_id", "org_id", "created_at", "updated_at", "shared", "shared_with", "public_shared", "share_token", "stock_received"].includes(key)));
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const [saved] = this.insertRows(table, [strip(header)], identity);
      this.insertRows(child[0], items.map((item, index) => ({ ...strip(item), [child[1]]: saved.id, position: index })), identity);
      this.db.exec("COMMIT");
      return saved.id;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  close(): void { this.db.close(); }

  /** Append to the app's sync journal. ponytail: no PUSH_SET check here — that
   *  list lives in the app's TS source. Marking a collection the cloud doesn't
   *  take just leaves an entry the pusher ignores. */
  private mark(coll: string, ids: unknown[]): void {
    let j: { v: number; tables: Record<string, { all?: boolean; changed: any[]; deleted: any[] }> } = {
      v: 0,
      tables: {},
    };
    const raw = this.get("syncjournal");
    if (raw !== null) {
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || !Number.isSafeInteger(parsed.v) || parsed.v < 0 || parsed.v >= Number.MAX_SAFE_INTEGER ||
          !parsed.tables || typeof parsed.tables !== "object" || Array.isArray(parsed.tables) ||
          Object.values(parsed.tables).some((e: any) => !e || !Array.isArray(e.changed) || !Array.isArray(e.deleted))) throw new Error();
        j = parsed;
      } catch {
        throw new Error("The local sync journal is damaged. Existing data and pending changes were preserved.");
      }
    }
    j.v++;
    const entry = (j.tables[coll] ??= { changed: [], deleted: [] });
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
      // Older offline rows have no tenant tag. Tagged rows must still respect
      // the current workspace; a desktop file can contain several workspaces.
      if (f.col === "org_id" && cell == null) return true;
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

function readableRow(row: Row, identity: { userId?: string; orgId?: string }): boolean {
  const { userId, orgId } = identity;
  if (row.org_id != null && row.org_id !== orgId) return false;
  if (row.user_id == null) return true;
  if (row.user_id === userId && userId) return true;
  return !!userId && !!orgId && row.org_id === orgId &&
    (row.shared === true || (Array.isArray(row.shared_with) && row.shared_with.includes(userId)));
}

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

  /** Local profiles do not prove an administrator's cloud authority. Keep
   * reads scoped even when a caller omits/loosens its query filters. Older
   * ownerless offline records remain usable within the selected workspace. */
  private visibility(): (row: Row) => boolean {
    const parents: Record<string, [string, string]> = {
      invoice_doc_items: ["invoice_docs", "invoice_id"], invoice_payments: ["invoice_docs", "invoice_id"],
      invoice_recurrence: ["invoice_docs", "base_invoice_id"], quotation_items: ["quotations", "quotation_id"],
      purchase_order_items: ["purchase_orders", "po_id"], po_payments: ["purchase_orders", "po_id"],
      order_items: ["orders", "order_id"],
    };
    const parent = parents[this.coll];
    if (!parent) return row => readableRow(row, this.identity);
    // A targeted share grants the parent document, including its lines/payment
    // totals. An owned or separately shared child cannot expose a private parent.
    const ids = new Set(this.store.read(parent[0]).filter(row => readableRow(row, this.identity))
      .filter(row => row.id != null).map(row => String(row.id)));
    return row => (row.org_id == null || row.org_id === this.identity.orgId) &&
      row[parent[1]] != null && ids.has(String(row[parent[1]]));
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
      if (this.op === "insert") {
        const written = this.store.insert(this.coll, this.payload, this.identity);
        return this.shape(this.returnRows ? this.project(written) : null);
      }

      const visible = this.visibility();
      let out = this.store.read(this.coll).filter((r) => visible(r) && this.matches(r));
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
    if (arr.length > 1 || (this.want === "single" && arr.length === 0)) {
      return { data: null, error: { message: arr.length ? "More than one row found" : "No rows found", code: "PGRST116" } };
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
  rpc(name: string, args: Record<string, any>): Promise<Result>;
  close(): void;
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
  return {
    from: (coll: string) => new LocalBuilder(store, coll, identity),
    rpc: async (name, args) => {
      try {
        if (name === "filey_reserve_document_number") return { data: store.reserveNumber(args, identity), error: null };
        if (name !== "filey_save_document" || args.p_id != null) throw new Error("Unsupported local operation.");
        return { data: store.saveDocument(args.p_table, args.p_header, args.p_items, identity), error: null };
      } catch (error: any) { return { data: null, error: { message: String(error?.message ?? error) } }; }
    },
    close: () => store.close(),
  };
}

/** The signed-in desktop user, read from the local `profiles` collection.
 *  Empty when the app has only ever run offline without a profile. */
export function readLocalIdentity(file: string): { userId: string; orgId: string } {
  const store = new Store(file);
  try {
    const profiles = store.read("profiles");
    const selected = process.env.FILEY_LOCAL_USER_ID;
    const matches = selected ? profiles.filter(profile => profile.id === selected) : profiles;
    if (matches.length > 1 || (selected && matches.length !== 1))
      throw new Error("Select the desktop profile with FILEY_LOCAL_USER_ID before using this database.");
    const profile = matches[0] ?? {};
    return {
      userId: typeof profile.id === "string" ? profile.id : "",
      orgId: typeof profile.org_id === "string" ? profile.org_id : "",
    };
  } finally { store.close(); }
}
