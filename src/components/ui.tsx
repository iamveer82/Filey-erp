import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  ArrowUpRight,
  ArrowDownRight,
  SlidersHorizontal,
  Users,
  Lock,
  Loader2,
  AlertCircle,
  Inbox,
} from "lucide-react";
import { cn } from "../lib/format";
import FitText from "./FitText";

/** Design-token skeleton placeholder (no new deps). */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-lg bg-brand-100 dark:bg-white/10",
        className
      )}
    />
  );
}

/** Centered spinner for loading panels. */
export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-brand-400">
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
        "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold cursor-pointer transition-colors",
        shared
          ? "bg-info/15 text-info hover:bg-info/25"
          : "bg-brand-100 text-brand-500 hover:bg-brand-200 dark:bg-white/10 dark:text-[#B6BAC1] dark:hover:bg-white/15"
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
  return (
    <div className="flex items-end justify-between mb-6 gap-4 flex-wrap">
      <div>
        <h1 className="text-[28px] leading-9 font-bold text-ink">{title}</h1>
        {subtitle && (
          <p className="text-sm text-brand-500 mt-1">{subtitle}</p>
        )}
      </div>
      {action}
    </div>
  );
}

/** Generic white card. Use `tone` for accent / dark variants. */
export function Card({
  children,
  className,
  tone = "default",
  hover,
}: {
  children: ReactNode;
  className?: string;
  tone?: "default" | "accent" | "dark";
  hover?: boolean;
}) {
  const base =
    tone === "accent"
      ? "card-accent"
      : tone === "dark"
      ? "card-dark"
      : "card";
  return (
    <div className={cn(base, hover && "card-hover", className)}>{children}</div>
  );
}

export function Delta({ value, suffix = "vs last month" }: { value: number; suffix?: string }) {
  const up = value >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-semibold",
        up ? "text-success" : "text-danger"
      )}
    >
      {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
      {Math.abs(value)}%
      <span className="text-brand-400 font-medium">{suffix}</span>
    </span>
  );
}

