import { useEffect, useMemo, useState } from "react";
import { PackageOpen } from "lucide-react";
import { erp, type Product } from "@shared/api";
import { aed, num } from "@shared/format";
import { Screen, MetricCard, ListRow, SearchHeader, EmptyState, Loading } from "@mobile/components/ui";

export default function Inventory() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    erp
      .products()
      .then(setProducts)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return products;
    return products.filter((p) =>
      `${p.name} ${p.sku || ""} ${p.category || ""}`.toLowerCase().includes(n)
    );
  }, [products, q]);

  const value = products.reduce(
    (s, p) => s + (Number(p.quantity) || 0) * (Number(p.cost_price) || 0),
    0
  );
  const low = products.filter((p) => p.quantity <= p.reorder_level && p.quantity > 0).length;
  const out = products.filter((p) => p.quantity <= 0).length;

  const stockState = (p: Product) =>
    p.quantity <= 0 ? "out" : p.quantity <= p.reorder_level ? "low" : "in";

  return (
    <Screen title="Inventory" subtitle={`${num(products.length)} products`}>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <MetricCard label="SKUs" value={num(products.length)} />
          <MetricCard
            label="Stock value"
            value={aed(value)}
            change="At cost"
          />
          <MetricCard
            label="Low/Out"
            value={num(low + out)}
            change={low + out > 0 ? "Needs reorder" : "All good"}
            tone={low + out > 0 ? "warn" : "up"}
          />
        </div>

        <SearchHeader value={q} onChange={setQ} placeholder="Search name, SKU, category…" />

        {loading ? (
          <Loading />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<PackageOpen size={22} />}
            title={products.length === 0 ? "No products yet" : "No matches"}
            hint={products.length === 0 ? "Add products from the desktop app to see them here." : undefined}
          />
        ) : (
          <div className="space-y-2">
            {filtered.map((p) => {
              const st = stockState(p);
              const stateLabel =
                st === "out" ? "Out of stock" : st === "low" ? "Low stock" : `${p.quantity} in stock`;
              return (
                <ListRow
                  key={p.id}
                  title={p.name}
                  subtitle={`${p.sku || "—"}${p.category ? ` · ${p.category}` : ""} · ${stateLabel}`}
                  amount={aed((Number(p.quantity) || 0) * (Number(p.cost_price) || 0))}
                  status={st === "out" ? "failed" : st === "low" ? "sent" : "paid"}
                  onClick={undefined}
                />
              );
            })}
          </div>
        )}
      </div>
    </Screen>
  );
}
