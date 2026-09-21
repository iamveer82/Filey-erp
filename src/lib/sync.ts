// Automatic two-way sync between the local store and the cloud. While the app
// runs in LOCAL mode, every write is journalled per row (localdb.ts); this
// module debounces those events, PUSHES the changed rows to the signed-in
// Supabase account, then PULLS back everything this account can see — its own
// rows plus records shared by org teammates (RLS decides). That is how a
// second device or a teammate's desktop stays current.
//
// Uploads compare the last cloud revision inside a database transaction.
// Conflicting rows remain local and pending until explicitly reviewed.
//
// Requires a cloud session. In local mode the app itself authenticates against
// the local shim, so the real supabase-js client is signed in separately
// (cloudSignIn below); its session persists in localStorage across restarts.

import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "./log";
import { supabase } from "./supabase";
import { isLocalMode, assertWorkspaceCurrent } from "./dataMode";
import { assertLocalAccount, localWorkspaceOwner, isLocalSignedIn, getLocalCredential } from "./localAuth";
import { PUSH_TABLES } from "./syncTables";
import { syncProfile } from "./profileSync";
import {
  loadColl,
  replaceColl,
  readBlobBytes,
  journalSnapshot,
  journalVersion,
  journalCommit,
  journalMark,
  localClient,
  rememberSyncRevision,
  resolveLocalSyncConflict,
} from "./localdb";

const FILES_BUCKET = "files";
const ENABLED_KEY = "filey_auto_sync";

export const autoSyncEnabled = (): boolean =>
  typeof localStorage !== "undefined" && localStorage.getItem(ENABLED_KEY) === "on";

export function setAutoSyncEnabled(on: boolean): void {
  if (on) localStorage.setItem(ENABLED_KEY, "on");
  else localStorage.setItem(ENABLED_KEY, "off");
  notify();
  if (on) scheduleSync(500);
}

export interface SyncStatus {
  state: "idle" | "signed-out" | "syncing" | "done" | "error";
  at?: string; // last successful push
  error?: string;
  failures?: SyncFailure[];
}

export interface SyncFailure {
  table: string;
  recordId: string | number;
  kind: "conflict" | "schema" | "permission" | "record" | "file" | "connection";
  message: string;
}

