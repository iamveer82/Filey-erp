import { ChartFrame } from "../../components/charts";
import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { aed, chartAmount, num, cn } from "../../lib/format";
import { useChartStyle } from "../../components/charts";
import ChartEmpty, { allZero } from "../../components/ChartEmpty";
import {
  ReportsData,
  useTopSuppliers,
  usePayablesAging,
  paidByPo,
  supplierBillBalances,
} from "./useReportsData";

export default function SuppliersTab({ data }: { data: ReportsData }) {
  const cs = useChartStyle();
  const c = cs.c;
  const topSuppliers = useTopSuppliers(data.poList);
  const aging = usePayablesAging(data.purchaseInvoices);

  const tooltipStyle = cs.tooltipStyle;

  /* Payables aging bar chart data */
  const agingData = [
    { name: "Current", value: aging.current },
    { name: "1-30", value: aging.d30 },
    { name: "31-60", value: aging.d60 },
    { name: "61-90", value: aging.d90 },
    { name: "90+", value: aging.d90p },
  ];

  const supplierBalances = useMemo(() => supplierBillBalances(data.purchaseInvoices).slice(0,10), [data.purchaseInvoices]);
  const commitments = useMemo(() => {
    const paid = paidByPo(data.poPayments);
    return data.poList.filter(po => !["draft","cancelled","received","completed","paid"].includes(po.status))
      .reduce((sum,po) => sum + Math.max(0,po.total-(paid.get(po.id)||0)),0);
  },[data.poList,data.poPayments]);

  const totalPayables = aging.current + aging.d30 + aging.d60 + aging.d90 + aging.d90p;
  const totalSuppliers = data.supplierList.length;
  const activeSuppliers = useMemo(
    () => new Set(data.poList.map((p) => p.supplier_name)).size,
    [data.poList]
  );

  const kpis = [
    { label: "Total Suppliers", value: num(totalSuppliers), hint: "in directory" },
    { label: "Active Suppliers", value: num(activeSuppliers), hint: "with purchase orders" },
    {
      label: "Open Payables",
      value: aed(totalPayables),
      hint: "posted supplier bills, net of payments",
    },
    {
      label: "PO commitments",
      value: aed(commitments),
      hint: "unreceived orders, net of PO payments",
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

      {/* Top suppliers bar + payables aging */}
      <div className="grid grid-cols-1 lg:grid-cols-2 border border-border rounded-xl overflow-hidden bg-card">
        {/* Top suppliers by PO value */}
        <div className="p-5 border-b lg:border-b-0 lg:border-r border-border">
          <div className="text-[14px] font-semibold text-foreground">
            Top suppliers by PO value
          </div>
          <div className="text-[12.5px] text-muted-foreground mt-0.5">
            Confirmed purchase orders · separate from supplier bills
          </div>
          {topSuppliers.length === 0 ? (
            <div className="h-[280px] mt-3 grid place-items-center text-[12.5px] text-muted-foreground">
              No purchase order data
            </div>
          ) : (
            <div className="h-[280px] mt-3">
              {allZero(topSuppliers, "total") ? (
                <ChartEmpty hint="Your biggest suppliers rank here once purchases exist." />
              ) : (
              <ChartFrame height={280}>
                <BarChart
                  data={topSuppliers}
                  layout="vertical"
                  margin={{ top: 5, right: 10, left: 60, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="supG" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor={c.accent} stopOpacity={0.95} />
                      <stop offset="100%" stopColor={c.accent} stopOpacity={0.4} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={c.grid} horizontal={false} />
                  <XAxis
                    type="number"
                    {...cs.axisProps}
                    tickFormatter={(v) => chartAmount(Number(v))}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    {...cs.axisProps}
                    width={60}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v) => aed(Number(v) || 0)}
                  />
                  <Bar
                    dataKey="total"
                    name="PO Value"
                    fill="url(#supG)"
                    radius={[0, 4, 4, 0]}
                   maxBarSize={32} />
                </BarChart>
              </ChartFrame>
              )}
            </div>
          )}
        </div>

        {/* Payables aging */}
        <div className="p-5">
          <div className="text-[14px] font-semibold text-foreground">
            Payables aging
          </div>
          <div className="text-[12.5px] text-muted-foreground mt-0.5">
            Unpaid supplier bills by due date
          </div>
          <div className="h-[280px] mt-3">
            {allZero(agingData, "value") ? (
              <ChartEmpty hint="Posted supplier bills appear here while a balance is due." />
            ) : (
            <ChartFrame height={280}>
              <BarChart
                data={agingData}
                margin={{ top: 10, right: 10, left: -12, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="payG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c.accent} stopOpacity={0.95} />
                    <stop offset="100%" stopColor={c.accent} stopOpacity={0.4} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
                <XAxis
                  dataKey="name"
                  {...cs.axisProps}
                />
                <YAxis
                  {...cs.axisProps}
                  tickFormatter={(v) => chartAmount(Number(v))}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v) => aed(Number(v) || 0)}
                />
                <Bar
                  dataKey="value"
                  name="Payable"
                  fill="url(#payG)"
                  radius={[6, 6, 0, 0]}
                 maxBarSize={32} />
              </BarChart>
            </ChartFrame>
            )}
          </div>
        </div>
      </div>

      {/* Supplier open POs table */}
      <div className="border border-border rounded-xl overflow-hidden bg-card">
        <div className="px-5 pt-4 pb-3">
          <div className="text-[14px] font-semibold text-foreground">
            Supplier open balances
          </div>
          <div className="text-[12.5px] text-muted-foreground mt-0.5">
            Top 10 suppliers with unpaid bills
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="px-5 py-2.5 font-medium text-[12px]">Supplier</th>
                <th className="px-5 py-2.5 font-medium text-[12px] text-right">Open bills</th>
                <th className="px-5 py-2.5 font-medium text-[12px] text-right">Open Total</th>
                <th className="px-5 py-2.5 font-medium text-[12px] text-right">% of Total</th>
              </tr>
            </thead>
            <tbody>
              {supplierBalances.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">
                    No unpaid supplier bills
                  </td>
                </tr>
              )}
              {supplierBalances.map((s, i) => (
                <tr
                  key={i}
                  className="border-b border-border last:border-0 hover:bg-hover transition-colors"
                >
                  <td className="px-5 py-3 text-foreground">{s.name}</td>
                  <td className="px-5 py-3 text-right text-muted-foreground tabular-nums">
                    {s.billCount}
                  </td>
                  <td className="px-5 py-3 text-right text-foreground tabular-nums font-medium">
                    {aed(s.open)}
                  </td>
                  <td className="px-5 py-3 text-right text-muted-foreground tabular-nums">
                    {totalPayables > 0
                      ? ((s.open / totalPayables) * 100).toFixed(1) + "%"
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
