// Approval engine for the channel agent: executes the external actions the
// agent PROPOSED once the owner replies APPROVE <code> on a channel.
// Split from index.ts so it's unit-testable without booting the server
// (same reasoning as parse.ts) — everything environment-specific arrives
// via the `io` handle below.
//
// RACE SAFETY: every terminal transition is a CONDITIONAL update —
// `.eq("id", …).eq("status", "pending")` followed by `.select()`, whose row
// count tells us whether THIS caller flipped the row. Two concurrent
// APPROVEs (or an APPROVE racing a CANCEL): exactly one wins, the loser is
// told "already handled" and never executes. Side effects only ever run
// AFTER winning the claim, so a reminder email / outbound message fires at
// most once per pending action.
//
// PAYLOAD HYGIENE: parked credentials (connect_channel tokens etc.) are
// scrubbed to "[scrubbed]" on every terminal transition — approved or not,
// nothing secret outlives its use.

import { randomCode } from "./security.ts";
import type { InboundMsg } from "./parse.ts";

export type Channel = InboundMsg["channel"];

/** Everything approvals need from the outside world. */
export interface ApprovalIO {
  env: (key: string) => string | undefined;
  forgetCreds: (provider: Channel) => void;
  /** Send a message out on a channel (used by the send_message executor). */
  sendTelegram(chatId: string, text: string): Promise<void>;
  sendWhatsApp(phone: string, text: string): Promise<void>;
  sendSlack(channelId: string, text: string): Promise<void>;
  /** Log an outbound message so the desktop conversation view shows it. */
  logOutbound(channel: Channel, externalId: string, body: string): Promise<void>;
}

/** Data interpolated into outgoing email HTML (customer names, invoice
 *  numbers) is org-entered, not trusted markup — escape it. */
export const esc = (s: unknown) =>
  String(s ?? "").replace(/[<>&"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] ?? c
  );

const SENSITIVE_PAYLOAD_KEYS = new Set([
  "token", "bot_token", "webhook_secret", "signing_secret",
  "pair_code", "secret", "password", "api_key", "app_secret", "verify_token",
]);

/** Shallow copy of the payload with credential-ish keys replaced by
 *  "[scrubbed]". Returns null when there was nothing to scrub so callers can
 *  skip the follow-up write entirely. */
export function scrubPayload(
  payload: unknown,
): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;
  const out = { ...(payload as Record<string, unknown>) };
  let touched = false;
  for (const k of Object.keys(out)) {
    if (SENSITIVE_PAYLOAD_KEYS.has(k)) {
      out[k] = "[scrubbed]";
      touched = true;
    }
  }
  return touched ? out : null;
}

/** The race gate. PostgREST reports only rows it actually updated, so this
 *  returns true exactly when THIS caller moved the row off "pending". */
async function claimPending(
  // deno-lint-ignore no-explicit-any
  client: any,
  id: string,
  ownerId: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  try {
    const { data, error } = await client
      .from("agent_pending_actions")
      .update(patch)
      .eq("id", id)
      .eq("user_id", ownerId)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .select("id");
    if (error) {
      console.error("claimPending", error.message ?? error);
      return false;
    }
    return Array.isArray(data) && data.length > 0;
  } catch (e) {
    console.error("claimPending", e);
    return false;
  }
}

/** APPROVE 1234 / CANCEL 1234 — the confirm step for external actions the
 *  agent proposed (agent_pending_actions). Returns a reply, or null when the
 *  message isn't an approval so the normal AI flow runs. */
