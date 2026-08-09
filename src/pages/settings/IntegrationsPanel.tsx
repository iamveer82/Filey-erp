import { useEffect, useState } from "react";
import { Plug, Loader2, ExternalLink, RefreshCw, Check, Share2 } from "lucide-react";
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
  composioKeySource,
  composioSearchToolkits,
  COMPOSIO_TOOLKITS,
  type ToolkitInfo,
} from "../../lib/composio";
import {
  getZernioConfig,
  setZernioConfig,
  usingOwnZernioKey,
  zernioKeySource,
  listAccounts,
  type ZernioConfig,
} from "../../lib/zernio";
import type { KeySource } from "../../lib/integrations";

export default function IntegrationsPanel() {
  return (
    <div className="space-y-4">
      <ComposioCard />
      <ZernioCard />
      <ServicesCard />
    </div>
  );
}

/* ── Social publishing (Zernio) ──────────────────────────────────────────
 * The key used to live behind a card on /integrations/:app, which is a strange
 * place to keep a credential. Both providers now sit together, and both say
 * plainly whose key is paying. */
function ZernioCard() {
  const [cfg, setCfg] = useState<ZernioConfig>(() => getZernioConfig());
  const [key, setKey] = useState("");
  const [source, setSource] = useState<KeySource>("none");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    void zernioKeySource().then(setSource);
  }, [cfg]);

  const own = usingOwnZernioKey(cfg);

  const saveOwn = async () => {
    setBusy(true);
    setMsg("");
    try {
      const next = setZernioConfig({ apiKey: key.trim(), enabled: true });
      setCfg(next);
      setKey("");
      // Prove the key before saying it works: one cheap authenticated read.
      const accounts = await listAccounts();
      setMsg(`Key works — ${accounts.length} account(s) connected.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    setBusy(true);
    setMsg("");
    try {
      const accounts = await listAccounts();
      setMsg(
        accounts.length
          ? `Working — ${accounts.length} account(s) connected.`
          : "Working, but no social accounts are linked at zernio.com yet."
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const removeOwn = () => {
    setCfg(setZernioConfig({ apiKey: "", enabled: false }));
    setMsg("Your key was removed — publishing falls back to your Filey plan.");
  };

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-1">
        <Share2 size={18} className="text-primary-500" />
        <p className="font-medium text-ink">Social publishing</p>
      </div>
      <p className="text-sm text-brand-500 mt-0.5 mb-4">
        Post and schedule to Instagram, LinkedIn, X, TikTok and more. Link the
        accounts themselves at zernio.com; this is only about which key pays.
      </p>

      <SourceBadge source={source} own={own} />

      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-brand-500 hover:text-ink">
          Use my own Zernio key instead
        </summary>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="field flex-1">
            <span className="label">Zernio API key</span>
            <input
              type="password"
              className="input"
              placeholder={own ? "•••••••• (saved — paste to replace)" : "sk_…"}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </div>
          <button className="btn-primary" onClick={saveOwn} disabled={busy || !key.trim()}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : "Save & check"}
          </button>
        </div>
        {own && (
          <div className="mt-2 flex gap-3">
            <button className="btn-ghost h-8 px-3 text-xs" onClick={check} disabled={busy}>
              <RefreshCw size={12} /> Check key
            </button>
            <button
              className="h-8 px-3 text-xs font-medium text-danger hover:underline"
              onClick={removeOwn}
              disabled={busy}
            >
              Remove key
            </button>
          </div>
        )}
      </details>

      {msg && <p className="mt-3 text-xs font-medium text-brand-500">{msg}</p>}
    </div>
  );
}

/** An app's real logo. Composio serves one per toolkit, which beats drawing
 *  fourteen of them by hand and then not having the fifteenth. Falls back to
 *  the bundled brand icon, then to a plug, so a row never renders empty. */
function AppIcon({ slug, logo }: { slug: string; logo?: string }) {
  const [broken, setBroken] = useState(false);
  const src = logo || `https://logos.composio.dev/api/${slug}`;

  // A CSP block fires NO error event — the image simply never completes — so
  // onError alone left an empty circle forever. Give it a beat, then fall back
  // to the bundled icon. This is also what a customer on a plane sees.
  useEffect(() => {
    setBroken(false);
    const t = setTimeout(() => {
      const img = new Image();
      img.onload = () => setBroken(false);
      img.onerror = () => setBroken(true);
      img.src = src;
      if (!img.complete) setTimeout(() => !img.naturalWidth && setBroken(true), 2500);
    }, 0);
    return () => clearTimeout(t);
  }, [src]);

  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary-100 text-ink dark:bg-white/10">
      {broken ? (
        <BrandIcon name={slug} className="h-5 w-5" />
      ) : (
        <img
          src={src}
          alt=""
          width={20}
          height={20}
          // NOT lazy: fourteen 128px icons in a settings list are cheaper to
          // fetch than they are to leave blank, and lazy ones inside this
          // scroll container were never triggering at all.
          className="h-5 w-5 rounded object-contain"
          onError={() => setBroken(true)}
        />
      )}
    </span>
  );
}

/** Says who is paying, in the words a customer would use. */
function SourceBadge({ source, own }: { source: KeySource; own: boolean }) {
  if (own)
    return (
      <p className="text-xs font-medium text-brand-600 bg-hover rounded-xl px-3 py-2">
        Running on <b>your own key</b> — calls go straight to the provider and
        aren't metered by Filey.
      </p>
    );
  if (source === "platform")
    return (
      <p className="text-xs font-medium text-success bg-success/10 rounded-xl px-3 py-2">
        <Check size={11} className="inline" /> Included in your Filey plan —
        nothing to configure. Daily limits apply on the free tier.
      </p>
    );
  return (
    <p className="text-xs font-medium text-warning bg-warning/10 rounded-xl px-3 py-2">
      Sign in to your Filey account to use the built-in integrations, or add your
      own key below.
    </p>
  );
}

/* ── Composio — connect Gmail/Slack/Telegram for the AI agent ───────────── */
function ComposioCard() {
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [active, setActive] = useState<Set<string>>(new Set());
  const [source, setSource] = useState<KeySource>("none");
  const [search, setSearch] = useState("");
  const [found, setFound] = useState<ToolkitInfo[]>([]);
  const [searching, setSearching] = useState(false);
  const [msg, setMsg] = useState("");

  const runSearch = async () => {
    const q = search.trim();
    if (!q) return setFound([]);
    setSearching(true);
    setMsg("");
    try {
      setFound(await composioSearchToolkits(q, 12));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    getComposioKey().then((k) => setHasKey(!!k.trim()));
    void composioKeySource().then(setSource);
    void refresh();
  }, []);

  const refresh = async () => {
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
      // Saving used to claim success without ever asking the provider whether
      // the key was real, so a typo surfaced later as "integrations are broken".
      await composioList();
      setMsg("Key works. Connect the apps you want below.");
      await refresh();
    } catch (e) {
      setMsg(
        `That key didn't work: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      setSaving(false);
    }
  };

  const check = async () => {
    setSaving(true);
    setMsg("");
    try {
      const list = await composioList();
      const n = (list.items ?? []).filter(
        (c) => (c.status ?? "").toUpperCase() === "ACTIVE"
      ).length;
      setMsg(`Working — ${n} app(s) connected.`);
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const removeKey = async () => {
    setSaving(true);
    setMsg("");
    try {
      await setComposioKey("");
      setHasKey(false);
      setMsg("Your key was removed — integrations fall back to your Filey plan.");
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
        Connect the apps you already use, and the Filey AI agent can work in
        them — read a form response into a lead, book the meeting, send the
        follow-up, update the deal.
      </p>

      <SourceBadge source={source} own={hasKey} />

      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-brand-500 hover:text-ink">
          Use my own Composio key instead
        </summary>
        {!hasDesktop ? (
          <p className="mt-2 text-xs font-medium text-warning bg-warning/10 rounded-xl px-3 py-2">
            Your own key can only be stored by the desktop app, which keeps it in
            the device's encrypted store rather than the browser.
          </p>
        ) : (
          <>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="field flex-1">
                <span className="label">Composio API key</span>
                <input
                  type="password"
                  className="input"
                  placeholder={hasKey ? "•••••••• (saved — paste to replace)" : "ak_…"}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                />
              </div>
              <button
                className="btn-primary"
                onClick={save}
                disabled={saving || !key.trim()}
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : "Save & check"}
              </button>
            </div>
            {hasKey && (
              <div className="mt-2 flex gap-3">
                <button className="btn-ghost h-8 px-3 text-xs" onClick={check} disabled={saving}>
                  <RefreshCw size={12} /> Check key
                </button>
                <button
                  className="h-8 px-3 text-xs font-medium text-danger hover:underline"
                  onClick={removeKey}
                  disabled={saving}
                >
                  Remove key
                </button>
              </div>
            )}
          </>
        )}
      </details>

      {/* Any app, not just the shortlist below */}
      <div className="mt-4 flex gap-2">
        <input
          className="input flex-1"
          placeholder="Search every app — Instagram, Zoho, Xero, Shopify…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void runSearch()}
        />
        <button className="btn-ghost" onClick={runSearch} disabled={searching}>
          {searching ? <Loader2 size={15} className="animate-spin" /> : "Search"}
        </button>
      </div>
      {found.length > 0 && (
        <div className="mt-2 space-y-2">
          {found.map((tk) => (
            <div
              key={tk.slug}
              className="flex items-center gap-3 rounded-xl border border-brand-200 px-4 py-3"
            >
              <AppIcon slug={tk.slug} logo={tk.meta?.logo} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{tk.name ?? tk.slug}</p>
                <p className="truncate text-[11px] text-brand-400">
                  {tk.meta?.description ?? tk.slug}
                </p>
              </div>
              {active.has(tk.slug) ? (
                <Badge tone="success">
                  <Check size={11} /> Connected
                </Badge>
              ) : (
                <button
                  className="btn-ghost h-9 px-3 text-xs"
                  onClick={() => connect(tk.slug)}
                  disabled={source === "none" || connecting === tk.slug}
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
          ))}
        </div>
      )}

      {/* Toolkits */}
      <div className="mt-4 flex items-center justify-between">
        <p className="label !mb-0">Popular</p>
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
              className="flex items-center gap-3 rounded-xl border border-brand-200 px-4 py-3"
            >
              <AppIcon slug={tk.slug} />
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
                  // Connectable on the plan's key too — requiring an own key
                  // here was what made integrations look desktop-only.
                  disabled={source === "none" || connecting === tk.slug}
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
            className="flex items-center gap-3 rounded-xl border border-brand-200 px-4 py-3"
          >
            <span className="rounded-xl bg-primary-100 text-ink p-2 dark:bg-white/10">
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
