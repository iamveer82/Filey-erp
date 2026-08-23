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
//     ANTHROPIC_API_KEY         the agent's model key
//     OWNER_USER_ID             auth.users.id this install belongs to (for logging)
//     WHATSAPP_APP_SECRET       Meta App Secret — REQUIRED for WhatsApp
//                               traffic (fail-closed: without it every POST
//                               is rejected)
//     SLACK_SIGNING_SECRET      Slack Signing Secret — REQUIRED for Slack
//                               traffic (fail-closed, same deal)
//   Optional:
//     AGENT_MODEL               default claude-haiku-4-5-20251001
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
//   * Data tools are READ-ONLY and org-scoped (see tools.ts): the agent can look
//     up invoices, balances, low stock and customers for OWNER_USER_ID's org, but
//     cannot mutate anything. The service-role client bypasses RLS, so tools.ts
//     pins .eq("org_id", ...) on every query — that scope IS the tenant boundary.
//   * Write tools are DRAFT-ONLY (see tools.ts WRITE POLICY); anything with
//     external effect goes through agent_pending_actions + "APPROVE <code>".
//   * Memory: remember/recall tools store durable facts in agent_memories
//     (migration 2026-07-26-agent-memories.sql, RLS user_id = auth.uid()).
//     Both fail soft until the migration is applied.
//   * ponytail: single-owner — every message maps to OWNER_USER_ID (one bot =
//     one install, matches the single-tenant desktop). Multi-user needs a
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
import { ALL_TOOLS, runTool } from "./tools.ts";
import { rateLimit, logAction } from "../_shared/rateLimit.ts";
import {
  claimSeenMessage,
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
  tryPair as tryPairChannel,
} from "./access.ts";

type Channel = InboundMsg["channel"];

/** Everything handleApproval needs from this process: env secrets, the
 *  credentials cache, the per-channel senders and the conversation logger.
 *  Built per message so the logger closes over the right client/owner. */
function approvalIOFor(
  // deno-lint-ignore no-explicit-any
  client: any,
  ownerId: string,
): ApprovalIO {
  return {
    env: (k) => Deno.env.get(k),
    forgetCreds: (p) => credsCache.delete(p),
    sendTelegram,
    sendWhatsApp,
    sendSlack,
    logOutbound: (channel, externalId, body) =>
      log(client, ownerId, channel, { externalId, direction: "out", body, raw: {} }),
  };
}

/** Last few logged turns for this conversation — the agent's short-term
 *  memory, so it can follow "and the one before that?" like a person would.
 *  Consecutive same-direction rows are merged because the API wants
 *  alternating roles. */
// deno-lint-ignore no-explicit-any
async function recentHistory(client: any, ownerId: string, channel: Channel, chatId: string): Promise<{ role: "user" | "assistant"; content: string }[]> {
  try {
    const { data } = await client
      .from("channel_messages")
      .select("direction,body")
      .eq("user_id", ownerId)
      .eq("channel", channel)
      .eq("external_id", chatId)
      .order("created_at", { ascending: false })
      .limit(12);
    const turns: { role: "user" | "assistant"; content: string }[] = [];
    // deno-lint-ignore no-explicit-any
    for (const r of ((data ?? []) as any[]).reverse()) {
      const role = r.direction === "in" ? "user" : "assistant";
      const body = String(r.body ?? "").slice(0, 1500);
      if (!body) continue;
      const last = turns[turns.length - 1];
      if (last && last.role === role) last.content += "\n" + body;
      else turns.push({ role, content: body });
    }
    while (turns.length && turns[0].role === "assistant") turns.shift();
    return turns;
  } catch (e) {
    console.error("recentHistory", e);
    return [];
  }
}

/** Durable long-term memories for the system prompt. Fail-soft: any error
 *  (e.g. the agent_memories migration hasn't been applied yet) → no block. */
// deno-lint-ignore no-explicit-any
async function loadMemories(client: any, ownerId: string): Promise<string[]> {
  try {
    const { data, error } = await client
      .from("agent_memories")
      .select("text,tag")
      .eq("user_id", ownerId)
      .order("updated_at", { ascending: false })
      .limit(12);
    if (error) {
      console.error("loadMemories", error.message ?? error);
      return [];
    }
    // deno-lint-ignore no-explicit-any
    return (data ?? []).map((m: any) => String(m.text ?? "").trim()).filter(Boolean);
  } catch (e) {
    console.error("loadMemories", e);
    return [];
  }
}

