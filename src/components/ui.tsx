import {
  ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useT } from "../lib/i18n";
import {
  X,
  ArrowUpRight,
  ArrowDownRight,
  Users,
  Lock,
  Loader2,
  AlertCircle,
  Inbox,
  Check,
  Circle as CircleIcon,
  Search,
} from "lucide-react";
import { cn } from "../lib/format";
import { Card as CardPrimitive } from "./Card";

/** Design-token skeleton placeholder with shimmer animation. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("rounded-lg bg-muted animate-pulse", className)}
    />
  );
}

/** Centered spinner for loading panels. */
export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
      <Loader2 size={18} className="animate-spin" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}

/** Inline error banner — for surfacing load/save failures visibly. */
export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm font-semibold text-danger">
      <AlertCircle size={16} className="mt-px shrink-0" />
      <span>{message}</span>
    </div>
  );
}

/** Per-record sharing toggle. Private = owner-only; Shared = visible
 *  (read-only) to the whole organization. */
export function ShareToggle({
  shared,
  onToggle,
}: {
  shared?: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <button
      onClick={() => onToggle(!shared)}
      title={
        shared
          ? "Shared with your team — click to make private"
          : "Private to you — click to share with your team"
      }
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium cursor-pointer transition-colors",
        shared
          ? "bg-info/15 text-info hover:bg-info/25"
          : "bg-muted text-muted-foreground hover:bg-hover"
      )}
    >
      {shared ? <Users size={12} /> : <Lock size={12} />}
      {shared ? "Shared" : "Private"}
    </button>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  const t = useT();
  return (
    <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
      <div>
        <h1 className="text-[22px] font-semibold text-foreground tracking-tight">{t(title)}</h1>
        {subtitle && <p className="text-[13px] text-muted-foreground mt-1">{t(subtitle)}</p>}
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  );
}

/** Generic white card. Use `tone` for accent / dark variants. */
export function Card({
  children,
  className,
  hover,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  tone?: "default" | "accent" | "dark";
  hover?: boolean;
  onClick?: () => void;
}) {
  return (
    <CardPrimitive className={cn("p-5", (hover || onClick) && "cursor-pointer", className)} onClick={onClick}>
      {children}
    </CardPrimitive>
  );
}

export function Delta({
  value,
  suffix = "vs last month",
}: {
  value: number;
  suffix?: string;
}) {
  const up = value >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-semibold",
        up ? "text-success" : "text-danger"
      )}
    >
      {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
      {Math.abs(value)}%<span className="text-muted-foreground font-medium">{suffix}</span>
    </span>
  );
}

/** Glanceable KPI card — icon chip, metric, delta.
 *  Pass rawValue + formatValue for a live count-up animation when the card
 *  scrolls into view. */
/** Shrink an element's font-size until its text fits the available width, down
 *  to a floor — so a big number stays fully visible instead of truncating to an
 *  ellipsis. Re-fits when `dep` (the value) changes or the window resizes.
 *  ponytail: scrollWidth-based, no ResizeObserver — window resize covers grid reflow. */
function useFitText<T extends HTMLElement>(dep: unknown, max = 18, min = 11) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      let size = max;
      el.style.fontSize = size + "px";
      while (el.scrollWidth > el.clientWidth && size > min) {
        size -= 1;
        el.style.fontSize = size + "px";
      }
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [dep, max, min]);
  return ref;
}