function syncFailure(table: string, recordId: string | number, error: any, conflict = false): SyncFailure {
  if (conflict) return { table, recordId, kind: "conflict", message: "Review the local and cloud versions before uploading." };
  const code = String(error?.code ?? error?.statusCode ?? "");
  if (["PGRST202", "PGRST204", "42703", "42P01"].includes(code) || error?.message === "Sync schema is out of date")
    return { table, recordId, kind: "schema", message: "The cloud sync schema needs an update. Contact Filey support." };
  if (["42501", "403", "AccessDenied"].includes(code))
    return { table, recordId, kind: "permission", message: "This account cannot upload the record or access its linked record. Check its workspace and permissions." };
  if (["23502", "23503", "23505", "23514", "22P02"].includes(code))
    return { table, recordId, kind: "record", message: "Check the record's required fields and linked records before retrying." };
  return { table, recordId, kind: "connection", message: "The cloud could not accept this record. Check your connection and retry." };
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
 *  Explicit nulls are retained: clearing a contact field or relationship must
 *  also clear it in the cloud. Invalid required fields remain pending instead
 *  of silently changing their meaning during an upload. */
export function cleanRowForPush(row: Record<string, any>, uid: string, table?: string): Record<string, any> {
  const { user_id: _u, org_id: _o, ...rest } = row;
  if ("owner" in row && (!table || ["user_files", "user_folders", "user_assets"].includes(table))) rest.owner = uid;
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
export async function inRealOrg(
  supa: SupabaseClient,
  uid: string,
  refresh = false
): Promise<boolean> {
  if (!refresh && orgCache?.uid === uid) return orgCache.inOrg;
  const { data, error } = await supa
    .from("profiles")
    .select("org_id")
    .eq("id", uid)
    .maybeSingle();
  if (error) throw error;
  assertLocalAccount(uid, data?.org_id ?? null);
  const inOrg = !!data?.org_id && data.org_id !== "default";
  orgCache = { uid, inOrg };
  return inOrg;
}

/** Upload each record with its last observed cloud revision. Never strip
 * relationships or fall back to an unconditional overwrite after a failure. */
export async function pushCollection(
  supa: SupabaseClient,
  table: string,
  rows: Record<string, any>[],
  onFailure?: (failure: SyncFailure) => void,
): Promise<(string | number)[]> {
  const failed: (string | number)[] = [];
  // ponytail: sequential row RPCs preserve FK order and isolate failures;
  // add a transactional batch RPC when measured large-import latency needs it.
  for (const row of rows) {
    if (["invoice_doc_items", "invoice_payments"].includes(table) && row.invoice_id == null) {
      failed.push(row.id);
      onFailure?.({ table, recordId: row.id, kind: "record", message: "This record has no linked invoice. Review it before uploading; Filey has preserved it on this device." });
      continue;
    }
    const { sync_revision, ...payload } = row;
    const { data, error } = await supa.rpc("sync_record", {
      p_table: table, p_row: payload, p_expected: sync_revision ?? null,
    });
    if (error || !data?.ok || !Number.isSafeInteger(data.revision) || data.revision < 1) {
      failed.push(row.id);
      onFailure?.(syncFailure(table, row.id, error, !!data?.conflict));
      if (data?.conflict) await saveConflict(table, row.id);
    } else {
      await rememberSyncRevision(table, row.id, data.revision);
      await clearConflict(table, row.id);
    }
  }
  return failed;
}

export interface SyncConflict { id: string; table: string; recordId: string | number; at: string }
export async function listSyncConflicts(): Promise<SyncConflict[]> {
  return await loadColl("sync_conflicts") as SyncConflict[];
}
async function saveConflict(table: string, recordId: string | number): Promise<void> {
  const { error } = await localClient.from("sync_conflicts").upsert({
    id: `${table}:${recordId}`, table, recordId, at: new Date().toISOString(),
  });
  if (error) throw error;
}
async function clearConflict(table: string, recordId: string | number): Promise<void> {
  const { error } = await localClient.from("sync_conflicts").delete().eq("id", `${table}:${recordId}`);
  if (error) throw error;
}
export async function reviewSyncConflict(conflict: SyncConflict): Promise<{ local: Record<string, any> | null; cloud: Record<string, any> | null }> {
  if (!supabase) throw new Error("Cloud is not configured.");
  assertWorkspaceCurrent();
  const session = await freshSession(supabase);
  if (!session) throw new Error("Sign in to review conflicts.");
  assertLocalAccount(session.user.id);
  await inRealOrg(supabase, session.user.id, true);
  const { data, error } = await supabase.from(conflict.table).select("*").eq("id", conflict.recordId).maybeSingle();
  if (error) throw error;
  return { local: (await loadColl(conflict.table)).find(row => row.id === conflict.recordId) ?? null, cloud: data };
}
export async function resolveSyncConflict(conflict: SyncConflict, cloud: Record<string, any> | null, keepLocal: boolean, reviewedLocal: Record<string, any> | null): Promise<void> {
  if (running || migrating) throw new Error("Wait for the current transfer to finish.");
  if (!keepLocal && !cloud) throw new Error("The cloud record is unavailable. Your local record was preserved; check the workspace before resolving this conflict.");
  assertWorkspaceCurrent();
  const session = supabase && await freshSession(supabase);
  if (!session) throw new Error("Sign in to resolve conflicts.");
  assertLocalAccount(session.user.id);
  await resolveLocalSyncConflict(conflict.table, conflict.recordId, cloud, keepLocal, reviewedLocal);
  await clearConflict(conflict.table, conflict.recordId);
  notify();
}

export async function pushFileBlobs(
  supa: SupabaseClient,
  uid: string,
  rows: Record<string, any>[],
  onFailure?: (failure: SyncFailure) => void,
): Promise<{ rows: Record<string, any>[]; failed: (string | number)[] }> {
  const uploaded: Record<string, any>[] = [];
  const failed: (string | number)[] = [];
  for (const f of rows) {
    const localPath = f.storage_path;
    try {
      if (!localPath) throw new Error("Missing file path");
      const bytes = await readBlobBytes(localPath);
      if (!bytes) throw new Error("File is missing on this device");
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))))
        .map(n => n.toString(16).padStart(2, "0")).join("");
      // Immutable content paths keep a failed/conflicting metadata upload from
      // replacing a file already referenced by a newer cloud record.
      const cloudPath = `${uid}/synced/${hash}/${String(localPath).split("/").pop()}`;
      assertWorkspaceCurrent();
      if ((await freshSession(supa))?.user.id !== uid) throw new Error("Cloud account changed");
      const { error } = await supa.storage
        .from(FILES_BUCKET)
        .upload(cloudPath, new Blob([new Uint8Array(bytes)], { type: f.mime }), { upsert: false, contentType: f.mime });
      // Storage also returns HTTP 400 for an existing object. Only accept the
      // duplicate response for this immutable, content-addressed path.
      const alreadyExists = error && (Number(error.statusCode) === 409
        || ["Duplicate", "ResourceAlreadyExists"].includes(error.statusCode ?? "")
        || (Number(error.statusCode) === 400 && /^(?:The resource|Asset) already exists\.?$/i.test(error.message)));
      if (error && !alreadyExists) throw error;
      uploaded.push({ ...f, storage_path: cloudPath });
    } catch (error) {
      failed.push(f.id);
      onFailure?.({ table: "user_files", recordId: f.id, kind: "file", message:
        error instanceof Error && ["Missing file path", "File is missing on this device"].includes(error.message)
          ? "This file is missing from this device. Restore it from your backup before retrying."
          : "The file could not be uploaded. Check your connection, storage access and available cloud space." });
    }
  }
  return { rows: uploaded, failed };
}

