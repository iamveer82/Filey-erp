// Mixed mode: records stay on this device (works offline) and a copy follows to
// the owner's Filey account in the background. Paid feature (Pro or Ultra).
//
// A connected session alone never authorizes an upload (cloudTransfer.ts). The
// user's explicit "keep a copy" choice is stored with the account it was made
// for, and each pass mints a fresh scoped permit for that account only.

import { supabase } from "./supabase";
import { isLocalMode } from "./dataMode";
import { withCloudTransfer } from "./cloudTransfer";
import { journalSnapshot } from "./localdb";
import { isMigrating, resolveSyncConflicts, setMigrating, syncCycle } from "./sync";
import { migrateCloudToLocal } from "./migrate";
import { localWorkspaceOwner } from "./localAuth";
import { cloudAccess, entitlement } from "./license";
import { log } from "./log";

const KEY = "filey_cloud_copy";
export const CLOUD_COPY_EVENT = "filey:cloud-copy";

/** Full pass: uploads pending changes and downloads other devices' changes. */
export const CLOUD_COPY_INTERVAL_MS = 5 * 60_000;
/** Money and master records upload seconds after a save, not at the next pass. */
const MAJOR = new Set([
  "company_profile", "crm_customers", "suppliers", "products", "accounts",
  "invoice_docs", "invoice_doc_items", "invoice_payments", "quotations", "quotation_items",
  "purchase_orders", "purchase_order_items", "po_payments", "payment_receipts",
  "expenses", "transactions", "advances", "stock_movements", "payroll",
]);
/** A bulk edit uploads at once too. */
const MAJOR_PENDING = 25;
/** Coalesce a burst (invoice header + lines + payment) into one upload. */
const SAVE_DEBOUNCE_MS = 3000;

/** The account that agreed to keep a cloud copy of this device's records. */
export function cloudCopyOwner(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function setCloudCopy(uid: string | null): void {
  try { if (uid) localStorage.setItem(KEY, uid); else localStorage.removeItem(KEY); } catch { /* stays off */ }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CLOUD_COPY_EVENT));
}

/** Pro (live subscription), Ultra (licence on this device) or an Ultra owner's workspace. */
export async function cloudCopyAllowed(): Promise<boolean> {
  try {
    return (await entitlement()) !== "free" || (await cloudAccess()).reason === "paid";
  } catch {
    return false;
  }
}

async function consentedUid(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user.id;
  return uid && uid === cloudCopyOwner() ? uid : null;
}

/** One background pass. Only records changed since the last pass are sent, in
 *  small batches; downloads fetch only rows whose revision moved. */
export async function runCloudCopy(full: boolean): Promise<boolean> {
  if (!supabase || !isLocalMode() || isMigrating()) return false;
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;
  if (!full && !Object.keys((await journalSnapshot()).tables).length) return true;
  const uid = await consentedUid();
  if (!uid || !(await cloudCopyAllowed())) return false;
  const client = supabase;
  return withCloudTransfer(client, uid, transfer => syncCycle(client, { changesOnly: !full, transfer }));
}

export async function resolveCloudCopyConflicts(keepLocal: boolean): Promise<boolean> {
  const uid = await consentedUid();
  if (!supabase || !uid) throw new Error("Turn on the cloud copy first.");
  const client = supabase;
  return withCloudTransfer(client, uid, transfer => resolveSyncConflicts(keepLocal, client, { transfer }));
}

/** Cloud mode on the desktop: keep this computer's copy of the account's records
 *  current, so turning cloud storage off (or losing the connection) starts from
 *  today's records, not the day cloud was turned on. Download only; unchanged
 *  rows and files already on disk are not fetched again. */
export function runDeviceCopy(): Promise<boolean> {
  deviceCopy ??= copyToDevice().finally(() => { deviceCopy = undefined; });
  return deviceCopy;
}

let deviceCopy: Promise<boolean> | undefined;
const DEVICE_COPY_AT = "filey_device_copy_at";
export const DEVICE_COPY_EVENT = "filey:device-copy";

/** When this computer last brought its copy of the account's records up to date. */
export function deviceCopyAt(): string | null {
  try { return localStorage.getItem(DEVICE_COPY_AT); } catch { return null; }
}

