import { useState, type FormEvent } from "react";
import { ArrowUpRight, Check, Hash, Mail, MessagesSquare, Send, Users, type LucideIcon } from "lucide-react";

import { CHANNELS } from "../lib/channelRegistry";
import { acceptChannelWebhook, gatewayConnect, type GatewayConnect } from "../lib/channelGateway";
import { deleteSecret, listSecrets, saveSecret } from "../lib/secretStore";
import { cn } from "../lib/format";
import BrandIcon from "./BrandIcon";
import ChannelOAuthPanel, { useChannelAuth } from "./ChannelOAuthConnect";
import EmailConnection from "./EmailConnection";
import TelegramAgentConnection from "./TelegramAgentConnection";
import WhatsAppConnection from "./WhatsAppConnection";

/* One channel's connection surface. Every channel opens here from a single
 * Connect button in Integrations, so Slack/Discord/Teams stop asking for a raw
 * URL in a list and instead read like a connection page. The chat apps
 * authorize through the provider's own consent page; the free incoming webhook
 * stays available underneath for one-way notifications. WhatsApp pairs a phone,
 * Telegram takes a free bot token, and Email connects a mailbox. No paid channel
 * key is ever required. */

type WebhookId = "slack" | "discord" | "teams";
type ChannelAppId = GatewayConnect["id"];

/** Where the free webhook hides in each app, and the page to open for it. */
const WEBHOOK_HELP: Record<WebhookId, { icon: typeof Hash; steps: string[]; docs: string; docsLabel: string }> = {
  slack: {
    icon: Hash,
    steps: [
      "Open your workspace's apps page and create (or pick) an app.",
      "Turn on Incoming Webhooks, then select Add New Webhook to Workspace.",
      "Choose the channel Filey should post in, then copy the hooks.slack.com URL.",
    ],
    docs: "https://api.slack.com/apps",
    docsLabel: "Open Slack apps",
  },
  discord: {
    icon: MessagesSquare,
    steps: [
      "In Discord, open the server and go to Server Settings → Integrations.",
      "Under Webhooks select New Webhook and choose the channel Filey should post in.",
      "Select Copy Webhook URL, then paste that discord.com address below.",
    ],
    docs: "https://support.discord.com/hc/en-us/articles/228383668",
    docsLabel: "Discord webhook guide",
  },
  teams: {
    icon: Users,
    steps: [
      "In Teams, open the channel and select ••• → Connectors.",
      "Add an Incoming Webhook, give it a name, then select Create.",
      "Copy the …webhook.office.com address it shows, then paste it below.",
    ],
    docs: "https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook",
    docsLabel: "Teams webhook guide",
  },
};

function savedSecrets(): string[] {
  try { return listSecrets(); } catch { return []; }
}

/** The page body for one channel id. Webhook channels render here; the paired
 *  ones reuse the connection surface they already own. */
export default function ChannelConnection({ id }: { id: ChannelAppId }) {
  if (id === "whatsapp") return <WhatsAppConnection />;
  if (id === "telegram") return <TelegramAgentConnection />;
  if (id === "email") return <EmailConnection />;
  return <WebhookConnection id={id} />;
}

/** Slack, Discord and Teams authorize through the provider's own consent page.
 *  The free incoming webhook each app gives the workspace stays available for
 *  one-way notifications; its URL is checked against that channel's own hosts,
 *  so a mistyped or redirected address is refused instead of trusted. */
