// Supabase Edge Function: personal AI agent over chat channels
// (Telegram, WhatsApp, Slack).
//
// This is the "hosted relay" spine: a public webhook that runs 24/7 (no desktop
// needed), turns an inbound message into an AI reply, sends it back, and logs
// both directions to public.channel_messages so the desktop app can show the
// conversation live.
//
// ── Deploy ──────────────────────────────────────────────────────────────────
//   supabase functions deploy channel-webhook --no-verify-jwt
//   (--no-verify-jwt: Telegram/Meta/Slack call this with no Supabase JWT; we
//    authenticate the caller with per-provider secrets instead — see below.)
//
//   Required secrets (supabase secrets set KEY=value):
//     FILEY_AI_DEEPSEEK_KEY     hosted Filey AI's server-only model key
//     OWNER_USER_ID             auth.users.id this install belongs to (for logging)
//     WHATSAPP_APP_SECRET       Meta App Secret — REQUIRED for WhatsApp
//                               traffic (fail-closed: without it every POST
//                               is rejected)
//     SLACK_SIGNING_SECRET      Slack Signing Secret — REQUIRED for Slack
//                               traffic (fail-closed, same deal)
//   Auto-provided by Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
//   ── Telegram ──
//     TELEGRAM_BOT_TOKEN        from @BotFather
//     TELEGRAM_WEBHOOK_SECRET   any long random string (REQUIRED — fail-closed)
//     TELEGRAM_OWNER_CHAT_ID    the owner's chat id (REQUIRED — fail-closed;
//                               message the bot once, it replies with the id)
//     TELEGRAM_OWNER_USER_ID    the owner's numeric user id — REQUIRED before
//                               adding the bot to a GROUP chat: a group matches
//                               the chat pin for every member, so in groups the
//                               SENDER's user id must also match this secret or
//                               the message is refused. Private chats don't need
//                               it. Find it via @userinfobot.
//     Setup:
//       curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
//         -d "url=https://<project>.functions.supabase.co/channel-webhook" \
//         -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
//     (Telegram echoes secret_token back in X-Telegram-Bot-Api-Secret-Token.)
//
//   ── WhatsApp (Meta Cloud API) ──
//     WHATSAPP_TOKEN            permanent access token (System User)
//     WHATSAPP_PHONE_NUMBER_ID  the phone number id from Meta App → WhatsApp
//     WHATSAPP_VERIFY_TOKEN     any long random string you invent — pasted into
//                               Meta's webhook "Verify token" field (fail-closed)
//     WHATSAPP_OWNER_PHONE      the owner's phone (any format — compared
//                               digit-normalized, e.g. 9715XXXXXXX)
//     WHATSAPP_APP_SECRET       REQUIRED: Meta App Secret. Every POST must
//                               carry a valid X-Hub-Signature-256 (HMAC-SHA256
//                               of the raw body); unsigned posts are rejected.
//     Setup: Meta App → WhatsApp → Configuration → Webhook:
//       Callback URL = https://<project>.functions.supabase.co/channel-webhook
//       Verify token = WHATSAPP_VERIFY_TOKEN; subscribe to the `messages` field.
//       Meta verifies with GET (hub.mode/hub.verify_token/hub.challenge);
//       messages arrive as POST { object: "whatsapp_business_account", … }.
//
//   ── Slack (Events API) ──
//     SLACK_BOT_TOKEN           xoxb-… bot token (chat:write scope)
//     SLACK_SIGNING_SECRET      app's Signing Secret — REQUIRED (fail-closed):
//                               every request must carry a valid
//                               X-Slack-Signature (v0=HMAC-SHA256 of
//                               "v0:<ts>:<rawBody>") with a timestamp no
//                               older than 5 minutes (replay guard).
//     SLACK_OWNER_USER_ID       the owner's Slack user id (U…)
//     Setup: api.slack.com → your app → Event Subscriptions → Request URL =
//       https://<project>.functions.supabase.co/channel-webhook (Slack sends a
//       url_verification handshake we answer with { challenge }); subscribe to
//       bot events message.im / message.channels (or use App Mentions).
//
// ── Security ─────────────────────────────────────────────────────────────────
//   * Fail-closed: each channel authenticates the caller (Telegram secret
//     header, Meta verify token + REQUIRED app-secret signature, Slack
//     signing-secret signature + 5-minute timestamp window) and pins the
//     sender to a single owner (TELEGRAM_OWNER_CHAT_ID /
//     WHATSAPP_OWNER_PHONE / SLACK_OWNER_USER_ID). Transport auth proves the
//     message came from the provider, not WHO sent it — without the owner
//     pin, any stranger who finds the bot/channel could read business data,
//     create drafts and approve pending actions.
//   * The service-role key never leaves this process; clients can only READ
//     their own channel_messages rows (RLS).
//   * Data tools are org-scoped and require active owner/admin membership: the agent can look
//     up invoices, balances, low stock and customers for OWNER_USER_ID's org, but
//     creates only drafts/additive records directly. The service-role client bypasses RLS, so tools.ts
//     pins .eq("org_id", ...) on every query — that scope IS the tenant boundary.
//   * Write tools are DRAFT-ONLY (see tools.ts WRITE POLICY); anything with
//     external effect goes through agent_pending_actions + "APPROVE <code>".
//   * Memory: remember/recall tools store durable facts in agent_memories
//     (migration 2026-07-26-agent-memories.sql, RLS user_id = auth.uid()).
//     Both fail soft until the migration is applied.
//   * ponytail: single-owner — every message maps to OWNER_USER_ID (one bot =
//     one hosted install). Per-account desktop gateways use the full runtime;
//     multi-user hosted routing needs a
//     pairing table (chat_id -> user_id); add when SaaS multi-tenant lands.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type InboundMsg,
  isSlackUrlVerification,
  parseSlackEvent,
  parseTelegramUpdate,
  parseWhatsAppWebhook,
} from "./parse.ts";
import { aiReply } from "./agent.ts";
import { prepareChannelReply, sendApprovedChannelText, sendChannelReply, type ReplyAuthority } from "./delivery.ts";
import { rateLimit } from "../_shared/rateLimit.ts";
import { adminWorkspace } from "../_shared/admin-workspace.ts";
import {
  claimSeenMessage,
  readWebhookBody,
  timingSafeEqualStr,
  verifySlackSignature,
  verifyWhatsAppSignature,
} from "./security.ts";
// Approvals, pairing and owner pinning live in their own modules so they can
// be unit-tested without this file's server bootstrap. The pin resolver keeps
// its original name here; the pure logic is aliased in from access.ts.
import { handleApproval, type ApprovalIO } from "./approvals.ts";
import {
  ownerRefusal as ownerRefusalChecked,
  channelCredentials,
  channelActorAllowed,
  tryPair as tryPairChannel,
} from "./access.ts";

