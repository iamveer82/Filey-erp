/* How Filey is reached from other chats. Same idea as a Hermes gateway:
 * the desktop app is the process, and each channel uses a free link the user
 * owns. WhatsApp is a QR paired device. Telegram is a free BotFather token.
 * Slack, Discord and Teams are a free incoming webhook. No paid channel key. */
import { CHANNELS, webhookHostAllowed, type ChannelId } from "./channelRegistry";

export type GatewayKind = "qr" | "free-token" | "free-webhook" | "mailbox";

export interface GatewayConnect {
  id: Exclude<ChannelId, "app" | "webhook">;
  kind: GatewayKind;
  /** A paid platform key is never required. */
  paidKey: false;
  terminal: string;
  steps: string;
}

export const GATEWAY_CONNECTS: GatewayConnect[] = [
  {
    id: "whatsapp",
    kind: "qr",
    paidKey: false,
    terminal: "npm run gateway -- setup whatsapp",
    steps: "In the Filey desktop app, open Integrations → Built-in connections → Connect WhatsApp and scan the QR from WhatsApp → Linked devices. No API key.",
  },
  {
    id: "telegram",
    kind: "free-token",
    paidKey: false,
    terminal: "npm run gateway -- setup telegram",
    steps: "Message @BotFather on Telegram, create a bot, and paste that free token into Built-in connections. No paid API.",
  },
  {
    id: "slack",
    kind: "free-webhook",
    paidKey: false,
    terminal: "npm run gateway -- setup slack",
    steps: "In Slack, create a free incoming webhook and paste its hooks.slack.com address into Built-in connections.",
  },
  {
    id: "discord",
    kind: "free-webhook",
    paidKey: false,
    terminal: "npm run gateway -- setup discord",
    steps: "In Discord, create a free channel webhook and paste its discord.com address into Built-in connections.",
  },
  {
    id: "teams",
    kind: "free-webhook",
    paidKey: false,
    terminal: "npm run gateway -- setup teams",
    steps: "In Teams, create a free incoming webhook and paste its office.com address into Built-in connections.",
  },
  {
    id: "email",
    kind: "mailbox",
    paidKey: false,
    terminal: "npm run gateway -- setup email",
    steps: "Connect the mailbox in Built-in connections. Filey sends through that account.",
  },
];

export function gatewayConnect(id: string): GatewayConnect | null {
  return GATEWAY_CONNECTS.find(item => item.id === id) ?? null;
}

/** Accept a webhook URL only when it is https on that channel's own host. */
export function acceptChannelWebhook(id: GatewayConnect["id"], url: string): string {
  const clean = url.trim();
  let parsed: URL;
  try { parsed = new URL(clean); } catch { throw new Error("Paste the full https webhook address."); }
  if (parsed.protocol !== "https:" || !webhookHostAllowed(id, clean))
    throw new Error(`${CHANNELS[id].label} needs an https address on ${CHANNELS[id].webhookHosts.join(" or ")}.`);
  return clean;
}
