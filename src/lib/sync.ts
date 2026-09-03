// Automatic two-way sync between the local store and the cloud. While the app
// runs in LOCAL mode, every write is journalled per row (localdb.ts); this
// module debounces those events, PUSHES the changed rows to the signed-in
// Supabase account, then PULLS back everything this account can see — its own
// rows plus records shared by org teammates (RLS decides). That is how a
// second device or a teammate's desktop stays current.
//
// Conflict rule is last-writer-wins per row: pushes upsert by id, and dirty
// tables are never overwritten by a pull (local edits win until they've been
// pushed). ponytail: numeric local ids can collide when two devices insert
// into the same table inside one poll window (~60s) — last push wins. Move to
// uuid ids if teams ever hit it in practice.
//
// Requires a cloud session. In local mode the app itself authenticates against
// the local shim, so the real supabase-js client is signed in separately
// (cloudSignIn below); its session persists in localStorage across restarts.

import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "./log";
import { supabase } from "./supabase";
import { isLocalMode } from "./dataMode";
import { PUSH_TABLES } from "./syncTables";
import {
  loadColl,
  replaceColl,
  readBlobBytes,
  journalSnapshot,
  journalCommit,
  journalMark,
} from "./localdb";

const FILES_BUCKET = "files";
const ENABLED_KEY = "filey_auto_sync"; // "off" disables; anything else = on

export const autoSyncEnabled = (): boolean =>
  typeof localStorage === "undefined" || localStorage.getItem(ENABLED_KEY) !== "off";

export function setAutoSyncEnabled(on: boolean): void {
  if (on) localStorage.removeItem(ENABLED_KEY);
  else localStorage.setItem(ENABLED_KEY, "off");
  notify();
  if (on) scheduleSync(500);
}

export interface SyncStatus {
  state: "idle" | "signed-out" | "syncing" | "done" | "error";
  at?: string; // last successful push
  error?: string;
}

let status: SyncStatus = { state: "idle" };
export const getSyncStatus = (): SyncStatus => status;

function notify(): void {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("filey:sync-status"));
}

function setStatus(s: SyncStatus): void {
  status = { at: status.at, ...s };
  notify();
}

/** Strip ownership columns the cloud re-stamps (user_id default, force_org_id
 *  trigger); "owner" columns and local file paths need the real uid. Shared
 *  with the one-time migration so both push paths clean rows identically.
 *  Null-valued keys are dropped so the cloud applies its column defaults /
 *  triggers (updated_at, shared, status…) instead of failing a NOT NULL —
 *  local JSON is loose, the cloud schema is strict.
 *  ponytail: dropping nulls means clearing a field to null on desktop won't
 *  propagate on upsert; acceptable — the alternative breaks NOT NULL columns. */
export function cleanRowForPush(row: Record<string, any>, uid: string): Record<string, any> {
  const { user_id: _u, org_id: _o, ...rest } = row;
  for (const k of Object.keys(rest)) if (rest[k] === null) delete rest[k];
  if ("owner" in row) rest.owner = uid;
  if (typeof rest.storage_path === "string")
    rest.storage_path = rest.storage_path.replace(/^local-user\//, `${uid}/`);
  return rest;
}

// Tables that never get the org-shared flag: company_profile/app_settings are
// org-scoped in the cloud and have no `shared` column; the user_* tables and
// tool_runs are personal and stay visible to the owner + org admins only.
const NO_SHARE = new Set([
  "company_profile",
  "app_settings",
  "user_files",
  "user_assets",
  "user_folders",
  "tool_runs",
]);

// SECURITY: shared=true may only be set for members of a REAL organization.
// Every solo account sits in org 'default', so sharing there would expose
// rows to unrelated users. Cached per uid; refreshed on every pull.
let orgCache: { uid: string; inOrg: boolean } | null = null;
async function inRealOrg(
  supa: SupabaseClient,
  uid: string,
  refresh = false
): Promise<boolean> {
  if (!refresh && orgCache?.uid === uid) return orgCache.inOrg;
  const { data } = await supa
    .from("profiles")
    .select("org_id")
    .eq("id", uid)
    .maybeSingle();
  const inOrg = !!data?.org_id && data.org_id !== "default";
  orgCache = { uid, inOrg };
  return inOrg;
}

// FK columns whose parent may be missing in the local data (e.g. an invoice
// pointing at a since-deleted customer). All are nullable in the cloud, so a
// dangling reference is nulled on retry — the row itself is preserved.
const FK_COLUMNS: Record<string, string[]> = {
  orders: ["customer_id"],
  order_items: ["order_id", "product_id"],
  invoice_docs: ["customer_id", "quotation_id"],
  invoice_doc_items: ["invoice_id", "product_id"],
  invoice_payments: ["invoice_id"],
  quotation_items: ["quotation_id", "product_id"],
  transactions: ["account_id", "invoice_id"],
  user_files: ["folder_id"],
  stock_movements: ["product_id"],
};

/** Upsert one collection resiliently: try the whole chunk; on any error fall
 *  back to per-row so one bad row can't block the rest, and retry a row with
 *  its foreign keys nulled if a FK constraint is what failed. Returns the ids
 *  that could not be pushed (rare — logged, retried next sync). */
export async function pushCollection(
  supa: SupabaseClient,
  table: string,
  rows: Record<string, any>[]
): Promise<(string | number)[]> {
  const failed: (string | number)[] = [];
  const fks = FK_COLUMNS[table] ?? [];
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await supa.from(table).upsert(chunk, { onConflict: "id" });
    if (!error) continue;
    // Chunk failed — isolate the bad rows.
    for (const row of chunk) {
      let { error: e1 } = await supa.from(table).upsert(row, { onConflict: "id" });
      if (e1 && fks.length) {
        const stripped = { ...row };
        for (const c of fks) delete stripped[c];
        e1 = (await supa.from(table).upsert(stripped, { onConflict: "id" })).error;
      }
      if (e1) failed.push(row.id);
    }
  }
  return failed;
}

