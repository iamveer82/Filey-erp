// One-time import of cloud (Supabase) data into the on-device local store.
// Runs against the REAL cloud client, so the user must be signed in to their
// cloud account. Writes each table as a JSON array under localdb:<table> — the
// exact shape the local shim (localdb.ts) reads — then switching to local mode
// shows the imported data. File bytes from the "files" bucket are pulled down
// and stored as base64 blobs so My Files works offline too.

import { invoke } from "@tauri-apps/api/core";
import { supabase } from "./supabase";
import { normalizeEmirate } from "./einvoice";
import { PUSH_TABLES } from "./syncTables";
import { cleanRowForPush, pushCollection, pullPaged, inRealOrg, pushFileBlobs, pullFileBlobs, type SyncFailure } from "./sync";
import {
  loadColl,
  replaceColl,
  clearLocalCache,
  journalSnapshot,
  journalCommit,
  journalVersion,
  journalMark,
} from "./localdb";

import { assertLocalAccount, claimLocalWorkspace } from "./localAuth";
import { pendingProfile, syncProfile } from "./profileSync";

const hasTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// Every table the app reads. Over-copying cloud-only tables (organizations,
// profiles, invitations…) is harmless — the local shim just stores them.
const TABLES = [
  "company_profile",
  "app_settings",
  "app_users",
  "profiles",
  "organizations",
  "suppliers",
  "crm_customers",
  "products",
  "orders",
  "order_items",
  "invoice_docs",
  "invoice_doc_items",
  "work_items",
  "invoice_payments",
  "invoice_recurrence",
  "quotations",
  "quotation_items",
  "quotation_templates",
  "purchase_orders",
  "purchase_order_items",
  "po_payments",
  "payment_receipts",
  "accounts",
  "expenses",
  "transactions",
  "advances",
  "stock_movements",
  "employees",
  "attendance",
  "payroll",
  "crm_leads",
  "crm_people",
  "crm_opportunities",
  "crm_activities",
  "crm_notes",
  "crm_tasks",
  "follow_ups",
  "notifications",
  "tool_runs",
  "tool_jobs",
  "user_folders",
  "user_files",
  "user_assets",
  "email_optouts",
  "campaigns",
];

async function localSet(key: string, value: string): Promise<void> {
  if (hasTauri) await invoke("cache_set", { key, value });
  else localStorage.setItem(key, value);
}

async function localGet(key: string): Promise<string | null> {
  if (hasTauri) return (await invoke<string | null>("cache_get", { key })) ?? null;
  return localStorage.getItem(key);
}

// Local store has no SQL migration path; this is the on-device equivalent of
// supabase/2026-06-25-emirate-code-remap.sql.
const EMIRATE_FIELDS: [string, string[]][] = [
  ["company_profile", ["country_subdivision"]],
  ["crm_customers", ["country_subdivision"]],
  ["invoice_docs", ["seller_country_subdivision", "buyer_country_subdivision"]],
];

/** Rewrite legacy ISO 3166-2 "AE-xx" emirate codes to the PINT-AE 3-letter codes
 *  across the local store. Idempotent. Returns the number of fields updated. */
export async function normalizeLocalEmirates(): Promise<number> {
  let changed = 0;
  for (const [coll, fields] of EMIRATE_FIELDS) {
    const raw = await localGet("localdb:" + coll);
    if (!raw) continue;
    let rows: any[];
    try {
      rows = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!Array.isArray(rows)) continue;
    let dirty = false;
    for (const r of rows) {
      for (const f of fields) {
        const v = r?.[f];
        const n = normalizeEmirate(v);
        if (v && n !== v) {
          r[f] = n;
          dirty = true;
          changed++;
        }
      }
    }
    if (dirty) await localSet("localdb:" + coll, JSON.stringify(rows));
  }
  // Written straight to the key, so anything already holding a parsed copy of
  // these collections is now behind. Cheaper than routing a one-off repair
  // through the query layer.
  if (changed) clearLocalCache();
  return changed;
}

export interface MigrateResult {
  table: string;
  rows: number;
  error?: string;
}

/** Push all local on-device data into the signed-in cloud account, so the web
 *  version shows the same data. Rows keep their local ids (FK relationships
 *  survive); user/org ownership is re-stamped by the cloud's defaults and
 *  triggers. Existing cloud rows are updated only when their revision matches
 *  this device's last copy. Conflicts stay pending for review. File bytes are
 *  uploaded before their metadata, through the same path as automatic sync. */
