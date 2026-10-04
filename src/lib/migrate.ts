// One-time import of cloud (Supabase) data into the on-device local store.
// Runs against the REAL cloud client, so the user must be signed in to their
// cloud account. Writes each table as a JSON array under localdb:<table> — the
// exact shape the local shim (localdb.ts) reads — then switching to local mode
// shows the imported data. File bytes from the "files" bucket are pulled down
// and stored as base64 blobs so My Files works offline too.

import { supabase } from "./supabase";
import { normalizeEmirate } from "./einvoice";
import { PUSH_TABLES } from "./syncTables";
import { prepareSyncRows, pushCollection, pullPaged, pullManifest, pullIncremental, inRealOrg, pushFileBlobs, pullFileBlobs, type SyncFailure } from "./sync";
import {
  loadColl,
  replaceWorkspaceSnapshot,
  journalSnapshot,
  journalCommit,
  journalVersion,
  journalMark,
  withLocalTransaction,
} from "./localdb";

import { assertLocalAccount, claimLocalWorkspace } from "./localAuth";
import { pendingProfile, syncProfile } from "./profileSync";
import { assertWorkspaceCurrent } from "./dataMode";
import { checkCloudTransfer, assertCloudTransfer, type CloudTransferPermit } from "./cloudTransfer";

// Every table the app reads. Over-copying cloud-only tables (organizations,
// profiles, invitations…) is harmless — the local shim just stores them.
const TABLES = [
  ...PUSH_TABLES,
  "app_users",
  "profiles",
  "organizations",
  "notifications",
  "tool_jobs",
];

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
  return withLocalTransaction(async client => {
    let changed = 0;
    for (const [coll, fields] of EMIRATE_FIELDS) {
      const { data: rows, error } = await client.from(coll).select("*");
      if (error) throw error;
      for (const row of rows) {
        const patch: Record<string, string> = {};
        for (const field of fields) {
          const value = row?.[field];
          const normalized = normalizeEmirate(value);
          if (value && normalized !== value) {
            patch[field] = normalized;
            changed++;
          }
        }
        if (!Object.keys(patch).length) continue;
        if (row.id == null) throw new Error("A saved record is missing its ID. Repair its data before updating emirate codes.");
        const { error: saveError } = await client.from(coll).update(patch).eq("id", row.id);
        if (saveError) throw saveError;
      }
    }
    return changed;
  });
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
 *  uploaded before their metadata, only under an explicit cloud-transfer permit. */
export async function migrateLocalToCloud(
  onProgress?: (msg: string) => void,
  transfer?: CloudTransferPermit,
): Promise<MigrateResult[]> {
  if (!supabase)
    throw new Error("Cloud isn't configured in this build — nowhere to push.");
  assertCloudTransfer(transfer, supabase);
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user?.id;
  if (!uid)
    throw new Error(
      "Not signed in to your cloud account. In offline mode, connect under " +
        "“Account connection” above, then turn on cloud storage."
    );

  assertLocalAccount(uid);
  await inRealOrg(supabase, uid, true);
  const out: MigrateResult[] = [];
  if (Object.keys(pendingProfile(uid)).length) {
    try {
      await syncProfile(supabase, uid, transfer);
      out.push({ table: "profiles", rows: 1 });
    } catch (error) {
      out.push({ table: "profiles", rows: 0, error: error instanceof Error ? error.message : String(error) });
    }
  }

  for (const t of PUSH_TABLES) {
    await checkCloudTransfer(transfer, supabase, uid);
    await journalMark(t, { all: true, silent: true });
    const pending = await journalSnapshot();
    // Through loadColl, not the raw key: oversized fields (the logo a doc was
    // issued with) are stored as {__blob} markers pointing at a shared payload,
    // and the cloud must receive the real value, not the marker.
    const rows = await loadColl(t);
    if (rows.length === 0) {
      await journalCommit(pending.v, [t], { [t]: pending.tables[t]?.deleted ?? [] });
      continue;
    }
    onProgress?.(`Pushing ${t}…`);
    const failures: SyncFailure[] = [];
    const report = (failure: SyncFailure) => failures.push(failure);
    const uploaded = t === "user_files" ? await pushFileBlobs(supabase, uid, rows, report, transfer) : { rows, failed: [] };
    const prepared = prepareSyncRows(uploaded.rows, uid, t, report);
    const failed = [...uploaded.failed, ...prepared.failed, ...await pushCollection(supabase, t, prepared.rows, report, uid, transfer)];
    // This helper does not execute queued deletions; the workspace-transfer engine handles them.
    await checkCloudTransfer(transfer, supabase, uid);
    await journalCommit(pending.v, [t], { [t]: [...failed, ...(pending.tables[t]?.deleted ?? [])] });
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
    await checkCloudTransfer(transfer, supabase, uid);
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
  const out: MigrateResult[] = [];

  // Read the complete source first. No record is replaced on a failed cloud read.
  // Reuse unchanged row bodies (including logos/stamps), while the manifest
  // still detects deletions. Files already on disk are not downloaded again.
  const manifest = await pullManifest(supabase, PUSH_TABLES);
  for (const t of TABLES) {
    onProgress?.(`Reading ${t}…`);
    staged.set(t, manifest[t] && !before.tables[t]
      ? await pullIncremental(supabase, t, "sync_revision", manifest[t])
      : await pullPaged(supabase, t, "*"));
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
  assertWorkspaceCurrent();

  claimLocalWorkspace(uid);
  await replaceWorkspaceSnapshot(staged, before.v);
  // This marker is an optimization, not part of committing the data. If the
  // browser's preference storage is full, the next sync safely rechecks rows.
  try {
    localStorage.setItem("filey_cloud_seeded", "1");
  } catch (error) {
    console.warn("Could not save the cloud-copy marker", error);
  }
  window.dispatchEvent(new Event("filey:remote-update"));
  return out;
}
