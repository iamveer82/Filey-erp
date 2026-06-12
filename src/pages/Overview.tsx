import { useEffect, useMemo, useRef, useState } from "react";
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
  Pencil,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  arrayMove,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useNavigate } from "react-router-dom";
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
  crm,
  quotes,
  pos,
  Product,
  Order,
  InvoiceDocSummary,
  Expense,
  PoSummary,
} from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { useUI } from "../lib/ui";
import CompanyMessages from "../components/CompanyMessages";
import ActivityFeed from "../components/ActivityFeed";
import { num, aed, fmtDate, cn } from "../lib/format";
import AiSummaryCard from "../components/AiSummaryCard";
import GettingStarted from "../components/GettingStarted";
import {
  PageHeader,
  MetricCard,
  InfoCard,
  Badge,
  OrdersStatCard,
  StockBreakdownCard,
  Skeleton,
  ErrorBanner,
} from "../components/ui";

/* ── Customizable widget dashboard ─────────────────────────────────────────
   The five data sections below are draggable, add/removable widgets; the
   chosen order + hidden set persist per-browser. */
const DASH_KEY = "filey.dashboard.layout";
const WIDGET_META: { id: string; label: string; span?: number }[] = [
  { id: "ai-summary", label: "AI briefing", span: 4 },
  { id: "total-items", label: "Total items" },
  { id: "categories", label: "Categories" },
  { id: "low-stock-kpi", label: "Low-stock count" },
  { id: "inventory-value", label: "Inventory value" },
  { id: "invoice-revenue", label: "Invoice revenue" },
  { id: "collected", label: "Collected" },
  { id: "outstanding", label: "Outstanding" },
  { id: "profit", label: "Net Profit", span: 2 },
  { id: "orders-stat", label: "Orders status" },
  { id: "orders-chart", label: "Orders over time", span: 2 },
  { id: "messages", label: "Team messages", span: 4 },
  { id: "activity", label: "Recent activity" },
  { id: "stock", label: "Stock breakdown" },
  { id: "reorder-spotlight", label: "Reorder spotlight" },
  { id: "low-stock-list", label: "Top low-stock items" },
];
const ALL_IDS: string[] = WIDGET_META.map((w) => w.id);
const DEF_SPAN: Record<string, number> = Object.fromEntries(
  WIDGET_META.map((w) => [w.id, w.span ?? 1])
);
// Each widget links to the page its data lives on (opened on click when not editing).
const WIDGET_LINK: Record<string, string> = {
  "total-items": "/inventory",
  categories: "/suppliers",
  "low-stock-kpi": "/inventory",
  "inventory-value": "/inventory",
  "invoice-revenue": "/invoicing",
  collected: "/invoicing",
  outstanding: "/invoicing",
  profit: "/invoicing",
  "orders-stat": "/orders",
  "orders-chart": "/orders",
  stock: "/inventory",
  "reorder-spotlight": "/inventory",
  "low-stock-list": "/inventory",
};
// Literal classes (so Tailwind keeps them). Grid is 2 cols on mobile, 4 on lg.
function spanClass(n: number): string {
  switch (Math.min(4, Math.max(1, n))) {
    case 4:
      return "col-span-2 lg:col-span-4";
    case 3:
      return "col-span-2 lg:col-span-3";
    case 2:
      return "col-span-2 lg:col-span-2";
    default:
      return "lg:col-span-1";
  }
}
interface WidgetStyle {
  weight?: number;
  family?: string;
  scale?: number;
  color?: string;
  bg?: string;
}
const FONTS: { label: string; value: string }[] = [
  { label: "Sans", value: "'Plus Jakarta Sans', system-ui, sans-serif" },
  { label: "Serif", value: "'Lora', Georgia, serif" },
  { label: "Mono", value: "'IBM Plex Mono', monospace" },
];
const WEIGHTS: { label: string; value: number }[] = [
  { label: "Normal", value: 400 },
  { label: "Medium", value: 500 },
  { label: "Semibold", value: 600 },
  { label: "Bold", value: 700 },
];
// Per-widget overrides as scoped CSS (!important to beat the Tailwind classes).
function widgetCss(id: string, s: WidgetStyle): string {
  const sel = `[data-widget="${id}"] .widget-content`;
  let css = "";
  if (s.color)
    css += `${sel} p,${sel} span,${sel} li,${sel} h1,${sel} h2,${sel} h3,${sel} .text-ink,${sel} [class*="text-brand"]{color:${s.color} !important}`;
  if (s.family) css += `${sel} *{font-family:${s.family} !important}`;
  if (s.weight) css += `${sel} *{font-weight:${s.weight} !important}`;
  if (s.scale && s.scale !== 1) css += `${sel} .h-full{zoom:${s.scale}}`;
  if (s.bg)
    css += `${sel} .card,${sel} [class*="rounded-2xl"]{background:${s.bg} !important;background-image:none !important}`;
  return css;
}