// deno-lint-ignore no-explicit-any
async function aiReply(userText: string, name: string, client: any, orgId: string | null, ownerId: string, channel: Channel, chatId: string): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return "My AI key isn't set up yet — ask the Filey admin to configure ANTHROPIC_API_KEY.";
  const model = Deno.env.get("AGENT_MODEL") ?? "claude-haiku-4-5-20251001";
  const canQuery = !!(client && orgId);
  const memories = client ? await loadMemories(client, ownerId) : [];
  const system =
    `You are Filey, ${name}'s business copilot on chat, wired into their Filey ERP/CRM.\n\n` +
    `Voice: a sharp, trusted colleague — warm, plain language, contractions fine, ` +
    `no corporate filler, never mention being an AI or "tools". Reply in the ` +
    `user's language. Plain text only, no markdown — this renders in a chat app. ` +
    `Lead with the answer, then at most two or three supporting facts. Round big ` +
    `numbers the way people say them (AED 12.4k, not AED 12,437.51). Never dump ` +
    `raw lists — give the top few and offer to go deeper.\n\n` +
    `Thinking: work out what ${name} actually needs before answering; a vague ` +
    `question usually has an obvious business intent — answer that and state ` +
    `your assumption in a few words. Ask at most ONE short clarifying question, ` +
    `and only when the answer genuinely forks. Use the fewest lookups that ` +
    `settle the question. If something in the data deserves attention (overdue ` +
    `invoices piling up, stock about to run out), add one short heads-up at the ` +
    `end — like a colleague would.\n\n` +
    (canQuery
      ? `You can look up live business data — use it instead of guessing, and ` +
        `quote figures in AED unless a row says otherwise. Beyond the basics ` +
        `there's an accountant's toolkit: full invoice detail (get_invoice_detail), ` +
        `output/input VAT over a period (get_vat_summary), spending by category ` +
        `(list_expenses / expense_totals) and what the stock is worth ` +
        `(stock_valuation). You can also CREATE DRAFTS: invoices, quotations and ` +
        `purchase orders (saved as drafts ${name} reviews and finalizes in Filey — ` +
        `never sent automatically), plus new customers, products and logged ` +
        `expenses (log_expense). Look up the customer/supplier first so names ` +
        `match existing records. For payment reminders use ` +
        `request_payment_reminder; to mark an invoice PAID use ` +
        `propose_mark_invoice_paid — both return an approval code, never claim ` +
        `anything happened until the owner replies APPROVE <code>. You cannot ` +
        `finalize, send, delete or edit existing records — if asked, say that ` +
        `needs to happen in Filey. After creating a draft, give its number and ` +
        `note it's waiting for review.\n\n`
      : `Live data lookups aren't configured here — you can chat and help think ` +
        `things through, but never invent numbers.\n\n`) +
    (canQuery
      ? (memories.length
          ? `MEMORY — durable facts you've learned about this user/business ` +
            `(trust these over defaults, but re-check anything time-sensitive):\n` +
            memories.map((m) => `- ${m}`).join("\n") +
            `\n\n`
          : `MEMORY — you have no saved long-term memories yet.\n\n`) +
        `Long-term memory: when ${name} shares a durable fact, preference, ` +
        `standing instruction, or corrects you, save it with the remember tool ` +
        `(one crisp sentence; re-saving the same fact refreshes it). Don't ` +
        `remember transient one-off details. Use the recall tool to search ` +
        `older memories that may have fallen out of this conversation.`
      : "");

  // deno-lint-ignore no-explicit-any
  const messages: any[] = canQuery ? await recentHistory(client, ownerId, channel, chatId) : [];
  // The inbound message was logged before this call, so history usually ends
  // with it already; append only if logging missed it.
  const tail = messages[messages.length - 1];
  if (!tail || tail.role !== "user" || tail.content !== userText) {
    messages.push({ role: "user", content: userText });
  }

  try {
    // Tool-use loop: lookup → draft chains need a few rounds.
    for (let round = 0; round < 6; round++) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          system,
          messages,
          ...(canQuery ? { tools: ALL_TOOLS } : {}),
        }),
      });
      if (!res.ok) {
        console.error("anthropic", res.status, await res.text());
        return "Sorry — I hit an error reaching my brain. Try again in a moment.";
      }
      const data = await res.json();
      const content = Array.isArray(data?.content) ? data.content : [];

      if (data?.stop_reason === "tool_use" && canQuery) {
        messages.push({ role: "assistant", content });
        // deno-lint-ignore no-explicit-any
        const results: any[] = [];
        for (const block of content) {
          if (block?.type !== "tool_use") continue;
          let out: unknown;
          try {
            out = await runTool(client, orgId as string, block.name, block.input, ownerId);
          } catch (e) {
            out = { error: String(e) };
          }
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(out).slice(0, 6000),
          });
        }
        messages.push({ role: "user", content: results });
        continue;
      }

      // deno-lint-ignore no-explicit-any
      const text = content.find((b: any) => b?.type === "text")?.text;
      return typeof text === "string" && text.trim() ? text : "…";
    }
    return "I looked into that but couldn't wrap it up — try asking a bit more specifically.";
  } catch (e) {
    console.error("anthropic fetch", e);
    return "Sorry — I couldn't reach my brain just now. Try again shortly.";
  }
}

