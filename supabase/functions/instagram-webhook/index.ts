// Instagram automation -- Meta webhook receiver.
//
// Public by necessity (Meta calls it directly). Trust model:
//   GET  -- Meta's one-time verification, checked against IG_WEBHOOK_VERIFY_TOKEN
//   POST -- X-Hub-Signature-256 HMAC with IG_APP_SECRET; handling is idempotent
//           via ig_seen_events and always returns 200 after a good signature
//           (Meta retries anything else and amplifies deliveries).
//
//   supabase functions deploy instagram-webhook --no-verify-jwt
//
// Secrets: IG_APP_SECRET, IG_WEBHOOK_VERIFY_TOKEN, IG_TRACK_URL (the ig-track
// function's public URL), optional IG_GRAPH_VERSION.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { readBillingBody, BillingRequestError } from "../_shared/billing-request.ts";
import {
  parseWebhookBody,
  verifyHubSignature,
  matchesKeywords,
  composeDmBody,
  composePublicReply,
  buildTrackedUrl,
  sha256Hex,
  followGatePayload,
  parseFollowGatePayload,
  type CommentEvent,
  type MessagingEvent,
} from "../_shared/instagram-core.ts";

const GRAPH_VERSION = Deno.env.get("IG_GRAPH_VERSION") ?? "v26.0";
/** Meta allows ~750 private replies/hour/account; keep a safety margin. */
const HOURLY_SEND_CAP = 700;
/** How long a follow-gate prompt stays resumable by any message. */
const FOLLOW_GATE_TTL_HOURS = 24;

const env = (name: string): string => (Deno.env.get(name) ?? "").trim();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  try {
    if (req.method === "GET") return handleVerify(req);
    if (req.method === "POST") return await handleNotifications(req);
    return json({ error: "Method not allowed." }, 405);
  } catch (error) {
    console.error("instagram-webhook", error instanceof Error ? error.message : error);
    // Meta must not retry-storm on our bugs -- 200 with a logged failure.
    if (req.method === "POST") return json({ ok: true });
    return json({ error: "Temporarily unavailable." }, 503);
  }
});

// -- Meta's one-time handshake -------------------------------------------------
function handleVerify(req: Request): Response {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = env("IG_WEBHOOK_VERIFY_TOKEN");
  if (!expected) return json({ error: "Webhooks are not configured." }, 503);
  if (mode === "subscribe" && token === expected && challenge)
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  return json({ error: "Verification failed." }, 403);
}