type Channel = InboundMsg["channel"];

/** Everything handleApproval needs from this process: env secrets, current
 *  authority, per-channel senders and the conversation logger.
 *  Built per message so the logger closes over the right client/owner. */
function approvalIOFor(
  // deno-lint-ignore no-explicit-any
  client: any,
  ownerId: string,
  orgId: string | null,
  msg: InboundMsg,
): ApprovalIO {
  const workspaceActive = async () => !!orgId && await adminWorkspace(client, ownerId) === orgId;
  const canExecute = async () => await channelActorAllowed(client, ownerId, msg, { env: (k) => Deno.env.get(k) }) && await workspaceActive();
  const approvedSend = (channel: Channel, to: string, text: string) =>
    sendApprovedChannelText(channel, to, text, { ...replyIO, canExecute });
  return {
    env: (k) => Deno.env.get(k),
    canExecute,
    workspaceActive,
    sendTelegram: (to, text) => approvedSend("telegram", to, text),
    sendWhatsApp: (to, text) => approvedSend("whatsapp", to, text),
    sendSlack: (to, text) => approvedSend("slack", to, text),
    logOutbound: (channel, externalId, body) =>
      log(client, ownerId, channel, { externalId, direction: "out", body, raw: { org_id: orgId } }),
  };
}


/** APPROVE 1234 / CANCEL 1234 handling now lives in approvals.ts (extracted
 *  for unit-testing); index.ts wires it up with env, senders and logging. */

/** PAIR <code> from a channel that is configured but not yet paired. This is
 *  the only way owner_ref gets set, and it is deliberately not "first sender
 *  wins" — whoever finds the bot first would otherwise own the books.
 *  Returns a reply when it handled the message, else null. */
