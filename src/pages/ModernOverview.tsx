import { useEffect, useMemo, useState } from "react";
import { Plus, Sparkles, ArrowUpRight, TrendingUp, TrendingDown, CheckCircle2, Clock, User } from "lucide-react";
import { useNavigate, Link } from "react-router-dom";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
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
import { num, aed, cn, fmtDate } from "../lib/format";
import { Badge, statusTone, ErrorBanner, PageHeader, Skeleton } from "../components/ui";
import { useChartColors } from "../lib/accent";

/* ── Overview (Emergent reference layout) ──────────────────────────────────
   JoinedGrid KPIs → Sales/Received bar + segments pie → Recent invoices +
   activity → Cash movement area. Data loaders unchanged — reskin only. */

type Range = "7d" | "30d" | "90d";
const RANGE_DAYS: Record<Range, number> = { "7d": 8, "30d": 30, "90d": 90 };

export default function ModernOverview() {
  const nav = useNavigate();
  const c = useChartColors();

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
  const [range, setRange] = useState<Range>("7d");

  const load = async () => {
    setError("");
    try {
      const [p, o, i, e, cust, q, po, comp, poPays] = await Promise.all([
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
      setCustomers(cust);
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
    const issued = invoices.filter((i) => i.status !== "draft");
    const collected = issued.reduce((s, i) => s + ((i.total || 0) - (i.balance ?? 0)), 0);
    const total = issued.reduce((s, i) => s + (i.total || 0), 0);
    return { collected, total, count: issued.length };
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

  // ── Daily invoiced vs collected series for the selected range. Collected
  // is attributed to the invoice's issue date (payment dates aren't in the
  // summary) — a close proxy for cash-in shape. Real data only, no filler.
  const trend = useMemo(() => {
    const days = RANGE_DAYS[range];
    const series: { d: string; invoiced: number; received: number }[] = [];
    const byDay = new Map<string, { invoiced: number; received: number }>();
    for (const i of invoices) {
      if (i.status === "draft" || !i.issue_date) continue;
      const key = i.issue_date.slice(0, 10);
      const row = byDay.get(key) || { invoiced: 0, received: 0 };
      row.invoiced += i.total || 0;
      row.received += (i.total || 0) - (i.balance ?? 0);
      byDay.set(key, row);
    }
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      const row = byDay.get(key);
      series.push({ d: label, invoiced: row?.invoiced || 0, received: row?.received || 0 });
    }
    return series;
  }, [invoices, range]);

  const barTrend = useMemo(
    () => (range === "7d" ? trend : trend.slice(-8)),
    [trend, range]
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
  const pieColors = [c.accent, c.primary, c.accentSoft, c.tertiary, "#6366f1"];

  const recent = useMemo(() => invoices.slice(0, 5), [invoices]);

  // ── Recent activity (orders / invoices / expenses) ─────────────────────
  const activity = useMemo(() => {
    type Ev = { who: string; what: string; when: string; kind: "order" | "invoice" | "expense" };
    const out: Ev[] = [];
    for (const o of orders.slice(0, 6))
      out.push({
        who: o.customer_name || "Customer",
        what: `placed order ${o.order_number}`,
        when: o.created_at,
        kind: "order",
      });
    for (const i of invoices.slice(0, 6))
      out.push({
        who: i.customer_name || "Customer",
        what: `${i.status === "paid" ? "paid" : "issued"} invoice ${i.number}`,
        when: i.issue_date || i.updated_at,
        kind: "invoice",
      });
    for (const e of expenses.slice(0, 4))
      out.push({
        who: e.category || "Expense",
        what: `${e.description || "expense"} ${aed(e.amount || 0)}`,
        when: e.expense_date,
        kind: "expense",
      });
    return out
      .filter((e) => e.when)
      .sort((a, b) => +new Date(b.when) - +new Date(a.when))
      .slice(0, 6);
  }, [orders, invoices, expenses]);

  const isEmpty =
    products.length === 0 &&
    orders.length === 0 &&
    invoices.length === 0 &&
    customers.length === 0 &&
    quotations.length === 0;

  const kpis = [
    {
      label: "Revenue",
      value: aed(revenue.collected),
      up: true,
      hint: `${num(revenue.count)} invoices · ${aed(revenue.total)} issued`,
      to: "/invoicing",
    },
    {
      label: "Orders",
      value: num(orderStats.total),
      up: true,
      hint: `${orderStats.progress} active · ${orderStats.completed} done`,
      to: "/orders",
    },
    {
      label: "To collect",
      value: aed(receivable.total),
      up: receivable.total === 0,
      hint: `${receivable.parties} ${receivable.parties === 1 ? "party" : "parties"} owe you`,
      to: "/invoicing",
    },
    {
      label: "To pay",
      value: aed(payable.total),
      up: payable.total === 0,
      hint: `${payable.parties} ${payable.parties === 1 ? "supplier" : "suppliers"}`,
      to: "/purchase-orders",
    },
  ];

  const tooltipStyle = {
    borderRadius: 8,
    fontSize: 12,
    background: c.tooltipBg,
    border: `1px solid ${c.tooltipBorder}`,
    color: c.tooltipFg,
  };

  return (
    <div className="max-w-[1320px] mx-auto px-4 sm:px-6 py-6 pb-10">
      <PageHeader
        title={`Welcome back, ${companyName || "your business"}`}
        subtitle="Live view of your business — driven by real data in your workspace."
        action={
          <button onClick={() => nav("/invoicing?new=1")} className="btn-primary">
            <Plus size={15} /> New invoice
          </button>
        }
      />

      {error && <ErrorBanner message={error} />}

      {/* ── KPI joined grid ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-border rounded-xl overflow-hidden bg-card">
        {kpis.map((k, i) => {
          const Icon = k.up ? TrendingUp : TrendingDown;
          return (
            <button
              key={k.label}
              onClick={() => nav(k.to)}
              className={cn(
                "p-5 text-left border-b lg:border-b-0 border-border hover:bg-hover/50 transition-colors",
                i < 3 && "lg:border-r",
                i % 2 === 0 && "sm:border-r lg:border-r"
              )}
            >
              <div className="text-[13px] text-muted-foreground">{k.label}</div>
              {loading ? (
                <Skeleton className="mt-3 h-8 w-28" />
              ) : (
                <div className="mt-3 text-[26px] font-semibold text-foreground leading-tight tracking-tight tabular-nums">
                  {k.value}
                </div>
              )}
              <div className="mt-2 flex items-center gap-2 text-[11.5px]">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 font-medium",
                    k.up ? "text-success" : "text-warning"
                  )}
                >
                  <Icon className="h-3 w-3" />
                </span>
                <span className="text-muted-foreground">{k.hint}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Charts row: sales bar + segments pie ── */}
      <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 border border-border rounded-xl overflow-hidden bg-card">
        <div className="lg:col-span-2 border-b lg:border-b-0 lg:border-r border-border p-5">
          <div className="flex items-center gap-2">
            <div className="text-[14px] font-semibold text-foreground">
              Invoiced vs collected
            </div>
            <span className="px-1.5 py-0.5 rounded text-[10.5px] font-medium bg-success/10 text-success ring-1 ring-success/30 inline-flex items-center gap-1">
              <TrendingUp className="h-3 w-3" /> Live
            </span>
          </div>
          <div className="text-[12.5px] text-muted-foreground mt-0.5">
            Last 8 days — from your invoices
          </div>
          <div className="h-[280px] mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barTrend} margin={{ top: 10, right: 4, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="barSold" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c.accent} stopOpacity={0.95} />
                    <stop offset="100%" stopColor={c.accent} stopOpacity={0.35} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
                <XAxis dataKey="d" stroke={c.axis} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis stroke={c.axis} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  cursor={{ fill: "currentColor", fillOpacity: 0.04 }}
                  formatter={(v) => aed(Number(v) || 0)}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: c.axis }} />
                <Bar dataKey="invoiced" name="Invoiced" fill="url(#barSold)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="received" name="Collected" fill={c.primary} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="p-5">
          <div className="text-[14px] font-semibold text-foreground">Customer segments</div>
          <div className="text-[12.5px] text-muted-foreground mt-0.5">
            {num(customers.length)} customers by segment
          </div>
          {segmentPie.length === 0 ? (
            <div className="h-[220px] grid place-items-center text-[12.5px] text-muted-foreground">
              No customers yet
            </div>
          ) : (
            <>
              <div className="h-[220px] mt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={segmentPie} innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value">
                      {segmentPie.map((_, i) => (
                        <Cell key={i} fill={pieColors[i % pieColors.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
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
                    <span className="text-muted-foreground">{s.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
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
              View all <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="px-5 py-2.5 font-medium text-[12px] tracking-wide">Invoice</th>
                  <th className="px-5 py-2.5 font-medium text-[12px] tracking-wide">Customer</th>
                  <th className="px-5 py-2.5 font-medium text-[12px] tracking-wide">Amount</th>
                  <th className="px-5 py-2.5 font-medium text-[12px] tracking-wide">Status</th>
                  <th className="px-5 py-2.5 font-medium text-[12px] tracking-wide">Date</th>
                </tr>
              </thead>
              <tbody>
                {recent.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-10 text-center text-muted-foreground">
                      No invoices yet
                    </td>
                  </tr>
                )}
                {recent.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => nav(`/invoicing?open=${r.id}`)}
                    className="border-b border-border last:border-0 hover:bg-hover transition-colors cursor-pointer"
                  >
                    <td className="px-5 py-3 text-foreground font-medium">{r.number}</td>
                    <td className="px-5 py-3 text-foreground">{r.customer_name || "—"}</td>
                    <td className="px-5 py-3 text-foreground tabular-nums">{aed(r.total || 0)}</td>
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
            {activity.length === 0 && (
              <p className="text-[12.5px] text-muted-foreground">Nothing yet.</p>
            )}
            {activity.map((a, i) => (
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
                    <span className="font-medium">{a.who}</span> {a.what}
                  </div>
                  <div className="text-[11.5px] text-muted-foreground mt-0.5">
                    {fmtDate(a.when)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Cash movement area ── */}
      <div className="mt-5 rounded-xl border border-border bg-card">
        <div className="px-5 pt-4 pb-3 flex items-center justify-between">
          <div>
            <div className="text-[14px] font-semibold text-foreground">Cash movement</div>
            <div className="text-[12.5px] text-muted-foreground mt-0.5">
              Invoiced vs collected over time
            </div>
          </div>
          <div className="flex items-center gap-1 border border-border rounded-md p-0.5 text-[12px]">
            {(["7d", "30d", "90d"] as Range[]).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={cn(
                  "px-2.5 py-1 rounded",
                  range === r
                    ? "bg-foreground text-background font-medium"
                    : "text-muted-foreground hover:bg-hover"
                )}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <div className="px-4 pb-4 h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trend} margin={{ top: 10, right: 10, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="cashIn" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={c.accent} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={c.accent} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="cashOut" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={c.primary} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={c.primary} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
              <XAxis dataKey="d" stroke={c.axis} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis stroke={c.axis} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => aed(Number(v) || 0)} />
              <Legend wrapperStyle={{ fontSize: 11, color: c.axis }} />
              <Area type="monotone" dataKey="received" name="Cash in" stroke={c.accent} fill="url(#cashIn)" strokeWidth={2} />
              <Area type="monotone" dataKey="invoiced" name="Invoiced" stroke={c.primary} fill="url(#cashOut)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Empty state ── */}
      {isEmpty && !loading && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-xl bg-muted text-muted-foreground mb-4">
            <Sparkles size={26} />
          </div>
          <p className="text-[14px] font-semibold text-foreground">Fresh start</p>
          <p className="text-[12.5px] text-muted-foreground mt-1 max-w-[36ch]">
            Add your first product or create an invoice to populate the dashboard.
          </p>
          <div className="mt-4 flex items-center gap-2">
            <button onClick={() => nav("/invoicing?new=1")} className="btn-primary">
              <Plus size={15} /> New invoice
            </button>
            <button onClick={() => nav("/inventory?new=1")} className="btn-ghost">
              Add product
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
