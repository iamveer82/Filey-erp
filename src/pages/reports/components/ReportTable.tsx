/* ── ReportTable: Apple-style clean table with status badges ────────────────
 * Status badges: Paid=green pill, Unpaid=red pill, Draft=gray pill.
 * Clean rows with hover, tabular-nums on numbers. */
import type { ReactNode } from "react";
import { cn } from "../../../lib/format";

export interface Column<T> {
  key: string;
  header: string;
  className?: string;
  align?: "left" | "right" | "center";
  render: (row: T, index: number) => ReactNode;
}

export type StatusTone = "paid" | "unpaid" | "draft" | "received" | "cancelled" | "open" | "neutral";

export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  const tones: Record<StatusTone, string> = {
    paid: "bg-success/10 text-success",
    unpaid: "bg-danger/10 text-danger",
    draft: "bg-brand-100 text-brand-500",
    received: "bg-success/10 text-success",
    cancelled: "bg-danger/10 text-danger",
    open: "bg-secondary-100 text-secondary-600",
    neutral: "bg-brand-100 text-brand-500",
  };
  return (
    <span
      className={cn(
        "text-[10px] font-medium px-1.5 py-0.5 rounded inline-flex items-center justify-center",
        tones[tone]
      )}
    >
      {children}
    </span>
  );
}

export function ReportTable<T>({
  columns,
  rows,
  emptyMessage,
  footer,
  title,
  subtitle,
  className,
}: {
  columns: Column<T>[];
  rows: T[];
  emptyMessage?: string;
  footer?: ReactNode;
  title?: string;
  subtitle?: string;
  className?: string;
}) {
  return (
    <div className={cn("card p-0 overflow-hidden", className)}>
      {(title || subtitle) && (
        <div className="p-4 border-b border-brand-100">
          {title && <h2 className="font-medium text-ink">{title}</h2>}
          {subtitle && <p className="text-xs text-brand-400 mt-0.5">{subtitle}</p>}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-medium text-brand-400 border-b border-brand-100">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    "py-2.5 px-2",
                    col.align === "right" && "text-right",
                    col.align === "center" && "text-center",
                    col.className
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="py-8 text-center text-sm text-brand-400"
                >
                  {emptyMessage ?? "No records"}
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr
                  key={i}
                  className="border-b border-brand-50 hover:bg-brand-50/50 transition-colors"
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        "py-2.5 px-2",
                        col.align === "right" && "text-right tabular-nums font-medium",
                        col.align === "center" && "text-center",
                        col.className
                      )}
                    >
                      {col.render(row, i)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          {footer && (
            <tfoot>
              <tr className="bg-brand-50 font-medium">{footer}</tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}