// Supabase Edge Function: personal AI agent over chat channels (Telegram first).
//
// This is the "hosted relay" spine: a public webhook that runs 24/7 (no desktop
// needed), turns an inbound message into an AI reply, sends it back, and logs
// both directions to public.channel_messages so the desktop app can show the
// conversation live.
//
// ── Deploy ──────────────────────────────────────────────────────────────────
//   supabase functions deploy channel-webhook --no-verify-jwt
//   (--no-verify-jwt: Telegram/Meta call this with no Supabase JWT; we
//    authenticate the caller with a shared secret token instead — see below.)
//
//   Required secrets (supabase secrets set KEY=value):
//     TELEGRAM_BOT_TOKEN        from @BotFather
//     TELEGRAM_WEBHOOK_SECRET   any long random string (REQUIRED — fail-closed)
//     ANTHROPIC_API_KEY         the agent's model key
//     OWNER_USER_ID             auth.users.id this install belongs to (for logging)
//   Optional:
//     AGENT_MODEL               default claude-haiku-4-5-20251001
//   Auto-provided by Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
//   Point the bot at this function (note the secret_token — Telegram echoes it
//   back in the X-Telegram-Bot-Api-Secret-Token header so we can verify it):
//     curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
//       -d "url=https://<project>.functions.supabase.co/channel-webhook" \
//       -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
//
// ── Security ─────────────────────────────────────────────────────────────────
//   * Fail-closed: if TELEGRAM_WEBHOOK_SECRET is unset OR the header doesn't
//     match, every request is rejected. Without this anyone could POST fake
//     updates and make the agent talk.
//   * The service-role key never leaves this process; clients can only READ
//     their own channel_messages rows (RLS).
//   * ponytail: v1 has NO Filey data/write tools — a public channel cannot read
//     or mutate ERP data yet. Add read tools first (org_id-scoped + tested),
//     gate writes behind explicit confirmation, before exposing them here.
//   * ponytail: single-owner — every message maps to OWNER_USER_ID (one bot =
//     one install, matches the single-tenant desktop). Multi-user needs a
//     pairing table (chat_id -> user_id); add when SaaS multi-tenant lands.
//   * ponytail: WhatsApp/Slack = same pipe — add a parser branch + provider
//     send() here. WhatsApp also needs a Meta Business number + webhook
//     verification (their approval, out of scope of this code).

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parseTelegramUpdate } from "./parse.ts";

async function aiReply(userText: string, name: string): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return "My AI key isn't set up yet — ask the Filey admin to configure ANTHROPIC_API_KEY.";
  const model = Deno.env.get("AGENT_MODEL") ?? "claude-haiku-4-5-20251001";
  try {
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
        system:
          `You are Filey, ${name}'s personal assistant for their Filey ERP/CRM. ` +
          `Be concise, friendly, and practical. You can chat and help think things through. ` +
          `Direct access to invoices, customers and accounting data is coming soon — if asked ` +
          `to look something up in the system, say that briefly rather than inventing numbers.`,
        messages: [{ role: "user", content: userText }],
      }),
    });
    if (!res.ok) {
      console.error("anthropic", res.status, await res.text());
      return "Sorry — I hit an error reaching my brain. Try again in a moment.";
    }
    const data = await res.json();
    const text = data?.content?.[0]?.text;
    return typeof text === "string" && text.trim() ? text : "…";
  } catch (e) {
    console.error("anthropic fetch", e);
    return "Sorry — I couldn't reach my brain just now. Try again shortly.";
  }
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

// deno-lint-ignore no-explicit-any
async function log(client: any, ownerId: string, row: {
  externalId: string;
  direction: "in" | "out";
  body: string;
  raw: unknown;
}): Promise<void> {
  try {
    await client.from("channel_messages").insert({
      user_id: ownerId,
      channel: "telegram",
      external_id: row.externalId,
      direction: row.direction,
      body: row.body,
      raw: row.raw ?? {},
    });
  } catch (e) {
    console.error("log channel_messages", e); // best-effort; never blocks a reply
  }
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("ok"); // Telegram only POSTs

  // Fail-closed auth: shared secret echoed by Telegram in this header.
  const secret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
  if (!secret || req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== secret) {
    return new Response("forbidden", { status: 403 });
  }

  let update: unknown;
  try {
    update = await req.json();
  } catch {
    return new Response("ok");
  }

  const msg = parseTelegramUpdate(update);
  if (!msg) return new Response("ok"); // ack so Telegram stops retrying

  const ownerId = Deno.env.get("OWNER_USER_ID") ?? "";
  const url = Deno.env.get("SUPABASE_URL");
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const client = ownerId && url && svc ? createClient(url, svc) : null;

  if (client) await log(client, ownerId, { externalId: msg.externalId, direction: "in", body: msg.body, raw: update });

  const reply = await aiReply(msg.body, msg.fromName);
  await sendTelegram(msg.externalId, reply);

  if (client) await log(client, ownerId, { externalId: msg.externalId, direction: "out", body: reply, raw: {} });

  return new Response("ok");
});
