import { invoke } from "@tauri-apps/api/core";
import { Preferences } from "@capacitor/preferences";
import { isNativeApp } from "./nativePlatform";
import { localWorkspaceOwner } from "./localAuth";

const hasTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const transactionalDeviceStorage = hasTauri || isNativeApp();
let database: Promise<IDBDatabase> | undefined;
const OWNER_KEY = "filey_local_workspace_owner";
const DURABLE_OWNER_KEY = "filey:device-owner";
const workspaceKey = (key: string) => typeof key === "string" && (key.startsWith("localdb:") || key.startsWith("fileblob:") || key === "syncjournal");

function checkOwner(saved: unknown): string {
  const current = localWorkspaceOwner();
  if (saved !== undefined && (typeof saved !== "string" || !saved)) throw new Error("Device ownership could not be read. Your records were not changed.");
  if (saved && current && saved !== current) throw new Error("Sign in with this device workspace's original account.");
  const owner = typeof saved === "string" ? saved : current;
  if (!owner) throw new Error("Sign in to the device workspace before opening its records.");
  if (!current) localStorage.setItem(OWNER_KEY, owner);
  return owner;
}

export async function restoreNativeOwnership(): Promise<void> {
  if (!isNativeApp()) return;
  const saved = await readDeviceValue(DURABLE_OWNER_KEY);
  if (saved !== null) checkOwner(saved);
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
  if (!isNativeApp()) return localStorage.getItem(key);
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

export async function writeDeviceValues(entries: readonly (readonly [string, string | null])[]): Promise<void> {
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
  // Hosted browser behavior stays compatible, including rollback on quota failure.
  const previous = entries.map(([key]) => [key, localStorage.getItem(key)] as const);
  try {
    for (const [key, value] of entries) {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
  } catch (error) {
    let restored = true;
    for (const [key, value] of previous) {
      try {
        if (localStorage.getItem(key) === value) continue;
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      } catch { restored = false; }
    }
    if (!restored) throw new Error("Device storage is unavailable. Keep using Filey Cloud until storage has been repaired.");
    throw error;
  }
}

export async function writeDeviceValue(key: string, value: string | null): Promise<void> {
  if (hasTauri) await invoke("cache_set", { key, value: value ?? "" });
  else if (isNativeApp()) await writeDeviceValues([[key, value]]);
  // Browser setItem is already atomic for one key; a failed save needs no undo.
  else if (value === null) localStorage.removeItem(key);
  else localStorage.setItem(key, value);
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
  // The caller owns the cross-tab Web Lock. Comparison and writes have no await
  // boundary, so another cooperating tab cannot interleave this commit.
  if (expected.some(([key, value]) => localStorage.getItem(key) !== value)) return false;
  await writeDeviceValues(entries);
  return true;
}

// Only the Supabase session uses preferences. Provider API keys stay in memory.
export const nativeAuthStorage = {
  async getItem(key: string): Promise<string | null> { return (await Preferences.get({ key })).value; },
  async setItem(key: string, value: string): Promise<void> { await Preferences.set({ key, value }); },
  async removeItem(key: string): Promise<void> { await Preferences.remove({ key }); },
};
