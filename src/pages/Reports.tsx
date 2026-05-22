import { useEffect, useMemo, useState } from "react";
import { TrendingUp, Wallet, Boxes } from "lucide-react";
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
import { aed, num } from "../lib/format";
import {
  PageHeader,
  MetricCard,
  InfoCard,
  Spinner,
  ErrorBanner,
} from "../components/ui";

// design.md §2 / §6.7 — primary, secondary, info, success, surface
const PIE = ["#FFD600", "#FFBA3D", "#0EA5E9", "#3FB984", "#CBBEAA"];

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

  const invoiceRevenue = useMemo(
    () =>
      invoices
        .filter((i) => i.status === "paid")
        .reduce((s, i) => s + i.total, 0),
    [invoices]
  );
  const accountsReceivable = useMemo(
    () =>
      invoices
        .filter((i) => i.status !== "paid")
        .reduce((s, i) => s + i.total, 0),
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

  // Real revenue trend: paid invoices grouped into the last 6 months.
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
      if (inv.status !== "paid" || !inv.issue_date) continue;
      const d = new Date(inv.issue_date);
      const b = byKey.get(`${d.getFullYear()}-${d.getMonth()}`);
      if (b) b.value += inv.total;
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

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Reports"
        subtitle="Inventory & financial reporting"
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <InfoCard
          title="Revenue (paid) — last 6 months"
          className="lg:col-span-2"
        >
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend}>
                <defs>
                  <linearGradient id="rep" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FFD600" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#FFD600" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#DEDBD2" />
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
                  stroke="#E0AE00"
                  strokeWidth={2.5}
                  fill="url(#rep)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </InfoCard>

        <InfoCard title="Value by category">
          <div className="h-64">
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
                  {catValue.map((_, i) => (
                    <Cell key={i} fill={PIE[i % PIE.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => aed(Number(v))} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </InfoCard>
      </div>

      <InfoCard title="Financial position">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={financials}>
              <CartesianGrid strokeDasharray="3 3" stroke="#DEDBD2" />
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
              <Bar dataKey="value" fill="#FFD600" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="text-xs text-brand-400 mt-3">
          {num(products.length)} products tracked · figures in AED
        </p>
      </InfoCard>
    </div>
  );
}