// -- Notifications -------------------------------------------------------------
async function handleNotifications(req: Request): Promise<Response> {
  const appSecret = env("IG_APP_SECRET");
  if (!appSecret) return json({ error: "Webhooks are not configured." }, 503);

  let raw: string;
  try {
    raw = await readBillingBody(req, 1_048_576);
  } catch (error) {
    if (error instanceof BillingRequestError) return json({ error: "Payload too large." }, 413);
    throw error;
  }
  if (!await verifyHubSignature(raw, req.headers.get("X-Hub-Signature-256"), appSecret))
    return json({ error: "Invalid signature." }, 403);

  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let parsed;
  try {
    parsed = parseWebhookBody(JSON.parse(raw || "{}"));
  } catch {
    return json({ error: "Invalid JSON." }, 400); // Meta won't retry on 400
  }

  const ownerIds = [...new Set([
    ...parsed.comments.map((e) => e.ownerId),
    ...parsed.messaging.map((e) => e.ownerId),
  ])];
  if (ownerIds.length === 0) return json({ ok: true });

  const { data: connectionRows } = await supa
    .from("ig_connections")
    .select("id, org_id, ig_user_id, access_token, token_expires_at, ig_username")
    .in("ig_user_id", ownerIds);
  const connections = new Map((connectionRows ?? []).map((row) => [row.ig_user_id, row]));
  const connectionByOwner = (ownerId: string) => connections.get(ownerId) ?? null;

  // Load every active automation for the accounts in this payload once.
  const automationByConnection = new Map<string, AutomationRow[]>();
  const knownConnectionIds = (connectionRows ?? []).map((r) => r.id);
  if (knownConnectionIds.length) {
    const { data: automationRows } = await supa
      .from("ig_automations")
      .select("*")
      .in("connection_id", knownConnectionIds)
      .eq("is_active", true);
    for (const row of automationRows ?? []) {
      const list = automationByConnection.get(row.connection_id) ?? [];
      list.push(row as unknown as AutomationRow);
      automationByConnection.set(row.connection_id, list);
    }
  }

  // Per-connection send budget for this hour.
  const sendBudget = new Map<string, number>();
  for (const ownerId of ownerIds) {
    const connection = connectionByOwner(ownerId);
    if (!connection) continue;
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await supa
      .from("ig_events")
      .select("id", { count: "exact", head: true })
      .eq("connection_id", connection.id)
      .eq("kind", "dm_sent")
      .gte("created_at", since);
    sendBudget.set(connection.id, Math.max(0, HOURLY_SEND_CAP - (count ?? 0)));
  }

  for (const event of parsed.comments) {
    const connection = connectionByOwner(event.ownerId);
    if (!connection) continue;
    const automations = automationByConnection.get(connection.id) ?? [];
    for (const automation of automations) {
      try {
        await handleComment(supa, connection, automation, event, sendBudget);
      } catch (error) {
        console.error("comment handler", error instanceof Error ? error.message : error);
        await logEvent(supa, connection, automation, "error", {
          actor_igsid: event.fromId,
          actor_username: event.username,
          comment_id: event.commentId,
          detail: { where: "handleComment", message: error instanceof Error ? error.message : String(error) },
        });
      }
    }
  }

  for (const event of parsed.messaging) {
    const connection = connectionByOwner(event.ownerId);
    if (!connection) continue;
    if (event.isSelf) continue;
    const automations = automationByConnection.get(connection.id) ?? [];
    for (const automation of automations) {
      try {
        await handleMessaging(supa, connection, automation, event, sendBudget);
      } catch (error) {
        console.error("messaging handler", error instanceof Error ? error.message : error);
        await logEvent(supa, connection, automation, "error", {
          actor_igsid: event.senderId,
          detail: { where: "handleMessaging", message: error instanceof Error ? error.message : String(error) },
        });
      }
    }
  }

  return json({ ok: true });
}

// -- Comment / live-comment / story-mention door ------------------------------
interface ConnectionRow {
  id: string;
  org_id: string;
  ig_user_id: string;
  access_token: string;
  token_expires_at: string | null;
  ig_username: string;
}
interface AutomationRow {
  id: string;
  org_id: string;
  connection_id: string;
  trigger_type: "comment" | "live_comment" | "story_reply" | "story_mention";
  keywords: string[];
  exclude_keywords: string[];
  match_mode: "exact" | "word" | "contains";
  typo_tolerance: boolean;
  platform_post_id: string | null;
  dm_message: string;
  dm_message_variations: string[] | null;
  buttons: { title: string; url: string }[] | null;
  comment_reply: string | null;
  comment_reply_variations: string[] | null;
  public_reply_policy: "after_dm" | "always";
  follow_gate: boolean;
  also_match_in_dms: boolean;
  repeat_mode: "once" | "every_comment";
  cooldown_hours: number | null;
  dedupe_same_text_hours: number | null;
}