export async function migrateLocalToCloud(
  onProgress?: (msg: string) => void
): Promise<MigrateResult[]> {
  if (!supabase)
    throw new Error("Cloud isn't configured in this build — nowhere to push.");
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user?.id;
  if (!uid)
    throw new Error(
      "Not signed in to your cloud account. In offline mode, connect under " +
        "“Cloud sync (automatic)” above; in cloud mode, log in — then push again."
    );

  assertLocalAccount(uid);
  await inRealOrg(supabase, uid, true);
  const out: MigrateResult[] = [];
  if (Object.keys(pendingProfile(uid)).length) {
    try {
      await syncProfile(supabase, uid);
      out.push({ table: "profiles", rows: 1 });
    } catch (error) {
      out.push({ table: "profiles", rows: 0, error: error instanceof Error ? error.message : String(error) });
    }
  }

  for (const t of PUSH_TABLES) {
    // Through loadColl, not the raw key: oversized fields (the logo a doc was
    // issued with) are stored as {__blob} markers pointing at a shared payload,
    // and the cloud must receive the real value, not the marker.
    const rows = await loadColl(t);
    if (rows.length === 0) continue;

    onProgress?.(`Pushing ${t}…`);
    const failures: SyncFailure[] = [];
    const report = (failure: SyncFailure) => failures.push(failure);
    const uploaded = t === "user_files" ? await pushFileBlobs(supabase, uid, rows, report) : { rows, failed: [] };
    const cleaned = uploaded.rows.map((r) => cleanRowForPush(r as Record<string, any>, uid, t));
    const failed = [...uploaded.failed, ...await pushCollection(supabase, t, cleaned, report)];
    if (failed.length) await journalMark(t, { changed: failed, silent: true });
    out.push({
      table: t,
      rows: rows.length - failed.length,
      error: failed.length ? `${failed.length} row(s) failed. ${[...new Set(failures.map(f => f.message))].join(" ")}` : undefined,
    });
  }

  // Pushed rows kept their local ids — bump identity sequences past them so
  // the next normal insert doesn't collide.
  onProgress?.("Fixing id sequences…");
  try {
    await supabase.rpc("sync_bump_sequences");
  } catch {
    /* older cloud DBs without the fn: next insert may need a retry */
  }

  return out;
}

/** Copy all cloud data into the local on-device store. Replaces any existing
 *  local data for these tables. Returns a per-table summary. */
export async function migrateCloudToLocal(
  onProgress?: (msg: string) => void
): Promise<MigrateResult[]> {
  if (!supabase)
    throw new Error("Cloud isn't configured in this build — nothing to import.");
  const { data: sess } = await supabase.auth.getSession();
  if (!sess.session)
    throw new Error(
      "Sign in to your cloud account first: switch to Cloud mode, log in, then import."
    );

  const uid = sess.session.user.id;
  assertLocalAccount(uid);
  const before = await journalSnapshot();
  const staged = new Map<string, Record<string, any>[]>();
  const originals = new Map<string, Record<string, any>[]>();
  const out: MigrateResult[] = [];

  // Read the complete source first. No record is replaced on a failed cloud read.
  for (const t of TABLES) {
    onProgress?.(`Reading ${t}…`);
    staged.set(t, await pullPaged(supabase, t, "*"));
    originals.set(t, await loadColl(t));
    out.push({ table: t, rows: staged.get(t)!.length });
  }

  const cloudProfile = staged.get("profiles")?.find((row) => row.id === uid);
  if (cloudProfile) assertLocalAccount(uid, cloudProfile.org_id ?? null);
  const fileRows = staged.get("user_files") ?? [];
  onProgress?.(`Downloading ${fileRows.length} files…`);
  await pullFileBlobs(supabase, fileRows);
  if (fileRows.length) out.push({ table: "files (blobs)", rows: fileRows.length });
  if ((await journalVersion()) !== before.v)
    throw new Error("Local records changed during the copy. Finish editing and retry.");
  const current = await supabase.auth.getSession();
  if (current.data.session?.user.id !== uid)
    throw new Error(
      "The cloud account changed during the copy. Local records have not been replaced."
    );

  const committed: string[] = [];
  try {
    // ponytail: compensation handles write errors; process-crash atomicity needs a SQLite transaction.
    for (const [table, rows] of staged) {
      committed.push(table);
      await replaceColl(table, rows);
    }
    claimLocalWorkspace(uid);
    await journalCommit(before.v, TABLES);
    // An imported snapshot must not be re-uploaded as legacy local data.
    localStorage.setItem("filey_cloud_seeded", "1");
  } catch (error) {
    const failures: string[] = [];
    for (const table of committed.reverse()) {
      try {
        await replaceColl(table, originals.get(table)!);
      } catch {
        failures.push(table);
      }
    }
    if (failures.length)
      throw new Error(
        `Local storage failed; restore your backup for: ${failures.join(", ")}.`
      );
    throw error;
  }
  clearLocalCache();
  window.dispatchEvent(new Event("filey:remote-update"));
  return out;
}
