import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, Target, TrendingUp } from "lucide-react";

import { crm, type Activity, type CrmTask, type Opportunity } from "../lib/api";
import { forecast, dealHealth, winLoss, stageBreakdown, isOpen } from "../lib/pipeline";
import { aed, todayYmd } from "../lib/format";
import { Badge, InfoCard } from "./ui";

/* Forecast, deal health and win/loss — the read-only view of what the pipeline
 * is actually going to do. All three come from lib/pipeline, which is pure, so
 * anything shown here can be traced back to a rule rather than a hunch. */

const monthLabel = (key: string) =>
  new Date(`${key}-01T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    year: "2-digit",
  });

const RISK_TONE = {
  no_next_step: "warn",
  stalled: "danger",
  overdue_close: "warn",
  no_value: "info",
} as const;

export default function ForecastPanel({
  opps,
  activities,
  onOpen,
}: {
  opps: Opportunity[];
  activities: Activity[];
  onOpen: (o: Opportunity) => void;
}) {
  const today = todayYmd();
  // Tasks live in their own table; a deal with a task but no activity is still
  // covered, so both have to be read before anything is called neglected.
  const [tasks, setTasks] = useState<CrmTask[]>([]);
  useEffect(() => {
    crm
      .tasks()
      .then(setTasks)
      .catch(() => setTasks([]));
  }, []);

  const months = useMemo(() => forecast(opps, today, 6), [opps, today]);
  const health = useMemo(
    () => dealHealth(opps, activities, tasks, today),
    [opps, activities, tasks, today]
  );
  const wl = useMemo(() => winLoss(opps), [opps]);
  const stages = useMemo(() => stageBreakdown(opps), [opps]);

  const openCount = opps.filter(isOpen).length;
  const peak = Math.max(1, ...months.map((m) => m.committed + m.bestCase));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <InfoCard
        title="Forecast"
        action={<TrendingUp size={15} className="text-brand-400" />}
        className="lg:col-span-2"
      >
        <p className="text-[12.5px] text-brand-500">
          Weighted multiplies each open deal by its own probability - the number worth
          planning against. Best case assumes everything lands.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[12px] text-muted-foreground">
                <th className="pb-2 font-medium">Month</th>
                <th className="pb-2 font-medium text-right">Committed</th>
                <th className="pb-2 font-medium text-right">Weighted</th>
                <th className="pb-2 font-medium text-right">Best case</th>
                <th className="pb-2 font-medium text-right">Open</th>
                <th className="pb-2 font-medium w-1/4" />
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month} className="border-t border-border">
                  <td className="py-2 font-medium text-ink">{monthLabel(m.month)}</td>
                  <td className="py-2 text-right tabular-nums text-success">
                    {m.committed ? aed(m.committed) : "—"}
                  </td>
                  <td className="py-2 text-right tabular-nums font-semibold text-foreground">
                    {m.weighted ? aed(m.weighted) : "—"}
                  </td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">
                    {m.bestCase ? aed(m.bestCase) : "—"}
                  </td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">
                    {m.openCount || "—"}
                  </td>
                  <td className="py-2 pl-3">
                    {/* Committed then weighted, on one bar scaled across every
                        month so the columns are comparable at a glance. */}
                    <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="bg-success"
                        style={{ width: `${(m.committed / peak) * 100}%` }}
                      />
                      <div
                        className="bg-primary-400"
                        style={{ width: `${(m.weighted / peak) * 100}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </InfoCard>

      <InfoCard
        title={`Needs attention (${health.length})`}
        action={<AlertTriangle size={15} className="text-brand-400" />}
      >
        {health.length === 0 ? (
          <p className="text-sm text-brand-500">
            {openCount
              ? "Every open deal has a next step and recent movement."
              : "No open deals yet."}
          </p>
        ) : (
          <ul className="divide-y divide-brand-100 dark:divide-white/8">
            {health.slice(0, 8).map((h) => (
              <li key={h.opportunity.id}>
                <button
                  onClick={() => onOpen(h.opportunity)}
                  className="w-full py-2.5 text-left transition hover:bg-brand-50 dark:hover:bg-white/5 rounded-lg px-1.5 -mx-1.5 cursor-pointer"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium text-ink">
                      {h.opportunity.title || h.opportunity.customer_name}
                    </span>
                    <span className="shrink-0 text-[12.5px] tabular-nums text-muted-foreground">
                      {aed(h.opportunity.value)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {h.risks.map((r) => (
                      <Badge key={r.kind} tone={RISK_TONE[r.kind]}>
                        {r.reason}
                      </Badge>
                    ))}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </InfoCard>

      <InfoCard
        title="Win / loss"
        action={<Target size={15} className="text-brand-400" />}
      >
        {wl.winRate == null ? (
          <p className="text-sm text-brand-500">
            Nothing has closed yet - mark a deal won or lost and this fills in.
          </p>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-[26px] font-semibold tabular-nums text-foreground">
                {wl.winRate}%
              </span>
              <span className="text-[12.5px] text-brand-500">
                won - {wl.won} of {wl.won + wl.lost} decided
              </span>
            </div>
            <dl className="mt-3 space-y-1.5 text-[13px]">
              <Row label="Won value" value={aed(wl.wonValue)} />
              <Row label="Average deal" value={aed(wl.averageWon)} />
              <Row
                label="Average cycle"
                value={wl.averageCycleDays == null ? "—" : `${wl.averageCycleDays} days`}
              />
              <Row label="Lost value" value={aed(wl.lostValue)} />
            </dl>
            {wl.lossReasons.length > 0 && (
              <div className="mt-3 border-t border-border pt-2">
                <p className="text-[12px] text-muted-foreground">Why deals were lost</p>
                <ul className="mt-1 space-y-0.5">
                  {wl.lossReasons.slice(0, 4).map((r) => (
                    <li key={r.reason} className="text-[12.5px] text-ink">
                      {r.reason} <span className="text-brand-400">× {r.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </InfoCard>

      <InfoCard
        title="Open pipeline by stage"
        action={<CalendarClock size={15} className="text-brand-400" />}
        className="lg:col-span-2"
      >
        {stages.length === 0 ? (
          <p className="text-sm text-brand-500">No open deals.</p>
        ) : (
          <ul className="space-y-2">
            {stages.map((s) => (
              <li key={s.stage} className="flex items-center gap-3">
                <span className="w-32 shrink-0 text-[13px] capitalize text-ink">
                  {s.stage}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary-400"
                    style={{ width: `${(s.value / (stages[0].value || 1)) * 100}%` }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right text-[12.5px] tabular-nums text-muted-foreground">
                  {s.count}
                </span>
                <span className="w-28 shrink-0 text-right text-[13px] tabular-nums font-medium text-foreground">
                  {aed(s.value)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </InfoCard>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-brand-500">{label}</dt>
      <dd className="tabular-nums text-ink">{value}</dd>
    </div>
  );
}
