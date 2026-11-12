// Instagram comment-to-DM automation ("ManyChat, built in"), after OpenReply
// (github.com/diwenne/openreply, MIT). The work runs on the server: Meta delivers
// comments to the `instagram-webhook` edge function, which matches them against
// ig_automations and sends the private reply. The app only manages automations
// through the `instagram` edge function on the signed-in user's session;
// Instagram tokens never reach this device.

import { supabase, invokeFn } from "./supabase";
import { getCacheOrg } from "./api";

export class InstagramError extends Error {}

export interface IgConnection {
  id: string;
  ig_user_id: string;
  ig_username: string;
  account_type: string;
  connected_at: string;
  needs_reconnect: boolean;
}

export interface IgMedia {
  id: string;
  caption?: string;
  media_type?: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM" | string;
  media_url?: string;
  permalink?: string;
  timestamp?: string;
}

export type IgTrigger = "comment" | "live_comment" | "story_reply" | "story_mention";
export type IgMatchMode = "exact" | "word" | "contains";
export interface IgButton { title: string; url: string }

/** What the server stores for one automation (see validateAutomationInput). */
export interface IgAutomationInput {
  name: string;
  trigger_type: IgTrigger;
  keywords: string[];
  exclude_keywords: string[];
  match_mode: IgMatchMode;
  typo_tolerance: boolean;
  platform_post_id: string | null;
  dm_message: string;
  dm_message_variations: string[];
  buttons: IgButton[];
  dm_delay_seconds: number;
  comment_reply: string | null;
  comment_reply_variations: string[];
  comment_reply_delay_seconds: number;
  public_reply_policy: "after_dm" | "always";
  follow_gate: boolean;
  also_match_in_dms: boolean;
  repeat_mode: "once" | "every_comment";
  cooldown_hours: number | null;
  dedupe_same_text_hours: number | null;
  is_active: boolean;
}

export interface IgAutomation extends IgAutomationInput {
  id: string;
  connection_id: string;
  created_at: string;
  updated_at: string;
  stats: { sent: number; publicReplies: number; linkClicks: number };
}

export interface IgEvent {
  id: number;
  automation_id: string | null;
  automation_name: string | null;
  kind: "dm_sent" | "dm_skipped" | "public_reply" | "public_reply_failed" | "follow_gate_prompt" | "follow_gate_unlock" | "follow_gate_declined" | "error";
  actor_username: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

const READS = new Set(["status", "list", "media", "events"]);

async function call<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!supabase) throw new InstagramError("Instagram automation needs Filey's cloud. This build has no cloud configured.");
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token?.trim();
  if (!token) throw new InstagramError("Sign in to your Filey account to use Instagram automation.");
  const org = getCacheOrg();
  // Writes are never retried: a lost response can follow a save that succeeded.
  const { data, error } = await invokeFn(supabase, "instagram", {
    body: { action, ...payload, ...(org ? { expected_org_id: org } : {}) },
    headers: { Authorization: `Bearer ${token}` },
  }, READS.has(action) ? 2 : 0);
  if (error) {
    // No answer at all: offline, or the Instagram service is not switched on (an undeployed
    // function answers 404 without CORS, so the browser reports only "Failed to send a request").
    if ((error as { name?: string }).name === "FunctionsFetchError")
      throw new InstagramError(typeof navigator !== "undefined" && navigator.onLine === false
        ? "You're offline. Instagram DMs needs the internet."
        : "Instagram DMs isn't available right now: Filey couldn't reach its Instagram service. Try again later.");
    // A non-2xx carries the server's own wording in its body.
    let message = error instanceof Error ? error.message : String(error);
    try {
      const body = await (error as { context?: { json?: () => Promise<unknown> } }).context?.json?.() as { error?: string } | undefined;
      if (body?.error) message = body.error;
    } catch { /* keep the transport message */ }
    throw new InstagramError(message);
  }
  const body = data as { error?: string } | null;
  if (body?.error) throw new InstagramError(body.error);
  return data as T;
}

