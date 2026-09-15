import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import RecordInsights from "../../components/RecordInsights";
import { ErrorBanner } from "../../components/ui";
import { billing, receipts, quotes, erp, crm, fin, suppliers, pos, followups, hr, work, tools, emailLog, callLog } from "../../lib/api";
import { CRM_OBJECTS, loadCrmData, label, type CrmObject } from "../../lib/crmWorkspace";
import { DC_SETTING_KEY } from "../../lib/challans";
import { listFiles } from "../../lib/files";
import { todayYmd } from "../../lib/format";
import { useLiveSync } from "../../lib/realtime";

type Row = { category?: string; date?: string };
type Source = { label: string; title: string; dateLabel?: string; note?: string; load: () => Promise<Row[]> };

function summarize<T>(rows: T[], category: (row: T) => unknown, date?: (row: T) => unknown): Row[] {
  return rows.map(row => {
    const group = category(row);
    const when = date?.(row);
    return { category: typeof group === "string" ? label(group) : undefined, date: typeof when === "string" ? when : undefined };
  });
}

async function settingRows(key: string): Promise<Record<string, unknown>[]> {
  // Read the active workspace, never another workspace's unscoped browser cache.
  const saved = (await tools.settings()).find(row => row.key === key)?.value;
  if (saved == null || saved === "") return [];
  const rows: unknown = JSON.parse(saved);
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== "object" || Array.isArray(row)))
    throw new Error("These saved records could not be read. Check the source section before retrying.");
  return rows;
}

const SOURCES: Record<string, Source> = {
  invoices: { label: "Invoices", title: "Invoices by status", dateLabel: "Invoices issued", load: async () => summarize(await billing.listDocs(), r => r.status, r => r.issue_date) },
  quotations: { label: "Quotations", title: "Quotations by status", dateLabel: "Quotations issued", load: async () => summarize(await quotes.listDocs(), r => r.status, r => r.quote_date) },
  receipts: { label: "Payment receipts", title: "Receipts by payment method", dateLabel: "Receipt dates", note: "Counts include all receipt statuses; financial report totals use confirmed receipts only.", load: async () => summarize(await receipts.list(), r => r.payment_method, r => r.payment_date) },
  orders: { label: "Orders", title: "Orders by status", dateLabel: "Orders created", load: async () => summarize(await erp.orders(), r => r.status, r => r.created_at) },
  inventory: { label: "Inventory", title: "Products by category", dateLabel: "Products added", load: async () => summarize(await erp.products(), r => r.category, r => r.created_at) },
  customers: { label: "Customers / companies", title: "Customers by segment", dateLabel: "Customers added", load: async () => summarize(await crm.customers(), r => r.segment, r => r.created_at) },
  suppliers: { label: "Suppliers", title: "Supplier tax details", dateLabel: "Suppliers added", load: async () => summarize(await suppliers.list(), r => r.tax_id ? "Tax ID recorded" : "Tax ID missing", r => r.created_at) },
  purchases: { label: "Expenses", title: "Expenses by category", dateLabel: "Expenses recorded", load: async () => summarize(await fin.expenses(), r => r.category, r => r.expense_date) },
  purchase_orders: { label: "Purchase orders", title: "Purchase orders by status", dateLabel: "Purchase orders placed", load: async () => summarize(await pos.list(), r => r.status, r => r.order_date) },
  followups: { label: "Follow-ups", title: "Follow-up status", dateLabel: "Follow-ups due", load: async () => summarize(await followups.list(), r => r.done ? "Completed" : r.due_date < todayYmd() ? "Overdue" : "Upcoming", r => r.due_date) },
  people: { label: "People", title: "Team by department", dateLabel: "Employees hired", load: async () => summarize(await hr.employees(), r => r.department, r => r.hire_date) },
  projects: { label: "Projects", title: "Projects by status", dateLabel: "Projects created", load: async () => summarize((await work.list()).filter(r => r.kind === "project"), r => r.status, r => r.created_at) },
  helpdesk: { label: "Helpdesk", title: "Tickets by status", dateLabel: "Tickets created", load: async () => summarize((await work.list()).filter(r => r.kind === "ticket"), r => r.status, r => r.created_at) },
  banks: { label: "Bank accounts", title: "Accounts by currency", load: async () => summarize(await settingRows("bank_accounts"), r => r.currency) },
  cheques: { label: "Cheques", title: "Cheques by status", dateLabel: "Cheques added", load: async () => summarize(await settingRows("cheque_register"), r => r.status, r => r.created_at) },
  delivery: { label: "Delivery", title: "Delivery status", dateLabel: "Delivery documents issued", load: async () => summarize(await settingRows(DC_SETTING_KEY), r => r.status || "preparing", r => r.issue_date) },
  emails: { label: "Recent emails", title: "Email delivery status", dateLabel: "Emails sent", note: "Based on the latest 100 email log entries, matching the Communications section.", load: async () => summarize(await emailLog.list(), r => r.status, r => r.sent_at) },
  calls: { label: "Recent calls", title: "Calls by direction", dateLabel: "Calls logged", note: "Based on the latest 100 call log entries, matching the Communications section.", load: async () => summarize(await callLog.list(), r => r.direction, r => r.started_at) },
  files: { label: "My Files", title: "Files by type", dateLabel: "Files saved", load: async () => summarize(await listFiles(), r => r.mime || "Unknown type", r => Number.isFinite(r.createdAt) ? new Date(r.createdAt).toISOString() : undefined) },
  ...Object.fromEntries((Object.keys(CRM_OBJECTS) as CrmObject[]).filter(kind => kind !== "companies").map(kind => {
    const spec = CRM_OBJECTS[kind];
    return [kind, { label: `CRM · ${spec.label}`, title: `${spec.label} by ${spec.group.replace(/_/g, " ")}`, dateLabel: `${spec.label} created`, load: async () => summarize((await loadCrmData())[kind], r => r[spec.group], r => r.created_at) }];
  })),
  lead_sources: { label: "CRM · Lead sources", title: "Lead sources", dateLabel: "Leads created", load: async () => summarize((await loadCrmData()).leads, r => r.source, r => r.created_at) },
};