/** APPROVE 1234 / CANCEL 1234 handling now lives in approvals.ts (extracted
 *  for unit-testing); index.ts wires it up with env, senders and logging. */

/** PAIR <code> from a channel that is configured but not yet paired. This is
 *  the only way owner_ref gets set, and it is deliberately not "first sender
 *  wins" — whoever finds the bot first would otherwise own the books.
 *  Returns a reply when it handled the message, else null. */
// (moved to access.ts — throttled, timing-safe, audit-logged)

/** The org whose data this install can read. Single-owner: derived from the
 *  owner's profile. Null disables data tools (chat-only fallback). */
// deno-lint-ignore no-explicit-any
async function ownerOrgId(client: any, ownerId: string): Promise<string | null> {
  try {
    const { data } = await client.from("profiles").select("org_id").eq("id", ownerId).maybeSingle();
    return data?.org_id ?? null;
  } catch (e) {
    console.error("ownerOrgId", e);
    return null;
  }
}

// (hmacSha256Hex and the per-provider signature verifiers moved to
// security.ts; they take the resolved secret so tests don't need env access.)

/** Credentials for a channel: the row this install configured through
 *  agent_channels wins, and the env secret an admin set by hand is the
 *  fallback. That ordering is what lets the agent connect a NEW channel from
 *  an existing one — an edge function cannot write its own env, but it can
 *  write a table. Cached per isolate; a change lands on the next cold start.
 *
 *  Builds its own service-role client so the senders don't have to thread one
 *  down from the request handler. */
const credsCache = new Map<string, Record<string, string>>();
async function chanCreds(provider: Channel): Promise<Record<string, string>> {
  const hit = credsCache.get(provider);
  if (hit) return hit;
  let creds: Record<string, string> = {};
  try {
    const owner = Deno.env.get("OWNER_USER_ID");
    if (owner) {
      const admin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      const { data } = await admin
        .from("agent_channels")
        .select("credentials,enabled,owner_ref")
        .eq("user_id", owner)
        .eq("provider", provider)
        .maybeSingle();
      if (data?.enabled)
        creds = {
          ...((data.credentials ?? {}) as Record<string, string>),
          // Flattened alongside the secrets so callers get the paired owner
          // (chat id / phone / slack uid) from the same lookup.
          ...(data.owner_ref ? { owner_ref: String(data.owner_ref) } : {}),
        };
    }
  } catch {
    /* table missing or unreachable — fall back to env */
  }
  credsCache.set(provider, creds);
  return creds;
}

async function sendTelegram(chatId: string, text: string): Promise<void> {
  const token =
    (await chanCreds("telegram")).bot_token || Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) return void console.error("TELEGRAM_BOT_TOKEN not set");
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) console.error("telegram send", res.status, await res.text());
}

async function sendWhatsApp(phone: string, text: string): Promise<void> {
  const c = await chanCreds("whatsapp");
  const token = c.token || Deno.env.get("WHATSAPP_TOKEN");
  const phoneNumberId = c.phone_number_id || Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneNumberId) {
    return void console.error("WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set");
  }
  const res = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone,
      text: { body: text },
    }),
  });
  if (!res.ok) console.error("whatsapp send", res.status, await res.text());
}

async function sendSlack(channel: string, text: string): Promise<void> {
  const token =
    (await chanCreds("slack")).bot_token || Deno.env.get("SLACK_BOT_TOKEN");
  if (!token) return void console.error("SLACK_BOT_TOKEN not set");
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ channel, text }),
  });
  // Slack returns HTTP 200 even for API errors — check the ok flag too.
  if (!res.ok) {
    console.error("slack send", res.status, await res.text());
    return;
  }
  const data = await res.json().catch(() => null);
  if (!data?.ok) console.error("slack send", JSON.stringify(data));
}