export async function handleApproval(
  // deno-lint-ignore no-explicit-any
  client: any,
  ownerId: string,
  text: string,
  io: ApprovalIO,
  source?: Pick<InboundMsg, "channel" | "externalId">,
  currentOrg?: string | null,
): Promise<string | null> {
  const m = text.trim().match(/^(approve|cancel)\s+(\d{4})$/i);
  if (!m) return null;
  const verdict = m[1].toLowerCase();
  const code = m[2];

  // Expiry is part of the lookup itself: codes older than 24h simply don't
  // match, whatever their status column still says.
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: row, error } = await client
    .from("agent_pending_actions")
    .select("*")
    .eq("user_id", ownerId)
    .eq("code", code)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .gt("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return "I couldn't check that approval. Please try again.";
  if (!row)
    return `No pending action with code ${code}. It may have expired or already run.`;
  if (row.user_id !== ownerId) return "That approval is not available for this account.";
  // A code is a confirmation for one proposed conversation, never a reusable
  // capability from a different channel or an old unbound desktop proposal.
  if (source && (row.payload?.approval_channel !== source.channel || row.payload?.approval_chat_id !== source.externalId))
    return "Approve this action in the conversation where it was proposed, or ask me to propose it here again.";
  if (source && (!currentOrg || (row.action !== "connect_channel" && row.org_id !== currentOrg)))
    return "That action belongs to a different or unavailable workspace. Open Filey and propose it again from the current workspace.";

  const already = `Action ${row.code} was already handled — nothing re-ran.`;

  if (verdict === "cancel") {
    const scrubbed = scrubPayload(row.payload);
    const won = await claimPending(client, row.id, ownerId, {
      status: "rejected",
      ...(scrubbed ? { payload: scrubbed } : {}),
    });
    return won ? `Canceled — nothing was sent.` : already;
  }

  // Claim BEFORE any side effect: losing here means another APPROVE/CANCEL
  // got there first and the action must not fire a second time.
  const scrubbed = scrubPayload(row.payload);
  const won = await claimPending(client, row.id, ownerId, {
    status: "approved",
    ...(scrubbed ? { payload: scrubbed } : {}),
  });
  if (!won) return already;

  // Credentials were scrubbed atomically with the claim. Only this in-memory
  // row retains them, including when provider fetch or channel setup throws.

  if (row.action === "send_payment_reminder") {
    const p = row.payload ?? {};
    const key = io.env("RESEND_API_KEY");
    if (!key) return "Approved, but RESEND_API_KEY isn't configured — email not sent.";
    const from = io.env("REMINDER_FROM") ?? "Filey <reminders@filey.app>";
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        // Resend dedupes on this for 24h — a transport-level retry of the
        // same approval can't double-email the customer.
        "Idempotency-Key": String(row.id),
      },
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
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.error("resend", res.status, await res.text());
      return "Approved, but the email failed to send — ask me to propose it again.";
    }
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

  if (row.action === "send_message") {
    const p = row.payload ?? {};
    const chan = String(p.channel) as Channel;
    if (!["telegram", "whatsapp", "slack"].includes(chan) || typeof p.to !== "string" || !p.to.trim() || p.to.length>200
      || typeof p.text !== "string" || !p.text.trim() || p.text.length>4000)
      return "That proposed message is incomplete. Ask me to prepare it again; nothing was sent.";
    try {
      if (chan === "whatsapp") await io.sendWhatsApp(String(p.to), String(p.text));
      else if (chan === "slack") await io.sendSlack(String(p.to), String(p.text));
      else await io.sendTelegram(String(p.to), String(p.text));
    } catch (e) {
      console.error("send_message", e);
      return `Approved, but delivery on ${chan} was not confirmed. Check the conversation before asking me to send again; part of the message may have arrived.`;
    }
    try {
      // Logged as an outbound message on that channel so the desktop app's
      // conversation view shows what was sent in your name.
      await io.logOutbound(chan, String(p.to), String(p.text));
      await client.from("audit_log").insert({
        user_id: ownerId,
        actor: "agent",
        action: "agent.send_message",
        entity: `${chan}:${p.to}`,
        details: `Message sent to ${p.who ?? p.to} (approved ${code})`,
      });
    } catch { /* best-effort */ }
    return `✅ Sent on ${chan} to ${p.who ?? p.to}.`;
  }

  if (row.action === "connect_channel") {
    const p = row.payload ?? {};
    const provider = String(p.provider) as Channel;
    if (!["telegram", "whatsapp", "slack"].includes(provider) || !p.token ||
      (provider === "whatsapp" && (!p.phone_number_id || !p.app_secret)) ||
      (provider === "slack" && !p.signing_secret)) {
      return "Approved, but channel credentials are incomplete. Ask me to propose the connection again with the required verification secret.";
    }
    const rand = () => crypto.randomUUID().replace(/-/g, "");
    const pairCode = randomCode(6);

    const credentials: Record<string, string> =
      provider === "telegram"
        ? { bot_token: p.token, webhook_secret: rand(), pair_code: pairCode }
        : provider === "whatsapp"
          ? { token: p.token, phone_number_id: p.phone_number_id, app_secret: p.app_secret, verify_token: rand(), pair_code: pairCode }
          : { bot_token: p.token, signing_secret: p.signing_secret ?? "", pair_code: pairCode };
    credentials.pair_expires_at = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    // owner_ref stays null: the channel is configured but nobody is paired to
    // it yet, so ownerRefusal keeps refusing until the PAIR code arrives from
    // the new account. Connecting a channel must not hand it authority.
    const { error: ue } = await client.from("agent_channels").upsert(
      {
        user_id: ownerId,
        provider,
        credentials,
        owner_ref: null,
        enabled: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider" }
    );
    if (ue) {
      return "Approved, but saving the channel failed. Check the deployment and propose the connection again.";
    }
    io.forgetCreds(provider);

    if (provider === "telegram") {
      const base = (io.env("SUPABASE_URL") ?? "").replace(/\/+$/, "");
      let res: Response;
      try {
        res = await fetch(
          `https://api.telegram.org/bot${p.token}/setWebhook`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              url: `${base}/functions/v1/channel-webhook`,
              secret_token: credentials.webhook_secret,
            }),
            signal: AbortSignal.timeout(15000),
          }
        );
      } catch {
        return "Credentials saved, but Telegram webhook registration was not confirmed. Check the bot configuration and reconnect to get a new pairing code.";
      }
      const tg = await res.json().catch(() => null);
      if (!res.ok || !tg?.ok)
        return `Credentials saved, but Telegram rejected webhook registration (HTTP ${res.status}). Check the bot token and reconnect.`;
    }

    try {
      await client.from("audit_log").insert({
        user_id: ownerId,
        actor: "agent",
        action: "agent.connect_channel",
        entity: `agent_channels:${provider}`,
        details: `Channel ${provider} configured (approved ${code}); awaiting PAIR`,
      });
    } catch { /* best-effort */ }

    return (
      (provider === "telegram" ? `✅ Telegram webhook registered.`
        : provider === "whatsapp"
          ? `WhatsApp credentials saved. In Meta, set the callback to ${io.env("SUPABASE_URL")}/functions/v1/channel-webhook, set verify token ${credentials.verify_token}, and subscribe to messages.`
          : `Slack credentials saved. Set the Events API Request URL to ${io.env("SUPABASE_URL")}/functions/v1/channel-webhook and subscribe to message.im.`) +
      ` Now send a private message there within 15 minutes:\n\n` +
      `PAIR ${pairCode}\n\n` +
      `Until that arrives I'll refuse anyone on ${provider} — that code is what ` +
      `proves the account is yours.`
    );
  }

  if (row.action === "mark_invoice_paid") {
    // Flipping status alone invents a payment without recording its amount,
    // method or accounting entries. Legacy approvals must fail closed too.
    return "No payment was recorded. Open the invoice in Filey to record the payment and keep the books correct.";
  }

  return `I don't know how to execute "${row.action}" — it may need a newer agent version.`;
}