// (moved to access.ts — throttled, timing-safe, audit-logged)

/** Hosted service-role tools require current owner/admin workspace access.
 *  A normal team membership cannot bypass module/RLS restrictions here. */
// deno-lint-ignore no-explicit-any
async function ownerOrgId(client: any, ownerId: string): Promise<string | null> {
  return await adminWorkspace(client, ownerId);
}

// (hmacSha256Hex and the per-provider signature verifiers moved to
// security.ts; they take the resolved secret so tests don't need env access.)

/** Credentials for a channel: the row this install configured through
 *  agent_channels wins, and the env secret an admin set by hand is the
 *  fallback. Always resolve current state so another isolate's disconnect or
 *  re-pairing takes effect on the next authority check.
 *  Explicitly disabled rows must never fall back to environment credentials.
 *
 *  Builds its own service-role client so the senders don't have to thread one
 *  down from the request handler. */
async function chanCreds(provider: Channel): Promise<Record<string, string>> {
  let creds: Record<string, string> = {};
  try {
    const owner = Deno.env.get("OWNER_USER_ID");
    if (owner) {
      const admin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      creds = await channelCredentials(admin,owner,provider);
    }
  } catch {
    // A failed lookup might hide a revoked connection. Do not resurrect old
    // environment credentials when its current state cannot be verified.
    throw new Error("Channel connection state could not be checked.");
  }
  return creds;
}

const replyIO = { credentials: chanCreds, env: (key: string) => Deno.env.get(key) };

function sendReply(msg: InboundMsg, text: string, authority: ReplyAuthority): Promise<string | null> {
  return sendChannelReply(msg, text, authority, replyIO);
}

// deno-lint-ignore no-explicit-any
async function log(client: any, ownerId: string, channel: Channel, row: {
  externalId: string;
  direction: "in" | "out";
  body: string;
  raw: unknown;
}): Promise<void> {
  try {
    await client.from("channel_messages").insert({
      user_id: ownerId,
      channel,
      external_id: row.externalId,
      direction: row.direction,
      body: row.body,
      raw: row.raw ?? {},
    });
  } catch (e) {
    console.error("log channel_messages", e); // best-effort; never blocks a reply
  }
}

/** Owner pinning (moved to access.ts) — index resolves the per-channel
 *  config and passes it in. */
