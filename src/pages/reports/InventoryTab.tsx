/* ── InventoryTab: Stock valuation + movement ────────────────────────────── */
import { Boxes, Package, AlertTriangle, TrendingDown } from "lucide-react";
import { useMemo } from "react";
import type { ChartConfig } from "../../components/ui/chart";
import { aed, num } from "../../lib/format";
import type { ReportsData } from "./useReportsData";
import { ReportKpi } from "./components/ReportKpi";
import { ReportBarChart } from "./components/ReportChart";
import { ReportTable, type Column } from "./components/ReportTable";
import type { Product } from "../../lib/api";

const chartConfig = {
  value: { label: "Stock Value", color: "#FFD600" },
} satisfies ChartConfig;

export function InventoryTab({ data }: { data: ReportsData }) {
  const { products, loading } = data;

  const invValue = products.reduce((s, p) => s + p.quantity * p.cost_price, 0);
  const retailValue = products.reduce((s, p) => s + p.quantity * p.unit_price, 0);

  const stockBreakdown = useMemo(() => {
    let inStock = 0,
      out = 0,
      low = 0;
    for (const p of products) {
      if (p.quantity <= 0) out++;
      else if (p.quantity <= p.reorder_level) low++;
      else inStock++;
    }
    return { inStock, out, low, total: products.length };
  }, [products]);

  /* Category valuation */
  const byCategory = useMemo(() => {
    const m = new Map<string, { count: number; value: number }>();
    for (const p of products) {
      const cat = p.category || "Uncategorized";
      const cur = m.get(cat) ?? { count: 0, value: 0 };
      cur.count += 1;
      cur.value += p.quantity * p.cost_price;
      m.set(cat, cur);
    }
    return Array.from(m.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.value - a.value);
  }, [products]);

  /* Top stock value products */
  const topValueProducts = useMemo(
    () =>
      [...products]
        .map((p) => ({ ...p, stockValue: p.quantity * p.cost_price }))
        .sort((a, b) => b.stockValue - a.stockValue)
        .slice(0, 15),
    [products]
  );

  const productColumns: Column<Product & { stockValue: number }>[] = [
    {
      key: "sl",
      header: "SL",
      className: "w-8 text-brand-400 px-4",
      render: (_, i) => i + 1,
    },
    {
      key: "name",
      header: "Product",
      render: (p) => <span className="font-medium">{p.name}</span>,
    },
    {
      key: "sku",
      header: "SKU",
      render: (p) => <span className="text-xs text-brand-500">{p.sku}</span>,
    },
    {
      key: "category",
      header: "Category",
      render: (p) => <span className="text-xs">{p.category || "—"}</span>,
    },
    {
      key: "qty",
      header: "Qty",
      align: "right",
      render: (p) => (
        <span
          className={
            p.quantity <= 0
              ? "text-danger font-medium tabular-nums"
              : p.quantity <= p.reorder_level
                ? "text-warning font-medium tabular-nums"
                : "tabular-nums"
          }
        >
          {num(p.quantity)}
        </span>
      ),
    },
    {
      key: "cost",
      header: "Cost",
      align: "right",
      render: (p) => <span className="tabular-nums">{aed(p.cost_price)}</span>,
    },
    {
      key: "value",
      header: "Stock Value",
      align: "right",
      render: (p) => (
        <span className="font-medium tabular-nums">{aed(p.stockValue)}</span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* ── KPI cards ── */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <ReportKpi
          label="Inventory Value (cost)"
          value={aed(invValue)}
          icon={<Boxes size={20} />}
          iconClass="bg-primary-100 text-ink"
          change={`${num(products.length)} SKUs`}
          changeTone="up"
          loading={loading}
        />
        <ReportKpi
          label="Retail Value"
          value={aed(retailValue)}
          icon={<Package size={20} />}
          iconClass="bg-success/15 text-success"
          change={`Margin ${aed(retailValue - invValue)}`}
          changeTone="up"
          loading={loading}
        />
        <ReportKpi
          label="Low Stock Items"
          value={num(stockBreakdown.low)}
          icon={<AlertTriangle size={20} />}
          iconClass="bg-warning/15 text-warning"
          change="At reorder level"
          changeTone={stockBreakdown.low > 0 ? "warn" : "up"}
          loading={loading}
        />
        <ReportKpi
          label="Out of Stock"
          value={num(stockBreakdown.out)}
          icon={<TrendingDown size={20} />}
          iconClass="bg-danger/15 text-danger"
          change="Zero quantity"
          changeTone={stockBreakdown.out > 0 ? "down" : "up"}
          loading={loading}
        />
      </section>

      {/* ── Category valuation chart ── */}
      <ReportBarChart
        data={byCategory.map((c) => ({ name: c.name, value: c.value }))}
        config={chartConfig}
        title="Stock value by category"
        loading={loading}
      />

      {/* ── Top products by stock value ── */}
      <ReportTable
        title="Top products by stock value"
        subtitle={`${num(topValueProducts.length)} products · total ${aed(invValue)}`}
        columns={productColumns}
        rows={topValueProducts}
        emptyMessage="No products"
        footer={
          <>
            <td colSpan={6} className="py-2.5 px-4 text-right text-sm">
              Total
            </td>
            <td className="py-2.5 px-2 text-right tabular-nums">
              {aed(topValueProducts.reduce((s, p) => s + p.stockValue, 0))}
            </td>
          </>
        }
      />
    </div>
  );
}