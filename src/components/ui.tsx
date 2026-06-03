import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useInView, animate } from "framer-motion";
import {
  X,
  ArrowUpRight,
  ArrowDownRight,
  SlidersHorizontal,
  Users,
  Lock,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { cn } from "../lib/format";
import FitText from "./FitText";
import { SpotlightCard } from "./SpotlightCard";
import { MagicCard } from "./MagicCard";
import { ShimmerButton } from "./ShimmerButton";

/** Design-token skeleton placeholder with shimmer animation. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg bg-brand-100 dark:bg-white/10",
        className
      )}
    >
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.8s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent dark:via-white/8" />
    </div>
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
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 100, damping: 20 }}
      className="flex items-end justify-between mb-6 gap-4 flex-wrap"
    >
      <div>
        <h1 className="text-[28px] leading-9 font-bold text-ink">{title}</h1>
        {subtitle && (
          <p className="text-sm text-brand-500 mt-1">{subtitle}</p>
        )}
      </div>
      {action}
    </motion.div>
  );
}

/** Generic white card. Use `tone` for accent / dark variants. */
export function Card({
  children,
  className,
  hover,
}: {
  children: ReactNode;
  className?: string;
  tone?: "default" | "accent" | "dark";
  hover?: boolean;
}) {
  return (
    <MagicCard className={cn(hover && "cursor-pointer", className)}>
      <div className="p-5">{children}</div>
    </MagicCard>
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

/** Glanceable KPI card — icon chip, metric, delta.
 *  Pass rawValue + formatValue for a live count-up animation when the card
 *  scrolls into view. */
export function MetricCard({
  label,
  value,
  delta,
  icon,
  iconClass = "bg-primary-100 text-primary-700",
  rawValue,
  formatValue,
}: {
  label: string;
  value: string;
  delta?: number;
  icon?: ReactNode;
  iconClass?: string;
  rawValue?: number;
  formatValue?: (n: number) => string;
}) {
  const nodeRef = useRef<HTMLSpanElement>(null);
  const inView = useInView(nodeRef, { once: true, margin: "-40px" });

  useEffect(() => {
    if (!inView || rawValue === undefined || !formatValue) return;
    const controls = animate(0, rawValue, {
      duration: 1.0,
      ease: [0.2, 0, 0.2, 1],
      onUpdate(v) {
        if (nodeRef.current) {
          nodeRef.current.textContent = formatValue(Math.round(v));
        }
      },
    });
    return () => controls.stop();
  }, [inView, rawValue, formatValue]);

  const animated = rawValue !== undefined && formatValue !== undefined;

  return (
    <SpotlightCard>
      <div className="p-5">
        <div className="flex items-start gap-3">
          {icon && (
            <motion.div
              whileHover={{ scale: 1.08, rotate: 3 }}
              transition={{ type: "spring", stiffness: 300 }}
              className={cn("rounded-xl p-2.5 shrink-0", iconClass)}
            >
              {icon}
            </motion.div>
          )}
          <div className="min-w-0">
            <p className="text-xs font-semibold text-brand-500">{label}</p>
            {animated ? (
              <span
                ref={nodeRef}
                className="font-display text-ink mt-1 tabular-nums block"
                style={{ fontSize: 24, lineHeight: 1.15, whiteSpace: "nowrap", fontWeight: 700 }}
              >
                {value}
              </span>
            ) : (
              <FitText className="font-display text-ink mt-1 tabular-nums" basePx={24}>
                {value}
              </FitText>
            )}
          </div>
        </div>
        {delta !== undefined && (
          <div className="mt-3">
            <Delta value={delta} />
          </div>
        )}
      </div>
    </SpotlightCard>
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
    <SpotlightCard className={className}>
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <p className={cn("font-display font-bold", tone === "dark" ? "text-white" : "text-ink")}>
            {title}
          </p>
          {action}
        </div>
        {children}
      </div>
    </SpotlightCard>
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
  const [editing, setEditing] = useState<{ row: string | number; col: string } | null>(null);
  const [editVal, setEditVal] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

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

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setScrolled(el.scrollTop > 0);
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

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
      <AnimatePresence>
        {selectable && sel.size > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 350, damping: 32 }}
            className="sticky top-0 z-20 flex items-center gap-3 px-4 py-2.5 bg-primary-100 border-b border-primary-200 shadow-md overflow-hidden"
          >
            <motion.span
              initial={{ x: -12, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.05 }}
              className="text-sm font-semibold text-primary-700"
            >
              {sel.size} selected
            </motion.span>
            <motion.div
              initial={{ x: -12, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="flex items-center gap-1.5 flex-wrap"
            >
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
            </motion.div>
            <motion.button
              initial={{ x: -12, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.15 }}
              onClick={() => setSel(new Set())}
              className="ml-auto text-xs font-semibold text-brand-500 hover:text-ink cursor-pointer"
            >
              Clear
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
      <div
        ref={scrollRef}
        className={cn(
          "overflow-x-auto",
          scrolled && "shadow-[0_2px_8px_rgba(0,0,0,0.08)] dark:shadow-[0_2px_8px_rgba(0,0,0,0.3)]"
        )}
      >
        <table className="w-full">
          <thead className="sticky top-0 z-10 bg-white dark:bg-[#1A1B1E] backdrop-blur-sm">          
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
                      <span
                        className={cn(
                          "text-[10px] transition-all duration-200 inline-block",
                          sort?.key === c.key
                            ? "text-ink dark:text-[#F4F5F6]"
                            : "text-brand-400",
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
                    <svg
                      width="120"
                      height="90"
                      viewBox="0 0 120 90"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      className="opacity-70"
                    >
                      <rect x="18" y="4" width="84" height="58" rx="6" fill="#FFF3C4" stroke="#E0AE00" strokeWidth="1.5" />
                      <rect x="28" y="14" width="48" height="4" rx="2" fill="#E0AE00" opacity="0.5" />
                      <rect x="28" y="24" width="64" height="3" rx="1.5" fill="#D4D4D8" />
                      <rect x="28" y="32" width="52" height="3" rx="1.5" fill="#D4D4D8" />
                      <rect x="28" y="40" width="40" height="3" rx="1.5" fill="#D4D4D8" />
                      <rect x="28" y="48" width="56" height="3" rx="1.5" fill="#D4D4D8" />
                      <circle cx="60" cy="78" r="8" fill="#FFFBEB" stroke="#E0AE00" strokeWidth="1.5" />
                      <path d="M57 78l2 2 4-4" stroke="#B88C00" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <div>
                      <p className="text-sm font-bold text-brand-600">
                        {empty ?? "Nothing here yet"}
                      </p>
                      <p className="text-xs text-brand-400 mt-1 max-w-xs">
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
                              className="-mx-1 block cursor-text rounded px-1 hover:bg-brand-100/70 dark:hover:bg-white/5"
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
        <div className="flex items-center justify-between gap-4 px-6 py-4 relative">
          {/* Gradient border along the top of the modal header */}
          <div
            className="absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl"
            style={{
              background: "linear-gradient(90deg, #FFD600 0%, #FFBA3D 40%, #E0AE00 70%, #B88C00 100%)",
            }}
          />
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
      <AnimatePresence mode="wait">
        {error ? (
          <motion.p
            key="err"
            initial={{ height: 0, opacity: 0, y: -4 }}
            animate={{ height: "auto", opacity: 1, y: 0 }}
            exit={{ height: 0, opacity: 0, y: -4 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="text-xs font-medium text-danger mt-1.5 flex items-center gap-1"
          >
            <AlertCircle size={12} className="shrink-0" />
            {error}
          </motion.p>
        ) : hint ? (
          <motion.p
            key="hint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-xs text-brand-400 mt-1.5"
          >
            {hint}
          </motion.p>
        ) : null}
      </AnimatePresence>
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

export { MagicCard, ShimmerButton, SpotlightCard };

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
        <div className="mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-brand-50 dark:bg-white/5">
          <Icon size={32} className="text-brand-300 dark:text-brand-500" />
        </div>
      )}
      <h3 className="text-base font-bold text-ink mb-1.5">{title}</h3>
      {description && (
        <p className="text-sm text-brand-400 max-w-sm leading-relaxed">{description}</p>
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