async function pushFileBlobs(
  supa: SupabaseClient,
  uid: string,
  rows: { storage_path?: string }[]
): Promise<void> {
  for (const f of rows) {
    const localPath = f.storage_path;
    if (!localPath) continue;
    try {
      const bytes = await readBlobBytes(localPath);
      if (!bytes) continue;
      const cloudPath = localPath.replace(/^local-user\//, `${uid}/`);
      await supa.storage
        .from(FILES_BUCKET)
        .upload(cloudPath, new Blob([new Uint8Array(bytes)]), { upsert: true });
    } catch {
      /* skip individual file failures — rows still sync */
    }
  }
}

/** The session, refreshed first if its token is dead or nearly dead.
 *
 *  supabase-js refreshes on a timer, and a timer does not run while a laptop is
 *  asleep. A desktop app that wakes after the token's hour is up therefore
 *  pushes with an expired JWT and the first table out of PUSH_TABLES fails —
 *  which is why the report always names company_profile, the first entry, and
 *  not the actual cause.
 *
 *  Refreshing 60s early also covers the case where the token is alive when the
 *  push starts and dead by the time a long push reaches its last table. */
async function freshSession(supa: SupabaseClient) {
  const { data } = await supa.auth.getSession();
  const s = data.session;
  if (!s) return null;
  const expiresAt = (s.expires_at ?? 0) * 1000;
  if (expiresAt && expiresAt - Date.now() > 60_000) return s;
  try {
    const { data: r, error } = await supa.auth.refreshSession();
    // Refresh failed, so the token in hand is dead. Handing it back only means
    // every table in the push fails with "JWT expired" — reported against
    // company_profile, the first one, which names neither the cause nor the
    // cure. Report no session instead: the caller says "sign in", and the next
    // cycle retries if the failure was transient.
    if (error) {
      // The one place the actual reason exists. Without it every report is the
      // same "JWT expired" and a revoked refresh token looks like a flat
      // network blip.
      log.warn("sync", "session refresh failed", error.message);
      return null;
    }
    return r.session ?? s;
  } catch (e) {
    log.warn("sync", "session refresh threw", e instanceof Error ? e.message : String(e));
    return null;
  }
}

let running = false;

/** True while a migration (import/push) is running. syncCycle checks this and
 *  skips rather than racing a full-collection replace against the same tables.
 *  Set/cleared by the migration callers via setMigrating(). */
let migrating = false;

export function setMigrating(v: boolean): void {
  migrating = v;
}

export function isMigrating(): boolean {
  return migrating;
}

/** Push everything the journal marked dirty. Returns true when the push ran to
 *  completion (including "nothing to do"). `client` is injectable for tests. */
export async function syncNow(
  client?: SupabaseClient | null,
  opts?: { manual?: boolean }
): Promise<boolean> {
  const supa = client ?? supabase;
  const manual = opts?.manual === true;
  // A press of "Upload all local data" is an instruction, not a background
  // tick. Every one of these used to return false in silence, so the button
  // did nothing and said nothing — most cruelly when auto-sync was simply
  // switched off. Manual runs ignore that preference and report why they stop.
  const stop = (error: string): boolean => {
    if (manual) setStatus({ state: "error", error });
    return false;
  };
  if (!isLocalMode())
    return stop(
      "This device already works directly against the cloud, so there is nothing to upload."
    );
  if (!supa) return stop("Cloud is not configured in this build.");
  if (!manual && !autoSyncEnabled()) return false;
  if (running) return stop("A sync is already running — wait for it to finish.");
  if (migrating && !manual)
    return stop("A data migration is running — sync will resume after it finishes.");
  if (typeof navigator !== "undefined" && !navigator.onLine)
    return stop("No internet connection.");

  const sess = await freshSession(supa);
  const uid = sess?.user?.id;
  if (!uid) {
    setStatus({
      state: manual
        ? // Redeeming an offline licence does not sign you in — people reach for
          // the voucher when the upload fails, so name the actual requirement.
          "error"
        : "signed-out",
      ...(manual
        ? { error: "Sign in to your Filey account first — uploading needs an account to push to." }
        : {}),
    });
    return false;
  }

  const j = await journalSnapshot();
  const dirty = PUSH_TABLES.filter((t) => j.tables[t]);
  if (!dirty.length) {
    setStatus({ state: "done" });
    return true;
  }

  running = true;
  setStatus({ state: "syncing" });
  try {
    // Deletes first, children before parents (reverse FK order).
    for (const t of [...dirty].reverse()) {
      const ids = j.tables[t].deleted;
      for (let i = 0; i < ids.length; i += 100) {
        const { error } = await supa
          .from(t)
          .delete()
          .in("id", ids.slice(i, i + 100));
        if (error) throw new Error(`${t}: ${error.message}`);
      }
    }

    // Upserts parents-first, only the rows the journal saw change (whole
    // collection on first seed). Row-level pushes are what make multi-user
    // safe: a stale unchanged row is never re-uploaded over a teammate's
    // newer copy. Resilient per-row fallback means messy local data
    // (dangling FKs, etc.) can't halt the whole sync.
    const share = await inRealOrg(supa, uid);
    let pushedAny = false;
    const failedByTable: Record<string, (string | number)[]> = {};
    for (const t of dirty) {
      // Re-check the token per table, not once for the whole push. A first
      // seed is thousands of rows across every table and takes far longer than
      // the 60s of headroom the initial check bought, so the token used to go
      // dead partway and the rest of the run failed as "JWT expired".
      // getSession is a local read; the refresh only fires near expiry.
      if (!(await freshSession(supa)))
        throw new Error("Your session expired mid-upload. Sign in again and retry.");
      const entry = j.tables[t];
      const all = await loadColl(t);
      const idSet = new Set(entry.changed);
      const rows = entry.all ? all : all.filter((r) => idSet.has(r.id));
      const cleaned = rows.map((r) => {
        const c = cleanRowForPush(r, uid);
        // Org members share business records with the whole team by default
        // (Vyapar model). Per-record privacy stays a web-side choice.
        if (share && !NO_SHARE.has(t)) c.shared = true;
        return c;
      });
      const failed = await pushCollection(supa, t, cleaned);
      if (failed.length) failedByTable[t] = failed;
      if (rows.length) pushedAny = true;
      if (t === "user_files") await pushFileBlobs(supa, uid, rows);
    }

    // Pushed rows kept their local ids — bump identity sequences past them so
    // web-side inserts don't collide.
    if (pushedAny) {
      try {
        await supa.rpc("sync_bump_sequences");
      } catch {
        /* older cloud DBs without the fn */
      }
    }

    // Bookkeeping the web UI can show ("desktop last synced …"). Best-effort:
    // older cloud DBs may not have the table yet.
    const now = new Date().toISOString();
    await supa
      .from("sync_state")
      .upsert(
        dirty.map((t) => ({ user_id: uid, table_name: t, synced_at: now })),
        { onConflict: "user_id,table_name" }
      );

    await journalCommit(j.v, dirty);
    // Rows that wouldn't upsert stay marked so the next sync retries them.
    // Silent: re-dispatching the write event would hot-loop on a bad row.
    for (const [t, ids] of Object.entries(failedByTable)) {
      log.warn("sync", `${t}: ${ids.length} row(s) failed, will retry`);
      await journalMark(t, { changed: ids, silent: true });
    }
    setStatus({ state: "done", at: now });
    return true;
  } catch (e: any) {
    setStatus({ state: "error", error: e?.message ?? String(e) });
    return false;
  } finally {
    running = false;
  }
}

// Tables whose rows reference blobs in cloud Storage; pulling the metadata
// without the bytes would list files that can't open locally.
// ponytail: files sync device→cloud only; pull them once a blob-download
// path exists in the local storage shim.
const PULL_SKIP = new Set(["user_files", "user_assets"]);

// Tables carrying the `set_updated_at` BEFORE UPDATE trigger (schema.sql, the
// `do $$` block that also installs RLS and force_org_id). Only these can be
// pulled incrementally: without the trigger, updated_at never moves and an
// edit made on another device would be invisible here. Any table added to the
// trigger array in schema.sql can be added here.
const INCREMENTAL = new Set([
  "products", "orders", "order_items",
  "employees", "attendance", "payroll",
  "accounts", "expenses", "transactions",
  "app_settings",
  "crm_leads", "crm_customers", "crm_opportunities", "crm_activities",
  "company_profile", "invoice_docs", "invoice_doc_items", "invoice_payments",
  "quotations", "quotation_items", "quotation_templates", "tool_runs",
  "suppliers", "purchase_orders", "purchase_order_items", "stock_movements",
  "advances", "po_payments", "payment_receipts", "entity_links",
  "campaigns", "email_optouts",
]);

/** Page a table out of the cloud, `cols` wide, ordered by id. */
async function pullPaged(
  supa: SupabaseClient,
  t: string,
  cols: string
): Promise<Record<string, any>[]> {
  const rows: Record<string, any>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supa
      .from(t)
      .select(cols)
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`${t}: ${error.message}`);
    rows.push(...((data ?? []) as any[]));
    if ((data ?? []).length < 1000) break;
  }
  return rows;
}

