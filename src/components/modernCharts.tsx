/* Filey's chart set, in the shadcn/ui chart style: vertical bars (grouped or
 * stacked, with a legend), a half radial for a split of one total, an
 * interactive donut, and a trend footer. Overview, Reports, record insights and
 * Filey AI's widgets all draw with these, so every chart reads the same. */
import { useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Label, Pie, PieChart, PolarAngleAxis, PolarRadiusAxis, RadialBar, RadialBarChart, Sector, XAxis, YAxis } from "recharts";
import type { PieSectorShapeProps } from "recharts/types/polar/Pie";
import { TrendingDown, TrendingUp } from "lucide-react";
import { ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "./ui/chart";
import { ChartFrame, useChartStyle } from "./charts";
import { SelectMenu } from "./ui-menu";
import { cn } from "../lib/format";

export interface ChartSeries { key: string; label: string; color: string }
type Row = Record<string, unknown>;

const configOf = (series: { key: string; label: string; color: string }[]) =>
  Object.fromEntries(series.map(s => [s.key, { label: s.label, color: s.color }])) satisfies ChartConfig;

/** Vertical bars: one or more series side by side (reference "multiple"),
 *  or stacked with a legend. A single series can colour each bar on its own. */
export function BarSeriesChart({
  data, xKey, series, stacked = false, height = 260, xFormatter, valueFormatter, barColors, showYAxis = false, yFormatter, spanKey,
}: {
  data: Row[];
  xKey: string;
  series: ChartSeries[];
  stacked?: boolean;
  height?: number;
  xFormatter?: (value: string) => string;
  valueFormatter?: (value: number) => string;
  /** One series only: a colour per bar (categories, aging buckets). */
  barColors?: string[];
  showYAxis?: boolean;
  yFormatter?: (value: number) => string;
  /** Row field naming the period a bar covers, shown in the tooltip. */
  spanKey?: string;
}) {
  const cs = useChartStyle();
  const last = series.length - 1;
  return (
    <ChartFrame height={height} config={configOf(series)}>
      <BarChart accessibilityLayer data={data} margin={{ top: 8, right: 4, left: showYAxis ? -6 : 4, bottom: 0 }} barGap={4} barCategoryGap={series.length > 1 && !stacked ? "18%" : "24%"}>
        <CartesianGrid vertical={false} stroke={cs.c.grid} />
        <XAxis dataKey={xKey} tickLine={false} axisLine={false} tickMargin={10} minTickGap={6}
          tick={{ fontSize: 11, fill: cs.c.axis }} tickFormatter={xFormatter} interval="preserveStartEnd" />
        {showYAxis && <YAxis {...cs.axisProps} width={56} tickFormatter={yFormatter} />}
        <ChartTooltip cursor={{ fill: "currentColor", fillOpacity: 0.05 }}
          content={<ChartTooltipContent indicator="dashed" valueFormatter={valueFormatter ? (v: unknown) => valueFormatter(Number(v) || 0) : undefined}
            labelFormatter={spanKey ? (label, payload) => String((payload?.[0]?.payload as Row | undefined)?.[spanKey] ?? label) : undefined} />} />
        {series.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={`var(--color-${s.key})`} stackId={stacked ? "a" : undefined}
            radius={stacked ? (series.length === 1 ? 4 : i === 0 ? [0, 0, 4, 4] : i === last ? [4, 4, 0, 0] : 0) : 4}
            maxBarSize={stacked || series.length === 1 ? 44 : 28} isAnimationActive={false}>
            {barColors && series.length === 1 && data.map((_, j) => <Cell key={j} fill={barColors[j % barColors.length]} />)}
          </Bar>
        ))}
      </BarChart>
    </ChartFrame>
  );
}

/** Half radial with stacked sections: how one total splits (collected vs outstanding). */
export function RadialSplitChart({ parts, centerValue, centerLabel, valueFormatter, height = 200 }: {
  parts: (ChartSeries & { value: number })[];
  centerValue: string;
  centerLabel: string;
  valueFormatter?: (value: number) => string;
  height?: number;
}) {
  const data = [Object.fromEntries(parts.map(p => [p.key, p.value]))];
  return (
    <ChartFrame height={height} config={configOf(parts)}>
      <RadialBarChart data={data} endAngle={180} innerRadius={84} outerRadius={118} cy="82%">
        {/* Recharts 3 scales the arc to the largest single part, so the stacked total must be set. */}
        <PolarAngleAxis type="number" domain={[0, parts.reduce((n, p) => n + p.value, 0) || 1]} tick={false} axisLine={false} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel valueFormatter={valueFormatter ? (v: unknown) => valueFormatter(Number(v) || 0) : undefined} />} />
        <PolarRadiusAxis tick={false} tickLine={false} axisLine={false}>
          <Label content={({ viewBox }) => viewBox && "cx" in viewBox && "cy" in viewBox ? (
            <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle">
              <tspan x={viewBox.cx} y={(viewBox.cy || 0) - 18} className="fill-foreground text-[22px] font-bold">{centerValue}</tspan>
              <tspan x={viewBox.cx} y={(viewBox.cy || 0) + 2} className="fill-muted-foreground text-[12px]">{centerLabel}</tspan>
            </text>
          ) : null} />
        </PolarRadiusAxis>
        {parts.map(p => (
          <RadialBar key={p.key} dataKey={p.key} name={p.label} stackId="a" cornerRadius={6} fill={`var(--color-${p.key})`} className="stroke-transparent stroke-2" isAnimationActive={false} />
        ))}
      </RadialBarChart>
    </ChartFrame>
  );
}

