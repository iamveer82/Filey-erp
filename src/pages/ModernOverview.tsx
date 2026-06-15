import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Receipt,
  Banknote,
  Clock,
  Truck,
  Plus,
  Sparkles,
  TrendingUp,
  PackageOpen,
  Users,
  ShoppingCart,
  FileText,
  ArrowUpRight,
  CheckCircle2,
  AlertCircle as AlertCircleIcon,
  Layout,
  Eye,
  EyeOff,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import TrendChart from "../components/TrendChart";
import {
  erp,
  fin,
  crm,
  quotes,
  pos,
  billing,
  type Product,
  type Order,
  type InvoiceDocSummary,
  type Expense,
  type CrmCustomer,
  type QuotationSummary,
  type PoSummary,
} from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { num, aed, fmtDate, cn } from "../lib/format";
import {
  MetricCard,
  InfoCard,
  Card,
  Badge,
  Skeleton,
  ErrorBanner,
  Timeline,
  TimelineItem,
} from "../components/ui";
import type { LucideIcon } from "lucide-react";
import AiSummaryCard from "../components/AiSummaryCard";

/* ── Modern Overview (preview) ─────────────────────────────────────────────
   Minimal iOS-style dashboard. NOT drag-drop. Sections are fixed and ordered:
   Hero KPIs → Orders trend + Activity → Inventory + Alerts → Money + Customers
   + AI briefing. Data loaders mirror the old Overview — no schema/API changes. */

type Period = "today" | "week" | "month" | "quarter" | "year";

const ALL_CARDS = [
  "kpis",
  "orders",
  "activity",
  "inventory",
  "attention",
  "money",
  "customers",
  "ai",
] as const;
type CardId = (typeof ALL_CARDS)[number];

const DEFAULT_VISIBLE: CardId[] = [
  "kpis",
  "orders",
  "activity",
  "inventory",
  "attention",
  "money",
  "customers",
  "ai",
];

