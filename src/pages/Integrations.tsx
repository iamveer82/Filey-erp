import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Calculator,
  Check,
  Cloud,
  CreditCard,
  FileText,
  Hash,
  Landmark,
  Send,
  ShoppingBag,
  Sparkles,
  Globe,
  UserSearch,
  Users,
  Zap,
} from "lucide-react";
import { PageHeader, Badge, FilterChip } from "../components/ui";
import BrandIcon from "../components/BrandIcon";
import { cn } from "../lib/format";
import { useUI } from "../lib/ui";
import { cloudConfigured } from "../lib/supabase";
import { hasDesktop, composioList } from "../lib/composio";
import { reachReady } from "../lib/reach";

/* ── Integrations directory (Filey-DEMO parity) ────────────────────────────
 * Only surfaces what Filey can really do: every actionable card deep-links to
 * the real settings section or page that configures it, and live "Connected"
 * states come from the actual stores (Composio connections, SMTP config,
 * Supabase cloud). Cards with no real backend are disabled with a
 * "Coming soon" badge — never a fake working toggle. */

type Integration = {
  name: string;
  desc: string;
  category: string;
  icon: ReactNode;
  /** Where the Configure/Open button links (real settings section or page). */
  to?: string;
  /** Button label when not yet connected. */
  action?: string;
  /** Live-connected check, resolved on mount. */
  connected?: boolean;
  /** Works out of the box — no setup needed. */
  builtin?: boolean;
  /** No real backend yet — rendered disabled with a Coming soon badge. */
  soon?: boolean;
  /** Desktop-app-only capability (Composio / SMTP live in the Tauri store). */
  desktopOnly?: boolean;
  /** Extra muted line in the action row (e.g. how a built-in is used). */
  note?: string;
};

export default function Integrations() {
  const { notice } = useUI();
  const [cat, setCat] = useState("All");
  const [composioActive, setComposioActive] = useState<Set<string>>(new Set());
  // Filey-native web tools: connected state is just the local opt-in.
  const reachOn = reachReady();

  useEffect(() => {
    // Live connection states — desktop-only stores, no-op on web.
    if (!hasDesktop) return;
    composioList()
      .then((list) => {
        const on = new Set<string>();
        for (const c of list.items ?? [])
          if ((c.status ?? "").toUpperCase() === "ACTIVE" && c.toolkit?.slug)
            on.add(c.toolkit.slug);
        setComposioActive(on);
      })
      .catch(() => {
        /* key may not be set yet */
      });
  }, []);

  const integrations = useMemo<Integration[]>(
    () => [
      {
        name: "Gmail",
        desc: "Let the Filey AI agent send email from your Gmail account.",
        category: "Email",
        icon: <BrandIcon name="gmail" className="h-5 w-5" />,
        to: "/settings?section=integrations",
        action: "Configure",
        connected: composioActive.has("gmail"),
        desktopOnly: true,
      },
      {
        name: "Email Templates",
        desc: "Reusable email templates with placeholders for customer documents.",
        category: "Email",
        icon: <FileText className="h-5 w-5" />,
        to: "/email-templates",
        action: "Open",
        builtin: true,
      },
      {
        name: "WhatsApp",
        desc: "Share invoices, quotes and receipts with customers over WhatsApp.",
        category: "Messaging",
        icon: <BrandIcon name="whatsapp" className="h-5 w-5" />,
        builtin: true,
        note: "No setup needed — use Send → WhatsApp on any document row.",
      },
      {
        name: "Slack",
        desc: "Let the Filey AI agent post updates to your Slack channels.",
        category: "Messaging",
        icon: <Hash className="h-5 w-5" />,
        to: "/settings?section=integrations",
        action: "Configure",
        connected: composioActive.has("slack"),
        desktopOnly: true,
      },
      {
        name: "Telegram",
        desc: "Message customers via a Telegram bot through the Filey AI agent.",
        category: "Messaging",
        icon: <Send className="h-5 w-5" />,
        to: "/settings?section=integrations",
        action: "Configure",
        connected: composioActive.has("telegram"),
        desktopOnly: true,
      },
      {
        name: "Filey AI",
        desc: "Connect an AI provider to power the agent and smart features.",
        category: "AI",
        icon: <Sparkles className="h-5 w-5" />,
        to: "/settings?section=ai",
        action: "Configure",
      },
      {
        name: "Web research",
        desc: "Let the Filey AI read and search public web pages to answer questions the books can't.",
        category: "AI",
        icon: <Globe className="h-5 w-5" />,
        to: "/integrations/web-research",
        action: reachOn ? "Configure" : "Connect",
        connected: reachOn,
      },
      {
        name: "Lead enrichment",
        desc: "Fill in a company's contact details and TRN from their own website, and rank leads from your trading history.",
        category: "CRM",
        icon: <UserSearch className="h-5 w-5" />,
        to: "/integrations/lead-enrichment",
        action: reachOn ? "Configure" : "Connect",
        connected: reachOn,
      },
      {
        name: "PDF Tools",
        desc: "Merge, split, compress and convert PDFs on-device — no network needed.",
        category: "Documents",
        icon: <BrandIcon name="pdf" className="h-5 w-5" />,
        to: "/tools",
        action: "Open",
        builtin: true,
      },
      {
        name: "Supabase Cloud",
        desc: "Cloud sync, shared access and backup for your workspace data.",
        category: "Storage",
        icon: <BrandIcon name="supabase" className="h-5 w-5" />,
        to: "/settings?section=datamode",
        action: "Configure",
        connected: cloudConfigured,
      },
      /* No real backend for the ones below — disabled, Coming soon. */
      {
        name: "Stripe",
        desc: "Accept card payments and reconcile payouts automatically.",
        category: "Payments",
        icon: <CreditCard className="h-5 w-5" />,
        soon: true,
      },
      {
        name: "QuickBooks",
        desc: "Sync invoices and ledger entries with QuickBooks.",
        category: "Accounting",
        icon: <Calculator className="h-5 w-5" />,
        soon: true,
      },
      {
        name: "Xero",
        desc: "Sync accounting entries with Xero.",
        category: "Accounting",
        icon: <Landmark className="h-5 w-5" />,
        soon: true,
      },
      {
        name: "Shopify",
        desc: "Import orders and product catalog from your store.",
        category: "Commerce",
        icon: <ShoppingBag className="h-5 w-5" />,
        soon: true,
      },
      {
        name: "HubSpot",
        desc: "Bring in CRM contacts and companies.",
        category: "CRM",
        icon: <Users className="h-5 w-5" />,
        soon: true,
      },
      {
        name: "Zapier",
        desc: "Automate cross-app workflows.",
        category: "Automation",
        icon: <Zap className="h-5 w-5" />,
        soon: true,
      },
      {
        name: "Google Drive",
        desc: "Attach documents straight from Drive.",
        category: "Storage",
        icon: <Cloud className="h-5 w-5" />,
        soon: true,
      },
    ],
    [composioActive, reachOn]
  );

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
        subtitle="Connect Filey with the tools you already use"
      />

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
            key={i.name}
            className={cn("bg-card p-5 flex flex-col", i.soon && "opacity-60")}
          >
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-lg bg-muted text-foreground grid place-items-center shrink-0">
                {i.icon}
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

            <p className="text-[13px] text-muted-foreground mt-3 leading-relaxed flex-1">
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
                  {i.desktopOnly && !hasDesktop && (
                    <span className="text-[12px] text-muted-foreground">
                      Runs from the Filey desktop app
                    </span>
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