/** Interactive donut: pick a slice (list, picker or click) and it lifts out with its value in the centre. */
export function DonutChart({ data, valueFormatter = v => v.toLocaleString(), centerLabel, height = 260, picker = true, legend = true }: {
  data: (ChartSeries & { value: number })[];
  valueFormatter?: (value: number) => string;
  centerLabel?: string;
  height?: number;
  picker?: boolean;
  /** Off where the page already lists the slices beside the chart. */
  legend?: boolean;
}) {
  const [active, setActive] = useState(data[0]?.key);
  const index = Math.max(0, data.findIndex(d => d.key === active));
  const total = data.reduce((n, d) => n + d.value, 0);
  const rows = useMemo(() => data.map(d => ({ ...d, fill: d.color })), [data]);
  const shape = (props: PieSectorShapeProps) => {
    const outer = Number(props.outerRadius) || 0;
    return props.index === index ? (
      <g>
        <Sector {...props} outerRadius={outer + 8} />
        <Sector {...props} outerRadius={outer + 20} innerRadius={outer + 11} />
      </g>
    ) : <Sector {...props} />;
  };
  const current = data[index];
  return (
    <div>
      {picker && data.length > 1 && (
        <div className="mb-1 flex justify-end">
          <SelectMenu value={current?.key ?? ""} onChange={setActive} ariaLabel="Highlight a slice" className="w-auto"
            options={data.map(d => ({ value: d.key, label: d.label }))} />
        </div>
      )}
      <ChartFrame height={height} config={configOf(data)}>
        <PieChart>
          <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel valueFormatter={(v: unknown) => valueFormatter(Number(v) || 0)} />} />
          <Pie data={rows} dataKey="value" nameKey="label" innerRadius={58} outerRadius={88} strokeWidth={4} stroke="hsl(var(--card))"
            shape={shape} isAnimationActive={false} onClick={(_, i) => setActive(data[i]?.key)}>
            <Label content={({ viewBox }) => viewBox && "cx" in viewBox && "cy" in viewBox && current ? (
              <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-[22px] font-bold">{valueFormatter(current.value)}</tspan>
                <tspan x={viewBox.cx} y={(viewBox.cy || 0) + 22} className="fill-muted-foreground text-[12px]">{centerLabel ?? current.label}</tspan>
              </text>
            ) : null} />
          </Pie>
        </PieChart>
      </ChartFrame>
      {legend && <ul className="mt-1 grid gap-1 text-[12.5px]">
        {data.map((d, i) => (
          <li key={d.key}>
            <button type="button" onClick={() => setActive(d.key)}
              className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-hover", i === index && "bg-muted")}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: d.color }} />
              <span className="flex-1 truncate text-foreground">{d.label}</span>
              <span className="tabular-nums text-muted-foreground">{valueFormatter(d.value)}{total ? ` · ${Math.round((d.value / total) * 100)}%` : ""}</span>
            </button>
          </li>
        ))}
      </ul>}
    </div>
  );
}

/** "Up 5.2% vs the previous period" under a chart, with what it shows. */
export function TrendFooter({ change, what, caption }: { change?: number | null; what: string; caption: ReactNode }) {
  const up = (change ?? 0) >= 0;
  return (
    <div className="flex flex-col items-start gap-1 border-t border-border px-5 py-3 text-[12.5px]">
      {change != null && Number.isFinite(change) ? (
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          {what} {up ? "up" : "down"} {Math.abs(change).toFixed(1)}% vs the previous period
          {up ? <TrendingUp className="h-4 w-4 text-success" /> : <TrendingDown className="h-4 w-4 text-danger" />}
        </div>
      ) : (
        <div className="font-medium text-foreground">{what}: nothing to compare with the previous period yet</div>
      )}
      <div className="text-muted-foreground">{caption}</div>
    </div>
  );
}
