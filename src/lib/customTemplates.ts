import { getCacheScope } from "./api";
import { assertWorkspaceCurrent, effectiveDataMode } from "./dataMode";
import { sb, supabase } from "./supabase";
import { notifyDataChanged } from "./realtime";
import type { CustomTemplate } from "../components/TemplateDesigner";
import { useEffect, useState, useSyncExternalStore } from "react";

const SETTING_KEY = "custom_templates";
const LEGACY_KEY = "filey.customTemplates";
const snapshots = new Map<string, CustomTemplate[]>();
const pendingReads = new Map<string, Promise<CustomTemplate[]>>();
const revisions = new Map<string, number>();
const listeners = new Set<() => void>();
const EMPTY: CustomTemplate[] = [];
let writes = Promise.resolve();

/** Never infer an account from the legacy template blob. It has no provenance. */
export function customTemplateScope(): string | null {
  assertWorkspaceCurrent();
  // effectiveDataMode(), not getDataMode(): the hosted web build never shows the
  // storage picker, so the stored mode is normally absent there. Reading the
  // raw value yielded a null scope and told signed-in web users to sign in.
  const mode = effectiveDataMode();
  const account = getCacheScope();
  return account ? `${mode}:${account}` : null;
}

export function hasUnscopedCustomTemplates(): boolean {
  return effectiveDataMode() === "local" && !!localStorage.getItem(LEGACY_KEY);
}

/** Synchronous renderer snapshot, populated only by this identity's verified read. */
export function loadCustomTemplates(): CustomTemplate[] {
  try {
    const scope = customTemplateScope();
    return scope ? snapshots.get(scope) ?? EMPTY : EMPTY;
  } catch { return EMPTY; }
}

export function subscribeCustomTemplates(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Shared by selectors and offscreen PDF renderers; a cold custom layout must
 * finish loading before it can be rendered or exported. */
export function useCustomTemplates(enabled = true) {
  const templates = useSyncExternalStore(subscribeCustomTemplates, loadCustomTemplates, () => EMPTY);
  let scope: string | null = null;
  try { scope = customTemplateScope(); } catch { /* A stale workspace reports the read error below. */ }
  const [result, setResult] = useState<{ scope: string | null; error: string | null; loaded: boolean }>({ scope: null, error: null, loaded: false });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    syncCustomTemplates().then(() => {
      if (active) setResult({ scope, error: null, loaded: true });
    }).catch((error) => {
      if (active) setResult({ scope, error: error instanceof Error ? error.message : String(error), loaded: false });
    });
    return () => { active = false; };
  }, [scope, enabled, retry]);
  return { templates, loading: enabled && (result.scope !== scope || (!result.loaded && !result.error)), error: result.scope === scope ? result.error : null, reload: () => { setResult({ scope, error: null, loaded: false }); setRetry((value) => value + 1); } };
}

function publish(scope: string, templates: CustomTemplate[]) {
  snapshots.set(scope, templates);
  for (const listener of listeners) listener();
}

function requireScope(expected?: string): string {
  const scope = customTemplateScope();
  // Reached only when there is no account identity at all. Say which account is
  // missing — "sign in to this workspace" read as a second sign-in on the web
  // build, where one account sign-in already exists and no workspace picker does.
  if (!scope)
    throw new Error(
      effectiveDataMode() === "local"
        ? "Sign in to your account on this device to load or save templates."
        : "Sign in to your Filey account to load or save templates."
    );
  if (expected && expected !== scope) throw new Error("Your account changed. Reopen the template picker before continuing.");
  return scope;
}

function parseTemplates(value: string | null | undefined): CustomTemplate[] {
  if (!value) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch { throw new Error("Saved templates could not be read. The original data has been preserved."); }
  if (!Array.isArray(parsed) || parsed.some((item) => !item || typeof item.id !== "string" || typeof item.name !== "string"))
    throw new Error("Saved templates have an invalid format. The original data has been preserved.");
  return parsed;
}

