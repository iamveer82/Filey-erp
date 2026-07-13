/* ── ReportChart: Apple-style bar + pie chart wrappers ──────────────────────
 * Bars use #FFD600 at 0.75 opacity, rounded top, hover:opacity-100.
 * Pie uses the golden PIE palette. Both sit inside an InfoCard. */
import type { ReactNode } from "react";
import {
  BarChart,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  ChartBar,
  type ChartConfig,
} from "../../../components/ui/chart";
import { InfoCard, Skeleton } from "../../../components/ui";
import { aed } from "../../../lib/format";

export const PIE_COLORS = ["#FFD600", "#E0AE00", "#B88C00", "#FFBA3D", "#F6C954"];
const CHART_GRID = "#DEDBD2";

export function ReportBarChart({
  data,
  config,
  title,
  action,
  loading,
  className,
}: {
  data: Record<string, unknown>[];
  config: ChartConfig;
  title: string;
  action?: ReactNode;
  loading?: boolean;
  className?: string;
}) {
  return (
    <InfoCard
      title={title}
      action={action}
      className={className}
    >
      {loading ? (
        <Skeleton className="h-72 w-full" />
      ) : (
        <ChartContainer config={config} className="h-72 w-full aspect-auto">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 12, fill: "#A39B8C" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 12, fill: "#A39B8C" }}
              axisLine={false}
              tickLine={false}
              width={70}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            {Object.keys(config).map((key, idx) => (
              <ChartBar
                key={key}
                dataKey={key}
                fill={`var(--color-${key})`}
                radius={[4, 4, 0, 0]}
                seriesIndex={idx}
              />
            ))}
          </BarChart>
        </ChartContainer>
      )}
    </InfoCard>
  );
}

export function ReportPieChart({
  data,
  title,
  action,
  loading,
  className,
}: {
  data: { name: string; value: number }[];
  title: string;
  action?: ReactNode;
  loading?: boolean;
  className?: string;
}) {
  return (
    <InfoCard title={title} action={action} className={className}>
      <div className="h-72">
        {loading ? (
          <Skeleton className="h-full w-full" />
        ) : data.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius={55}
                outerRadius={85}
                paddingAngle={3}
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => aed(Number(v))} />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-brand-400">
            No data
          </div>
        )}
      </div>
    </InfoCard>
  );
}