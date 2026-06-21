import { useEffect, useState } from "react";
import { Plug, Loader2, ExternalLink, RefreshCw, Check } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import BrandIcon from "../../components/BrandIcon";
import { Badge } from "../../components/ui";
import {
  hasDesktop,
  getComposioKey,
  setComposioKey,
  composioConnect,
  composioStatus,
  composioList,
  COMPOSIO_TOOLKITS,
} from "../../lib/composio";

export default function IntegrationsPanel() {
  return (
    <div className="space-y-4">
      <ComposioCard />
      <ServicesCard />
    </div>
  );
}

/* ── Composio — connect Gmail/Slack/Telegram for the AI agent ───────────── */
function ComposioCard() {
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [active, setActive] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState("");

  useEffect(() => {
    getComposioKey().then((k) => setHasKey(!!k.trim()));
    void refresh();
  }, []);

  const refresh = async () => {
    if (!hasDesktop) return;
    try {
      const list = await composioList();
      const on = new Set<string>();
      for (const c of list.items ?? [])
        if ((c.status ?? "").toUpperCase() === "ACTIVE" && c.toolkit?.slug)
          on.add(c.toolkit.slug);
      setActive(on);
    } catch {
      /* key may not be set yet */
    }
  };

  const save = async () => {
    setSaving(true);
    setMsg("");
    try {
      await setComposioKey(key);
      setHasKey(true);
      setKey("");
      setMsg("Saved. Now connect a service below.");
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const connect = async (slug: string) => {
    setConnecting(slug);
    setMsg("");
    try {
      const link = await composioConnect(slug);
      if (link.error) throw new Error(link.error.message);
      if (!link.redirect_url || !link.connected_account_id)
        throw new Error("Composio did not return a connection link.");
      await openUrl(link.redirect_url); // OAuth consent in the system browser
      setMsg(`Authorize ${slug} in the browser window, then it'll flip to Connected…`);
      // Poll until the user finishes the OAuth consent (≈2 min max).
      const id = link.connected_account_id;
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const st = await composioStatus(id).catch(() => null);
        if ((st?.status ?? "").toUpperCase() === "ACTIVE") {
          setActive((prev) => new Set(prev).add(slug));
          setMsg(`${slug} connected ✓`);
          break;
        }
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(null);
    }
  };

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-1">
        <Plug size={18} className="text-primary-500" />
        <p className="font-medium text-ink">AI agent integrations (Composio)</p>
      </div>
      <p className="text-sm text-brand-500 mt-0.5 mb-4">
        Connect Gmail, Slack or Telegram so the Filey AI agent can send messages
        on your behalf. Your Composio API key is stored in this device's encrypted
        store — never synced, never in the browser.
      </p>

      {!hasDesktop && (
        <p className="text-xs font-medium text-warning bg-warning/10 rounded-2xl px-3 py-2 mb-4">
          Integrations run from the Filey desktop app only.
        </p>
      )}

      {/* API key */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="field flex-1">
          <span className="label">Composio API key</span>
          <input
            type="password"
            className="input"
            placeholder={hasKey ? "•••••••• (saved — paste to replace)" : "ak_…"}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            disabled={!hasDesktop}
          />
        </div>
        <button
          className="btn-primary"
          onClick={save}
          disabled={saving || !key.trim() || !hasDesktop}
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : "Save key"}
        </button>
      </div>
      {hasKey && (
        <p className="mt-1.5 text-[11px] text-brand-400">
          Key saved. Tip: rotate it in the Composio dashboard if it's ever exposed.
        </p>
      )}

      {/* Toolkits */}
      <div className="mt-4 flex items-center justify-between">
        <p className="label !mb-0">Services</p>
        <button
          className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-500 hover:text-ink"
          onClick={refresh}
          disabled={!hasDesktop}
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>
      <div className="mt-2 space-y-2">
        {COMPOSIO_TOOLKITS.map((tk) => {
          const on = active.has(tk.slug);
          return (
            <div
              key={tk.slug}
              className="flex items-center gap-3 rounded-2xl border border-brand-200 px-4 py-3 dark:border-[#3A3D45]"
            >
              <span className="rounded-2xl bg-primary-100 text-ink p-2 dark:bg-white/10">
                <BrandIcon name={tk.slug} className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{tk.name}</p>
                <p className="truncate text-[11px] text-brand-400">{tk.desc}</p>
              </div>
              {on ? (
                <Badge tone="success">
                  <Check size={11} /> Connected
                </Badge>
              ) : (
                <button
                  className="btn-ghost h-9 px-3 text-xs"
                  onClick={() => connect(tk.slug)}
                  disabled={!hasKey || !hasDesktop || connecting === tk.slug}
                >
                  {connecting === tk.slug ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <ExternalLink size={13} />
                  )}
                  Connect
                </button>
              )}
            </div>
          );
        })}
      </div>

      {msg && <p className="mt-3 text-xs font-medium text-brand-500">{msg}</p>}
    </div>
  );
}

/* ── Existing read-only service status ──────────────────────────────────── */
function ServicesCard() {
  const url = (import.meta.env.VITE_SUPABASE_URL as string) || "";
  const host = url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const rows = [
    {
      n: "Supabase",
      d: host || "not configured",
      ok: !!host,
      icon: <BrandIcon name="supabase" className="h-5 w-5" />,
    },
    {
      n: "Local PDF Tools",
      d: "On-device, no network",
      ok: true,
      icon: <BrandIcon name="pdf" className="h-5 w-5" />,
    },
    {
      n: "Webhooks / API",
      d: "Not configured",
      ok: false,
      icon: <Plug size={16} />,
    },
  ];
  return (
    <div className="card">
      <p className="font-medium text-ink">Other services</p>
      <p className="text-sm text-brand-500 mt-0.5 mb-4">
        Connected services and their status.
      </p>
      <div className="space-y-2">
        {rows.map((r) => (
          <div
            key={r.n}
            className="flex items-center gap-3 rounded-2xl border border-brand-200 px-4 py-3 dark:border-[#3A3D45]"
          >
            <span className="rounded-2xl bg-primary-100 text-ink p-2 dark:bg-white/10">
              {r.icon}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-ink">{r.n}</p>
              <p className="text-[11px] text-brand-400 truncate">{r.d}</p>
            </div>
            <Badge tone={r.ok ? "success" : "neutral"}>
              {r.ok ? "Connected" : "Off"}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
