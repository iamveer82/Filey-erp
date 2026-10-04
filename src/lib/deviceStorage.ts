import { invoke } from "@tauri-apps/api/core";
import { Preferences } from "@capacitor/preferences";
import { isNativeApp } from "./nativePlatform";
import { localWorkspaceOwner } from "./localAuth";
import { isLocalMode } from "./dataMode";
import { PUSH_SET } from "./syncTables";

const hasTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const transactionalDeviceStorage = hasTauri || isNativeApp();
let database: Promise<IDBDatabase> | undefined;
let browserDatabase: Promise<IDBDatabase> | undefined;
const OWNER_KEY = "filey_local_workspace_owner";
const DURABLE_OWNER_KEY = "filey:device-owner";
const workspaceKey = (key: string) => typeof key === "string" && (key.startsWith("localdb:") || key.startsWith("fileblob:") || key === "syncjournal");
const BROWSER_BACKEND_KEY = "filey:browser-backend";
const BROWSER_BACKEND = "indexeddb-v1";
const browserManagedKey = (key: string) => workspaceKey(key) || key.startsWith("cache:") || key.startsWith("business-workflow:") || key === "outbox";
const browserBooksKey = (key: string) => key.startsWith("fileblob:") || (key.startsWith("localdb:") && PUSH_SET.has(key.slice(8)));
const bookValue = (key: string, value: unknown) => browserBooksKey(key) && value !== undefined && value !== null && value !== "" && value !== "[]" && value !== "null";
class BrowserOwnershipError extends Error {
  constructor() { super("The original owner of these browser records could not be verified. Your records were not changed."); }
}
const unknownBrowserOwner = () => new BrowserOwnershipError();

/** Only callers already holding filey:local-data may bypass its Web Lock. */
type DeviceWriteOptions = { lockHeld?: boolean };

function hostedDatabase(): Promise<IDBDatabase> {
  if (!browserDatabase) browserDatabase = new Promise<IDBDatabase>((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open("filey-browser-device", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("values");
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => { request.result.close(); browserDatabase = undefined; };
      resolve(request.result);
    };
    request.onerror = () => { browserDatabase = undefined; reject(request.error); };
    request.onblocked = () => { blocked = true; browserDatabase = undefined; reject(new Error("Close the other Filey window and retry browser storage.")); };
  });
  return browserDatabase;
}

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED");
}

function browserRecoveryError(cause: unknown): Error {
  const error = new Error("Browser storage could not be expanded. Your previous records are preserved.");
  Object.defineProperty(error, "cause", { value: cause });
  return error;
}

/** Keep the old browser backend until its first quota failure. Roll back every
 * changed key before propagating errors or starting the overflow migration. */
