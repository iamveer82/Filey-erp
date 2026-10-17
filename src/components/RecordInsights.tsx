import { SelectMenu } from "./ui-menu";
import { toast } from "./Toaster";
import { useState } from "react";
import { recordInsights } from "../lib/recordInsights";
import { ChartPanel, useChartStyle } from "./charts";
import { downloadCsv } from "../lib/csv";
import { BarSeriesChart } from "./modernCharts";

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
                <BarSeriesChart
                  data={distribution}
                  xKey="name"
                  height={208}
                  xFormatter={(s) => (s.length > 14 ? `${s.slice(0, 12)}…` : s)}
                  barColors={cs.c.series}
                  series={[{ key: "count", label: "Records", color: cs.c.series[0] }]}
                />
              </div>
            </ChartPanel>
            {date && (
              <ChartPanel
                title={dateLabel}
                subtitle={`${months} calendar months${undated ? ` · ${undated} without a valid date excluded` : ""}`}
                action={
                  <SelectMenu
                    value={String(months)}
                    onChange={(nextValue) => setMonths(Number(nextValue))}
                    options={[
                      { value: String(6), label: "6 months" },
                      { value: String(12), label: "12 months" },
                    ]}
                    ariaLabel={`${title} trend period`}
                    className="w-auto"
                  />
                }
              >
                <div
                  className="h-52 min-w-0 mt-4"
                  role="img"
                  aria-label={`${dateLabel}. Exact monthly counts are in the chart data table below.`}
                >
                  <BarSeriesChart
                    data={trend}
                    xKey="name"
                    height={208}
                    series={[{ key: "count", label: "Records", color: cs.c.series[1] }]}
                  />
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
