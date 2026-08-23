import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { TrendingUp, TrendingDown } from "lucide-react";
import { aed, num, cn } from "../../lib/format";
import { useChartColors } from "../../lib/accent";
import ChartEmpty, { allZero } from "../../components/ChartEmpty";
import {
  ReportsData,
  useRevenueTotal,
  useCashReceived,
  useDeltas,
  useTrend,
} from "./useReportsData";

type Kpi = {
  label: string;
  value: string;
  delta: number | null;
  hint: string;
};

export default function DashboardTab({ data }: { data: ReportsData }) {
  const c = useChartColors();
  const revenueTotal = useRevenueTotal(data.invoices);
  const cashReceived = useCashReceived(data.receiptList);
  const deltas = useDeltas(data.invoices, data.receiptList, data.customers, data.orders);
  const trend = useTrend(data.invoices, data.receiptList);

  const kpis: Kpi[] = [
    {
      label: "Revenue",
      value: aed(revenueTotal),
      delta: deltas.revenue,
      hint: `${num(data.invoices.length)} invoices`,
    },
    {
      label: "Cash received",
      value: aed(cashReceived),
      delta: deltas.cash,
      hint: `${num(data.receiptList.length)} receipts`,
    },
    {
      label: "Customers",
      value: num(data.customers.length),
      delta: deltas.customers,
      hint: "in directory",
    },
    {
      label: "Orders",
      value: num(data.orders.length),
      delta: deltas.orders,
      hint: "all time",
    },
  ];

  const recent = data.txns.slice(0, 8);

  const tooltipStyle = {
    borderRadius: 8,
    fontSize: 12,
    background: c.tooltipBg,
    border: `1px solid ${c.tooltipBorder}`,
    color: c.tooltipFg,
  };

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
            <div className="mt-2 flex items-center gap-2">
              {k.delta !== null && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 font-medium text-[11.5px]",
                    k.delta >= 0 ? "text-success" : "text-danger"
                  )}
                >
                  {k.delta >= 0 ? (
                    <TrendingUp className="h-3 w-3" strokeWidth={1.75} />
                  ) : (
                    <TrendingDown className="h-3 w-3" strokeWidth={1.75} />
                  )}
                  {k.delta >= 0 ? "+" : ""}
                  {k.delta.toFixed(1)}%
                </span>
              )}
              <span className="text-[11.5px] text-muted-foreground">{k.hint}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Revenue trend chart */}
      <div className="border border-border rounded-xl overflow-hidden bg-card">
        <div className="p-5 pb-0">
          <div className="text-[14px] font-semibold text-foreground">
            Revenue trend
          </div>
          <div className="text-[12.5px] text-muted-foreground mt-0.5">
            Invoiced vs received, last 8 days
          </div>
        </div>
        <div className="p-5">
          <div className="h-[280px]">
            {allZero(trend, "invoiced", "received") ? (
              <ChartEmpty hint="Send an invoice and the day it was raised shows up here." />
            ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend} margin={{ top: 10, right: 10, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="dashInvoiced" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c.accent} stopOpacity={0.95} />
                    <stop offset="100%" stopColor={c.accent} stopOpacity={0.35} />
                  </linearGradient>
                  <linearGradient id="dashReceived" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c.primary} stopOpacity={0.95} />
                    <stop offset="100%" stopColor={c.primary} stopOpacity={0.35} />
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
                  tickFormatter={(v) => `AED ${num(v)}`}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v) => aed(Number(v) || 0)}
                />
                <Legend
                  wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                  iconType="circle"
                  iconSize={8}
                />
                <Bar
                  dataKey="invoiced"
                  name="Invoiced"
                  fill="url(#dashInvoiced)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="received"
                  name="Received"
                  fill="url(#dashReceived)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Recent transactions */}
      <div className="border border-border rounded-xl overflow-hidden bg-card">
        <div className="px-5 pt-4 pb-3">
          <div className="text-[14px] font-semibold text-foreground">
            Recent transactions
          </div>
          <div className="text-[12.5px] text-muted-foreground mt-0.5">
            Latest 8 ledger entries
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="px-5 py-2.5 font-medium text-[12px]">Date</th>
                <th className="px-5 py-2.5 font-medium text-[12px]">Account</th>
                <th className="px-5 py-2.5 font-medium text-[12px]">Type</th>
                <th className="px-5 py-2.5 font-medium text-[12px] text-right">Amount</th>
                <th className="px-5 py-2.5 font-medium text-[12px]">Description</th>
              </tr>
            </thead>
            <tbody>
              {recent.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                    No transactions yet
                  </td>
                </tr>
              )}
              {recent.map((t) => {
                const isDebit = t.txn_type?.toLowerCase() === "debit";
                return (
                  <tr
                    key={t.id}
                    className="border-b border-border last:border-0 hover:bg-hover transition-colors"
                  >
                    <td className="px-5 py-3 text-muted-foreground whitespace-nowrap">
                      {new Date(t.txn_date).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-3 text-foreground">{t.account_name || "—"}</td>
                    <td className="px-5 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center font-medium",
                          isDebit ? "text-foreground" : "text-muted-foreground"
                        )}
                      >
                        {isDebit ? "Debit" : "Credit"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right text-foreground tabular-nums font-medium">
                      {aed(Number(t.amount) || 0)}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {t.description || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}