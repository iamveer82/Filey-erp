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
  "pair_code", "secret", "password", "api_key",
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
  patch: Record<string, unknown>,
): Promise<boolean> {
  try {
    const { data, error } = await client
      .from("agent_pending_actions")
      .update(patch)
      .eq("id", id)
      .eq("status", "pending")
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
): Promise<string | null> {
  const m = text.trim().match(/^(approve|cancel)\s+(\d{4})$/i);
  if (!m) return null;
  const verdict = m[1].toLowerCase();
  const code = m[2];

  // Expiry is part of the lookup itself: codes older than 24h simply don't
  // match, whatever their status column still says.
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: row } = await client
    .from("agent_pending_actions")
    .select("*")
    .eq("user_id", ownerId)
    .eq("code", code)
    .eq("status", "pending")
    .gt("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!row)
    return `No pending action with code ${code}. It may have expired or already run.`;

  const already = `Action ${row.code} was already handled — nothing re-ran.`;

  if (verdict === "cancel") {
    const scrubbed = scrubPayload(row.payload);
    const won = await claimPending(client, row.id, {
      status: "rejected",
      ...(scrubbed ? { payload: scrubbed } : {}),
    });
    return won ? `Canceled — nothing was sent.` : already;
  }

  // Claim BEFORE any side effect: losing here means another APPROVE/CANCEL
  // got there first and the action must not fire a second time.
  const won = await claimPending(client, row.id, {
    status: "approved",
    executed_at: new Date().toISOString(),
  });
  if (!won) return already;

  // Terminal from here on — scrub parked credentials out of the payload.
  const scrubAfter = async () => {
    const scrubbed = scrubPayload(row.payload);
    if (scrubbed)
      await client.from("agent_pending_actions").update({ payload: scrubbed }).eq("id", row.id);
  };

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
    });
    if (!res.ok) {
      console.error("resend", res.status, await res.text());
      return "Approved, but the email failed to send — ask me to propose it again.";
    }
    await scrubAfter();
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
    try {
      if (chan === "whatsapp") await io.sendWhatsApp(String(p.to), String(p.text));
      else if (chan === "slack") await io.sendSlack(String(p.to), String(p.text));
      else await io.sendTelegram(String(p.to), String(p.text));
    } catch (e) {
      console.error("send_message", e);
      return `Approved, but sending on ${chan} failed — check the channel is still connected.`;
    }
    await scrubAfter();
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
    const rand = () => crypto.randomUUID().replace(/-/g, "");
    const pairCode = randomCode(6);

    const credentials: Record<string, string> =
      provider === "telegram"
        ? { bot_token: p.token, webhook_secret: rand(), pair_code: pairCode }
        : provider === "whatsapp"
          ? { token: p.token, phone_number_id: p.phone_number_id, pair_code: pairCode }
          : { bot_token: p.token, signing_secret: p.signing_secret ?? "", pair_code: pairCode };

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
    if (ue) return `Approved, but saving the channel failed: ${ue.message}`;

    if (provider === "telegram") {
      const base = (io.env("SUPABASE_URL") ?? "").replace(
        ".supabase.co",
        ".functions.supabase.co"
      );
      const res = await fetch(
        `https://api.telegram.org/bot${p.token}/setWebhook`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            url: `${base}/channel-webhook`,
            secret_token: credentials.webhook_secret,
          }),
        }
      );
      const tg = await res.json().catch(() => null);
      if (!tg?.ok)
        return `Approved and saved, but Telegram rejected the webhook: ${
          tg?.description ?? res.status
        }. Check the bot token.`;
    }

    io.forgetCreds(provider); // this isolate must not serve the old config
    await scrubAfter();
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
      `✅ ${provider} is wired up. Now message me there once with:\n\n` +
      `PAIR ${pairCode}\n\n` +
      `Until that arrives I'll refuse anyone on ${provider} — that code is what ` +
      `proves the account is yours.`
    );
  }

  if (row.action === "mark_invoice_paid") {
    const p = row.payload ?? {};
    // Org scope rides along on the pending action row itself.
    const { data: inv } = await client
      .from("invoice_docs")
      .select("id,number,status")
      .eq("user_id", ownerId)
      .eq("org_id", String(row.org_id ?? ""))
      .eq("id", p.invoice_id)
      .maybeSingle();
    if (!inv)
      return `Approved, but invoice ${p.invoice_number ?? ""} couldn't be found — no change made.`;
    if (inv.status !== "paid") {
      // Conditional flip: a payment recorded in the app between proposal and
      // approval must not be clobbered back into "paid" blindly.
      const { data: flipped, error: fe } = await client
        .from("invoice_docs")
        .update({ status: "paid" })
        .eq("id", inv.id)
        .eq("org_id", String(row.org_id ?? ""))
        .neq("status", "paid")
        .select("id");
      if (fe) {
        console.error("mark_invoice_paid", fe.message ?? fe);
        return `Approved, but marking ${p.invoice_number} paid failed — do it in Filey.`;
      }
      if (!flipped || !flipped.length)
        return `✅ Invoice ${inv.number} was already marked paid — nothing to do.`;
    }
    try {
      await client.from("audit_log").insert({
        user_id: ownerId,
        actor: "agent",
        action: "agent.mark_invoice_paid",
        entity: `invoice_docs:${inv.id}`,
        details:
          `${inv.number} marked paid by owner approval ${code} via chat channel`,
      });
    } catch { /* best-effort */ }
    return `✅ Invoice ${inv.number} is marked paid.`;
  }

  return `I don't know how to execute "${row.action}" — it may need a newer agent version.`;
}