interface Layout {
  order: string[];
  hidden: string[];
  spans: Record<string, number>;
  heights: Record<string, number>;
  styles: Record<string, WidgetStyle>;
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
      return {
        order,
        hidden: (p.hidden ?? []).filter((id) => ALL_IDS.includes(id)),
        spans: { ...DEF_SPAN, ...(p.spans ?? {}) },
        heights: p.heights ?? {},
        styles: p.styles ?? {},
      };
    }
  } catch {
    /* ignore */
  }
  return { order: [...ALL_IDS], hidden: [], spans: { ...DEF_SPAN }, heights: {}, styles: {} };
}
function saveLayout(l: Layout) {
  try {
    localStorage.setItem(DASH_KEY, JSON.stringify(l));
  } catch {
    /* ignore */
  }
}

function WidgetItem({
  id,
  editing,
  linkable,
  spanCls,
  heightStyle,
  styleOpen,
  wstyle,
  onToggleStyle,
  onStyleChange,
  onStyleReset,
  onOpen,
  onRemove,
  onResize,
  children,
}: {
  id: string;
  editing: boolean;
  linkable: boolean;
  spanCls: string;
  heightStyle?: React.CSSProperties;
  styleOpen: boolean;
  wstyle: WidgetStyle;
  onToggleStyle: () => void;
  onStyleChange: (patch: Partial<WidgetStyle>) => void;
  onStyleReset: () => void;
  onOpen: () => void;
  onRemove: () => void;
  onResize: (e: React.PointerEvent, dir: "x" | "y" | "xy") => void;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !editing,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging || styleOpen ? 50 : undefined,
    ...(heightStyle ?? {}),
  };
  return (
    <div
      ref={setNodeRef}
      data-widget={id}
      style={style}
      onClick={() => {
        if (!editing && linkable) onOpen();
      }}
      className={`relative ${spanCls} ${
        editing
          ? "rounded-2xl ring-2 ring-dashed ring-primary-300/70"
          : linkable
          ? "cursor-pointer"
          : ""
      } ${isDragging ? "opacity-90 shadow-bento-hover" : ""}`}
    >
      {editing && (
        <div className="absolute -top-2.5 right-2 z-40 flex items-center gap-0.5 rounded-lg border border-brand-200 bg-white px-1 py-1 shadow-bento dark:border-[#3A3D45] dark:bg-[#24262C]">
          <button
            onClick={onToggleStyle}
            title="Style this widget"
            aria-label="Style widget"
            className={cn(
              "grid h-6 w-6 place-items-center rounded cursor-pointer",
              styleOpen
                ? "bg-primary-400 text-[#0A0A0A]"
                : "text-brand-400 hover:bg-brand-50 dark:hover:bg-white/10"
            )}
          >
            <Pencil size={13} />
          </button>
          <button
            {...attributes}
            {...listeners}
            title="Drag to move"
            aria-label="Drag to move"
            className="grid h-6 w-6 cursor-grab touch-none place-items-center text-brand-400 active:cursor-grabbing"
          >
            <GripVertical size={14} />
          </button>
          <button
            onClick={onRemove}
            aria-label="Remove widget"
            className="grid h-6 w-6 cursor-pointer place-items-center text-brand-400 hover:text-danger"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {editing && styleOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute right-2 top-7 z-50 w-60 rounded-xl border border-brand-200 bg-white p-3 shadow-bento-hover dark:border-[#3A3D45] dark:bg-[#24262C]"
        >
          <p className="mb-2 text-xs font-bold text-ink">Style widget</p>
          <label className="mb-1 block text-[11px] font-semibold text-brand-500">Font</label>
          <select
            className="select mb-2 h-8 text-xs"
            value={wstyle.family ?? ""}
            onChange={(e) => onStyleChange({ family: e.target.value || undefined })}
          >
            <option value="">Default</option>
            {FONTS.map((f) => (
              <option key={f.label} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <label className="mb-1 block text-[11px] font-semibold text-brand-500">Weight</label>
          <select
            className="select mb-2 h-8 text-xs"
            value={wstyle.weight ?? ""}
            onChange={(e) => onStyleChange({ weight: e.target.value ? Number(e.target.value) : undefined })}
          >
            <option value="">Default</option>
            {WEIGHTS.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </select>
          <label className="mb-1 block text-[11px] font-semibold text-brand-500">
            Text size · {Math.round((wstyle.scale ?? 1) * 100)}%
          </label>
          <input
            type="range"
            min={0.8}
            max={1.6}
            step={0.1}
            value={wstyle.scale ?? 1}
            onChange={(e) => onStyleChange({ scale: Number(e.target.value) })}
            className="mb-3 w-full accent-primary-500"
          />
          <div className="mb-3 flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-500">
              Text
              <input
                type="color"
                value={wstyle.color ?? "#0a0a0a"}
                onChange={(e) => onStyleChange({ color: e.target.value })}
                className="h-6 w-7 cursor-pointer rounded border border-brand-200 bg-transparent dark:border-[#3A3D45]"
              />
            </label>
            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-500">
              Card
              <input
                type="color"
                value={wstyle.bg ?? "#ffffff"}
                onChange={(e) => onStyleChange({ bg: e.target.value })}
                className="h-6 w-7 cursor-pointer rounded border border-brand-200 bg-transparent dark:border-[#3A3D45]"
              />
            </label>
          </div>
          <div className="flex justify-between">
            <button
              onClick={onStyleReset}
              className="cursor-pointer text-[11px] font-semibold text-brand-400 hover:text-danger"
            >
              Reset
            </button>
            <button
              onClick={onToggleStyle}
              className="cursor-pointer text-[11px] font-semibold text-primary-700"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {editing && (
        <>
          {/* width: drag the right edge */}
          <div
            onPointerDown={(e) => onResize(e, "x")}
            title="Drag to resize width"
            className="absolute right-0 top-3 bottom-3 z-30 w-2 cursor-ew-resize rounded-full hover:bg-primary-300/50"
          />
          {/* height: drag the corner */}
          <div
            onPointerDown={(e) => onResize(e, "y")}
            title="Drag corner to resize height"
            className="absolute -bottom-0.5 -right-0.5 z-40 grid h-5 w-5 cursor-ns-resize place-items-center"
          >
            <span className="h-2.5 w-2.5 rounded-sm border-b-2 border-r-2 border-primary-500" />
          </div>
        </>
      )}
      <div className="h-full overflow-auto [&>*]:h-full widget-content">{children}</div>
    </div>
  );
}

export default function Overview() {
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [invoices, setInvoices] = useState<InvoiceDocSummary[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PoSummary[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [quotations, setQuotations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [layout, setLayout] = useState<Layout>(loadLayout);
  const [styleOpenId, setStyleOpenId] = useState<string | null>(null);
  const [ordersPeriod, setOrdersPeriod] = useState<"today" | "week" | "month" | "quarter" | "year">("month");
  const nav = useNavigate();
  const { toast } = useUI();

  const updateLayout = (next: Layout) => {
    setLayout(next);
    saveLayout(next);
  };
  const removeWidget = (id: string) =>
    updateLayout({ ...layout, hidden: [...new Set([...layout.hidden, id])] });
  const addWidget = (id: string) =>
    updateLayout({ ...layout, hidden: layout.hidden.filter((h) => h !== id) });
  const effSpan = (id: string) => layout.spans[id] ?? DEF_SPAN[id] ?? 1;
  const setSpan = (id: string, n: number) =>
    updateLayout({ ...layout, spans: { ...layout.spans, [id]: Math.min(4, Math.max(1, n)) } });
  const gridRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const vis = layout.order.filter((id) => !layout.hidden.includes(id));
    const oldI = vis.indexOf(String(active.id));
    const newI = vis.indexOf(String(over.id));
    if (oldI < 0 || newI < 0) return;
    updateLayout({ ...layout, order: [...arrayMove(vis, oldI, newI), ...layout.hidden] });
  };
  const setHeight = (id: string, h: number) =>
    updateLayout({ ...layout, heights: { ...layout.heights, [id]: Math.max(96, Math.round(h)) } });
  const setStyle = (id: string, patch: Partial<WidgetStyle>) =>
    updateLayout({
      ...layout,
      styles: { ...layout.styles, [id]: { ...(layout.styles[id] ?? {}), ...patch } },
    });
  const resetStyle = (id: string) => {
    const rest = { ...layout.styles };
    delete rest[id];
    updateLayout({ ...layout, styles: rest });
  };

  // Drag an edge/corner to resize. Width snaps to grid columns (1–4); height
  // is free pixels. Direction: "x" right edge, "y" bottom edge, "xy" corner.
  const startResize = (e: React.PointerEvent, id: string, dir: "x" | "y" | "xy") => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startSpan = effSpan(id);
    const colW = (gridRef.current?.offsetWidth ?? 4) / 4 || 1;
    const el = (e.currentTarget as HTMLElement).closest("[data-widget]") as HTMLElement | null;
    const startH = layout.heights[id] ?? el?.offsetHeight ?? 200;
    let lastSpan = startSpan;
    let lastH = startH;
    const move = (ev: PointerEvent) => {
      if (dir === "x" || dir === "xy") {
        const n = Math.min(4, Math.max(1, startSpan + Math.round((ev.clientX - startX) / colW)));
        if (n !== lastSpan) {
          lastSpan = n;
          setSpan(id, n);
        }
      }
      if (dir === "y" || dir === "xy") {
        const h = Math.max(96, startH + (ev.clientY - startY));
        if (Math.abs(h - lastH) > 4) {
          lastH = h;
          setHeight(id, h);
        }
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const load = () => {
    setError("");
    return Promise.all([
      erp.products().then(setProducts),
      erp.orders().then(setOrders),
      billing.listDocs().then(setInvoices),
      fin.expenses().then(setExpenses),
      pos.list().then(setPurchaseOrders),
      crm.customers().then(setCustomers).catch((e) => toast.error("Failed to load customers: " + (e instanceof Error ? e.message : e))),
      quotes.listDocs().then(setQuotations).catch((e) => toast.error("Failed to load quotations: " + (e instanceof Error ? e.message : e))),
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

  // Real trend: orders created per time bucket based on selected period.
  const trend = useMemo(() => {
    const now = new Date();
    const buckets: { name: string; key: string; items: number }[] = [];
    const periodMs: Record<string, number> = {
      today: 24 * 3600_000,
      week: 7 * 24 * 3600_000,
      month: 30 * 24 * 3600_000,
      quarter: 91 * 24 * 3600_000,
      year: 365 * 24 * 3600_000,
    };
    const windowMs = periodMs[ordersPeriod] ?? periodMs.month;
    let numBuckets = 6;
    let bucketMs = windowMs / numBuckets;
    let labelFn: (d: Date) => string;
    let keyFn: (d: Date) => string;

    if (ordersPeriod === "today") {
      numBuckets = 24;
      bucketMs = 3600_000;
      labelFn = (d: Date) => `${d.getHours()}:00`;
      keyFn = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`;
    } else if (ordersPeriod === "week") {
      numBuckets = 7;
      bucketMs = 24 * 3600_000;
      labelFn = (d: Date) => d.toLocaleString("en", { weekday: "short" });
      keyFn = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    } else if (ordersPeriod === "month") {
      numBuckets = Math.round(30 / 7);
      bucketMs = 7 * 24 * 3600_000;
      labelFn = (d: Date) => `W${Math.ceil(d.getDate() / 7)}`;
      keyFn = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-W${Math.ceil(d.getDate() / 7)}`;
    } else if (ordersPeriod === "quarter") {
      numBuckets = 6;
      bucketMs = Math.round(windowMs / numBuckets);
      labelFn = (d: Date) => d.toLocaleString("en", { month: "short" });
      keyFn = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;
    } else {
      // year
      numBuckets = 12;
      bucketMs = Math.round(windowMs / numBuckets);
      labelFn = (d: Date) => d.toLocaleString("en", { month: "short" });
      keyFn = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;
    }

    const cutoff = now.getTime() - bucketMs * numBuckets;
    // Pre-fill buckets
    for (let i = 0; i < numBuckets; i++) {
      const d = new Date(cutoff + i * bucketMs + bucketMs / 2);
      buckets.push({ name: labelFn(d), key: keyFn(d), items: 0 });
    }
    // Assign orders by time-range index — label keys can collide across
    // period boundaries (e.g. two quarter buckets in the same month), so
    // key-based matching would silently drop counts into one bucket.
    for (const o of orders) {
      const t = new Date(o.created_at).getTime();
      const idx = Math.floor((t - cutoff) / bucketMs);
      if (idx >= 0 && idx < numBuckets) buckets[idx].items += 1;
    }
    return buckets.map(({ name, items }) => ({ name, items }));
  }, [orders, ordersPeriod]);

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

  const profit = useMemo(() => {
    const revenue = invoices
      .filter((i) => i.status !== "draft")
      .reduce((s, i) => s + (i.total || 0), 0);
    const materialCost = purchaseOrders
      .filter((po) => po.status !== "draft" && po.status !== "cancelled")
      .reduce((s, po) => s + (po.total || 0), 0);
    const expenseTotal = expenses.reduce((s, e) => s + (e.amount || 0), 0);
    const netProfit = revenue - materialCost - expenseTotal;
    return { revenue, materialCost, expenseTotal, netProfit };
  }, [invoices, purchaseOrders, expenses]);

  const visible = layout.order.filter((id) => !layout.hidden.includes(id));
  const addable = WIDGET_META.filter((w) => layout.hidden.includes(w.id));
  // First-load gate: render skeletons OR the real content, never both stacked.
  const initialLoading =
    loading && products.length === 0 && orders.length === 0 && !error;

  const renderWidget = (id: string) => {
    switch (id) {
      case "ai-summary":
        return <AiSummaryCard />;
      case "total-items":
        return <MetricCard label="Total Items" value={num(products.length)} rawValue={products.length} formatValue={num} icon={<Boxes size={20} />} iconClass="bg-primary-100 text-primary-700" />;
      case "categories":
        return <MetricCard label="Categories" value={num(suppliers)} rawValue={suppliers} formatValue={num} icon={<Users size={20} />} iconClass="bg-secondary-400/20 text-secondary-600" />;
      case "low-stock-kpi":
        return <MetricCard label="Low Stock Items" value={num(lowStock.length)} rawValue={lowStock.length} formatValue={num} icon={<AlertTriangle size={20} />} iconClass="bg-danger/15 text-danger" />;
      case "inventory-value":
        return <MetricCard label="Inventory Value" value={aed(products.reduce((s, p) => s + p.quantity * p.cost_price, 0))} rawValue={products.reduce((s, p) => s + p.quantity * p.cost_price, 0)} formatValue={aed} icon={<Wallet size={20} />} iconClass="bg-info/15 text-info" />;
      case "invoice-revenue":
        return <MetricCard label="Invoice Revenue" value={aed(invoices.filter((i) => i.status !== "draft").reduce((s, i) => s + (i.total || 0), 0))} rawValue={invoices.filter((i) => i.status !== "draft").reduce((s, i) => s + (i.total || 0), 0)} formatValue={aed} icon={<Receipt size={20} />} iconClass="bg-primary-100 text-primary-700" />;
      case "collected":
        return <MetricCard label="Collected" value={aed(invoices.filter((i) => i.status !== "draft").reduce((s, i) => s + ((i.total || 0) - (i.balance ?? 0)), 0))} rawValue={invoices.filter((i) => i.status !== "draft").reduce((s, i) => s + ((i.total || 0) - (i.balance ?? 0)), 0)} formatValue={aed} icon={<Banknote size={20} />} iconClass="bg-success/15 text-success" />;
      case "outstanding":
        return <MetricCard label="Outstanding" value={aed(invoices.filter((i) => i.status !== "draft" && i.status !== "paid").reduce((s, i) => s + (i.balance ?? 0), 0))} rawValue={invoices.filter((i) => i.status !== "draft" && i.status !== "paid").reduce((s, i) => s + (i.balance ?? 0), 0)} formatValue={aed} icon={<Clock size={20} />} iconClass="bg-danger/15 text-danger" />;
      case "profit":
        return (
          <InfoCard title="Net Profit">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-brand-500">Revenue</span>
                <span className="text-sm font-semibold text-success">{aed(profit.revenue)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-brand-500">Material costs</span>
                <span className="text-sm font-semibold text-danger">- {aed(profit.materialCost)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-brand-500">Expenses</span>
                <span className="text-sm font-semibold text-danger">- {aed(profit.expenseTotal)}</span>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-brand-200">
                <span className="text-sm font-bold text-ink">Net</span>
                <span className={`text-lg font-extrabold ${profit.netProfit >= 0 ? "text-success" : "text-danger"}`}>
                  {aed(profit.netProfit)}
                </span>
              </div>
            </div>
          </InfoCard>
        );
      case "orders-stat":
        return (
          <OrdersStatCard
            title="Orders"
            items={[
              ["Completed", orderStats.completed],
              ["In progress", orderStats.progress],
              ["Returns", orderStats.returns],
              ["Overdue", orderStats.overdue],
            ]}
          />
        );
      case "orders-chart":
        return (
          <InfoCard title="Orders over time">
            {/* Period selector pill bar */}
            <div className="flex items-center gap-1 mb-3 p-0.5 rounded-xl bg-brand-100 dark:bg-white/10 inline-flex">
              {(["today", "week", "month", "quarter", "year"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setOrdersPeriod(p)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-semibold rounded-[10px] transition-all cursor-pointer",
                    ordersPeriod === p
                      ? "bg-white text-ink shadow-sm dark:bg-[#3A3D45]"
                      : "text-brand-500 hover:text-ink"
                  )}
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
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
                  <CartesianGrid strokeDasharray="3 3" stroke="#E7E7EE" />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#9A9A9A" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: "#9A9A9A" }} axisLine={false} tickLine={false} width={40} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #E7E7EE", fontSize: 13 }} />
                  <Area type="monotone" dataKey="items" stroke="#0A0A0A" strokeWidth={2} fill="rgba(10,10,10,0.06)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </InfoCard>
        );
      case "messages":
        return <CompanyMessages />;
      case "activity":
        return (
          <InfoCard title="Recent activity">
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
        );
      case "stock":
        return (
          <StockBreakdownCard
            title="Stock"
            total={stock.total}
            items={[
              ["In stock", stock.inStock, "bg-success"],
              ["Low stock", stock.low, "bg-warning"],
              ["Out of stock", stock.out, "bg-danger"],
              ["Dead stock", stock.dead, "bg-brand-300"],
            ]}
          />
        );
      case "reorder-spotlight":
        return (
          <InfoCard
            title="Reorder spotlight"
            action={<span className="text-[11px] font-semibold text-brand-400">{lowStock.length} flagged</span>}
          >
            {lowStock[0] ? (
              <div>
                <div className="flex items-center gap-2 text-warning text-xs font-semibold"><Star size={13} /> High demand</div>
                <p className="text-lg font-bold text-ink mt-2">{lowStock[0].name}</p>
                <p className="text-sm text-brand-400 mt-0.5">{lowStock[0].category ?? "Uncategorised"} · SKU {lowStock[0].sku}</p>
                <div className="mt-4 flex items-center justify-between rounded-xl bg-brand-50 p-3 dark:bg-white/5">
                  <span className="text-xs text-brand-500">In stock</span>
                  <span className="font-bold text-ink">{lowStock[0].quantity} / reorder {lowStock[0].reorder_level}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-brand-400">All products above reorder level. Nice.</p>
            )}
          </InfoCard>
        );
      case "low-stock-list":
        return (
          <InfoCard
            title="Top low-stock items"
            action={
              <button
                onClick={() => nav("/inventory")}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-700 hover:underline cursor-pointer"
              >
                View all <ArrowUpRight size={12} />
              </button>
            }
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
                  <div className="absolute right-0 top-11 z-[60] w-52 rounded-xl border border-brand-200 bg-white p-1 shadow-bento-hover dark:border-[#3A3D45] dark:bg-[#24262C]">
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

      {!initialLoading && (
        <GettingStarted
          hasProducts={products.length > 0}
          hasInvoices={invoices.length > 0}
          hasCustomers={customers.length > 0}
          hasQuotations={quotations.length > 0}
        />
      )}

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}
      {initialLoading && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 items-start">
          {visible.map((id) => (
              <div
                key={id}
                className={spanClass(effSpan(id))}
              >
                <div className="card overflow-hidden">
                  <div className="p-5 space-y-3">
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-9 w-9 rounded-xl" />
                      <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-3 w-20" />
                        <Skeleton className="h-5 w-28" />
                      </div>
                    </div>
                    <div className="flex justify-between items-end pt-2 border-t border-brand-100 dark:border-white/5">
                      <Skeleton className="h-3 w-16" />
                      <Skeleton className="h-3 w-12" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
        </div>
      )}

      {Object.keys(layout.styles).length > 0 && (
        <style>
          {Object.entries(layout.styles)
            .map(([wid, s]) => widgetCss(wid, s))
            .join("")}
        </style>
      )}

      {!initialLoading && (
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={visible} strategy={rectSortingStrategy}>
          <div
            ref={gridRef}
            className="grid grid-cols-2 lg:grid-cols-4 gap-4 items-start"
          >
            {visible.map((id) => (
              <div
                key={id}
                className={spanClass(effSpan(id))}
              >
                <WidgetItem
                  id={id}
                  editing={editing}
                  linkable={!!WIDGET_LINK[id]}
                  spanCls=""
                  heightStyle={layout.heights[id] ? { height: layout.heights[id] } : undefined}
                  styleOpen={styleOpenId === id}
                  wstyle={layout.styles[id] ?? {}}
                  onToggleStyle={() => setStyleOpenId((cur) => (cur === id ? null : id))}
                  onStyleChange={(patch) => setStyle(id, patch)}
                  onStyleReset={() => resetStyle(id)}
                  onOpen={() => nav(WIDGET_LINK[id])}
                  onRemove={() => removeWidget(id)}
                  onResize={(e, dir) => startResize(e, id, dir)}
                >
                  {renderWidget(id)}
                </WidgetItem>
              </div>
            ))}
          </div>
        </SortableContext>
      </DndContext>
      )}

      {/* Activity Feed */}
      <div className="mt-6">
        <ActivityFeed />
      </div>
    </div>
  );
}