async function handleComment(
  supa: SupabaseClient,
  connection: ConnectionRow,
  automation: AutomationRow,
  event: CommentEvent,
  sendBudget: Map<string, number>
): Promise<void> {
  if (event.fromId === connection.ig_user_id) return; // never answer ourselves
  const isLive = event.kind === "live_comment";
  const storyMention = event.mediaProductType === "story";
  const triggerMatches =
    automation.trigger_type === "live_comment" ? isLive
    : automation.trigger_type === "story_mention" ? storyMention
    : automation.trigger_type === "comment" && !isLive && !storyMention;
  if (!triggerMatches) return;

  if (automation.platform_post_id && automation.platform_post_id !== event.mediaId) return;
  // Story mentions carry no text -- they fire regardless of keywords.
  const textMatches = storyMention
    ? true
    : matchesKeywords(event.text, automation.keywords, automation.exclude_keywords, automation.match_mode, automation.typo_tolerance);
  if (!textMatches) return;

  // Idempotency: one DM per (automation, comment), however often Meta retries.
  if (!await claimSeen(supa, automation.id, `comment:${event.commentId}`, connection.org_id)) return;

  const actor = { igsid: event.fromId, username: event.username };
  const text = await composeDmText(automation, actor);
  if (!await repeatAllowed(supa, automation, actor.igsid))
    return logSkip(supa, connection, automation, actor, event.commentId, "repeat_policy");
  if (!await sameTextAllowed(supa, automation, actor.igsid, text))
    return logSkip(supa, connection, automation, actor, event.commentId, "same_text_dedupe");
  if (!takeBudget(sendBudget, connection.id))
    return logSkip(supa, connection, automation, actor, event.commentId, "hourly_cap");

  const sent = await sendAutomationDm(supa, connection, automation, actor, { commentId: event.commentId }, text);
  if (sent.ok) {
    await logEvent(supa, connection, automation, "dm_sent", {
      actor_igsid: actor.igsid,
      actor_username: actor.username,
      comment_id: event.commentId,
      message_id: sent.messageId ?? null,
      detail: { follow_gate: automation.follow_gate, text_sha256: await sha256Hex(text) },
    });
    await maybePublicReply(supa, connection, automation, actor, event.commentId, true);
  } else {
    await logEvent(supa, connection, automation, "error", {
      actor_igsid: actor.igsid,
      actor_username: actor.username,
      comment_id: event.commentId,
      detail: { where: "send_private_reply", ...sent.detail },
    });
    if (automation.public_reply_policy === "always")
      await maybePublicReply(supa, connection, automation, actor, event.commentId, false);
  }
}