function writeBrowserLegacy(entries: readonly (readonly [string, string | null])[]): void {
  const previous = new Map(entries.map(([key]) => [key, localStorage.getItem(key)]));
  try {
    for (const [key, value] of entries) {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
  } catch (error) {
    try {
      const changed = [...previous].filter(([key, value]) => localStorage.getItem(key) !== value);
      // Free all staged increases first; the complete original snapshot fits.
      for (const [key] of changed) localStorage.removeItem(key);
      for (const [key, value] of changed) if (value !== null) localStorage.setItem(key, value);
    } catch {
      throw new Error("Browser storage could not restore the interrupted save. Reopen Filey before retrying.");
    }
    throw error;
  }
}

function browserWriteLock<T>(run: () => Promise<T>, options?: DeviceWriteOptions): Promise<T> {
  return !options?.lockHeld && typeof navigator !== "undefined" && navigator.locks
    ? navigator.locks.request("filey:local-data", run)
    : run();
}

function inspectBrowserBooks(store: IDBObjectStore, done: (present: boolean) => void, fail: (error: unknown) => void): void {
  const request = store.openCursor();
  request.onsuccess = () => {
    try {
      const cursor = request.result;
      if (!cursor) done(false);
      else if (bookValue(String(cursor.key), cursor.value)) done(true);
      else cursor.continue();
    } catch (error) { fail(error); }
  };
}

async function readBrowserValue(key: string): Promise<string | null> {
  if (typeof indexedDB === "undefined") return localStorage.getItem(key);
  const db = await hostedDatabase();
  return new Promise<string | null>((resolve, reject) => {
    const tx = db.transaction("values", "readonly");
    const store = tx.objectStore("values");
    let result: string | null = null;
    const backend = store.get(BROWSER_BACKEND_KEY);
    backend.onsuccess = () => {
      try {
        if (backend.result === undefined) result = localStorage.getItem(key);
        else if (backend.result === BROWSER_BACKEND) {
          let savedOwner: unknown;
          const protect = isLocalMode() && workspaceKey(key);
          if (protect) {
            const owner = store.get(DURABLE_OWNER_KEY);
            owner.onsuccess = () => { savedOwner = owner.result; };
          }
          const request = store.get(key);
          request.onsuccess = () => {
            try {
              // Managed keys never fall back after migration, including deletions.
              result = request.result === undefined
                ? (browserManagedKey(key) ? null : localStorage.getItem(key))
                : request.result;
              if (protect) {
                if (savedOwner === null) throw unknownBrowserOwner();
                if (savedOwner !== undefined) checkOwner(savedOwner);
                else if (bookValue(key, result)) throw unknownBrowserOwner();
              }
            } catch (error) { tx.abort(); reject(error); }
          };
        } else throw new Error("Browser storage could not be read. Your saved records were not changed.");
      } catch (error) { tx.abort(); reject(error); }
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error ?? new Error("Browser storage could not be read. Your saved records were not changed."));
  });
}

/** The marker, migrated snapshot, pending writes and CAS read set share one
 * IndexedDB transaction. No await separates the legacy comparison/snapshot.
 * Every browser writer cooperates with localdb's existing cross-tab Web Lock. */
async function commitBrowserValues(
  entries: readonly (readonly [string, string | null])[],
  expected?: readonly (readonly [string, string | null])[],
): Promise<boolean> {
  if (typeof indexedDB === "undefined") {
    if (expected?.some(([key, value]) => localStorage.getItem(key) !== value)) return false;
    try { writeBrowserLegacy(entries); }
    catch (error) {
      if (isQuotaError(error)) throw new Error("Browser storage is full and IndexedDB is unavailable. Your previous records are preserved.");
      throw error;
    }
    return true;
  }
  const db = await hostedDatabase();
  return new Promise<boolean>((resolve, reject) => {
    const tx = db.transaction("values", "readwrite");
    const store = tx.objectStore("values");
    let matches = true, migrating = false, unownedBooks = false;
    let legacy: Map<string, string | null> | undefined;
    let ownerToSave: string | undefined;
    const save = () => {
      if (ownerToSave) store.put(ownerToSave, DURABLE_OWNER_KEY);
      for (const [key, value] of entries) store.put(value, key);
    };
    const backend = store.get(BROWSER_BACKEND_KEY);
    backend.onsuccess = () => {
      try {
        if (backend.result === BROWSER_BACKEND) {
          const publish = () => {
            let remaining = expected?.length ?? 0;
            if (!remaining) save();
            for (const [key, value] of expected ?? []) {
              const request = store.get(key);
              request.onsuccess = () => {
                try {
                  if ((request.result === undefined ? null : request.result) !== value) matches = false;
                  if (--remaining === 0 && matches) save();
                } catch (error) { tx.abort(); reject(error); }
              };
            }
          };
          const creatingBooks = entries.some(([key, value]) => bookValue(key, value));
          const protect = isLocalMode() && [...entries, ...(expected ?? [])].some(([key]) => workspaceKey(key));
          if (protect || creatingBooks) {
            const owner = store.get(DURABLE_OWNER_KEY);
            owner.onsuccess = () => {
              try {
                if (owner.result !== undefined) {
                  if (typeof owner.result !== "string" || !owner.result) throw unknownBrowserOwner();
                  if (protect) checkOwner(owner.result);
                  publish();
                } else inspectBrowserBooks(store, present => {
                  if (present) throw unknownBrowserOwner();
                  if (creatingBooks) ownerToSave = checkOwner(undefined);
                  publish();
                }, error => { tx.abort(); reject(error); });
              } catch (error) { tx.abort(); reject(error); }
            };
          } else publish();
          return;
        }
        if (backend.result !== undefined) throw new Error("Browser storage could not be read. Your saved records were not changed.");
        if (expected?.some(([key, value]) => localStorage.getItem(key) !== value)) { matches = false; return; }
        try { writeBrowserLegacy(entries); }
        catch (error) {
          if (!isQuotaError(error)) throw error;
          migrating = true;
          legacy = new Map();
          for (let index = 0; index < localStorage.length; index++) {
            const key = localStorage.key(index);
            if (key !== null && browserManagedKey(key)) legacy.set(key, localStorage.getItem(key));
          }
          // Include caller-owned keys even if a future caller adds a new prefix.
          for (const [key] of entries) if (!legacy.has(key)) legacy.set(key, localStorage.getItem(key));
          // Cloud workflow bookkeeping is not proof of an owned local book.
          const owner = localWorkspaceOwner();
          unownedBooks = !owner && [...legacy].some(([key, value]) => bookValue(key, value));
          if (!owner && !unownedBooks && entries.some(([key, value]) => bookValue(key, value))) throw unknownBrowserOwner();
          for (const [key, value] of legacy) store.put(value, key);
          // Pin unknown ownership along with the unchanged books. A later
          // sign-in must not turn those old records into that account's books.
          if (unownedBooks) store.put(null, DURABLE_OWNER_KEY);
          else save();
          if (owner) store.put(owner, DURABLE_OWNER_KEY);
          store.put(BROWSER_BACKEND, BROWSER_BACKEND_KEY);
        }
      } catch (error) { tx.abort(); reject(migrating && !(error instanceof BrowserOwnershipError) ? browserRecoveryError(error) : error); }
    };
    tx.oncomplete = () => {
      // Only remove the exact committed legacy snapshot. IDB is authoritative
      // even if browser settings block cleanup or another old tab rewrites it.
      if (legacy) for (const [key, value] of legacy) {
        try { if (localStorage.getItem(key) === value) localStorage.removeItem(key); } catch { /* committed copy remains authoritative */ }
      }
      if (unownedBooks) reject(unknownBrowserOwner());
      else resolve(matches);
    };
    tx.onabort = () => reject(migrating
      ? browserRecoveryError(tx.error)
      : (tx.error ?? new Error("Browser storage could not save your changes. Your previous records are preserved.")));
  });
}

function checkOwner(saved: unknown): string {
  const current = localWorkspaceOwner();
  if (saved !== undefined && (typeof saved !== "string" || !saved)) throw new Error("Device ownership could not be read. Your records were not changed.");
  if (saved && current && saved !== current) throw new Error("Sign in with this device workspace's original account.");
  const owner = typeof saved === "string" ? saved : current;
  if (!owner) throw new Error("Sign in to the device workspace before opening its records.");
  if (!current) localStorage.setItem(OWNER_KEY, owner);
  return owner;
}

/** Restore the original local owner before rendering native or migrated web books. */
export async function restoreNativeOwnership(): Promise<void> {
  if (hasTauri) return;
  if (isNativeApp()) {
    const saved = await readDeviceValue(DURABLE_OWNER_KEY);
    if (saved !== null) checkOwner(saved);
    return;
  }
  if (typeof indexedDB === "undefined") return;
  const db = await hostedDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("values", "readonly"), store = tx.objectStore("values");
    const fail = (error: unknown) => { tx.abort(); reject(error); };
    const backend = store.get(BROWSER_BACKEND_KEY);
    backend.onsuccess = () => {
      try {
        if (backend.result === undefined) return;
        if (backend.result !== BROWSER_BACKEND) throw new Error("Browser storage could not be read. Your saved records were not changed.");
        const owner = store.get(DURABLE_OWNER_KEY);
        owner.onsuccess = () => {
          try {
            if (owner.result === undefined) {
              if (isLocalMode()) inspectBrowserBooks(store, present => { if (present) throw unknownBrowserOwner(); }, fail);
            } else if (owner.result === null) {
              if (isLocalMode()) throw unknownBrowserOwner();
            } else if (isLocalMode()) checkOwner(owner.result);
            else {
              if (typeof owner.result !== "string" || !owner.result) throw unknownBrowserOwner();
              // The cloud account may differ; its local books keep their owner.
              if (localStorage.getItem(OWNER_KEY) !== owner.result) localStorage.setItem(OWNER_KEY, owner.result);
            }
          } catch (error) { fail(error); }
        };
      } catch (error) { fail(error); }
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("Browser ownership could not be restored. Your records were not changed."));
  });
}