/** Same result as a full snapshot, a fraction of the egress: pull the id +
 *  updated_at of every visible row (two small columns), then fetch whole rows
 *  only for the ones this device doesn't already hold at that timestamp. The
 *  id list still defines membership, so remote deletes propagate as before.
 *  This is what stops a 24/7 poll re-downloading base64 logos and signatures
 *  on every beat — the free-tier egress blowout. */
async function pullIncremental(
  supa: SupabaseClient,
  t: string
): Promise<Record<string, any>[]> {
  const meta = await pullPaged(supa, t, "id, updated_at");
  const local = new Map(
    (await loadColl(t)).map((r) => [String((r as any).id), r as Record<string, any>])
  );
  // "Not held locally" has to be its own test: a row whose updated_at is null
  // on both sides compares equal, and would otherwise never be downloaded.
  const stale = meta.filter((m) => {
    const have = local.get(String(m.id));
    return !have || have.updated_at !== m.updated_at;
  });

  const fetched = new Map<string, Record<string, any>>();
  for (let i = 0; i < stale.length; i += 500) {
    const ids = stale.slice(i, i + 500).map((m) => m.id);
    const { data, error } = await supa.from(t).select("*").in("id", ids);
    if (error) throw new Error(`${t}: ${error.message}`);
    for (const r of (data ?? []) as any[]) fetched.set(String(r.id), r);
  }
  // A row deleted between the two queries resolves to neither — drop it.
  return meta
    .map((m) => fetched.get(String(m.id)) ?? local.get(String(m.id)))
    .filter(Boolean) as Record<string, any>[];
}