export const instagram = {
  connections: () => call<{ connections: IgConnection[] }>("status").then((r) => r.connections ?? []),
  connectUrl: () => call<{ url: string }>("connect_url").then((r) => r.url),
  disconnect: (connectionId: string) => call("disconnect", { connection_id: connectionId }),
  refreshToken: (connectionId: string) => call("refresh", { connection_id: connectionId }),
  automations: () => call<{ automations: IgAutomation[] }>("list").then((r) => r.automations ?? []),
  media: (connectionId: string, limit = 24) => call<{ items: IgMedia[] }>("media", { connection_id: connectionId, limit }).then((r) => r.items ?? []),
  save: (connectionId: string, automation: IgAutomationInput, id?: string) =>
    call<{ id: string }>("save", { connection_id: connectionId, automation, ...(id ? { id } : {}) }).then((r) => r.id),
  toggle: (id: string, isActive: boolean) => call("toggle", { id, is_active: isActive }),
  duplicate: (id: string) => call<{ id: string }>("duplicate", { id }).then((r) => r.id),
  remove: (id: string) => call("delete", { id }),
  events: (automationId?: string, limit = 50) =>
    call<{ events: IgEvent[] }>("events", { limit, ...(automationId ? { automation_id: automationId } : {}) }).then((r) => r.events ?? []),
};

/** Open the Meta sign-in page outside Filey's window (a WebView must not host it). */
export async function openInstagramConnect(url: string): Promise<void> {
  if ("__TAURI_INTERNALS__" in window) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else window.open(url, "_blank", "noopener");
}

/* ── Editor helpers (pure) ─────────────────────────────────────────────── */

/** Where the automation listens: one post, any post, or a story / live event. */
export type IgTarget = "post" | "any" | "story_reply" | "story_mention" | "live_comment";

export interface IgDraft extends IgAutomationInput {
  target: IgTarget;
  /** "words": only comments with a keyword; "any": every comment. */
  match: "words" | "any";
  publicReply: boolean;
}

export const DEFAULT_DM = "Hey {{first_name}}! Thanks so much for your interest 😊 Here's the link you asked for.";
export const DEFAULT_REPLY = "Sent you a DM 📩";

export function newDraft(): IgDraft {
  return {
    name: "", target: "post", match: "words", publicReply: false,
    trigger_type: "comment", keywords: [], exclude_keywords: [], match_mode: "word", typo_tolerance: true,
    platform_post_id: null, dm_message: DEFAULT_DM, dm_message_variations: [], buttons: [{ title: "Send me the link", url: "" }],
    dm_delay_seconds: 0, comment_reply: DEFAULT_REPLY, comment_reply_variations: [], comment_reply_delay_seconds: 0,
    public_reply_policy: "after_dm", follow_gate: false, also_match_in_dms: false, repeat_mode: "once",
    cooldown_hours: null, dedupe_same_text_hours: null, is_active: true,
  };
}

export function draftFrom(a: IgAutomation): IgDraft {
  const target: IgTarget = a.trigger_type === "comment" ? (a.platform_post_id ? "post" : "any") : a.trigger_type;
  return {
    ...newDraft(), ...a,
    target, match: a.keywords.length ? "words" : "any", publicReply: !!a.comment_reply,
    buttons: a.buttons.length ? a.buttons : [],
  };
}

/** The server's input for a draft. Fields the editor does not show are carried through. */
export function toInput(d: IgDraft, goLive: boolean): IgAutomationInput {
  const trigger: IgTrigger = d.target === "post" || d.target === "any" ? "comment" : d.target;
  const mention = trigger === "story_mention";
  return {
    name: d.name.trim(),
    trigger_type: trigger,
    keywords: mention || d.match === "any" ? [] : d.keywords,
    exclude_keywords: d.exclude_keywords,
    match_mode: d.match_mode,
    typo_tolerance: d.typo_tolerance,
    platform_post_id: d.target === "post" ? d.platform_post_id : null,
    dm_message: d.dm_message.trim(),
    dm_message_variations: d.dm_message_variations,
    buttons: d.buttons.filter((b) => b.title.trim() || b.url.trim()).map((b) => ({ title: b.title.trim(), url: b.url.trim() })),
    dm_delay_seconds: 0,
    // Story events have no comment to reply under.
    comment_reply: d.publicReply && (trigger === "comment" || trigger === "live_comment") ? d.comment_reply?.trim() || null : null,
    comment_reply_variations: d.publicReply ? d.comment_reply_variations : [],
    comment_reply_delay_seconds: 0,
    public_reply_policy: d.public_reply_policy,
    follow_gate: d.follow_gate,
    also_match_in_dms: d.also_match_in_dms && !mention && d.match === "words",
    repeat_mode: d.repeat_mode,
    cooldown_hours: d.repeat_mode === "every_comment" ? d.cooldown_hours ?? 24 : null,
    dedupe_same_text_hours: d.dedupe_same_text_hours,
    is_active: goLive,
  };
}

