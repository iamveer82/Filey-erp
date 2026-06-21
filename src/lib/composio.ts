/* Composio bridge (frontend side).
 *
 * Every call goes through the Rust backend (Tauri commands in
 * modules/composio.rs), which holds the API key in the encrypted store. The key
 * is only ever PASSED to Rust once, when the user saves it; it is never read
 * back into the browser or used for API calls from here. Desktop-only.
 */
import { invoke } from "@tauri-apps/api/core";

export const hasDesktop =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const KEY = "composio_api_key";
/** Single-tenant desktop: one Composio entity for this install. */
export const COMPOSIO_USER = "default";

/** Toolkits we surface in Settings → Integrations. */
export const COMPOSIO_TOOLKITS = [
  { slug: "gmail", name: "Gmail", desc: "Send email from your Gmail" },
  { slug: "slack", name: "Slack", desc: "Post messages to Slack" },
  { slug: "telegram", name: "Telegram", desc: "Message via a Telegram bot" },
] as const;

export async function getComposioKey(): Promise<string> {
  if (!hasDesktop) return "";
  try {
    return (await invoke<string | null>("cache_get", { key: KEY })) ?? "";
  } catch {
    return "";
  }
}

export async function setComposioKey(value: string): Promise<void> {
  if (!hasDesktop)
    throw new Error(
      "Composio integrations are available in the Filey desktop app only — the key is stored in the device's encrypted store, never the browser."
    );
  await invoke("cache_set", { key: KEY, value: value.trim() });
}

export async function composioReady(): Promise<boolean> {
  return !!(await getComposioKey()).trim();
}

export interface ConnectLink {
  redirect_url?: string;
  connected_account_id?: string;
  error?: { message: string };
}

/** Start connecting a toolkit; returns an OAuth redirect URL for the user.
 *  Omit `userId` to use this install's stable entity (multi-tenant seam — one
 *  platform key, one entity per customer). Pass it to target a specific tenant. */
export async function composioConnect(
  toolkit: string,
  userId?: string
): Promise<ConnectLink> {
  return invoke<ConnectLink>("composio_connect", { toolkit, userId });
}

export interface ConnectionStatus {
  id?: string;
  status?: string; // INITIATED | ACTIVE | FAILED | …
  toolkit?: { slug?: string };
  error?: { message: string };
}

export async function composioStatus(
  connectedAccountId: string
): Promise<ConnectionStatus> {
  return invoke<ConnectionStatus>("composio_connection_status", {
    connectedAccountId,
  });
}

export interface ConnectionList {
  items?: ConnectionStatus[];
  error?: { message: string };
}

export async function composioList(): Promise<ConnectionList> {
  return invoke<ConnectionList>("composio_list_connections");
}

export interface ExecuteResult {
  data?: unknown;
  successful?: boolean;
  error?: { message: string } | string;
}

/** Run a connected Composio tool (e.g. GMAIL_SEND_EMAIL). Omit `userId` to use
 *  this install's stable entity. */
export async function composioExecute(
  toolSlug: string,
  args: Record<string, unknown>,
  userId?: string
): Promise<ExecuteResult> {
  return invoke<ExecuteResult>("composio_execute", {
    toolSlug,
    arguments: args,
    userId,
  });
}
