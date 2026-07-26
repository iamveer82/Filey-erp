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
//   Optional:
//     AGENT_MODEL               default claude-haiku-4-5-20251001
//   Auto-provided by Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
//   ── Telegram ──
//     TELEGRAM_BOT_TOKEN        from @BotFather
//     TELEGRAM_WEBHOOK_SECRET   any long random string (REQUIRED — fail-closed)
//     TELEGRAM_OWNER_CHAT_ID    the owner's chat id (REQUIRED — fail-closed;
//                               message the bot once, it replies with the id)
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
//     WHATSAPP_APP_SECRET       OPTIONAL: Meta App Secret. When set, every POST
//                               must carry a valid X-Hub-Signature-256
//                               (HMAC-SHA256 of the raw body). When UNSET the
//                               signature check is SKIPPED — set it in prod.
//     Setup: Meta App → WhatsApp → Configuration → Webhook:
//       Callback URL = https://<project>.functions.supabase.co/channel-webhook
//       Verify token = WHATSAPP_VERIFY_TOKEN; subscribe to the `messages` field.
//       Meta verifies with GET (hub.mode/hub.verify_token/hub.challenge);
//       messages arrive as POST { object: "whatsapp_business_account", … }.
//
//   ── Slack (Events API) ──
//     SLACK_BOT_TOKEN           xoxb-… bot token (chat:write scope)
//     SLACK_SIGNING_SECRET      app's Signing Secret. When set, every request
//                               must carry a valid X-Slack-Signature
//                               (v0=HMAC-SHA256 of "v0:<ts>:<rawBody>") with a
//                               timestamp no older than 5 minutes (replay
//                               guard). When UNSET the check is SKIPPED —
//                               set it in prod.
//     SLACK_OWNER_USER_ID       the owner's Slack user id (U…)
//     Setup: api.slack.com → your app → Event Subscriptions → Request URL =
//       https://<project>.functions.supabase.co/channel-webhook (Slack sends a
//       url_verification handshake we answer with { challenge }); subscribe to
//       bot events message.im / message.channels (or use App Mentions).
//
// ── Security ─────────────────────────────────────────────────────────────────
//   * Fail-closed: each channel authenticates the caller (Telegram secret
//     header, Meta verify token + optional app-secret signature, Slack
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

type Channel = InboundMsg["channel"];

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
        `quote figures in AED unless a row says otherwise. You can also CREATE ` +
        `DRAFTS: invoices, quotations and purchase orders (saved as drafts ` +
        `${name} reviews and finalizes in Filey — never sent automatically), ` +
        `plus new customers and products. Look up the customer/supplier first ` +
        `so names match existing records. For payment reminders use ` +
        `request_payment_reminder: it returns an approval code — relay it and ` +
        `say to reply APPROVE <code> to actually send. You cannot finalize, ` +
        `pay, delete or edit existing records — if asked, say that needs to ` +
        `happen in Filey. After creating a draft, give its number and note ` +
        `it's waiting for review.\n\n`
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

/** Data interpolated into outgoing email HTML (customer names, invoice
 *  numbers) is org-entered, not trusted markup — escape it. */
