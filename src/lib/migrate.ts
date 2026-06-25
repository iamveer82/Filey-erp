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
  "products",
  "orders",
  "order_items",
  "invoice_docs",
  "invoice_doc_items",
  "invoice_payments",
  "invoice_recurrence",
  "quotations",
  "quotation_items",
  "purchase_orders",
  "purchase_order_items",
  "po_payments",
  "payment_receipts",
  "accounts",
  "transactions",
  "crm_leads",
  "crm_activities",
  "follow_ups",
  "notifications",
  "tool_runs",
  "tool_jobs",
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

export interface MigrateResult {
  table: string;
  rows: number;
  error?: string;
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
