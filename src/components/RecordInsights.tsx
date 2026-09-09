import { toast } from "./Toaster";
import { ChartFrame } from "./charts";
import { useState } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { recordInsights } from "../lib/recordInsights";
import { ChartPanel, useChartStyle } from "./charts";
import { downloadCsv } from "../lib/csv";

/** Reports supplies the selected section's active-workspace records. */
export default function RecordInsights<T>({
  rows,
  category,
  date,
  title,
  dateLabel = "Records created",
  loading = false,
  error = false,
}: {
  rows: readonly T[];
  category: (row: T) => string | null | undefined;
  date?: (row: T) => string | null | undefined;
  title: string;
  dateLabel?: string;
  loading?: boolean;
  error?: boolean;
}) {
  const cs = useChartStyle();
  const [months, setMonths] = useState(6);
  const { distribution, trend, undated } = recordInsights(rows, category, date, months);
  const unavailable = loading
    ? "Loading chart data…"
    : error
      ? "Chart data could not be refreshed. Use Refresh insights to try again."
      : rows.length === 0
        ? "Add records to see your charts."
        : "";
  return (
    <details open className="card p-0 mb-4 overflow-hidden">
      <summary className="cursor-pointer px-5 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-[-2px]">
        Insights <span className="text-muted-foreground font-normal">· {title}</span>
      </summary>
      {unavailable ? (
        <p role="status" className="px-5 pb-5 text-sm text-muted-foreground">
          {unavailable}
        </p>
      ) : (
        <>
          <div
            className={`grid ${date ? "lg:grid-cols-2" : ""} border-t border-border divide-y lg:divide-y-0 lg:divide-x divide-border`}
          >
            <ChartPanel
              title={title}
              subtitle={`${rows.length.toLocaleString()} records in this chart`}
            >
              <div
                className="h-52 min-w-0 mt-4"
                role="img"
                aria-label={`${title}. Exact values are in the chart data table below.`}
              >
                <ChartFrame height={208}>
                  <BarChart
                    data={distribution}
                    layout="vertical"
                    margin={{ left: 0, right: 24, top: 4, bottom: 0 }}
                  >
                    <CartesianGrid stroke={cs.c.grid} horizontal={false} />
                    <XAxis type="number" allowDecimals={false} {...cs.axisProps} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={115}
                      {...cs.axisProps}
                      tickFormatter={(s: string) =>
                        s.length > 18 ? `${s.slice(0, 16)}…` : s
                      }
                    />
                    <Tooltip contentStyle={cs.tooltipStyle} cursor={cs.cursor} />
                    <Bar
                      dataKey="count"
                      name="Records"
                      fill={cs.c.accent}
                      radius={[0, 3, 3, 0]}
                      maxBarSize={22}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ChartFrame>
              </div>
            </ChartPanel>
            {date && (
              <ChartPanel
                title={dateLabel}
                subtitle={`${months} calendar months${undated ? ` · ${undated} without a valid date excluded` : ""}`}
                action={
                  <select
                    aria-label={`${title} trend period`}
                    className="select w-auto"
                    value={months}
                    onChange={(e) => setMonths(Number(e.target.value))}
                  >
                    <option value={6}>6 months</option>
                    <option value={12}>12 months</option>
                  </select>
                }
              >
                <div
                  className="h-52 min-w-0 mt-4"
                  role="img"
                  aria-label={`${dateLabel}. Exact monthly counts are in the chart data table below.`}
                >
                  <ChartFrame height={208}>
                    <LineChart
                      data={trend}
                      margin={{ left: -18, right: 12, top: 8, bottom: 0 }}
                    >
                      <CartesianGrid stroke={cs.c.grid} vertical={false} />
                      <XAxis dataKey="name" {...cs.axisProps} minTickGap={24} />
                      <YAxis allowDecimals={false} {...cs.axisProps} />
                      <Tooltip contentStyle={cs.tooltipStyle} />
                      <Line
                        dataKey="count"
                        name="Records"
                        type="linear"
                        stroke={cs.c.accent}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ChartFrame>
                </div>
              </ChartPanel>
            )}
          </div>
          <details className="border-t border-border px-5 py-3 text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              View chart data
            </summary>
            <div className="flex flex-wrap gap-6 mt-3">
              {[
                { label: title, rows: distribution },
                ...(date ? [{ label: dateLabel, rows: trend }] : []),
              ].map((table) => (
                <div key={table.label} className="flex-1 min-w-48">
                  <table className="w-full text-left">
                    <caption className="text-left font-medium mb-2">
                      {table.label}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Group</th>
                        <th scope="col" className="text-right">
                          Records
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.map((row) => (
                        <tr key={row.name}>
                          <th scope="row" className="font-normal py-1">
                            {row.name}
                          </th>
                          <td className="text-right tabular-nums">{row.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button
                    className="btn-ghost mt-2"
                    onClick={() => void downloadCsv(`filey-${table.label}`, table.rows).catch((error) => toast.error(error instanceof Error ? error.message : "Could not export CSV."))}
                  >
                    Export chart CSV
                  </button>
                </div>
              ))}
            </div>
          </details>
        </>
      )}
    </details>
  );
}