const esc = (s: unknown) =>
  String(s ?? "").replace(/[<>&"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] ?? c
  );

/** APPROVE 1234 / CANCEL 1234 — the confirm step for external actions the
 *  agent proposed (agent_pending_actions). Returns a reply, or null when the
 *  message isn't an approval so the normal AI flow runs. */
// deno-lint-ignore no-explicit-any
async function handleApproval(client: any, ownerId: string, text: string): Promise<string | null> {
  const m = text.trim().match(/^(approve|cancel)\s+(\d{4})$/i);
  if (!m) return null;
  const verdict = m[1].toLowerCase();
  const code = m[2];

  const { data: row } = await client
    .from("agent_pending_actions")
    .select("*")
    .eq("user_id", ownerId)
    .eq("code", code)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!row) return `No pending action with code ${code}. It may have expired or already run.`;

  const ageMs = Date.now() - new Date(row.created_at).getTime();
  if (ageMs > 24 * 60 * 60 * 1000) {
    await client.from("agent_pending_actions").update({ status: "expired" }).eq("id", row.id);
    return `Code ${code} expired (older than 24h). Ask me again if you still want it.`;
  }

  if (verdict === "cancel") {
    await client.from("agent_pending_actions").update({ status: "rejected" }).eq("id", row.id);
    return `Canceled — nothing was sent.`;
  }

  if (row.action === "send_payment_reminder") {
    const p = row.payload ?? {};
    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) return "Approved, but RESEND_API_KEY isn't configured — email not sent.";
    const from = Deno.env.get("REMINDER_FROM") ?? "Filey <reminders@filey.app>";
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: p.customer_email,
        subject: `Reminder: invoice ${p.number} is awaiting payment`,
        html:
          `<p>Dear ${esc(p.customer_name ?? "customer")},</p>` +
          `<p>A friendly reminder that invoice <b>${esc(p.number)}</b>` +
          (p.due_date ? ` (due ${esc(p.due_date)})` : "") +
          ` is awaiting payment.</p><p>Thank you.</p>`,
      }),
    });
    if (!res.ok) {
      console.error("resend", res.status, await res.text());
      return "Approved, but the email failed to send — try again in a moment.";
    }
    await client
      .from("agent_pending_actions")
      .update({ status: "approved", executed_at: new Date().toISOString() })
      .eq("id", row.id);
    try {
      await client.from("audit_log").insert({
        user_id: ownerId,
        actor: "agent",
        action: "agent.send_payment_reminder",
        entity: `invoice_docs:${p.invoice_id}`,
        details: `Reminder for ${p.number} sent to ${p.customer_email} (approved ${code})`,
      });
    } catch { /* best-effort */ }
    return `✅ Sent — payment reminder for ${p.number} emailed to ${p.customer_email}.`;
  }

  return `I don't know how to execute "${row.action}" — it may need a newer agent version.`;
}

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

/** Lowercase hex of HMAC-SHA256(key, message) — WebCrypto, no deps. */
async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Slack Events API auth: X-Slack-Signature must be "v0=" + HMAC-SHA256 hex
 *  of `v0:<X-Slack-Request-Timestamp>:<rawBody>` keyed with
 *  SLACK_SIGNING_SECRET, and the timestamp must be within 5 minutes (replay
 *  guard). When SLACK_SIGNING_SECRET is unset the check is SKIPPED (see the
 *  deploy notes at the top — set it in production). */
async function verifySlackSignature(req: Request, rawBody: string): Promise<boolean> {
  const secret = Deno.env.get("SLACK_SIGNING_SECRET");
  if (!secret) {
    console.warn("SLACK_SIGNING_SECRET unset — skipping Slack signature check");
    return true;
  }
  const ts = req.headers.get("X-Slack-Request-Timestamp") ?? "";
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 5 * 60) {
    return false; // missing or older than 5 minutes → reject (replay guard)
  }
  const expected = "v0=" + (await hmacSha256Hex(secret, `v0:${ts}:${rawBody}`));
  return expected === (req.headers.get("X-Slack-Signature") ?? "");
}

/** WhatsApp Cloud API auth: when WHATSAPP_APP_SECRET is set, the
 *  X-Hub-Signature-256 header must be "sha256=" + HMAC-SHA256 hex of the raw
 *  body keyed with the app secret. When the secret is UNSET the check is
 *  SKIPPED (see the deploy notes at the top — set it in production). */
async function verifyWhatsAppSignature(req: Request, rawBody: string): Promise<boolean> {
  const secret = Deno.env.get("WHATSAPP_APP_SECRET");
  if (!secret) {
    console.warn("WHATSAPP_APP_SECRET unset — skipping WhatsApp signature check");
    return true;
  }
  const expected = "sha256=" + (await hmacSha256Hex(secret, rawBody));
  return expected === (req.headers.get("X-Hub-Signature-256") ?? "");
}

async function sendTelegram(chatId: string, text: string): Promise<void> {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) return void console.error("TELEGRAM_BOT_TOKEN not set");
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) console.error("telegram send", res.status, await res.text());
}

