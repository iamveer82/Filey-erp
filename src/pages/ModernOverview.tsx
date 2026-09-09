import { toast } from "../components/Toaster";
import { reportMoney } from "../lib/reportMoney";
import { getExchangeRates } from "../lib/exchange-rates";
import { ChartFrame } from "../components/charts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Download, Sparkles, ArrowUpRight, TrendingUp, TrendingDown, CheckCircle2, Clock, User } from "lucide-react";
import { useNavigate, Link } from "react-router-dom";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  erp,
  fin,
  crm,
  receipts,
  billing,
  isPostedStatus,
  type Order,
  type InvoiceDocSummary,
  type InvoicePayment,
  type Expense,
  type CrmCustomer,
  type ReceiptSummary,
} from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { num, aed, chartAmount, cn, fmtDate, todayYmd, plural } from "../lib/format";
import { downloadCsv } from "../lib/csv";
import {
  Badge,
  statusTone,
  ErrorBanner,
  PageHeader,
  Skeleton,
  keyActivate,
} from "../components/ui";
import {
  useChartStyle,
  ChartPanel,
  ChartGradient,
} from "../components/charts";
import { useAuth } from "../lib/auth";
import { useDisplayCurrency } from "../lib/displayCurrency";
import { invoicePaymentsInAed, overviewDeltas, overviewTrend } from "./overviewData";

type Range = "7d" | "30d" | "90d";
const RANGE_DAYS: Record<Range, number> = { "7d": 7, "30d": 30, "90d": 90 };

/** Recharts draws a full axis grid for an all-zero series: eight zero-height
 *  bars, or a line pinned flat to the baseline. On a fresh workspace that reads
 *  as a broken chart rather than an empty one, so show this instead. */
