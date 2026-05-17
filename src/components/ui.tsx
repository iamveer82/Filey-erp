import { ReactNode, useEffect } from "react";
import { X, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { cn } from "../lib/format";

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
          <p className="text-2xl font-bold text-ink mt-1 truncate">{value}</p>
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
            "font-bold",
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
    neutral: "bg-brand-100 text-brand-600",
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

export function DataTable<T>({
  columns,
  rows,
  empty = "No records",
}: {
  columns: { key: string; label: string; render: (row: T) => ReactNode }[];
  rows: T[];
  empty?: string;
}) {
  return (
    <div className="card overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className="th">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="td text-brand-300" colSpan={columns.length}>
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr
                  key={i}
                  className="hover:bg-brand-50/60 transition-colors duration-200"
                >
                  {columns.map((c) => (
                    <td key={c.key} className="td">
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))
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
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white shadow-bento-hover p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-ink">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg p-1.5 text-brand-400 hover:bg-brand-50 cursor-pointer transition-colors duration-200"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
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
