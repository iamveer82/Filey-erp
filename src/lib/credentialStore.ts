import { invoke } from "@tauri-apps/api/core";
import { getCacheScope } from "./api";
import { assertWorkspaceCurrent } from "./dataMode";

const desktop = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const values = new Map<string, string>();
const writes = new Map<string, Promise<void>>();
const keyFor = (scope: string, name: string) => `${scope}\0${name}`;
const namesKey = (scope: string) => `filey.credentials:${encodeURIComponent(scope)}`;
export const CREDENTIAL_EVENT = "filey:credentials";

function scopeNow(expected?: string): string {
  assertWorkspaceCurrent();
  const scope = getCacheScope();
  if (!scope || (expected && expected !== scope)) throw new Error("Sign in to the same workspace before using credentials.");
  return scope;
}

// A sign-out/account switch drops plaintext from the renderer immediately.
let cachedScope: string | null = null;
window.addEventListener("filey:agent-storage", () => {
  const scope = getCacheScope();
  if (cachedScope !== scope) { values.clear(); cachedScope = scope; }
});

export function credentialNames(): string[] {
  const scope = scopeNow();
  if (!desktop()) return [...values.keys()].filter(key => key.startsWith(`${scope}\0`)).map(key => key.slice(scope.length + 1));
  return storedNames(scope);
}

function storedNames(scope: string): string[] {
  const raw = localStorage.getItem(namesKey(scope));
  let names: unknown = [];
  try { names = raw ? JSON.parse(raw) : []; } catch { /* The OS vault remains authoritative. */ }
  return Array.isArray(names) ? names.filter((name): name is string => typeof name === "string") : [];
}

export function peekCredential(name: string): string {
  try { return values.get(keyFor(scopeNow(), name)) ?? ""; } catch { return ""; }
}
export function hasCredential(name: string): boolean {
  try { return !!peekCredential(name) || credentialNames().includes(name); } catch { return false; }
}

/** Synchronous preview, queued durable save. Await the result before claiming success. */
export function saveCredential(name: string, value: string | null): Promise<void> {
  const scope = scopeNow();
  cachedScope = scope;
  const key = keyFor(scope,name);
  if (value) values.set(key,value); else values.delete(key);
  const pending = (writes.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
    if (desktop()) {
      await invoke("credential_write", { scope, name, value: value || null });
      const names = new Set<string>(storedNames(scope));
      if (value) names.add(name); else names.delete(name);
      localStorage.setItem(namesKey(scope),JSON.stringify([...names]));
    }
    window.dispatchEvent(new Event(CREDENTIAL_EVENT));
  });
  writes.set(key,pending);
  // Keep the rejection for readCredential/flushCredentials, without an unhandled
  // rejection if a debounced settings save has no request waiting on it yet.
  void pending.catch(() => {
    if (writes.get(key) === pending) values.delete(key);
    window.dispatchEvent(new Event(CREDENTIAL_EVENT));
  });
  return pending;
}

export async function readCredential(name: string, expectedScope?: string): Promise<string | null> {
  const scope = scopeNow(expectedScope);
  const key = keyFor(scope,name);
  await writes.get(key);
  scopeNow(scope);
  const value = desktop() ? await invoke<string | null>("credential_read", { scope, name }) : values.get(key) ?? null;
  scopeNow(scope);
  if (value) values.set(key,value);
  return value;
}
export async function flushCredentials(name?: string): Promise<void> {
  const scope = scopeNow();
  await Promise.all([...writes].filter(([key]) => name ? key === keyFor(scope, name) : key.startsWith(`${scope}\0`)).map(([,value]) => value));
  scopeNow(scope);
}

/** Legacy settings have no proven owner. Preserve them in a separate OS vault;
 * do not silently hand them to the next account that signs in. */
export async function quarantineLegacyCredentials(): Promise<void> {
  if (!desktop()) return;
  for (const key of ["filey.ai.config", "filey.ai.image"]) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    const config = JSON.parse(raw);
    if (!config.apiKey) continue;
    await invoke("credential_quarantine", { name: key, value: config.apiKey });
    // A concurrent settings change must not be erased by this migration.
    if (localStorage.getItem(key) === raw) {
      delete config.apiKey;
      localStorage.setItem(key,JSON.stringify(config));
    }
  }
  const legacyKeys = Array.from({ length: localStorage.length },(_,i) => localStorage.key(i)).filter((key): key is string => !!key?.startsWith("filey.secret."));
  for (const key of legacyKeys) {
    const value = localStorage.getItem(key);
    if (value === null) continue;
    await invoke("credential_quarantine", { name: key, value });
    if (localStorage.getItem(key) === value) localStorage.removeItem(key);
  }
}