// -- Messaging door (story replies, inbound DMs, follow-gate taps) ------------
async function handleMessaging(
  supa: SupabaseClient,
  connection: ConnectionRow,
  automation: AutomationRow,
  event: MessagingEvent,
  sendBudget: Map<string, number>
): Promise<void> {
  // 1) Follow-gate taps -- only postbacks with our prefix.
  if (event.kind === "postback") {
    const gateId = parseFollowGatePayload(event.postbackPayload);
    if (gateId !== automation.id) return;
    if (event.mid && !await claimSeen(supa, automation.id, `gate:${event.mid}`, connection.org_id)) return;
    await unlockFollowGate(supa, connection, automation, event);
    return;
  }
  if (event.kind !== "message") return;

  // 2) Follow-gate rescue: any message after we asked lets us re-check the
  //    follow relationship (the conversation exists, so profile access works).
  if (await hasPendingFollowGatePrompt(supa, automation, event.senderId)) {
    if (event.mid && !await claimSeen(supa, automation.id, `gate:${event.mid}`, connection.org_id)) return;
    await unlockFollowGate(supa, connection, automation, event);
    return;
  }

  // 3) Story replies and story mentions.
  const storyReply = !!event.replyToStoryId;
  const storyMention = event.storyMention;
  const triggerMatches =
    automation.trigger_type === "story_reply" ? storyReply
    : automation.trigger_type === "story_mention" ? storyMention
    : false;
  if (triggerMatches) {
    if (!storyMention &&
        !matchesKeywords(event.text, automation.keywords, automation.exclude_keywords, automation.match_mode, automation.typo_tolerance))
      return;
    if (!event.mid) return; // without a mid there is no idempotency anchor
    if (!await claimSeen(supa, automation.id, `mid:${event.mid}`, connection.org_id)) return;
    const actor = { igsid: event.senderId, username: "" };
    const text = await composeDmText(automation, actor);
    if (!await repeatAllowed(supa, automation, actor.igsid))
      return logSkip(supa, connection, automation, actor, null, "repeat_policy");
    if (!await sameTextAllowed(supa, automation, actor.igsid, text))
      return logSkip(supa, connection, automation, actor, null, "same_text_dedupe");
    if (!takeBudget(sendBudget, connection.id))
      return logSkip(supa, connection, automation, actor, null, "hourly_cap");
    const sent = await sendAutomationDm(supa, connection, automation, actor, { recipientId: event.senderId }, text);
    await logEvent(supa, connection, automation, sent.ok ? "dm_sent" : "error", {
      actor_igsid: actor.igsid,
      mid: event.mid,
      message_id: sent.messageId ?? null,
      detail: sent.ok
        ? { story: storyReply ? "reply" : "mention", text_sha256: await sha256Hex(text) }
        : { where: "send_story_reply", ...sent.detail },
    });
    return;
  }

  // 4) "Also answer people who DM the keyword" (plain inbound DMs).
  if (!automation.also_match_in_dms || automation.keywords.length === 0) return;
  if (!event.text.trim()) return;
  if (!matchesKeywords(event.text, automation.keywords, automation.exclude_keywords, automation.match_mode, automation.typo_tolerance)) return;
  if (!event.mid) return;
  if (!await claimSeen(supa, automation.id, `mid:${event.mid}`, connection.org_id)) return;
  const actor = { igsid: event.senderId, username: "" };
  const text = await composeDmText(automation, actor);
  if (!await repeatAllowed(supa, automation, actor.igsid))
    return logSkip(supa, connection, automation, actor, null, "repeat_policy");
  if (!await sameTextAllowed(supa, automation, actor.igsid, text))
    return logSkip(supa, connection, automation, actor, null, "same_text_dedupe");
  if (!takeBudget(sendBudget, connection.id))
    return logSkip(supa, connection, automation, actor, null, "hourly_cap");
  const sent = await sendAutomationDm(supa, connection, automation, actor, { recipientId: event.senderId }, text);
  await logEvent(supa, connection, automation, sent.ok ? "dm_sent" : "error", {
    actor_igsid: actor.igsid,
    mid: event.mid,
    message_id: sent.messageId ?? null,
    detail: sent.ok
      ? { door: "inbound_dm", text_sha256: await sha256Hex(text) }
      : { where: "send_inbound_dm", ...sent.detail },
  });
}

// -- Composing & sending -------------------------------------------------------
interface Actor {
  igsid: string;
  username: string;
}
interface SendTarget {
  commentId?: string;
  recipientId?: string;
}
interface SentResult {
  ok: boolean;
  messageId?: string;
  detail?: Record<string, unknown>;
}

async function composeDmText(
  automation: AutomationRow,
  actor: Actor
): Promise<string> {
  const username = actor.username.replace(/^@/, "");
  const persona = { first_name: username, username, name: username };
  return composeDmBody(
    { dm_message: automation.dm_message, dm_message_variations: automation.dm_message_variations ?? [] },
    persona
  );
}