async function templateRow(scope: string) {
  requireScope(scope);
  const client = sb();
  let userId: string | undefined;
  let orgId: string | undefined;
  if (scope.startsWith("cloud:")) {
    if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("Connect to the internet to load or save cloud templates.");
    const { data, error } = await supabase!.auth.getSession();
    if (error) throw error;
    userId = data.session?.user.id;
    const account = getCacheScope();
    if (!userId || !account?.endsWith(`:user:${userId}`)) throw new Error("Your cloud account changed. Sign in again before using templates.");
    orgId = account.slice(0, -`:user:${userId}`.length);
  }
  requireScope(scope);
  // Legacy schema is unique(user_id,key), not (org_id,user_id,key). A new
  // organization's list therefore needs its own key without moving old rows.
  const settingKey = userId ? `${SETTING_KEY}:${encodeURIComponent(orgId!)}` : SETTING_KEY;
  const read = async (key: string) => {
    let query = client.from("app_settings").select("id,value").eq("key", key);
    if (userId) query = query.eq("user_id", userId).eq("org_id", orgId!);
    const result = await query.maybeSingle();
    if (result.error) throw result.error;
    requireScope(scope);
    return result.data as { id: number; value: string } | null;
  };
  const data = await read(settingKey) ?? (userId ? await read(SETTING_KEY) : null);
  requireScope(scope);
  return { client, userId, orgId, settingKey, row: data, templates: parseTemplates(data?.value) };
}

/** Reads the active store directly. No stale cache fallback and no writes on mount. */
export function syncCustomTemplates(): Promise<CustomTemplate[]> {
  let scope: string;
  try { scope = requireScope(); } catch (error) { return Promise.reject(error); }
  const pending = pendingReads.get(scope);
  if (pending) return pending;
  const revision = revisions.get(scope);
  const request = templateRow(scope).then(({ templates }) => {
    requireScope(scope);
    if (revisions.get(scope) !== revision) return snapshots.get(scope) ?? EMPTY;
    publish(scope, templates);
    return templates;
  }).catch((error) => {
    if (revisions.get(scope) !== revision && customTemplateScope() === scope) return snapshots.get(scope) ?? EMPTY;
    snapshots.delete(scope);
    for (const listener of listeners) listener();
    throw error;
  }).finally(() => { pendingReads.delete(scope); });
  pendingReads.set(scope, request);
  return request;
}

async function changeTemplates(change: (templates: CustomTemplate[]) => CustomTemplate[], expectedScope?: string): Promise<CustomTemplate[]> {
  const scope = requireScope(expectedScope);
  const operation = writes.then(async () => {
    requireScope(scope);
    const { client, row, userId, orgId, settingKey, templates } = await templateRow(scope);
    const next = change(templates);
    requireScope(scope);
    const value = JSON.stringify(next);
    if (row) {
      let query = client.from("app_settings").update({ value }).eq("id", row.id).eq("value", row.value);
      if (userId) query = query.eq("user_id", userId).eq("org_id", orgId!);
      const { data, error } = await query.select("id").maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Templates changed in another window. Reload them and try again.");
    } else {
      const { error } = await client.from("app_settings").insert({ key: settingKey, value, ...(userId ? { user_id: userId, org_id: orgId } : {}) }).select("id").single();
      if (error) throw error;
    }
    requireScope(scope);
    revisions.set(scope, (revisions.get(scope) ?? 0) + 1);
    publish(scope, next);
    notifyDataChanged();
    return next;
  });
  writes = operation.then(() => {}, () => {});
  return operation;
}

export function saveCustomTemplate(template: CustomTemplate, expectedScope?: string): Promise<CustomTemplate[]> {
  return changeTemplates((templates) => [...templates.filter((item) => item.id !== template.id), template], expectedScope);
}

export function deleteCustomTemplate(id: string): Promise<CustomTemplate[]> {
  return changeTemplates((templates) => templates.filter((item) => item.id !== id));
}

/** Templates saved before per-account scoping existed. They have no owner, so
 *  they are never loaded on their own — but on a device workspace they are the
 *  only copy, and a user who cannot get them back has effectively lost them.
 *  Adopting moves them into THIS account's store, keeping the original blob
 *  until the write succeeds. */
export async function adoptLegacyCustomTemplates(): Promise<CustomTemplate[]> {
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return [];
  // parseTemplates throws on damaged data — surface it as a rejection so a
  // click handler can catch it, and never overwrite the original.
  const legacy = parseTemplates(raw);
  if (!legacy.length) return [];
  const templates = await changeTemplates((current) => {
    const byId = new Map(current.map((item) => [item.id, item]));
    for (const item of legacy) if (!byId.has(item.id)) byId.set(item.id, item);
    return [...byId.values()];
  });
  // Only now that the scoped copy exists is the original redundant.
  localStorage.removeItem(LEGACY_KEY);
  return templates;
}