/** Cache file bytes before exposing their metadata to local readers. */
export async function pullFileBlobs(supa: SupabaseClient, rows: Record<string, any>[]): Promise<void> {
  for (const row of rows) {
    if (!row.storage_path) throw new Error("A cloud file is missing its storage path.");
    if (await readBlobBytes(row.storage_path)) continue;
    const { data, error } = await supa.storage.from(FILES_BUCKET).download(row.storage_path);
    if (error || !data) throw new Error("A file could not be downloaded. Local file records were preserved; retry sync when connected.");
    assertWorkspaceCurrent();
    const saved = await localClient.storage.from(FILES_BUCKET).upload(row.storage_path, data, { contentType: row.mime || data.type });
    if (saved.error) throw saved.error;
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
  return migrating || running;
}

/** Push everything the journal marked dirty. Returns true when the push ran to
 *  completion (including "nothing to do"). `client` is injectable for tests. */
export async function syncNow(
  client?: SupabaseClient | null,
  opts?: { manual?: boolean },
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
      "This device already works directly against the cloud, so there is nothing to upload.",
    );
  if (!supa) return stop("Cloud is not configured in this build.");
  if (!manual && !autoSyncEnabled()) return false;
  if (running) return stop("A sync is already running — wait for it to finish.");
  if (migrating) return stop("A data migration is running — sync will resume after it finishes.");
  if (typeof navigator !== "undefined" && !navigator.onLine) return stop("No internet connection.");

  // Reserve before the first await, so a second sync or workspace switch
  // cannot start while authentication or the journal is being read.
  running = true;
  try {
    assertWorkspaceCurrent();
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
          ? {
              error: "Sign in to your Filey account first — uploading needs an account to push to.",
            }
          : {}),
      });
      return false;
    }

    try {
      assertLocalAccount(uid);
      if (localWorkspaceOwner() && !isLocalSignedIn())
        return stop("Sign in to the device workspace before syncing.");
    } catch (error) {
      setStatus({ state: "error", error: error instanceof Error ? error.message : String(error) });
      return false;
    }

    await syncProfile(supa, uid);
    const j = await journalSnapshot();
    const dirty = PUSH_TABLES.filter((t) => j.tables[t]);
    if (!dirty.length) {
      setStatus({ state: "done" });
      return true;
    }

    setStatus({ state: "syncing" });
    // Deletes first, children before parents (reverse FK order).
    const share = await inRealOrg(supa, uid, true);
    const failedByTable: Record<string, (string | number)[]> = {};
    const failures: SyncFailure[] = [];
    const report = (failure: SyncFailure) => failures.push(failure);
    // Unresolved conflicts need a choice, not the same failed upload every
    // minute. Manual sync can re-check after a server or workspace repair.
    const pendingConflicts = new Set(manual ? [] : (await listSyncConflicts()).map(c => c.id));
    const awaitingReview = (table: string, id: string | number) => {
      if (!pendingConflicts.has(`${table}:${id}`)) return false;
      (failedByTable[table] ??= []).push(id);
      report(syncFailure(table, id, null, true));
      return true;
    };
    for (const t of [...dirty].reverse()) {
      assertWorkspaceCurrent();
      const ids = j.tables[t].deleted;
      for (const id of ids) {
        if (awaitingReview(t, id)) continue;
        if ((await freshSession(supa))?.user.id !== uid)
          throw new Error("Your session changed. Sign in again before syncing.");
        const { data, error } = await supa.rpc("sync_record", {
          p_table: t, p_row: { id }, p_expected: j.tables[t].deletedRevisions?.[String(id)] ?? null, p_delete: true,
        });
        if (error || !data?.ok) {
          (failedByTable[t] ??= []).push(id);
          report(syncFailure(t, id, error, !!data?.conflict));
          if (data?.conflict) await saveConflict(t, id);
        } else await clearConflict(t, id);
      }
    }

    // Upserts parents-first, only the rows the journal saw change (whole
    // collection on first seed). Row-level pushes are what make multi-user
    // safe: a stale unchanged row is never re-uploaded over a teammate's
    // newer copy. Resilient per-row fallback means messy local data
    // (dangling FKs, etc.) can't halt the whole sync.
    let pushedAny = false;
    for (const t of dirty) {
      // Re-check the token per table, not once for the whole push. A first
      // seed is thousands of rows across every table and takes far longer than
      // the 60s of headroom the initial check bought, so the token used to go
      // dead partway and the rest of the run failed as "JWT expired".
      // getSession is a local read; the refresh only fires near expiry.
      if ((await freshSession(supa))?.user.id !== uid)
        throw new Error("Your session changed or expired mid-upload. Sign in again and retry.");
      assertWorkspaceCurrent();
      const entry = j.tables[t];
      const all = await loadColl(t);
      const idSet = new Set(entry.changed);
      const rows = (entry.all ? all : all.filter((r) => idSet.has(r.id)))
        .filter(row => !awaitingReview(t, row.id));
      let ready = rows;
      if (t === "user_files") {
        const uploaded = await pushFileBlobs(supa, uid, rows, report);
        ready = uploaded.rows;
        if (uploaded.failed.length) failedByTable[t] = [...(failedByTable[t] ?? []), ...uploaded.failed];
      }
      const cleaned = ready.map((r) => {
        const c = cleanRowForPush(r, uid, t);
        // Sharing is always opt-in; syncing a private local row must not publish it.
        if (!NO_SHARE.has(t)) c.shared = share ? (c.shared ?? false) : false;
        return c;
      });
      const failed = await pushCollection(supa, t, cleaned, report);
      if (failed.length) failedByTable[t] = [...new Set([...(failedByTable[t] ?? []), ...failed])];
      if (rows.length) pushedAny = true;
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
    const completed = dirty.filter((table) => !failedByTable[table]);
    if (completed.length) await supa.from("sync_state").upsert(
      completed.map((t) => ({ user_id: uid, table_name: t, synced_at: now })),
      { onConflict: "user_id,table_name" },
    );

    // Keep failed tables dirty throughout: clearing and then re-marking them
    // would lose pending records if storage failed between those two writes.
    await journalCommit(j.v, completed);
    for (const [t, ids] of Object.entries(failedByTable)) {
      log.warn("sync", `${t}: ${ids.length} row(s) failed, will retry`);
    }
    if (Object.keys(failedByTable).length) {
      const detail = Object.entries(failedByTable)
        .map(([table, ids]) => `${table} (${ids.length})`)
        .join(", ");
      setStatus({
        state: "error",
        error: `Some records could not be uploaded: ${detail}. Local records are preserved.${failures.some(f => f.kind === "conflict") ? " Review the conflicting versions below." : ""}${failures.some(f => f.kind === "schema") ? " The cloud sync schema needs an update." : ""}`,
        failures,
      });
      return false;
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
export async function pullPaged(
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
  t: string,
  version = "updated_at",
  metadata?: Record<string, any>[]
): Promise<Record<string, any>[]> {
  const meta = metadata ?? await pullPaged(supa, t, `id, ${version}`);
  const local = new Map(
    (await loadColl(t)).map((r) => [String((r as any).id), r as Record<string, any>])
  );
  // "Not held locally" has to be its own test: a row whose updated_at is null
  // on both sides compares equal, and would otherwise never be downloaded.
  const stale = meta.filter((m) => {
    const have = local.get(String(m.id));
    return !have || m[version] == null || have[version] !== m[version];
  });

  const fetched = new Map<string, Record<string, any>>();
  for (let i = 0; i < stale.length; i += 500) {
    const ids = stale.slice(i, i + 500).map((m) => m.id);
    const { data, error } = await supa.from(t).select("*").in("id", ids);
    if (error) throw new Error(`${t}: ${error.message}`);
    for (const r of (data ?? []) as any[]) fetched.set(String(r.id), r);
  }
  // A row deleted between the two queries resolves to neither — drop it.
  const staleIds = new Set(stale.map((m) => String(m.id)));
  return meta
    .map((m) => staleIds.has(String(m.id)) ? fetched.get(String(m.id)) : local.get(String(m.id)))
    .filter(Boolean) as Record<string, any>[];
}

/** Batch only metadata; unchanged image/document bodies never leave Supabase.
 * A partial/error response must not be interpreted as remote deletions. */
async function pullManifest(supa: SupabaseClient, tables: string[]): Promise<Record<string, Record<string, any>[]>> {
  const result: Record<string, Record<string, any>[]> = Object.fromEntries(tables.map(t => [t, []]));
  let pending = tables;
  for (let offset = 0; pending.length; offset += 1000) {
    const { data, error } = await supa.rpc("filey_sync_manifest", { p_tables: pending, p_offset: offset, p_limit: 1000 });
    if (error) throw new Error(`Could not check cloud changes: ${error.message}`);
    const more: string[] = [];
    for (const table of pending) {
      const rows = data?.[table];
      if (!Array.isArray(rows) || rows.length > 1000 || rows.some(r => !r || !["string", "number"].includes(typeof r.id)))
        throw new Error(`Incomplete cloud change check for ${table}. Local records were preserved.`);
      result[table].push(...rows);
      if (rows.length === 1000) more.push(table);
    }
    pending = more;
  }
  return result;
}

/** Cloud → local: replace every clean (non-dirty) collection with the rows
 *  this account can see — its own plus org-shared ones (RLS decides). The id
 *  list is always a full snapshot, so remote deletes propagate for free; the
 *  row BODIES come down incrementally by timestamp or sync revision. Dirty
 *  tables are skipped — local edits win until they've been pushed. */
export async function pullNow(
  client?: SupabaseClient | null,
  opts?: { manual?: boolean; tables?: readonly string[] },
): Promise<boolean> {
  const supa = client ?? supabase;
  if (!isLocalMode() || !supa || (!opts?.manual && !autoSyncEnabled()) || running || migrating)
    return false;
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;
  running = true;
  try {
    assertWorkspaceCurrent();
    const sess = await freshSession(supa);
    const uid = sess?.user?.id;
    if (!uid) return false;
    try {
      assertLocalAccount(uid);
      if (localWorkspaceOwner() && !isLocalSignedIn()) return false;
    } catch (error) {
      setStatus({ state: "error", error: error instanceof Error ? error.message : String(error) });
      return false;
    }

    setStatus({ state: "syncing" });
    await inRealOrg(supa, uid, true); // refresh org membership for the next push
    const before = await journalSnapshot();
    const changed: string[] = [];
    const tables = PUSH_TABLES.filter(t => (!opts?.tables || opts.tables.includes(t)) && !before.tables[t]);
    // A one-table save already needs just one read; batch full catch-up checks.
    const manifest = tables.length > 1 ? await pullManifest(supa, tables) : undefined;
    for (const t of tables) {
      // Every synchronized table has a revision trigger. Histories and CRM
      // tables without updated_at need not resend unchanged bodies either.
      const rows = await pullIncremental(supa, t, INCREMENTAL.has(t) ? "updated_at" : "sync_revision", manifest?.[t]);
      if (t === "user_files") await pullFileBlobs(supa, rows);
      // A local write raced the pull — stop; the queued push must run first.
      if ((await freshSession(supa))?.user.id !== uid)
        throw new Error("Your session changed. Local records were not replaced for this table.");
      assertWorkspaceCurrent();
      if ((await journalVersion()) !== before.v) break;
      if (await replaceColl(t, rows, before.v)) changed.push(t);
    }
    if (changed.length && typeof window !== "undefined")
      window.dispatchEvent(new CustomEvent("filey:remote-update", { detail: { tables: changed } }));
    setStatus({ state: "done", at: new Date().toISOString() });
    return true;
  } catch (e: any) {
    setStatus({ state: "error", error: e?.message ?? String(e) });
    return false;
  } finally {
    running = false;
  }
}

/** Seed once, push local changes, then reconcile the cloud. A failed push
 *  retains the journal and stops the cycle so the next attempt can retry. */
export async function syncCycle(
  client?: SupabaseClient | null,
  opts?: { manual?: boolean; changesOnly?: boolean }
): Promise<boolean> {
  if (migrating || (!opts?.manual && !autoSyncEnabled())) return false;
  await seedIfNeeded(client);
  // A local save only needs to reconcile the collections it uploads. Startup,
  // reconnect, the five-minute check and Sync now still reconcile every table.
  const tables = opts?.changesOnly && !opts.manual
    ? Object.keys((await journalSnapshot()).tables)
    : undefined;
  // "Sync now" is a button, not a heartbeat: pass the intent down so it does
  // not sit there doing nothing when auto-sync happens to be switched off.
  const pushed = await syncNow(client, opts);
  if (!pushed) return false;
  const pulled = tables?.length === 0 || await pullNow(client, { ...opts, tables });
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
  assertLocalAccount(data.session.user.id);
  await markAllForSync();
  localStorage.setItem(SEEDED_KEY, "1");
}

let timer: ReturnType<typeof setTimeout> | null = null;
let fullSyncPending = false;

/** Coalesce writes without downgrading a pending startup/reconnect check. */
export function scheduleSync(delayMs = 4000, changesOnly = false): void {
  fullSyncPending ||= !changesOnly;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const changesOnly = !fullSyncPending;
    fullSyncPending = false;
    void syncCycle(null, { changesOnly }).catch(e => setStatus({ state: "error", error: e instanceof Error ? e.message : String(e) }));
  }, delayMs);
}