async function sendAutomationDm(
  supa: SupabaseClient,
  connection: ConnectionRow,
  automation: AutomationRow,
  actor: Actor,
  target: SendTarget,
  text: string
): Promise<SentResult> {
  const buttons = (automation.buttons ?? []).filter((b) => b?.url && b?.title).slice(0, 3);
  const followGate = automation.follow_gate === true;
  const recipient = target.commentId
    ? { comment_id: target.commentId }
    : { id: target.recipientId };

  // Button template carries the text (<=640) plus up to 3 buttons. URL button
  // links are swapped for tracked redirect URLs so clicks are counted.
  const templateButtons = followGate
    ? [{ type: "postback", title: "Send me the link", payload: followGatePayload(automation.id) }]
    : await Promise.all(
        buttons.map(async (button, index) => ({
          type: "web_url" as const,
          title: button.title.slice(0, 20),
          url: await trackedUrl(supa, automation, index, button.url),
        }))
      );

  // Non-followers cannot receive templates; try the rich shape, then fall back
  // to plain text with the links inline -- never strand someone without the link.
  if (templateButtons.length > 0) {
    const rich = await graphSend(connection.access_token, {
      recipient,
      message: {
        attachment: {
          type: "template",
          payload: { template_type: "button", text, buttons: templateButtons },
        },
      },
    });
    if (rich.ok) {
      if (followGate) await logFollowGatePrompt(supa, connection, automation, actor, target);
      return { ok: true, messageId: rich.messageId };
    }
    const fallbackText = followGate
      ? `${text}\n\nReply to this message and I'll send the link.`
      : withLinksInline(text, buttons);
    const fallback = await graphSend(connection.access_token, {
      recipient,
      message: { text: fallbackText },
    });
    if (fallback.ok) {
      if (followGate) await logFollowGatePrompt(supa, connection, automation, actor, target);
      return { ok: true, messageId: fallback.messageId };
    }
    return { ok: false, detail: { rich: rich.detail, fallback: fallback.detail } };
  }

  const plain = await graphSend(connection.access_token, {
    recipient,
    message: { text },
  });
  if (plain.ok) return { ok: true, messageId: plain.messageId };
  return { ok: false, detail: plain.detail };
}

async function trackedUrl(
  supa: SupabaseClient,
  automation: AutomationRow,
  index: number,
  fallback: string
): Promise<string> {
  const base = env("IG_TRACK_URL");
  if (!base) return fallback;
  const { data } = await supa
    .from("ig_tracked_links")
    .select("id, target_url")
    .eq("automation_id", automation.id)
    .eq("button_index", index)
    .maybeSingle();
  if (!data) return fallback;
  return buildTrackedUrl(base, data.id as string);
}

function withLinksInline(text: string, buttons: { title: string; url: string }[]): string {
  const links = buttons.map((b) => `${b.title}: ${b.url}`).join("\n");
  return links ? `${text}\n\n${links}` : text;
}

// For follow-gate DMs: log a prompt row so hasPendingFollowGatePrompt works,
// and the rescue path can re-send the link when a non-follower replies.
async function logFollowGatePrompt(
  supa: SupabaseClient,
  connection: ConnectionRow,
  automation: AutomationRow,
  actor: Actor,
  target: SendTarget
): Promise<void> {
  const { error } = await supa.from("ig_events").insert({
    org_id: connection.org_id,
    automation_id: automation.id,
    connection_id: connection.id,
    kind: "follow_gate_prompt",
    actor_igsid: actor.igsid,
    actor_username: actor.username || null,
    comment_id: target.commentId ?? null,
    mid: null,
    detail: {},
  });
  if (error) console.error("ig_events follow_gate_prompt", error.message);
}

async function graphSend(
  token: string,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; messageId?: string; detail?: Record<string, unknown> }> {
  const res = await fetch(`https://graph.instagram.com/${GRAPH_VERSION}/me/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
    redirect: "error",
  });
  const body = await res.json().catch(() => null) as Record<string, unknown> | null;
  if (res.ok) {
    const messageId = typeof body?.message_id === "string" ? body.message_id : undefined;
    return { ok: true, messageId };
  }
  const error = (body as { error?: { code?: number; message?: string; error_user_msg?: string } } | null)?.error;
  return {
    ok: false,
    detail: {
      graph_status: res.status,
      code: error?.code ?? null,
      error: error?.error_user_msg ?? error?.message ?? "Graph request failed",
    },
  };
}

async function maybePublicReply(
  supa: SupabaseClient,
  connection: ConnectionRow,
  automation: AutomationRow,
  actor: Actor,
  commentId: string,
  dmSent: boolean
): Promise<void> {
  const want = automation.public_reply_policy === "always" || dmSent;
  if (!want) return;
  const handle = actor.username.replace(/^@/, "");
  const persona = { first_name: handle, username: handle, name: handle };
  const message = composePublicReply(
    { comment_reply: automation.comment_reply, comment_reply_variations: automation.comment_reply_variations ?? [] },
    persona
  );
  if (!message) return;
  const res = await fetch(`https://graph.instagram.com/${GRAPH_VERSION}/${commentId}/replies`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${connection.access_token}` },
    body: JSON.stringify({ message }),
    redirect: "error",
  });
  const body = await res.json().catch(() => null) as Record<string, unknown> | null;
  const error = (body as { error?: { code?: number; message?: string; error_user_msg?: string } } | null)?.error;
  await logEvent(supa, connection, automation, res.ok ? "public_reply" : "public_reply_failed", {
    actor_igsid: actor.igsid,
    actor_username: actor.username,
    comment_id: commentId,
    detail: res.ok
      ? { comment_reply_id: (body as { id?: string } | null)?.id ?? null }
      : { status: res.status, error: error?.error_user_msg ?? error?.message ?? null },
  });
}