/** What blocks saving, worded for the owner (the server checks again). */
export function draftProblems(d: IgDraft): string[] {
  const out: string[] = [];
  if (!d.name.trim()) out.push("Give the automation a name.");
  if (d.target === "post" && !d.platform_post_id) out.push("Pick the post or reel to watch.");
  if (d.target !== "story_mention" && d.match === "words" && !d.keywords.length) out.push("Add at least one keyword, or choose “any word”.");
  if (!d.dm_message.trim()) out.push("Write the DM they will get.");
  const buttons = d.buttons.filter((b) => b.title.trim() || b.url.trim());
  if (buttons.length && d.dm_message.trim().length > 640) out.push("With link buttons, keep the DM under 640 characters.");
  else if (d.dm_message.trim().length > 1000) out.push("Keep the DM under 1000 characters.");
  for (const b of buttons) {
    if (!b.title.trim() || b.title.trim().length > 20) out.push("Each button needs a label of up to 20 characters.");
    else if (!/^https?:\/\/[^\s/$.?#][^\s]*$/i.test(b.url.trim())) out.push(`Button “${b.title.trim()}” needs a full link starting with https://.`);
  }
  if (d.publicReply && (d.target === "post" || d.target === "any" || d.target === "live_comment") && !d.comment_reply?.trim()) out.push("Write the public reply, or turn it off.");
  return [...new Set(out)];
}

/** Keywords typed as "price, link shop" → ["price", "link", "shop"] (lower-case, no duplicates). */
export function parseKeywords(text: string, existing: string[] = []): string[] {
  const seen = new Set(existing);
  for (const word of text.split(/[,\n]+/).map((w) => w.trim().toLowerCase().replace(/\s+/g, " ")).filter(Boolean)) seen.add(word.slice(0, 60));
  return [...seen].slice(0, 50);
}

/** The message as one person will see it, with the merge tags filled in. */
export function fillTags(text: string, person: { username: string; first_name?: string }): string {
  return text.replace(/\{\{\s*(first_name|username|name)\s*\}\}/gi, (_all, key: string) =>
    key.toLowerCase() === "username" ? person.username : person.first_name ?? person.username).replace(/[ \t]+([,.!?])/g, "$1");
}

/** One line describing an automation in the list. */
export function triggerSummary(a: Pick<IgAutomationInput, "trigger_type" | "platform_post_id" | "keywords">): string {
  const where = a.trigger_type === "story_reply" ? "Replies to your story"
    : a.trigger_type === "story_mention" ? "Story mentions"
    : a.trigger_type === "live_comment" ? "Live comments"
    : a.platform_post_id ? "Comments on one post" : "Comments on any post";
  if (a.trigger_type === "story_mention") return where;
  return `${where} · ${a.keywords.length ? a.keywords.map((k) => k.toUpperCase()).join(", ") : "any word"}`;
}

export const EVENT_LABELS: Record<IgEvent["kind"], string> = {
  dm_sent: "DM sent",
  dm_skipped: "Skipped",
  public_reply: "Replied under the comment",
  public_reply_failed: "Public reply failed",
  follow_gate_prompt: "Asked to follow first",
  follow_gate_unlock: "Followed, link sent",
  follow_gate_declined: "Not following yet",
  error: "Error",
};
