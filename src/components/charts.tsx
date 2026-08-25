import { type ReactNode } from "react";
import { cn } from "../lib/format";
import { useChartColors } from "../lib/accent";

/* ── charts — the one recipe for every chart in the app ─────────────────────
 * Filey's chart language: quiet ink on a flat card, hairline horizontal grid,
 * muted 11px ticks, accent gradients that fade to nothing, rounded bar tops,
 * and tooltips that read like the app's own menus. All colour flows from
 * useChartColors() so charts follow the accent + theme like everything else.
 *
 * Panels are composed into joined card grids (one bordered card, panels
 * divided by hairlines) — the same grammar as the joined KPI strips. */

/** Everything a chart needs to paint in Filey's language. */
export function useChartStyle() {
  const c = useChartColors();
  return {
    c,
    tooltipStyle: {
      borderRadius: 10,
      fontSize: 12,
      background: c.tooltipBg,
      border: `1px solid ${c.tooltipBorder}`,
      color: c.tooltipFg,
      boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
      padding: "8px 10px",
    } as React.CSSProperties,
    /** Muted ticks, no axis lines, no tick marks — the grid does the ruling. */
    tick: { fontSize: 11, fill: c.axis } as React.CSSProperties,
    axisProps: {
      stroke: "transparent",
      tickLine: false,
      axisLine: false,
      tick: { fontSize: 11, fill: c.axis },
    } as const,
    cursor: { fill: "currentColor", fillOpacity: 0.04 },
    legendStyle: { fontSize: 11, color: c.axis } as React.CSSProperties,
  };
}

/** Vertical accent fade used behind areas and bars. Ids must be unique per
 *  chart instance — pass a distinct `id`. */
export function ChartGradient({
  id,
  color,
  from = 0.35,
  to = 0,
}: {
  id: string;
  color: string;
  from?: number;
  to?: number;
}) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity={from} />
        <stop offset="100%" stopColor={color} stopOpacity={to} />
      </linearGradient>
    </defs>
  );
}

/** One panel of a joined chart grid: title, optional live badge / action,
 *  hairline divider toward siblings. */
export function ChartPanel({
  title,
  subtitle,
  action,
  live,
  className,
  children,
  bodyClassName,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  /** Small "Live" pill next to the title. */
  live?: boolean;
  className?: string;
  children: ReactNode;
  bodyClassName?: string;
}) {
  return (
    <div className={cn("p-5 flex flex-col", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-[14px] font-semibold text-foreground truncate">
              {title}
            </div>
            {live && (
              <span className="px-1.5 py-0.5 rounded text-[10.5px] font-medium bg-success/10 text-success ring-1 ring-success/30 inline-flex items-center shrink-0">
                Live
              </span>
            )}
          </div>
          {subtitle && (
            <div className="text-[12.5px] text-muted-foreground mt-0.5">
              {subtitle}
            </div>
          )}
        </div>
        {action}
      </div>
      <div className={cn("flex-1 min-h-0", bodyClassName)}>{children}</div>
    </div>
  );
}
