import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Globe, ShieldCheck, Sparkles, UserSearch } from "lucide-react";

import { PageHeader, Badge, Field, InfoCard } from "../components/ui";
import { useUI } from "../lib/ui";
import { errMsg } from "../lib/format";
import { getReachConfig, setReachConfig, readUrl } from "../lib/reach";
import { enrichFromWebsite } from "../lib/scout";
import { CAPABILITIES } from "../lib/capabilities";

/* Connect pages for the Filey-native integrations — the ones Filey implements
 * itself rather than brokering through Composio. Both sit on the same web
 * reader, so they share one settings store and one route. */

type AppId = "web-research" | "lead-enrichment";

const APPS: Record<
  AppId,
  { title: string; subtitle: string; icon: typeof Globe; tools: string[] }
> = {
  "web-research": {
    title: "Web research",
    subtitle: "Let the Filey AI read and search the public web",
    icon: Globe,
    tools: ["read_web_page", "search_web"],
  },
  "lead-enrichment": {
    title: "Lead enrichment",
    subtitle: "Fill in company details from their own website, and rank leads",
    icon: UserSearch,
    tools: ["enrich_company_website", "score_lead"],
  },
};

export default function IntegrationConnect() {
  const { app } = useParams<{ app: string }>();
  const meta = APPS[app as AppId];
  const { toast } = useUI();

  const [cfg, setCfg] = useState(getReachConfig);
  const [probe, setProbe] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");

  if (!meta)
    return (
      <div className="animate-fade-up">
        <PageHeader title="Unknown integration" subtitle={`No app called "${app}"`} />
        <Link to="/integrations" className="btn-secondary">
          <ArrowLeft size={15} /> Back to integrations
        </Link>
      </div>
    );

  const save = (patch: Partial<typeof cfg>) => setCfg(setReachConfig(patch));

  const runProbe = async () => {
    setBusy(true);
    setResult("");
    try {
      if (app === "lead-enrichment") {
        const d = await enrichFromWebsite(probe);
        setResult(JSON.stringify(d, null, 2));
      } else {
        const p = await readUrl(probe);
        setResult(`${p.title}\n\n${p.text.slice(0, 600)}`);
      }
    } catch (e) {
      toast.error(errMsg(e) || "Could not reach that page");
    } finally {
      setBusy(false);
    }
  };

  const Icon = meta.icon;
  const capability = CAPABILITIES.find((c) => c.id === "web");

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={meta.title}
        subtitle={meta.subtitle}
        action={
          <Link to="/integrations" className="btn-secondary">
            <ArrowLeft size={15} /> Integrations
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <InfoCard
          title="Connection"
          action={<Icon size={15} className="text-brand-400" />}
        >
          <label className="flex items-start gap-3 py-2 cursor-pointer">
            <input
              type="checkbox"
              checked={cfg.enabled}
              onChange={(e) => save({ enabled: e.target.checked })}
              className="mt-1 cursor-pointer"
            />
            <span>
              <span className="block text-sm font-medium text-ink">
                Allow Filey AI to read the public web
              </span>
              <span className="block text-xs text-brand-500 mt-0.5">
                Off by default. Pages are fetched only when the assistant needs one to
                answer you — nothing is crawled in the background.
              </span>
            </span>
          </label>

          <Field label="Jina API key (optional)">
            <input
              className="input"
              type="password"
              autoComplete="off"
              placeholder="Raises the rate limit — reading works without one"
              value={cfg.apiKey}
              onChange={(e) => save({ apiKey: e.target.value })}
            />
          </Field>
          <p className="text-xs text-brand-500">
            Stored on this device only, like your AI model key — it never syncs to the
            cloud.
          </p>
        </InfoCard>

        <InfoCard
          title="Try it"
          action={<Sparkles size={15} className="text-brand-400" />}
        >
          <Field label={app === "lead-enrichment" ? "Company website" : "Page URL"}>
            <input
              className="input"
              placeholder={
                app === "lead-enrichment"
                  ? "acme-trading.ae"
                  : "https://example.com/about"
              }
              value={probe}
              onChange={(e) => setProbe(e.target.value)}
            />
          </Field>
          <button
            className="btn-primary"
            disabled={!cfg.enabled || !probe.trim() || busy}
            onClick={runProbe}
          >
            {busy ? "Reading…" : "Test"}
          </button>
          {!cfg.enabled && (
            <p className="mt-2 text-xs text-brand-500">Turn the connection on first.</p>
          )}
          {result && (
            <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-[12px] text-ink">
              {result}
            </pre>
          )}
        </InfoCard>

        <InfoCard
          title="What the assistant gains"
          action={<Sparkles size={15} className="text-brand-400" />}
        >
          <ul className="space-y-2">
            {meta.tools.map((t) => (
              <li key={t} className="flex items-center gap-2 text-sm">
                <Badge tone="info">{t}</Badge>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-brand-500">
            These sit in the "{capability?.name}" capability — switch the whole group off
            any time in Settings → Capabilities.
          </p>
        </InfoCard>

        <InfoCard
          title="What Filey won't collect"
          action={<ShieldCheck size={15} className="text-brand-400" />}
        >
          <p className="text-sm text-ink">
            Filey reads what a company publishes about itself. It does not scrape social
            profiles, drive LinkedIn with your session cookie, guess email addresses from
            name patterns, or probe mail servers to test whether an address exists.
          </p>
          <p className="mt-2 text-xs text-brand-500">
            Those break the platforms' terms, collect personal data with no lawful basis
            under the UAE PDPL and GDPR, and get your sending domain blocklisted — which
            would stop your invoices arriving. See docs/LEAD-DATA.md.
          </p>
        </InfoCard>
      </div>
    </div>
  );
}