function mobileDatabase(): Promise<IDBDatabase> {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("filey-device", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("values");
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); database = undefined; };
      resolve(request.result);
    };
    request.onerror = () => { database = undefined; reject(request.error); };
    request.onblocked = () => { database = undefined; reject(new Error("Close the other Filey window and retry.")); };
  });
  return database;
}

export async function readDeviceValue(key: string): Promise<string | null> {
  if (hasTauri) return invoke<string | null>("cache_get", { key });
  if (!isNativeApp()) return readBrowserValue(key);
  const db = await mobileDatabase();
  const legacy = localStorage.getItem(key);
  let migrated = false;
  const value = await new Promise<string | null>((resolve, reject) => {
    // Migration checks and copies inside one transaction, so a newer write wins.
    const tx = db.transaction("values", "readwrite");
    const store = tx.objectStore("values");
    let savedOwner: unknown;
    if (workspaceKey(key)) {
      const ownership = store.get(DURABLE_OWNER_KEY);
      ownership.onsuccess = () => { savedOwner = ownership.result; };
    }
    const request = store.get(key);
    let result: string | null = null;
    request.onsuccess = () => {
      try {
        result = request.result === undefined ? legacy : request.result;
        // Empty stores may be inspected before first sign-in; existing books may not.
        if (workspaceKey(key) && (savedOwner !== undefined || result !== null)) {
          const owner = checkOwner(savedOwner);
          if (savedOwner === undefined) store.put(owner, DURABLE_OWNER_KEY);
        }
        if (request.result === undefined && legacy !== null) {
          store.put(legacy, key);
          migrated = true;
        }
      } catch (error) { tx.abort(); reject(error); }
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error ?? new Error("Could not read device storage."));
  });
  if (migrated) { try { localStorage.removeItem(key); } catch { /* committed copy is authoritative */ } }
  return value;
}

