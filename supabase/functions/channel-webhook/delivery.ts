import type { InboundMsg } from "./parse.ts";
import { ownerRefusal } from "./access.ts";

export interface ChannelReplyIO {
  credentials(channel: InboundMsg["channel"]): Promise<Record<string, string>>;
  env(key: string): string | undefined;
}

/** Pairing/refusal notices contain no business data. Every model or approval
 * reply must carry the original workspace authority through its final send. */
export type ReplyAuthority = "public" | { workspaceActive(): Promise<boolean> };
const connectionChanged = "Your assistant connection or workspace access changed. Open Filey to review the connection and finish pairing if needed.";

/** Resolve the actor pin and credentials together. Never validate an earlier
 * snapshot then deliver private output with a freshly re-paired connection.
 * A same-channel reconnect intentionally clears pairing: its setup receipt
 * becomes generic guidance until pairing completes, rather than a bypass. */
export async function prepareChannelReply(
  msg: InboundMsg,
  text: string,
  authority: ReplyAuthority,
  io: ChannelReplyIO,
): Promise<{ text: string; config: Record<string, string> } | null> {
  const config = await io.credentials(msg.channel);
  if (config.disabled) return null;
  const paired = authority === "public" || await ownerRefusal(msg, {
    env: io.env, dbOwner: config.owner_ref ?? "", configured: !!config.configured,
  }) === null;
  // The credential lookup and pin comparison are awaited. Recheck the
  // captured workspace after them, immediately before releasing private text.
  const workspaceActive = authority === "public" || await authority.workspaceActive();
  return { text: workspaceActive && paired ? text : connectionChanged, config };
}

/** Returns the actual text sent, so callers never log a private reply that
 * was withheld or replaced by the final authority fence. */
export async function sendChannelReply(
  msg: InboundMsg,
  text: string,
  authority: ReplyAuthority,
  io: ChannelReplyIO,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  const prepared = await prepareChannelReply(msg, text, authority, io);
  if (!prepared) return null;
  const { config } = prepared;
  const token = msg.channel === "whatsapp" ? config.token || io.env("WHATSAPP_TOKEN")
    : msg.channel === "telegram" ? config.bot_token || io.env("TELEGRAM_BOT_TOKEN")
    : config.bot_token || io.env("SLACK_BOT_TOKEN");
  await sendChannelText(msg.channel, msg.externalId, prepared.text, {
    token, phoneNumberId: config.phone_number_id || io.env("WHATSAPP_PHONE_NUMBER_ID"),
    graphVersion: io.env("WHATSAPP_GRAPH_VERSION"),
  }, fetchFn);
  return prepared.text;
}

/** The destination is the customer's explicitly approved recipient, while
 * authority belongs to the original paired actor and captured workspace.
 * Resolve destination credentials before checking that authority again: an
 * earlier approval check cannot authorize a send after this awaited lookup. */
export async function sendApprovedChannelText(
  channel: InboundMsg["channel"],
  to: string,
  text: string,
  io: ChannelReplyIO & { canExecute(): Promise<boolean> },
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const config = await io.credentials(channel);
  if (config.disabled) throw new Error("The destination channel is disconnected. Nothing was sent.");
  if (!(await io.canExecute())) throw new Error("Workspace access or the paired conversation changed. Nothing was sent.");
  const token = channel === "whatsapp" ? config.token || io.env("WHATSAPP_TOKEN")
    : channel === "telegram" ? config.bot_token || io.env("TELEGRAM_BOT_TOKEN")
    : config.bot_token || io.env("SLACK_BOT_TOKEN");
  await sendChannelText(channel, to, text, {
    token, phoneNumberId: config.phone_number_id || io.env("WHATSAPP_PHONE_NUMBER_ID"),
    graphVersion: io.env("WHATSAPP_GRAPH_VERSION"),
  }, fetchFn);
}

/** Keep below provider limits without splitting a Unicode surrogate pair. */
export function messageParts(text: string): string[] {
  const chars = Array.from(text);
  if (!text.trim()) throw new Error("Cannot send an empty message.");
  const parts: string[] = [];
  for (let i = 0; i < chars.length; i += 2000) parts.push(chars.slice(i, i + 2000).join(""));
  return parts;
}

/** No automatic retry: a timeout may mean the provider accepted the message. */
export async function sendChannelText(
  channel: InboundMsg["channel"],
  to: string,
  text: string,
  credentials: { token?: string; phoneNumberId?: string; graphVersion?: string },
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  if (!credentials.token) throw new Error(`${channel} is not configured.`);
  if (channel === "whatsapp" && !credentials.phoneNumberId)
    throw new Error("WhatsApp phone number is not configured.");
  const version = credentials.graphVersion || "v23.0";
  if (!/^v\d+\.0$/.test(version)) throw new Error("Invalid WhatsApp Graph API version.");
  const url = channel === "telegram"
    ? `https://api.telegram.org/bot${credentials.token}/sendMessage`
    : channel === "slack" ? "https://slack.com/api/chat.postMessage"
    : `https://graph.facebook.com/${version}/${credentials.phoneNumberId}/messages`;
  let accepted = 0;
  try {
    for (const part of messageParts(text)) {
      const res = await fetchFn(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...(channel !== "telegram" ? { Authorization: `Bearer ${credentials.token}` } : {}) },
        body: JSON.stringify(channel === "telegram" ? { chat_id: to, text: part }
          : channel === "slack" ? { channel: to, text: part }
          : { messaging_product: "whatsapp", to, type: "text", text: { body: part } }),
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      });
      const body = await res.json().catch(() => null);
      const ok = channel === "whatsapp" ? !!body?.messages?.[0]?.id
        : channel === "telegram" ? body?.ok === true && Number.isSafeInteger(body?.result?.message_id)
        : body?.ok === true && typeof body?.ts === "string" && body.ts.length>0;
      if (!res.ok || !ok) throw new Error(`Provider rejected message (HTTP ${res.status}).`);
      accepted++;
    }
  } catch {
    // Never expose a provider error/URL: Telegram URLs contain the bot token.
    throw new Error(`${channel} delivery not confirmed; ${accepted} part(s) accepted. Check the conversation before retrying.`);
  }
}