/** Wire up auto-sync for the app's lifetime. Call once at startup; no-op
 *  outside local mode or in builds without cloud config. */
export function startAutoSync(): () => void {
  if (typeof window === "undefined" || !isLocalMode() || !supabase) return () => {};
  // Near-instant: push ~1s after a write. Short enough to feel immediate, long
  // enough that a burst of saves (e.g. an invoice + its items) becomes one push.
  const saved = () => scheduleSync(1000, true);
  const online = () => scheduleSync(1000);
  window.addEventListener("filey:local-write", saved);
  window.addEventListener("online", online);
  // Pull once when the user returns to the app — covers edits missed while the
  // window was hidden (see the idle-poll note below).
  const visible = () => {
    if (!document.hidden) scheduleSync(1000);
  };
  document.addEventListener("visibilitychange", visible);
  scheduleSync(3000); // catch up on writes made while offline or signed out
  // Idle poll so teammate / second-device edits land. A poll used to re-download
  // a full snapshot of every table, which burnt cloud egress 24/7 for nothing —
  // that is what exhausted the free-tier quota. Now three things hold it down:
  // pullNow is incremental (see pullIncremental), the interval is 5 min, and
  // periodic pulls pause while hidden; the visibilitychange pull catches up.
  const interval = setInterval(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    void syncCycle().catch(e => setStatus({ state: "error", error: e instanceof Error ? e.message : String(e) }));
  }, 300_000);
  return () => {
    window.removeEventListener("filey:local-write", saved);
    window.removeEventListener("online", online);
    document.removeEventListener("visibilitychange", visible);
    clearInterval(interval);
    if (timer) clearTimeout(timer);
    timer = null;
    fullSyncPending = false;
  };
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

