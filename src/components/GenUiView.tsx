/* Native widgets Filey AI can answer with (show_view), drawn by the app itself:
 * OpenIntelligentUI's native components (charts, tables, plan cards), plus
 * stats and one-click choices, in a vivid palette rather than greys. */
import { useId } from "react";
import { Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Check, Circle, CircleDot } from "lucide-react";
import { useChartStyle } from "./charts";
import { cn } from "../lib/format";
import { GEN_UI_PALETTE as P, type GenUiViewSpec } from "../lib/genUi";
import { BarSeriesChart, DonutChart, RadialSplitChart } from "./modernCharts";

const fmt = (v: unknown, unit?: string) =>
  typeof v === "number" ? `${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ""}` : String(v ?? "");
const color = (i: number) => P[i % P.length];

/** The thin colour strip and title every card and widget opens with. */
export function GenUiHeader({ title, seed = 0, children }: { title?: string; seed?: number; children?: React.ReactNode }) {
  return <>
    <div className="h-1" style={{ background: `linear-gradient(90deg, ${color(seed)}, ${color(seed + 3)}, ${color(seed + 5)})` }} />
    {(title || children) && (
      <div className="flex items-center gap-1 border-b border-border py-1.5 pl-3.5 pr-1.5">
        <div className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{title}</div>
        {children}
      </div>
    )}
  </>;
}

export default function GenUiView({ view, onPrompt }: { view: GenUiViewSpec; onPrompt?: (text: string) => void }) {
  return (
    <div className="my-2 overflow-hidden rounded-xl border border-border bg-card">
      <GenUiHeader title={view.title} seed={view.view.length} />
      <div className="p-3.5"><Body view={view} onPrompt={onPrompt} /></div>
    </div>
  );
}

