import { FileySpinner as Loader2 } from "../components/FileySpinner";
import FreeConnections from "../components/FreeConnections";
import WorkServices from "../components/WorkServices";
import EmailConnection from "../components/EmailConnection";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Calculator,
  Check,
  ChevronDown,
  Cloud,
  CreditCard,
  ExternalLink,
  FileText,
  Globe,
  Landmark,
  Megaphone,
  Plug,
  RefreshCw,
  Search,
  ShieldCheck,
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
import AppIcon from "../components/AppIcon";
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
  hasOwnComposioKey,
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
import { agentStorageScope, AGENT_STORAGE_EVENT } from "../lib/agentStorage";
import { waLogList } from "../lib/waLog";

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
  available?: boolean;
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
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get("tab") || "available";
  const tab = ["available", "free", "services", "providers"].includes(requestedTab)
    ? requestedTab
    : "available";
  const setTab = (next: string) =>
    setParams(
      (current) => {
        const copy = new URLSearchParams(current);
        copy.set("tab", next);
        return copy;
      },
      { replace: true }
    );
  const [cat, setCat] = useState("All");
  const [active, setActive] = useState<Set<string>>(new Set());
  const [source, setSource] = useState<KeySource>("none");
  const [connecting, setConnecting] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [search, setSearch] = useState("");
  const [found, setFound] = useState<ToolkitInfo[]>([]);
  const [searching, setSearching] = useState(false);
  const [refreshing, setRefreshing] = useState(true);
  const reachOn = reachReady();
  const [socialOn, setSocialOn] = useState(false);

  const requestGeneration = useRef(0);
  const current = (scope: string | null) => scope === agentStorageScope();
  const refresh = useCallback(async () => {
    const scope = agentStorageScope();
    const generation = ++requestGeneration.current;
    const valid = () => generation === requestGeneration.current && scope === agentStorageScope();
    setRefreshing(true);
    try {
      const keySource = await composioKeySource();
      if (!valid()) return;
      setSource(keySource);
      if (keySource === "none") {
        setActive(new Set());
        setMsg("");
      } else {
        const list = await composioList();
        if (!valid()) return;
        setActive(new Set((list.items ?? []).filter(c => c.status?.toUpperCase() === "ACTIVE" && c.toolkit?.slug).map(c => c.toolkit!.slug!)));
        setMsg("");
      }
      const accounts = await listAccounts().catch(() => []);
      if (valid()) setSocialOn(accounts.length > 0);
    } catch (e) {
      if (!valid()) return;
      setActive(new Set()); setSocialOn(false);
      setMsg("Could not verify connected apps: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      if (valid()) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let scope = agentStorageScope();
    const changed = () => {
      if (scope === agentStorageScope()) return;
      scope = agentStorageScope();
      setActive(new Set()); setSocialOn(false); setSource("none"); setFound([]); setConnecting(null); setSearching(false);
      void refresh();
    };
    window.addEventListener(AGENT_STORAGE_EVENT, changed);
    void refresh();
    // Intentionally invalidate the latest request counter on unmount; this is not a DOM ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { ++requestGeneration.current; window.removeEventListener(AGENT_STORAGE_EVENT, changed); };
  }, [refresh]);

  const runSearch = async () => {
    const scope = agentStorageScope();
    const q = search.trim();
    if (!q) return setFound([]);
    if (source === "none") {
      setMsg(
        "Showing matching built-in apps. Configure a provider to search its full catalogue."
      );
      return;
    }
    setSearching(true);
    setMsg("");
    try {
      const results = await composioSearchToolkits(q, 12);
      if (current(scope)) setFound(results);
    } catch (e) {
      if (current(scope)) setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      if (current(scope)) setSearching(false);
    }
  };

  const connect = async (slug: string) => {
    const scope = agentStorageScope();
    setConnecting(slug);
    setMsg("");
    try {
      const link = await composioConnect(slug);
      if (!current(scope)) return;
      if (link.error) throw new Error(link.error.message);
      if (!link.redirect_url || !link.connected_account_id)
        throw new Error("Composio did not return a connection link.");
      // OAuth consent opens in the real browser on desktop; in a browser build
      // there is no opener plugin, and a new tab is the same thing.
      if (hasDesktop) await openUrl(link.redirect_url);
      else window.open(link.redirect_url, "_blank", "noopener");
      setMsg(
        `Authorize ${slug} in the browser window - this flips to Connected when you're done.`
      );
      const id = link.connected_account_id;
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        if (!current(scope)) return;
        const st = await composioStatus(id);
        if (!current(scope)) return;
        if ((st?.status ?? "").toUpperCase() === "ACTIVE") {
          setActive((prev) => new Set(prev).add(slug));
          setMsg(`${slug} connected ✓ - the Filey AI agent can now use it.`);
          break;
        }
      }
    } catch (e) {
      if (current(scope)) setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      if (current(scope)) setConnecting(null);
    }
  };

  const integrations = useMemo<Integration[]>(() => {
    const apps: Integration[] = COMPOSIO_TOOLKITS.map((tk) => ({
      key: `composio:${tk.slug}`,
      slug: tk.slug,
      name: tk.slug === "whatsapp" ? "WhatsApp via Composio" : tk.name,
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
        key: "whatsapp-qr",
        name: "WhatsApp (QR)",
        desc: "Pair WhatsApp in the desktop app to send messages and PDF attachments. No API key required.",
        category: "Messaging",
        icon: <BrandIcon name="whatsapp" className="h-5 w-5" />,
        builtin: true,
        to: "/integrations?tab=free",
        action: "Set up WhatsApp",
      },
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
        note: "Opens a text draft. Use Share PDF or paired desktop WhatsApp for attachments.",
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
        desc: "Run Ollama or LM Studio on your device, or bring your own provider key. Hosted free tiers have provider limits.",
        category: "AI",
        icon: <Sparkles className="h-5 w-5" />,
        to: "/settings?section=ai",
        action: "Configure",
      },
      {
        key: "reach",
        name: "Web research",
        desc: "Read public pages without a key; add your Jina key for web search.",
        category: "AI",
        icon: <Globe className="h-5 w-5" />,
        to: "/integrations/web-research",
        action: reachOn ? "Manage" : "Set up",
        available: reachOn,
      },
      {
        key: "leads",
        name: "Lead enrichment",
        desc: "Fill in a company's contact details and TRN from their own website, and rank leads from your trading history.",
        category: "CRM",
        icon: <UserSearch className="h-5 w-5" />,
        to: "/integrations/lead-enrichment",
        action: reachOn ? "Manage" : "Set up",
        available: reachOn,
      },
      {
        key: "pdf",
        name: "PDF Tools",
        desc: "Merge, split, compress and convert PDFs on-device - no network needed.",
        category: "Documents",
        icon: <AppIcon name="tools" className="h-5 w-5" />,
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
        available: cloudConfigured,
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
    return [...own, ...results, ...apps].filter((item) => !item.soon);
  }, [active, found, reachOn, socialOn]);

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(integrations.map((i) => i.category)))],
    [integrations]
  );
  const filtered = integrations.filter(
    (i) =>
      (cat === "All" || i.category === cat) &&
      (!search.trim() ||
        `${i.name} ${i.desc} ${i.category}`
          .toLowerCase()
          .includes(search.trim().toLowerCase()))
  );


  return (
    <div className="mx-auto max-w-6xl pb-10">
      <PageHeader
        title="Integrations"
        subtitle="Your apps, connected to your workspace."
        action={
          <div className="flex flex-wrap gap-2">
            <Link className="btn-ghost" to="/docs?article=integrations">Setup guide</Link>
            <Link className="btn-ghost" to="/browser"><Globe size={16} /> Open browser</Link>
          </div>
        }
      />

      <nav aria-label="Integration sections" className="mb-6 flex items-center gap-2 overflow-x-auto border-b border-border pb-3">
        {[
          ["available", "App directory"],
          ["services", "Free work tools"],
          ["free", "Built-in connections"],
          ["providers", "Provider setup"],
        ].map(([key, title]) => (
          <button
            key={key}
            className={cn("chip min-h-11 shrink-0 whitespace-nowrap md:min-h-10", tab === key && "chip-active")}
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
          >
            {title}
          </button>
        ))}
      </nav>
      {tab === "services" && <WorkServices />}
      {tab === "free" && (
        <>
          <WhatsAppBridgeProvider key={agentStorageScope() ?? "signed-out"} />
          <EmailConnection />
          <FreeConnections />
        </>
      )}
      {tab === "providers" && (
        <>
          <section className="mb-5 flex flex-wrap items-center gap-4 border-b border-border pb-5">
            <Sparkles size={20} className="shrink-0" />
            <div className="flex-1 min-w-48">
              <h2 className="font-semibold text-sm">AI models</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Set up local Ollama or LM Studio, OpenRouter free models, or another
                compatible provider.
              </p>
            </div>
            <Link className="btn-secondary" to="/settings?section=ai">
              Configure AI
            </Link>
            <Link className="btn-ghost" to="/docs?article=ai-setup">
              Setup guide
            </Link>
          </section>
          <div key={agentStorageScope() ?? "signed-out"} className="mb-4 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            <ComposioProvider
              source={source}
              onSourceChange={setSource}
              onSaved={refresh}
            />
            <ZernioProvider />
          </div>
          <Link className="btn-secondary mb-4" to="/integrations?tab=free">
            Set up WhatsApp (QR)
          </Link>
          <p className="text-xs text-muted-foreground">
            Your own keys use your provider account. Provider charges, quotas and app
            authorization still apply; Filey does not supply unlimited third-party access.
          </p>
        </>
      )}
      {tab === "available" && (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <div className="relative min-w-48 flex-1">
            <Search size={16} className="pointer-events-none absolute start-3 top-3 text-muted-foreground" aria-hidden="true" />
            <input
              className="input ps-10"
              aria-label="Search integrations"
              placeholder="Search apps and connections"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void runSearch()}
            />
            </div>
            <button className="btn-secondary" onClick={runSearch} disabled={searching}>
              {searching ? "Searching…" : "Search"}
            </button>
            <button
              className="btn-ghost"
              onClick={refresh}
              title="Refresh connected apps"
              aria-label="Refresh connected apps"
              disabled={refreshing}
            >
              {refreshing ? <Loader2 size={16} /> : <RefreshCw size={16} />}
            </button>
          </div>

          {msg && (
            <p role="status" className="mb-4 rounded-[8px] bg-hover px-3 py-3 text-[13px] text-muted-foreground">
              {msg}
            </p>
          )}

          <div className="mb-5 flex items-center gap-1.5 overflow-x-auto pb-1 [&>button]:min-h-11 [&>button]:shrink-0 md:[&>button]:min-h-10" aria-label="Filter integrations">
            {categories.map((c) => (
              <FilterChip key={c} active={cat === c} onClick={() => setCat(c)}>
                {c}
              </FilterChip>
            ))}
          </div>

          {source === "none" && !refreshing && (
            <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl bg-hover px-4 py-3">
              <Plug size={18} className="shrink-0 text-muted-foreground" />
              <p className="min-w-48 flex-1 text-[13px] text-muted-foreground">Built-in connections work independently. Add a provider to link other apps.</p>
              <button className="btn-ghost" onClick={() => setTab("providers")}>Provider setup</button>
            </div>
          )}
          {[
            { title: "In Filey", items: filtered.filter(i => !i.slug) },
            { title: "Connected apps", items: filtered.filter(i => i.slug && i.connected) },
            { title: "More apps", items: filtered.filter(i => i.slug && !i.connected) },
          ].filter(group => group.items.length).map(group => (
          <section key={group.title} aria-label={group.title} className="mb-6">
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-sm font-semibold">{group.title}</h2>
              {group.title === "Connected apps" && <span className="text-xs text-muted-foreground">{group.items.length}</span>}
            </div>
            <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {group.items.map((i) => (
              <div
                key={i.key}
                className="grid grid-cols-[40px_minmax(0,1fr)] gap-x-3 gap-y-3 p-4 sm:grid-cols-[40px_minmax(0,1fr)_auto] sm:items-center"
              >
                  <div className="h-10 w-10 rounded-[8px] bg-muted text-foreground grid place-items-center shrink-0 overflow-hidden">
                    {i.slug ? <AppLogo slug={i.slug} logo={i.logo} /> : i.icon}
                  </div>
                  <div className="min-w-0">
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
                      ) : i.available ? (
                        <Badge tone="neutral">Available</Badge>
                      ) : i.builtin ? (
                        <Badge tone="neutral">Built in</Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 max-w-[65ch] text-[13px] leading-relaxed text-muted-foreground">{i.desc}</p>
                    {i.note && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{i.note}</p>}
                  </div>
                <div className="col-start-2 flex items-center gap-2 sm:col-start-3 sm:justify-end">
                  {i.soon ? (
                    <button
                      className="btn-secondary"
                      onClick={() =>
                        void notice({
                          message: `${i.name} isn't available yet. Sorry for the inconvenience - we're working to improve your experience.`,
                        })
                      }
                    >
                      Not available yet
                    </button>
                  ) : i.slug ? (
                    <>
                      {source === "none" ? <button className="btn-ghost" onClick={() => setTab("providers")}>Set up</button> : <button
                        className="btn-ghost"
                        onClick={() => connect(i.slug!)}
                        disabled={connecting === i.slug}
                      >
                        {connecting === i.slug ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <ExternalLink size={14} />
                        )}
                        {i.connected ? "Reconnect" : "Connect"}
                      </button>}
                    </>
                  ) : (
                    <>
                      {i.to && (
                        <Link to={i.to} className={i.key === "whatsapp-qr" ? "btn-primary" : "btn-ghost"}>
                          {i.connected ? "Manage" : (i.action ?? "Configure")}
                        </Link>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
            </div>
          </section>
          ))}
          {filtered.length === 0 && (
            <div className="rounded-xl border border-border bg-card p-8 text-center">
              <p className="text-sm font-medium">No matching integrations</p>
              <p className="mt-1 text-[13px] text-muted-foreground">Try a different app name or category.</p>
              <button className="btn-ghost mt-4" onClick={() => { setSearch(""); setCat("All"); setFound([]); }}>Clear filters</button>
            </div>
          )}
        </>
      )}
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
    (hasDesktop ? hasOwnComposioKey() : hasCloudKey("composio"))
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
      setMsg("Your key was removed - integrations fall back to your Filey plan.");
      void composioKeySource().then(onSourceChange);
      onSaved();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-card p-5 flex flex-col">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-lg bg-muted text-foreground grid place-items-center shrink-0">
          <Plug size={17} className="text-primary-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[14px] font-semibold text-foreground">Connected apps</p>
            <KeyBadge source={source} own={hasKey} />
          </div>
          <p className="text-[13px] text-muted-foreground mt-1">
            Composio links your app accounts so Filey AI can work with them.
          </p>
        </div>
      </div>

      <details className="mt-3 group">
        <summary className="min-h-10 cursor-pointer text-[13px] font-medium text-muted-foreground hover:text-foreground list-none inline-flex items-center gap-2">
          <ChevronDown size={12} className="transition-transform group-open:rotate-180" />
          {hasKey ? "Manage your key" : "Use my own Composio key"}
        </summary>
        {!hasDesktop && !cloudConfigured ? (
          <p className="mt-2 rounded-lg bg-warning/10 px-2.5 py-1.5 text-[12px] font-medium text-warning">
            Your own key needs the desktop app or a signed-in cloud workspace.
          </p>
        ) : (
          <div className="mt-2">
            <p className="text-[11.5px] text-muted-foreground">
              {hasDesktop
                ? "Kept in this device's encrypted store; calls go straight to Composio, unmetered by Filey."
                : "Kept in your workspace — replaceable, never readable; calls spend your key, not your plan."}
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="field flex-1">
                <span className="label">Composio API key</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  disabled={busy}
                  className="input"
                  placeholder={hasKey ? "•••••••• (saved - paste to replace)" : "ak_…"}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                />
              </label>
              <button
                className="btn-primary"
                onClick={save}
                disabled={busy || !key.trim()}
              >
                {busy ? "Checking…" : "Save & check"}
              </button>
            </div>
            {hasKey && (
              <button
                className="btn-ghost mt-2 text-danger"
                onClick={removeKey}
                disabled={busy}
              >
                Remove key
              </button>
            )}
          </div>
        )}
      </details>

      {msg && (
        <p role="status" className="mt-2 text-[12px] font-medium text-muted-foreground">
          {msg}
        </p>
      )}
    </div>
  );
}

/** Compact one-line key status — the full sentences live in the key panel. */
function KeyBadge({ source, own }: { source: KeySource; own: boolean }) {
  if (own) return <Badge tone="info">Own key</Badge>;
  if (source === "platform") return <Badge tone="success">Filey provider</Badge>;
  return <Badge tone="neutral">Not configured</Badge>;
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
      setMsg(`Key works - ${accounts.length} account(s) connected.`);
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
          ? `Working - ${accounts.length} account(s) connected.`
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
    setMsg("Your key was removed - publishing falls back to your Filey plan.");
  };

  return (
    <div className="bg-card p-5 flex flex-col">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-lg bg-muted text-foreground grid place-items-center shrink-0">
          <Share2 size={17} className="text-primary-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[14px] font-semibold text-foreground">Social publishing</p>
            <KeyBadge source={source} own={own} />
          </div>
          <p className="text-[13px] text-muted-foreground mt-1">
            Post and schedule to Instagram, LinkedIn, X and more through Zernio.
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link to="/integrations/social-publishing" className="btn-secondary">
          Open publisher
        </Link>
        <button className="btn-ghost" onClick={check} disabled={busy}>
          {busy ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={13} />
          )}
          Check
        </button>
      </div>

      <details className="mt-3 group">
        <summary className="min-h-10 cursor-pointer text-[13px] font-medium text-muted-foreground hover:text-foreground list-none inline-flex items-center gap-2">
          <ChevronDown size={12} className="transition-transform group-open:rotate-180" />
          {own ? "Manage your key" : "Use my own Zernio key"}
        </summary>
        <div className="mt-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="field flex-1">
              <span className="label">Zernio API key</span>
              <input
                type="password"
                autoComplete="new-password"
                disabled={busy}
                className="input"
                placeholder={own ? "•••••••• (saved - paste to replace)" : "sk_…"}
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
            </label>
            <button
              className="btn-primary"
              onClick={saveOwn}
              disabled={busy || !key.trim()}
            >
              {busy ? "Checking…" : "Save & check"}
            </button>
          </div>
          {own && (
            <button
              className="btn-ghost mt-2 text-danger"
              onClick={removeOwn}
              disabled={busy}
            >
              Remove key
            </button>
          )}
        </div>
      </details>

      {msg && (
        <p role="status" className="mt-2 text-[12px] font-medium text-muted-foreground">
          {msg}
        </p>
      )}
    </div>
  );
}

/* ── WhatsApp bridge: QR-paired session, no per-message cost ─────────────── */
function WhatsAppBridgeProvider() {
  const desktop = waHasDesktop;
  const [cfg, setCfg] = useState<BridgeConfig>(() =>
    desktop ? getBridgeConfig() : { autoStart: false, ownerNumber: "" }
  );
  const [st, setSt] = useState<BridgeState>({ state: "stopped" });
  const [msg, setMsg] = useState("");
  const [ownerNumber, setOwnerNumber] = useState(cfg.ownerNumber);
  // What the bridge actually saw, newest first — "is it receiving my
  // messages, is it answering" answered by evidence instead of guesswork.
  const [activity, setActivity] = useState(() => waLogList({ limit: 4 }).reverse());
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);

  useEffect(() => {
    if (!desktop) return;
    let current = true;
    let receivedEvent = false;
    const unlisten = onBridgeState((state) => {
      receivedEvent = true;
      if (current) setSt(state);
    });
    void bridgeState().then((state) => {
      if (current && !receivedEvent) setSt(state);
    });
    return () => { current = false; unlisten(); };
  }, [desktop]);

  // Replies don't change connection status: refresh when the conversation is
  // saved as well, so a live connection never shows a stale activity trail.
  useEffect(() => {
    const refresh = () => setActivity(waLogList({ limit: 4 }).reverse());
    refresh();
    window.addEventListener(AGENT_STORAGE_EVENT, refresh);
    return () => window.removeEventListener(AGENT_STORAGE_EVENT, refresh);
  }, [st.state]);

  // The browser build has no WhatsApp bridge to drive — the card still shows
  // the full pairing surface, locked, so it's obvious what WhatsApp connect
  // is and that it lives in the desktop app.
  const locked = !desktop;

  const run = async (fn: () => Promise<unknown>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMsg("");
    try {
      await fn();
      setSt(await bridgeState());
      const next = getBridgeConfig();
      setCfg(next);
      setOwnerNumber(next.ownerNumber);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const connected = st.state === "connected";
  const pairedPhone = st.me?.split("@")[0].split(":")[0] ?? "";
  const separateOwner = !!cfg.ownerNumber && cfg.ownerNumber !== pairedPhone;
  const pairing = st.state === "starting" || st.state === "connecting";
  const label: Record<string, string> = locked
    ? { stopped: "Needs desktop app" }
    : {
        stopped: "Not running",
        starting: "Starting…",
        connecting: st.qr ? "Waiting for QR scan" : "Connecting…",
        connected: "Connected",
        reconnecting: "Reconnecting…",
        logged_out: "Pair again",
        error: "Connection problem",
      };

  return (
    <section aria-label="WhatsApp connection" className="mb-6 overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-start gap-3 p-5">
        <div className="h-10 w-10 rounded-[8px] bg-muted text-foreground grid place-items-center shrink-0">
          <BrandIcon name="whatsapp" className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-foreground">WhatsApp</h2>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
                connected
                  ? "bg-success/15 text-success"
                  : pairing
                    ? "bg-info/10 text-info"
                    : "bg-muted text-muted-foreground"
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  connected
                    ? "bg-success"
                    : pairing
                      ? "bg-info"
                      : "bg-muted-foreground/50"
                )}
              />
              {label[st.state] ?? st.state}
            </span>
          </div>
          <p className="mt-1 max-w-[65ch] text-[13px] leading-relaxed text-muted-foreground">
            Ask Filey AI for help, documents and PDFs from your WhatsApp chat.
          </p>
        </div>
      </div>

      <div className="grid gap-5 border-t border-border p-5 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.7fr)]">
        <div className="min-w-0">
          {locked ? (
            <>
              <h3 className="text-sm font-medium">Connect from the desktop app</h3>
              <p className="mt-2 max-w-[65ch] text-[13px] leading-relaxed text-muted-foreground">
                This browser cannot pair a WhatsApp account. Open the installed Filey app, then go to Integrations → Built-in connections → Connect WhatsApp.
              </p>
            </>
          ) : connected ? (
            <>
              <h3 className="text-sm font-medium">Send a task from your phone</h3>
              <p className="mt-2 max-w-[65ch] text-[13px] leading-relaxed text-muted-foreground">
                {separateOwner ? "From your owner number, send a message to the paired number." : "On your phone, open your own WhatsApp chat (Message yourself) and send a task."}
                {" "}Keep Filey open and signed in.
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">Send <code className="font-mono text-foreground">/status</code> to check that the agent is ready. A paired connection alone does not confirm an AI reply.</p>
            </>
          ) : (
            <>
              <h3 className="text-sm font-medium">Link your phone</h3>
              <ol className="mt-2 list-decimal space-y-2 ps-4 text-[13px] leading-relaxed text-muted-foreground">
                <li>Select Connect WhatsApp to show a QR code.</li>
                <li>On your phone, open WhatsApp → Settings → <b className="font-medium text-foreground">Linked devices</b> → Link a device.</li>
                <li>Scan the code, then send <code className="font-mono text-foreground">/status</code> in your own chat.</li>
              </ol>
            </>
          )}
          {st.qr && !connected && (
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <img src={st.qr} alt="WhatsApp pairing QR code" width={192} height={192} className="h-48 w-48 shrink-0 rounded-[8px] bg-white p-2" />
              <p className="max-w-48 text-xs leading-relaxed text-muted-foreground">Keep this code private. It links your WhatsApp account to Filey on this computer.</p>
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          className="btn-primary"
          disabled={locked || busy || pairing || connected || st.state === "reconnecting"}
          title={locked ? "Needs the desktop app" : undefined}
          onClick={() => run(startBridge)}
        >
          {busy || pairing ? <Loader2 size={14} className="animate-spin" /> : null}
          {connected ? "WhatsApp connected" : pairing || busy ? "Connecting…" : st.state === "reconnecting" ? "Reconnecting…" : "Connect WhatsApp"}
        </button>
        {st.state !== "stopped" && (
          <button className="btn-ghost" disabled={locked || busy} onClick={() => run(stopBridge)}>
            Stop
          </button>
        )}
        <button
          className="btn-ghost"
          disabled={locked || busy}
          title={
            locked
              ? "Needs the desktop app"
              : "Forget the pairing and show a fresh QR. Use this if your phone shows “Waiting for this message”."
          }
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
          </div>
          {(msg || st.error) && (
            <p role="status" className="mt-3 text-[13px] leading-relaxed text-danger">{whatsAppError(msg || st.error || "")}</p>
          )}
        </div>
        <aside className="min-w-0 text-[13px] leading-relaxed">
          <div className="flex items-center gap-2 font-medium"><ShieldCheck size={16} /> Your private connection</div>
          <p className="mt-2 text-muted-foreground">The agent answers your own chat or the owner number you choose. Messages to other people require your approval.</p>
          {connected && st.me && (
            <dl className="mt-3 space-y-2">
              <div><dt className="text-xs text-muted-foreground">Paired phone</dt><dd className="font-medium tabular-nums">+{pairedPhone}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Who can send tasks</dt><dd>{separateOwner ? `+${cfg.ownerNumber}` : "Your own chat only"}</dd></div>
            </dl>
          )}
          <p className="mt-3 text-xs text-muted-foreground">No API key or per-message bridge fee. Your AI provider may charge for model usage.</p>
        </aside>
      </div>
      <div className="grid gap-4 border-t border-border p-5 md:grid-cols-[200px_minmax(0,1fr)]">
        <div><h3 className="text-[13px] font-medium">Connection preferences</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Choose who can reach your agent.</p></div>
        <div className="min-w-0 space-y-4">
          <label className="flex min-h-10 items-center gap-2 text-[13px]">
            <input type="checkbox" disabled={locked || busy} checked={cfg.autoStart} onChange={(e) => {
              try { setCfg(setBridgeConfig({ autoStart: e.target.checked })); setMsg(""); }
              catch (error) { setMsg(error instanceof Error ? error.message : String(error)); }
            }} />
            Start with Filey
          </label>
          <form onSubmit={(e) => {
            e.preventDefault();
            if (locked || busy || ownerNumber.trim() === cfg.ownerNumber) return;
            void run(async () => {
              setCfg(setBridgeConfig({ ownerNumber: ownerNumber.trim() }));
              if (connected || pairing || st.state === "reconnecting") await startBridge();
            });
          }}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="min-w-0 flex-1"><span className="label">My WhatsApp number</span><input className="input mt-1" placeholder="Country code + phone number" inputMode="tel" type="tel" disabled={locked || busy} value={ownerNumber} onChange={e => setOwnerNumber(e.target.value)} aria-describedby="whatsapp-owner-help" /></label>
              <button className="btn-ghost" disabled={locked || busy || ownerNumber.trim() === cfg.ownerNumber}>Save number</button>
            </div>
            <p id="whatsapp-owner-help" className="mt-2 text-xs leading-relaxed text-muted-foreground">Leave empty when you paired your own phone. Only set a number when you want to send tasks from a different phone.</p>
          </form>
        </div>
      </div>
      {!locked && activity.length > 0 && (
        <details className="group border-t border-border px-5">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 text-[13px] font-medium">Recent activity <ChevronDown size={16} className="transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" /></summary>
          <ul className="space-y-3 pb-5">
            {activity.map((e, i) => <li key={i} className="flex items-start gap-3 text-xs">
              <span className="shrink-0 font-medium">{e.dir === "in" ? "Received" : "Sent"}</span>
              <span className="min-w-0 flex-1 break-words text-muted-foreground">{e.text}</span>
              <time className="shrink-0 text-muted-foreground" dateTime={new Date(e.at).toISOString()}>{new Date(e.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</time>
            </li>)}
          </ul>
        </details>
      )}
      <details className="group border-t border-border px-5">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 text-[13px] font-medium">Using WhatsApp with Filey <ChevronDown size={16} className="transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" /></summary>
        <div className="max-w-[75ch] space-y-2 pb-5 text-xs leading-relaxed text-muted-foreground">
          <p>Ask for an invoice PDF, or attach a PDF or image up to 12 MB for Filey to work on. Send /stop to cancel a task.</p>
          <p>Your pairing is saved on this computer. Filey must remain open and signed in to receive tasks.</p>
          <p>This is an unofficial linked-device connection; WhatsApp may restrict unsupported clients.</p>
        </div>
      </details>
    </section>
  );
}

function whatsAppError(error: string) {
  if (/another Filey account/i.test(error)) return "This phone is linked to another Filey account. Select Re-pair to connect your own phone.";
  if (/sign in/i.test(error)) return "Sign in to Filey before connecting WhatsApp or changing its preferences.";
  if (/workspace changed|account changed/i.test(error)) return "Your workspace changed. Connect WhatsApp again in this workspace.";
  if (/Connect WhatsApp once/i.test(error)) return "Select Connect WhatsApp to link the saved pairing to this Filey account.";
  if (/already running in another Filey window/i.test(error)) return "WhatsApp is running in another Filey window. Close that window, then connect here.";
  if (/binary|not installed|sidecar.*missing/i.test(error)) return "This desktop build is missing WhatsApp support. Install the latest Filey update, then try again.";
  if (/could not read WhatsApp connection status/i.test(error)) return "Filey could not check the WhatsApp connection. Close and reopen Filey, then check again.";
  if (/could not save its pairing|no space|disk full|ENOSPC|os error 112/i.test(error)) return "WhatsApp could not save its pairing on this computer. Check free disk space and folder permissions, then connect again.";
  if (/could not clear WhatsApp pairing/i.test(error)) return "Filey could not remove the old WhatsApp pairing. Close other Filey windows, check folder permissions, then select Re-pair again.";
  if (/could not protect the WhatsApp session|access (?:is )?denied|permission denied|EACCES|EPERM|os error 5\b/i.test(error)) return "Filey cannot access its WhatsApp session files. Close other Filey windows and check your app folder permissions, then try again.";
  if (/rejected this session|connection.?replaced|session.*replaced|multidevice.?mismatch/i.test(error)) return "WhatsApp rejected or replaced this session. Close other Filey windows and connect again. If it persists, select Re-pair.";
  if (/could not start bridge|WhatsApp bridge could not start/i.test(error)) return "WhatsApp could not start on this computer. Close and reopen Filey, then connect again. If it persists, install the latest Filey update.";
  if (/could not reconnect|disconnected|connection dropped/i.test(error)) return "The WhatsApp connection was lost. Check your internet connection, then select Connect WhatsApp to try again.";
  if (/owner|phone number|country code/i.test(error)) return "Enter a valid phone number with its country code, or leave it empty to use your own chat.";
  if (/logged.?out|unauthorized|bad session|restart.?required/i.test(error)) return "Your WhatsApp session needs to be linked again. Select Re-pair and scan the new code.";
  return "WhatsApp could not complete this action. Close and reopen Filey, then try again. If it continues, contact support.";
}
