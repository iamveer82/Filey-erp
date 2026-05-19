import { useEffect, useMemo, useState } from "react";
import { Users, Boxes, AlertTriangle, Package } from "lucide-react";
import { erp, Product } from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { aed, num } from "../lib/format";
import { PageHeader, MetricCard, Card, Badge } from "../components/ui";

interface Group {
  name: string;
  skus: number;
  value: number;
  low: number;
}

export default function Suppliers() {
  const [products, setProducts] = useState<Product[]>([]);

  const load = () =>
    erp.products().then(setProducts).catch(console.error);
  useEffect(() => {
    load();
  }, []);
  useLiveSync(load);

  const groups = useMemo<Group[]>(() => {
    const m = new Map<string, Group>();
    for (const p of products) {
      const key = p.category || "Unsorted";
      const g =
        m.get(key) ?? { name: key, skus: 0, value: 0, low: 0 };
      g.skus += 1;
      g.value += p.quantity * p.cost_price;
      if (p.quantity <= p.reorder_level) g.low += 1;
      m.set(key, g);
    }
    return Array.from(m.values()).sort((a, b) => b.value - a.value);
  }, [products]);

  const totalValue = groups.reduce((s, g) => s + g.value, 0);
  const totalLow = groups.reduce((s, g) => s + g.low, 0);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Suppliers"
        subtitle="Supply groups & sourcing performance"
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <MetricCard
          label="Supply Groups"
          value={num(groups.length)}
          icon={<Users size={20} />}
        />
        <MetricCard
          label="Sourced SKUs"
          value={num(products.length)}
          icon={<Boxes size={20} />}
          iconClass="bg-secondary-400/20 text-secondary-600"
        />
        <MetricCard
          label="Sourcing Value"
          value={aed(totalValue)}
          icon={<Package size={20} />}
          iconClass="bg-info/15 text-info"
        />
        <MetricCard
          label="At Reorder"
          value={num(totalLow)}
          icon={<AlertTriangle size={20} />}
          iconClass="bg-danger/15 text-danger"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {groups.map((g) => (
          <Card key={g.name} hover className="flex flex-col gap-4">
            <div className="flex items-start justify-between">
              <div className="rounded-2xl bg-primary-100 text-primary-700 p-3">
                <Package size={22} />
              </div>
              {g.low > 0 ? (
                <Badge tone="warn">{g.low} low</Badge>
              ) : (
                <Badge tone="success">healthy</Badge>
              )}
            </div>
            <div>
              <p className="text-lg font-bold text-ink">{g.name}</p>
              <p className="text-sm text-brand-500 mt-0.5">
                {g.skus} SKU{g.skus === 1 ? "" : "s"} sourced
              </p>
            </div>
            <div className="mt-auto pt-3 border-t border-brand-100 flex items-center justify-between">
              <span className="text-xs font-semibold text-brand-400">
                Sourcing value
              </span>
              <span className="text-sm font-bold text-ink">
                {aed(g.value)}
              </span>
            </div>
          </Card>
        ))}
        {groups.length === 0 && (
          <Card className="col-span-full text-center text-sm text-brand-400">
            No supplier groups yet — add products with categories to see
            sourcing performance.
          </Card>
        )}
      </div>
    </div>
  );
}
