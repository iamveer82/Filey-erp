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
import { useChartStyle } from "../../components/charts";
import { ReportsData, useCategoryBars } from "./useReportsData";

export default function InventoryTab({ data }: { data: ReportsData }) {
  const cs = useChartStyle();
  const c = cs.c;
  const categoryBars = useCategoryBars(data.products);

  const tooltipStyle = cs.tooltipStyle;

  /* KPIs — all derived from products array. */
  const kpis = useMemo(() => {
    let inventoryValue = 0;
    let lowStock = 0;
    let outOfStock = 0;
    for (const p of data.products) {
      const qty = Number(p.quantity) || 0;
      const reorder = Number(p.reorder_level) || 0;
      const cost = Number(p.cost_price) || 0;
      inventoryValue += qty * cost;
      if (qty <= 0) outOfStock += 1;
      else if (qty <= reorder) lowStock += 1;
    }
    return {
      totalProducts: data.products.length,
      inventoryValue,
      lowStock,
      outOfStock,
    };
  }, [data.products]);

  /* Low stock rows: qty <= reorder_level, sorted most-depleted first. */
  const lowStock = useMemo(() => {
    return data.products
      .filter((p) => (Number(p.quantity) || 0) <= (Number(p.reorder_level) || 0))
      .sort((a, b) => (Number(a.quantity) || 0) - (Number(b.quantity) || 0));
  }, [data.products]);

  /* Category distribution for the horizontal bar list. */
  const categoryDist = useMemo(() => {
    const g = new Map<string, number>();
    for (const p of data.products) {
      const key = p.category || "Other";
      g.set(key, (g.get(key) ?? 0) + 1);
    }
    return Array.from(g.entries()).sort((a, b) => b[1] - a[1]);
  }, [data.products]);

  const maxCat = categoryDist[0]?.[1] || 1;

  const kpiCards = [
    { label: "Total Products", value: num(kpis.totalProducts) },
    { label: "Inventory Value", value: aed(kpis.inventoryValue) },
    { label: "Low Stock Items", value: num(kpis.lowStock) },
    { label: "Out of Stock", value: num(kpis.outOfStock) },
  ];

  return (
    <div className="space-y-5">
      {/* KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-border rounded-xl overflow-hidden bg-card">
        {kpiCards.map((k, i) => (
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

      {/* Inventory value by category + category distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 border border-border rounded-xl overflow-hidden bg-card">
        {/* Bar chart */}
        <div className="p-5 border-b lg:border-b-0 lg:border-r border-border">
          <div className="text-[14px] font-semibold text-foreground">
            Inventory Value by Category
          </div>
          <div className="text-[12.5px] text-muted-foreground mt-0.5">
            Stock on hand × unit price
          </div>
          {categoryBars.length === 0 ? (
            <div className="h-[280px] mt-3 grid place-items-center text-[12.5px] text-muted-foreground">
              No products in inventory
            </div>
          ) : (
            <div className="h-[280px] mt-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={categoryBars}
                  margin={{ top: 10, right: 10, left: -12, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="invG" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={c.accent} stopOpacity={0.95} />
                      <stop offset="100%" stopColor={c.accent} stopOpacity={0.35} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
                  <XAxis
                    dataKey="name"
                    {...cs.axisProps}
                  />
                  <YAxis
                    {...cs.axisProps}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v) => aed(Number(v) || 0)}
                  />
                  <Bar
                    dataKey="value"
                    name="Value"
                    fill="url(#invG)"
                    radius={[6, 6, 0, 0]}
                   maxBarSize={32} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Category distribution - horizontal bar list */}
        <div className="p-5">
          <div className="text-[14px] font-semibold text-foreground">
            Product Count by Category
          </div>
          <div className="text-[12.5px] text-muted-foreground mt-0.5">
            {num(kpis.totalProducts)} products across {categoryDist.length} categories
          </div>
          {categoryDist.length === 0 ? (
            <div className="h-[280px] mt-3 grid place-items-center text-[12.5px] text-muted-foreground">
              No products in inventory
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {categoryDist.map(([name, count]) => (
                <div key={name}>
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="text-foreground">{name}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {num(count)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(count / maxCat) * 100}%`,
                        background: c.accent,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Low stock table */}
      <div className="border border-border rounded-xl overflow-hidden bg-card">
        <div className="px-5 pt-4 pb-3">
          <div className="text-[14px] font-semibold text-foreground">
            Low Stock & Out of Stock
          </div>
          <div className="text-[12.5px] text-muted-foreground mt-0.5">
            {lowStock.length} products at or below reorder level
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="px-5 py-2.5 font-medium text-[12px]">SKU</th>
                <th className="px-5 py-2.5 font-medium text-[12px]">Name</th>
                <th className="px-5 py-2.5 font-medium text-[12px]">Category</th>
                <th className="px-5 py-2.5 font-medium text-[12px] text-right">Stock</th>
                <th className="px-5 py-2.5 font-medium text-[12px] text-right">Reorder Level</th>
                <th className="px-5 py-2.5 font-medium text-[12px]">Status</th>
              </tr>
            </thead>
            <tbody>
              {lowStock.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">
                    All products are above reorder level
                  </td>
                </tr>
              )}
              {lowStock.map((p) => {
                const qty = Number(p.quantity) || 0;
                const status =
                  qty <= 0
                    ? { label: "Out", cls: "bg-red-500/10 text-red-600 ring-1 ring-red-500/30" }
                    : { label: "Low", cls: "bg-amber-500/10 text-amber-600 ring-1 ring-amber-500/30" };
                return (
                  <tr
                    key={p.id}
                    className="border-b border-border last:border-0 hover:bg-hover transition-colors"
                  >
                    <td className="px-5 py-3 text-muted-foreground tabular-nums">
                      {p.sku || "—"}
                    </td>
                    <td className="px-5 py-3 text-foreground">{p.name}</td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {p.category || "Other"}
                    </td>
                    <td className="px-5 py-3 text-right text-foreground tabular-nums">
                      {num(qty)}
                    </td>
                    <td className="px-5 py-3 text-right text-muted-foreground tabular-nums">
                      {num(Number(p.reorder_level) || 0)}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium",
                          status.cls
                        )}
                      >
                        {status.label}
                      </span>
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