// -- Follow gate ---------------------------------------------------------------
async function hasPendingFollowGatePrompt(
  supa: SupabaseClient,
  automation: AutomationRow,
  actorIgsid: string
): Promise<boolean> {
  const since = new Date(Date.now() - FOLLOW_GATE_TTL_HOURS * 3600_000).toISOString();
  const { count } = await supa
    .from("ig_events")
    .select("id", { count: "exact", head: true })
    .eq("automation_id", automation.id)
    .eq("actor_igsid", actorIgsid)
    .eq("kind", "follow_gate_prompt")
    .gte("created_at", since);
  return (count ?? 0) > 0;
}

async function unlockFollowGate(
  supa: SupabaseClient,
  connection: ConnectionRow,
  automation: AutomationRow,
  event: MessagingEvent
): Promise<void> {
  const actor: Actor = { igsid: event.senderId, username: "" };
  // The person messaged us, so profile access exists -- but it can still fail
  // for brand-new contacts. Fail open (send the link), log the miss.
  let follows = true;
  let profileOk = true;
  try {
    const profile = await fetchProfile(connection.access_token, event.senderId);
    follows = profile.is_user_follow_business === true;
    actor.username = profile.username ?? "";
  } catch {
    profileOk = false;
  }

  if (!profileOk || follows) {
    const text = await composeDmText(automation, actor);
    // The gate is passed: send the link buttons, not the "Send me the link" prompt again.
    const sent = await sendAutomationDm(supa, connection, { ...automation, follow_gate: false }, actor, { recipientId: event.senderId }, text);
    await logEvent(supa, connection, automation, sent.ok ? "follow_gate_unlock" : "error", {
      actor_igsid: event.senderId,
      actor_username: actor.username,
      mid: event.mid || null,
      detail: sent.ok
        ? { profile_lookup: profileOk ? "ok" : "failed_open" }
        : { where: "send_unlock", ...sent.detail },
    });
    return;
  }

  // Not following yet -- re-prompt with the same button.
  const handle = connection.ig_username ? `@${connection.ig_username}` : "the account";
  const message = `Follow ${handle}, then tap the button again and I'll send it over.`;
  const res = await graphSend(connection.access_token, {
    recipient: { id: event.senderId },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: message,
          buttons: [{ type: "postback", title: "Send me the link", payload: followGatePayload(automation.id) }],
        },
      },
    },
  });
  await logEvent(supa, connection, automation, "follow_gate_declined", {
    actor_igsid: event.senderId,
    mid: event.mid || null,
    detail: { resend: res.ok, status: res.ok ? null : res.detail?.graph_status ?? null },
  });
}

async function fetchProfile(
  token: string,
  igsid: string
): Promise<{ is_user_follow_business?: boolean; username?: string }> {
  const res = await fetch(
    `https://graph.instagram.com/${GRAPH_VERSION}/${igsid}?fields=is_user_follow_business,username&access_token=${encodeURIComponent(token)}`,
    { redirect: "error" }
  );
  const body = await res.json().catch(() => null) as Record<string, unknown> | null;
  if (!res.ok) throw new Error("profile lookup failed");
  return {
    is_user_follow_business: body?.is_user_follow_business === true,
    username: typeof body?.username === "string" ? body.username : undefined,
  };
}

