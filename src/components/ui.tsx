import { FileySpinner as Loader2 } from "./FileySpinner";
import {
  ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Dialog, DialogContent, DialogTitle, DialogClose } from "./Dialog";
import { useT } from "../lib/i18n";
import {
  X,
  ArrowUpRight,
  ArrowDownRight,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Users,
  Lock,
  AlertCircle,
  Inbox,
  Check,
  Circle as CircleIcon,
  Search,
} from "lucide-react";
import { cn } from "../lib/format";
import { Card as CardPrimitive } from "./Card";
import { SelectMenu } from "./ui-menu";

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
    <div role="status" aria-label={label || "Loading"} className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
      <Loader2 size={18} className="animate-spin" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}

/** Inline error banner — for surfacing load/save failures visibly. */
export function ErrorBanner({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm font-medium text-danger">
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
      type="button"
      aria-pressed={!!shared}
      onClick={() => onToggle(!shared)}
      title={
        shared
          ? "Shared with your team - click to make private"
          : "Private to you - click to share with your team"
      }
      className={cn(
        "inline-flex min-h-7 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
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

/** A real on/off control. role="switch" + aria-checked so it announces as one,
 *  and the label is part of the button so the whole row is the hit target. */
export function Switch({
  checked,
  onChange,
  disabled,
  busy,
  label,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  busy?: boolean;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        checked ? "bg-primary-500" : "bg-border",
        disabled || busy ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none block h-5 w-5 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-5" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle?: string;
  action?: ReactNode;
}) {
  const t = useT();
  return (
    <div className="page-heading flex items-start justify-between mb-6 gap-4 flex-wrap">
      <div className="min-w-0 flex-1 basis-[240px]">
        <h1 className="text-[24px] leading-tight font-semibold text-foreground tracking-tight">{typeof title === "string" ? t(title) : title}</h1>
        {subtitle && <p className="text-[13px] text-muted-foreground mt-1">{t(subtitle)}</p>}
      </div>
      {action && <div className="page-heading-actions flex min-w-0 max-w-full flex-wrap items-center gap-2">{action}</div>}
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
 *  ellipsis. Re-fits when the value or available card width changes. */
function useFitText<T extends HTMLElement>(dep: unknown, max = 18, min = 11) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      let size = max;
      el.style.whiteSpace = "nowrap";
      el.style.fontSize = size + "px";
      while (el.scrollWidth > el.clientWidth && size > min) {
        size -= 1;
        el.style.fontSize = size + "px";
      }
      // Extremely long totals still remain readable at the minimum font size.
      el.style.whiteSpace = el.scrollWidth > el.clientWidth ? "normal" : "nowrap";
    };
    fit();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", fit);
      return () => window.removeEventListener("resize", fit);
    }
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
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
  changeTone = "neutral",
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
  /** Tone for a measured change; descriptive metadata stays neutral */
  changeTone?: "up" | "down" | "warn" | "neutral";
}) {
  const display = rawValue !== undefined && formatValue ? formatValue(rawValue) : value;
  const numRef = useFitText<HTMLParagraphElement>(display);
  const toneClass =
    changeTone === "down"
      ? "text-danger"
      : changeTone === "warn"
        ? "text-warning"
        : changeTone === "up"
          ? "text-success"
          : "text-muted-foreground";
  // No border-color transition: the base colour is a theme custom property, and
  // animating it leaves the previous theme's colour painted on a flip.
  return (
    <CardPrimitive className="p-4 h-full hover:border-border">
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
            title={display}
            className="text-[22px] leading-tight font-semibold text-foreground mt-0.5 tabular-nums tracking-tight whitespace-nowrap [overflow-wrap:anywhere]"
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

/** A click landing on one of these is the control's own, not the row's. */
const ROW_CLICK_IGNORE =
  "button, a, input, select, label, summary, details, [role='menu'], [data-no-row-click]";

/**
 * Enter/Space activation for something clickable that can't be a real <button>:
 * a table row, or a control nested inside another button. Native buttons get
 * this from the browser and must not use it.
 */
export function keyActivate(fn: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    // A control *inside* us handles its own Enter/Space; the keydown bubbles up
    // here anyway, so bail. An interactive *ancestor* is not our problem.
    const hit = (e.target as HTMLElement).closest(ROW_CLICK_IGNORE);
    if (hit && hit !== e.currentTarget && e.currentTarget.contains(hit)) return;
    e.preventDefault();
    e.stopPropagation();
    fn();
  };
}

export function DataTable<T>({
  columns,
  rows,
  empty = "No records",
  loading = false,
  rowKey,
  bulkActions,
  onRowClick,
  pageSize,
  sort: controlledSort,
  onSortChange,
}: {
  columns: {
    key: string;
    label: string;
    render: (row: T) => ReactNode;
    /** Essential fields in the narrow quick-view layout. Defaults to the first three. */
    summary?: boolean;
    /** Visually shorten long names; the complete value remains in Details. */
    truncate?: boolean;
    /** Keep row controls separate from the record's data. */
    actions?: boolean;
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
  /** Cap how many rows render at once, with a Prev/Next footer. Keeps the
   *  card short enough to read without scrolling the page. */
  pageSize?: number;
  /** Controlled ordering for saved views; omitted keeps local header sorting. */
  sort?: { key: string; dir: 1 | -1 } | null;
  onSortChange?: (next: { key: string; dir: 1 | -1 } | null) => void;
}) {
  const showSkeleton = loading && rows.length === 0;
  const selectable = !!rowKey && !!bulkActions?.length;
  const [sel, setSel] = useState<Set<string | number>>(new Set());
  const [running, setRunning] = useState(false);
  const [localSort, setLocalSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const sort = controlledSort === undefined ? localSort : controlledSort;
  const [editing, setEditing] = useState<{ row: string | number; col: string } | null>(
    null
  );
  const [editVal, setEditVal] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const savingRef = useRef(false);
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
  const toggleSort = (key: string) => {
    const next = sort?.key === key
      ? (sort.dir === 1 ? { key, dir: -1 as const } : null)
      : { key, dir: 1 as const };
    if (controlledSort === undefined) setLocalSort(next);
    onSortChange?.(next);
  };

  // Use quick views when either the available space or the actual content
  // makes the table too wide. Retain its measured width while cards are shown.
  const tableWidth = useRef(0);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const check = () => {
      if (el.firstElementChild?.tagName === "TABLE") tableWidth.current = el.scrollWidth;
      setCompact(el.clientWidth > 0 && el.clientWidth + 1 < Math.max(600, columns.length * 124, tableWidth.current));
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [rows.length, columns.length]);

  // Clamped rather than reset in an effect, so filtering down to fewer pages
  // while parked on a late page just lands on the last one.
  const [page, setPage] = useState(0);
  const pageCount = pageSize ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const safePage = Math.min(page, pageCount - 1);
  const paged = pageSize
    ? sorted.slice(safePage * pageSize, safePage * pageSize + pageSize)
    : sorted;

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
    if (savingRef.current) return;
    savingRef.current = true;
    setRunning(true);
    setActionError("");
    try {
      await a.run(selectedRows);
      setSel(new Set());
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The action could not be completed. Try again.");
    } finally {
      savingRef.current = false;
      setRunning(false);
    }
  };

  const colCount = columns.length + (selectable ? 1 : 0);
  const dataColumns = columns.filter(c => !c.actions);
  const summaryColumns = dataColumns.some(c => c.summary)
    ? dataColumns.filter(c => c.summary) : dataColumns.slice(0, 3);
  const detailColumns = dataColumns.filter(c => !summaryColumns.includes(c) || c.truncate);
  const actionColumns = columns.filter(c => c.actions);
  const renderCell = (c: typeof columns[number], row: T, k: string | number, full = false) => {
    const isEditing = !!c.editable && editing?.row === k && editing?.col === c.key;
    const commit = async () => {
      if (!c.editable || savingRef.current) return;
      savingRef.current = true;
      setEditSaving(true);
      setActionError("");
      try {
        await c.editable.onSave(row, editVal);
        setEditing(null);
      } catch (error) {
        setActionError(error instanceof Error ? error.message : "The change could not be saved. Your entry is still here; try again.");
      } finally {
        savingRef.current = false;
        setEditSaving(false);
      }
    };
    const value = c.render(row);
    const text = c.sortValue?.(row);
    const content = c.truncate && !full
      ? <div className="filey-cell-text" title={typeof text === "string" ? text : undefined}>{value}</div>
      : value;
    if (compact && c.truncate && !full) return content;
    if (isEditing) return <input autoFocus aria-label={`Edit ${c.label}`} aria-invalid={!!actionError}
      type={c.editable?.type ?? "text"} value={editVal} disabled={editSaving}
      onChange={e => setEditVal(e.target.value)} onClick={e => e.stopPropagation()}
      onBlur={commit} onKeyDown={e => { if (e.key === "Enter") void commit(); else if (e.key === "Escape") setEditing(null); }}
      className="input h-8 w-full text-sm" />;
    if (c.editable) return <button type="button" title="Edit value"
      className="-mx-1 block w-full cursor-text rounded px-1 text-left hover:bg-hover"
      onClick={e => { e.stopPropagation(); setEditVal(c.editable!.value(row)); setActionError(""); setEditing({ row: k, col: c.key }); }}
    >{content}</button>;
    return content;
  };
  return (
    <div className="card overflow-hidden p-0">
      {actionError && <div className="p-3"><ErrorBanner message={actionError} /></div>}
      {selectable && selectedRows.length > 0 && (
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-3 px-4 py-2.5 bg-muted/60 border-b border-border">
          <span className="text-[13px] font-semibold text-foreground">{selectedRows.length} selected</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {bulkActions!.map((a) => (
              <button
                key={a.label}
                disabled={running}
                onClick={() => runBulk(a)}
                className={cn(
                  "btn-ghost h-7 px-2 text-xs disabled:pointer-events-none",
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
          "filey-table-scroll min-w-0 overflow-x-auto overscroll-x-contain"
        )}
      >
        {compact ? <div className="filey-record-list">
          {(selectable || columns.some(c => c.sortValue)) && <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
            {selectable && <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" aria-label="Select all" checked={allChecked} disabled={running}
                ref={input => { if (input) input.indeterminate = selectedRows.length > 0 && !allChecked; }} onChange={toggleAll} /> Select all
            </label>}
            {columns.some(c => c.sortValue) && <SelectMenu ariaLabel="Sort records" size="sm" className="ml-auto max-w-52"
              value={sort ? JSON.stringify(sort) : ""}
              options={[{ value: "", label: "Default order" }, ...columns.filter(c => c.sortValue).flatMap(c => [
                { value: JSON.stringify({ key: c.key, dir: 1 }), label: `${c.label} ↑` },
                { value: JSON.stringify({ key: c.key, dir: -1 }), label: `${c.label} ↓` },
              ])]}
              onChange={value => { const next = value ? JSON.parse(value) as { key: string; dir: 1 | -1 } : null; if (controlledSort === undefined) setLocalSort(next); onSortChange?.(next); }} />}
          </div>}
          {showSkeleton ? Array.from({ length: 5 }, (_, i) => <div key={i} className="p-4"><Skeleton className="h-14 w-full" /></div>) :
            paged.map((row, i) => {
              const k = rowKey ? keyOf(row) : i;
              return <div key={k} className={cn("filey-record", sel.has(k) && "bg-primary-50/40")}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? e => { if (!(e.target as HTMLElement).closest(ROW_CLICK_IGNORE)) onRowClick(row); } : undefined}
                onKeyDown={onRowClick ? keyActivate(() => onRowClick(row)) : undefined}>
                {selectable && <input className="filey-record-check" type="checkbox" aria-label="Select row" checked={sel.has(k)} disabled={running} onChange={() => toggle(k)} />}
                <div className="filey-record-fields">
                  {summaryColumns.map(c => <div key={c.key} className="min-w-0">
                    <div className="mb-1 text-[11px] text-muted-foreground">{c.label}</div>
                    <div className="filey-record-value">{renderCell(c, row, k)}</div>
                  </div>)}
                </div>
                {actionColumns.length > 0 && <div className="filey-record-actions">{actionColumns.map(c => <div key={c.key}>{c.render(row)}</div>)}</div>}
                {detailColumns.length > 0 && <details className="filey-record-details">
                  <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Details</summary>
                  <dl className="mt-3 grid grid-cols-1 gap-3 min-[480px]:grid-cols-2">
                    {detailColumns.map(c => <div key={c.key} className="min-w-0"><dt className="mb-1 text-xs text-muted-foreground">{c.label}</dt><dd className="filey-record-value">{renderCell(c, row, k, true)}</dd></div>)}
                  </dl>
                </details>}
              </div>;
            })}
        </div> : <table className="filey-data-table w-full">
          <thead className="sticky top-0 z-10 bg-card">
            <tr>
              {selectable && (
                <th className="th w-10">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    ref={(input) => { if (input) input.indeterminate = selectedRows.length > 0 && !allChecked; }}
                    disabled={running}
                    checked={allChecked}
                    onChange={toggleAll}
                    className="cursor-pointer"
                  />
                </th>
              )}
              {columns.map(c =>
                c.sortValue ? (
                  <th
                    key={c.key}
                    aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
                    className="th"
                  >
                    <button
                      onClick={() => toggleSort(c.key)}
                      className="inline-flex items-center gap-1 cursor-pointer hover:text-foreground"
                    >
                      {c.label}
                      {sort?.key !== c.key
                        ? <ArrowUpDown size={16} className="text-muted-foreground" aria-hidden="true" />
                        : sort.dir === 1
                          ? <ArrowUp size={16} aria-hidden="true" />
                          : <ArrowDown size={16} aria-hidden="true" />}
                    </button>
                  </th>
                ) : (
                  <th
                    key={c.key}
                    className="th"
                  >
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
            ) : (
              paged.map((row, i) => {
                const k = rowKey ? keyOf(row) : i;
                const checked = selectable && sel.has(k);
                return (
                  <tr
                    key={k}
                    tabIndex={onRowClick ? 0 : undefined}
                    onClick={
                      onRowClick
                        ? (e) => {
                            if ((e.target as HTMLElement).closest(ROW_CLICK_IGNORE)) return;
                            onRowClick(row);
                          }
                        : undefined
                    }
                    onKeyDown={onRowClick ? keyActivate(() => onRowClick(row)) : undefined}
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
                          disabled={running}
                          checked={checked}
                          onChange={() => toggle(k)}
                          className="cursor-pointer"
                        />
                      </td>
                    )}
                    {columns.map(c => (
                        <td
                          key={c.key}
                          className="td"
                        >
                          {renderCell(c, row, k)}
                        </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>}
      </div>
      {!showSkeleton && rows.length === 0 && (
        <div className="flex flex-col items-center gap-3 px-4 py-14 text-center" role="status">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-muted">
            <Inbox size={24} className="text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{empty ?? "Nothing here yet"}</p>
            {!empty && (
              <p className="mt-1 max-w-xs text-[12.5px] text-muted-foreground">
                When you have records, they'll show up right here.
              </p>
            )}
          </div>
        </div>
      )}
      {pageSize && sorted.length > pageSize && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5">
          <span className="text-[12.5px] text-muted-foreground tabular-nums">
            {safePage * pageSize + 1}–
            {Math.min(sorted.length, (safePage + 1) * pageSize)} of {sorted.length}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              className="btn-ghost h-7 px-2 text-[12.5px]"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
            >
              Previous
            </button>
            <span className="text-[12.5px] text-muted-foreground tabular-nums">
              {safePage + 1} / {pageCount}
            </span>
            <button
              className="btn-ghost h-7 px-2 text-[12.5px]"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(safePage + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
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
  size?: "md" | "lg" | "xl" | "2xl" | "3xl" | "full" | "document";
}) {
  const widthClass = {
    md: "max-w-lg",
    lg: "max-w-2xl",
    xl: "max-w-3xl",
    "2xl": "max-w-4xl",
    "3xl": "max-w-5xl",
    full: "max-w-[95vw]",
    document: "filey-document-dialog max-w-[95vw] h-[90dvh]",
  }[size];
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        showClose={false}
        aria-describedby={undefined}
        onOpenAutoFocus={() => { returnFocus.current = document.activeElement as HTMLElement | null; }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (returnFocus.current?.isConnected) returnFocus.current.focus();
        }}
        className={cn("flex flex-col gap-0 overflow-hidden p-0", widthClass)}
      >
        <div className="flex shrink-0 items-center justify-between gap-4 px-4 sm:px-6 py-3 border-b border-border">
          <DialogTitle className="min-w-0 break-words">{title}</DialogTitle>
          <DialogClose aria-label="Close dialog" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-hover hover:text-foreground">
            <X size={18} />
          </DialogClose>
        </div>
        <div className="min-h-0 min-w-0 overflow-y-auto overscroll-contain px-4 sm:px-6 py-5">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

export function Field(props: React.ComponentProps<typeof FormField>) {
  return <FormField {...props} />;
}

/** Reusable form field with label, inline validation error (animated slide-in),
 *  and optional hint text. Drop-in replacement for raw label+input pairs. */
export function FormField({
  label,
  htmlFor,
  error,
  hint,
  children,
  className,
  required,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
  required?: boolean;
}) {
  const fieldId = useId();
  const messageId = `${fieldId}-message`;
  const fieldRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLLabelElement>(null);
  // Legacy fields often wrap a control in an icon or date-picker container.
  // Associate the rendered control once instead of changing hundreds of callers.
  useLayoutEffect(() => {
    const control = htmlFor ? document.getElementById(htmlFor) : fieldRef.current?.querySelector<HTMLElement>('input:not([type="hidden"]),textarea,select,[role="combobox"],button[aria-haspopup="menu"]');
    if (!control || !labelRef.current) return;
    if (!control.id) control.id = fieldId;
    labelRef.current.htmlFor = control.id;
    const describedBy = control.getAttribute("aria-describedby");
    const invalid = control.getAttribute("aria-invalid");
    const wasRequired = control.getAttribute("aria-required");
    if (error || hint) control.setAttribute("aria-describedby", [describedBy, messageId].filter(Boolean).join(" "));
    if (error) control.setAttribute("aria-invalid", "true");
    if (required) control.setAttribute("aria-required", "true");
    return () => {
      if (error || hint) {
        if (describedBy) control.setAttribute("aria-describedby", describedBy);
        else control.removeAttribute("aria-describedby");
      }
      if (error) {
        if (invalid) control.setAttribute("aria-invalid", invalid);
        else control.removeAttribute("aria-invalid");
      }
      if (required) {
        if (wasRequired) control.setAttribute("aria-required", wasRequired);
        else control.removeAttribute("aria-required");
      }
    };
  });
  return (
    <div ref={fieldRef} className={cn("flex min-w-0 flex-col", className)}>
      <label ref={labelRef} className="label" htmlFor={htmlFor}>
        {label}
        {required && <span aria-hidden="true" className="text-danger ml-0.5">*</span>}
      </label>
      {children}
      {error ? (
        <p id={messageId} role="alert" className="text-xs font-medium text-danger mt-1.5 flex items-center gap-1">
          <AlertCircle size={12} className="shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-xs text-muted-foreground mt-1">{hint}</p>
      ) : null}
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
      {(title || subtitle || action) && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-foreground">{title}</h2>}
            {subtitle && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{subtitle}</p>}
          </div>
          {action && <div className="flex max-w-full flex-wrap items-center gap-2">{action}</div>}
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
    current: "bg-primary-400 text-neutral-900 border-primary-500 ring-4 ring-primary-500/15",
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

/** Shared filter control; status is conveyed by text, selection by neutral fill. */
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
  const tones = {
    neutral: "text-muted-foreground",
    success: "text-success",
    warn: "text-warning",
    danger: "text-danger",
    info: "text-info",
  };
  return (
    <button
      type="button"
      aria-pressed={!!active}
      onClick={onClick}
      className={cn(
        "chip",
        active ? "chip-active" : tones[tone]
      )}
    >
      {children}
      {count !== undefined && (
        <span
          className={cn(
            "inline-grid place-items-center min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-semibold",
            "bg-muted text-muted-foreground"
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
          aria-label={label}
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
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className={cn("relative", className)}>
      <Search
        size={14}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
      />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="input pl-9 pr-11"
        onKeyDown={event => {
          if (event.key === "Escape" && value) {
            event.preventDefault();
            event.stopPropagation();
            onChange("");
          }
        }}
      />
      {value && (
        <button
          type="button"
          onClick={() => { onChange(""); inputRef.current?.focus(); }}
          className="absolute right-0 top-1/2 -translate-y-1/2 grid place-items-center h-10 w-10 rounded-full text-muted-foreground hover:bg-hover hover:text-foreground transition-colors cursor-pointer [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
          aria-label="Clear"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}
