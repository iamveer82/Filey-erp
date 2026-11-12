/* One-click authorization for the chat channels.
 *
 * Slack, Discord and Teams are OAuth apps. A user who taps Connect expects the
 * provider's own "Allow … to access …" page, not a paste-the-webhook form.
 * Filey runs on the user's device and has no hosted callback of its own, so the
 * authorization is brokered by the connected-apps service it already uses for
 * the Apps tab: it returns the provider URL, the user approves in their browser,
 * and this module polls the connected account until it is ACTIVE.
 *
 * The incoming webhook is still how Filey posts notifications, and it stays
 * available — but it is a fallback, not the first thing a user has to learn.
 */
import { openUrl } from "@tauri-apps/plugin-opener";

import {
  composioConnect,
  composioList,
  composioStatus,
  hasDesktop,
} from "./composio";
import { isNativeApp, openNativeExternal } from "./nativePlatform";

export type OAuthChannelId = "slack" | "discord" | "teams";

/** The connected-apps toolkit that authorizes each channel. */
export const CHANNEL_TOOLKIT: Record<OAuthChannelId, string> = {
  slack: "slack",
  discord: "discord",
  teams: "microsoft_teams",
};

export function isOAuthChannel(id: string): id is OAuthChannelId {
  return id === "slack" || id === "discord" || id === "teams";
}

/** Open the provider's authorization page outside the app's WebView. */
async function openAuthorization(url: string): Promise<void> {
  if (isNativeApp()) return openNativeExternal(url);
  if (hasDesktop) return openUrl(url);
  const tab = window.open(url, "_blank", "noopener,noreferrer");
  if (!tab)
    throw new Error(
      "The browser blocked the authorization window. Allow pop-ups for Filey and try again."
    );
}

export interface ChannelAuthorization {
  /** The provider page the user has to approve. */
  url: string;
  /** The pending connected account to watch. */
  accountId: string;
}

/** Create the authorization and open it. Throws with a user-facing message. */
export async function beginChannelAuthorization(
  id: OAuthChannelId
): Promise<ChannelAuthorization> {
  const link = await composioConnect(CHANNEL_TOOLKIT[id]);
  if (!link.redirect_url || !link.connected_account_id)
    throw new Error("The authorization service did not return a sign-in link.");
  await openAuthorization(link.redirect_url);
  return { url: link.redirect_url, accountId: link.connected_account_id };
}

const FAILED = new Set(["FAILED", "EXPIRED", "INACTIVE", "REVOKED", "DELETED"]);

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

export type ChannelAuthResult =
  | { ok: true }
  | { ok: false; reason: "denied" | "pending" | "cancelled" | "error"; message?: string };

let lastError = "";

/** Poll the pending account until the user approves, refuses or the window ends.
 *  A transient network failure is not a refusal: keep waiting. */
export async function waitForChannelAuthorization(
  accountId: string,
  opts: { signal?: AbortSignal; timeoutMs?: number; intervalMs?: number } = {}
): Promise<ChannelAuthResult> {
  const interval = opts.intervalMs ?? 1500;
  const deadline = Date.now() + (opts.timeoutMs ?? 180_000);
  while (Date.now() < deadline) {
    await sleep(interval, opts.signal);
    if (opts.signal?.aborted) return { ok: false, reason: "cancelled" };
    let status: Awaited<ReturnType<typeof composioStatus>>;
    try {
      status = await composioStatus(accountId);
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : String(cause);
      continue;
    }
    const value = (status?.status ?? "").toUpperCase();
    if (value === "ACTIVE") {
      invalidateChannelAuth();
      return { ok: true };
    }
    if (FAILED.has(value))
      return {
        ok: false,
        reason: "denied",
        message: status?.error?.message || undefined,
      };
  }
  return { ok: false, reason: "pending", message: lastError || undefined };
}

/* The Integrations page and three gateway rows all ask the same question at
 * once. One short-lived answer keeps that to a single provider call. */
let cached: { at: number; value: Promise<Set<string>> } | null = null;
const CACHE_MS = 10_000;

function loadConnected(): Promise<Set<string>> {
  return composioList()
    .then((list) => {
      const slugs = (list.items ?? [])
        .filter((item) => (item.status ?? "").toUpperCase() === "ACTIVE")
        .map((item) => item.toolkit?.slug)
        .filter((slug): slug is string => !!slug);
      return new Set(slugs);
    })
    .catch((cause) => {
      cached = null;
      throw cause;
    });
}

/** Toolkits the signed-in workspace has authorized, e.g. "slack". */
export async function connectedOAuthChannels(
  opts: { fresh?: boolean } = {}
): Promise<Set<string>> {
  if (!opts.fresh && cached && Date.now() - cached.at < CACHE_MS)
    return cached.value;
  const value = loadConnected();
  cached = { at: Date.now(), value };
  return value;
}

export function invalidateChannelAuth(): void {
  cached = null;
}

/** Turn an authorization failure into something a person can act on. */
export function channelAuthError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause ?? "");
  if (/sign in|workspace changed/i.test(message))
    return "Sign in to Filey, then authorize this channel in one click — or add your own Composio key in Integrations.";
  if (/aren't configured yet|not configured|COMPOSIO_API_KEY|integrations service/i.test(message))
    return "One-click authorization needs an integrations key. Add your own Composio key in Integrations, or use the incoming webhook below.";
  return message.trim() || "The authorization page could not be opened. Try again.";
}

/** True when the failure is configuration, not the user's decision. */
export function needsIntegrationSetup(message: string): boolean {
  return /Composio key|integrations key|not set up|not configured/i.test(message);
}
