import { useEffect, useMemo, useState } from "react";
import {
  Boxes,
  Users,
  AlertTriangle,
  Wallet,
  Truck,
  Star,
  ArrowUpRight,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { erp, Product, Order } from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { num, aed, fmtDate } from "../lib/format";
import {
  PageHeader,
  MetricCard,
  InfoCard,
  Badge,
  OrdersStatCard,
  StockBreakdownCard,
} from "../components/ui";

export default function Overview() {
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);

  const load = () => {
    erp.products().then(setProducts).catch(console.error);
    erp.orders().then(setOrders).catch(console.error);
  };
  useEffect(load, []);
  useLiveSync(load);

  const lowStock = useMemo(
    () => products.filter((p) => p.quantity <= p.reorder_level),
    [products]
  );
  const suppliers = useMemo(
    () => new Set(products.map((p) => p.category || "Unsorted")).size,
    [products]
  );
  const stock = useMemo(() => {
    let inStock = 0,
      out = 0,
      low = 0,
      dead = 0;
    for (const p of products) {
      if (p.quantity === 0) out++;
      else if (p.quantity <= p.reorder_level) low++;
      else if (p.quantity > p.reorder_level * 6) dead++;
      else inStock++;
    }
    return { inStock, out, low, dead, total: products.length };
  }, [products]);

  const orderStats = useMemo(() => {
    const by = (s: string[]) =>
      orders.filter((o) => s.includes(o.status.toLowerCase())).length;
    return {
      completed: by(["delivered", "paid", "completed"]),
      progress: by(["confirmed", "draft", "processing"]),
      returns: by(["returned"]),
      overdue: by(["overdue", "cancelled"]),
    };
  }, [orders]);

  const trend = useMemo(() => {
    const days = ["Apr 1", "Apr 8", "Apr 15", "Apr 22", "Apr 29"];
    const base = products.length || 12;
    return days.map((d, i) => ({
      name: d,
      items: Math.round(base * (0.8 + i * 0.12) * 100),
    }));
  }, [products]);

  const activity = [
    { who: "Sarah Johnson", what: "added 24 items to inventory", when: "2m ago" },
    { who: "You", what: "created a quote for Acme Corp", when: "15m ago" },
    { who: "System", what: "new order #ORD-1245 received", when: "1h ago" },
    { who: "Mark Wilson", what: "updated stock for Jaunt 360", when: "2h ago" },
  ];

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Overview"
        subtitle="Inventory at a glance — every card answers one question"
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <MetricCard
          label="Total Items"
          value={num(products.length)}
          delta={12.5}
          icon={<Boxes size={20} />}
          iconClass="bg-primary-100 text-primary-700"
        />
        <MetricCard
          label="Total Suppliers"
          value={num(suppliers)}
          delta={8.2}
          icon={<Users size={20} />}
          iconClass="bg-secondary-400/20 text-secondary-600"
        />
        <MetricCard
          label="Low Stock Items"
          value={num(lowStock.length)}
          delta={3.7}
          icon={<AlertTriangle size={20} />}
          iconClass="bg-danger/15 text-danger"
        />
        <MetricCard
          label="Inventory Value"
          value={aed(
            products.reduce(
              (s, p) => s + p.quantity * p.cost_price,
              0
            )
          )}
          icon={<Wallet size={20} />}
          iconClass="bg-info/15 text-info"
        />
      </div>

      {/* Middle row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <OrdersStatCard
          title="Orders"
          items={[
            ["Completed", orderStats.completed],
            ["In progress", orderStats.progress],
            ["Returns", orderStats.returns],
            ["Overdue", orderStats.overdue],
          ]}
        />

        <InfoCard
          title="Delivery status"
          className="lg:col-span-2"
          action={<Badge tone="warn">Live</Badge>}
        >
          <div className="flex items-center gap-4">
            <div className="rounded-2xl bg-brand-50 p-4">
              <Truck size={28} className="text-brand-500" />
            </div>
            <div>
              <p className="text-lg font-bold text-ink">
                {orderStats.progress} shipments in transit
              </p>
              <p className="text-sm text-brand-500 mt-0.5">
                Avg. delay +2d on {orderStats.overdue} routes — carrier capacity
                constrained this week.
              </p>
            </div>
          </div>
          <div className="h-40 mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend}>
                <defs>
                  <linearGradient id="ov" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FFD600" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#FFD600" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E4DAC6" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 12, fill: "#A89F8C" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: "#A89F8C" }}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid #E4DAC6",
                    fontSize: 13,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="items"
                  stroke="#E0AE00"
                  strokeWidth={2.5}
                  fill="url(#ov)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </InfoCard>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4">
        <InfoCard
          title="Recent activity"
          action={
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-700">
              View all <ArrowUpRight size={12} />
            </span>
          }
        >
          <ul className="space-y-3.5">
            {activity.map((a, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-1 w-2 h-2 rounded-full bg-primary-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm text-ink leading-snug">
                    <span className="font-semibold">{a.who}</span> {a.what}
                  </p>
                  <p className="text-[11px] text-brand-400 mt-0.5">{a.when}</p>
                </div>
              </li>
            ))}
          </ul>
        </InfoCard>

        <StockBreakdownCard
          title="Stock"
          total={stock.total}
          items={[
            ["In stock", stock.inStock, "bg-emerald-300"],
            ["Low stock", stock.low, "bg-primary-400"],
            ["Out of stock", stock.out, "bg-white"],
            ["Dead stock", stock.dead, "bg-ink/40"],
          ]}
        />

        <InfoCard
          title="Reorder spotlight"
          tone="dark"
          action={
            <span className="text-[11px] font-semibold text-primary-300">
              {lowStock.length} flagged
            </span>
          }
        >
          {lowStock[0] ? (
            <div>
              <div className="flex items-center gap-2 text-primary-300 text-xs font-semibold">
                <Star size={13} /> High demand
              </div>
              <p className="text-lg font-bold mt-2">{lowStock[0].name}</p>
              <p className="text-sm text-white/60 mt-0.5">
                {lowStock[0].category ?? "Uncategorised"} · SKU{" "}
                {lowStock[0].sku}
              </p>
              <div className="mt-4 flex items-center justify-between rounded-xl bg-white/10 p-3">
                <span className="text-xs text-white/70">In stock</span>
                <span className="font-bold">
                  {lowStock[0].quantity} / reorder {lowStock[0].reorder_level}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-white/60">
              All products above reorder level. Nice.
            </p>
          )}
        </InfoCard>

        <InfoCard
          title="Top low-stock items"
          action={
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-700">
              View all <ArrowUpRight size={12} />
            </span>
          }
        >
          <ul className="space-y-3">
            {(lowStock.length ? lowStock : products)
              .slice(0, 4)
              .map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink truncate">
                      {p.name}
                    </p>
                    <p className="text-[11px] text-brand-400">
                      {p.quantity} in stock · {fmtDate(p.created_at)}
                    </p>
                  </div>
                  <Badge
                    tone={p.quantity <= p.reorder_level ? "warn" : "success"}
                  >
                    {p.quantity <= p.reorder_level ? "Low" : "OK"}
                  </Badge>
                </li>
              ))}
            {products.length === 0 && (
              <li className="text-sm text-brand-400">No products yet.</li>
            )}
          </ul>
        </InfoCard>
      </div>
    </div>
  );
}
