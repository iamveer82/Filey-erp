import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { aed, num, cn } from "../../lib/format";
import { useChartColors } from "../../lib/accent";
import ChartEmpty, { allZero } from "../../components/ChartEmpty";
import {
  ReportsData,
  useTopCustomers,
  useReceivablesAging,
} from "./useReportsData";

export default function CustomersTab({ data }: { data: ReportsData }) {
  const c = useChartColors();
  const topCustomers = useTopCustomers(data.invoices, data.customers);
  const aging = useReceivablesAging(data.invoices);

  const tooltipStyle = {
    borderRadius: 8,
    fontSize: 12,
    background: c.tooltipBg,
    border: `1px solid ${c.tooltipBorder}`,
    color: c.tooltipFg,
  };

  /* Receivables aging bar chart data */
  const agingData = [
    { name: "Current", value: aging.current },
    { name: "1-30", value: aging.d30 },
    { name: "31-60", value: aging.d60 },
    { name: "61-90", value: aging.d90 },
    { name: "90+", value: aging.d90p },
  ];

  /* Customer-level outstanding balances */
  const customerBalances = useMemo(() => {
    const g = new Map<string, { name: string; outstanding: number; invoiceCount: number }>();
    for (const i of data.invoices) {
      if (["paid", "draft", "cancelled"].includes(i.status)) continue;
      const balance = i.balance ?? i.total ?? 0;
      if (balance <= 0) continue;
      const name = i.customer_name || "—";
      const row = g.get(name) || { name, outstanding: 0, invoiceCount: 0 };
      row.outstanding += balance;
      row.invoiceCount += 1;
      g.set(name, row);
    }
    return Array.from(g.values())
      .sort((a, b) => b.outstanding - a.outstanding)
      .slice(0, 10);
  }, [data.invoices]);

  const totalOutstanding = aging.current + aging.d30 + aging.d60 + aging.d90 + aging.d90p;
  const totalCustomers = data.customers.length;
  const activeCustomers = useMemo(
    () =>
      new Set(
        data.invoices
          .filter((i) => i.status !== "draft")
          .map((i) => i.customer_name)
      ).size,
    [data.invoices]
  );

  const kpis = [
    { label: "Total Customers", value: num(totalCustomers), hint: "in directory" },
    { label: "Active Customers", value: num(activeCustomers), hint: "with invoices" },
    {
      label: "Outstanding",
      value: aed(totalOutstanding),
      hint: "across all open invoices",
    },
    {
      label: "Avg per Customer",
      value: totalCustomers > 0 ? aed(totalOutstanding / totalCustomers) : aed(0),
      hint: "outstanding per customer",
    },
  ];

  return (
    <div className="space-y-5">
      {/* KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-border rounded-xl overflow-hidden bg-card">
        {kpis.map((k, i) => (
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
            <div className="mt-2 text-[11.5px] text-muted-foreground">{k.hint}</div>
          </div>
        ))}
      </div>

      {/* Top customers bar + receivables aging */}
      <div className="grid grid-cols-1 lg:grid-cols-2 border border-border rounded-xl overflow-hidden bg-card">
        {/* Top customers by revenue */}
        <div className="p-5 border-b lg:border-b-0 lg:border-r border-border">
          <div className="text-[14px] font-semibold text-foreground">
            Top customers by revenue
          </div>
          <div className="text-[12.5px] text-muted-foreground mt-0.5">
            From non-draft invoice totals
          </div>
          {topCustomers.length === 0 ? (
            <div className="h-[280px] mt-3 grid place-items-center text-[12.5px] text-muted-foreground">
              No invoice data
            </div>
          ) : (
            <div className="h-[280px] mt-3">
              {allZero(topCustomers, "total") ? (
                <ChartEmpty hint="Your highest-spending customers rank here once invoices exist." />
              ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={topCustomers}
                  layout="vertical"
                  margin={{ top: 5, right: 10, left: 60, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="custG" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor={c.accent} stopOpacity={0.95} />
                      <stop offset="100%" stopColor={c.accent} stopOpacity={0.4} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={c.grid} horizontal={false} />
                  <XAxis
                    type="number"
                    stroke={c.axis}
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `AED ${num(v)}`}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    stroke={c.axis}
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={60}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v) => aed(Number(v) || 0)}
                  />
                  <Bar
                    dataKey="total"
                    name="Revenue"
                    fill="url(#custG)"
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
              )}
            </div>
          )}
        </div>

        {/* Receivables aging */}
        <div className="p-5">
          <div className="text-[14px] font-semibold text-foreground">
            Receivables aging
          </div>
          <div className="text-[12.5px] text-muted-foreground mt-0.5">
            Outstanding invoices by age bucket
          </div>
          <div className="h-[280px] mt-3">
            {allZero(agingData, "value") ? (
              <ChartEmpty hint="Unpaid invoices land in these buckets as they age." />
            ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={agingData}
                margin={{ top: 10, right: 10, left: -12, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="ageG" x1="0" y1="0" x2="0" y2="1">
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
                <Bar
                  dataKey="value"
                  name="Outstanding"
                  fill="url(#ageG)"
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Customer outstanding table */}
      <div className="border border-border rounded-xl overflow-hidden bg-card">
        <div className="px-5 pt-4 pb-3">
          <div className="text-[14px] font-semibold text-foreground">
            Customer outstanding balances
          </div>
          <div className="text-[12.5px] text-muted-foreground mt-0.5">
            Top 10 customers with open invoices
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="px-5 py-2.5 font-medium text-[12px]">Customer</th>
                <th className="px-5 py-2.5 font-medium text-[12px] text-right">Invoices</th>
                <th className="px-5 py-2.5 font-medium text-[12px] text-right">Outstanding</th>
                <th className="px-5 py-2.5 font-medium text-[12px] text-right">% of Total</th>
              </tr>
            </thead>
            <tbody>
              {customerBalances.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">
                    No outstanding invoices
                  </td>
                </tr>
              )}
              {customerBalances.map((c, i) => (
                <tr
                  key={i}
                  className="border-b border-border last:border-0 hover:bg-hover transition-colors"
                >
                  <td className="px-5 py-3 text-foreground">{c.name}</td>
                  <td className="px-5 py-3 text-right text-muted-foreground tabular-nums">
                    {c.invoiceCount}
                  </td>
                  <td className="px-5 py-3 text-right text-foreground tabular-nums font-medium">
                    {aed(c.outstanding)}
                  </td>
                  <td className="px-5 py-3 text-right text-muted-foreground tabular-nums">
                    {totalOutstanding > 0
                      ? ((c.outstanding / totalOutstanding) * 100).toFixed(1) + "%"
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}