import { getCacheScope } from "./api";
import { assertWorkspaceCurrent, getDataMode } from "./dataMode";

export const AGENT_STORAGE_EVENT = "filey:agent-storage";

/** AI state belongs to one account, organization and storage mode. Legacy
 * unscoped blobs have no trustworthy owner and remain untouched for recovery. */
export function agentStorageScope(): string | null {
  try {
    assertWorkspaceCurrent();
  } catch {
    return null;
  }
  const account = getCacheScope();
  // Hosted cloud sessions skip the desktop storage picker, so an absent mode
  // means cloud there (the data API uses the same convention).
  const mode = getDataMode() ?? "cloud";
  return account ? `${mode}:${account}` : null;
}

export function requireAgentStorageScope(expected?: string): string {
  const scope = agentStorageScope();
  if (!scope) throw new Error("Sign in to this workspace before saving assistant data.");
  if (expected && expected !== scope)
    throw new Error("Your workspace changed. Start the assistant task again.");
  return scope;
}

export function agentStorageKey(key: string): string | null {
  const scope = agentStorageScope();
  return scope ? `${key}:${encodeURIComponent(scope)}` : null;
}

export function readAgentStorage(key: string): string | null {
  try {
    const scoped = agentStorageKey(key);
    return scoped ? localStorage.getItem(scoped) : null;
  } catch {
    return null;
  }
}

export function writeAgentStorage(
  key: string,
  value: string | null,
  expectedScope?: string
): void {
  const scope = requireAgentStorageScope(expectedScope);
  const scoped = `${key}:${encodeURIComponent(scope)}`;
  if (value === null) localStorage.removeItem(scoped);
  else localStorage.setItem(scoped, value);
  window.dispatchEvent(new CustomEvent(AGENT_STORAGE_EVENT, { detail: { scope, key } }));
}
