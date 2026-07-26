// Pure, dependency-free parsing for inbound channel webhooks.
// Kept separate from index.ts so it's unit-testable (see parse.test.ts,
// parse-whatsapp.test.ts, parse-slack.test.ts).

export interface InboundMsg {
  channel: "telegram" | "whatsapp" | "slack";
  externalId: string; // where to reply: Telegram chat id / WhatsApp phone / Slack channel id
  body: string;
  fromName: string;
  userId?: string; // Slack only: the sender's Slack user id (for owner pinning)
}

/** Normalize a Telegram webhook update into an InboundMsg.
 *  Returns null for anything we don't act on: edits, channel posts,
 *  joins, stickers, or empty/non-text messages. */
export function parseTelegramUpdate(update: unknown): InboundMsg | null {
  if (!update || typeof update !== "object") return null;
  const msg = (update as Record<string, unknown>).message as
    | Record<string, unknown>
    | undefined;
  if (!msg || typeof msg !== "object") return null;

  const text = typeof msg.text === "string" ? msg.text.trim() : "";
  if (!text) return null;

  const chat = msg.chat as Record<string, unknown> | undefined;
  const chatId = chat?.id;
  if (chatId === undefined || chatId === null) return null;

  const from = msg.from as Record<string, unknown> | undefined;
  const fromName =
    [from?.first_name, from?.last_name]
      .filter((s): s is string => typeof s === "string" && s.length > 0)
      .join(" ") ||
    (typeof from?.username === "string" ? from.username : "") ||
    "there";

  return {
    channel: "telegram",
    externalId: String(chatId),
    body: text,
    fromName: String(fromName),
  };
}

/** Normalize a Meta WhatsApp Cloud API webhook payload into InboundMsgs.
 *  One payload can carry several entries/changes/messages, so this returns
 *  an array. Status callbacks (read receipts, deliveries) and non-text
 *  messages (images, audio, …) are ignored → []. */
export function parseWhatsAppWebhook(payload: unknown): InboundMsg[] {
  const out: InboundMsg[] = [];
  if (!payload || typeof payload !== "object") return out;
  const entries = (payload as Record<string, unknown>).entry;
  if (!Array.isArray(entries)) return out;

  for (const entry of entries) {
    const changes = (entry as Record<string, unknown> | null)?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = (change as Record<string, unknown> | null)?.value as
        | Record<string, unknown>
        | undefined;
      if (!value || typeof value !== "object") continue;
      const contacts = Array.isArray(value.contacts)
        ? (value.contacts as Record<string, unknown>[])
        : [];
      const profile = contacts[0]?.profile as Record<string, unknown> | undefined;
      const fromName =
        typeof profile?.name === "string" && profile.name ? profile.name : "there";
      const messages = Array.isArray(value.messages)
        ? (value.messages as Record<string, unknown>[])
        : [];
      for (const msg of messages) {
        if (!msg || typeof msg !== "object") continue;
        if (msg.type !== "text") continue;
        const from = typeof msg.from === "string" ? msg.from : "";
        if (!from) continue;
        const textObj = msg.text as Record<string, unknown> | undefined;
        const body = typeof textObj?.body === "string" ? textObj.body.trim() : "";
        if (!body) continue;
        out.push({ channel: "whatsapp", externalId: from, body, fromName });
      }
    }
  }
  return out;
}

/** True when the payload is Slack's one-time URL verification handshake. */
export function isSlackUrlVerification(payload: unknown): boolean {
  return (
    !!payload &&
    typeof payload === "object" &&
    (payload as Record<string, unknown>).type === "url_verification"
  );
}

/** Normalize a Slack Events API `event_callback` payload into an InboundMsg.
 *  Returns null for anything we don't act on: the url_verification handshake,
 *  non-message events, bot messages (bot_id or any message subtype — a real
 *  human message has subtype === undefined), and empty text.
 *  Leading/trailing <@U…> mention tokens are stripped (app mentions arrive as
 *  "<@U123> what's my cash position?"). */
export function parseSlackEvent(payload: unknown): InboundMsg | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (p.type !== "event_callback") return null;
  const event = p.event as Record<string, unknown> | undefined;
  if (!event || typeof event !== "object") return null;
  if (event.type !== "message") return null;

  // Ignore bots and every subtype of message (edits, joins, bot_message, …).
  if (event.bot_id !== undefined || event.subtype !== undefined) return null;

  const channel = typeof event.channel === "string" ? event.channel : "";
  const user = typeof event.user === "string" ? event.user : "";
  if (!channel || !user) return null;

  const rawText = typeof event.text === "string" ? event.text : "";
  const body = rawText.replace(/<@[A-Z0-9]+>/g, "").trim();
  if (!body) return null;

  return {
    channel: "slack",
    externalId: channel,
    userId: user,
    body,
    fromName: "there", // display names need a users.info lookup; keep it simple
  };
}
