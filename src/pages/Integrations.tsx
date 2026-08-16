import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Calculator,
  Check,
  Cloud,
  CreditCard,
  ExternalLink,
  FileText,
  Globe,
  Landmark,
  Loader2,
  Megaphone,
  MessageCircle,
  Plug,
  RefreshCw,
  Share2,
  ShoppingBag,
  Sparkles,
  UserSearch,
  Users,
  Zap,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { PageHeader, Badge, FilterChip } from "../components/ui";
import BrandIcon from "../components/BrandIcon";
import { cn } from "../lib/format";
import { useUI } from "../lib/ui";
import { cloudConfigured } from "../lib/supabase";
import {
  hasDesktop,
  composioList,
  composioConnect,
  composioStatus,
  composioKeySource,
  composioSearchToolkits,
  getComposioKey,
  setComposioKey,
  clearComposioKey,
  COMPOSIO_TOOLKITS,
  type ToolkitInfo,
} from "../lib/composio";
import { hasCloudKey } from "../lib/integrations";
import {
  getZernioConfig,
  setZernioConfig,
  usingOwnZernioKey,
  zernioKeySource,
  zernioReady,
  listAccounts,
  type ZernioConfig,
} from "../lib/zernio";
import type { KeySource } from "../lib/integrations";
import { reachReady } from "../lib/reach";
import {
  hasDesktop as waHasDesktop,
  getBridgeConfig,
  setBridgeConfig,
  bridgeState,
  startBridge,
  stopBridge,
  resetBridge,
  onBridgeState,
  type BridgeConfig,
  type BridgeState,
} from "../lib/waBridge";

/* ── Integrations ──────────────────────────────────────────────────────────
 * The single home for everything Filey connects to. This used to be split in
 * two: a read-only directory here that deep-linked into Settings, and the
 * actual connecting buried in Settings → Integrations. Connecting an app is
 * not a setting, so both providers (Composio for apps, Zernio for social) and
 * every app now live here, in one grid.
 *
 * Everything connected here is reachable by the Filey AI agent: it discovers
 * what exists with list_connected_apps and acts through composio_run /
 * schedule_social_post, both of which are confirm-gated. Connecting an app is
 * therefore also how a customer widens what the agent can do for them. */

type Integration = {
  key: string;
  name: string;
  desc: string;
  category: string;
  /** Bundled icon, for Filey's own capabilities. */
  icon?: ReactNode;
  /** Composio toolkit slug — renders a Connect button and a real app logo. */
  slug?: string;
  /** Logo URL from a Composio search result. */
  logo?: string;
  /** Where the Configure/Open button links (a real page). */
  to?: string;
  action?: string;
  connected?: boolean;
  builtin?: boolean;
  soon?: boolean;
  note?: string;
};

/** Composio's catalogue has no categories, so the shortlist gets ours — it is
 *  what the chips filter on. Anything found through search lands in "Apps". */
const TOOLKIT_CATEGORY: Record<string, string> = {
  gmail: "Email",
  outlook: "Email",
  mailchimp: "Email",
  slack: "Messaging",
  telegram: "Messaging",
  whatsapp: "Messaging",
  linkedin: "Messaging",
  hubspot: "CRM",
  typeform: "CRM",
  calendly: "Productivity",
  googlecalendar: "Productivity",
  googlesheets: "Productivity",
  notion: "Productivity",
  googledrive: "Storage",
};

