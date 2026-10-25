/* The channel registry: one place that knows what a channel IS.
 *
 *  WhatsApp and Telegram each grew their own agent loop, so the rules that
 *  should have been shared lived twice and drifted — one channel blocked the
 *  owner's computer, the other did not; one understood "YES" as approval, the
 *  other did not. Every channel now declares itself here, and the harness,
 *  the turn runner and the tools read the same table.
 *
 *  A channel answers three questions:
 *   - Where does the agent meet the user? (app, a phone, a mail box)
 *   - What may it touch from there? (a phone can ask the desktop to act, but
 *     cannot open a shell)
 *   - How does it talk back? (plain text, files, and what "yes" means)
 *
 *  Adding a channel is a row, not a fork. */

export type ChannelId =
  | "app"
  | "whatsapp"
  | "telegram"
  | "email"
  | "slack"
  | "teams"
  | "discord"
  | "webhook";

export type ChannelDelivery = "app" | "bridge" | "poll" | "email" | "webhook";

export interface ChannelProfile {
  id: ChannelId;
  /** What the user calls it. */
  label: string;
  /** The agent is not sitting in front of the desktop: approvals arrive as text. */
  remote: boolean;
  /** The channel shows plain text only — cards and widgets would be noise. */
  textOnly: boolean;
  /** Documents can travel both ways. */
  files: boolean;
  /** How a message gets to the channel. */
  delivery: ChannelDelivery;
  /** Tools this channel never gets, whatever the user has enabled. */
  blockedTools: string[];
  /** Words that mean "yes" when the agent asks for approval here. */
  approveWords: string[];
  /** Secret name holding the delivery URL (webhook channels). */
  webhookSecret?: string;
  /** Hosts a webhook URL may point at. A URL outside this list is refused:
   *  the agent must not be able to turn a channel into a mail gun. */
  webhookHosts: string[];
}

/** A shell is the one thing a phone may not open: computer use and the built-in
 *  browser are approved actions the owner can ask for from any channel, but a
 *  free-form shell belongs to the computer they are sitting at. */
const OWNER_SHELL = ["run_shell"];
/** Cards and the templates behind them: a text-only channel cannot show one. */
const CARD_TOOLS = ["show_ui", "show_openui", "card_templates", "find_image"];
const YES = ["yes", "y", "yep", "yeah", "ok", "okay", "approve", "approved", "confirm", "go ahead", "do it", "proceed", "sure", "agreed"];

export const CHANNELS: Record<ChannelId, ChannelProfile> = {
  app: {
    id: "app",
    label: "Filey AI in the app",
    remote: false,
    textOnly: false,
    files: true,
    delivery: "app",
    blockedTools: [],
    approveWords: ["yes", "ok", "approve", "confirm"],
    webhookHosts: [],
  },
  whatsapp: {
    id: "whatsapp",
    label: "WhatsApp",
    remote: true,
    textOnly: true,
    files: true,
    delivery: "bridge",
    blockedTools: OWNER_SHELL,
    approveWords: YES,
    webhookHosts: [],
  },
  telegram: {
    id: "telegram",
    label: "Telegram",
    remote: true,
    textOnly: true,
    files: false,
    delivery: "poll",
    blockedTools: OWNER_SHELL,
    approveWords: [...YES, "نعم", "موافق", "وافق"],
    webhookHosts: [],
  },
  email: {
    id: "email",
    label: "Email",
    remote: true,
    textOnly: true,
    files: true,
    delivery: "email",
    blockedTools: OWNER_SHELL,
    approveWords: [...YES, "approved"],
    webhookHosts: [],
  },
  slack: {
    id: "slack",
    label: "Slack",
    remote: true,
    textOnly: true,
    files: true,
    delivery: "webhook",
    blockedTools: OWNER_SHELL,
    approveWords: [...YES, "approve"],
    webhookSecret: "channel.slack.webhook",
    webhookHosts: ["hooks.slack.com"],
  },
  teams: {
    id: "teams",
    label: "Microsoft Teams",
    remote: true,
    textOnly: true,
    files: true,
    delivery: "webhook",
    blockedTools: OWNER_SHELL,
    approveWords: [...YES, "approve"],
    webhookSecret: "channel.teams.webhook",
    webhookHosts: ["*.webhook.office.com", "outlook.office.com", "*.logic.azure.com"],
  },
  discord: {
    id: "discord",
    label: "Discord",
    remote: true,
    textOnly: true,
    files: true,
    delivery: "webhook",
    blockedTools: OWNER_SHELL,
    approveWords: [...YES, "approve"],
    webhookSecret: "channel.discord.webhook",
    webhookHosts: ["discord.com", "discordapp.com"],
  },
  webhook: {
    id: "webhook",
    label: "Webhook",
    remote: true,
    textOnly: true,
    files: true,
    delivery: "webhook",
    blockedTools: OWNER_SHELL,
    approveWords: YES,
    webhookSecret: "channel.webhook.url",
    webhookHosts: [],
  },
};

/** Channels the agent can be reached on, in the order they are offered. */
export const CHANNEL_IDS = Object.keys(CHANNELS) as ChannelId[];

/** Channels that are not the app itself. */
export const REMOTE_CHANNELS = CHANNEL_IDS.filter((id) => CHANNELS[id].remote);

/** The channel an agent id names: "whatsapp:97150…" → whatsapp. */
export function channelIdFromAgentId(agentId?: string | null): ChannelId | null {
  if (!agentId) return null;
  const head = agentId.split(":")[0]?.trim().toLowerCase();
  if (!head) return null;
  return head in CHANNELS ? (head as ChannelId) : null;
}

export function channelProfile(agentId?: string | null): ChannelProfile | null {
  const id = channelIdFromAgentId(agentId);
  return id ? CHANNELS[id] : null;
}

/** Is this run happening somewhere other than the app? */
export function isRemoteChannel(agentId?: string | null): boolean {
  return channelProfile(agentId)?.remote === true;
}

/** The channel forbids this tool here — whatever the user has switched on. */
export function channelBlocksTool(agentId: string | undefined | null, tool: string): boolean {
  const profile = channelProfile(agentId);
  if (!profile) return false;
  if (profile.blockedTools.includes(tool)) return true;
  // A text-only channel cannot show a card, so the card tools are pointless
  // there: offering them spends a round on something the user cannot see.
  if (profile.textOnly && CARD_TOOLS.includes(tool)) return true;
  return false;
}

/** Does this word mean "yes" on this channel? */
export function isAffirmative(channelId: ChannelId, text: string): boolean {
  const word = text.trim().toLowerCase();
  if (!word) return false;
  return CHANNELS[channelId].approveWords.some((candidate) => candidate.toLowerCase() === word);
}

/** Is this a webhook URL a channel may post to? */
export function webhookHostAllowed(channelId: ChannelId, url: string): boolean {
  const allowed = CHANNELS[channelId].webhookHosts;
  if (!allowed.length) return false;
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return allowed.some((pattern) =>
    pattern.startsWith("*.")
      ? host === pattern.slice(2) || host.endsWith(pattern.slice(1))
      : host === pattern
  );
}
