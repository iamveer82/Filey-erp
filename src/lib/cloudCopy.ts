// Records stay on this device and follow to the Filey account in the background.
// Mixed mode (local mode plus "Keep a copy in my Filey account") is Pro or Freedom;
// cloud mode on the desktop keeps a download-only device copy the same way.
//
// Cloud load follows what changed, never the size of the books:
// - uploads send only rows changed here: 15 s after a money or master record is
//   saved (at most 20 s after the first unsent change), other edits within 2 min;
// - downloads ask the change feed (changeFeed.ts) for rows changed elsewhere: at
//   start, when the window comes back, when the cloud reports a change (cloud
//   mode) or every few minutes while the window is open (mixed mode). One tiny
//   request when nothing changed;
// - a complete id check only for a first copy, after a long gap, and weekly.
//
// A connected session alone never authorizes an upload (cloudTransfer.ts). The
// user's explicit "keep a copy" choice is stored with the account it was made
// for, and each pass mints a fresh scoped permit for that account only.

import { supabase } from "./supabase";
import { isLocalMode } from "./dataMode";
import { withCloudTransfer } from "./cloudTransfer";
import { journalSnapshot } from "./localdb";
import { isMigrating, resolveSyncConflicts, setMigrating, syncCycle, syncNow } from "./sync";
import { migrateCloudToLocal } from "./migrate";
import { localWorkspaceOwner } from "./localAuth";
import { cloudAccess, entitlement } from "./license";
import { completeCopyDue, pullChanges, reconcile } from "./changeFeed";
import { log } from "./log";

const KEY = "filey_cloud_copy";
export const CLOUD_COPY_EVENT = "filey:cloud-copy";

/** Money and master records upload soon after a save. */
const MAJOR = new Set([
  "company_profile", "crm_customers", "suppliers", "products", "accounts",
  "invoice_docs", "invoice_doc_items", "invoice_payments", "quotations", "quotation_items",
  "purchase_orders", "purchase_order_items", "po_payments", "payment_receipts",
  "expenses", "transactions", "advances", "stock_movements", "payroll",
]);
/** A bulk edit counts as major too. */
const MAJOR_PENDING = 25;
/** A major save waits this long for the rest of its burst (invoice, lines, payment)… */
export const MAJOR_UPLOAD_MS = 15_000;
/** …but never longer than this after the first unsent change. */
export const MAJOR_UPLOAD_MAX_MS = 20_000;
export const MINOR_UPLOAD_MS = 2 * 60_000;
export const MINOR_UPLOAD_MAX_MS = 5 * 60_000;
/** Mixed mode gets no push from the cloud; it asks this often while the window is open. */
export const DOWNLOAD_CHECK_MS = 3 * 60_000;
/** Coming back to the window asks again once the last check is this old. */
const RETURN_CHECK_MS = 60_000;
/** Cloud-mode change notices settle before the device copy asks for them. */
const NOTICE_SETTLE_MS = 15_000;
const NOTICE_MAX_MS = 20_000;

/** The account that agreed to keep a cloud copy of this device's records. */
export function cloudCopyOwner(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function setCloudCopy(uid: string | null): void {
  try { if (uid) localStorage.setItem(KEY, uid); else localStorage.removeItem(KEY); } catch { /* stays off */ }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CLOUD_COPY_EVENT));
}

/** Pro (live subscription), Freedom (licence on this device) or an Freedom owner's workspace. */
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

const offline = () => typeof navigator !== "undefined" && !navigator.onLine;

/** Mixed mode: sends the rows changed on this device, and nothing else. */
export async function uploadChanges(): Promise<boolean> {
  if (!supabase || !isLocalMode() || isMigrating() || offline()) return false;
  if (!Object.keys((await journalSnapshot()).tables).length) return true;
  const uid = await consentedUid();
  if (!uid || !(await cloudCopyAllowed())) return false;
  const client = supabase;
  return withCloudTransfer(client, uid, transfer => syncNow(client, { transfer }));
}

/** Mixed mode: brings in rows changed on the account's other devices. `complete`
 *  forces the complete check (turning the copy on uploads everything once). */
export async function downloadChanges(complete = false): Promise<boolean> {
  if (!supabase || !isLocalMode() || isMigrating() || offline()) return false;
  const uid = await consentedUid();
  if (!uid || !(await cloudCopyAllowed())) return false;
  const client = supabase;
  return withCloudTransfer(client, uid, async transfer => {
    const result = complete || completeCopyDue(uid) ? { status: "reconcile" as const } : await pullChanges(client, uid, { keepUnsent: true });
    if (result.status === "busy") return false;
    if (result.status === "applied") {
      if (result.tables.length) window.dispatchEvent(new CustomEvent("filey:remote-update", { detail: { tables: result.tables } }));
      return true;
    }
    return reconcile(client, uid, () => syncCycle(client, { transfer }));
  });
}

/** "Sync now": this device's changes up, the account's changes down. */
export async function runCloudCopy(complete = false): Promise<boolean> {
  const sent = await uploadChanges();
  return (await downloadChanges(complete)) && sent;
}

export async function resolveCloudCopyConflicts(keepLocal: boolean): Promise<boolean> {
  const uid = await consentedUid();
  if (!supabase || !uid) throw new Error("Turn on the cloud copy first.");
  const client = supabase;
  return withCloudTransfer(client, uid, transfer => resolveSyncConflicts(keepLocal, client, { transfer }));
}