function WebhookConnection({ id }: { id: WebhookId }) {
  const profile = CHANNELS[id];
  const help = WEBHOOK_HELP[id];
  const item = gatewayConnect(id);
  const Icon = help.icon;
  const [url, setUrl] = useState("");
  const [connected, setConnected] = useState<string[]>(() => savedSecrets());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const auth = useChannelAuth(id, profile.label);

  const secret = profile.webhookSecret ?? "";
  const webhookOn = !!secret && connected.includes(secret);
  const authorized = auth.connected === true;
  const on = authorized || webhookOn;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!secret || busy) return;
    setBusy(true);
    setError("");
    try {
      const clean = acceptChannelWebhook(id, url);
      await saveSecret(secret, clean);
      setUrl("");
      setConnected(savedSecrets());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!secret || busy) return;
    setBusy(true);
    setError("");
    try {
      await deleteSecret(secret);
      setConnected(savedSecrets());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label={`${profile.label} connection`} className="mb-6 overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-5">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[8px] bg-muted text-foreground">
          <BrandIcon name={id as "slack"} fallback={<Icon size={20} />} className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">{profile.label}</h2>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
                on ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", on ? "bg-success" : "bg-muted-foreground/50")} />
              {on ? "Connected" : "Not connected"}
            </span>
          </div>
          <p className="mt-1 max-w-[65ch] text-[13px] leading-relaxed text-muted-foreground">
            Authorize Filey in {profile.label} once and the agent can read and post there.
            Prefer one-way alerts? Add an incoming webhook below — no paid channel key either way.
          </p>
        </div>
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.7fr)]">
        <div className="min-w-0">
          <ChannelOAuthPanel id={id} label={profile.label} auth={auth} />

          <details className="mt-5 border-t border-border pt-4">
            <summary className="cursor-pointer list-none text-sm font-medium">
              Use an incoming webhook instead
            </summary>
            <p className="mt-2 max-w-[65ch] text-[13px] leading-relaxed text-muted-foreground">
              A webhook is one-way delivery: approved replies, status updates and generated
              invoices or PDFs land in the channel you pick. Replies to Filey still come from
              the app, WhatsApp or Telegram.
            </p>
            <ol className="mt-3 max-w-[65ch] list-decimal space-y-2 ps-4 text-[13px] leading-relaxed text-muted-foreground">
              {help.steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
            <a
              className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline underline-offset-4"
              href={help.docs}
              target="_blank"
              rel="noopener noreferrer"
            >
              {help.docsLabel} <ArrowUpRight size={14} />
            </a>

            <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(event) => void save(event)}>
              <label className="min-w-0 flex-1">
                <span className="label">Webhook URL</span>
                <input
                  className="input mt-1"
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  placeholder={webhookOn ? "Connected" : "https://"}
                  value={url}
                  disabled={busy}
                  aria-label={`${profile.label} webhook`}
                  onChange={(event) => setUrl(event.target.value)}
                />
              </label>
              <button className="btn-primary" type="submit" disabled={busy || !url.trim()}>
                {busy ? "Saving…" : webhookOn ? "Replace webhook" : "Save webhook"}
              </button>
            </form>
            {error && <p role="status" className="mt-3 text-[13px] leading-relaxed text-danger">{error}</p>}
          </details>
        </div>

        <aside className="min-w-0 text-[13px] leading-relaxed">
          <div className="flex items-center gap-2 font-medium"><Check size={16} /> What you get</div>
          <dl className="mt-3 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Authorization</dt>
              <dd className={cn("font-medium", authorized ? "text-success" : "text-muted-foreground")}>
                {authorized ? "Authorized" : "Not authorized"}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Webhook</dt>
              <dd className={cn("font-medium", webhookOn ? "text-success" : "text-muted-foreground")}>
                {webhookOn ? "Set" : "Not set"}
              </dd>
            </div>
          </dl>
          {webhookOn && (
            <button className="btn-secondary mt-4" type="button" disabled={busy} onClick={() => void disconnect()}>
              Remove webhook
            </button>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            The webhook address is stored in your account's OS credential vault on this
            computer and only used to post to this chat.
          </p>
          {item?.terminal && (
            <p className="mt-3 text-xs text-muted-foreground">
              Prefer a terminal? Run <code className="font-mono text-foreground">{item.terminal}</code>.
            </p>
          )}
        </aside>
      </div>
    </section>
  );
}

/** Icons kept alongside the page so a channel list and its page agree. */
export const CHANNEL_ICONS: Record<string, LucideIcon> = {
  slack: Hash,
  discord: MessagesSquare,
  teams: Users,
  telegram: Send,
  email: Mail,
};