export default function ModernOverview() {
  const nav = useNavigate();

  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [invoices, setInvoices] = useState<InvoiceDocSummary[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [quotations, setQuotations] = useState<QuotationSummary[]>([]);
  const [posList, setPosList] = useState<PoSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<Period>("month");
  const [visible, setVisible] = useState<CardId[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("dashboard.cards") || "null");
      if (
        Array.isArray(saved) &&
        saved.every((c: string) => ALL_CARDS.includes(c as CardId))
      )
        return saved as CardId[];
    } catch (e) {
      console.warn("Failed to parse dashboard card visibility", e);
    }
    return DEFAULT_VISIBLE;
  });
  const [editing, setEditing] = useState(false);

  const load = async () => {
    setError("");
    try {
      const [p, o, i, e, c, q, po] = await Promise.all([
        erp.products().catch(() => [] as Product[]),
        erp.orders().catch(() => [] as Order[]),
        billing.listDocs().catch(() => [] as InvoiceDocSummary[]),
        fin.expenses().catch(() => [] as Expense[]),
        crm.customers().catch(() => [] as CrmCustomer[]),
        quotes.listDocs().catch(() => [] as QuotationSummary[]),
        pos.list().catch(() => [] as PoSummary[]),
      ]);
      setProducts(p);
      setOrders(o);
      setInvoices(i);
      setExpenses(e);
      setCustomers(c);
      setQuotations(q);
      setPosList(po);
    } catch (err: unknown) {
      setError((err as Error)?.message || "Failed to load overview data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useLiveSync(load);

  // ── Derived metrics ────────────────────────────────────────────────────
  const lowStock = useMemo(
    () => products.filter((p) => p.quantity <= p.reorder_level),
    [products]
  );

  const stockBreakdown = useMemo(() => {
    let inStock = 0,
      out = 0,
      low = 0,
      dead = 0;
    for (const p of products) {
      if (p.quantity <= 0) out++;
      else if (p.quantity <= p.reorder_level) low++;
      else inStock++;
    }
    // Slow-moving: in stock but no reorder tracking.
    dead = products.filter((p) => p.quantity > 0 && !p.reorder_level).length;
    return { inStock, out, low, dead, total: products.length };
  }, [products]);

  const orderStats = useMemo(() => {
    const count = (statuses: string[]) =>
      orders.filter((o) => statuses.includes((o.status || "").toLowerCase())).length;
    return {
      completed: count(["completed", "done", "delivered"]),
      progress: count(["in progress", "processing", "pending", "open", "new"]),
      overdue: count(["overdue", "cancelled", "canceled"]),
      returns: count(["returned", "refunded"]),
      total: orders.length,
    };
  }, [orders]);

  const revenue = useMemo(() => {
    const issued = invoices.filter((i) => i.status !== "draft");
    const collected = issued.reduce((s, i) => s + ((i.total || 0) - (i.balance ?? 0)), 0);
    const outstanding = issued
      .filter((i) => i.status !== "paid")
      .reduce((s, i) => s + (i.balance ?? 0), 0);
    const total = issued.reduce((s, i) => s + (i.total || 0), 0);
    return { collected, outstanding, total, count: issued.length };
  }, [invoices]);

  const profit = useMemo(() => {
    // PO totals shown as an informational "commitment" line, not deducted
    // from net (material cost only known when PO line items are loaded).
    const poTotal = posList.reduce((s, p) => s + (p.total || 0), 0);
    const expenseTotal = expenses.reduce((s, e) => s + (e.amount || 0), 0);
    const net = revenue.total - expenseTotal;
    return { poTotal, expenseTotal, net };
  }, [revenue, posList, expenses]);

  // ── Trend data (orders by period) ──────────────────────────────────────
  const trend = useMemo(() => {
    const periodMs: Record<Period, number> = {
      today: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
      month: 30 * 24 * 60 * 60 * 1000,
      quarter: 90 * 24 * 60 * 60 * 1000,
      year: 365 * 24 * 60 * 60 * 1000,
    };
    const buckets = 12;
    const now = Date.now();
    const start = now - periodMs[period];
    const span = periodMs[period] / buckets;
    const series: { name: string; items: number }[] = [];
    for (let i = 0; i < buckets; i++) {
      const t = start + i * span;
      const d = new Date(t);
      let label = "";
      if (period === "today") label = `${d.getHours()}h`;
      else if (period === "week")
        label = d.toLocaleDateString(undefined, { weekday: "short" });
      else if (period === "month") label = `${d.getDate()}`;
      else if (period === "quarter") label = `${d.getDate()}/${d.getMonth() + 1}`;
      else label = d.toLocaleDateString(undefined, { month: "short" });
      series.push({ name: label, items: 0 });
    }
    for (const o of orders) {
      const ts = new Date(o.created_at).getTime();
      if (!ts || ts < start) continue;
      const idx = Math.min(buckets - 1, Math.floor((ts - start) / span));
      series[idx].items += 1;
    }
    return series;
  }, [orders, period]);

  // ── Recent activity (orders / invoices / expenses) ─────────────────────
  const activity = useMemo(() => {
    type Ev = {
      who: string;
      what: string;
      when: string;
      tone: "ok" | "warn" | "info";
      event: "order" | "invoice" | "expense";
    };
    const out: Ev[] = [];
    for (const o of orders.slice(0, 6))
      out.push({
        who: o.customer_name || "Customer",
        what: `placed order ${o.order_number}`,
        when: o.created_at,
        tone: "info",
        event: "order",
      });
    for (const i of invoices.slice(0, 6))
      out.push({
        who: i.customer_name || "Customer",
        what: `${i.status === "paid" ? "paid" : "issued"} invoice ${i.number}`,
        when: i.issue_date || i.updated_at,
        tone: i.status === "paid" ? "ok" : "warn",
        event: "invoice",
      });
    for (const e of expenses.slice(0, 4))
      out.push({
        who: e.category || "Expense",
        what: `${e.description || "expense"} ${aed(e.amount || 0)}`,
        when: e.expense_date,
        tone: "warn",
        event: "expense",
      });
    return out
      .filter((e) => e.when)
      .sort((a, b) => +new Date(b.when) - +new Date(a.when))
      .slice(0, 8);
  }, [orders, invoices, expenses]);

  const isEmpty =
    products.length === 0 &&
    orders.length === 0 &&
    invoices.length === 0 &&
    customers.length === 0;

  const show = (id: CardId) => visible.includes(id);
  const toggle = (id: CardId) => {
    setVisible((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      localStorage.setItem("dashboard.cards", JSON.stringify(next));
      return next;
    });
  };

  return (
    <div className="max-w-[1320px] mx-auto px-4 sm:px-6 py-4 space-y-4">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[28px] leading-9 font-semibold text-ink">
            Good {greeting()}, Virendra
          </h1>
          <p className="text-sm text-brand-500 mt-1">
            Here's how Green Gold Grease is moving today.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setEditing((v) => !v)}
            className={cn("chip", editing && "chip-active")}
          >
            <Layout size={15} /> {editing ? "Done" : "Edit cards"}
          </button>
          <button onClick={() => nav("/invoicing")} className="btn-primary">
            <Plus size={15} /> New invoice
          </button>
          <button onClick={() => nav("/purchase-orders")} className="btn-ghost">
            <Plus size={15} /> Purchase order
          </button>
        </div>
      </div>

      {editing && (
        <div className="rounded-2xl border border-primary-200 bg-primary-50/60 p-3 dark:bg-primary-400/10 dark:border-primary-500/20">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-ink">Visible cards</p>
            <button
              onClick={() => {
                setVisible(DEFAULT_VISIBLE);
                localStorage.setItem("dashboard.cards", JSON.stringify(DEFAULT_VISIBLE));
              }}
              className="text-xs font-medium text-brand-500 hover:text-ink"
            >
              Reset
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {ALL_CARDS.map((id) => {
              const on = visible.includes(id);
              return (
                <button
                  key={id}
                  onClick={() => toggle(id)}
                  className={cn("chip", on && "chip-active")}
                >
                  {on ? <Eye size={13} /> : <EyeOff size={13} />}
                  {id[0].toUpperCase() + id.slice(1)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {error && <ErrorBanner message={error} />}

      {show("kpis") && (
        <section
          aria-labelledby="kpi-heading"
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3"
        >
          <h2 id="kpi-heading" className="sr-only">
            Key performance indicators
          </h2>

          <KpiMetric
            loading={loading}
            label="Revenue (issued)"
            value={revenue.total}
            format={aed}
            icon={<Receipt size={18} />}
            iconClass="bg-primary-100 text-ink"
          />
          <KpiMetric
            loading={loading}
            label="Collected"
            value={revenue.collected}
            format={aed}
            icon={<Banknote size={18} />}
            iconClass="bg-success/15 text-success"
          />
          <KpiMetric
            loading={loading}
            label="Outstanding"
            value={revenue.outstanding}
            format={aed}
            icon={<Clock size={18} />}
            iconClass="bg-danger/15 text-danger"
          />
          <KpiMetric
            loading={loading}
            label="Net profit"
            value={profit.net}
            format={aed}
            icon={<TrendingUp size={18} />}
            iconClass={profit.net >= 0 ? "bg-success/15 text-success" : "bg-danger/15 text-danger"}
          />
          <KpiMetric
            loading={loading}
            label="Open orders"
            value={orderStats.progress}
            format={(n) => num(n)}
            icon={<ShoppingCart size={18} />}
            iconClass="bg-warning/15 text-warning"
          />
          <KpiMetric
            loading={loading}
            label="Products"
            value={stockBreakdown.total}
            format={(n) => num(n)}
            icon={<PackageOpen size={18} />}
            iconClass={
              stockBreakdown.low > 0 || stockBreakdown.out > 0
                ? "bg-danger/15 text-danger"
                : "bg-primary-100 text-ink"
            }
          />
        </section>
      )}

      {/* Two-column main row: orders chart + recent activity ───────────── */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <InfoCard
          className="lg:col-span-2"
          title="Orders over time"
          action={
            <div className="flex items-center gap-1 p-0.5 rounded-full bg-brand-100 dark:bg-white/10">
              {(["today", "week", "month", "quarter", "year"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={cn(
                    "px-2.5 py-1 text-[11px] font-semibold rounded-full transition-colors",
                    period === p
                      ? "bg-white text-ink shadow-sm dark:bg-[#3A3D45]"
                      : "text-brand-500 hover:text-ink"
                  )}
                >
                  {p[0].toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          }
        >
          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              <div className="flex items-baseline gap-3 mb-2">
                <span className="text-2xl font-semibold text-ink tabular-nums">
                  {orderStats.total}
                </span>
                <span className="text-sm text-brand-500">orders in window</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mb-2">
                <Badge tone="success">
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 size={10} /> {orderStats.completed} done
                  </span>
                </Badge>
                <Badge tone="warn">
                  <span className="inline-flex items-center gap-1">
                    <Clock size={10} /> {orderStats.progress} in progress
                  </span>
                </Badge>
                {orderStats.overdue > 0 && (
                  <Badge tone="danger">
                    <span className="inline-flex items-center gap-1">
                      <AlertCircleIcon size={10} /> {orderStats.overdue} overdue
                    </span>
                  </Badge>
                )}
                {orderStats.returns > 0 && (
                  <Badge tone="neutral">{orderStats.returns} returns</Badge>
                )}
              </div>
              <div className="flex-1 min-h-0">
                <TrendChart
                  data={trend.map((d) => ({ name: d.name, value: d.items }))}
                  gradientId="moFill"
                />
              </div>
            </>
          )}
        </InfoCard>

        <InfoCard title="Recent activity">
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : activity.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="grid h-10 w-10 place-items-center rounded-2xl bg-brand-50 text-brand-400 dark:bg-white/5 mb-2">
                <Sparkles size={18} />
              </div>
              <p className="text-sm font-semibold text-ink">Quiet so far</p>
              <p className="text-xs text-brand-500 mt-0.5 max-w-[28ch]">
                New orders, invoices, and expenses will appear here as they happen.
              </p>
            </div>
          ) : (
            <Timeline>
              {activity.map((a, i) => {
                const ev = a.event;
                const Icon =
                  ev === "order" ? Truck : ev === "invoice" ? Receipt : ShoppingCart;
                const status: "done" | "current" | "default" =
                  a.tone === "ok" ? "done" : a.tone === "warn" ? "current" : "default";
                return (
                  <TimelineItem
                    key={i}
                    icon={<Icon size={12} />}
                    status={status}
                    title={
                      <>
                        <span className="font-semibold">{a.who}</span>{" "}
                        <span className="text-brand-600 dark:text-brand-400">
                          {a.what}
                        </span>
                      </>
                    }
                    subtitle={fmtDate(a.when)}
                    last={i === activity.length - 1}
                  />
                );
              })}
            </Timeline>
          )}
        </InfoCard>
      </section>

      {/* Inventory at a glance + low stock list ───────────────────────── */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <InfoCard
          title="Inventory at a glance"
          action={
            <button
              onClick={() => nav("/inventory")}
              className="inline-flex items-center gap-0.5 text-xs font-semibold text-brand-500 hover:text-ink"
            >
              Open <ArrowUpRight size={12} />
            </button>
          }
        >
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <div className="space-y-3">
              <StockBar
                rows={[
                  { label: "In stock", value: stockBreakdown.inStock, tone: "bg-success" },
                  { label: "Low stock", value: stockBreakdown.low, tone: "bg-warning" },
                  { label: "Out of stock", value: stockBreakdown.out, tone: "bg-danger" },
                  { label: "Slow moving", value: stockBreakdown.dead, tone: "bg-brand-300" },
                ]}
                total={Math.max(1, stockBreakdown.total)}
              />
              <div className="grid grid-cols-3 gap-2 pt-2">
                <Mini label="SKUs" value={num(stockBreakdown.total)} />
                <Mini
                  label="Categories"
                  value={num(new Set(products.map((p) => p.category || "Unsorted")).size)}
                />
                <Mini label="Value"
                  value={aed(products.reduce((s, p) => s + p.quantity * p.cost_price, 0))}
                />
              </div>
            </div>
          )}
        </InfoCard>

        <InfoCard
          className="lg:col-span-2"
          title="Needs attention"
          action={
            <div className="flex items-center gap-2">
              {lowStock.length > 0 && <Badge tone="warn">{lowStock.length}</Badge>}
              <button
                onClick={() => nav("/inventory")}
                className="inline-flex items-center gap-0.5 text-xs font-semibold text-brand-500 hover:text-ink"
              >
                Reorder <ArrowUpRight size={12} />
              </button>
            </div>
          }
        >
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : lowStock.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-success/10 text-success mb-3">
                <CheckCircle2 size={22} />
              </div>
              <p className="text-sm font-semibold text-ink">All good</p>
              <p className="text-xs text-brand-500 mt-0.5 max-w-[28ch]">
                No products are at or below reorder level.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-brand-100 dark:divide-[#3A3D45]">
              {lowStock.slice(0, 6).map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-3 py-2.5 cursor-pointer hover:bg-brand-50 -mx-2 px-2 rounded-2xl"
                  onClick={() => nav("/inventory")}
                >
                  <div className="rounded-2xl p-1.5 bg-warning/15 text-warning shrink-0">
                    <PackageOpen size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink truncate">{p.name}</p>
                    <p className="text-[11px] text-brand-400">
                      {p.category || "Uncategorised"} · SKU {p.sku}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-base font-semibold text-ink tabular-nums">{p.quantity}</p>
                    <p className="text-[11px] text-brand-400">reorder {p.reorder_level}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </InfoCard>
      </section>

      {/* Money + Customer snapshot + AI summary ───────────────────────── */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <InfoCard title="Money this period">
          {loading ? (
            <Skeleton className="h-28 w-full" />
          ) : (
            <div className="space-y-2.5">
              <MoneyRow label="Revenue" value={revenue.total} tone="text-ink" />
              <div className="flex items-center justify-between">
                <span className="text-sm text-brand-500">PO commitments</span>
                <span className="text-sm font-semibold tabular-nums text-warning">
                  {aed(profit.poTotal)}
                </span>
              </div>
              <MoneyRow
                label="Expenses"
                value={-profit.expenseTotal}
                tone="text-danger"
              />
              {/* Composition bar — visual breakdown of where money went */}
              <div className="pt-2">
                <div className="flex h-2 rounded-full overflow-hidden bg-brand-100 dark:bg-white/5">
                  {revenue.total > 0 && (
                    <div
                      className="bg-success"
                      style={{
                        width: `${(revenue.collected / revenue.total) * 100}%`,
                      }}
                      title={`Collected: ${aed(revenue.collected)}`}
                    />
                  )}
                  {revenue.outstanding > 0 && (
                    <div
                      className="bg-warning"
                      style={{
                        width: `${(revenue.outstanding / revenue.total) * 100}%`,
                      }}
                      title={`Outstanding: ${aed(revenue.outstanding)}`}
                    />
                  )}
                  {profit.expenseTotal > 0 && (
                    <div
                      className="bg-danger"
                      style={{
                        width: `${Math.min(100, (profit.expenseTotal / Math.max(1, revenue.total)) * 100)}%`,
                      }}
                      title={`Expenses: ${aed(profit.expenseTotal)}`}
                    />
                  )}
                </div>
                <div className="flex items-center gap-3 mt-2 text-[10px] text-brand-500">
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-success" /> Collected
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-warning" /> Outstanding
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-danger" /> Expenses
                  </span>
                </div>
              </div>
              <div className="pt-2 mt-2 border-t border-brand-200 dark:border-[#3A3D45] flex items-center justify-between">
                <span className="text-sm font-semibold text-ink">Net</span>
                <span
                  className={cn(
                    "text-lg font-bold tabular-nums",
                    profit.net >= 0 ? "text-success" : "text-danger"
                  )}
                >
                  {aed(profit.net)}
                </span>
              </div>
              <p className="text-[10px] text-brand-400 leading-snug pt-1">
                Net = revenue − cash expenses. Material cost excluded.
              </p>
            </div>
          )}
        </InfoCard>

        <InfoCard title="Customer snapshot">
          {loading ? (
            <Skeleton className="h-28 w-full" />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Tile
                Icon={Users}
                label="Customers"
                value={num(customers.length)}
              />
              <Tile
                Icon={FileText}
                label="Open quotes"
                value={num(
                  quotations.filter((q) => (q.status || "").toLowerCase() !== "accepted")
                    .length
                )}
              />
              <Tile
                Icon={ShoppingCart}
                label="Open POs"
                value={num(
                  posList.filter((p) =>
                    ["open", "pending", "sent"].includes((p.status || "").toLowerCase())
                  ).length
                )}
              />
              <Tile
                Icon={Truck}
                label="In progress"
                value={num(orderStats.progress)}
              />
            </div>
          )}
        </InfoCard>

        <div className="lg:col-span-1">
          <AiSummaryCard />
        </div>
      </section>

      {isEmpty && !loading && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary-100 text-primary-700 dark:bg-primary-400/15 dark:text-primary-300 mb-4">
            <Sparkles size={26} />
          </div>
          <p className="text-base font-semibold text-ink">Fresh start</p>
          <p className="text-sm text-brand-500 mt-1 max-w-[36ch]">
            Add your first product or create an invoice to populate the dashboard.
          </p>
          <div className="mt-4 flex items-center gap-2">
            <button onClick={() => nav("/invoicing")} className="btn-primary">
              <Plus size={15} /> New invoice
            </button>
            <button onClick={() => nav("/inventory")} className="btn-ghost">
              Add product
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Small presentation helpers (use shared tokens, no card styles) ─────── */

function KpiMetric({
  loading,
  label,
  value,
  format,
  icon,
  iconClass = "bg-primary-100 text-ink",
}: {
  loading: boolean;
  label: string;
  value: number;
  format: (n: number) => string;
  icon: ReactNode;
  iconClass?: string;
}) {
  const formatted = format(value);
  if (loading) {
    return (
      <Card className="p-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-20" />
        </div>
      </Card>
    );
  }
  return <MetricCard label={label} value={formatted} icon={icon} iconClass={iconClass} />;
}

function StockBar({
  rows,
  total,
}: {
  rows: { label: string; value: number; tone: string }[];
  total: number;
}) {
  return (
    <div>
      <div className="flex h-2 rounded-full overflow-hidden bg-brand-100 dark:bg-white/5">
        {rows.map((r) =>
          r.value > 0 ? (
            <div
              key={r.label}
              className={cn(r.tone)}
              style={{ width: `${(r.value / total) * 100}%` }}
              title={`${r.label}: ${r.value}`}
            />
          ) : null
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-3">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-1.5">
            <span className={cn("w-2 h-2 rounded-full shrink-0", r.tone)} />
            <span className="text-xs text-brand-500 truncate">{r.label}</span>
            <span className="ml-auto text-xs font-semibold text-ink tabular-nums">
              {num(r.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-brand-50 dark:bg-white/5 px-3 py-2 min-w-0">
      <p className="text-xs font-medium text-brand-500">{label}</p>
      <p className="text-sm font-semibold text-ink tabular-nums mt-0.5">{value}</p>
    </div>
  );
}

function MoneyRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-brand-500">{label}</span>
      <span className={cn("text-sm font-semibold tabular-nums", tone)}>
        {value < 0 ? `- ${aed(Math.abs(value))}` : aed(value)}
      </span>
    </div>
  );
}

function Tile({ Icon, label, value }: { Icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-brand-50 dark:bg-white/5 px-3 py-2.5 min-w-0">
      <div className="flex items-center gap-1.5">
        <Icon size={14} className="text-ink" />
        <p className="text-xs font-medium text-brand-500">{label}</p>
      </div>
      <p className="text-base font-semibold text-ink tabular-nums mt-1">{value}</p>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}
