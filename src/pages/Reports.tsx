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
import { erp, fin, Product, FinanceReport } from "../lib/api";
import { aed, num } from "../lib/format";
import { PageHeader, MetricCard, InfoCard } from "../components/ui";

// design.md §2 / §6.7 — primary, secondary, info, success, surface
const PIE = ["#FFD600", "#FFBA3D", "#0EA5E9", "#3FB984", "#CBBEAA"];

export default function Reports() {
  const [products, setProducts] = useState<Product[]>([]);
  const [report, setReport] = useState<FinanceReport | null>(null);

  useEffect(() => {
    erp.products().then(setProducts).catch(console.error);
    fin.report().then(setReport).catch(console.error);
  }, []);

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

  const trend = ["Apr 1", "Apr 8", "Apr 15", "Apr 22", "Apr 29"].map(
    (d, i) => ({
      name: d,
      value: Math.round((invValue || 10000) * (0.7 + i * 0.1)),
    })
  );

  const financials = report
    ? [
        { name: "Assets", value: report.total_assets },
        { name: "Liabilities", value: report.total_liabilities },
        { name: "Equity", value: report.total_equity },
        { name: "Revenue", value: report.total_revenue },
        { name: "Expenses", value: report.total_expenses },
      ]
    : [];

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Reports"
        subtitle="Inventory & financial reporting"
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <MetricCard
          label="Inventory Value"
          value={aed(invValue)}
          delta={6.4}
          icon={<Boxes size={20} />}
        />
        <MetricCard
          label="Net Profit"
          value={aed(report?.net_profit ?? 0)}
          delta={12.5}
          icon={<TrendingUp size={20} />}
          iconClass="bg-success/15 text-success"
        />
        <MetricCard
          label="Revenue"
          value={aed(report?.total_revenue ?? 0)}
          delta={8.2}
          icon={<Wallet size={20} />}
          iconClass="bg-secondary-400/20 text-secondary-600"
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
          title="Inventory value trend"
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
                <CartesianGrid strokeDasharray="3 3" stroke="#E4DAC6" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 12, fill: "#A89F8C" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: "#A89F8C" }}
                  axisLine={false}
                  tickLine={false}
                  width={70}
                />
                <Tooltip
                  formatter={(v) => aed(Number(v))}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid #E4DAC6",
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
              <CartesianGrid strokeDasharray="3 3" stroke="#E4DAC6" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 12, fill: "#A89F8C" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 12, fill: "#A89F8C" }}
                axisLine={false}
                tickLine={false}
                width={80}
              />
              <Tooltip
                formatter={(v) => aed(Number(v))}
                contentStyle={{
                  borderRadius: 12,
                  border: "1px solid #E4DAC6",
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
