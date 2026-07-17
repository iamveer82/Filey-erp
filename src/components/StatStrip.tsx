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
 * stats sharing a single rounded card. Quieter and denser than a grid of
 * separate MetricCards — preferred for page-top KPI rows. */
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
        "grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border",
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
          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5 bg-card p-4 sm:p-5"
        >
          <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            {s.icon}
            {s.label}
          </div>
          {s.change && (
            <div
              className={cn(
                "text-[11.5px] font-medium tabular-nums",
                s.tone === "positive"
                  ? "text-success"
                  : s.tone === "negative"
                    ? "text-danger"
                    : "text-muted-foreground"
              )}
            >
              {s.change}
            </div>
          )}
          <div className="w-full flex-none text-[26px] leading-tight font-semibold tracking-tight text-foreground tabular-nums">
            {s.value}
          </div>
        </div>
      ))}
    </div>
  );
}