function Body({ view, onPrompt }: { view: GenUiViewSpec; onPrompt?: (text: string) => void }) {
  const cs = useChartStyle();
  const id = useId().replace(/:/g, "");
  const tooltip = {
    contentStyle: { background: cs.c.tooltipBg, border: `1px solid ${cs.c.tooltipBorder}`, borderRadius: 10, color: cs.c.tooltipFg, fontSize: 12 },
    cursor: cs.cursor,
    formatter: (v: unknown) => fmt(v, view.unit),
  };
  const fades = (n: number) => (
    <defs>
      {Array.from({ length: n }, (_, i) => (
        <linearGradient key={i} id={`${id}-${i}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color(i)} stopOpacity={0.95} />
          <stop offset="100%" stopColor={color(i)} stopOpacity={0.04} />
        </linearGradient>
      ))}
    </defs>
  );

  if (view.view === "bar") {
    const series = view.series ?? [];
    const rows = (view.labels ?? []).map((label, i) => Object.fromEntries([["label", label], ...series.map((s, j) => [`s${j}`, s.values[i]])]));
    return <BarSeriesChart data={rows} xKey="label" stacked={view.stacked} valueFormatter={v => fmt(v, view.unit)}
      barColors={series.length === 1 ? P : undefined} series={series.map((s, j) => ({ key: `s${j}`, label: s.name, color: color(j) }))} />;
  }

  if (view.view === "line" || view.view === "area") {
    const series = view.series ?? [];
    const data = (view.labels ?? []).map((label, i) => Object.fromEntries([["label", label], ...series.map(s => [s.name, s.values[i]])]));
    const axes = <>
      <CartesianGrid stroke={cs.c.grid} vertical={false} />
      <XAxis dataKey="label" {...cs.axisProps} />
      <YAxis {...cs.axisProps} width={48} tickFormatter={(v: number) => v.toLocaleString(undefined, { notation: "compact" })} />
      <Tooltip {...tooltip} />
      {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
    </>;
    return (
      <div className="h-64 w-full min-w-0" role="img" aria-label={`${view.title ?? "Chart"}: ${series.map(s => s.name).join(", ")}`}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          {view.view === "line" ? (
            <LineChart data={data}>
              {axes}
              {series.map((s, i) => <Line key={s.name} dataKey={s.name} stroke={color(i)} strokeWidth={2.5} dot={{ r: 3, fill: color(i) }} activeDot={{ r: 5 }} type="monotone" />)}
            </LineChart>
          ) : (
            <AreaChart data={data}>
              {fades(series.length)}
              {axes}
              {series.map((s, i) => <Area key={s.name} dataKey={s.name} stroke={color(i)} strokeWidth={2.5} fill={`url(#${id}-${i})`} type="monotone" />)}
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
    );
  }

  if (view.view === "pie" || view.view === "radial") {
    const parts = (view.labels ?? []).map((label, i) => ({ key: `p${i}`, label, value: view.values?.[i] ?? 0, color: color(i) }));
    if (view.view === "radial") {
      const total = parts.reduce((n, p) => n + p.value, 0);
      return <>
        <RadialSplitChart parts={parts} centerValue={fmt(total)} centerLabel={view.center ?? view.unit ?? "total"} valueFormatter={v => fmt(v, view.unit)} />
        <ul className="mt-1 grid gap-1 text-[12.5px]">
          {parts.map(p => (
            <li key={p.key} className="flex items-center gap-2 px-1">
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: p.color }} />
              <span className="flex-1 truncate">{p.label}</span>
              <span className="tabular-nums text-muted-foreground">{fmt(p.value, view.unit)}{total ? ` · ${Math.round((p.value / total) * 100)}%` : ""}</span>
            </li>
          ))}
        </ul>
      </>;
    }
    return <DonutChart data={parts} valueFormatter={v => fmt(v, view.unit)} />;
  }

  if (view.view === "table") {
    const numeric = (view.columns ?? []).map((_, c) => (view.rows ?? []).every(r => r[c] == null || typeof r[c] === "number"));
    return (
      <div className="max-h-96 overflow-auto rounded-lg border border-border">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0" style={{ background: `${P[0]}1a` }}>
            <tr className="text-left">
              {view.columns?.map((col, c) => <th key={c} className={cn("px-2.5 py-2 font-semibold", numeric[c] && "text-right")} style={{ color: P[0] }}>{col}</th>)}
            </tr>
          </thead>
          <tbody>
            {view.rows?.map((row, r) => (
              <tr key={r} className="border-t border-border even:bg-muted/50">
                {view.columns?.map((_, c) => (
                  <td key={c} className={cn("px-2.5 py-1.5", numeric[c] && "text-right tabular-nums", typeof row[c] === "number" && (row[c] as number) < 0 && "text-danger")}>{fmt(row[c])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!view.rows?.length && <p className="py-4 text-center text-[13px] text-muted-foreground">No rows.</p>}
      </div>
    );
  }

  if (view.view === "stats") {
    return (
      <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
        {view.items?.map((item, i) => (
          <div key={i} className="relative overflow-hidden rounded-xl border px-3.5 py-3" style={{ background: `${color(i)}12`, borderColor: `${color(i)}38` }}>
            <span className="absolute inset-y-0 left-0 w-1" style={{ background: color(i) }} />
            <div className="text-[12px] font-medium" style={{ color: color(i) }}>{item.label}</div>
            <div className="mt-0.5 text-[20px] font-semibold tabular-nums tracking-tight text-foreground">{fmt(item.value, view.unit)}</div>
            {item.change && (
              <div className={cn("mt-0.5 inline-block rounded-full px-1.5 text-[11.5px] font-medium",
                item.tone === "good" ? "bg-success/15 text-success" : item.tone === "bad" ? "bg-danger/15 text-danger" : "text-muted-foreground")}>
                {item.change}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (view.view === "steps") {
    return (
      <ol className="space-y-1.5">
        {view.items?.map((item, i) => {
          const tint = item.status === "done" ? "#10b981" : item.status === "doing" ? P[0] : undefined;
          return (
            <li key={i} className="flex gap-2.5 rounded-lg px-2.5 py-2" style={tint ? { background: `${tint}12` } : undefined}>
              <span className="mt-0.5 shrink-0" style={{ color: tint }}>
                {item.status === "done" ? <Check size={16} /> : item.status === "doing" ? <CircleDot size={16} /> : <Circle size={16} className="text-muted-foreground" />}
              </span>
              <div className="min-w-0">
                <div className={cn("text-[13.5px] font-medium", item.status === "done" && "text-muted-foreground line-through")}>{item.title ?? item.label}</div>
                {item.detail && <div className="text-[12.5px] text-muted-foreground">{item.detail}</div>}
              </div>
            </li>
          );
        })}
      </ol>
    );
  }

  // choices
  return (
    <div>
      {view.question && <p className="mb-2.5 text-[13.5px]">{view.question}</p>}
      <div className="flex flex-wrap gap-2">
        {view.options?.map((option, i) => (
          <button key={option} type="button" disabled={!onPrompt} onClick={() => onPrompt?.(option)}
            className="rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-[filter,transform] hover:brightness-95 active:scale-[0.97] disabled:opacity-50"
            style={{ background: `${color(i)}16`, borderColor: `${color(i)}55`, color: color(i) }}>
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}