function ChartEmpty({ hint, error }: { hint: string; error?: boolean }) {
  return (
    <div className="grid h-full place-items-center px-4 text-center">
      <div>
        <p className="text-[13px] font-medium text-foreground">{error ? "Chart unavailable" : "Nothing to chart yet"}</p>
        <p className="mt-1 max-w-[34ch] text-[12px] text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

/** Relative timestamp: "just now" / "Nm ago" / "Nh ago" / "Nd ago", else date. */
const relTime = (iso: string): string => {
  const diff = Date.now() - +new Date(iso);
  if (Number.isNaN(diff)) return "";
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(iso);
};

export default function ModernOverview() {
  const nav = useNavigate();
  const cs = useChartStyle();
  const c = cs.c;
  const { profile } = useAuth();
  const { currency } = useDisplayCurrency();

  const [orders, setOrders] = useState<Order[]>([]);
  const [invoices, setInvoices] = useState<InvoiceDocSummary[]>([]);
  const [invoicePayments, setInvoicePayments] = useState<InvoicePayment[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [receiptList, setReceiptList] = useState<ReceiptSummary[]>([]);
  const [companyName, setCompanyName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [range, setRange] = useState<Range>("7d");
  const loadId = useRef<symbol | undefined>(undefined);

  const load = useCallback(async () => {
    const id = Symbol();
    loadId.current = id;
    setError("");
    setLoading(true);
    try {
      const [o, i, e, cust, r, paymentRows, comp, rates] = await Promise.all([
        erp.orders(),
        billing.listDocs(),
        fin.expenses(),
        crm.customers(),
        receipts.list(),
        billing.allPayments(),
        billing.getCompany().catch(() => null),
        getExchangeRates(),
      ]);
      const reportingInvoices = i.map(row => reportMoney(row, ["total", "paid", "balance"], rates));
      const reportingReceipts = r.map(row => reportMoney(row, ["amount"], rates));
      const reportingPayments = invoicePaymentsInAed(paymentRows, i, rates);
      if (id !== loadId.current) return;
      setOrders(o);
      setInvoices(reportingInvoices);
      setInvoicePayments(reportingPayments);
      setExpenses(e);
      setCustomers(cust);
      setReceiptList(reportingReceipts);
      setCompanyName((comp as { name?: string } | null)?.name || "");
    } catch (err: unknown) {
      if (id !== loadId.current) return;
      setError((err as Error)?.message || "Failed to load overview data");
    } finally {
      if (id === loadId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => { loadId.current = undefined; };
  }, [load]);

  useLiveSync(load);

  // ── Derived metrics ────────────────────────────────────────────────────
  const orderStats = useMemo(() => {
    const count = (statuses: string[]) =>
      orders.filter((o) => statuses.includes((o.status || "").toLowerCase())).length;
    return {
      completed: count(["completed", "done", "delivered"]),
      progress: count(["in progress", "processing", "pending", "open", "new"]),
      total: orders.length,
    };
  }, [orders]);

  const revenue = useMemo(() => {
    const issued = invoices.filter((i) => isPostedStatus(i.status));
    const total = issued.reduce((s, i) => s + (i.total || 0), 0);
    return { total, count: issued.length };
  }, [invoices]);

  // Outstanding = unpaid invoice balances, plus how many are past due date.
  const receivable = useMemo(() => {
    const today = todayYmd();
    let total = 0;
    let overdue = 0;
    for (const i of invoices) {
      if (!isPostedStatus(i.status) || i.status === "paid") continue;
      const bal = i.balance ?? 0;
      if (bal <= 0) continue;
      total += bal;
      if (i.due_date && i.due_date < today) overdue += 1;
    }
    return { total, overdue };
  }, [invoices]);

  // ── Real period-over-period deltas: last 30 days vs the 30 before that.
  // Only computed where dated history exists (revenue by invoice issue date,
  // orders/customers by creation date). Point-in-time balances (outstanding)
  // have no prior snapshot, so they show their hint text only — no invented
  // percentages.
  const deltas = useMemo(
    () => overviewDeltas(invoices, receiptList, customers, orders),
    [invoices, receiptList, customers, orders]
  );

  const trend = useMemo(
    () => overviewTrend(invoices, receiptList, expenses, RANGE_DAYS[range], new Date(), invoicePayments),
    [invoices, receiptList, expenses, range, invoicePayments]
  );

  // Drafts and anything outside the window contribute nothing, so a workspace
  // with invoices in it can still produce an all-zero series.
  const hasBarData = useMemo(
    () => trend.some((r) => r.invoiced !== 0 || r.received !== 0 || r.invoicePayments !== 0),
    [trend]
  );
  const hasTrendData = useMemo(
    () => trend.some((r) => r.received !== 0 || r.expenses !== 0 || r.invoicePayments !== 0),
    [trend]
  );

  // Customer segments pie
  const segmentPie = useMemo(() => {
    const seg: Record<string, number> = {};
    for (const cu of customers) {
      const key = cu.segment || "Unsegmented";
      seg[key] = (seg[key] || 0) + 1;
    }
    return Object.entries(seg).map(([name, value]) => ({ name, value }));
  }, [customers]);
  const pieColors = [c.accent, c.primary, c.accentSoft, c.tertiary, c.grid];

  const recent = useMemo(() => invoices.slice(0, 5), [invoices]);

  // ── Recent activity (orders / invoices / expenses) — "{Label} — {Status}"
  // title with a "{Source} • {relative time}" second line, like the reference.
  const activity = useMemo(() => {
    type Ev = { title: string; status: string; when: string; kind: "order" | "invoice" | "expense" };
    const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
    const out: Ev[] = [];
    for (const o of orders.slice(0, 6))
      out.push({
        title: `Order ${o.order_number}`,
        status: cap(o.status || "Pending"),
        when: o.created_at,
        kind: "order",
      });
    for (const i of invoices.slice(0, 6))
      out.push({
        title: `Invoice ${i.number}`,
        status: cap(i.status || "draft"),
        when: i.updated_at || i.issue_date || "",
        kind: "invoice",
      });
    for (const e of expenses.slice(0, 4))
      out.push({
        title: `Expense ${e.category || ""}`.trim(),
        status: aed(e.amount || 0),
        when: e.expense_date,
        kind: "expense",
      });
    return out
      .filter((e) => e.when)
      .sort((a, b) => +new Date(b.when) - +new Date(a.when))
      .slice(0, 6);
  }, [orders, invoices, expenses]);

  const isEmpty =
    orders.length === 0 &&
    invoices.length === 0 &&
    invoicePayments.length === 0 &&
    customers.length === 0 &&
    receiptList.length === 0 &&
    expenses.length === 0;

  const kpis = [
    {
      label: "Invoiced sales",
      value: aed(revenue.total),
      delta: deltas.revenue,
      hint: plural(revenue.count, "invoice"),
      to: "/invoicing",
    },
    {
      label: "Orders",
      value: num(orderStats.total),
      delta: deltas.orders,
      hint: `${orderStats.progress} pending`,
      to: "/orders",
    },
    {
      label: "Customers",
      value: num(customers.length),
      delta: deltas.customers,
      hint: "Directory count",
      to: "/customers",
    },
    {
      label: "Outstanding",
      value: aed(receivable.total),
      delta: null as number | null,
      hint: `${receivable.overdue} overdue`,
      to: "/invoicing",
    },
  ];

  // Export the KPI snapshot currently on screen (reference Export button).
  const onExport = () => {
    downloadCsv(
      "filey-overview",
      kpis.map((k) => ({
        metric: k.label,
        value: k.value,
        change_30d: k.delta != null ? `${k.delta >= 0 ? "+" : ""}${k.delta.toFixed(1)}%` : "",
        detail: k.hint,
      })),
      [
        { key: "metric", label: "Metric" },
        { key: "value", label: "Value" },
        { key: "change_30d", label: "Change vs prior 30d" },
        { key: "detail", label: "Detail" },
      ]
    ).catch((error) => toast.error(error instanceof Error ? error.message : "Could not export CSV."));
  };

  const firstName =
    (profile?.name || "").trim().split(" ")[0] || companyName || "your business";

  return (
    <div className="max-w-[1320px] mx-auto pb-4">
      <PageHeader
        title={`Welcome back, ${firstName}`}
        subtitle="Live view of your business, driven by real data in your workspace."
        action={
          <>
            <button onClick={onExport} className="btn-ghost" disabled={loading || !!error}>
              <Download size={15} /> Export
            </button>
            <button onClick={() => nav("/invoicing?new=1")} className="btn-primary">
              <Plus size={15} /> New invoice
            </button>
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
          <button className="btn-ghost mt-2" onClick={() => void load()}>Retry overview</button>
        </div>
      )}

      {/* ── KPI joined grid ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-border rounded-xl overflow-hidden bg-card">
        {kpis.map((k, i) => {
          const up = (k.delta ?? 0) >= 0;
          const Icon = up ? TrendingUp : TrendingDown;
          return (
            <button
              key={k.label}
              onClick={() => nav(k.to)}
              className={cn(
                "p-5 text-left border-b lg:border-b-0 border-border hover:bg-hover transition-colors",
                i < 3 && "lg:border-r",
                i % 2 === 0 && "sm:border-r lg:border-r"
              )}
            >
              <div className="text-[12px] text-muted-foreground">{k.label}</div>
              {loading ? (
                <Skeleton className="mt-3 h-8 w-28" />
              ) : (
                <div className="mt-3 text-[22px] font-semibold text-foreground leading-tight tracking-tight tabular-nums">
                  {error ? "—" : k.value}
                </div>
              )}
              <div className="mt-2 flex items-center gap-2 text-[11.5px]">
                {!loading && !error && k.delta != null && (
                  <span
                    title="vs previous 30 days"
                    className={cn(
                      "inline-flex items-center gap-1 font-medium",
                      up ? "text-success" : "text-danger"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {k.delta >= 0 ? "+" : ""}
                    {k.delta.toFixed(1)}%
                  </span>
                )}
                <span className="text-muted-foreground">{loading ? "Loading workspace…" : error ? "Data unavailable" : k.hint}</span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-6 mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Business overview</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Amounts in {currency} · customer segments show the full directory</p>
        </div>
        <div role="group" aria-label="Chart period" className="flex items-center gap-1 border border-border rounded-full p-1 text-[12px]">
          {(["7d", "30d", "90d"] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              aria-pressed={range === r}
              className={cn(
                "px-3 py-1.5 rounded-full transition-colors",
                range === r ? "bg-foreground text-background font-medium" : "text-muted-foreground hover:bg-hover"
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* ── Charts row: sales bar + segments pie ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 border border-border rounded-xl overflow-hidden bg-card">
        <ChartPanel
          title="Invoiced and payment records"
          subtitle={`Last ${RANGE_DAYS[range]} days · invoices by issue date, invoice payments and receipt documents by payment date`}
          className="lg:col-span-2 border-b lg:border-b-0 lg:border-r border-border"
          bodyClassName="h-[280px] mt-4"
        >
          {loading ? (
            <Skeleton className="h-full w-full" />
          ) : error ? (
            <ChartEmpty error hint="Retry to load your workspace figures." />
          ) : !hasBarData ? (
            <ChartEmpty hint="Send an invoice or record an invoice payment or receipt within this period." />
          ) : (
            <ChartFrame height={280}>
              <BarChart data={trend} margin={{ top: 10, right: 4, left: -12, bottom: 0 }}>
                <ChartGradient id="barSold" color={c.accent} from={0.9} to={0.3} />
                <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
                <XAxis dataKey="d" {...cs.axisProps} minTickGap={24} />
                <YAxis {...cs.axisProps} width={64} tickFormatter={(value) => chartAmount(Number(value))} />
                <Tooltip
                  contentStyle={cs.tooltipStyle}
                  cursor={cs.cursor}
                  formatter={(v) => aed(Number(v) || 0)}
                />
                <Legend wrapperStyle={cs.legendStyle} />
                <Bar
                  dataKey="invoiced"
                  name="Invoiced"
                  fill="url(#barSold)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
                <Bar
                  dataKey="received"
                  name="Receipt documents"
                  fill={c.tertiary}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
                <Bar
                  dataKey="invoicePayments"
                  name="Invoice payments"
                  fill={c.primary}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
              </BarChart>
            </ChartFrame>
          )}
        </ChartPanel>
        <ChartPanel
          title="Customer segments"
          subtitle="All customers · from the customer directory"
          bodyClassName="mt-2"
        >
          {loading ? (
            <Skeleton className="h-[220px] w-full" />
          ) : error ? (
            <div className="h-[220px]"><ChartEmpty error hint="Retry to load customer segments." /></div>
          ) : segmentPie.length === 0 ? (
            <div className="h-[220px] grid place-items-center text-[12.5px] text-muted-foreground">
              No customers yet
            </div>
          ) : (
            <>
              <div className="relative h-[220px]">
                <ChartFrame height={220}>
                  <PieChart>
                    <Pie
                      data={segmentPie}
                      innerRadius={58}
                      outerRadius={84}
                      paddingAngle={2}
                      dataKey="value"
                      cornerRadius={3}
                    >
                      {segmentPie.map((_, i) => (
                        <Cell key={i} fill={pieColors[i % pieColors.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={cs.tooltipStyle} />
                  </PieChart>
                </ChartFrame>
                {/* Donut centre: the whole point of the chart, stated once */}
                <div className="absolute inset-0 grid place-items-center pointer-events-none">
                  <div className="text-center">
                    <div className="text-[22px] font-semibold text-foreground tabular-nums leading-none">
                      {num(customers.length)}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1">
                      {customers.length === 1 ? "customer" : "customers"}
                    </div>
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                {segmentPie.map((s, i) => (
                  <div key={s.name} className="flex items-center justify-between text-[12.5px]">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: pieColors[i % pieColors.length] }}
                      />
                      <span className="text-foreground">{s.name}</span>
                    </div>
                    <span className="text-muted-foreground tabular-nums">{s.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </ChartPanel>
      </div>

      {/* ── Recent invoices + activity ── */}
      <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 border border-border rounded-xl overflow-hidden bg-card">
        <div className="lg:col-span-2 border-b lg:border-b-0 lg:border-r border-border">
          <div className="px-5 pt-4 pb-3 flex items-start justify-between">
            <div>
              <div className="text-[14px] font-semibold text-foreground">Recent invoices</div>
              <div className="text-[12.5px] text-muted-foreground mt-0.5">
                Latest activity across your accounts
              </div>
            </div>
            <Link
              to="/invoicing"
              className="text-[12.5px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              View all <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="px-5 py-2.5 font-medium text-[12px] tracking-wide">Invoice</th>
                  <th className="px-5 py-2.5 font-medium text-[12px] tracking-wide">Customer</th>
                  <th className="px-5 py-2.5 font-medium text-[12px] tracking-wide text-right">Amount</th>
                  <th className="px-5 py-2.5 font-medium text-[12px] tracking-wide">Status</th>
                  <th className="px-5 py-2.5 font-medium text-[12px] tracking-wide">Date</th>
                </tr>
              </thead>
              <tbody>
                {(loading || error || recent.length === 0) && (
                  <tr>
                    <td colSpan={5} className="px-6 py-10 text-center text-muted-foreground">
                      {loading ? "Loading invoices…" : error ? "Invoices unavailable" : "No invoices yet"}
                    </td>
                  </tr>
                )}
                {!loading && !error && recent.map((r) => (
                  <tr
                    key={r.id}
                    tabIndex={0}
                    onClick={() => nav(`/invoicing?open=${r.id}`)}
                    onKeyDown={keyActivate(() => nav(`/invoicing?open=${r.id}`))}
                    className="border-b border-border last:border-0 hover:bg-hover transition-colors cursor-pointer"
                  >
                    <td className="px-5 py-3 text-foreground font-medium">{r.number}</td>
                    <td className="px-5 py-3 text-foreground">{r.customer_name || "—"}</td>
                    <td className="px-5 py-3 text-right text-foreground tabular-nums">{aed(r.total || 0)}</td>
                    <td className="px-5 py-3">
                      <Badge tone={statusTone(r.status || "draft")}>{r.status}</Badge>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {r.issue_date ? fmtDate(r.issue_date) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <div className="px-5 pt-4 pb-3">
            <div className="text-[14px] font-semibold text-foreground">Activity</div>
            <div className="text-[12.5px] text-muted-foreground mt-0.5">Live from your workspace</div>
          </div>
          <div className="px-5 pb-5 space-y-3">
            {(loading || error || activity.length === 0) && (
              <p className="text-[12.5px] text-muted-foreground">{loading ? "Loading activity…" : error ? "Activity unavailable" : "Nothing yet."}</p>
            )}
            {!loading && !error && activity.map((a, i) => (
              <div key={i} className="flex gap-3">
                <div className="h-8 w-8 rounded-full bg-hover border border-border grid place-items-center text-muted-foreground shrink-0">
                  {a.kind === "invoice" ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : a.kind === "order" ? (
                    <User className="h-4 w-4" />
                  ) : (
                    <Clock className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] text-foreground leading-snug">
                    <span className="font-medium">{a.title}</span> · {a.status}
                  </div>
                  <div className="text-[11.5px] text-muted-foreground mt-0.5">
                    System • {relTime(a.when)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Separate payment records and recorded expenses ── */}
      <div className="mt-5 rounded-xl border border-border bg-card">
        <ChartPanel
          title="Payment records and expenses"
          subtitle={`Last ${RANGE_DAYS[range]} days · separate payment sources; invoice payments use saved invoice exchange rates. Receipt documents may describe the same payment, so these series are not added together.`}
            bodyClassName="h-[260px] mt-2"
          >
            {loading ? (
              <Skeleton className="h-full w-full" />
            ) : error ? (
              <ChartEmpty error hint="Retry to load your workspace figures." />
            ) : !hasTrendData ? (
              <ChartEmpty hint="Record an invoice payment, receipt or expense within this period." />
            ) : (
              <ChartFrame height={260}>
                <AreaChart data={trend} margin={{ top: 10, right: 10, left: -12, bottom: 0 }}>
                  <ChartGradient id="cashIn" color={c.accent} from={0.35} />
                  <ChartGradient id="cashOut" color={c.primary} from={0.25} />
                  <ChartGradient id="invoicePayments" color={c.tertiary} from={0.2} />
                  <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
                  <XAxis dataKey="d" {...cs.axisProps} minTickGap={24} />
                  <YAxis {...cs.axisProps} width={64} tickFormatter={(value) => chartAmount(Number(value))} />
                  <Tooltip
                    contentStyle={cs.tooltipStyle}
                    cursor={cs.cursor}
                    formatter={(v) => aed(Number(v) || 0)}
                  />
                  <Legend wrapperStyle={cs.legendStyle} />
                  <Area
                    type="monotone"
                    dataKey="received"
                    name="Receipt documents"
                    stroke={c.accent}
                    fill="url(#cashIn)"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 3, strokeWidth: 0 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="invoicePayments"
                    name="Invoice payments"
                    stroke={c.tertiary}
                    fill="url(#invoicePayments)"
                    strokeDasharray="5 3"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 3, strokeWidth: 0 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="expenses"
                    name="Recorded expenses"
                    stroke={c.primary}
                    fill="url(#cashOut)"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 3, strokeWidth: 0 }}
                  />
                </AreaChart>
              </ChartFrame>
            )}
          </ChartPanel>
      </div>

      {/* ── Empty state ── */}
      {isEmpty && !loading && !error && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-xl bg-muted text-muted-foreground mb-4">
            <Sparkles size={24} />
          </div>
          <p className="text-[14px] font-semibold text-foreground">Fresh start</p>
          <p className="text-[12.5px] text-muted-foreground mt-1 max-w-[36ch]">
            Create an invoice, add a customer, or record an expense to populate the overview.
          </p>
          <div className="mt-4 flex items-center gap-2">
            <button onClick={() => nav("/invoicing?new=1")} className="btn-primary">
              <Plus size={15} /> New invoice
            </button>
            <button onClick={() => nav("/customers?new=1")} className="btn-ghost">
              Add customer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
