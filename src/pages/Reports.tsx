import { useEffect, useMemo, useState } from "react";
import { TrendingUp, Wallet, Boxes, Download, Printer, FileText, FileDown, DollarSign, Receipt, PiggyBank } from "lucide-react";
import {
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
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  erp,
  fin,
  billing,
  hr,
  Product,
  FinanceReport,
  InvoiceDocSummary,
  Expense,
  Payroll,
} from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { downloadCsv } from "../lib/csv";
import { aed, num, getDisplayCurrency } from "../lib/format";
import {
  PageHeader,
  MetricCard,
  InfoCard,
  Spinner,
  ErrorBanner,
} from "../components/ui";

// design.md §2 / §6.7 — Filey brand palette: gold, amber, warm gray, accent
const PIE = ["#FFD600", "#E0AE00", "#B88C00", "#FFBA3D", "#F6C954"];
const CHART_STROKE = "#E0AE00";
const CHART_FILL_START = "#FFD600";
const CHART_GRID = "#DEDBD2";
const BAR_FILL = "#FFD600";

export default function Reports() {
  const [products, setProducts] = useState<Product[]>([]);
  const [report, setReport] = useState<FinanceReport | null>(null);
  const [invoices, setInvoices] = useState<InvoiceDocSummary[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [payroll, setPayroll] = useState<Payroll[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setError("");
    return Promise.all([
      erp.products().then(setProducts),
      fin.report().then(setReport),
      billing.listDocs().then(setInvoices),
      fin.expenses().then(setExpenses),
      hr.payroll().then(setPayroll),
    ])
      .catch((e) =>
        setError(`Could not load reports: ${e instanceof Error ? e.message : e}`)
      )
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);
  useLiveSync(load);

  // Collected = cash actually received = total − outstanding balance, across
  // every non-draft invoice (matches the Overview "Collected" card). Keying off
  // status === "paid" under-reported revenue as 0 for invoices that are "sent"
  // and partially/fully paid down via recorded payments rather than a status flip.
  const invoiceRevenue = useMemo(
    () =>
      invoices
        .filter((i) => i.status !== "draft")
        .reduce((s, i) => s + ((i.total || 0) - (i.balance ?? 0)), 0),
    [invoices]
  );
  const accountsReceivable = useMemo(
    () =>
      invoices
        .filter((i) => i.status !== "draft")
        .reduce((s, i) => s + (i.balance ?? 0), 0),
    [invoices]
  );
  const totalExpenses = useMemo(
    () => expenses.reduce((s, e) => s + e.amount, 0),
    [expenses]
  );
  const monthExpenses = useMemo(() => {
    const now = new Date();
    return expenses
      .filter((e) => {
        const d = new Date(e.expense_date);
        return (
          d.getMonth() === now.getMonth() &&
          d.getFullYear() === now.getFullYear()
        );
      })
      .reduce((s, e) => s + e.amount, 0);
  }, [expenses]);
  const payrollCost = useMemo(
    () => payroll.reduce((s, p) => s + p.net_pay, 0),
    [payroll]
  );
  const grossProfit = invoiceRevenue - totalExpenses - payrollCost;

  const catValue = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products)
      m.set(
        p.category || "Unsorted",
        (m.get(p.category || "Unsorted") ?? 0) + p.quantity * p.cost_price
      );
    return Array.from(m.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [products]);

  const invValue = products.reduce(
    (s, p) => s + p.quantity * p.cost_price,
    0
  );

  // Revenue trend: collected amount (total − balance) per issue month, last 6.
  const trend = useMemo(() => {
    const now = new Date();
    const buckets: { name: string; value: number; key: string }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({
        name: d.toLocaleString("en", { month: "short" }),
        key: `${d.getFullYear()}-${d.getMonth()}`,
        value: 0,
      });
    }
    const byKey = new Map(buckets.map((b) => [b.key, b]));
    for (const inv of invoices) {
      if (inv.status === "draft" || !inv.issue_date) continue;
      const collected = (inv.total || 0) - (inv.balance ?? 0);
      if (collected <= 0) continue;
      const d = new Date(inv.issue_date);
      const b = byKey.get(`${d.getFullYear()}-${d.getMonth()}`);
      if (b) b.value += collected;
    }
    return buckets.map(({ name, value }) => ({ name, value }));
  }, [invoices]);

  const financials = [
    { name: "Assets", value: report?.total_assets ?? 0 },
    { name: "Liabilities", value: report?.total_liabilities ?? 0 },
    { name: "Equity", value: report?.total_equity ?? 0 },
    { name: "Revenue", value: invoiceRevenue },
    { name: "Expenses", value: totalExpenses + payrollCost },
    { name: "AR", value: accountsReceivable },
  ];

  const exportCsv = () => {
    const rows = [
      { metric: "Paid revenue", amount: invoiceRevenue },
      { metric: "Accounts receivable", amount: accountsReceivable },
      { metric: "Total expenses", amount: totalExpenses },
      { metric: "Payroll cost", amount: payrollCost },
      { metric: "Gross profit", amount: grossProfit },
      { metric: "Inventory value", amount: invValue },
      { metric: "Total assets", amount: report?.total_assets ?? 0 },
      { metric: "Total liabilities", amount: report?.total_liabilities ?? 0 },
      { metric: "Total equity", amount: report?.total_equity ?? 0 },
      ...trend.map((t) => ({ metric: `Revenue (${t.name})`, amount: t.value })),
      ...catValue.map((c) => ({
        metric: `Stock value — ${c.name}`,
        amount: c.value,
      })),
    ];
    downloadCsv(
      `filey-report-${new Date().toISOString().slice(0, 10)}`,
      rows,
      [
        { key: "metric", label: "Metric" },
        { key: "amount", label: "Amount" },
      ]
    );
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Reports"
        subtitle="Inventory & financial reporting"
        action={
          <div className="flex gap-2 no-print">
            <button className="btn-ghost" onClick={() => window.print()}>
              <Printer size={15} /> Print / PDF
            </button>
            <button className="btn-primary" onClick={exportCsv}>
              <Download size={15} /> Export CSV
            </button>
          </div>
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
      {!loading && !error && products.length === 0 && invoices.length === 0 && (
        <div className="empty-gradient rounded-2xl p-10 mb-4 flex flex-col items-center gap-4 text-center">
          <svg width="110" height="90" viewBox="0 0 110 90" fill="none" xmlns="http://www.w3.org/2000/svg" className="opacity-70">
            <rect x="10" y="12" width="40" height="66" rx="4" fill="#FFF3C4" stroke="#E0AE00" strokeWidth="1.5" />
            <rect x="14" y="18" width="32" height="4" rx="2" fill="#E0AE00" opacity="0.6" />
            <rect x="14" y="28" width="32" height="4" rx="2" fill="#E0AE00" opacity="0.3" />
            <rect x="14" y="38" width="28" height="4" rx="2" fill="#E0AE00" opacity="0.3" />
            <rect x="14" y="50" width="20" height="4" rx="2" fill="#D4D4D8" />
            <rect x="14" y="60" width="32" height="4" rx="2" fill="#D4D4D8" />
            <rect x="14" y="70" width="24" height="4" rx="2" fill="#D4D4D8" />
            <rect x="60" y="28" width="40" height="34" rx="4" fill="#FFF3C4" stroke="#E0AE00" strokeWidth="1.5" />
            <rect x="64" y="34" width="32" height="3" rx="1.5" fill="#E0AE00" opacity="0.5" />
            <rect x="64" y="42" width="28" height="3" rx="1.5" fill="#D4D4D8" />
            <rect x="64" y="50" width="24" height="3" rx="1.5" fill="#D4D4D8" />
            <circle cx="55" cy="78" r="8" fill="#FFFBEB" stroke="#E0AE00" strokeWidth="1.5" />
            <path d="M52 78l2 2 4-4" stroke="#B88C00" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div>
            <p className="text-sm font-bold text-brand-700">No data to report yet</p>
            <p className="text-xs text-brand-500 mt-1 max-w-sm">
              Start adding products, invoices, and expenses to see your reports come to life.
            </p>
          </div>
        </div>
      )}

      {/* ── Summary stat cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary-400 via-[#F6C954] to-[#FFBA3D] p-6 text-ink shadow-bento">
          <div className="flex items-center justify-between mb-3">
            <DollarSign size={22} className="text-ink/70" />
            <span className="pill bg-ink/15 text-ink text-[11px]">Paid invoices</span>
          </div>
          <p className="text-3xl font-bold tracking-tight">{aed(invoiceRevenue)}</p>
          <p className="text-sm font-semibold text-ink/60 mt-1">Total Revenue</p>
        </div>
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#FFF8E1] to-[#FFF3C4] dark:from-[#2a2620] dark:to-[#201d24] p-6 text-ink dark:text-[#F4F5F6] shadow-bento border border-brand-200 dark:border-[#3A3D45]">
          <div className="flex items-center justify-between mb-3">
            <Receipt size={22} className="text-brand-600 dark:text-[#DDE0E4]" />
            <span className="pill bg-brand-100 dark:bg-white/10 text-brand-600 dark:text-[#DDE0E4] text-[11px]">All expenses + payroll</span>
          </div>
          <p className="text-3xl font-bold tracking-tight">{aed(totalExpenses + payrollCost)}</p>
          <p className="text-sm font-semibold text-brand-500 dark:text-[#B6BAC1] mt-1">Total Expenses</p>
        </div>
        <div className={`relative overflow-hidden rounded-2xl p-6 text-white shadow-bento ${grossProfit >= 0 ? "bg-gradient-to-br from-success to-emerald-600" : "bg-gradient-to-br from-danger to-red-600"}`}>
          <div className="flex items-center justify-between mb-3">
            <PiggyBank size={22} className="text-white/70" />
            <span className="pill bg-white/20 text-white text-[11px]">Revenue − costs</span>
          </div>
          <p className="text-3xl font-bold tracking-tight">{aed(grossProfit)}</p>
          <p className="text-sm font-semibold text-white/60 mt-1">Net Profit</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <MetricCard
          label="Inventory Value"
          value={aed(invValue)}
          icon={<Boxes size={20} />}
        />
        <MetricCard
          label="Invoice Revenue (paid)"
          value={aed(invoiceRevenue)}
          icon={<Wallet size={20} />}
          iconClass="bg-success/15 text-success"
        />
        <MetricCard
          label="Accounts Receivable"
          value={aed(accountsReceivable)}
          icon={<Wallet size={20} />}
          iconClass="bg-secondary-400/20 text-secondary-600"
        />
        <MetricCard
          label="Gross Profit"
          value={aed(grossProfit)}
          icon={<TrendingUp size={20} />}
          iconClass="bg-info/15 text-info"
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <MetricCard
          label="Total Expenses"
          value={aed(totalExpenses)}
          icon={<Wallet size={20} />}
        />
        <MetricCard
          label="This Month Expenses"
          value={aed(monthExpenses)}
          icon={<Wallet size={20} />}
        />
        <MetricCard
          label="Payroll Cost"
          value={aed(payrollCost)}
          icon={<Wallet size={20} />}
        />
        <MetricCard
          label="Cash Position"
          value={aed(report?.cash_position ?? 0)}
          icon={<Wallet size={20} />}
          iconClass="bg-info/15 text-info"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <InfoCard
          title="Revenue (paid) — last 6 months"
          className="lg:col-span-2"
          action={
            <div className="flex gap-1.5">
              <button
                className="btn-ghost text-[11px] px-2 py-1"
                onClick={() => window.print()}
                title="Print / PDF"
              >
                <FileText size={13} /> PDF
              </button>
              <button
                className="btn-ghost text-[11px] px-2 py-1"
                onClick={() =>
                  downloadCsv(
                    `filey-revenue-${new Date().toISOString().slice(0, 10)}`,
                    trend.map((t) => ({ month: t.name, revenue: t.value })),
                    [
                      { key: "month", label: "Month" },
                      { key: "revenue", label: "Revenue" },
                    ]
                  )
                }
                title="Export CSV"
              >
                <FileDown size={13} /> CSV
              </button>
            </div>
          }
        >
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend}>
                <defs>
                  <linearGradient id="rep" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_FILL_START} stopOpacity={0.5} />
                    <stop offset="100%" stopColor={CHART_FILL_START} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 12, fill: "#A39B8C" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: "#A39B8C" }}
                  axisLine={false}
                  tickLine={false}
                  width={70}
                />
                <Tooltip
                  formatter={(v) => aed(Number(v))}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid #DEDBD2",
                    fontSize: 13,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={CHART_STROKE}
                  strokeWidth={2.5}
                  fill="url(#rep)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </InfoCard>

        <InfoCard
          title="Value by category"
          action={
            <div className="flex gap-1.5">
              <button
                className="btn-ghost text-[11px] px-2 py-1"
                onClick={() =>
                  downloadCsv(
                    `filey-categories-${new Date().toISOString().slice(0, 10)}`,
                    catValue.map((c) => ({ category: c.name, value: c.value })),
                    [
                      { key: "category", label: "Category" },
                      { key: "value", label: "Value" },
                    ]
                  )
                }
                title="Export CSV"
              >
                <FileDown size={13} /> CSV
              </button>
            </div>
          }
        >
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={catValue.length ? catValue : [{ name: "—", value: 1 }]}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={3}
                >
                  {catValue.length
                    ? catValue.map((_, i) => (
                        <Cell key={i} fill={PIE[i % PIE.length]} />
                      ))
                    : [<Cell key={0} fill="#DEDBD2" />]}
                </Pie>
                <Tooltip formatter={(v) => aed(Number(v))} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </InfoCard>
      </div>

      <InfoCard
        title="Financial position"
        action={
          <div className="flex gap-1.5">
            <button
              className="btn-ghost text-[11px] px-2 py-1"
              onClick={() => window.print()}
              title="Print / PDF"
            >
              <FileText size={13} /> PDF
            </button>
            <button
              className="btn-ghost text-[11px] px-2 py-1"
              onClick={() =>
                downloadCsv(
                  `filey-financials-${new Date().toISOString().slice(0, 10)}`,
                  financials.map((f) => ({ metric: f.name, amount: f.value })),
                  [
                    { key: "metric", label: "Metric" },
                    { key: "amount", label: "Amount" },
                  ]
                )
              }
              title="Export CSV"
            >
              <FileDown size={13} /> CSV
            </button>
          </div>
        }
      >
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={financials}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 12, fill: "#A39B8C" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 12, fill: "#A39B8C" }}
                axisLine={false}
                tickLine={false}
                width={80}
              />
              <Tooltip
                formatter={(v) => aed(Number(v))}
                contentStyle={{
                  borderRadius: 12,
                  border: "1px solid #DEDBD2",
                  fontSize: 13,
                }}
              />
              <Bar dataKey="value" fill={BAR_FILL} radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="text-xs text-brand-400 mt-3">
          {num(products.length)} products tracked · figures in {getDisplayCurrency()}
        </p>
      </InfoCard>
    </div>
  );
}
