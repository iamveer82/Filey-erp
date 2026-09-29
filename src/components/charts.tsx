import { type ReactNode, type ReactElement } from "react";
import { cn } from "../lib/format";
import { useChartColors } from "../lib/accent";
import { ChartContainer, type ChartConfig } from "./ui/chart";
import { CardHeader, CardTitle, CardDescription, CardContent } from "./ui/card";

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
    /** Muted ticks, no axis lines, no tick marks — the grid does the ruling. */
    tick: { fontSize: 11, fill: c.axis } as React.CSSProperties,
    axisProps: {
      stroke: "transparent",
      tickLine: false,
      axisLine: false,
      tickMargin: 8,
      tick: { fontSize: 11, fill: c.axis },
    } as const,
    cursor: { fill: "currentColor", fillOpacity: 0.04 },
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
    <div className={cn("p-5 min-w-0 flex flex-col", className)}>
      <CardHeader className="flex items-start justify-between gap-3 p-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CardTitle>
              {title}
            </CardTitle>
            {live && (
              <span className="px-1.5 py-0.5 rounded text-[10.5px] font-medium bg-success/10 text-success ring-1 ring-success/30 inline-flex items-center shrink-0">
                Live
              </span>
            )}
          </div>
          {subtitle && (
            <CardDescription className="mt-1">{subtitle}</CardDescription>
          )}
        </div>
        {action}
      </CardHeader>
      <CardContent className={cn("px-0", bodyClassName)}>{children}</CardContent>
    </div>
  );
}

/** Concrete heights avoid percentage-height/flex loops that leave charts blank. */
export function ChartFrame({
  children,
  height = 256,
  config = {},
}: {
  children: ReactElement;
  height?: number;
  config?: ChartConfig;
}) {
  return (
    <ChartContainer
      config={config}
      className="w-full aspect-auto"
      style={{ height }}
      initialDimension={{ width: 320, height }}
    >
      {children}
    </ChartContainer>
  );
}
