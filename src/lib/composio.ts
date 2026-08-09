/* Composio bridge (frontend side).
 *
 * Every call goes through the Rust backend (Tauri commands in
 * modules/composio.rs), which holds the API key in the encrypted store. The key
 * is only ever PASSED to Rust once, when the user saves it; it is never read
 * back into the browser or used for API calls from here. Desktop-only.
 */
import { invoke } from "@tauri-apps/api/core";
import { platformCall, platformAvailable, type KeySource } from "./integrations";

export const hasDesktop =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const KEY = "composio_api_key";
/** Single-tenant desktop: one Composio entity for this install. */
export const COMPOSIO_USER = "default";

/** Toolkits we surface in Settings → Integrations. */
/* The apps offered in Settings → Integrations. Chosen for what an SMB running
 * this software actually uses to find and keep customers — the agent reaches
 * every action of whatever is connected here (see list_connected_apps), so
 * each entry widens what it can do rather than adding one button. */
export const COMPOSIO_TOOLKITS = [
  { slug: "gmail", name: "Gmail", desc: "Read and send from your Gmail" },
  { slug: "googlecalendar", name: "Google Calendar", desc: "Book and check meetings" },
  { slug: "googlesheets", name: "Google Sheets", desc: "Read and write spreadsheets" },
  { slug: "googledrive", name: "Google Drive", desc: "Find and file documents" },
  { slug: "outlook", name: "Outlook", desc: "Read and send from Outlook" },
  { slug: "slack", name: "Slack", desc: "Post and read messages in Slack" },
  { slug: "telegram", name: "Telegram", desc: "Message via a Telegram bot" },
  { slug: "whatsapp", name: "WhatsApp", desc: "Message customers on WhatsApp" },
  { slug: "hubspot", name: "HubSpot", desc: "Sync contacts and deals" },
  { slug: "linkedin", name: "LinkedIn", desc: "Publish and research prospects" },
  { slug: "notion", name: "Notion", desc: "Read and write pages" },
  { slug: "typeform", name: "Typeform", desc: "Pull form responses as leads" },
  { slug: "calendly", name: "Calendly", desc: "See what's been booked" },
  { slug: "mailchimp", name: "Mailchimp", desc: "Sync audiences and campaigns" },
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

/** True when this install has its OWN key and should bypass the platform. */
export async function usingOwnKey(): Promise<boolean> {
  return !!(await getComposioKey()).trim();
}

/** Integrations are usable at all: either the customer's own key, or Filey's
 *  (which needs a cloud session, since that is what the proxy authenticates). */
export async function composioReady(): Promise<boolean> {
  if (await usingOwnKey()) return true;
  return platformAvailable();
}

/** Which key is paying for this install's integrations. */
export async function composioKeySource(): Promise<KeySource> {
  if (await usingOwnKey()) return "own";
  return (await platformAvailable()) ? "platform" : "none";
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
  if (!(await usingOwnKey()))
    return platformCall<ConnectLink>("composio", "connect", { toolkit });
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
  if (!(await usingOwnKey()))
    return platformCall<ConnectionStatus>("composio", "status", {
      connected_account_id: connectedAccountId,
    });
  return invoke<ConnectionStatus>("composio_connection_status", {
    connectedAccountId,
  });
}

export interface ConnectionList {
  items?: ConnectionStatus[];
  error?: { message: string };
}

export async function composioList(): Promise<ConnectionList> {
  if (!(await usingOwnKey()))
    return platformCall<ConnectionList>("composio", "list");
  return invoke<ConnectionList>("composio_list_connections");
}

export interface ToolInfo {
  slug?: string;
  name?: string;
  description?: string;
  toolkit?: { slug?: string };
  input_parameters?: Record<string, unknown>;
}

/** The tools available for the apps this customer has connected. Discovery,
 *  not a hardcoded list — the agent asks what it can do rather than being told
 *  once at build time and going stale. */
export async function composioTools(
  toolkits?: string,
  limit = 40
): Promise<{ items?: ToolInfo[] }> {
  if (!(await usingOwnKey()))
    return platformCall<{ items?: ToolInfo[] }>("composio", "tools", {
      toolkits,
      limit,
    });
  return invoke<{ items?: ToolInfo[] }>("composio_list_tools", {
    toolkits: toolkits ?? null,
    limit,
  });
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
  if (!(await usingOwnKey()))
    return platformCall<ExecuteResult>("composio", "execute", {
      tool_slug: toolSlug,
      arguments: args,
    });
  return invoke<ExecuteResult>("composio_execute", {
    toolSlug,
    arguments: args,
    userId,
  });
}