export function MetricCard({
  label,
  value,
  delta,
  icon,
  iconClass = "bg-muted text-foreground",
  rawValue,
  formatValue,
  change,
  changeTone = "up",
}: {
  label: string;
  value: string;
  delta?: number;
  icon?: ReactNode;
  iconClass?: string;
  rawValue?: number;
  formatValue?: (n: number) => string;
  /** Optional change string like "+12% vs last month" */
  change?: string;
  /** Tone for the change text: up (green), down (red), warn (amber) */
  changeTone?: "up" | "down" | "warn";
}) {
  const display = rawValue !== undefined && formatValue ? formatValue(rawValue) : value;
  const numRef = useFitText<HTMLParagraphElement>(display);
  const toneClass =
    changeTone === "down"
      ? "text-danger"
      : changeTone === "warn"
        ? "text-warning"
        : "text-success";
  return (
    <CardPrimitive className="p-4 h-full transition-[border-color] duration-200 hover:border-muted-foreground/40">
      <div className="flex items-start gap-3 h-full min-h-0">
        {icon && (
          <div
            className={cn("rounded-lg p-1.5 shrink-0", iconClass)}
            style={{ width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1 flex flex-col justify-center h-full overflow-hidden">
          <p className="text-[12px] text-muted-foreground leading-4 truncate">
            {label}
          </p>
          <p
            ref={numRef}
            className="text-[22px] leading-tight font-semibold text-foreground mt-0.5 tabular-nums tracking-tight whitespace-nowrap overflow-hidden"
          >
            {display}
          </p>
          {change && (
            <p className={cn("text-[11px] font-medium mt-0.5 leading-4", toneClass)}>
              {change}
            </p>
          )}
        </div>
      </div>
      {delta !== undefined && !change && (
        <div className="mt-3">
          <Delta value={delta} />
        </div>
      )}
    </CardPrimitive>
  );
}

/** Card with a header row (title + optional action) and free body. */
export function InfoCard({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Kept for API compatibility — all tones render the quiet surface now. */
  tone?: "default" | "accent" | "dark";
}) {
  return (
    <CardPrimitive className={cn("p-4 flex flex-col", className)}>
      <div className="flex items-center justify-between mb-3">
        <p className="font-semibold text-ink text-sm">{title}</p>
        {action}
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </CardPrimitive>
  );
}

/** Back-compat: old StatCard maps onto MetricCard styling. */
export function StatCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: ReactNode;
  accent?: "brand" | "emerald";
}) {
  return (
    <div className="card">
      <div className="flex items-start justify-between">
        <div>
          <p className="stat-label">{label}</p>
          <p className="stat-value">{value}</p>
          {hint && <p className="text-xs text-brand-400 mt-1">{hint}</p>}
        </div>
        {icon && (
          <div className="rounded-xl p-2.5 bg-primary-100 text-ink">{icon}</div>
        )}
      </div>
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warn" | "danger" | "info";
}) {
  const tones = {
    neutral: "bg-muted text-muted-foreground ring-border",
    success: "bg-success/10 text-success ring-success/30",
    warn: "bg-warning/10 text-warning ring-warning/30",
    danger: "bg-danger/10 text-danger ring-danger/30",
    info: "bg-info/10 text-info ring-info/30",
  };
  return <span className={cn("pill", tones[tone])}>{children}</span>;
}

export function statusTone(
  s?: string | null
): "success" | "warn" | "danger" | "info" | "neutral" {
  const v = (s ?? "").toLowerCase();
  if (["paid", "active", "present", "delivered", "confirmed", "in stock", "accepted"].includes(v))
    return "success";
  if (["draft", "cancelled"].includes(v))
    return "neutral";
  if (["pending", "unpaid", "leave", "low", "low stock"].includes(v))
    return "warn";
  if (["inactive", "absent", "overdue", "out of stock"].includes(v))
    return "danger";
  return "info";
}

export interface BulkAction<T> {
  label: string;
  icon?: ReactNode;
  run: (selected: T[]) => Promise<void> | void;
  danger?: boolean;
}

export function DataTable<T>({
  columns,
  rows,
  empty = "No records",
  loading = false,
  rowKey,
  bulkActions,
  onRowClick,
}: {
  columns: {
    key: string;
    label: string;
    render: (row: T) => ReactNode;
    /** Provide to make the column header sortable. */
    sortValue?: (row: T) => string | number;
    /** Provide to make cells click-to-edit (inline). */
    editable?: {
      value: (row: T) => string;
      onSave: (row: T, value: string) => void | Promise<void>;
      type?: string;
    };
  }[];
  rows: T[];
  empty?: string;
  /** Show skeleton rows while the first load is in flight. */
  loading?: boolean;
  /** Stable id per row — enables multi-select + bulk actions. */
  rowKey?: (row: T) => string | number;
  bulkActions?: BulkAction<T>[];
  /** Make rows clickable (Odoo-style drill-down). Clicks on buttons,
   *  links, inputs or menus inside the row are ignored. */
  onRowClick?: (row: T) => void;
}) {
  const showSkeleton = loading && rows.length === 0;
  const selectable = !!rowKey && !!bulkActions?.length;
  const [sel, setSel] = useState<Set<string | number>>(new Set());
  const [running, setRunning] = useState(false);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [editing, setEditing] = useState<{ row: string | number; col: string } | null>(
    null
  );
  const [editVal, setEditVal] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const sortFn = sort && columns.find((c) => c.key === sort.key)?.sortValue;
  const sorted = useMemo(() => {
    if (!sortFn || !sort) return rows;
    return [...rows].sort((a, b) => {
      const av = sortFn(a);
      const bv = sortFn(b);
      if (av < bv) return -sort.dir;
      if (av > bv) return sort.dir;
      return 0;
    });
  }, [rows, sortFn, sort]);
  const toggleSort = (key: string) =>
    setSort((s) =>
      s?.key === key ? (s.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }
    );

  const keyOf = (r: T) => (rowKey ? rowKey(r) : "");
  const allChecked =
    selectable && rows.length > 0 && rows.every((r) => sel.has(keyOf(r)));
  const toggleAll = () => setSel(allChecked ? new Set() : new Set(rows.map(keyOf)));
  const toggle = (k: string | number) =>
    setSel((s) => {
      const n = new Set(s);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
  const selectedRows = rows.filter((r) => sel.has(keyOf(r)));

  const runBulk = async (a: BulkAction<T>) => {
    setRunning(true);
    try {
      await a.run(selectedRows);
      setSel(new Set());
    } finally {
      setRunning(false);
    }
  };

  const colCount = columns.length + (selectable ? 1 : 0);
  return (
    <div className="card overflow-hidden p-0">
      {selectable && sel.size > 0 && (
        <div className="sticky top-0 z-20 flex items-center gap-3 px-4 py-2.5 bg-muted/60 border-b border-border">
          <span className="text-[13px] font-semibold text-foreground">{sel.size} selected</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {bulkActions!.map((a) => (
              <button
                key={a.label}
                disabled={running}
                onClick={() => runBulk(a)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium cursor-pointer transition-colors",
                  a.danger
                    ? "text-danger hover:bg-danger/10"
                    : "text-foreground hover:bg-hover"
                )}
              >
                {a.icon}
                {a.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setSel(new Set())}
            className="ml-auto text-xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
          >
            Clear
          </button>
        </div>
      )}
      <div
        ref={scrollRef}
        className={cn(
          "overflow-x-auto"
        )}
      >
        <table className="w-full">
          <thead className="sticky top-0 z-10 bg-card">
            <tr>
              {selectable && (
                <th className="th w-10">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={allChecked}
                    onChange={toggleAll}
                    className="cursor-pointer"
                  />
                </th>
              )}
              {columns.map((c) =>
                c.sortValue ? (
                  <th key={c.key} className="th">
                    <button
                      onClick={() => toggleSort(c.key)}
                      className="inline-flex items-center gap-1 cursor-pointer hover:text-foreground"
                    >
                      {c.label}
                      <span
                        className={cn(
                          "text-xs transition-all duration-200 inline-block",
                          sort?.key === c.key
                            ? "text-foreground"
                            : "text-muted-foreground",
                          sort?.key === c.key && sort.dir === -1 && "rotate-180"
                        )}
                      >
                        {sort?.key === c.key ? "▲" : "↕"}
                      </span>
                    </button>
                  </th>
                ) : (
                  <th key={c.key} className="th">
                    {c.label}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {showSkeleton ? (
              Array.from({ length: 5 }).map((_, r) => (
                <tr key={`sk${r}`}>
                  {Array.from({ length: colCount }).map((_, c) => (
                    <td key={c} className="td">
                      <Skeleton className="h-4 w-[70%]" />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td className="td py-14" colSpan={colCount}>
                  <div className="flex flex-col items-center gap-3 text-center px-4">
                    <div className="grid h-12 w-12 place-items-center rounded-xl bg-muted">
                      <Inbox size={24} className="text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {empty ?? "Nothing here yet"}
                      </p>
                      <p className="text-[12.5px] text-muted-foreground mt-1 max-w-xs">
                        When you have records, they'll show up right here.
                      </p>
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              sorted.map((row, i) => {
                const k = selectable ? keyOf(row) : i;
                const checked = selectable && sel.has(k);
                return (
                  <tr
                    key={k}
                    onClick={
                      onRowClick
                        ? (e) => {
                            if (
                              (e.target as HTMLElement).closest(
                                "button, a, input, select, label, [role='menu'], [data-no-row-click]"
                              )
                            )
                              return;
                            onRowClick(row);
                          }
                        : undefined
                    }
                    className={cn(
                      "row-hover",
                      checked && "bg-primary-50/40",
                      onRowClick && "cursor-pointer"
                    )}
                  >
                    {selectable && (
                      <td className="td w-10">
                        <input
                          type="checkbox"
                          aria-label="Select row"
                          checked={checked}
                          onChange={() => toggle(k)}
                          className="cursor-pointer"
                        />
                      </td>
                    )}
                    {columns.map((c) => {
                      const isEditing =
                        !!c.editable && editing?.row === k && editing?.col === c.key;
                      const startEdit = (e: React.MouseEvent) => {
                        if (!c.editable) return;
                        e.stopPropagation();
                        setEditVal(c.editable.value(row));
                        setEditing({ row: k, col: c.key });
                      };
                      const commit = async () => {
                        if (!c.editable || editSaving) return;
                        setEditSaving(true);
                        try {
                          await c.editable.onSave(row, editVal);
                        } finally {
                          setEditSaving(false);
                          setEditing(null);
                        }
                      };
                      return (
                        <td key={c.key} className="td">
                          {isEditing ? (
                            <input
                              autoFocus
                              type={c.editable?.type ?? "text"}
                              value={editVal}
                              disabled={editSaving}
                              onChange={(e) => setEditVal(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              onBlur={commit}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commit();
                                else if (e.key === "Escape") setEditing(null);
                              }}
                              className="input h-8 w-full text-sm"
                            />
                          ) : c.editable ? (
                            <span
                              onClick={startEdit}
                              title="Click to edit"
                              className="-mx-1 block cursor-text rounded px-1 hover:bg-hover"
                            >
                              {c.render(row)}
                            </span>
                          ) : (
                            c.render(row)
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: "md" | "lg" | "xl" | "2xl" | "3xl" | "full";
}) {
  const widthClass = {
    md: "max-w-lg",
    lg: "max-w-2xl",
    xl: "max-w-3xl",
    "2xl": "max-w-4xl",
    "3xl": "max-w-5xl",
    full: "max-w-[95vw]",
  }[size];
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    // Move focus into the dialog on open.
    const focusables = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
    (focusables()[0] ?? dialogRef.current)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const els = focusables();
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prevFocus?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      className="materialize-scrim fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          "materialize-surface flex max-h-[90vh] w-full flex-col rounded-xl bg-card border border-border shadow-lg outline-none",
          widthClass
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-border">
          <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-hover hover:text-foreground cursor-pointer transition-colors duration-200"
          >
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>,
    document.body
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

/** Reusable form field with label, inline validation error (animated slide-in),
 *  and optional hint text. Drop-in replacement for raw label+input pairs. */
export function FormField({
  label,
  error,
  hint,
  children,
  className,
  required,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
  required?: boolean;
}) {
  return (
    <div className={cn("flex flex-col", className)}>
      <label className="label">
        {label}
        {required && <span className="text-danger ml-0.5">*</span>}
      </label>
      {children}
      {error ? (
        <p className="text-xs font-medium text-danger mt-1.5 flex items-center gap-1">
          <AlertCircle size={12} className="shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-brand-400 mt-1.5">{hint}</p>
      ) : null}
    </div>
  );
}

/* ---------- Dashboard breakdown cards (minimal theme) ---------- */

/** Quiet KPI breakdown card: stacked value/label rows on a white surface. */
export function OrdersStatCard({
  title,
  items,
}: {
  title: string;
  items: [string, number][];
}) {
  return (
    <div className="card">
      <p className="font-bold text-ink mb-4">{title}</p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        {items.map(([k, v]) => (
          <div key={k}>
            <p className="text-2xl font-bold leading-none text-ink tabular-nums">{v}</p>
            <p className="text-xs font-semibold text-brand-400 mt-1">{k}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Quiet breakdown card: dot legend + total tile on a white surface. */
export function StockBreakdownCard({
  title,
  total,
  items,
}: {
  title: string;
  total: number;
  items: [string, number, string][];
}) {
  return (
    <div className="card">
      <p className="font-bold text-ink mb-4">{title}</p>
      <div className="flex items-center gap-5">
        <ul className="flex-1 space-y-2.5">
          {items.map(([k, v, dot]) => (
            <li
              key={k}
              className="flex items-center justify-between text-sm text-brand-700"
            >
              <span className="flex items-center gap-2 font-medium">
                <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />
                {k}
              </span>
              <span className="font-bold tabular-nums">{v}</span>
            </li>
          ))}
        </ul>
        <div className="grid place-items-center rounded-xl bg-muted text-foreground w-16 h-16 shrink-0">
          <span className="text-2xl font-bold tabular-nums">{total}</span>
        </div>
      </div>
    </div>
  );
}

export { CardPrimitive as MagicCard, CardPrimitive as ShimmerButton, CardPrimitive as SpotlightCard };

/** Professional empty-state placeholder shown when a list/table is empty.
 *  Includes an icon, title, description and optional CTA button. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      {Icon && (
        <div className="mb-5 grid h-16 w-16 place-items-center rounded-xl bg-muted">
          <Icon size={32} className="text-muted-foreground" />
        </div>
      )}
      <h3 className="text-[14px] font-semibold text-foreground mb-1.5">{title}</h3>
      {description && (
        <p className="text-[12.5px] text-muted-foreground max-w-sm leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Consistent page section wrapper with optional header. */
export function PageSection({
  title,
  subtitle,
  action,
  children,
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      {(title || action) && (
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            {title && <h2 className="text-base font-bold text-ink">{title}</h2>}
            {subtitle && <p className="text-xs text-brand-400 mt-0.5">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/* ── 21st.dev-inspired primitives ──────────────────────────────────────────
   Adapted from nyxbui/timeline + reui/hextaui table filters.              */

/** Vertical timeline with status dots. Used in ModernOverview "Recent
 *  activity" + any place a chronological feed is needed. */
export type TimelineStatus = "done" | "current" | "error" | "default";

export function Timeline({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <ul className={cn("space-y-1", className)}>{children}</ul>;
}

export function TimelineItem({
  icon,
  title,
  subtitle,
  status = "default",
  meta,
  last,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  status?: TimelineStatus;
  meta?: ReactNode;
  last?: boolean;
}) {
  const dotClass: Record<TimelineStatus, string> = {
    done: "bg-success text-white border-success",
    current: "bg-primary-500 text-white border-primary-500 ring-4 ring-primary-500/15",
    error: "bg-danger text-white border-danger",
    default: "bg-card text-muted-foreground border-border",
  };
  return (
    <li className="relative flex gap-3 pb-4">
      <div className="flex flex-col items-center shrink-0">
        <div
          className={cn(
            "grid h-7 w-7 place-items-center rounded-full border-2 transition-all",
            dotClass[status]
          )}
        >
          {icon ??
            (status === "done" ? (
              <Check size={12} />
            ) : (
              <CircleIcon size={6} className="fill-current" />
            ))}
        </div>
        {!last && <div className="w-px flex-1 bg-border mt-1" />}
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-[13px] text-foreground leading-snug">{title}</p>
        {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
        {meta && <div className="mt-1.5">{meta}</div>}
      </div>
    </li>
  );
}

/** Pill-shaped filter chip with optional count. Used in table filter bars. */
export function FilterChip({
  active,
  onClick,
  children,
  count,
  tone = "neutral",
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  count?: number | string;
  tone?: "neutral" | "success" | "warn" | "danger" | "info";
}) {
  const tones: Record<string, string> = {
    neutral: active
      ? "bg-foreground text-background border-foreground"
      : "bg-card text-muted-foreground border-border hover:bg-hover",
    success: active
      ? "bg-success text-white border-success"
      : "bg-success/10 text-success border-success/20 hover:bg-success/20",
    warn: active
      ? "bg-warning text-white border-warning"
      : "bg-warning/10 text-warning border-warning/20 hover:bg-warning/20",
    danger: active
      ? "bg-danger text-white border-danger"
      : "bg-danger/10 text-danger border-danger/20 hover:bg-danger/20",
    info: active
      ? "bg-info text-white border-info"
      : "bg-info/10 text-info border-info/20 hover:bg-info/20",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors cursor-pointer",
        tones[tone]
      )}
    >
      {children}
      {count !== undefined && (
        <span
          className={cn(
            "inline-grid place-items-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold",
            active ? "bg-background/20 text-background" : "bg-muted text-muted-foreground"
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/** Numbered editor section (reference editor layout): round step badge,
 *  title/subtitle header, optional action, free body. */
export function SectionBox({
  n,
  title,
  subtitle,
  action,
  children,
}: {
  n: number;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="px-5 py-4 border-b border-border flex items-center gap-3">
        <div className="h-7 w-7 shrink-0 rounded-full bg-foreground text-background text-[13px] font-semibold grid place-items-center">
          {n}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold text-foreground">{title}</div>
          {subtitle && <div className="text-[12.5px] text-muted-foreground">{subtitle}</div>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

/** Amber-accent toggle tile (reference "Branding & finalize" controls):
 *  icon chip, label/desc, pill switch, optional expanded content. */
export function ToggleTile({
  icon: Icon,
  label,
  desc,
  active,
  onToggle,
  extra,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  desc?: string;
  active: boolean;
  onToggle: () => void;
  extra?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition-colors",
        active ? "border-primary-400 bg-primary-500/5" : "border-border"
      )}
    >
      <div className="flex items-start gap-2">
        <div
          className={cn(
            "h-8 w-8 shrink-0 rounded-md grid place-items-center",
            active ? "bg-primary-500/15 text-primary-600 dark:text-primary-400" : "bg-hover text-muted-foreground"
          )}
        >
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-foreground">{label}</div>
          {desc && <div className="text-[11.5px] text-muted-foreground">{desc}</div>}
        </div>
        <button
          type="button"
          aria-pressed={active}
          onClick={onToggle}
          className={cn(
            "h-5 w-9 shrink-0 rounded-full transition-colors cursor-pointer",
            active ? "bg-primary-400" : "bg-border"
          )}
        >
          <span
            className={cn(
              "block h-4 w-4 rounded-full bg-white shadow transition-transform",
              active ? "translate-x-4" : "translate-x-0.5"
            )}
          />
        </button>
      </div>
      {extra}
    </div>
  );
}

/** Search input with built-in clear button. */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <Search
        size={14}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-9 rounded-md border border-border bg-background pl-9 pr-9 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-muted-foreground transition-[border-color]"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 grid place-items-center h-5 w-5 rounded-full bg-muted text-muted-foreground hover:bg-hover hover:text-foreground transition-colors cursor-pointer"
          aria-label="Clear"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}