async function ownerRefusal(msg: InboundMsg): Promise<string | null> {
  // A channel the agent connected itself pairs through agent_channels.owner_ref;
  // one an admin configured by hand still pairs through the env secret.
  const config = await chanCreds(msg.channel);
  const dbOwner = config.owner_ref ?? "";
  return ownerRefusalChecked(msg, { env: (k) => Deno.env.get(k), dbOwner, disabled: !!config.disabled, configured: !!config.configured });
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** The same pipeline the hosted channels run, except the reply is RETURNED
 *  rather than sent — the bridge already has the socket to answer on. */
async function handleBridgeMessage(msg: InboundMsg): Promise<string> {
  const ownerId = Deno.env.get("OWNER_USER_ID") ?? "";
  const url = Deno.env.get("SUPABASE_URL");
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const client = ownerId && url && svc ? createClient(url, svc) : null;

  // The bridge rides the same limiter discipline as the hosted channels —
  // it's a private machine, but a runaway script pointed at it shouldn't be
  // able to burn the owner's Filey Coins unbounded.
  if (client && !(await rateLimit(client, ownerId, "bridge_msg", 30, 3600))) {
    return "Rate limited — too many messages this hour.";
  }

  const paired = client
    ? await tryPairChannel(client, ownerId, msg, msg.body)
    : null;
  if (paired !== null) return paired;

  const refusal = await ownerRefusal(msg);
  if (refusal !== null) return refusal;

  const orgId = client ? await ownerOrgId(client, ownerId) : null;
  if (client) {
    await log(client, ownerId, "whatsapp", {
      externalId: msg.externalId,
      direction: "in",
      body: msg.body,
      raw: { message_id: msg.msgId ?? null, org_id: orgId },
    });
  }

  const io = client ? approvalIOFor(client, ownerId, orgId, msg) : null;
  const approval = io ? await handleApproval(client, ownerId, msg.body, io, msg, orgId) : null;
  const reply =
    approval ??
    (await aiReply(msg.body, msg.fromName, client, orgId, ownerId, msg.channel, msg.externalId,
      () => client ? channelActorAllowed(client, ownerId, msg, { env: (k) => Deno.env.get(k) }) : Promise.resolve(false), msg.msgId));

  if (client) {
    await log(client, ownerId, "whatsapp", {
      externalId: msg.externalId,
      direction: "out",
      body: reply,
      raw: { org_id: orgId },
    });
  }
  // Logging is awaited, so its earlier actor check is no longer sufficient
  // for the HTTP response consumed by the desktop WhatsApp bridge.
  return (await prepareChannelReply(msg, reply, {
    workspaceActive: io?.workspaceActive ?? (async () => false),
  }, replyIO))?.text ?? "";
}

serve(async (req) => {
 try {
  // ── WhatsApp webhook verification (Meta calls GET once at setup) ──
  if (req.method === "GET") {
    if ((await chanCreds("whatsapp")).disabled) return new Response("forbidden", { status: 403 });
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const expected =
      (await chanCreds("whatsapp")).verify_token ||
      Deno.env.get("WHATSAPP_VERIFY_TOKEN") ||
      "";
    // Fail-closed: no configured verify token → nothing verifies. The compare
    // is constant-time so the challenge can't be probed byte by byte.
    if (
      expected && mode === "subscribe" && challenge !== null &&
      (await timingSafeEqualStr(token ?? "", expected))
    ) {
      return new Response(challenge, {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }
    return new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("ok");
  if (!Deno.env.get("OWNER_USER_ID") || !Deno.env.get("SUPABASE_URL") || !Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))
    return new Response("connection unavailable", { status: 503 });

  // Read the RAW body first — Slack/WhatsApp signature checks need the exact
  // bytes, and JSON.parse(req.json()) would consume them.
  const rawBody = await readWebhookBody(req);
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response("ok");
  }
  // ── Local WhatsApp bridge ────────────────────────────────────────────────
  // A QR-paired WhatsApp session can't live here (edge functions are
  // stateless), so it runs on the owner's machine — see tools/wa-bridge. The
  // bridge is dumb transport: it POSTs {from, text} and gets the reply back in
  // the RESPONSE, which is why this path needs no outbound WhatsApp
  // credentials and costs nothing per message. Everything else — memory,
  // approvals, every tool — is the same agent as the official channels.
  const bridgeSecret = Deno.env.get("WA_BRIDGE_SECRET");
  const presentedSecret = req.headers.get("x-bridge-secret");
  if (presentedSecret) {
    // Fail-closed, constant-time compare on the shared secret.
    if (!bridgeSecret || !(await timingSafeEqualStr(presentedSecret, bridgeSecret))) {
      return new Response("forbidden", { status: 403 });
    }
    const b = body as Record<string, unknown>;
    const from = String(b.from ?? "").trim();
    const text = String(b.text ?? "").trim();
    if (!from || !text) return json({ reply: "" });

    const msg: InboundMsg = {
      channel: "whatsapp",
      externalId: from,
      body: text,
      fromName: String(b.fromName ?? "") || from,
    };
    const reply = await handleBridgeMessage(msg);
    return json({ reply });
  }

  const type = (body as Record<string, unknown> | null)?.type;
  const object = (body as Record<string, unknown> | null)?.object;

  // ── Route by provider ──
  const channel: Channel =
    type === "url_verification" || type === "event_callback"
      ? "slack"
      : object === "whatsapp_business_account"
        ? "whatsapp"
        : "telegram";

  // ── Per-provider transport auth (fail-closed — an unset secret rejects) ──
  if ((await chanCreds(channel)).disabled) return new Response("forbidden", { status: 403 });
  if (channel === "telegram") {
    // Shared secret echoed by Telegram in this header. Still fail-closed: a
    // self-connected channel stores its own secret in agent_channels.
    const secret =
      (await chanCreds("telegram")).webhook_secret ||
      Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
    const presented = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (!secret || !presented || !(await timingSafeEqualStr(presented, secret))) {
      return new Response("forbidden", { status: 403 });
    }
  } else if (channel === "slack") {
    const secret =
      (await chanCreds("slack")).signing_secret ||
      Deno.env.get("SLACK_SIGNING_SECRET");
    if (!(await verifySlackSignature(req, rawBody, secret))) {
      return new Response("forbidden", { status: 403 });
    }
    // Slack's one-time setup handshake — answered only after the signature
    // check, so the challenge can't be echoed by an unauthenticated caller.
    if (isSlackUrlVerification(body)) {
      const challenge = (body as Record<string, unknown>).challenge;
      return new Response(JSON.stringify({ challenge }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
  } else {
    const secret =
      (await chanCreds("whatsapp")).app_secret ||
      Deno.env.get("WHATSAPP_APP_SECRET");
    if (!(await verifyWhatsAppSignature(req, rawBody, secret))) {
      return new Response("forbidden", { status: 403 });
    }
  }

  // ── Normalize the payload into messages ──
  let msgs: InboundMsg[];
  if (channel === "whatsapp") {
    msgs = parseWhatsAppWebhook(body);
  } else {
    const msg = channel === "slack" ? parseSlackEvent(body) : parseTelegramUpdate(body);
    msgs = msg ? [msg] : [];
  }
  if (!msgs.length) return new Response("ok"); // ack so the provider stops retrying

  const ownerId = Deno.env.get("OWNER_USER_ID") ?? "";
  const url = Deno.env.get("SUPABASE_URL");
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const client = ownerId && url && svc ? createClient(url, svc) : null;

  for (const msg of msgs) {
    const paired = client
      ? await tryPairChannel(client, ownerId, msg, msg.body)
      : null;
    if (paired !== null) {
      await sendReply(msg, paired, "public");
      continue;
    }
    const refusal = await ownerRefusal(msg);
    if (refusal !== null) {
      await sendReply(msg, refusal, "public");
      continue;
    }
    // Receipts, non-text updates and strangers must not consume the owner's
    // model quota. Limit only authenticated, paired task messages.
    if (client && !(await rateLimit(client, ownerId, "channel_webhook", 30, 3600)))
      return new Response("rate limited", { status: 429 });
    // ── Inbound dedup: claim the provider's message id BEFORE any work. ──
    // Providers retry non-2xx deliveries, so once the marker is claimed we
    // must never fail this webhook again (see the try/catch below) — that
    // makes processing at-most-once per provider message id instead of
    // at-least-once-with-duplicate-replies.
    if (client && msg.msgId && !(await claimSeenMessage(client, channel, msg.msgId))) {
      continue; // redelivery of something we already handled → swallow
    }

    try {
      const orgId = client ? await ownerOrgId(client, ownerId) : null;
      if (client) await log(client, ownerId, msg.channel, { externalId: msg.externalId, direction: "in", body: msg.body, raw: { message_id: msg.msgId ?? null, org_id: orgId } });

      const io = client ? approvalIOFor(client, ownerId, orgId, msg) : null;
      // Approvals bypass the model entirely — a confirm must be deterministic.
      const approval = io ? await handleApproval(client, ownerId, msg.body, io, msg, orgId) : null;
      const reply = approval ?? (await aiReply(msg.body, msg.fromName, client, orgId, ownerId, msg.channel, msg.externalId,
        () => client ? channelActorAllowed(client, ownerId, msg, { env: (k) => Deno.env.get(k) }) : Promise.resolve(false), msg.msgId));
      const sent = await sendReply(msg, reply, {
        workspaceActive: io?.workspaceActive ?? (async () => false),
      });

      if (client && sent !== null) await log(client, ownerId, msg.channel, { externalId: msg.externalId, direction: "out", body: sent, raw: { org_id: orgId } });
    } catch (e) {
      // The dedup marker is already claimed, so a non-2xx here would make the
      // provider redeliver into a swallowed duplicate — fail SOFT instead and
      // leave a trail in audit_log/console for debugging.
      console.error("channel-webhook message failed (acked to provider)", e);
      if (client) {
        try {
          await client.from("audit_log").insert({
            user_id: ownerId,
            actor: "agent",
            action: "agent.message_error",
            entity: `${channel}:${msg.externalId}`,
            details: String(e).slice(0, 500),
          });
        } catch { /* best-effort */ }
      }
    }
  }

  return new Response("ok");
 } catch (error) {
   console.error("channel webhook unavailable", error instanceof Error ? error.name : "unknown");
   return new Response("temporarily unavailable", { status: error instanceof RangeError ? 413 : 503 });
 }
});
