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
//   * Data tools are READ-ONLY and org-scoped (see tools.ts): the agent can look
//     up invoices, balances, low stock and customers for OWNER_USER_ID's org, but
//     cannot mutate anything. The service-role client bypasses RLS, so tools.ts
//     pins .eq("org_id", ...) on every query — that scope IS the tenant boundary.
//   * ponytail: WRITE tools (create invoice, mark paid, …) are deliberately not
//     exposed yet — add them behind an explicit confirm step, not as bare tools.
//   * ponytail: single-owner — every message maps to OWNER_USER_ID (one bot =
//     one install, matches the single-tenant desktop). Multi-user needs a
//     pairing table (chat_id -> user_id); add when SaaS multi-tenant lands.
//   * ponytail: WhatsApp/Slack = same pipe — add a parser branch + provider
//     send() here. WhatsApp also needs a Meta Business number + webhook
//     verification (their approval, out of scope of this code).

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parseTelegramUpdate } from "./parse.ts";
import { TOOLS, runTool } from "./tools.ts";

// deno-lint-ignore no-explicit-any
async function aiReply(userText: string, name: string, client: any, orgId: string | null): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return "My AI key isn't set up yet — ask the Filey admin to configure ANTHROPIC_API_KEY.";
  const model = Deno.env.get("AGENT_MODEL") ?? "claude-haiku-4-5-20251001";
  const canQuery = !!(client && orgId);
  const system =
    `You are Filey, ${name}'s personal assistant for their Filey ERP/CRM. ` +
    `Be concise, friendly and practical. ` +
    (canQuery
      ? `You can look up live business data with the provided tools — use them ` +
        `instead of guessing numbers, and quote figures in AED unless a row says ` +
        `otherwise. You can READ data but cannot change it yet; if asked to create ` +
        `or edit something, say that's coming soon.`
      : `You can chat and help think things through, but live data lookups aren't ` +
        `configured here — don't invent numbers.`);

  // deno-lint-ignore no-explicit-any
  const messages: any[] = [{ role: "user", content: userText }];

  try {
    // Tool-use loop: the model may call read tools a few times before answering.
    for (let round = 0; round < 4; round++) {
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
          ...(canQuery ? { tools: TOOLS } : {}),
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
            out = await runTool(client, orgId as string, block.name, block.input);
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

  const orgId = client ? await ownerOrgId(client, ownerId) : null;
  const reply = await aiReply(msg.body, msg.fromName, client, orgId);
  await sendTelegram(msg.externalId, reply);

  if (client) await log(client, ownerId, { externalId: msg.externalId, direction: "out", body: reply, raw: {} });

  return new Response("ok");
});
