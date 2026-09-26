import type { InboundMsg } from "./parse.ts";

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
      });
      const body = await res.json().catch(() => null);
      const ok = channel === "whatsapp" ? !!body?.messages?.[0]?.id : body?.ok === true;
      if (!res.ok || !ok) throw new Error(`Provider rejected message (HTTP ${res.status}).`);
      accepted++;
    }
  } catch {
    // Never expose a provider error/URL: Telegram URLs contain the bot token.
    throw new Error(`${channel} delivery not confirmed; ${accepted} part(s) accepted. Check the conversation before retrying.`);
  }
}
