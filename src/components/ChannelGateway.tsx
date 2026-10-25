import { useState } from "react";
import { Link } from "react-router-dom";
import { Plug } from "lucide-react";

import { GATEWAY_CONNECTS } from "../lib/channelGateway";
import { CHANNELS } from "../lib/channelRegistry";
import { deleteSecret, listSecrets } from "../lib/secretStore";
import { cn } from "../lib/format";
import { CHANNEL_ICONS } from "./ChannelConnection";

const WEBHOOKS = GATEWAY_CONNECTS.filter(item => item.kind === "free-webhook");

function savedSecrets(): string[] {
  try { return listSecrets(); } catch { return []; }
}

/** Slack, Discord and Teams, in list form. Each row opens that channel's own
 *  connection page, so the webhook steps and validation live with the channel
 *  instead of in a bare URL box here. Pairing a phone (WhatsApp) and a free bot
 *  token (Telegram) keep their own cards above; Email keeps its own below. */
export default function ChannelGateway() {
  const [connected, setConnected] = useState<string[]>(() => savedSecrets());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const disconnect = async (id: string) => {
    const name = CHANNELS[id as keyof typeof CHANNELS]?.webhookSecret;
    if (!name || busy) return;
    setBusy(id);
    setError("");
    try {
      await deleteSecret(name);
      setConnected(savedSecrets());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy("");
    }
  };

  return (
    <section aria-label="Other channels" className="mb-6 overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Slack, Discord and Teams</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          Connect each one on its own page with the free incoming webhook that app gives your workspace. No paid channel key. Filey posts approved replies, updates and documents to the channel you pick.
        </p>
      </div>
      <div className="divide-y divide-border">
        {WEBHOOKS.map(item => {
          const profile = CHANNELS[item.id];
          const secret = profile.webhookSecret ?? "";
          const on = !!secret && connected.includes(secret);
          const Icon = CHANNEL_ICONS[item.id] ?? Plug;
          return (
            <div key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted text-foreground">
                <Icon size={18} />
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
              </div>
              <div className="flex items-center gap-2">
                <Link className={on ? "btn-secondary" : "btn-primary"} to={`/integrations/${item.id}`}>
                  {on ? "Manage" : "Connect"}
                </Link>
                {on && (
                  <button className="btn-ghost" type="button" disabled={!!busy} onClick={() => void disconnect(item.id)}>
                    {busy === item.id ? "Removing…" : "Disconnect"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {error && <p role="status" className="px-4 py-3 text-sm text-destructive">{error}</p>}
      <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
        From a terminal you can also run <span className="font-mono">npm run gateway</span>.
      </p>
    </section>
  );
}
