import { useMemo } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
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
import { aed, num, cn } from "../../lib/format";
import { useChartColors } from "../../lib/accent";
import { ReportsData, useTrend, useStatusPie } from "./useReportsData";
import ChartEmpty, { allZero } from "../../components/ChartEmpty";

const CLOSED = ["paid", "draft", "cancelled"];

export default function SalesTab({ data }: { data: ReportsData }) {
  const c = useChartColors();
  const trend = useTrend(data.invoices, data.receiptList);
  const pie = useStatusPie(data.invoices, c.accent, c.primary, c.tertiary);

  const totalInvoiced = useMemo(
    () =>
      data.invoices
        .filter((i) => i.status !== "draft")
        .reduce((s, i) => s + (i.total || 0), 0),
    [data.invoices]
  );

  const outstanding = useMemo(
    () =>
      data.invoices
        .filter((i) => !CLOSED.includes(i.status))
        .reduce((s, i) => s + (i.balance ?? i.total ?? 0), 0),
    [data.invoices]
  );

  const paidAmount = useMemo(
    () => data.invoices.reduce((s, i) => s + (i.paid || 0), 0),
    [data.invoices]
  );

  const overdueCount = useMemo(() => {
    const now = Date.now();
    return data.invoices.filter((i) => {
      if (i.status === "overdue") return true;
      if (CLOSED.includes(i.status) || !i.due_date) return false;
      return +new Date(i.due_date) < now;
    }).length;
  }, [data.invoices]);

  const monthlySales = useMemo(() => {
    const byMonth = new Map<string, { m: string; total: number }>();
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toISOString().slice(0, 7);
      const label = d.toLocaleDateString(undefined, { month: "short" });
      byMonth.set(key, { m: label, total: 0 });
    }
    for (const inv of data.invoices) {
      if (inv.status === "draft" || !inv.issue_date) continue;
      const key = inv.issue_date.slice(0, 7);
      const row = byMonth.get(key);
      if (row) row.total += inv.total || 0;
    }
    return Array.from(byMonth.values());
  }, [data.invoices]);

  const tooltipStyle = {
    borderRadius: 8,
    fontSize: 12,
    background: c.tooltipBg,
    border: `1px solid ${c.tooltipBorder}`,
    color: c.tooltipFg,
  };

  const kpis = [
    { label: "Total Invoiced", value: aed(totalInvoiced) },
    { label: "Outstanding", value: aed(outstanding) },
    { label: "Paid Amount", value: aed(paidAmount) },
    { label: "Overdue", value: num(overdueCount) },
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
          </div>
        ))}
      </div>

      {/* Revenue trend (line) + monthly sales (bar) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 border border-border rounded-xl overflow-hidden bg-card">
        <div className="p-5 border-b lg:border-b-0 lg:border-r border-border">
          <div className="text-[14px] font-semibold text-foreground">
            Revenue trend
          </div>
          <div className="text-[12.5px] text-muted-foreground mt-0.5">
            Invoiced vs received - last 8 days
          </div>
          <div className="h-[280px] mt-3">
            {allZero(trend, "invoiced", "received") ? (
              <ChartEmpty hint="Send an invoice and the day it was raised shows up here." />
            ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={trend}
                margin={{ top: 10, right: 10, left: -12, bottom: 0 }}
              >
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
                  tickFormatter={(v) => `AED ${num(v)}`}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v) => aed(Number(v) || 0)}
                />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 12 }}
                />
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
            )}
          </div>
        </div>

        <div className="p-5">
          <div className="text-[14px] font-semibold text-foreground">
            Monthly sales
          </div>
          <div className="text-[12.5px] text-muted-foreground mt-0.5">
            Invoiced totals - last 6 months
          </div>
          <div className="h-[280px] mt-3">
            {allZero(monthlySales, "total") ? (
              <ChartEmpty hint="Monthly totals build up as you invoice through the year." />
            ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={monthlySales}
                margin={{ top: 10, right: 10, left: -12, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="salesG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c.accent} stopOpacity={0.95} />
                    <stop offset="100%" stopColor={c.accent} stopOpacity={0.35} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
                <XAxis
                  dataKey="m"
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
                  tickFormatter={(v) => `AED ${num(v)}`}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v) => aed(Number(v) || 0)}
                />
                <Bar
                  dataKey="total"
                  name="Invoiced"
                  fill="url(#salesG)"
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Invoice status pie + legend */}
      <div className="grid grid-cols-1 lg:grid-cols-3 border border-border rounded-xl overflow-hidden bg-card">
        <div className="p-5 border-b lg:border-b-0 lg:border-r border-border lg:col-span-2">
          <div className="text-[14px] font-semibold text-foreground">
            Invoice status
          </div>
          <div className="text-[12.5px] text-muted-foreground mt-0.5">
            Distribution by status
          </div>
          <div className="h-[280px] mt-3">
            {allZero(pie, "value") ? (
              <ChartEmpty hint="Invoice statuses appear here once you have invoices." />
            ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pie}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={55}
                  outerRadius={90}
                  paddingAngle={2}
                  stroke="none"
                >
                  {pie.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v) => num(Number(v) || 0)}
                />
              </PieChart>
            </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="p-5">
          <div className="text-[14px] font-semibold text-foreground">
            Breakdown
          </div>
          <div className="text-[12.5px] text-muted-foreground mt-0.5">
            Count by status
          </div>
          <div className="mt-4 space-y-1.5">
            {pie.length === 0 && (
              <div className="text-[12.5px] text-muted-foreground">
                No invoices
              </div>
            )}
            {pie.map((entry) => (
              <div
                key={entry.name}
                className="flex items-center justify-between text-[12.5px]"
              >
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: entry.color }}
                  />
                  {entry.name}
                </span>
                <span className="text-foreground tabular-nums">
                  {num(entry.value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}