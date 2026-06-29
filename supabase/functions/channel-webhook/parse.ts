// Pure, dependency-free parsing for inbound channel webhooks.
// Kept separate from index.ts so it's unit-testable (see parse.test.ts).

export interface InboundMsg {
  channel: "telegram";
  externalId: string; // chat id to reply to
  body: string;
  fromName: string;
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
