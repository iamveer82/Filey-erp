/* Composio bridge (frontend side).
 *
 * Every call goes through the Rust backend (Tauri commands in
 * modules/composio.rs), which holds the API key in the OS secure store. The key
 * is only ever PASSED to Rust once, when the user saves it; it is never read
 * back into the browser or used for API calls from here. Desktop-only.
 */
import { invoke } from "@tauri-apps/api/core";
import { getCacheScope } from "./api";
import { assertWorkspaceCurrent } from "./dataMode";
import { saveCredential, flushCredentials } from "./credentialStore";
import { requireModuleAccess } from "./moduleAccess";
import {
  platformCall,
  platformAvailable,
  saveCloudKey,
  clearCloudKey,
  hasCloudKey,
  type KeySource,
} from "./integrations";

export const hasDesktop =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function currentScope(): string {
  assertWorkspaceCurrent();
  const scope = getCacheScope();
  if (!scope) throw new Error("Sign in before using integrations.");
  return scope;
}
async function nativeCall<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const scope = currentScope();
  const result = await invoke<T>(command, { ...args, scope });
  if (currentScope() !== scope) throw new Error("Your workspace changed. Reopen integrations.");
  return result;
}

async function request<T>(action: string, command: string, cloudArgs: Record<string, unknown> = {}, nativeArgs = cloudArgs): Promise<T> {
  const scope = currentScope();
  await requireModuleAccess("integrations");
  const own = await usingOwnKey();
  if (currentScope() !== scope) throw new Error("Your workspace changed. Reopen integrations.");
  const result = own ? await nativeCall<T>(command, nativeArgs) : await platformCall<T>("composio", action, cloudArgs);
  if (currentScope() !== scope) throw new Error("Your workspace changed. Reopen integrations.");
  return result;
}

/** Toolkits we surface on the Integrations page. */
/* The apps offered on the Integrations page. Chosen for what an SMB running
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

export async function hasOwnComposioKey(): Promise<boolean> {
  if (!hasDesktop) return false;
  const scope = currentScope();
  await flushCredentials();
  if (scope !== currentScope()) throw new Error("Your workspace changed. Reopen integrations.");
  return nativeCall<boolean>("composio_has_key");
}

/** Save the customer's own key. Desktop puts it in the OS secure store and
 *  calls Composio directly; a browser has nowhere safe for a secret, so it goes
 *  to the cloud instead (write-only to the client — see saveCloudKey) and the
 *  proxy spends it on their behalf. */
export async function setComposioKey(value: string): Promise<void> {
  if (hasDesktop) {
    await saveCredential("composio", value.trim());
    return;
  }
  await saveCloudKey("composio", value);
}

export async function clearComposioKey(): Promise<void> {
  if (hasDesktop) {
    await saveCredential("composio", null);
    return;
  }
  await clearCloudKey("composio");
}

/** True when this install has its OWN key ON THIS DEVICE and should bypass the
 *  platform proxy. A cloud-stored key is deliberately NOT "own" here: the call
 *  still goes through the proxy, which is the only party that can read it. */
export async function usingOwnKey(): Promise<boolean> {
  return hasOwnComposioKey();
}

/** The customer is on their own key, wherever it happens to live. */
export async function usingOwnKeyAnywhere(): Promise<boolean> {
  if (await usingOwnKey()) return true;
  return hasCloudKey("composio");
}

/** Integrations are usable at all: either the customer's own key, or Filey's
 *  (which needs a cloud session, since that is what the proxy authenticates). */
export async function composioReady(): Promise<boolean> {
  if (await usingOwnKey()) return true;
  return platformAvailable("composio");
}

/** Which key is paying for this install's integrations. */
export async function composioKeySource(): Promise<KeySource> {
  if (await usingOwnKeyAnywhere()) return "own";
  return (await platformAvailable("composio")) ? "platform" : "none";
}

export interface ConnectLink {
  redirect_url?: string;
  connected_account_id?: string;
  error?: { message: string };
}

/** Start connecting a toolkit for the signed-in account and workspace. */
export async function composioConnect(
  toolkit: string
): Promise<ConnectLink> {
  return request("connect", "composio_connect", { toolkit });
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
  return request("status", "composio_connection_status", { connected_account_id: connectedAccountId }, { connectedAccountId });
}

export interface ConnectionList {
  items?: ConnectionStatus[];
  error?: { message: string };
  next_cursor?: string | null;
}

export async function composioList(): Promise<ConnectionList> {
  const scope = currentScope();
  const items: ConnectionStatus[] = [];
  const cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    if (currentScope() !== scope) throw new Error("Your workspace changed. Reopen integrations.");
    const page: ConnectionList = await request("list", "composio_list_connections", { cursor });
    if (page.error) throw new Error(page.error.message);
    if (!Array.isArray(page.items)) throw new Error("Invalid connection list.");
    items.push(...page.items);
    cursor = page.next_cursor || null;
    if (cursor && (cursors.has(cursor) || cursors.size >= 100)) throw new Error("The provider could not complete the connection list. Try refreshing.");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return { items };
}

export interface ToolkitInfo {
  slug: string;
  name?: string;
  meta?: { description?: string; logo?: string };
}

/** Search Composio's whole catalogue, not the shortlist in COMPOSIO_TOOLKITS.
 *  The shortlist is what we put on screen by default; this is how a user
 *  connects the app they actually use, which we were never going to guess. */
export async function composioSearchToolkits(
  query: string,
  limit = 20
): Promise<ToolkitInfo[]> {
  const res = await request<{ items?: ToolkitInfo[] }>("toolkits", "composio_search_toolkits", {query,limit});
  return res.items ?? [];
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
  return request("tools", "composio_list_tools", { toolkits: toolkits ?? null, limit });
}

export interface ExecuteResult {
  data?: unknown;
  successful?: boolean;
  error?: { message: string } | string;
}

/** Run a connected tool for the signed-in account and workspace. */
export async function composioExecute(
  toolSlug: string,
  args: Record<string, unknown>
): Promise<ExecuteResult> {
  return request("execute", "composio_execute", { tool_slug: toolSlug, arguments: args }, { toolSlug, arguments: args });
}