/** Auto-sync used to be opt-out: an absent key meant on. It is opt-in now, so
 *  upgrading would silently stop backing up every install that had simply left
 *  the default alone. Having seeded to cloud proves sync was running, so those
 *  installs keep it; a fresh install has no seed marker and stays off. */
if (typeof localStorage !== "undefined" &&
    localStorage.getItem(ENABLED_KEY) === null &&
    localStorage.getItem(SEEDED_KEY)) {
  localStorage.setItem(ENABLED_KEY, "on");
}

// Fresh sign-in: seed (see seedIfNeeded) and sync promptly.
async function seedOnFirstConnect(): Promise<void> {
  setStatus({ state: "idle" });
  await seedIfNeeded();
  scheduleSync(500);
}

export async function cloudSignIn(email: string, password: string): Promise<void> {
  const credential = getLocalCredential();
  if (localWorkspaceOwner() && credential?.email !== email.trim().toLowerCase())
    throw new Error("Connect the same account that owns this device workspace.");
  if (!supabase) throw new Error("Cloud isn't configured in this build.");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  assertLocalAccount(data.user?.id ?? "");
  if (autoSyncEnabled()) await seedOnFirstConnect();
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
  assertLocalAccount(data.session.user.id);
  if (autoSyncEnabled()) await seedOnFirstConnect();
  return "session";
}

export async function cloudSignOut(): Promise<void> {
  setAutoSyncEnabled(false);
  await supabase?.auth.signOut();
  setStatus({ state: "signed-out" });
}
