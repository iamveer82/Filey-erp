import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FileText, Plus } from "lucide-react";
import {
  billing,
  quotes,
  type InvoiceDocSummary,
  type QuotationSummary,
} from "../../lib/api";
import { errMsg, fmtDate, money } from "../../lib/format";
import { agentStorageScope, requireAgentStorageScope } from "../../lib/agentStorage";
import { linkDealQuotation } from "../../lib/crmSales";
import type { CrmObject, CrmRow } from "../../lib/crmWorkspace";
import { Badge, ErrorBanner } from "../ui";

export default function RecordSales({ kind, row }: { kind: CrmObject; row: CrmRow }) {
  const [docs, setDocs] = useState<{
    invoices: InvoiceDocSummary[];
    quotes: QuotationSummary[];
  } | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const scope = useRef(agentStorageScope());
  const companyId = Number(
    kind === "companies" ? row.id : row.customer_id || row.company_id
  );
  const [linkedQuote, setLinkedQuote] = useState(Number(row.quotation_id) || null);
  useEffect(() => setLinkedQuote(Number(row.quotation_id) || null), [row.quotation_id]);
  useEffect(() => {
    let active = true;
    setError("");
    setDocs(null);
    void Promise.all([billing.listDocs(), quotes.listDocs()])
      .then(([invoices, quotations]) => {
        requireAgentStorageScope(scope.current ?? "signed-out");
        if (active)
          setDocs({
            quotes: quotations.filter(
              (d) =>
                d.customer_id === companyId && (kind !== "deals" || d.id === linkedQuote)
            ),
            invoices: invoices.filter((d) =>
              kind === "deals"
                ? d.id === Number(row.invoice_id) ||
                  (linkedQuote != null && d.quotation_id === linkedQuote)
                : d.customer_id === companyId
            ),
          });
      })
      .catch((e) => {
        if (active) setError(errMsg(e));
      });
    return () => {
      active = false;
    };
  }, [companyId, kind, linkedQuote, row.invoice_id, attempt]);
  const [available, setAvailable] = useState<QuotationSummary[]>([]);
  const [availableLoaded, setAvailableLoaded] = useState(false);
  const loadAvailable = async () => {
    try {
      const rows = await quotes.listDocs();
      requireAgentStorageScope(scope.current ?? "signed-out");
      setAvailable(rows.filter((d) => d.customer_id === companyId));
      setAvailableLoaded(true);
    } catch (e) {
      setError(errMsg(e));
    }
  };
  return (
    <section className="space-y-4" aria-label="Sales documents">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-sm">{kind === "contacts" ? "Company sales documents" : "Sales documents"}</h3>
        {!!companyId && (!linkedQuote || kind !== "deals") && (
          <Link
            className="btn-ghost"
            to={
              kind === "deals"
                ? `/quoting?new=1&deal=${row.id}`
                : `/quoting?new=1&customer=${companyId}`
            }
          >
            <Plus size={14} />
            Prepare quotation
          </Link>
        )}
      </div>
      {kind === "deals" && !linkedQuote && !!companyId && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="btn-ghost"
            disabled={busy}
            onClick={() => void loadAvailable()}
          >
            Choose existing quotation
          </button>
          {availableLoaded && !available.length && <p className="text-xs text-muted-foreground">No quotations for this company yet. Prepare one above.</p>}
          {!!available.length && (
            <>
              <select
                className="select flex-1 min-w-40"
                aria-label="Quotation to link"
                value={selected}
                disabled={busy}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">Choose quotation</option>
                {available.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.number}
                  </option>
                ))}
              </select>
              <button
                className="btn-primary"
                disabled={busy || !selected}
                onClick={async () => {
                  if (inFlight.current) return;
                  inFlight.current = true;
                  setBusy(true);
                  setError("");
                  try {
                    requireAgentStorageScope(scope.current ?? "signed-out");
                    await linkDealQuotation(row.id, Number(selected));
                    setLinkedQuote(Number(selected));
                  } catch (e) {
                    setError(errMsg(e));
                  } finally {
                    inFlight.current = false;
                    setBusy(false);
                  }
                }}
              >
                Link quotation
              </button>
            </>
          )}
        </div>
      )}
      {error && (
        <>
          <ErrorBanner message={error} />
          <button className="btn-ghost" onClick={() => setAttempt((n) => n + 1)}>
            Retry documents
          </button>
        </>
      )}
      {!docs && !error && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading documents…
        </p>
      )}
      {docs && !docs.quotes.length && !docs.invoices.length && (
        <p className="text-sm text-muted-foreground">
          {companyId
            ? "No linked sales documents yet."
            : "Choose a company to connect sales documents."}
        </p>
      )}
      {docs && (
        <div className="divide-y divide-border">
          {[
            ...docs.quotes.map((d) => ({
              ...d,
              type: "Quotation",
              href: `/quoting?open=${d.id}`,
              date: d.quote_date,
              amount: d.total,
            })),
            ...docs.invoices.map((d) => ({
              ...d,
              type: "Invoice",
              href: `/invoicing?open=${d.id}`,
              date: d.due_date,
              amount: d.balance ?? d.total,
            })),
          ].map((d) => (
            <Link
              key={`${d.type}:${d.id}`}
              to={d.href}
              className="flex items-center gap-3 py-3 hover:bg-hover"
            >
              <FileText size={17} className="text-muted-foreground shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{d.number}</span>
                <span className="text-xs text-muted-foreground">
                  {d.type} · {fmtDate(d.date)}
                  {d.type === "Invoice" ? " · Balance" : ""}
                </span>
              </span>
              <span className="text-sm tabular-nums">
                {money(d.amount, d.currency || "AED")}
              </span>
              <Badge>{d.status}</Badge>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