async function sendWhatsApp(phone: string, text: string): Promise<void> {
  const token = Deno.env.get("WHATSAPP_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
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
  const token = Deno.env.get("SLACK_BOT_TOKEN");
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

/** Owner pinning, fail-closed per channel (mirrors TELEGRAM_OWNER_CHAT_ID):
 *  WhatsApp compares digit-normalized phone numbers; Slack compares the
 *  sender's user id. Returns the refusal/guidance text to send back, or null
 *  when the sender IS the owner. */
function ownerRefusal(msg: InboundMsg): string | null {
  if (msg.channel === "whatsapp") {
    const owner = (Deno.env.get("WHATSAPP_OWNER_PHONE") ?? "").replace(/\D/g, "");
    const sender = msg.externalId.replace(/\D/g, "");
    if (sender === owner && owner) return null;
    console.warn("unpaired whatsapp sender", msg.externalId);
    return owner
      ? "Sorry — this is a private assistant."
      : `This assistant isn't paired yet. If you're the owner, set the ` +
        `WHATSAPP_OWNER_PHONE secret to ${msg.externalId} and redeploy.`;
  }
  if (msg.channel === "slack") {
    const owner = Deno.env.get("SLACK_OWNER_USER_ID") ?? "";
    if (owner && msg.userId === owner) return null;
    console.warn("unpaired slack user", msg.userId);
    return owner
      ? "Sorry — this is a private assistant."
      : `This assistant isn't paired yet. If you're the owner, set the ` +
        `SLACK_OWNER_USER_ID secret to ${msg.userId} and redeploy.`;
  }
  const owner = Deno.env.get("TELEGRAM_OWNER_CHAT_ID") ?? "";
  if (msg.externalId === owner && owner) return null;
  console.warn("unpaired chat", msg.externalId);
  return owner
    ? "Sorry — this is a private assistant."
    : `This assistant isn't paired yet. If you're the owner, set the ` +
      `TELEGRAM_OWNER_CHAT_ID secret to ${msg.externalId} and redeploy.`;
}

serve(async (req) => {
  // ── WhatsApp webhook verification (Meta calls GET once at setup) ──
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const expected = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";
    // Fail-closed: no configured verify token → nothing verifies.
    if (expected && mode === "subscribe" && token === expected && challenge !== null) {
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
  const type = (body as Record<string, unknown> | null)?.type;
  const object = (body as Record<string, unknown> | null)?.object;

  // ── Route by provider ──
  const channel: Channel =
    type === "url_verification" || type === "event_callback"
      ? "slack"
      : object === "whatsapp_business_account"
        ? "whatsapp"
        : "telegram";

  // ── Per-provider transport auth (fail-closed unless noted) ──
  if (channel === "telegram") {
    // Shared secret echoed by Telegram in this header.
    const secret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
    if (!secret || req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== secret) {
      return new Response("forbidden", { status: 403 });
    }
  } else if (channel === "slack") {
    if (!(await verifySlackSignature(req, rawBody))) {
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
    if (!(await verifyWhatsAppSignature(req, rawBody))) {
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
    // SECURITY: only the paired owner gets the agent (see ownerRefusal).
    const refusal = ownerRefusal(msg);
    if (refusal !== null) {
      await sendReply(msg, refusal);
      continue;
    }

    if (client) await log(client, ownerId, msg.channel, { externalId: msg.externalId, direction: "in", body: msg.body, raw: body });

    // Approvals bypass the model entirely — a confirm must be deterministic.
    const approval = client ? await handleApproval(client, ownerId, msg.body) : null;

    const orgId = client ? await ownerOrgId(client, ownerId) : null;
    const reply = approval ?? (await aiReply(msg.body, msg.fromName, client, orgId, ownerId, msg.channel, msg.externalId));
    await sendReply(msg, reply);

    if (client) await log(client, ownerId, msg.channel, { externalId: msg.externalId, direction: "out", body: reply, raw: {} });
  }

  return new Response("ok");
});
