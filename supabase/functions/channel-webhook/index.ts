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
//     TELEGRAM_OWNER_CHAT_ID    the owner's chat id (REQUIRED — fail-closed;
//                               message the bot once, it replies with the id)
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
//   * Write tools are DRAFT-ONLY (see tools.ts WRITE POLICY); anything with
//     external effect goes through agent_pending_actions + "APPROVE <code>".
//   * ponytail: single-owner — every message maps to OWNER_USER_ID (one bot =
//     one install, matches the single-tenant desktop). Multi-user needs a
//     pairing table (chat_id -> user_id); add when SaaS multi-tenant lands.
//   * ponytail: WhatsApp/Slack = same pipe — add a parser branch + provider
//     send() here. WhatsApp also needs a Meta Business number + webhook
//     verification (their approval, out of scope of this code).

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parseTelegramUpdate } from "./parse.ts";
import { ALL_TOOLS, runTool } from "./tools.ts";

/** Last few logged turns for this chat — the agent's short-term memory, so it
 *  can follow "and the one before that?" like a person would. Consecutive
 *  same-direction rows are merged because the API wants alternating roles. */
// deno-lint-ignore no-explicit-any
async function recentHistory(client: any, ownerId: string, chatId: string): Promise<{ role: "user" | "assistant"; content: string }[]> {
  try {
    const { data } = await client
      .from("channel_messages")
      .select("direction,body")
      .eq("user_id", ownerId)
      .eq("channel", "telegram")
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

// deno-lint-ignore no-explicit-any
async function aiReply(userText: string, name: string, client: any, orgId: string | null, ownerId: string, chatId: string): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return "My AI key isn't set up yet — ask the Filey admin to configure ANTHROPIC_API_KEY.";
  const model = Deno.env.get("AGENT_MODEL") ?? "claude-haiku-4-5-20251001";
  const canQuery = !!(client && orgId);
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
        `it's waiting for review.`
      : `Live data lookups aren't configured here — you can chat and help think ` +
        `things through, but never invent numbers.`);

  // deno-lint-ignore no-explicit-any
  const messages: any[] = canQuery ? await recentHistory(client, ownerId, chatId) : [];
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

  // SECURITY: only the paired owner chat gets the agent. Fail-closed — the
  // webhook secret proves the message came from Telegram, not WHO sent it;
  // without this pin, any stranger who finds the bot could read business
  // data, create drafts and approve pending actions.
  const ownerChat = Deno.env.get("TELEGRAM_OWNER_CHAT_ID") ?? "";
  if (msg.externalId !== ownerChat) {
    console.warn("unpaired chat", msg.externalId);
    await sendTelegram(
      msg.externalId,
      ownerChat
        ? "Sorry — this is a private assistant."
        : `This assistant isn't paired yet. If you're the owner, set the ` +
          `TELEGRAM_OWNER_CHAT_ID secret to ${msg.externalId} and redeploy.`,
    );
    return new Response("ok");
  }

  const ownerId = Deno.env.get("OWNER_USER_ID") ?? "";
  const url = Deno.env.get("SUPABASE_URL");
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const client = ownerId && url && svc ? createClient(url, svc) : null;

  if (client) await log(client, ownerId, { externalId: msg.externalId, direction: "in", body: msg.body, raw: update });

  // Approvals bypass the model entirely — a confirm must be deterministic.
  const approval = client ? await handleApproval(client, ownerId, msg.body) : null;

  const orgId = client ? await ownerOrgId(client, ownerId) : null;
  const reply = approval ?? (await aiReply(msg.body, msg.fromName, client, orgId, ownerId, msg.externalId));
  await sendTelegram(msg.externalId, reply);

  if (client) await log(client, ownerId, { externalId: msg.externalId, direction: "out", body: reply, raw: {} });

  return new Response("ok");
});