function SectionInsights({ source }: { source: Source }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const request = useRef(0);
  const load = useCallback(async () => {
    const version = ++request.current;
    setLoading(true);
    setError("");
    try {
      const next = await source.load();
      if (version === request.current) setRows(next);
    } catch (e) {
      if (version === request.current) setError(e instanceof Error ? e.message : "Could not load these insights.");
    } finally {
      if (version === request.current) setLoading(false);
    }
  }, [source]);
  useEffect(() => {
    void load();
    // Intentionally invalidate the latest request counter on unmount; this is not a DOM ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { request.current++; };
  }, [load]);
  useLiveSync(load);
  return <>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">{source.note || "Record counts from the active workspace. Distribution includes all saved records; the trend uses the selected months."}</p>
      <button className="btn-ghost shrink-0" disabled={loading} onClick={() => void load()}><RefreshCw size={14} /> Refresh insights</button>
    </div>
    {error && <div className="mb-4"><ErrorBanner message={error} /></div>}
    <RecordInsights rows={rows} category={r => r.category} date={source.dateLabel ? r => r.date : undefined}
      title={source.title} dateLabel={source.dateLabel} loading={loading} error={!!error} />
  </>;
}

export default function InsightsTab() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("section") || "invoices";
  const section = Object.prototype.hasOwnProperty.call(SOURCES, requested) ? requested : "invoices";
  return <section aria-label="Workspace insights">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div><h2 className="text-base font-semibold">Workspace insights</h2><p className="mt-1 text-sm text-muted-foreground">Explore record counts and trends across your workspace.</p></div>
      <label className="text-sm font-medium">Section
        <select className="select mt-1 w-full sm:w-64" aria-label="Insight section" value={section} onChange={e => {
          const next = new URLSearchParams(params);
          next.set("section", e.target.value);
          setParams(next);
        }}>{Object.entries(SOURCES).map(([id, source]) => <option key={id} value={id}>{source.label}</option>)}</select>
      </label>
    </div>
    <SectionInsights key={section} source={SOURCES[section]} />
  </section>;
}
