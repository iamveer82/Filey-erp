import { useEffect, useMemo, useState } from "react";
import {
  Boxes,
  Users,
  AlertTriangle,
  Wallet,
  Truck,
  Star,
  ArrowUpRight,
  Receipt,
  Banknote,
  Clock,
  GripVertical,
  Plus,
  X,
  LayoutGrid,
  Check,
} from "lucide-react";
import { Reorder } from "framer-motion";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  erp,
  billing,
  fin,
  Product,
  Order,
  InvoiceDocSummary,
  Expense,
} from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import CompanyMessages from "../components/CompanyMessages";
import { num, aed, fmtDate } from "../lib/format";
import AiSummaryCard from "../components/AiSummaryCard";
import GettingStarted from "../components/GettingStarted";
import {
  PageHeader,
  MetricCard,
  InfoCard,
  Badge,
  OrdersStatCard,
  StockBreakdownCard,
  Spinner,
  ErrorBanner,
} from "../components/ui";

/* ── Customizable widget dashboard ─────────────────────────────────────────
   The five data sections below are draggable, add/removable widgets; the
   chosen order + hidden set persist per-browser. */
const DASH_KEY = "filey.dashboard.layout";
const WIDGET_META: { id: string; label: string }[] = [
  { id: "kpis", label: "Inventory KPIs" },
  { id: "invoices", label: "Invoice totals" },
  { id: "orders", label: "Orders & trend" },
  { id: "messages", label: "Team messages" },
  { id: "insights", label: "Insights" },
];
const ALL_IDS: string[] = WIDGET_META.map((w) => w.id);
interface Layout {
  order: string[];
  hidden: string[];
}
function loadLayout(): Layout {
  try {
    const raw = localStorage.getItem(DASH_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Layout;
      const order = [
        ...p.order.filter((id) => ALL_IDS.includes(id)),
        ...ALL_IDS.filter((id) => !p.order.includes(id)),
      ];
      return { order, hidden: (p.hidden ?? []).filter((id) => ALL_IDS.includes(id)) };
    }
  } catch {
    /* ignore */
  }
  return { order: [...ALL_IDS], hidden: [] };
}
function saveLayout(l: Layout) {
  try {
    localStorage.setItem(DASH_KEY, JSON.stringify(l));
  } catch {
    /* ignore */
  }
}

