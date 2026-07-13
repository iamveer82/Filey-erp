import { useEffect, useMemo, useState } from "react";
import { Plus, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
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
import { num, aed, cn } from "../lib/format";
import {
  Card,
  Skeleton,
  ErrorBanner,
} from "../components/ui";

/* ── Modern Overview (preview) ─────────────────────────────────────────────
   Minimal iOS-style dashboard. NOT drag-drop. Sections are fixed and ordered:
   Hero KPIs → Orders trend + Activity → Inventory + Alerts → Money + Customers
   + AI briefing. Data loaders mirror the old Overview — no schema/API changes. */

type Period = "today" | "week" | "month" | "quarter" | "year";

export default function ModernOverview() {
  const nav = useNavigate();

  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [invoices, setInvoices] = useState<InvoiceDocSummary[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [quotations, setQuotations] = useState<QuotationSummary[]>([]);
  const [posList, setPosList] = useState<PoSummary[]>([]);
  const [poPayments, setPoPayments] = useState<{ po_id: number; amount: number }[]>([]);
  const [companyName, setCompanyName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [period] = useState<Period>("year");

  const load = async () => {
    setError("");
    try {
      const [p, o, i, e, c, q, po, comp, poPays] = await Promise.all([
        erp.products().catch(() => [] as Product[]),
        erp.orders().catch(() => [] as Order[]),
        billing.listDocs().catch(() => [] as InvoiceDocSummary[]),
        fin.expenses().catch(() => [] as Expense[]),
        crm.customers().catch(() => [] as CrmCustomer[]),
        quotes.listDocs().catch(() => [] as QuotationSummary[]),
        pos.list().catch(() => [] as PoSummary[]),
        billing.getCompany().catch(() => null),
        pos.allPayments().catch(() => [] as { po_id: number; amount: number }[]),
      ]);
      setProducts(p);
      setOrders(o);
      setInvoices(i);
      setExpenses(e);
      setCustomers(c);
      setQuotations(q);
      setPosList(po);
      setPoPayments(poPays);
      setCompanyName((comp as { name?: string } | null)?.name || "");
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

  // Vyapar-style receivable/payable: who owes you (unpaid invoice balances,
  // per party) and what you owe suppliers (PO totals minus payments made).
  const receivable = useMemo(() => {
    const parties = new Set<string>();
    let total = 0;
    for (const i of invoices) {
      if (i.status === "draft" || i.status === "paid") continue;
      const bal = i.balance ?? 0;
      if (bal <= 0) continue;
      total += bal;
      parties.add((i.customer_name || "").trim().toLowerCase());
    }
    return { total, parties: parties.size };
  }, [invoices]);

  const payable = useMemo(() => {
    const paidByPo = new Map<number, number>();
    for (const p of poPayments)
      paidByPo.set(p.po_id, (paidByPo.get(p.po_id) || 0) + p.amount);
    const parties = new Set<string>();
    let total = 0;
    for (const po of posList) {
      const s = (po.status || "").toLowerCase();
      if (["draft", "cancelled", "canceled"].includes(s)) continue;
      const due = Math.max(0, (po.total || 0) - (paidByPo.get(po.id) || 0));
      if (due <= 0) continue;
      total += due;
      parties.add((po.supplier_name || "").trim().toLowerCase());
    }
    return { total, parties: parties.size };
  }, [posList, poPayments]);

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

  // Suppress unused computed values (kept for data loading side-effects)
  void receivable; void payable; void profit; void activity;

  const isEmpty =
    products.length === 0 &&
    orders.length === 0 &&
    invoices.length === 0 &&
    customers.length === 0 &&
    quotations.length === 0;

  return (
    <div className="max-w-[1320px] mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-[15px] font-semibold text-ink">
          Welcome back, {companyName || "your business"}
        </h1>
        <div className="flex items-center gap-1.5 text-xs text-success">
          <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
          Live
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {/* ── 4 KPI Cards (2×2 grid like website) ── */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SimpleKpi
          loading={loading}
          label="Total Items"
          value={num(stockBreakdown.total)}
          change={`+${num(orders.length)} orders`}
          changeTone="up"
        />
        <SimpleKpi
          loading={loading}
          label="Inventory Value"
          value={aed(products.reduce((s, p) => s + p.quantity * p.cost_price, 0))}
          change={`${num(products.length)} products`}
          changeTone="up"
        />
        <SimpleKpi
          loading={loading}
          label="Open Orders"
          value={num(orderStats.progress + orderStats.completed)}
          change={`${orderStats.overdue > 0 ? `${orderStats.overdue} overdue` : "On track"}`}
          changeTone={orderStats.overdue > 0 ? "down" : "up"}
        />
        <SimpleKpi
          loading={loading}
          label="Overdue"
          value={num(lowStock.length)}
          change={lowStock.length > 0 ? "Need attention" : "All good"}
          changeTone={lowStock.length > 0 ? "down" : "up"}
        />
      </section>

      {/* ── Monthly Revenue Bar Chart (website style) ── */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-brand-500">Monthly Revenue</span>
          <span className="text-xs font-semibold text-[#FFD600]">2026</span>
        </div>
        {loading ? (
          <Skeleton className="h-[120px] w-full" />
        ) : (
          <>
            {/* Yellow bars */}
            <div className="flex items-end gap-1 h-[120px]">
              {trend.map((d, i) => {
                const max = Math.max(1, ...trend.map((t) => t.items));
                const h = (d.items / max) * 100;
                const isPeak = d.items === Math.max(...trend.map((t) => t.items));
                return (
                  <div
                    key={i}
                    className="flex-1 rounded-t-[4px] transition-all duration-200 ease-out hover:!opacity-100 hover:scale-y-105 origin-bottom min-h-[8px] cursor-pointer"
                    style={{
                      height: `${Math.max(8, h)}%`,
                      backgroundColor: "#FFD600",
                      opacity: isPeak ? 1 : 0.75,
                    }}
                    title={`${d.name}: ${d.items} orders`}
                  />
                );
              })}
            </div>
            {/* Month axis */}
            <div className="flex justify-between mt-2 text-[10px] text-brand-400">
              {trend.filter((_, i) => i % Math.ceil(trend.length / 6) === 0).map((d, i) => (
                <span key={i}>{d.name}</span>
              ))}
            </div>
          </>
        )}
      </Card>

      {/* ── Empty state ── */}
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

/* ── Small presentation helpers ─── */

function SimpleKpi({
  loading,
  label,
  value,
  change,
  changeTone = "up",
}: {
  loading: boolean;
  label: string;
  value: string;
  change?: string;
  changeTone?: "up" | "down" | "warn";
}) {
  if (loading) {
    return (
      <Card className="p-4">
        <Skeleton className="h-3 w-20 mb-2" />
        <Skeleton className="h-7 w-24 mb-1" />
        <Skeleton className="h-3 w-16" />
      </Card>
    );
  }
  return (
    <Card className="p-4">
      <p className="text-xs text-brand-500 mb-1.5">{label}</p>
      <p className="text-[24px] font-bold text-ink tabular-nums tracking-tight leading-tight">
        {value}
      </p>
      {change && (
        <p
          className={cn(
            "text-xs font-medium mt-1",
            changeTone === "up" && "text-success",
            changeTone === "down" && "text-danger",
            changeTone === "warn" && "text-warning"
          )}
        >
          {change}
        </p>
      )}
    </Card>
  );
}

// Unused helpers removed — dashboard is now minimal (KPI cards + bar chart only)