/** Glanceable KPI card — icon chip, metric, delta. */
export function MetricCard({
  label,
  value,
  delta,
  icon,
  iconClass = "bg-primary-100 text-primary-700",
}: {
  label: string;
  value: string;
  delta?: number;
  icon?: ReactNode;
  iconClass?: string;
}) {
  return (
    <div className="card card-hover">
      <div className="flex items-start gap-3">
        {icon && (
          <div className={cn("rounded-xl p-2.5 shrink-0", iconClass)}>
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-xs font-semibold text-brand-500">{label}</p>
          <FitText className="font-display text-ink mt-1 tabular-nums" basePx={24}>
            {value}
          </FitText>
        </div>
      </div>
      {delta !== undefined && (
        <div className="mt-3">
          <Delta value={delta} />
        </div>
      )}
    </div>
  );
}

/** Card with a header row (title + optional action) and free body. */
export function InfoCard({
  title,
  action,
  children,
  className,
  tone = "default",
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: "default" | "accent" | "dark";
}) {
  return (
    <Card tone={tone} className={className}>
      <div className="flex items-center justify-between mb-4">
        <p
          className={cn(
            "font-display font-bold",
            tone === "dark" ? "text-white" : "text-ink"
          )}
        >
          {title}
        </p>
        {action}
      </div>
      {children}
    </Card>
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
          <div className="rounded-xl p-2.5 bg-primary-100 text-primary-700">
            {icon}
          </div>
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
    neutral: "bg-brand-100 text-brand-600 dark:bg-white/10 dark:text-[#DDE0E4]",
    success: "bg-success/15 text-success",
    warn: "bg-warning/15 text-warning",
    danger: "bg-danger/15 text-danger",
    info: "bg-info/15 text-info",
  };
  return <span className={cn("pill", tones[tone])}>{children}</span>;
}

export function statusTone(
  s: string
): "success" | "warn" | "danger" | "info" | "neutral" {
  const v = s.toLowerCase();
  if (
    ["paid", "active", "present", "delivered", "confirmed", "in stock"].includes(
      v
    )
  )
    return "success";
  if (["pending", "draft", "unpaid", "leave", "low", "low stock"].includes(v))
    return "warn";
  if (
    ["inactive", "cancelled", "absent", "overdue", "out of stock"].includes(v)
  )
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
  const toggleAll = () =>
    setSel(allChecked ? new Set() : new Set(rows.map(keyOf)));
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
        <div className="flex items-center gap-3 px-4 py-2.5 bg-primary-100 border-b border-primary-200">
          <span className="text-sm font-semibold text-primary-700">
            {sel.size} selected
          </span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {bulkActions!.map((a) => (
              <button
                key={a.label}
                disabled={running}
                onClick={() => runBulk(a)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold cursor-pointer transition-colors",
                  a.danger
                    ? "text-danger hover:bg-danger/10"
                    : "text-brand-700 hover:bg-white"
                )}
              >
                {a.icon}
                {a.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setSel(new Set())}
            className="ml-auto text-xs font-semibold text-brand-500 hover:text-ink cursor-pointer"
          >
            Clear
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
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
                      className="inline-flex items-center gap-1 cursor-pointer hover:text-ink"
                    >
                      {c.label}
                      <span className="text-[10px] text-brand-400">
                        {sort?.key === c.key ? (sort.dir === 1 ? "▲" : "▼") : "↕"}
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
                  <div className="flex flex-col items-center gap-2 text-center">
                    <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-50 dark:bg-white/5 text-brand-300">
                      <Inbox size={20} />
                    </span>
                    <p className="text-sm font-semibold text-brand-500">
                      {empty ?? "Nothing here yet"}
                    </p>
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
                    {columns.map((c) => (
                      <td key={c.key} className="td">
                        {c.render(row)}
                      </td>
                    ))}
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
  size?: "md" | "lg" | "xl" | "2xl" | "3xl";
}) {
  const widthClass = {
    md: "max-w-lg",
    lg: "max-w-2xl",
    xl: "max-w-3xl",
    "2xl": "max-w-4xl",
    "3xl": "max-w-5xl",
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          "flex max-h-[90vh] w-full flex-col rounded-2xl bg-white dark:bg-[#24262C] shadow-bento-hover outline-none",
          widthClass
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 border-b border-brand-100 dark:border-[#2A2C33] px-6 py-4">
          <h2 className="text-lg font-bold text-ink">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg p-1.5 text-brand-400 hover:bg-brand-50 hover:text-ink dark:hover:bg-white/5 dark:hover:text-[#F4F5F6] cursor-pointer transition-colors duration-200"
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

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

/* ---------- Bold dashboard cards (design.md §05) ---------- */

/** Vivid solid-yellow KPI card: stacked value/label rows + a mini
 *  bar-chart flourish, e.g. the Orders card. */
export function OrdersStatCard({
  title,
  items,
}: {
  title: string;
  items: [string, number][];
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-primary-400 text-ink p-5 shadow-bento">
      <div className="flex items-center justify-between mb-4">
        <p className="font-bold text-lg">{title}</p>
        <span className="grid place-items-center rounded-xl border border-ink/20 p-2">
          <SlidersHorizontal size={16} />
        </span>
      </div>
      <div className="relative z-10 grid grid-cols-2 gap-x-6 gap-y-4">
        {items.map(([k, v]) => (
          <div key={k}>
            <p className="text-3xl font-bold leading-none">{v}</p>
            <p className="text-xs font-semibold text-ink/60 mt-1">{k}</p>
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute bottom-4 right-4 flex items-end gap-1 h-16 opacity-30">
        {[40, 65, 30, 80, 55, 95].map((h, i) => (
          <span
            key={i}
            className="w-2.5 rounded-sm bg-ink"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
    </div>
  );
}

/** Vivid orange breakdown card: dot legend + a big number badge and a
 *  soft decorative pattern, e.g. the Stock card. */
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
    <div
      className="relative overflow-hidden rounded-2xl p-5 text-white shadow-bento"
      style={{
        background: "linear-gradient(135deg,#FFB23D 0%,#F2691E 100%)",
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            "radial-gradient(currentColor 1.5px, transparent 1.5px)",
          backgroundSize: "14px 14px",
          color: "#7a2f06",
        }}
      />
      <div className="relative flex items-center justify-between mb-4">
        <p className="font-bold text-lg">{title}</p>
        <span className="grid place-items-center rounded-xl border border-white/30 p-2">
          <SlidersHorizontal size={16} />
        </span>
      </div>
      <div className="relative flex items-center gap-5">
        <ul className="flex-1 space-y-2.5">
          {items.map(([k, v, dot]) => (
            <li
              key={k}
              className="flex items-center justify-between text-sm"
            >
              <span className="flex items-center gap-2 font-medium">
                <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />
                {k}
              </span>
              <span className="font-bold">{v}</span>
            </li>
          ))}
        </ul>
        <div className="grid place-items-center rounded-2xl bg-primary-400 text-ink w-16 h-16 shrink-0 shadow-bento">
          <span className="text-2xl font-bold">{total}</span>
        </div>
      </div>
    </div>
  );
}
