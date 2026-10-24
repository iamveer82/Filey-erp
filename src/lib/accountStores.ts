/* Several accounts on one computer, each with its own local books.
 *
 * A device workspace still has exactly one owner, and every guard that checks it stays
 * (assertLocalAccount, the sync and transfer checks). What changes is that signing in with
 * a different account no longer refuses: it switches to that account's own store. On the
 * desktop the device's first owner keeps the existing data folder and anyone else gets
 * their own folder (storage.rs open_account_store); nothing is copied between them.
 *
 * The account's identity and a few device-local records live in browser storage under
 * fixed keys, so those keys move with the store: put aside for the account leaving, put
 * back for the account arriving. Cloud mode is untouched. */
import { invoke } from "@tauri-apps/api/core";
import { getLocalCredential, localWorkspaceOwner } from "./localAuth";
import { clearLocalCache } from "./localdb";

const hasTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const REGISTRY = "filey_account_stores";

/** Browser-storage keys that belong to one account's device workspace. */
export const ACCOUNT_KEYS = [
  "filey_local_credential",
  "filey_local_session",
  "filey_local_workspace_owner",
  "filey_local_profile",
  "filey_cloud_seeded",
  "filey_cloud_workspace",
  "filey_auto_sync",
  "filey_cloud_copy",
  "filey_device_copy_at",
  "filey_bank_accounts",
  "filey_cheques",
  "filey_delivery_challans",
  "filey_email_templates",
  "filey_zernio_config",
  "filey_reach_config",
] as const;

interface Registry {
  /** The device's first owner: their books stay in the original data folder. */
  primary?: string;
  /** Keys put aside for accounts that are not open now. */
  saved: Record<string, Record<string, string>>;
}

function readRegistry(): Registry {
  try {
    const raw = JSON.parse(localStorage.getItem(REGISTRY) || "{}");
    const saved = raw?.saved && typeof raw.saved === "object" && !Array.isArray(raw.saved) ? raw.saved : {};
    return { primary: typeof raw?.primary === "string" ? raw.primary : undefined, saved };
  } catch {
    return { saved: {} };
  }
}

function writeRegistry(registry: Registry): void {
  localStorage.setItem(REGISTRY, JSON.stringify(registry));
}

function takeKeys(): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const key of ACCOUNT_KEYS) {
    const value = localStorage.getItem(key);
    if (value !== null) kept[key] = value;
  }
  return kept;
}

function putKeys(values: Record<string, string> | undefined): void {
  for (const key of ACCOUNT_KEYS) localStorage.removeItem(key);
  for (const [key, value] of Object.entries(values ?? {}))
    if ((ACCOUNT_KEYS as readonly string[]).includes(key)) localStorage.setItem(key, value);
}

/** Whether this build keeps a separate store per account (the desktop app). */
export const separateAccountStores = (): boolean => hasTauri;

/**
 * Open `userId`'s own books when the device workspace belongs to someone else.
 * Returns false when nothing had to change (same owner, an unclaimed device, or a build
 * without per-account stores). After a true, the caller finishes signing in and reloads,
 * so nothing loaded for the previous account stays in memory.
 */
export async function switchAccountStore(userId: string): Promise<boolean> {
  const current = localWorkspaceOwner();
  if (!separateAccountStores() || !current || current === userId) return false;
  const registry = readRegistry();
  registry.primary ??= current;
  // Put the leaving account aside first: if anything below fails, startup reconciles.
  registry.saved[current] = takeKeys();
  writeRegistry(registry);
  await invoke("open_account_store", { userId, primary: userId === registry.primary });
  clearLocalCache();
  putKeys(registry.saved[userId]);
  delete registry.saved[userId];
  writeRegistry(registry);
  return true;
}

/** The stored account that signed in on this computer with `email`, when it is not open now. */
export function storedAccountFor(email: string): string | null {
  const wanted = email.trim().toLowerCase();
  if (!wanted) return null;
  for (const [userId, keys] of Object.entries(readRegistry().saved)) {
    try {
      const credential = JSON.parse(keys.filey_local_credential || "null");
      if (credential?.email === wanted && credential?.userId === userId) return userId;
    } catch {
      /* an unreadable credential is not a match */
    }
  }
  return null;
}

/**
 * Before the app renders: make the browser-storage keys match the store the desktop
 * opened. A switch interrupted between opening the store and moving the keys would
 * otherwise show one account's identity over another account's books.
 */
export async function reconcileAccountStore(): Promise<void> {
  if (!separateAccountStores()) return;
  const registry = readRegistry();
  if (!registry.primary) return;
  const open = (await invoke<string>("active_account_store")) || registry.primary;
  const owner = localWorkspaceOwner() ?? getLocalCredential()?.userId ?? null;
  if (owner === open) return;
  if (owner) registry.saved[owner] = takeKeys();
  putKeys(registry.saved[open]);
  delete registry.saved[open];
  writeRegistry(registry);
}