/** Cloud mode on the desktop: keep this computer's copy of the account's records
 *  current, so turning cloud storage off (or losing the connection) continues
 *  from today's records. Download only. */
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
  if (!("__TAURI_INTERNALS__" in window) || !supabase || isLocalMode() || isMigrating() || offline()) return false;
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user.id;
  // Only books this computer already keeps for this account: a shared computer
  // is never claimed by whoever signs in to the cloud on it.
  if (!uid || localWorkspaceOwner() !== uid) return false;
  // Unsent device edits would be replaced; the cloud switch uploads them first.
  if (Object.keys((await journalSnapshot()).tables).length) return false;
  const client = supabase;
  setMigrating(true);
  try {
    const result = completeCopyDue(uid) ? { status: "reconcile" as const } : await pullChanges(client, uid, { keepUnsent: false });
    const ok = result.status === "applied"
      || (result.status === "reconcile" && await reconcile(client, uid, async () => !(await migrateCloudToLocal()).some(r => r.error)));
    if (!ok) return false;
    try { localStorage.setItem(DEVICE_COPY_AT, new Date().toISOString()); } catch { /* shown as unknown */ }
    window.dispatchEvent(new Event(DEVICE_COPY_EVENT));
    return true;
  } finally {
    setMigrating(false);
  }
}

/** True when the unsent changes are money or master records, or a bulk edit. */
export function isMajorChange(tables: Record<string, { changed: unknown[]; deleted: unknown[]; all?: boolean }>): boolean {
  let pending = 0;
  for (const [table, entry] of Object.entries(tables)) {
    if (entry.all || MAJOR.has(table)) return true;
    pending += entry.changed.length + entry.deleted.length;
  }
  return pending >= MAJOR_PENDING;
}

/** When the unsent changes should upload: `now` plus the quiet wait, capped from the first unsent change. */
export function uploadDelay(major: boolean, now: number, firstUnsentAt: number): number {
  const wait = major ? MAJOR_UPLOAD_MS : MINOR_UPLOAD_MS;
  const cap = major ? MAJOR_UPLOAD_MAX_MS : MINOR_UPLOAD_MAX_MS;
  return Math.max(0, Math.min(now + wait, firstUnsentAt + cap) - now);
}

/** Schedules uploads and downloads for the life of the app. Every pass no-ops
 *  unless this device is online, in the right mode and (mixed mode) signed in
 *  as the consenting paid account. ponytail: one upload and one download at a
 *  time; a save during an upload queues one more. */
export function startCloudCopy(): () => void {
  if (typeof window === "undefined") return () => {};
  const desktop = "__TAURI_INTERNALS__" in window;
  const warn = (what: string) => (error: unknown) =>
    log.warn("sync", what, error instanceof Error ? error.message : String(error));

  let uploading = false;
  let uploadAgain = false;
  let uploadTimer: ReturnType<typeof setTimeout> | undefined;
  let firstUnsentAt = 0;
  const upload = () => {
    uploadTimer = undefined;
    firstUnsentAt = 0;
    if (uploading) { uploadAgain = true; return; }
    uploading = true;
    void uploadChanges().catch(warn("cloud copy upload failed")).finally(() => {
      uploading = false;
      if (uploadAgain) { uploadAgain = false; scheduleUpload(); }
    });
  };
  const scheduleUpload = () => {
    if (!isLocalMode() || !cloudCopyOwner()) return;
    void journalSnapshot().then(j => {
      if (!Object.keys(j.tables).length) return;
      const now = Date.now();
      firstUnsentAt ||= now;
      clearTimeout(uploadTimer);
      uploadTimer = setTimeout(upload, uploadDelay(isMajorChange(j.tables), now, firstUnsentAt));
    }).catch(() => {});
  };

  let downloading = false;
  let lastCheck = 0;
  const download = (complete = false) => {
    if (downloading) return;
    const work = isLocalMode()
      ? cloudCopyOwner() ? downloadChanges(complete) : undefined
      : desktop ? runDeviceCopy() : undefined;
    if (!work) return;
    downloading = true;
    lastCheck = Date.now();
    void work.catch(warn("cloud copy download failed")).finally(() => { downloading = false; });
  };
  // A minimised app polling 24/7 is what exhausted the free egress in July.
  const returned = () => { if (!document.hidden && Date.now() - lastCheck > RETURN_CHECK_MS) download(); };
  const timer = setInterval(() => { if (isLocalMode() && !document.hidden) download(); }, DOWNLOAD_CHECK_MS);

  // Cloud mode: Realtime already reports changes for the open pages; let them settle.
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let firstNoticeAt = 0;
  const notice = () => {
    if (isLocalMode() || !desktop) return;
    const now = Date.now();
    firstNoticeAt ||= now;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { firstNoticeAt = 0; download(); },
      Math.max(0, Math.min(now + NOTICE_SETTLE_MS, firstNoticeAt + NOTICE_MAX_MS) - now));
  };
  const consent = () => download(true);
  const reconnected = () => { scheduleUpload(); download(); };
  const boot = setTimeout(() => { scheduleUpload(); download(); }, 10_000);

  window.addEventListener("filey:local-write", scheduleUpload);
  window.addEventListener("online", reconnected);
  window.addEventListener(CLOUD_COPY_EVENT, consent);
  window.addEventListener("filey:cloud-change", notice);
  window.addEventListener("focus", returned);
  document.addEventListener("visibilitychange", returned);
  return () => {
    clearTimeout(boot);
    clearTimeout(uploadTimer);
    clearTimeout(noticeTimer);
    clearInterval(timer);
    window.removeEventListener("filey:local-write", scheduleUpload);
    window.removeEventListener("online", reconnected);
    window.removeEventListener(CLOUD_COPY_EVENT, consent);
    window.removeEventListener("filey:cloud-change", notice);
    window.removeEventListener("focus", returned);
    document.removeEventListener("visibilitychange", returned);
  };
}
