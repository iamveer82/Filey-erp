import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

interface TrendPoint {
  name: string;
  value: number;
}

interface TrendChartProps {
  data: TrendPoint[];
  gradientId?: string;
  height?: number | string;
}

export default function TrendChart({
  data,
  gradientId = "trendFill",
  height = "100%",
}: TrendChartProps) {
  return (
    <div style={{ width: "100%", height }} className="min-h-0">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor="var(--chart-fill-start)"
                stopOpacity="var(--chart-fill-opacity-start)"
              />
              <stop
                offset="100%"
                stopColor="var(--chart-fill-end)"
                stopOpacity="var(--chart-fill-opacity-end)"
              />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--chart-grid)"
            vertical={false}
          />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 11, fill: "var(--chart-tick)" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--chart-tick)" }}
            axisLine={false}
            tickLine={false}
            width={32}
          />
          <Tooltip
            contentStyle={{
              borderRadius: 10,
              border: "1px solid var(--chart-tooltip-border)",
              background: "var(--chart-tooltip-bg)",
              fontSize: 12,
            }}
            itemStyle={{ color: "var(--chart-stroke)" }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="var(--chart-stroke)"
            strokeWidth={2}
            fill={`url(#${gradientId})`}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
