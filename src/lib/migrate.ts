// One-time import of cloud (Supabase) data into the on-device local store.
// Runs against the REAL cloud client, so the user must be signed in to their
// cloud account. Writes each table as a JSON array under localdb:<table> — the
// exact shape the local shim (localdb.ts) reads — then switching to local mode
// shows the imported data. File bytes from the "files" bucket are pulled down
// and stored as base64 blobs so My Files works offline too.

import { invoke } from "@tauri-apps/api/core";
import { supabase } from "./supabase";
import { normalizeEmirate } from "./einvoice";

const hasTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

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
  "crm_opportunities",
  "crm_activities",
  "follow_ups",
  "notifications",
  "tool_runs",
  "tool_jobs",
  "user_folders",
  "user_files",
  "user_assets",
];

// Local → cloud push list: app data only, in FK-safe order (parents before
// children). Cloud/system tables (profiles, organizations, notifications,
// tool_jobs…) are excluded — the cloud owns those.
const PUSH_TABLES = [
  "company_profile",
  "app_settings",
  "suppliers",
  "crm_customers",
  "products",
  "orders",
  "order_items",
  "invoice_docs",
  "invoice_doc_items",
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
  "crm_opportunities",
  "crm_activities",
  "follow_ups",
  "tool_runs",
  "user_folders",
  "user_files",
  "user_assets",
];

const FILES_BUCKET = "files";

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
  return changed;
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

export interface MigrateResult {
  table: string;
  rows: number;
  error?: string;
}

/** Push all local on-device data into the signed-in cloud account, so the web
 *  version shows the same data. Rows keep their local ids (FK relationships
 *  survive); user/org ownership is re-stamped by the cloud's defaults and
 *  triggers. To avoid id collisions, each table is only pushed when its cloud
 *  side is EMPTY — tables that already have cloud rows are skipped and
 *  reported. File bytes stored locally are uploaded to the files bucket. */
export async function migrateLocalToCloud(
  onProgress?: (msg: string) => void
): Promise<MigrateResult[]> {
  if (!supabase)
    throw new Error("Cloud isn't configured in this build — nowhere to push.");
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user?.id;
  if (!uid)
    throw new Error(
      "Sign in to your cloud account first: switch to Cloud mode, log in, then push."
    );

  const out: MigrateResult[] = [];
  const CHUNK = 200;

  for (const t of PUSH_TABLES) {
    const raw = await localGet("localdb:" + t);
    let rows: any[] = [];
    try {
      rows = raw ? JSON.parse(raw) : [];
    } catch {
      rows = [];
    }
    if (!Array.isArray(rows) || rows.length === 0) continue;

    onProgress?.(`Pushing ${t}…`);
    // Never merge into a table that already has cloud rows — pushed rows keep
    // their local ids, and colliding ids would corrupt FK relationships.
    const { count, error: ce } = await supabase
      .from(t)
      .select("id", { count: "exact", head: true });
    if (ce) {
      out.push({ table: t, rows: 0, error: ce.message });
      continue;
    }
    if ((count ?? 0) > 0) {
      out.push({ table: t, rows: 0, error: "skipped — cloud already has data" });
      continue;
    }

    const cleaned = rows.map((r) => {
      // Ownership is re-stamped by cloud defaults (user_id) and the
      // force_org_id trigger (org_id); "owner" columns need the real uid.
      const { user_id: _u, org_id: _o, ...rest } = r as Record<string, any>;
      if ("owner" in rest) rest.owner = uid;
      if (typeof rest.storage_path === "string")
        rest.storage_path = rest.storage_path.replace(/^local-user\//, `${uid}/`);
      return rest;
    });

    let pushed = 0;
    let err: string | undefined;
    for (let i = 0; i < cleaned.length; i += CHUNK) {
      const { error } = await supabase.from(t).insert(cleaned.slice(i, i + CHUNK));
      if (error) {
        err = error.message;
        break;
      }
      pushed += Math.min(CHUNK, cleaned.length - i);
    }
    out.push({ table: t, rows: pushed, error: err });
  }

  // Pushed rows kept their local ids — bump identity sequences past them so
  // the next normal insert doesn't collide.
  onProgress?.("Fixing id sequences…");
  try {
    await supabase.rpc("sync_bump_sequences");
  } catch {
    /* older cloud DBs without the fn: next insert may need a retry */
  }

  // Upload locally-stored file bytes so My Files works on the web too.
  const rawFiles = await localGet("localdb:user_files");
  let fileRows: { storage_path?: string }[] = [];
  try {
    fileRows = rawFiles ? JSON.parse(rawFiles) : [];
  } catch {
    fileRows = [];
  }
  if (fileRows.length) {
    onProgress?.(`Uploading ${fileRows.length} files…`);
    let ok = 0;
    for (const f of fileRows) {
      const localPath = f.storage_path;
      if (!localPath) continue;
      try {
        const blobRaw = await localGet("fileblob:" + localPath);
        if (!blobRaw) continue;
        const { mime, b64 } = JSON.parse(blobRaw) as { mime: string; b64: string };
        const cloudPath = localPath.replace(/^local-user\//, `${uid}/`);
        const { error } = await supabase.storage
          .from(FILES_BUCKET)
          .upload(cloudPath, new Blob([b64ToBytes(b64).slice()], { type: mime }), {
            contentType: mime,
            upsert: true,
          });
        if (!error) ok++;
      } catch {
        /* skip individual file failures */
      }
    }
    out.push({ table: "files (blobs)", rows: ok });
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

  const out: MigrateResult[] = [];
  let fileRows: { storage_path?: string }[] = [];

  for (const t of TABLES) {
    onProgress?.(`Copying ${t}…`);
    try {
      const { data, error } = await supabase.from(t).select("*");
      if (error) {
        out.push({ table: t, rows: 0, error: error.message });
        continue;
      }
      const rows = data ?? [];
      await localSet("localdb:" + t, JSON.stringify(rows));
      if (t === "user_files") fileRows = rows as { storage_path?: string }[];
      out.push({ table: t, rows: rows.length });
    } catch (e: any) {
      out.push({ table: t, rows: 0, error: e?.message ?? String(e) });
    }
  }

  // Pull file bytes for My Files so they open offline. Best-effort.
  if (fileRows.length) {
    onProgress?.(`Downloading ${fileRows.length} files…`);
    let ok = 0;
    for (const f of fileRows) {
      const path = f.storage_path;
      if (!path) continue;
      try {
        const { data, error } = await supabase.storage
          .from(FILES_BUCKET)
          .download(path);
        if (error || !data) continue;
        const bytes = new Uint8Array(await data.arrayBuffer());
        await localSet(
          "fileblob:" + path,
          JSON.stringify({ mime: data.type || "application/octet-stream", b64: bytesToB64(bytes) })
        );
        ok++;
      } catch {
        /* skip individual file failures */
      }
    }
    out.push({ table: "files (blobs)", rows: ok });
  }

  return out;
}
