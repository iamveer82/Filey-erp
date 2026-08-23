// Owner pinning + pairing for the channel webhook, split out of index.ts so
// it's unit-testable without booting the server (same reasoning as parse.ts).
// Transport auth (webhook signatures) lives in security.ts; this module is
// about WHO is allowed to talk: every branch here fails closed.
//
// The caller resolves per-channel config (agent_channels row / env secrets)
// and passes it in — nothing in this file reads Deno.env directly, so tests
// can pin identities without touching process state.

import { rateLimit, logAction } from "../_shared/rateLimit.ts";
import { timingSafeEqualStr } from "./security.ts";
import type { InboundMsg } from "./parse.ts";

export interface AccessIO {
  env: (key: string) => string | undefined;
}

/** Owner pinning, fail-closed per channel (mirrors TELEGRAM_OWNER_CHAT_ID):
 *  WhatsApp compares digit-normalized phone numbers; Slack compares the
 *  sender's user id. Returns the refusal/guidance text to send back, or null
 *  when the sender IS the owner. */
export async function ownerRefusal(
  msg: InboundMsg,
  io: AccessIO & { dbOwner: string },
): Promise<string | null> {
  const dbOwner = io.dbOwner;
  if (msg.channel === "whatsapp") {
    const owner = (dbOwner || io.env("WHATSAPP_OWNER_PHONE") || "").replace(/\D/g, "");
    const sender = msg.externalId.replace(/\D/g, "");
    if (owner && sender && await timingSafeEqualStr(sender, owner)) return null;
    console.warn("unpaired whatsapp sender", msg.externalId);
    return owner
      ? "Sorry — this is a private assistant."
      : `This assistant isn't paired yet. If you're the owner, set the ` +
        `WHATSAPP_OWNER_PHONE secret to ${msg.externalId} and redeploy.`;
  }
  if (msg.channel === "slack") {
    const owner = dbOwner || io.env("SLACK_OWNER_USER_ID") || "";
    if (owner && msg.userId && await timingSafeEqualStr(msg.userId, owner)) return null;
    console.warn("unpaired slack user", msg.userId);
    return owner
      ? "Sorry — this is a private assistant."
      : `This assistant isn't paired yet. If you're the owner, set the ` +
        `SLACK_OWNER_USER_ID secret to ${msg.userId} and redeploy.`;
  }

  // Telegram: the chat pin alone was enough for DMs, but a bot added to a
  // GROUP matches its chat id for every member — without a second pin any
  // group member could read the books. So in groups the sender's USER id
  // must also match TELEGRAM_OWNER_USER_ID, and if that secret is unset we
  // refuse outright (fail closed). The refusal stays generic there: guidance
  // naming secrets must never be posted into a room full of strangers.
  const owner = dbOwner || io.env("TELEGRAM_OWNER_CHAT_ID") || "";
  if (!(owner && await timingSafeEqualStr(msg.externalId, owner))) {
    console.warn("unpaired chat", msg.externalId);
    return owner
      ? "Sorry — this is a private assistant."
      : `This assistant isn't paired yet. If you're the owner, set the ` +
        `TELEGRAM_OWNER_CHAT_ID secret to ${msg.externalId} and redeploy.`;
  }
  const chatType = msg.chatType ?? "private";
  if (chatType !== "private") {
    const ownerUser = io.env("TELEGRAM_OWNER_USER_ID") || "";
    if (
      !ownerUser || !msg.senderId ||
      !(await timingSafeEqualStr(msg.senderId, ownerUser))
    ) {
      console.warn("unpaired group sender", msg.externalId, msg.senderId);
      return "Sorry — this is a private assistant.";
    }
  }
  return null;
}

/** PAIR <code> from a channel that is configured but not yet paired. This is
 *  the only way owner_ref gets set, and it is deliberately not "first sender
 *  wins" — whoever finds the bot first would otherwise own the books.
 *  Attempts are throttled to 5 failed codes per hour per sender (the counter
 *  rows double as an audit trail), and the code itself is compared
 *  timing-safe. Returns a reply when it handled the message, else null. */
export async function tryPair(
  // deno-lint-ignore no-explicit-any
  client: any,
  ownerId: string,
  msg: InboundMsg,
  text: string,
  onPaired?: () => void,
): Promise<string | null> {
  const m = /^\s*PAIR\s+(\d{6})\s*$/i.exec(text);
  if (!m) return null;
  const { data: row } = await client
    .from("agent_channels")
    .select("credentials,owner_ref")
    .eq("user_id", ownerId)
    .eq("provider", msg.channel)
    .maybeSingle();
  if (!row) return null;
  if (row.owner_ref) return "This channel is already paired.";
  const creds = (row.credentials ?? {}) as Record<string, string>;
  // Keyed by the sender's identity so one stranger guessing codes can't
  // lock the real owner out of pairing on another account/channel.
  const sender =
    (msg.channel === "slack" ? msg.userId ?? msg.externalId : msg.externalId) || "?";
  const attemptAction = `pair_attempt:${msg.channel}:${sender.slice(0, 64)}`;
  if (!(await rateLimit(client, ownerId, attemptAction, 5, 3600))) {
    console.warn("pair attempts throttled on", msg.channel);
    return "Too many attempts — try again later.";
  }
  if (!creds.pair_code || !(await timingSafeEqualStr(String(creds.pair_code), m[1]))) {
    // Failed attempts are what the limiter counts, and each one leaves an
    // audit row — brute-forcing the code shows up in audit_log.
    await logAction(client, ownerId, attemptAction, {
      provider: msg.channel,
      sender: String(sender).slice(0, 64),
      outcome: "bad_code",
    });
    console.warn("bad pair code on", msg.channel, msg.externalId);
    return "That pairing code isn't right.";
  }
  const rest = { ...creds };
  delete rest.pair_code; // one-time: spent codes cannot pair a second account
  const { error } = await client
    .from("agent_channels")
    .update({
      owner_ref: msg.channel === "slack" ? msg.userId : msg.externalId,
      credentials: rest,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", ownerId)
    .eq("provider", msg.channel);
  if (error) return `Pairing failed: ${error.message}`;
  onPaired?.();
  return `✅ Paired. You can talk to me here now — same memory, same books.`;
}
