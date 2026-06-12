import { ReactNode } from "react";
import { cn } from "../lib/format";

export interface StatStripItem {
  label: string;
  value: string;
  /** Optional change indicator, e.g. "+8.3%" — tone colors it. */
  change?: string;
  tone?: "positive" | "negative" | "neutral";
  icon?: ReactNode;
}

/** Joined KPI strip (21st.dev/Tremor-style): one hairline-divided row of
 *  stats sharing a single rounded card. Quieter and denser than a grid of
 *  separate MetricCards — preferred for page-top KPI rows. */
export default function StatStrip({
  items,
  className,
}: {
  items: StatStripItem[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-brand-200/80 bg-brand-200/80 shadow-bento dark:border-[#3A3D45] dark:bg-[#3A3D45]",
        // Literal classes so Tailwind keeps them.
        items.length >= 4
          ? "lg:grid-cols-4"
          : items.length === 3
          ? "lg:grid-cols-3"
          : "lg:grid-cols-2",
        className
      )}
    >
      {items.map((s) => (
        <div
          key={s.label}
          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5 bg-white p-4 sm:p-5 dark:bg-[#24262C]"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-brand-500">
            {s.icon}
            {s.label}
          </div>
          {s.change && (
            <div
              className={cn(
                "text-xs font-semibold tabular-nums",
                s.tone === "positive"
                  ? "text-success"
                  : s.tone === "negative"
                  ? "text-danger"
                  : "text-brand-400"
              )}
            >
              {s.change}
            </div>
          )}
          <div className="w-full flex-none text-2xl font-bold tracking-tight text-ink tabular-nums">
            {s.value}
          </div>
        </div>
      ))}
    </div>
  );
}