// -- Policy helpers --------------------------------------------------------------
async function claimSeen(
  supa: SupabaseClient,
  automationId: string,
  key: string,
  orgId: string
): Promise<boolean> {
  const { error } = await supa
    .from("ig_seen_events")
    .insert({ key: `${automationId}:${key}`, org_id: orgId });
  // ponytail: prune on ~1% of claims instead of a cron job; add pg_cron if volume grows.
  if (Math.random() < 0.01)
    await supa.from("ig_seen_events").delete().lt("expires_at", new Date().toISOString());
  if (!error) return true;
  // 23505 unique violation -- this exact event was already handled.
  if ((error as { code?: string }).code === "23505") return false;
  throw error;
}

async function repeatAllowed(
  supa: SupabaseClient,
  automation: AutomationRow,
  actorIgsid: string
): Promise<boolean> {
  if (automation.repeat_mode === "every_comment") {
    if (!automation.cooldown_hours) return true;
    const since = new Date(Date.now() - automation.cooldown_hours * 3600_000).toISOString();
    const { count } = await supa
      .from("ig_events")
      .select("id", { count: "exact", head: true })
      .eq("automation_id", automation.id)
      .eq("actor_igsid", actorIgsid)
      .eq("kind", "dm_sent")
      .gte("created_at", since);
    return (count ?? 0) === 0;
  }
  // "once" -- one DM per person per automation, ever.
  const { count } = await supa
    .from("ig_events")
    .select("id", { count: "exact", head: true })
    .eq("automation_id", automation.id)
    .eq("actor_igsid", actorIgsid)
    .eq("kind", "dm_sent");
  return (count ?? 0) === 0;
}

async function sameTextAllowed(
  supa: SupabaseClient,
  automation: AutomationRow,
  actorIgsid: string,
  text: string
): Promise<boolean> {
  if (!automation.dedupe_same_text_hours) return true;
  const hash = await sha256Hex(text);
  const since = new Date(Date.now() - automation.dedupe_same_text_hours * 3600_000).toISOString();
  const { data } = await supa
    .from("ig_events")
    .select("id")
    .eq("org_id", automation.org_id)
    .eq("actor_igsid", actorIgsid)
    .eq("kind", "dm_sent")
    .gte("created_at", since)
    .contains("detail", { text_sha256: hash })
    .limit(1);
  return !data || data.length === 0;
}

function takeBudget(sendBudget: Map<string, number>, connectionId: string): boolean {
  const left = sendBudget.get(connectionId);
  if (left === undefined) return true;
  if (left <= 0) return false;
  sendBudget.set(connectionId, left - 1);
  return true;
}

// -- Logging helpers -------------------------------------------------------------
interface EventFields {
  actor_igsid?: string | null;
  actor_username?: string | null;
  comment_id?: string | null;
  mid?: string | null;
  message_id?: string | null;
  detail?: Record<string, unknown>;
}

async function logEvent(
  supa: SupabaseClient,
  connection: ConnectionRow,
  automation: { id: string } | null,
  kind: string,
  fields: EventFields
): Promise<void> {
  const { error } = await supa.from("ig_events").insert({
    org_id: connection.org_id,
    automation_id: automation?.id ?? null,
    connection_id: connection.id,
    kind,
    actor_igsid: fields.actor_igsid ?? null,
    actor_username: fields.actor_username ?? null,
    comment_id: fields.comment_id ?? null,
    mid: fields.mid ?? null,
    message_id: fields.message_id ?? null,
    detail: fields.detail ?? {},
  });
  if (error) console.error("ig_events insert", error.message);
}

async function logSkip(
  supa: SupabaseClient,
  connection: ConnectionRow,
  automation: AutomationRow,
  actor: Actor,
  commentId: string | null,
  reason: string
): Promise<void> {
  await logEvent(supa, connection, automation, "dm_skipped", {
    actor_igsid: actor.igsid,
    actor_username: actor.username,
    comment_id: commentId,
    detail: { reason },
  });
}