export async function writeDeviceValues(entries: readonly (readonly [string, string | null])[], options?: DeviceWriteOptions): Promise<void> {
  if (hasTauri) {
    await invoke("cache_set_many", { entries: entries.map(([key, value]) => [key, value ?? ""]) });
    return;
  }
  if (isNativeApp()) {
    const db = await mobileDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("values", "readwrite");
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error("Could not save device storage. Your previous records are preserved."));
      try {
        const store = tx.objectStore("values");
        const save = () => {
          for (const [key, value] of entries) store.put(value, key);
        };
        if (entries.some(([key]) => workspaceKey(key))) {
          const ownership = store.get(DURABLE_OWNER_KEY);
          ownership.onsuccess = () => {
            try { store.put(checkOwner(ownership.result), DURABLE_OWNER_KEY); save(); }
            catch (error) { tx.abort(); reject(error); }
          };
        } else save();
      } catch (error) { tx.abort(); reject(error); }
    });
    // Stop deleted or overwritten legacy keys being resurrected on a later read.
    for (const [key] of entries) {
      try { localStorage.removeItem(key); } catch { /* committed store is authoritative */ }
    }
    return;
  }
  await browserWriteLock(() => commitBrowserValues(entries), options);
}

export async function writeDeviceValue(key: string, value: string | null, options?: DeviceWriteOptions): Promise<void> {
  if (hasTauri) await invoke("cache_set", { key, value: value ?? "" });
  else if (isNativeApp()) await writeDeviceValues([[key, value]]);
  else await writeDeviceValues([[key, value]], options);
}

/** Compare the entire read set and publish all writes in one storage transaction.
 * A false result means another window/process committed first; nothing is saved. */
export async function compareDeviceValues(
  entries: readonly (readonly [string, string | null])[],
  expected: readonly (readonly [string, string | null])[],
): Promise<boolean> {
  const readKeys = new Set(expected.map(([key]) => key));
  if (entries.length > 256 || expected.length > 512 || readKeys.size !== expected.length
      || new Set(entries.map(([key]) => key)).size !== entries.length
      || [...expected, ...entries].some(([key]) => typeof key !== "string" || (!key.startsWith("localdb:") && key !== "syncjournal"))
      || entries.some(([key]) => !readKeys.has(key)))
    throw new Error("Invalid local transaction comparisons.");
  if (hasTauri) return invoke<boolean>("cache_compare_set_many", { entries, expected });
  if (isNativeApp()) {
    const db = await mobileDatabase();
    const committed = await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction("values", "readwrite");
      const store = tx.objectStore("values");
      let matches = true;
      let remaining = expected.length + 1;
      let verifiedOwner: string;
      const finishRead = () => {
        if (--remaining !== 0 || !matches) return;
        store.put(verifiedOwner, DURABLE_OWNER_KEY);
        for (const [key, value] of entries) store.put(value, key);
      };
      tx.oncomplete = () => resolve(matches);
      tx.onabort = () => reject(tx.error ?? new Error("Could not save device storage. Your previous records are preserved."));
      const owner = store.get(DURABLE_OWNER_KEY);
      owner.onsuccess = () => {
        try { verifiedOwner = checkOwner(owner.result); finishRead(); }
        catch (error) { tx.abort(); reject(error); }
      };
      for (const [key, value] of expected) {
        const request = store.get(key);
        request.onsuccess = () => {
          const current = request.result === undefined ? localStorage.getItem(key) : request.result;
          if (current !== value) matches = false;
          finishRead();
        };
      }
    });
    if (committed) for (const [key] of entries) {
      try { localStorage.removeItem(key); } catch { /* committed store is authoritative */ }
    }
    return committed;
  }
  // The caller owns filey:local-data; acquiring it again would deadlock.
  return commitBrowserValues(entries, expected);
}

// Only the Supabase session uses preferences. Provider API keys stay in memory.
export const nativeAuthStorage = {
  async getItem(key: string): Promise<string | null> { return (await Preferences.get({ key })).value; },
  async setItem(key: string, value: string): Promise<void> { await Preferences.set({ key, value }); },
  async removeItem(key: string): Promise<void> { await Preferences.remove({ key }); },
};