export default function Overview() {
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [invoices, setInvoices] = useState<InvoiceDocSummary[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [layout, setLayout] = useState<Layout>(loadLayout);

  const updateLayout = (next: Layout) => {
    setLayout(next);
    saveLayout(next);
  };
  const removeWidget = (id: string) =>
    updateLayout({ order: layout.order, hidden: [...new Set([...layout.hidden, id])] });
  const addWidget = (id: string) =>
    updateLayout({ order: layout.order, hidden: layout.hidden.filter((h) => h !== id) });

  const load = () => {
    setError("");
    return Promise.all([
      erp.products().then(setProducts),
      erp.orders().then(setOrders),
      billing.listDocs().then(setInvoices),
      fin.expenses().then(setExpenses),
    ])
      .catch((e) =>
        setError(`Could not load overview: ${e instanceof Error ? e.message : e}`)
      )
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);
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

  // Real trend: orders created per month over the last 6 months.
  const trend = useMemo(() => {
    const now = new Date();
    const buckets: { name: string; key: string; items: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({
        name: d.toLocaleString("en", { month: "short" }),
        key: `${d.getFullYear()}-${d.getMonth()}`,
        items: 0,
      });
    }
    const byKey = new Map(buckets.map((b) => [b.key, b]));
    for (const o of orders) {
      const d = new Date(o.created_at);
      const b = byKey.get(`${d.getFullYear()}-${d.getMonth()}`);
      if (b) b.items += 1;
    }
    return buckets.map(({ name, items }) => ({ name, items }));
  }, [orders]);

  const activity = useMemo(() => {
    const items: { who: string; what: string; ts: number }[] = [];
    for (const o of orders)
      items.push({
        who: "Orders",
        what: `created order ${o.order_number}${
          o.customer_name ? ` for ${o.customer_name}` : ""
        }`,
        ts: new Date(o.created_at).getTime(),
      });
    for (const i of invoices)
      items.push({
        who: "Invoicing",
        what: `${i.status === "paid" ? "paid" : "issued"} invoice ${i.number}${
          i.customer_name ? ` to ${i.customer_name}` : ""
        }`,
        ts: new Date(i.updated_at).getTime(),
      });
    for (const e of expenses)
      items.push({
        who: "Purchase",
        what: `recorded expense ${e.category}${
          e.description ? ` — ${e.description}` : ""
        }`,
        ts: new Date(e.expense_date).getTime(),
      });
    const now = Date.now();
    const since = (t: number) => {
      const s = Math.max(0, (now - t) / 1000);
      if (s < 60) return `${Math.round(s)}s ago`;
      if (s < 3600) return `${Math.round(s / 60)}m ago`;
      if (s < 86400) return `${Math.round(s / 3600)}h ago`;
      return `${Math.round(s / 86400)}d ago`;
    };
    return items
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 4)
      .map((a) => ({ who: a.who, what: a.what, when: since(a.ts) }));
  }, [orders, invoices, expenses]);

  const visible = layout.order.filter((id) => !layout.hidden.includes(id));
  const addable = WIDGET_META.filter((w) => layout.hidden.includes(w.id));

  const renderWidget = (id: string) => {
    switch (id) {
      case "kpis":
        return (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard label="Total Items" value={num(products.length)} icon={<Boxes size={20} />} iconClass="bg-primary-100 text-primary-700" />
            <MetricCard label="Categories" value={num(suppliers)} icon={<Users size={20} />} iconClass="bg-secondary-400/20 text-secondary-600" />
            <MetricCard label="Low Stock Items" value={num(lowStock.length)} icon={<AlertTriangle size={20} />} iconClass="bg-danger/15 text-danger" />
            <MetricCard label="Inventory Value" value={aed(products.reduce((s, p) => s + p.quantity * p.cost_price, 0))} icon={<Wallet size={20} />} iconClass="bg-info/15 text-info" />
          </div>
        );
      case "invoices":
        return (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <MetricCard label="Invoice Revenue" value={aed(invoices.filter((i) => i.status !== "draft").reduce((s, i) => s + (i.total || 0), 0))} icon={<Receipt size={20} />} iconClass="bg-primary-100 text-primary-700" />
            <MetricCard label="Collected" value={aed(invoices.filter((i) => i.status !== "draft").reduce((s, i) => s + ((i.total || 0) - (i.balance ?? 0)), 0))} icon={<Banknote size={20} />} iconClass="bg-success/15 text-success" />
            <MetricCard label="Outstanding" value={aed(invoices.filter((i) => i.status !== "draft" && i.status !== "paid").reduce((s, i) => s + (i.balance ?? 0), 0))} icon={<Clock size={20} />} iconClass="bg-danger/15 text-danger" />
          </div>
        );
      case "orders":
        return (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <OrdersStatCard
              title="Orders"
              items={[
                ["Completed", orderStats.completed],
                ["In progress", orderStats.progress],
                ["Returns", orderStats.returns],
                ["Overdue", orderStats.overdue],
              ]}
            />
            <InfoCard title="Orders over time" className="lg:col-span-2">
              <div className="flex items-center gap-4">
                <div className="rounded-2xl bg-brand-50 dark:bg-white/5 p-4">
                  <Truck size={28} className="text-brand-500" />
                </div>
                <div>
                  <p className="text-lg font-bold text-ink">
                    {orderStats.progress} order{orderStats.progress === 1 ? "" : "s"} in progress
                  </p>
                  <p className="text-sm text-brand-500 mt-0.5">
                    {orderStats.completed} completed · {orderStats.overdue} cancelled / overdue
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
                    <CartesianGrid strokeDasharray="3 3" stroke="#DEDBD2" />
                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#A39B8C" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: "#A39B8C" }} axisLine={false} tickLine={false} width={40} />
                    <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #DEDBD2", fontSize: 13 }} />
                    <Area type="monotone" dataKey="items" stroke="#E0AE00" strokeWidth={2.5} fill="url(#ov)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </InfoCard>
          </div>
        );
      case "messages":
        return <CompanyMessages />;
      case "insights":
        return (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4">
            <InfoCard
              title="Recent activity"
              action={<span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-700">View all <ArrowUpRight size={12} /></span>}
            >
              <ul className="space-y-3.5">
                {activity.length === 0 && <li className="text-sm text-brand-400">No activity yet.</li>}
                {activity.map((a, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="mt-1 w-2 h-2 rounded-full bg-primary-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm text-ink leading-snug"><span className="font-semibold">{a.who}</span> {a.what}</p>
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
              action={<span className="text-[11px] font-semibold text-primary-300">{lowStock.length} flagged</span>}
            >
              {lowStock[0] ? (
                <div>
                  <div className="flex items-center gap-2 text-primary-300 text-xs font-semibold"><Star size={13} /> High demand</div>
                  <p className="text-lg font-bold mt-2">{lowStock[0].name}</p>
                  <p className="text-sm text-white/60 mt-0.5">{lowStock[0].category ?? "Uncategorised"} · SKU {lowStock[0].sku}</p>
                  <div className="mt-4 flex items-center justify-between rounded-xl bg-white/10 p-3">
                    <span className="text-xs text-white/70">In stock</span>
                    <span className="font-bold">{lowStock[0].quantity} / reorder {lowStock[0].reorder_level}</span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-white/60">All products above reorder level. Nice.</p>
              )}
            </InfoCard>
            <InfoCard
              title="Top low-stock items"
              action={<span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-700">View all <ArrowUpRight size={12} /></span>}
            >
              <ul className="space-y-3">
                {(lowStock.length ? lowStock : products).slice(0, 4).map((p) => (
                  <li key={p.id} className="flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink truncate">{p.name}</p>
                      <p className="text-[11px] text-brand-400">{p.quantity} in stock · {fmtDate(p.created_at)}</p>
                    </div>
                    <Badge tone={p.quantity <= p.reorder_level ? "warn" : "success"}>{p.quantity <= p.reorder_level ? "Low" : "OK"}</Badge>
                  </li>
                ))}
                {products.length === 0 && <li className="text-sm text-brand-400">No products yet.</li>}
              </ul>
            </InfoCard>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Overview"
        subtitle="Inventory at a glance — every card answers one question"
        action={
          <div className="flex items-center gap-2">
            {editing && (
              <div className="relative">
                <button
                  className="btn-ghost"
                  onClick={() => setAddOpen((o) => !o)}
                  disabled={addable.length === 0}
                >
                  <Plus size={15} /> Add widget
                </button>
                {addOpen && addable.length > 0 && (
                  <div className="absolute right-0 top-11 z-20 w-52 rounded-xl border border-brand-200 bg-white p-1 shadow-bento-hover dark:border-[#3A3D45] dark:bg-[#24262C]">
                    {addable.map((w) => (
                      <button
                        key={w.id}
                        onClick={() => {
                          addWidget(w.id);
                          setAddOpen(false);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-brand-50 dark:hover:bg-white/5 cursor-pointer"
                      >
                        <Plus size={14} className="text-brand-400" /> {w.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button
              className={editing ? "btn-primary" : "btn-ghost"}
              onClick={() => {
                setEditing((e) => !e);
                setAddOpen(false);
              }}
            >
              {editing ? (
                <>
                  <Check size={15} /> Done
                </>
              ) : (
                <>
                  <LayoutGrid size={15} /> Customize
                </>
              )}
            </button>
          </div>
        }
      />

      <GettingStarted hasProducts={products.length > 0} hasInvoices={invoices.length > 0} />
      <AiSummaryCard />

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}
      {loading && products.length === 0 && orders.length === 0 && !error && (
        <div className="card mb-4">
          <Spinner label="Loading overview…" />
        </div>
      )}

      <Reorder.Group
        axis="y"
        values={visible}
        onReorder={(next) =>
          updateLayout({ order: [...next, ...layout.hidden], hidden: layout.hidden })
        }
        className="space-y-4"
      >
        {visible.map((id) => (
          <Reorder.Item
            key={id}
            value={id}
            drag={editing}
            dragListener={editing}
            className={
              editing
                ? "relative cursor-grab rounded-2xl ring-2 ring-dashed ring-primary-300/70 ring-offset-4 ring-offset-transparent active:cursor-grabbing"
                : "relative"
            }
          >
            {editing && (
              <div className="absolute -top-2.5 right-2 z-10 flex items-center gap-1 rounded-lg border border-brand-200 bg-white px-1.5 py-1 shadow-bento dark:border-[#3A3D45] dark:bg-[#24262C]">
                <GripVertical size={14} className="text-brand-400" />
                <button
                  onClick={() => removeWidget(id)}
                  aria-label="Remove widget"
                  className="cursor-pointer text-brand-400 hover:text-danger"
                >
                  <X size={14} />
                </button>
              </div>
            )}
            {renderWidget(id)}
          </Reorder.Item>
        ))}
      </Reorder.Group>
    </div>
  );
}