function sendReply(msg: InboundMsg, text: string): Promise<void> {
  if (msg.channel === "whatsapp") return sendWhatsApp(msg.externalId, text);
  if (msg.channel === "slack") return sendSlack(msg.externalId, text);
  return sendTelegram(msg.externalId, text);
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
  const dbOwner = (await chanCreds(msg.channel)).owner_ref ?? "";
  return ownerRefusalChecked(msg, { env: (k) => Deno.env.get(k), dbOwner });
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** The same pipeline the hosted channels run, except the reply is RETURNED
 *  rather than sent — the bridge already has the socket to answer on. */
async function handleBridgeMessage(msg: InboundMsg, raw: unknown): Promise<string> {
  const ownerId = Deno.env.get("OWNER_USER_ID") ?? "";
  const url = Deno.env.get("SUPABASE_URL");
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const client = ownerId && url && svc ? createClient(url, svc) : null;

  // The bridge rides the same limiter discipline as the hosted channels —
  // it's a private machine, but a runaway script pointed at it shouldn't be
  // able to burn Anthropic tokens unbounded.
  if (client && !(await rateLimit(client, ownerId, "bridge_msg", 30, 3600))) {
    return "Rate limited — too many messages this hour.";
  }

  const paired = client
    ? await tryPairChannel(client, ownerId, msg, msg.body, () => credsCache.delete(msg.channel))
    : null;
  if (paired !== null) return paired;

  const refusal = await ownerRefusal(msg);
  if (refusal !== null) return refusal;

  if (client) {
    await log(client, ownerId, "whatsapp", {
      externalId: msg.externalId,
      direction: "in",
      body: msg.body,
      raw,
    });
  }

  const io = client ? approvalIOFor(client, ownerId) : null;
  const approval = io ? await handleApproval(client, ownerId, msg.body, io) : null;
  const orgId = client ? await ownerOrgId(client, ownerId) : null;
  const reply =
    approval ??
    (await aiReply(msg.body, msg.fromName, client, orgId, ownerId, msg.channel, msg.externalId));

  if (client) {
    await log(client, ownerId, "whatsapp", {
      externalId: msg.externalId,
      direction: "out",
      body: reply,
      raw: {},
    });
  }
  return reply;
}

serve(async (req) => {
  // ── WhatsApp webhook verification (Meta calls GET once at setup) ──
  if (req.method === "GET") {
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

  // Read the RAW body first — Slack/WhatsApp signature checks need the exact
  // bytes, and JSON.parse(req.json()) would consume them.
  const rawBody = await req.text();
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
    const reply = await handleBridgeMessage(msg, body);
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

  // RATE LIMIT: max 30 messages per hour per install (prevents spam flood).
  // NOTE: this block runs BEFORE parsing the payload into a message, so it
  // must not reference message fields (an earlier version read msg.externalId
  // here and crashed with a TDZ error whenever OWNER_USER_ID was set).
  const OWNER = Deno.env.get("OWNER_USER_ID") ?? "";
  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  if (OWNER) {
    const allowed = await rateLimit(supa, OWNER, "channel_webhook", 30, 3600);
    if (!allowed) return new Response("rate limited", { status: 429 });
    await logAction(supa, OWNER, "channel_webhook", { channel });
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
    // ── Inbound dedup: claim the provider's message id BEFORE any work. ──
    // Providers retry non-2xx deliveries, so once the marker is claimed we
    // must never fail this webhook again (see the try/catch below) — that
    // makes processing at-most-once per provider message id instead of
    // at-least-once-with-duplicate-replies.
    if (client && msg.msgId && !(await claimSeenMessage(client, channel, msg.msgId))) {
      continue; // redelivery of something we already handled → swallow
    }

    try {
      // A channel the agent connected itself arrives here unpaired: the only
      // message it accepts is the PAIR code, and only until that code is spent.
      const paired = client
        ? await tryPairChannel(
            client,
            ownerId,
            msg,
            msg.body,
            () => credsCache.delete(msg.channel),
          )
        : null;
      if (paired !== null) {
        await sendReply(msg, paired);
        continue;
      }

      // SECURITY: only the paired owner gets the agent (see ownerRefusal).
      const refusal = await ownerRefusal(msg);
      if (refusal !== null) {
        await sendReply(msg, refusal);
        continue;
      }

      if (client) await log(client, ownerId, msg.channel, { externalId: msg.externalId, direction: "in", body: msg.body, raw: body });

      const io = client ? approvalIOFor(client, ownerId) : null;
      // Approvals bypass the model entirely — a confirm must be deterministic.
      const approval = io ? await handleApproval(client, ownerId, msg.body, io) : null;

      const orgId = client ? await ownerOrgId(client, ownerId) : null;
      const reply = approval ?? (await aiReply(msg.body, msg.fromName, client, orgId, ownerId, msg.channel, msg.externalId));
      await sendReply(msg, reply);

      if (client) await log(client, ownerId, msg.channel, { externalId: msg.externalId, direction: "out", body: reply, raw: {} });
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
});
