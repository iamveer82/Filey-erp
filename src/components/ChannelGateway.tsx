import { useState } from "react";
import { Link } from "react-router-dom";
import { Plug } from "lucide-react";

import { GATEWAY_CONNECTS, type GatewayConnect } from "../lib/channelGateway";
import { CHANNELS } from "../lib/channelRegistry";
import { deleteSecret, listSecrets } from "../lib/secretStore";
import { cn } from "../lib/format";
import BrandIcon from "./BrandIcon";
import { ChannelOAuthButton, useChannelAuth } from "./ChannelOAuthConnect";
import { CHANNEL_ICONS } from "./ChannelConnection";

type WebhookId = "slack" | "discord" | "teams";

const WEBHOOKS = GATEWAY_CONNECTS.filter(
  (item): item is GatewayConnect & { id: WebhookId } => item.kind === "free-webhook"
);

function savedSecrets(): string[] {
  try { return listSecrets(); } catch { return []; }
}

/** One channel row. Slack, Discord and Teams open the provider's own
 *  authorization page from here, the way WhatsApp pairs and Telegram takes its
 *  token. The free incoming webhook still lives on the channel's page for
 *  one-way notifications. */
function GatewayRow({ id }: { id: WebhookId }) {
  const profile = CHANNELS[id];
  const item = GATEWAY_CONNECTS.find(entry => entry.id === id)!;
  const secret = profile.webhookSecret ?? "";
  const [connected, setConnected] = useState<string[]>(() => savedSecrets());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const auth = useChannelAuth(id, profile.label);
  const webhookOn = !!secret && connected.includes(secret);
  const authorized = auth.connected === true;
  const on = authorized || webhookOn;
  const Icon = CHANNEL_ICONS[id] ?? Plug;

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

  const paths = [
    authorized ? "authorized" : "",
    webhookOn ? "webhook set" : "",
  ].filter(Boolean).join(" · ");

  return (
    <div role="group" aria-label={`${profile.label} channel`} className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[8px] bg-muted text-foreground">
          <BrandIcon name={id as "slack"} fallback={<Icon size={18} />} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold text-foreground">{profile.label}</span>
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
          <p className="mt-0.5 max-w-[65ch] text-[13px] leading-relaxed text-muted-foreground">
            {item.steps}
          </p>
          {on && paths && (
            <p className="mt-1 text-xs text-muted-foreground">{paths}</p>
          )}
        </div>
        {on && (
          <div className="flex items-center gap-2">
            <Link className="btn-secondary" to={`/integrations/${id}`}>Manage</Link>
            {webhookOn && (
              <button className="btn-ghost" type="button" disabled={busy} onClick={() => void disconnect()}>
                {busy ? "Removing…" : "Remove webhook"}
              </button>
            )}
          </div>
        )}
      </div>
      {!on && (
        <div className="mt-3 flex flex-wrap items-center gap-2 sm:pl-[52px]">
          <ChannelOAuthButton label={profile.label} auth={auth} />
          <Link className="btn-ghost" to={`/integrations/${id}`}>Setup guide</Link>
        </div>
      )}
      {error && <p role="status" className="mt-2 text-[13px] leading-relaxed text-danger sm:pl-[52px]">{error}</p>}
    </div>
  );
}

/** Slack, Discord and Teams, in list form. Each row authorizes through the
 *  provider's own consent page; the channel's page keeps the step-by-step
 *  webhook guide for one-way notifications. Pairing a phone (WhatsApp) and a
 *  free bot token (Telegram) keep their own cards above; Email keeps its own
 *  below. */
export default function ChannelGateway() {
  return (
    <section aria-label="Other channels" className="mb-6 overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Slack, Discord and Teams</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          Connect opens the provider's own authorization page — approve it once and the agent can read and post there. No paid channel key.
        </p>
      </div>
      <div className="divide-y divide-border">
        {WEBHOOKS.map(item => <GatewayRow key={item.id} id={item.id} />)}
      </div>
      <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
        From a terminal you can also run <span className="font-mono">npm run gateway</span>.
      </p>
    </section>
  );
}
