/* Optional OpenViking server. Filey stores the address the user gives and calls
 * the HTTP API (docs.openviking.ai). The AGPL server itself is not part of Filey.
 * A key saved as the secret "openviking" is sent as X-API-Key and never returned. */
import { readAgentStorage, writeAgentStorage } from "./agentStorage";
import { recallSecret } from "./secretStore";

const KEY = "filey.viking.url";

export function vikingServer(): string | null {
  const raw = readAgentStorage(KEY);
  return raw && /^https?:\/\/[^\s]+$/i.test(raw) && !raw.includes("@") ? raw.replace(/\/$/, "") : null;
}

export function connectViking(server: string): { ok: true; server: string } | { error: string } {
  const clean = server.trim().replace(/\/$/, "");
  if (!/^https?:\/\/[^\s]+$/i.test(clean) || clean.includes("@"))
    return { error: "Give an http or https address, with no user or password in it." };
  writeAgentStorage(KEY, clean);
  return { ok: true, server: clean };
}

export async function vikingCall(path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const server = vikingServer();
  if (!server) return { connected: false, hint: "No OpenViking server is connected. Ask for the address, then viking action connect." };
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  try {
    const key = await recallSecret("openviking");
    if (key) headers["X-API-Key"] = key;
  } catch { /* unsigned workspace: call without a key */ }
  const response = await fetch(`${server}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: Object.keys(headers).length ? headers : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const text = await response.text();
  if (!response.ok) {
    const auth = response.status === 401 ? " Save the server key as the secret named openviking." : "";
    return { connected: true, error: `OpenViking returned ${response.status}.${auth}`, detail: text.replace(/sk-[A-Za-z0-9_-]+/g, "[key]").slice(0, 300) };
  }
  try { return JSON.parse(text); } catch { return { text: text.slice(0, 4000) }; }
}
