import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Plus, Sparkles, CheckCircle2, Clock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  erp,
  fin,
  crm,
  quotes,
  pos,
  billing,
  type Product,
  type Order,
  type InvoiceDocSummary,
  type Expense,
  type CrmCustomer,
  type QuotationSummary,
  type PoSummary,
} from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { num, aed, fmtDate, cn } from "../lib/format";
import {
  MetricCard,
  Card,
  Badge,
  Skeleton,
  ErrorBanner,
  Timeline,
  TimelineItem,
} from "../components/ui";
import AiSummaryCard from "../components/AiSummaryCard";
import AppIcon from "../components/AppIcon";

/* ── Modern Overview (preview) ─────────────────────────────────────────────
   Minimal iOS-style dashboard. NOT drag-drop. Sections are fixed and ordered:
   Hero KPIs → Orders trend + Activity → Inventory + Alerts → Money + Customers
   + AI briefing. Data loaders mirror the old Overview — no schema/API changes. */

type Period = "today" | "week" | "month" | "quarter" | "year";

export default function ModernOverview() {
  const nav = useNavigate();

  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [invoices, setInvoices] = useState<InvoiceDocSummary[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [quotations, setQuotations] = useState<QuotationSummary[]>([]);
  const [posList, setPosList] = useState<PoSummary[]>([]);
  const [poPayments, setPoPayments] = useState<{ po_id: number; amount: number }[]>([]);
  const [companyName, setCompanyName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<Period>("month");

  const load = async () => {
    setError("");
    try {
      const [p, o, i, e, c, q, po, comp, poPays] = await Promise.all([
        erp.products().catch(() => [] as Product[]),
        erp.orders().catch(() => [] as Order[]),
        billing.listDocs().catch(() => [] as InvoiceDocSummary[]),
        fin.expenses().catch(() => [] as Expense[]),
        crm.customers().catch(() => [] as CrmCustomer[]),
        quotes.listDocs().catch(() => [] as QuotationSummary[]),
        pos.list().catch(() => [] as PoSummary[]),
        billing.getCompany().catch(() => null),
        pos.allPayments().catch(() => [] as { po_id: number; amount: number }[]),
      ]);
      setProducts(p);
      setOrders(o);
      setInvoices(i);
      setExpenses(e);
      setCustomers(c);
      setQuotations(q);
      setPosList(po);
      setPoPayments(poPays);
      setCompanyName((comp as { name?: string } | null)?.name || "");
    } catch (err: unknown) {
      setError((err as Error)?.message || "Failed to load overview data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useLiveSync(load);

  // ── Derived metrics ────────────────────────────────────────────────────
  const lowStock = useMemo(
    () => products.filter((p) => p.quantity <= p.reorder_level),
    [products]
  );

  const stockBreakdown = useMemo(() => {
    let inStock = 0,
      out = 0,
      low = 0,
      dead = 0;
    for (const p of products) {
      if (p.quantity <= 0) out++;
      else if (p.quantity <= p.reorder_level) low++;
      else inStock++;
    }
    // Slow-moving: in stock but no reorder tracking.
    dead = products.filter((p) => p.quantity > 0 && !p.reorder_level).length;
    return { inStock, out, low, dead, total: products.length };
  }, [products]);

  const orderStats = useMemo(() => {
    const count = (statuses: string[]) =>
      orders.filter((o) => statuses.includes((o.status || "").toLowerCase())).length;
    return {
      completed: count(["completed", "done", "delivered"]),
      progress: count(["in progress", "processing", "pending", "open", "new"]),
      overdue: count(["overdue", "cancelled", "canceled"]),
      returns: count(["returned", "refunded"]),
      total: orders.length,
    };
  }, [orders]);

  const revenue = useMemo(() => {
    const issued = invoices.filter((i) => i.status !== "draft");
    const collected = issued.reduce((s, i) => s + ((i.total || 0) - (i.balance ?? 0)), 0);
    const outstanding = issued
      .filter((i) => i.status !== "paid")
      .reduce((s, i) => s + (i.balance ?? 0), 0);
    const total = issued.reduce((s, i) => s + (i.total || 0), 0);
    return { collected, outstanding, total, count: issued.length };
  }, [invoices]);

  // Vyapar-style receivable/payable: who owes you (unpaid invoice balances,
  // per party) and what you owe suppliers (PO totals minus payments made).
  const receivable = useMemo(() => {
    const parties = new Set<string>();
    let total = 0;
    for (const i of invoices) {
      if (i.status === "draft" || i.status === "paid") continue;
      const bal = i.balance ?? 0;
      if (bal <= 0) continue;
      total += bal;
      parties.add((i.customer_name || "").trim().toLowerCase());
    }
    return { total, parties: parties.size };
  }, [invoices]);

  const payable = useMemo(() => {
    const paidByPo = new Map<number, number>();
    for (const p of poPayments)
      paidByPo.set(p.po_id, (paidByPo.get(p.po_id) || 0) + p.amount);
    const parties = new Set<string>();
    let total = 0;
    for (const po of posList) {
      const s = (po.status || "").toLowerCase();
      if (["draft", "cancelled", "canceled"].includes(s)) continue;
      const due = Math.max(0, (po.total || 0) - (paidByPo.get(po.id) || 0));
      if (due <= 0) continue;
      total += due;
      parties.add((po.supplier_name || "").trim().toLowerCase());
    }
    return { total, parties: parties.size };
  }, [posList, poPayments]);

  const profit = useMemo(() => {
    // PO totals shown as an informational "commitment" line, not deducted
    // from net (material cost only known when PO line items are loaded).
    const poTotal = posList.reduce((s, p) => s + (p.total || 0), 0);
    const expenseTotal = expenses.reduce((s, e) => s + (e.amount || 0), 0);
    const net = revenue.total - expenseTotal;
    return { poTotal, expenseTotal, net };
  }, [revenue, posList, expenses]);

  // ── Trend data (orders by period) ──────────────────────────────────────
  const trend = useMemo(() => {
    const periodMs: Record<Period, number> = {
      today: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
      month: 30 * 24 * 60 * 60 * 1000,
      quarter: 90 * 24 * 60 * 60 * 1000,
      year: 365 * 24 * 60 * 60 * 1000,
    };
    const buckets = 12;
    const now = Date.now();
    const start = now - periodMs[period];
    const span = periodMs[period] / buckets;
    const series: { name: string; items: number }[] = [];
    for (let i = 0; i < buckets; i++) {
      const t = start + i * span;
      const d = new Date(t);
      let label = "";
      if (period === "today") label = `${d.getHours()}h`;
      else if (period === "week")
        label = d.toLocaleDateString(undefined, { weekday: "short" });
      else if (period === "month") label = `${d.getDate()}`;
      else if (period === "quarter") label = `${d.getDate()}/${d.getMonth() + 1}`;
      else label = d.toLocaleDateString(undefined, { month: "short" });
      series.push({ name: label, items: 0 });
    }
    for (const o of orders) {
      const ts = new Date(o.created_at).getTime();
      if (!ts || ts < start) continue;
      const idx = Math.min(buckets - 1, Math.floor((ts - start) / span));
      series[idx].items += 1;
    }
    return series;
  }, [orders, period]);

  // ── Recent activity (orders / invoices / expenses) ─────────────────────
  const activity = useMemo(() => {
    type Ev = {
      who: string;
      what: string;
      when: string;
      tone: "ok" | "warn" | "info";
      event: "order" | "invoice" | "expense";
    };
    const out: Ev[] = [];
    for (const o of orders.slice(0, 6))
      out.push({
        who: o.customer_name || "Customer",
        what: `placed order ${o.order_number}`,
        when: o.created_at,
        tone: "info",
        event: "order",
      });
    for (const i of invoices.slice(0, 6))
      out.push({
        who: i.customer_name || "Customer",
        what: `${i.status === "paid" ? "paid" : "issued"} invoice ${i.number}`,
        when: i.issue_date || i.updated_at,
        tone: i.status === "paid" ? "ok" : "warn",
        event: "invoice",
      });
    for (const e of expenses.slice(0, 4))
      out.push({
        who: e.category || "Expense",
        what: `${e.description || "expense"} ${aed(e.amount || 0)}`,
        when: e.expense_date,
        tone: "warn",
        event: "expense",
      });
    return out
      .filter((e) => e.when)
      .sort((a, b) => +new Date(b.when) - +new Date(a.when))
      .slice(0, 8);
  }, [orders, invoices, expenses]);

  const isEmpty =
    products.length === 0 &&
    orders.length === 0 &&
    invoices.length === 0 &&
    customers.length === 0 &&
    quotations.length === 0;

  return (
    <div className="max-w-[1320px] mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* ── Header ── */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[28px] leading-tight font-bold text-ink tracking-tight">
            {companyName || "Overview"}
          </h1>
          <p className="text-sm text-brand-500 mt-1">
            Good {greeting()} — here's your business at a glance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => nav("/invoicing")} className="btn-primary">
            <Plus size={15} /> New invoice
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {/* ── 4 KPI Cards ── */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiMetric
          loading={loading}
          label="Revenue"
          value={revenue.total}
          format={aed}
          icon={<AppIcon name="invoicing" className="w-5 h-5" />}
          iconClass="bg-primary-100 text-ink"
          change={`${revenue.count} invoices`}
          changeTone="up"
        />
        <KpiMetric
          loading={loading}
          label="Collected"
          value={revenue.collected}
          format={aed}
          icon={<AppIcon name="money" className="w-5 h-5" />}
          iconClass="bg-success/15 text-success"
          change={receivable.total > 0 ? `${aed(receivable.total)} pending` : "All settled"}
          changeTone={receivable.total > 0 ? "warn" : "up"}
        />
        <KpiMetric
          loading={loading}
          label="Net profit"
          value={profit.net}
          format={aed}
          icon={<AppIcon name="reports" className="w-5 h-5" />}
          iconClass={profit.net >= 0 ? "bg-success/15 text-success" : "bg-danger/15 text-danger"}
          change={`Expenses ${aed(profit.expenseTotal)}`}
          changeTone={profit.net >= 0 ? "up" : "down"}
        />
        <KpiMetric
          loading={loading}
          label="Products"
          value={stockBreakdown.total}
          format={(n) => num(n)}
          icon={<AppIcon name="inventory" className="w-[18px] h-[18px]" />}
          iconClass={
            stockBreakdown.low > 0 || stockBreakdown.out > 0
              ? "bg-danger/15 text-danger"
              : "bg-primary-100 text-ink"
          }
          change={
            stockBreakdown.low > 0
              ? `${stockBreakdown.low} low stock`
              : stockBreakdown.out > 0
                ? `${stockBreakdown.out} out`
                : "All in stock"
          }
          changeTone={stockBreakdown.low > 0 || stockBreakdown.out > 0 ? "down" : "up"}
        />
      </section>

      {/* ── Bar Chart + Quick Stats ── */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Orders bar chart */}
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm font-semibold text-ink">Orders over time</p>
              <p className="text-xs text-brand-500 mt-0.5">{orderStats.total} orders in window</p>
            </div>
            <div className="flex items-center gap-1 p-0.5 rounded-full bg-brand-100 dark:bg-white/10">
              {(["today", "week", "month", "quarter", "year"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={cn(
                    "px-2.5 py-1 text-[11px] font-semibold rounded-full transition-colors",
                    period === p
                      ? "bg-white text-ink shadow-sm dark:bg-[#3A3D45]"
                      : "text-brand-500 hover:text-ink"
                  )}
                >
                  {p[0].toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              {/* Status badges */}
              <div className="flex flex-wrap items-center gap-1.5 mb-4">
                <Badge tone="success">
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 size={10} /> {orderStats.completed} done
                  </span>
                </Badge>
                <Badge tone="warn">
                  <span className="inline-flex items-center gap-1">
                    <Clock size={10} /> {orderStats.progress} active
                  </span>
                </Badge>
                {orderStats.overdue > 0 && (
                  <Badge tone="danger">
                    <span className="inline-flex items-center gap-1">
                      <AppIcon name="danger" className="w-3 h-3" /> {orderStats.overdue} overdue
                    </span>
                  </Badge>
                )}
              </div>

              {/* Minimal bar chart */}
              <div className="flex items-end gap-1.5 h-[140px] pt-2">
                {trend.map((d, i) => {
                  const max = Math.max(1, ...trend.map((t) => t.items));
                  const h = (d.items / max) * 100;
                  return (
                    <div
                      key={i}
                      className="flex-1 flex flex-col items-center gap-1 group"
                    >
                      <div
                        className="w-full rounded-t-md bg-primary-400 transition-all duration-200 ease-out group-hover:bg-primary-500 group-hover:scale-y-105 origin-bottom"
                        style={{
                          height: `${Math.max(4, h)}%`,
                          opacity: d.items > 0 ? 0.8 : 0.25,
                        }}
                        title={`${d.name}: ${d.items} orders`}
                      />
                      <span className="text-[9px] text-brand-400 tabular-nums">{d.name}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Card>

        {/* Quick stats column */}
        <div className="space-y-4">
          {/* Money breakdown */}
          <Card className="p-4">
            <p className="text-sm font-semibold text-ink mb-3">Money</p>
            {loading ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <div className="space-y-2.5">
                <MoneyRow label="Revenue" value={revenue.total} tone="text-ink" />
                <MoneyRow label="Receivable" value={receivable.total} tone="text-warning" />
                <MoneyRow label="Payable" value={payable.total} tone="text-warning" />
                <MoneyRow label="Expenses" value={-profit.expenseTotal} tone="text-danger" />
                <div className="pt-2 mt-2 border-t border-brand-200 dark:border-[#3A3D45] flex items-center justify-between">
                  <span className="text-sm font-semibold text-ink">Net</span>
                  <span
                    className={cn(
                      "text-lg font-bold tabular-nums tracking-tight",
                      profit.net >= 0 ? "text-success" : "text-danger"
                    )}
                  >
                    {aed(profit.net)}
                  </span>
                </div>
              </div>
            )}
          </Card>

          {/* Inventory health */}
          <Card className="p-4">
            <p className="text-sm font-semibold text-ink mb-3">Inventory</p>
            {loading ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <div className="space-y-2">
                <StockBar
                  rows={[
                    { label: "In stock", value: stockBreakdown.inStock, tone: "bg-success" },
                    { label: "Low stock", value: stockBreakdown.low, tone: "bg-warning" },
                    { label: "Out of stock", value: stockBreakdown.out, tone: "bg-danger" },
                  ]}
                  total={Math.max(1, stockBreakdown.total)}
                />
                {lowStock.length > 0 && (
                  <button
                    onClick={() => nav("/inventory")}
                    className="text-xs font-semibold text-brand-500 hover:text-ink pt-1"
                  >
                    {lowStock.length} need attention →
                  </button>
                )}
              </div>
            )}
          </Card>
        </div>
      </section>

      {/* ── Recent Activity + AI ── */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <p className="text-sm font-semibold text-ink mb-3">Recent activity</p>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : activity.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <div className="grid h-10 w-10 place-items-center rounded-2xl bg-brand-50 text-brand-400 dark:bg-white/5 mb-2">
                <Sparkles size={18} />
              </div>
              <p className="text-sm font-semibold text-ink">Quiet so far</p>
              <p className="text-xs text-brand-500 mt-0.5 max-w-[28ch]">
                New orders, invoices, and expenses will appear here.
              </p>
            </div>
          ) : (
            <Timeline>
              {activity.slice(0, 6).map((a, i) => {
                const ev = a.event;
                const iconName =
                  ev === "order" ? "orders" : ev === "invoice" ? "invoicing" : "orders";
                const status: "done" | "current" | "default" =
                  a.tone === "ok" ? "done" : a.tone === "warn" ? "current" : "default";
                return (
                  <TimelineItem
                    key={i}
                    icon={<AppIcon name={iconName} className="w-3 h-3" />}
                    status={status}
                    title={
                      <>
                        <span className="font-semibold">{a.who}</span>{" "}
                        <span className="text-brand-600 dark:text-brand-400">{a.what}</span>
                      </>
                    }
                    subtitle={fmtDate(a.when)}
                    last={i === Math.min(activity.length - 1, 5)}
                  />
                );
              })}
            </Timeline>
          )}
        </Card>

        <div className="space-y-4">
          <AiSummaryCard />
        </div>
      </section>

      {/* ── Empty state ── */}
      {isEmpty && !loading && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary-100 text-primary-700 dark:bg-primary-400/15 dark:text-primary-300 mb-4">
            <Sparkles size={26} />
          </div>
          <p className="text-base font-semibold text-ink">Fresh start</p>
          <p className="text-sm text-brand-500 mt-1 max-w-[36ch]">
            Add your first product or create an invoice to populate the dashboard.
          </p>
          <div className="mt-4 flex items-center gap-2">
            <button onClick={() => nav("/invoicing")} className="btn-primary">
              <Plus size={15} /> New invoice
            </button>
            <button onClick={() => nav("/inventory")} className="btn-ghost">
              Add product
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Small presentation helpers ─── */

function KpiMetric({
  loading,
  label,
  value,
  format,
  icon,
  iconClass = "bg-primary-100 text-ink",
  change,
  changeTone = "up",
}: {
  loading: boolean;
  label: string;
  value: number;
  format: (n: number) => string;
  icon: ReactNode;
  iconClass?: string;
  change?: string;
  changeTone?: "up" | "down" | "warn";
}) {
  const formatted = format(value);
  if (loading) {
    return (
      <Card className="p-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-20" />
        </div>
      </Card>
    );
  }
  return (
    <MetricCard
      label={label}
      value={formatted}
      icon={icon}
      iconClass={iconClass}
      change={change}
      changeTone={changeTone}
    />
  );
}

function StockBar({
  rows,
  total,
}: {
  rows: { label: string; value: number; tone: string }[];
  total: number;
}) {
  return (
    <div>
      <div className="flex h-2 rounded-full overflow-hidden bg-brand-100 dark:bg-white/5">
        {rows.map((r) =>
          r.value > 0 ? (
            <div
              key={r.label}
              className={cn(r.tone)}
              style={{ width: `${(r.value / total) * 100}%` }}
              title={`${r.label}: ${r.value}`}
            />
          ) : null
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-3">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-1.5">
            <span className={cn("w-2 h-2 rounded-full shrink-0", r.tone)} />
            <span className="text-xs text-brand-500 truncate">{r.label}</span>
            <span className="ml-auto text-xs font-semibold text-ink tabular-nums">
              {num(r.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MoneyRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-brand-500">{label}</span>
      <span className={cn("text-sm font-semibold tabular-nums", tone)}>
        {value < 0 ? `- ${aed(Math.abs(value))}` : aed(value)}
      </span>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}
