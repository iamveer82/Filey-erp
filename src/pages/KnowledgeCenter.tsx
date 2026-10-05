import { useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { ArrowUpRight, BookOpen, Download, Play, Search } from "lucide-react";
import { PageHeader } from "../components/ui";
import { AnnotatedText } from "../components/AnnotatedText";
import { isLocalMode } from "../lib/dataMode";
import { getAgentMode } from "../lib/agentMode";
import { downloadText } from "../lib/localPaths";
import { useUI } from "../lib/ui";
import { SelectMenu } from "../components/ui-menu";
import { GUIDES } from "../lib/fileyGuides";

const COUNTRY_COVERAGE = [
  ["UAE", "Invoices, quotes, POs and receipts; AED and foreign-currency documents", "Editable VAT and TRN fields; PINT-AE export", "AED ledger; WPS export fields", "No verified government-gateway submission or filing"],
  ["India", "Invoices, quotes, POs and receipts; INR and other currencies", "GSTIN format and editable tax; country snapshot", "AED ledger; no localized statutory payroll", "No split GST, place-of-supply engine, IRN, e-way bills or returns"],
  ["EU member states", "Individual country selection; EUR and non-euro currencies", "VAT-ID labels and editable line tax", "AED ledger; no national payroll", "No VIES, OSS/IOSS, national e-invoice gateways or returns"],
  ["Saudi Arabia", "Country-aware documents; SAR and other currencies", "Editable VAT and tax-ID fields", "AED ledger; no localized statutory payroll", "No verified government-gateway submission or filing"],
  ["Other countries", "General documents and supported currencies", "Manually configured tax and identifiers", "AED ledger; generic people/pay records", "Country-specific validation, payroll and filings require separate implementation"],
];

export { GUIDES } from "../lib/fileyGuides";


export default function KnowledgeCenter() {
  const help = useLocation().pathname === "/help";
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const { toast } = useUI();
  const article = GUIDES.find((g) => g.id === params.get("article"));
  const filtered = GUIDES.filter((g) =>
    `${g.title} ${g.category} ${g.summary} ${g.steps.join(" ")}`
      .toLowerCase()
      .includes(query.trim().toLowerCase())
  );
  const download = async () => {
    try {
      await downloadText(
        "filey-diagnostics.txt",
        [
          "Filey support diagnostics",
          `Generated: ${new Date().toISOString()}`,
          `Storage: ${isLocalMode() ? "local" : "cloud"}`,
          `Network: ${navigator.onLine ? "online" : "offline"}`,
          `Runtime: ${"__TAURI_INTERNALS__" in window ? "desktop" : "browser"}`,
          `Agent mode: ${getAgentMode()}`,
          "",
          "Add the section, steps, expected result and exact error before sharing.",
          "No business records, logs, account identifiers or credentials are included.",
        ].join("\n"),
        "text/plain"
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <div className="pb-10">
      <PageHeader
        title={help ? "Help Center" : "Documentation"}
        subtitle={
          help
            ? "Find an answer and get back to work."
            : "Practical guides for your connected Filey workspace."
        }
        action={
          <Link className="btn-secondary" to={help ? "/docs" : "/help"}>
            {help ? "Browse documentation" : "Get help"}
            <ArrowUpRight size={14} />
          </Link>
        }
      />
      <div className="grid gap-8 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="min-w-0">
          <label className="flex items-center gap-2 border border-border rounded-lg px-3 bg-card">
            <Search size={16} className="text-muted-foreground" />
            <input
              className="input border-0 bg-transparent px-0 shadow-none"
              aria-label="Search help articles"
              placeholder="Search guides…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="mt-3 lg:hidden"><SelectMenu
            ariaLabel="Choose a help article"
            value={article?.id || ""}
            onChange={id => setParams(id ? { article: id } : {})}
            options={[{ value: "", label: "Choose a guide" }, ...filtered.map(g => ({ value: g.id, label: g.title }))]}
            searchPlaceholder="Find a guide"
          /></div>
          <nav aria-label="Help topics" className="hidden lg:block mt-4 space-y-5">
            {[...new Set(filtered.map((g) => g.category))].map((category) => (
              <div key={category}>
                <h2 className="text-xs font-semibold text-muted-foreground mb-2">
                  {category}
                </h2>
                {filtered
                  .filter((g) => g.category === category)
                  .map((g) => (
                    <button
                      key={g.id}
                      onClick={() => setParams({ article: g.id })}
                      aria-current={article?.id === g.id ? "page" : undefined}
                      className={`block text-left w-full text-sm px-3 py-2 rounded-md ${article?.id === g.id ? "bg-hover font-medium" : "hover:bg-hover text-muted-foreground"}`}
                    >
                      {g.title}
                    </button>
                  ))}
              </div>
            ))}
          </nav>
          {!filtered.length && <p role="status" className="mt-4 text-sm text-muted-foreground">No matching guides. Try “invoice”, “password” or “stock”.</p>}
        </aside>
        <div className="min-w-0">
          {article ? (
            <article className="max-w-3xl">
              <p className="text-sm text-muted-foreground mb-2">{article.category}</p>
              <h2 className="text-2xl font-semibold tracking-tight">{article.title}</h2>
              <p className="text-muted-foreground mt-2">{article.summary}</p>
              <ol className="mt-7 space-y-5 list-decimal pl-5 text-sm leading-7">
                {article.steps.map((step) => (
                  <li key={step} className="pl-2">
                    {step}
                  </li>
                ))}
              </ol>
              {article.id === "international-business" && <section className="mt-7" aria-label="Country capability matrix">
                <h3 className="text-lg font-semibold">Country coverage</h3><p className="help mb-3">Current implementation · ledger amounts remain AED. Country-aware documents do not provide complete national accounting or filing support.</p>
                <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{["Region","Documents","Tax handling","Accounting & payroll","Not included"].map(heading=><th key={heading} className="border-b border-border px-3 py-2 font-medium">{heading}</th>)}</tr></thead><tbody>{COUNTRY_COVERAGE.map(row=><tr key={row[0]}>{row.map((cell,index)=><td key={index} className="min-w-40 border-b border-border px-3 py-3 align-top">{cell}</td>)}</tr>)}</tbody></table></div>
                <p className="help mt-3">English, Arabic and Hindi interfaces use English fallbacks where untranslated. PDF output depends on the selected layout and available fonts. Project and helpdesk owner names are labels; they do not send assignment notifications.</p>
              </section>}
              <div className="mt-7 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => window.dispatchEvent(new CustomEvent("filey:guide:open", { detail: { id: article.id } }))}
                >
                  <Play size={14} aria-hidden="true" />
                  Watch guide
                </button>
                <Link className="btn-primary" to={article.to}>
                  Open section
                  <ArrowUpRight size={14} />
                </Link>
              </div>
              <p className="mt-8 pt-4 border-t border-border text-xs text-muted-foreground">
                Applies to the current Filey workspace. Available actions depend on your
                permissions and enabled modules.
              </p>
            </article>
          ) : (
            <>
              <div className="bg-card border border-border rounded-xl p-6 md:p-8">
                <BookOpen size={26} className="mb-5 text-primary-500" />
                <h2 className="text-2xl font-semibold tracking-tight">
                  {help
                    ? <>What do you need <AnnotatedText>help with?</AnnotatedText></>
                    : <>One workspace, <AnnotatedText variant="highlight">connected</AnnotatedText> workflows.</>}
                </h2>
                <p className="text-sm text-muted-foreground leading-6 mt-3 max-w-xl">
                  Start with a customer, create a quotation, issue an invoice and record
                  payment. These guides explain how the records connect and what to check
                  when something goes wrong.
                </p>
                <button
                  className="btn-primary mt-5"
                  onClick={() => setParams({ article: help ? "login" : "start" })}
                >
                  {help ? "Fix a sign-in problem" : "Set up Filey"}
                </button>
              </div>
              <h2 className="text-base font-semibold mt-7 mb-2">
                {query ? "Search results" : "Common workflows"}
              </h2>
              <div className="divide-y divide-border">
                {(query
                  ? filtered
                  : GUIDES.filter((g) =>
                      [
                        "crm",
                        "invoices",
                        "purchasing",
                        "agent",
                        "charts",
                        "email",
                      ].includes(g.id)
                    )
                ).map((g) => (
                  <button
                    key={g.id}
                    className="w-full text-left py-4 flex items-start gap-4 hover:text-primary-600"
                    onClick={() => setParams({ article: g.id })}
                  >
                    <div className="flex-1">
                      <h3 className="text-sm font-medium">{g.title}</h3>
                      <p className="text-sm text-muted-foreground mt-1">{g.summary}</p>
                    </div>
                    <ArrowUpRight size={16} />
                  </button>
                ))}
              </div>
            </>
          )}
          {help && (
            <section className="mt-8 border-t border-border pt-6">
              <h2 className="text-base font-semibold">Report a reproducible problem</h2>
              <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
                Write down the section, action, expected result and exact error. Download
                a small environment summary to attach to your report. Share it through
                your existing support contact.
              </p>
              <button className="btn-secondary mt-4" onClick={() => void download()}>
                <Download size={14} />
                Download diagnostics
              </button>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