export default function Integrations() {
  const { notice } = useUI();
  const [cat, setCat] = useState("All");
  const [active, setActive] = useState<Set<string>>(new Set());
  const [source, setSource] = useState<KeySource>("none");
  const [connecting, setConnecting] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [search, setSearch] = useState("");
  const [found, setFound] = useState<ToolkitInfo[]>([]);
  const [searching, setSearching] = useState(false);
  const reachOn = reachReady();
  const socialOn = zernioReady();

  const refresh = useCallback(async () => {
    try {
      const list = await composioList();
      const on = new Set<string>();
      for (const c of list.items ?? [])
        if ((c.status ?? "").toUpperCase() === "ACTIVE" && c.toolkit?.slug)
          on.add(c.toolkit.slug);
      setActive(on);
    } catch {
      /* no key yet — the cards simply show as not connected */
    }
  }, []);

  useEffect(() => {
    void composioKeySource().then(setSource);
    void refresh();
  }, [refresh]);

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

  const connect = async (slug: string) => {
    setConnecting(slug);
    setMsg("");
    try {
      const link = await composioConnect(slug);
      if (link.error) throw new Error(link.error.message);
      if (!link.redirect_url || !link.connected_account_id)
        throw new Error("Composio did not return a connection link.");
      // OAuth consent opens in the real browser on desktop; in a browser build
      // there is no opener plugin, and a new tab is the same thing.
      if (hasDesktop) await openUrl(link.redirect_url);
      else window.open(link.redirect_url, "_blank", "noopener");
      setMsg(`Authorize ${slug} in the browser window — this flips to Connected when you're done.`);
      const id = link.connected_account_id;
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const st = await composioStatus(id).catch(() => null);
        if ((st?.status ?? "").toUpperCase() === "ACTIVE") {
          setActive((prev) => new Set(prev).add(slug));
          setMsg(`${slug} connected ✓ — the Filey AI agent can now use it.`);
          break;
        }
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(null);
    }
  };

  const integrations = useMemo<Integration[]>(() => {
    const apps: Integration[] = COMPOSIO_TOOLKITS.map((tk) => ({
      key: `composio:${tk.slug}`,
      slug: tk.slug,
      name: tk.name,
      desc: tk.desc,
      category: TOOLKIT_CATEGORY[tk.slug] ?? "Apps",
      connected: active.has(tk.slug),
    }));
    const results: Integration[] = found
      .filter((tk) => !COMPOSIO_TOOLKITS.some((t) => t.slug === tk.slug))
      .map((tk) => ({
        key: `composio:${tk.slug}`,
        slug: tk.slug,
        name: tk.name ?? tk.slug,
        desc: tk.meta?.description ?? tk.slug,
        logo: tk.meta?.logo,
        category: "Apps",
        connected: active.has(tk.slug),
      }));
    const own: Integration[] = [
      {
        key: "social",
        name: "Social publishing",
        desc: "Post and schedule to Instagram, LinkedIn, X, TikTok and more through Zernio.",
        category: "Messaging",
        icon: <Megaphone className="h-5 w-5" />,
        to: "/integrations/social-publishing",
        action: socialOn ? "Manage" : "Set up",
        connected: socialOn,
      },
      {
        key: "whatsapp-share",
        name: "WhatsApp share",
        desc: "Send invoices, quotes and receipts to customers straight from any document row.",
        category: "Messaging",
        icon: <BrandIcon name="whatsapp" className="h-5 w-5" />,
        builtin: true,
        note: "No setup — use Send → WhatsApp.",
      },
      {
        key: "templates",
        name: "Email Templates",
        desc: "Reusable email templates with placeholders for customer documents.",
        category: "Email",
        icon: <FileText className="h-5 w-5" />,
        to: "/email-templates",
        action: "Open",
        builtin: true,
      },
      {
        key: "ai",
        name: "Filey AI",
        desc: "Connect an AI provider to power the agent and the smart features.",
        category: "AI",
        icon: <Sparkles className="h-5 w-5" />,
        to: "/settings?section=ai",
        action: "Configure",
      },
      {
        key: "reach",
        name: "Web research",
        desc: "Let the Filey AI read and search public web pages to answer questions the books can't.",
        category: "AI",
        icon: <Globe className="h-5 w-5" />,
        to: "/integrations/web-research",
        action: reachOn ? "Manage" : "Set up",
        connected: reachOn,
      },
      {
        key: "leads",
        name: "Lead enrichment",
        desc: "Fill in a company's contact details and TRN from their own website, and rank leads from your trading history.",
        category: "CRM",
        icon: <UserSearch className="h-5 w-5" />,
        to: "/integrations/lead-enrichment",
        action: reachOn ? "Manage" : "Set up",
        connected: reachOn,
      },
      {
        key: "pdf",
        name: "PDF Tools",
        desc: "Merge, split, compress and convert PDFs on-device — no network needed.",
        category: "Documents",
        icon: <BrandIcon name="pdf" className="h-5 w-5" />,
        to: "/tools",
        action: "Open",
        builtin: true,
      },
      {
        key: "supabase",
        name: "Supabase Cloud",
        desc: "Cloud sync, shared access and backup for your workspace data.",
        category: "Storage",
        icon: <BrandIcon name="supabase" className="h-5 w-5" />,
        to: "/settings?section=datamode",
        action: "Configure",
        connected: cloudConfigured,
      },
      /* No real backend for these yet — disabled, never a fake toggle. */
      {
        key: "stripe",
        name: "Stripe",
        desc: "Accept card payments and reconcile payouts automatically.",
        category: "Payments",
        icon: <CreditCard className="h-5 w-5" />,
        soon: true,
      },
      {
        key: "quickbooks",
        name: "QuickBooks",
        desc: "Sync invoices and ledger entries with QuickBooks.",
        category: "Accounting",
        icon: <Calculator className="h-5 w-5" />,
        soon: true,
      },
      {
        key: "xero",
        name: "Xero",
        desc: "Sync accounting entries with Xero.",
        category: "Accounting",
        icon: <Landmark className="h-5 w-5" />,
        soon: true,
      },
      {
        key: "shopify",
        name: "Shopify",
        desc: "Import orders and product catalog from your store.",
        category: "Commerce",
        icon: <ShoppingBag className="h-5 w-5" />,
        soon: true,
      },
      {
        key: "hubspot-soon",
        name: "HubSpot CRM sync",
        desc: "Two-way sync of contacts and companies into Filey's own CRM.",
        category: "CRM",
        icon: <Users className="h-5 w-5" />,
        soon: true,
      },
      {
        key: "zapier",
        name: "Zapier",
        desc: "Automate cross-app workflows.",
        category: "Automation",
        icon: <Zap className="h-5 w-5" />,
        soon: true,
      },
      {
        key: "drive-soon",
        name: "Google Drive backup",
        desc: "Mirror your document archive to a Drive folder.",
        category: "Storage",
        icon: <Cloud className="h-5 w-5" />,
        soon: true,
      },
    ];
    // Connectable apps lead: they are the ones that do something new today.
    return [...results, ...apps, ...own];
  }, [active, found, reachOn, socialOn]);

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(integrations.map((i) => i.category)))],
    [integrations]
  );
  const filtered =
    cat === "All" ? integrations : integrations.filter((i) => i.category === cat);

  return (
    <div className="animate-fade-up pb-10">
      <PageHeader
        title="Integrations"
        subtitle="Connect Filey with the tools you already use — and let the AI agent work in them"
      />

      <div className="mb-4 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2">
        <ComposioProvider source={source} onSourceChange={setSource} onSaved={refresh} />
        <ZernioProvider />
        <WhatsAppBridgeProvider />
      </div>

      <div className="mb-4 flex gap-2">
        <input
          className="input flex-1"
          placeholder="Search every app — Instagram, Zoho, Xero, Shopify…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void runSearch()}
        />
        <button className="btn-secondary" onClick={runSearch} disabled={searching}>
          {searching ? <Loader2 size={15} className="animate-spin" /> : "Search"}
        </button>
        <button className="btn-ghost" onClick={refresh} title="Refresh connected apps">
          <RefreshCw size={14} />
        </button>
      </div>

      {msg && (
        <p className="mb-4 rounded-xl bg-hover px-3 py-2 text-[12.5px] font-medium text-muted-foreground">
          {msg}
        </p>
      )}

      <div className="mb-4 flex items-center gap-1.5 flex-wrap">
        {categories.map((c) => (
          <FilterChip key={c} active={cat === c} onClick={() => setCat(c)}>
            {c}
          </FilterChip>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px overflow-hidden rounded-xl border border-border bg-border">
        {filtered.map((i) => (
          <div
            key={i.key}
            className={cn("bg-card p-5 flex flex-col", i.soon && "opacity-60")}
          >
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-lg bg-muted text-foreground grid place-items-center shrink-0 overflow-hidden">
                {i.slug ? <AppLogo slug={i.slug} logo={i.logo} /> : i.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="text-[14px] font-semibold text-foreground">
                    {i.name}
                  </div>
                  {i.soon ? (
                    <Badge tone="neutral">Coming soon</Badge>
                  ) : i.connected ? (
                    <Badge tone="success">
                      <Check size={11} /> Connected
                    </Badge>
                  ) : i.builtin ? (
                    <Badge tone="info">Built in</Badge>
                  ) : null}
                </div>
                <div className="text-[12px] text-muted-foreground mt-0.5">
                  {i.category}
                </div>
              </div>
            </div>

            <p className="text-[13px] text-muted-foreground mt-3 leading-relaxed flex-1 line-clamp-3">
              {i.desc}
            </p>

            <div className="mt-4 flex items-center gap-2 flex-wrap">
              {i.soon ? (
                <button
                  className="btn-secondary"
                  onClick={() =>
                    void notice({
                      message: `${i.name} isn't available yet. Sorry for the inconvenience — we're working to improve your experience.`,
                    })
                  }
                >
                  Not available yet
                </button>
              ) : i.slug ? (
                <>
                  <button
                    className="btn-secondary"
                    onClick={() => connect(i.slug!)}
                    disabled={source === "none" || connecting === i.slug}
                  >
                    {connecting === i.slug ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <ExternalLink size={14} />
                    )}
                    {i.connected ? "Reconnect" : "Connect"}
                  </button>
                  {source === "none" && (
                    <span className="text-[12px] text-muted-foreground">
                      Sign in to connect
                    </span>
                  )}
                </>
              ) : (
                <>
                  {i.to && (
                    <Link to={i.to} className="btn-secondary">
                      {i.connected ? "Manage" : (i.action ?? "Configure")}
                    </Link>
                  )}
                  {i.note && (
                    <span className="text-[12px] text-muted-foreground">{i.note}</span>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** An app's real logo, served by Composio per toolkit. Falls back to a bundled
 *  brand icon, then a plug, so a card never renders empty. A CSP block fires no
 *  error event — the image just never completes — so a timeout backs up onError.
 *  Not lazy: these sit in a scroll container where lazy never triggered. */
function AppLogo({ slug, logo }: { slug: string; logo?: string }) {
  const [broken, setBroken] = useState(false);
  const src = logo || `https://logos.composio.dev/api/${slug}`;

  useEffect(() => {
    setBroken(false);
    const img = new Image();
    img.onerror = () => setBroken(true);
    img.src = src;
    const t = setTimeout(() => !img.naturalWidth && setBroken(true), 2500);
    return () => clearTimeout(t);
  }, [src]);

  if (broken) return <BrandIcon name={slug} className="h-5 w-5" />;
  return (
    <img
      src={src}
      alt=""
      width={22}
      height={22}
      className="h-[22px] w-[22px] rounded object-contain"
      onError={() => setBroken(true)}
    />
  );
}

/** Says who is paying, in the words a customer would use. */
function SourceBadge({ source, own }: { source: KeySource; own: boolean }) {
  if (own)
    return (
      <p className="rounded-xl bg-hover px-3 py-2 text-[12px] font-medium text-muted-foreground">
        Running on <b>your own key</b> — calls go straight to the provider and
        aren't metered by Filey.
      </p>
    );
  if (source === "platform")
    return (
      <p className="rounded-xl bg-success/10 px-3 py-2 text-[12px] font-medium text-success">
        <Check size={11} className="inline" /> Included in your Filey plan —
        nothing to configure. Daily limits apply on the free tier.
      </p>
    );
  return (
    <p className="rounded-xl bg-warning/10 px-3 py-2 text-[12px] font-medium text-warning">
      Sign in to your Filey account to use the built-in integrations, or add your
      own key below.
    </p>
  );
}

/* ── Composio: the key behind every app card above ──────────────────────── */
function ComposioProvider({
  source,
  onSourceChange,
  onSaved,
}: {
  source: KeySource;
  onSourceChange: (s: KeySource) => void;
  onSaved: () => void;
}) {
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    // Desktop keeps the key on the device; the browser's lives in the cloud,
    // where it can be seen to exist but never read back.
    (hasDesktop
      ? getComposioKey().then((k) => !!k.trim())
      : hasCloudKey("composio")
    )
      .then(setHasKey)
      .catch(() => setHasKey(false));
  }, []);

  const save = async () => {
    setBusy(true);
    setMsg("");
    try {
      await setComposioKey(key);
      setHasKey(true);
      setKey("");
      // Prove the key before claiming it works — a typo used to surface later
      // as "the integrations are broken".
      await composioList();
      setMsg("Key works. Connect the apps you want below.");
      void composioKeySource().then(onSourceChange);
      onSaved();
    } catch (e) {
      setMsg(`That key didn't work: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const removeKey = async () => {
    setBusy(true);
    setMsg("");
    try {
      await clearComposioKey();
      setHasKey(false);
      setMsg("Your key was removed — integrations fall back to your Filey plan.");
      void composioKeySource().then(onSourceChange);
      onSaved();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-card p-5">
      <div className="mb-1 flex items-center gap-2">
        <Plug size={17} className="text-primary-500" />
        <p className="text-[14px] font-semibold text-foreground">Connected apps</p>
      </div>
      <p className="mb-3 text-[12.5px] text-muted-foreground">
        Powers every app below. Once an app is connected, the Filey AI agent can
        work in it — read the form response, book the meeting, send the follow-up.
      </p>

      <SourceBadge source={source} own={hasKey} />

      <details className="mt-3">
        <summary className="cursor-pointer text-[12px] font-medium text-muted-foreground hover:text-foreground">
          Use my own Composio key instead
        </summary>
        {!hasDesktop && !cloudConfigured ? (
          <p className="mt-2 rounded-xl bg-warning/10 px-3 py-2 text-[12px] font-medium text-warning">
            Your own key needs either the desktop app (device's encrypted store)
            or a signed-in cloud workspace to keep it in.
          </p>
        ) : (
          <>
            <p className="mt-2 text-[12px] text-muted-foreground">
              {hasDesktop
                ? "Kept in this device's encrypted store. Calls go straight to Composio on your key, so nothing is metered by Filey."
                : "Kept in your workspace, where the browser can replace or remove it but never read it back. Calls still go through Filey's proxy — it just spends your key, so they aren't metered against your plan."}
            </p>
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
              <button className="btn-primary" onClick={save} disabled={busy || !key.trim()}>
                {busy ? <Loader2 size={15} className="animate-spin" /> : "Save & check"}
              </button>
            </div>
            {hasKey && (
              <button
                className="mt-2 h-8 px-3 text-[12px] font-medium text-danger hover:underline"
                onClick={removeKey}
                disabled={busy}
              >
                Remove key
              </button>
            )}
          </>
        )}
      </details>

      {msg && <p className="mt-3 text-[12px] font-medium text-muted-foreground">{msg}</p>}
    </div>
  );
}

/* ── Zernio: social publishing ──────────────────────────────────────────── */
function ZernioProvider() {
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
      setCfg(setZernioConfig({ apiKey: key.trim(), enabled: true }));
      setKey("");
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
    <div className="bg-card p-5">
      <div className="mb-1 flex items-center gap-2">
        <Share2 size={17} className="text-primary-500" />
        <p className="text-[14px] font-semibold text-foreground">Social publishing</p>
      </div>
      <p className="mb-3 text-[12.5px] text-muted-foreground">
        Post and schedule to Instagram, LinkedIn, X, TikTok and more — by hand or
        by asking the agent. Link the accounts themselves at zernio.com.
      </p>

      <SourceBadge source={source} own={own} />

      <div className="mt-3 flex flex-wrap gap-2">
        <Link to="/integrations/social-publishing" className="btn-secondary">
          Open publisher
        </Link>
        <button className="btn-ghost" onClick={check} disabled={busy}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={13} />}
          Check accounts
        </button>
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-[12px] font-medium text-muted-foreground hover:text-foreground">
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
          <button
            className="mt-2 h-8 px-3 text-[12px] font-medium text-danger hover:underline"
            onClick={removeOwn}
            disabled={busy}
          >
            Remove key
          </button>
        )}
      </details>

      {msg && <p className="mt-3 text-[12px] font-medium text-muted-foreground">{msg}</p>}
    </div>
  );
}

/* ── WhatsApp bridge: QR-paired session, no per-message cost ─────────────── */
function WhatsAppBridgeProvider() {
  const [cfg, setCfg] = useState<BridgeConfig>(() =>
    waHasDesktop ? getBridgeConfig() : { autoStart: false, ownerNumber: "" }
  );
  const [st, setSt] = useState<BridgeState>({ state: "stopped" });
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!waHasDesktop) return;
    void bridgeState().then(setSt);
    return onBridgeState(setSt); // QR + connection changes arrive from Rust
  }, []);

  if (!waHasDesktop) {
    return (
      <div className="bg-card p-5">
        <div className="mb-1 flex items-center gap-2">
          <MessageCircle size={17} className="text-primary-500" />
          <p className="text-[14px] font-semibold text-foreground">WhatsApp (QR)</p>
        </div>
        <p className="text-[12.5px] text-muted-foreground">
          A QR-paired WhatsApp session has to stay connected, so it runs in the
          desktop app rather than the browser.
        </p>
      </div>
    );
  }

  const run = async (fn: () => Promise<unknown>) => {
    setMsg("");
    try {
      await fn();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const connected = st.state === "connected";
  const label: Record<string, string> = {
    stopped: "Not running",
    starting: "Starting…",
    connecting: "Waiting for the QR to be scanned",
    connected: "Connected",
    reconnecting: "Reconnecting…",
    logged_out: "Logged out on the phone — re-pair to continue",
  };

  return (
    <div className="bg-card p-5">
      <div className="mb-1 flex items-center gap-2">
        <MessageCircle size={17} className="text-primary-500" />
        <p className="text-[14px] font-semibold text-foreground">WhatsApp (QR)</p>
        <span
          className={cn(
            "ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium",
            connected ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
          )}
        >
          {label[st.state] ?? st.state}
        </span>
      </div>
      <p className="mb-3 text-[12.5px] text-muted-foreground">
        Pairs to a WhatsApp account you own, so chatting with your agent costs
        nothing per message. This drives a real account through an unofficial
        connection — against WhatsApp's terms, and the number can be banned. Use
        one you can afford to lose.
      </p>

      {st.qr && (
        <div className="mb-3 flex items-start gap-3 rounded-xl border border-border p-3">
          <img src={st.qr} alt="WhatsApp pairing QR code" className="h-40 w-40" />
          <p className="text-[12.5px] text-muted-foreground">
            On your phone: WhatsApp → Settings → <b>Linked devices</b> → Link a
            device, then scan this.
          </p>
        </div>
      )}

      <label className="mt-3 block text-[12.5px] text-muted-foreground">
        My WhatsApp number
        <input
          className="input mt-1"
          placeholder="971501234567"
          inputMode="tel"
          defaultValue={cfg.ownerNumber}
          onBlur={(e) => setCfg(setBridgeConfig({ ownerNumber: e.target.value }))}
        />
        <span className="mt-1 block">
          The agent answers you and nobody else. Leave this empty if you paired
          your own phone — messaging yourself already works. Fill it in when the
          paired account is a second number, so Filey knows which number is you.
        </span>
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className="btn-primary" onClick={() => run(startBridge)}>
          {st.state === "stopped" ? "Connect" : "Restart"}
        </button>
        <button className="btn-ghost" onClick={() => run(stopBridge)}>
          Stop
        </button>
        <button
          className="btn-ghost"
          title="Forget the pairing and show a fresh QR — use this if your phone shows “Waiting for this message”."
          onClick={() => {
            if (
              window.confirm(
                "Unpair this WhatsApp session and start over? You'll scan a new QR code."
              )
            )
              void run(resetBridge);
          }}
        >
          Re-pair
        </button>
        <label className="ml-auto flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <input
            type="checkbox"
            checked={cfg.autoStart}
            onChange={(e) => setCfg(setBridgeConfig({ autoStart: e.target.checked }))}
          />
          Start with Filey
        </label>
      </div>

      {msg && <p className="mt-2 text-[12px] font-medium text-danger">{msg}</p>}
    </div>
  );
}
