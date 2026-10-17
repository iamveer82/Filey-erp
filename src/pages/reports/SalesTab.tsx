import { useMemo } from "react";
import { aed, num, cn } from "../../lib/format";
import { isPostedStatus } from "../../lib/api";
import { useChartStyle } from "../../components/charts";
import { ReportsData, useTrend, useStatusPie } from "./useReportsData";
import ChartEmpty, { allZero } from "../../components/ChartEmpty";

import { monthlyInvoiceSales } from "../overviewData";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "../../components/ui/card";
import { BarSeriesChart, DonutChart } from "../../components/modernCharts";
import { bucketTrend } from "../overviewData";

const CLOSED = ["paid", "draft", "cancelled"];

export default function SalesTab({ data }: { data: ReportsData }) {
  const cs = useChartStyle();
  const c = cs.c;
  const { trend, days } = useTrend(data.invoices, data.receiptList, data.invoicePayments);
  const bars = useMemo(() => bucketTrend(trend), [trend]);
  const pie = useStatusPie(data.invoices, c);

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
            <CardDescription>Last {days} days · invoices and recorded payments</CardDescription>
          </CardHeader>
          <CardContent>
          <div className="h-[280px]">
            {allZero(trend, "invoiced", "invoicePayments", "received") ? (
              <ChartEmpty hint="Post an invoice, record an invoice payment or confirm a receipt document to see activity here." />
            ) : (
            <BarSeriesChart
              data={bars}
              xKey="d"
              spanKey="span"
              height={280}
              valueFormatter={(v) => aed(v)}
              series={[
                { key: "invoiced", label: "Invoiced", color: c.series[0] },
                { key: "invoicePayments", label: "Invoice payments", color: c.good },
                { key: "received", label: "Receipt documents", color: c.series[1] },
              ]}
            />
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
                <BarSeriesChart
                  data={monthlySales}
                  xKey="label"
                  stacked
                  height={280}
                  xFormatter={(value) => value.slice(0, 3)}
                  valueFormatter={(v) => aed(v)}
                  series={[
                    { key: "paid", label: "Paid invoices", color: c.good },
                    { key: "open", label: "Open invoices", color: c.series[1] },
                  ]}
                />
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
            <DonutChart
              height={236}
              legend={false}
              valueFormatter={(v) => num(v)}
              data={pie.map((p, i) => ({ key: p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || `status-${i}`, label: p.name, value: p.value, color: p.color }))}
            />
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
