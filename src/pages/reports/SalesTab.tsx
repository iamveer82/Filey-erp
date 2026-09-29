import { ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent } from "../../components/ui/chart";
import { ChartFrame } from "../../components/charts";
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
  CartesianGrid,
} from "recharts";
import { aed, chartAmount, num, cn } from "../../lib/format";
import { isPostedStatus } from "../../lib/api";
import { useChartStyle } from "../../components/charts";
import { ReportsData, useTrend, useStatusPie } from "./useReportsData";
import ChartEmpty, { allZero } from "../../components/ChartEmpty";

import { monthlyInvoiceSales } from "../overviewData";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "../../components/ui/card";
import type { ChartConfig } from "../../components/ui/chart";

const CLOSED = ["paid", "draft", "cancelled"];

export default function SalesTab({ data }: { data: ReportsData }) {
  const cs = useChartStyle();
  const c = cs.c;
  const trend = useTrend(data.invoices, data.receiptList, data.invoicePayments);
  const pie = useStatusPie(data.invoices, c.accent, c.primary, c.tertiary);

  const totalInvoiced = useMemo(
    () =>
      data.invoices
        .filter((i) => isPostedStatus(i.status))
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
    () => data.invoices.filter(i => isPostedStatus(i.status)).reduce((s, i) => s + (i.paid || 0), 0),
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

  const monthlySales = useMemo(() => monthlyInvoiceSales(data.invoices), [data.invoices]);
  const monthlyConfig = {
    paid: { label: "Paid invoices", color: c.primary },
    open: { label: "Open invoices", color: c.accent },
  } satisfies ChartConfig;
  const periodTotal = monthlySales.reduce((sum, month) => sum + month.paid + month.open, 0);

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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Sales and payments</CardTitle>
            <CardDescription>Last 7 days · invoices and recorded payments</CardDescription>
          </CardHeader>
          <CardContent>
          <div className="h-[280px]">
            {allZero(trend, "invoiced", "invoicePayments", "received") ? (
              <ChartEmpty hint="Post an invoice, record an invoice payment or confirm a receipt document to see activity here." />
            ) : (
            <ChartFrame height={280}>
              <LineChart
                data={trend}
                margin={{ top: 10, right: 10, left: -12, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
                <XAxis
                  dataKey="d"
                  {...cs.axisProps}
                />
                <YAxis
                  {...cs.axisProps}
                  tickFormatter={(v) => chartAmount(Number(v))}
                />
                <ChartTooltip content={<ChartTooltipContent valueFormatter={(v) => aed(Number(v) || 0)} />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Line
                  isAnimationActive={false}
                  type="monotone"
                  dataKey="invoiced"
                  name="Invoiced"
                  stroke={c.accent}
                  strokeWidth={2.5}
                  dot={false}
                />
                <Line
                  isAnimationActive={false}
                  type="monotone"
                  dataKey="invoicePayments"
                  name="Invoice payments"
                  stroke={c.primary}
                  strokeWidth={2.5}
                  strokeDasharray="5 3"
                  dot={false}
                />
                <Line
                  isAnimationActive={false}
                  type="monotone"
                  dataKey="received"
                  name="Receipt documents"
                  stroke={c.tertiary}
                  strokeWidth={2.5}
                  dot={false}
                />
              </LineChart>
            </ChartFrame>
            )}
          </div>
          </CardContent>
          <CardFooter className="mt-auto border-t border-border">
            Payments and receipt documents stay separate; they may describe the same payment.
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Monthly sales</CardTitle>
            <CardDescription>{monthlySales[0].label} – {monthlySales[5].label}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              {allZero(monthlySales, "paid", "open") ? (
                <ChartEmpty hint="Monthly totals build up as you invoice through the year." />
              ) : (
                <ChartFrame height={280} config={monthlyConfig}>
                  <BarChart accessibilityLayer data={monthlySales} margin={{ top: 10, right: 4, left: -12, bottom: 0 }}>
                    <CartesianGrid stroke={c.grid} vertical={false} />
                    <XAxis dataKey="label" {...cs.axisProps} tickMargin={10} tickFormatter={(value: string) => value.slice(0, 3)} />
                    <YAxis {...cs.axisProps} tickFormatter={(v) => chartAmount(Number(v))} />
                    <ChartTooltip cursor={cs.cursor} content={<ChartTooltipContent valueFormatter={(v) => aed(Number(v) || 0)} />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Bar dataKey="paid" name="Paid invoices" stackId="sales" fill="var(--color-paid)" radius={[0, 0, 4, 4]} maxBarSize={36} isAnimationActive={false} />
                    <Bar dataKey="open" name="Open invoices" stackId="sales" fill="var(--color-open)" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
                  </BarChart>
                </ChartFrame>
              )}
            </div>
          </CardContent>
          <CardFooter className="flex-col items-start gap-1 border-t border-border">
            <span className="font-medium text-foreground tabular-nums">{aed(periodTotal)} invoiced in this period</span>
            <span>Grouped by issue month, using each invoice’s current payment status.</span>
          </CardFooter>
        </Card>
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
            <ChartFrame height={280}>
              <PieChart>
                <Pie
                  isAnimationActive={false}
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
                <ChartTooltip content={<ChartTooltipContent valueFormatter={(v) => num(Number(v) || 0)} />} />
              </PieChart>
            </ChartFrame>
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