/** The background copy in progress, if any: the storage switch finishes it instead of refusing to start. */
export function deviceCopyInFlight(): Promise<unknown> | undefined {
  return deviceCopy?.catch(() => false);
}

async function copyToDevice(): Promise<boolean> {
  if (!("__TAURI_INTERNALS__" in window) || !supabase || isLocalMode() || isMigrating()) return false;
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user.id;
  // Only books this computer already keeps for this account: a shared computer
  // is never claimed by whoever signs in to the cloud on it.
  if (!uid || localWorkspaceOwner() !== uid) return false;
  // Unsent device edits would be replaced; the cloud switch uploads them first.
  if (Object.keys((await journalSnapshot()).tables).length) return false;
  setMigrating(true);
  try {
    if ((await migrateCloudToLocal()).some(r => r.error)) return false;
    try { localStorage.setItem(DEVICE_COPY_AT, new Date().toISOString()); } catch { /* shown as unknown */ }
    window.dispatchEvent(new Event(DEVICE_COPY_EVENT));
    return true;
  } finally {
    setMigrating(false);
  }
}

/** Cloud saves settle into the device copy this long after the last one. */
const DEVICE_COPY_SETTLE_MS = 20_000;
const DEVICE_COPY_INTERVAL_MS = 30 * 60_000;

/** True when the pending changes should not wait for the next 5-minute pass. */
export function isMajorChange(tables: Record<string, { changed: unknown[]; deleted: unknown[]; all?: boolean }>): boolean {
  let pending = 0;
  for (const [table, entry] of Object.entries(tables)) {
    if (entry.all || MAJOR.has(table)) return true;
    pending += entry.changed.length + entry.deleted.length;
  }
  return pending >= MAJOR_PENDING;
}

/** Schedules passes for the life of the app; every pass no-ops unless this
 *  device is in local mode, online, signed in as the consenting paid account.
 *  ponytail: one global pass at a time; a save during a pass queues one more. */
export function startCloudCopy(): () => void {
  if (typeof window === "undefined") return () => {};
  let busy = false;
  let queued: boolean | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const run = (full: boolean) => {
    if (busy) { queued = queued || full; return; }
    busy = true;
    void runCloudCopy(full)
      .catch(error => log.warn("sync", "cloud copy pass failed", error instanceof Error ? error.message : String(error)))
      .finally(() => {
        busy = false;
        const next = queued;
        queued = null;
        if (next !== null) run(next);
      });
  };
  const onSave = () => {
    if (!cloudCopyOwner()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void journalSnapshot().then(j => { if (isMajorChange(j.tables)) run(false); }).catch(() => {});
    }, SAVE_DEBOUNCE_MS);
  };
  // A hidden window still uploads its own saves, but skips the download check:
  // a minimised app polling 24/7 is what exhausted the free egress in July.
  const tick = () => { if (cloudCopyOwner()) run(!document.hidden); };
  const full = () => { if (cloudCopyOwner()) run(true); };
  const interval = setInterval(tick, CLOUD_COPY_INTERVAL_MS);
  const boot = setTimeout(full, 10_000);
  window.addEventListener("filey:local-write", onSave);
  window.addEventListener("online", full);
  window.addEventListener(CLOUD_COPY_EVENT, full);

  // Same hidden-window rule for the device copy in cloud mode.
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  const deviceCopy = (delay: number) => {
    if (!("__TAURI_INTERNALS__" in window) || isLocalMode()) return;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      if (!document.hidden) void runDeviceCopy()
        .catch(error => log.warn("sync", "device copy failed", error instanceof Error ? error.message : String(error)));
    }, delay);
  };
  const settled = () => deviceCopy(DEVICE_COPY_SETTLE_MS);
  const copyInterval = setInterval(() => deviceCopy(0), DEVICE_COPY_INTERVAL_MS);
  deviceCopy(15_000);
  window.addEventListener("filey:cloud-change", settled);
  return () => {
    clearInterval(interval);
    clearInterval(copyInterval);
    clearTimeout(boot);
    clearTimeout(saveTimer);
    clearTimeout(copyTimer);
    window.removeEventListener("filey:local-write", onSave);
    window.removeEventListener("online", full);
    window.removeEventListener(CLOUD_COPY_EVENT, full);
    window.removeEventListener("filey:cloud-change", settled);
  };
}