/** Cloud → local: replace every clean (non-dirty) collection with the rows
 *  this account can see — its own plus org-shared ones (RLS decides). The id
 *  list is always a full snapshot, so remote deletes propagate for free; the
 *  row BODIES come down incrementally where updated_at is trustworthy. Dirty
 *  tables are skipped — local edits win until they've been pushed. */
export async function pullNow(client?: SupabaseClient | null): Promise<boolean> {
  const supa = client ?? supabase;
  if (!isLocalMode() || !supa || !autoSyncEnabled() || running) return false;
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;
  const sess = await freshSession(supa);
  const uid = sess?.user?.id;
  if (!uid) return false;

  running = true;
  try {
    await inRealOrg(supa, uid, true); // refresh org membership for the next push
    const before = await journalSnapshot();
    let changed = false;
    for (const t of PUSH_TABLES) {
      if (PULL_SKIP.has(t) || before.tables[t]) continue;
      const rows = INCREMENTAL.has(t)
        ? await pullIncremental(supa, t)
        : await pullPaged(supa, t, "*");
      // A local write raced the pull — stop; the queued push must run first.
      if ((await journalSnapshot()).v !== before.v) break;
      if (await replaceColl(t, rows)) changed = true;
    }
    if (changed && typeof window !== "undefined")
      window.dispatchEvent(new Event("filey:remote-update"));
    return true;
  } catch (e: any) {
    setStatus({ state: "error", error: e?.message ?? String(e) });
    return false;
  } finally {
    running = false;
  }
}

