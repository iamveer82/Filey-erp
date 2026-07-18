import { useEffect, useMemo, useState } from "react";
import { TrendingUp, TrendingDown, Download } from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  erp,
  billing,
  crm,
  receipts,
  Product,
  InvoiceDocSummary,
  Order,
  CrmCustomer,
  ReceiptSummary,
} from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { downloadCsv } from "../lib/csv";
import { aed, num, cn } from "../lib/format";
import { PageHeader, Spinner, ErrorBanner } from "../components/ui";
import { useChartColors } from "../lib/accent";

export default function Reports() {
  const c = useChartColors();
  const [products, setProducts] = useState<Product[]>([]);
  const [invoices, setInvoices] = useState<InvoiceDocSummary[]>([]);
  const [receiptList, setReceiptList] = useState<ReceiptSummary[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setError("");
    return Promise.all([
      erp.products().then(setProducts),
      billing.listDocs().then(setInvoices),
      receipts.list().then(setReceiptList),
      erp.orders().then(setOrders),
      crm.customers().then(setCustomers),
    ])
      .catch((e) =>
        setError(`Could not load reports: ${e instanceof Error ? e.message : e}`)
      )
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, []);
  useLiveSync(load);

  /* ── KPI strip, real data: Revenue = sum of non-draft invoice totals,
     Cash received = sum of receipt amounts, Customers/Orders = directory
     counts. ── */
  const revenueTotal = useMemo(
    () =>
      invoices
        .filter((i) => i.status !== "draft")
        .reduce((s, i) => s + (i.total || 0), 0),
    [invoices]
  );
  const cashReceived = useMemo(
    () => receiptList.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    [receiptList]
  );

  /* ── Real period-over-period deltas (ModernOverview pattern): last 30
     days vs the 30 before that. Where no prior-period baseline exists the
     delta is null → no chip, hint text only — no invented percentages. ── */
  const deltas = useMemo(() => {
    const DAY = 86400000;
    const now = Date.now();
    const curStart = now - 30 * DAY;
    const prevStart = now - 60 * DAY;
    const pct = (cur: number, prev: number): number | null =>
      prev > 0 ? ((cur - prev) / prev) * 100 : null;

    let revCur = 0;
    let revPrev = 0;
    for (const i of invoices) {
      if (i.status === "draft" || !i.issue_date) continue;
      const t = +new Date(i.issue_date);
      if (t >= curStart) revCur += i.total || 0;
      else if (t >= prevStart) revPrev += i.total || 0;
    }

    let cashCur = 0;
    let cashPrev = 0;
    for (const r of receiptList) {
      if (!r.payment_date) continue;
      const t = +new Date(r.payment_date);
      const amt = Number(r.amount) || 0;
      if (t >= curStart) cashCur += amt;
      else if (t >= prevStart) cashPrev += amt;
    }

    let custCur = 0;
    let custPrev = 0;
    for (const cu of customers) {
      if (!cu.created_at) continue;
      const t = +new Date(cu.created_at);
      if (t >= curStart) custCur += 1;
      else if (t >= prevStart) custPrev += 1;
    }

    let ordCur = 0;
    let ordPrev = 0;
    for (const o of orders) {
      if (!o.created_at) continue;
      const t = +new Date(o.created_at);
      if (t >= curStart) ordCur += 1;
      else if (t >= prevStart) ordPrev += 1;
    }

    return {
      revenue: pct(revCur, revPrev),
      cash: pct(cashCur, cashPrev),
      customers: pct(custCur, custPrev),
      orders: pct(ordCur, ordPrev),
    };
  }, [invoices, receiptList, customers, orders]);

  const kpis = [
    {
      label: "Revenue",
      value: aed(revenueTotal),
      delta: deltas.revenue,
      hint: `${num(invoices.length)} invoices`,
    },
    {
      label: "Cash received",
      value: aed(cashReceived),
      delta: deltas.cash,
      hint: `${num(receiptList.length)} receipts`,
    },
    {
      label: "Customers",
      value: num(customers.length),
      delta: deltas.customers,
      hint: "in directory",
    },
    {
      label: "Orders",
      value: num(orders.length),
      delta: deltas.orders,
      hint: "total volume",
    },
  ];

  /* ── Last 8 days (incl. today): Invoiced = non-draft invoice totals by
     issue_date, Received = receipt amounts by payment_date. Empty days = 0
     — real data only, no filler. ── */
  const trend = useMemo(() => {
    const byDay = new Map<string, { invoiced: number; received: number }>();
    for (const i of invoices) {
      if (i.status === "draft" || !i.issue_date) continue;
      const key = i.issue_date.slice(0, 10);
      const row = byDay.get(key) || { invoiced: 0, received: 0 };
      row.invoiced += i.total || 0;
      byDay.set(key, row);
    }
    for (const r of receiptList) {
      if (!r.payment_date) continue;
      const key = r.payment_date.slice(0, 10);
      const row = byDay.get(key) || { invoiced: 0, received: 0 };
      row.received += Number(r.amount) || 0;
      byDay.set(key, row);
    }
    const series: { d: string; invoiced: number; received: number }[] = [];
    const now = new Date();
    for (let i = 7; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      const row = byDay.get(key);
      series.push({
        d: label,
        invoiced: row?.invoiced || 0,
        received: row?.received || 0,
      });
    }
    return series;
  }, [invoices, receiptList]);

  /* ── Inventory value by category: stock on hand × unit price ── */
  const categoryBars = useMemo(() => {
    const g = new Map<string, number>();
    for (const p of products) {
      const key = p.category || "Other";
      g.set(
        key,
        (g.get(key) ?? 0) + (Number(p.unit_price) || 0) * (Number(p.quantity) || 0)
      );
    }
    return Array.from(g.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [products]);

  /* ── Invoice status distribution (all invoices, draft included). Colors
     map by status name so Paid is always the amber accent, matching the
     reference legend (Paid amber · Pending white · Overdue green). ── */
  const statusColor = (status: string): string => {
    switch (status) {
      case "paid":
        return c.accent;
      case "overdue":
        return "#10b981";
      case "draft":
        return c.tertiary;
      case "cancelled":
        return "#f43f5e";
      default: // sent / pending / unpaid / anything else
        return c.primary;
    }
  };
  const statusPie = useMemo(() => {
    const s = new Map<string, number>();
    for (const i of invoices) {
      const key = i.status || "draft";
      s.set(key, (s.get(key) ?? 0) + 1);
    }
    return Array.from(s.entries()).map(([name, value]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      value,
      color: statusColor(name),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices, c.accent, c.primary, c.tertiary]);

  const tooltipStyle = {
    borderRadius: 8,
    fontSize: 12,
    background: c.tooltipBg,
    border: `1px solid ${c.tooltipBorder}`,
    color: c.tooltipFg,
  };

  const exportCsv = () => {
    const rows = [
      { metric: "Revenue", amount: revenueTotal },
      { metric: "Cash received", amount: cashReceived },
      { metric: "Customers", amount: customers.length },
      { metric: "Orders", amount: orders.length },
    ];
    downloadCsv(`filey-report-${new Date().toISOString().slice(0, 10)}`, rows, [
      { key: "metric", label: "Metric" },
      { key: "amount", label: "Amount" },
    ]);
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Reports"
        subtitle="Live analytics driven by your invoices, receipts, orders and inventory."
        action={
          <button className="btn-ghost" onClick={exportCsv}>
            <Download size={15} /> Export CSV
          </button>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}
      {loading && products.length === 0 && invoices.length === 0 && !error && (
        <div className="card mb-4">
          <Spinner label="Loading reports…" />
        </div>
      )}

      {/* ── KPI strip (joined 4-up) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-border rounded-xl overflow-hidden bg-card">
        {kpis.map((k, i) => {
          const up = (k.delta ?? 0) >= 0;
          const Icon = up ? TrendingUp : TrendingDown;
          return (
            <div
              key={k.label}
              className={cn(
                "p-5 border-b lg:border-b-0 border-border",
                i < 3 && "lg:border-r",
                i % 2 === 0 && "sm:border-r lg:border-r"
              )}
            >
              <div className="text-[13px] text-muted-foreground">{k.label}</div>
              <div className="mt-3 text-[26px] font-semibold text-foreground leading-tight tracking-tight tabular-nums">
                {k.value}
              </div>
              <div className="mt-2 flex items-center gap-2 text-[11.5px]">
                {k.delta != null && (
                  <span
                    title="vs previous 30 days"
                    className={cn(
                      "inline-flex items-center gap-1 font-medium",
                      up ? "text-success" : "text-danger"
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {k.delta >= 0 ? "+" : ""}
                    {k.delta.toFixed(1)}%
                  </span>
                )}
                <span className="text-muted-foreground">{k.hint}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Revenue trend + inventory value (joined 2-col card) ── */}
      <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 border border-border rounded-xl overflow-hidden bg-card">
        <div className="p-5 border-b lg:border-b-0 lg:border-r border-border">
          <div className="text-[14px] font-semibold text-foreground">Revenue trend</div>
          <div className="text-[12.5px] text-muted-foreground mt-0.5">
            Last 8 days — invoices vs receipts
          </div>
          <div className="h-[280px] mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 10, right: 10, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
                <XAxis
                  dataKey="d"
                  stroke={c.axis}
                  tick={{ fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  stroke={c.axis}
                  tick={{ fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v) => aed(Number(v) || 0)}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: c.axis }} />
                <Line
                  type="monotone"
                  dataKey="invoiced"
                  name="Invoiced"
                  stroke={c.accent}
                  strokeWidth={2.5}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="received"
                  name="Received"
                  stroke={c.primary}
                  strokeWidth={2.5}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="p-5">
          <div className="text-[14px] font-semibold text-foreground">
            Inventory value by category
          </div>
          <div className="text-[12.5px] text-muted-foreground mt-0.5">
            Stock on hand × unit price
          </div>
          <div className="h-[280px] mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryBars} margin={{ top: 10, right: 10, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="catG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c.accent} stopOpacity={0.95} />
                    <stop offset="100%" stopColor={c.accent} stopOpacity={0.4} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
                <XAxis
                  dataKey="name"
                  stroke={c.axis}
                  tick={{ fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  stroke={c.axis}
                  tick={{ fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v) => aed(Number(v) || 0)}
                />
                <Bar dataKey="value" name="AED value" fill="url(#catG)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── Sales area + invoice status (joined 3-col card) ── */}
      <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 border border-border rounded-xl overflow-hidden bg-card">
        <div className="lg:col-span-2 border-b lg:border-b-0 lg:border-r border-border p-5">
          <div className="text-[14px] font-semibold text-foreground">Sales area</div>
          <div className="text-[12.5px] text-muted-foreground mt-0.5">
            Cumulative sales &amp; receipts
          </div>
          <div className="h-[280px] mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 10, right: 10, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="aRep1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c.accent} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={c.accent} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="aRep2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c.primary} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={c.primary} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
                <XAxis
                  dataKey="d"
                  stroke={c.axis}
                  tick={{ fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  stroke={c.axis}
                  tick={{ fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v) => aed(Number(v) || 0)}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: c.axis }} />
                <Area
                  type="monotone"
                  dataKey="invoiced"
                  name="Invoiced"
                  stroke={c.accent}
                  fill="url(#aRep1)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="received"
                  name="Received"
                  stroke={c.primary}
                  fill="url(#aRep2)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="p-5">
          <div className="text-[14px] font-semibold text-foreground">Invoice status</div>
          <div className="text-[12.5px] text-muted-foreground mt-0.5">
            Distribution across all invoices
          </div>
          {statusPie.length === 0 ? (
            <div className="h-[220px] mt-2 grid place-items-center text-[12.5px] text-muted-foreground">
              No invoices yet
            </div>
          ) : (
            <>
              <div className="h-[220px] mt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusPie}
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {statusPie.map((s, i) => (
                        <Cell key={i} fill={s.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1.5">
                {statusPie.map((s) => (
                  <div
                    key={s.name}
                    className="flex items-center justify-between text-[12.5px]"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: s.color }}
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
    </div>
  );
}