/** One full sync beat: seed once, push local changes, then pull what's new
 *  from other devices and teammates. Pull after a failed push is safe — dirty
 *  tables are skipped, so unpushed local edits can't be overwritten. */
export async function syncCycle(
  client?: SupabaseClient | null,
  opts?: { manual?: boolean }
): Promise<boolean> {
  await seedIfNeeded(client);
  // "Sync now" is a button, not a heartbeat: pass the intent down so it does
  // not sit there doing nothing when auto-sync happens to be switched off.
  const pushed = await syncNow(client, opts);
  const pulled = await pullNow(client);
  return pushed && pulled;
}

/** DATA-PRESERVATION GUARD. The journal only tracks writes made since
 *  auto-sync shipped, so a device with pre-existing local data (or one whose
 *  cloud session predates the seed flag) must mark EVERYTHING dirty once
 *  before its first pull — marking makes every table dirty, pull skips dirty
 *  tables, so nothing local can be replaced until it has been pushed. */
async function seedIfNeeded(client?: SupabaseClient | null): Promise<void> {
  const supa = client ?? supabase;
  if (typeof localStorage === "undefined" || !supa || !isLocalMode()) return;
  if (localStorage.getItem(SEEDED_KEY)) return;
  const { data } = await supa.auth.getSession();
  if (!data.session) return; // seed the first time a session exists
  await markAllForSync();
  localStorage.setItem(SEEDED_KEY, "1");
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** Debounced sync — a burst of writes becomes one push (then a pull). */
export function scheduleSync(delayMs = 4000): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncCycle();
  }, delayMs);
}

/** Wire up auto-sync for the app's lifetime. Call once at startup; no-op
 *  outside local mode or in builds without cloud config. */
export function startAutoSync(): void {
  if (typeof window === "undefined") return;
  if (!isLocalMode() || !supabase) return;
  // Near-instant: push ~1s after a write. Short enough to feel immediate, long
  // enough that a burst of saves (e.g. an invoice + its items) becomes one push.
  window.addEventListener("filey:local-write", () => scheduleSync(1000));
  window.addEventListener("online", () => scheduleSync(1000));
  // Pull once when the user returns to the app — covers edits missed while the
  // window was hidden (see the idle-poll note below).
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) scheduleSync(1000);
  });
  scheduleSync(3000); // catch up on writes made while offline or signed out
  // Idle poll so teammate / second-device edits land. A poll used to re-download
  // a full snapshot of every table, which burnt cloud egress 24/7 for nothing —
  // that is what exhausted the free-tier quota. Now three things hold it down:
  // pullNow is incremental (see pullIncremental), the interval is 5 min, and
  // nothing polls while the window is hidden (a backgrounded app syncs nothing
  // until you look at it again — the visibilitychange pull above catches up).
  setInterval(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    void syncCycle();
  }, 300_000);
}

/** Mark every non-empty local collection dirty, then sync — the "upload all my
 *  local data" action for a first-time connect against a non-empty cloud. */
export async function markAllForSync(): Promise<void> {
  for (const t of PUSH_TABLES) {
    if ((await loadColl(t)).length) await journalMark(t, { all: true, silent: true });
  }
}

// ---- cloud session helpers (local mode signs into the shim, not the cloud;
// the real client needs its own sign-in for sync to have someone to push as) --

export async function cloudSessionEmail(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.email ?? null;
}

const SEEDED_KEY = "filey_cloud_seeded";

// Fresh sign-in: seed (see seedIfNeeded) and sync promptly.
async function seedOnFirstConnect(): Promise<void> {
  setStatus({ state: "idle" });
  await seedIfNeeded();
  scheduleSync(500);
}

export async function cloudSignIn(email: string, password: string): Promise<void> {
  if (!supabase) throw new Error("Cloud isn't configured in this build.");
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  await seedOnFirstConnect();
}

/** Create a cloud account from the desktop. Returns "confirm" when the
 *  project requires email confirmation before a session exists. */
export async function cloudSignUp(
  email: string,
  password: string
): Promise<"session" | "confirm"> {
  if (!supabase) throw new Error("Cloud isn't configured in this build.");
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw new Error(error.message);
  if (!data.session) return "confirm";
  await seedOnFirstConnect();
  return "session";
}

export async function cloudSignOut(): Promise<void> {
  await supabase?.auth.signOut();
  setStatus({ state: "signed-out" });
}
