// Pipeline intelligence: the layer that turns a list of deals into an answer to
// "what is actually going to close, and what needs me today".
//
// Everything here is a pure function over rows the CRM already has — no model,
// no network — so a forecast means the same thing every time you open it, and
// a deal flagged at risk can always be traced to the rule that flagged it.

import type { Activity, CrmTask, Opportunity } from "./api";

/** Stages a deal has left when it is no longer in play. */
export const CLOSED_WON = "won";
export const CLOSED_LOST = "lost";
export const isOpen = (o: Pick<Opportunity, "stage">) =>
  o.stage !== CLOSED_WON && o.stage !== CLOSED_LOST;

const monthKey = (iso: string) => iso.slice(0, 7);

const daysBetween = (fromIso: string, toIso: string) =>
  Math.floor(
    (new Date(`${toIso.slice(0, 10)}T00:00:00`).getTime() -
      new Date(`${fromIso.slice(0, 10)}T00:00:00`).getTime()) /
      86_400_000
  );

export interface ForecastMonth {
  /** yyyy-mm */
  month: string;
  /** Already won and closed in this month — money you actually have. */
  committed: number;
  /** Open deals in this month, each multiplied by its own probability. */
  weighted: number;
  /** Open deals in this month at full value — the everything-lands number. */
  bestCase: number;
  openCount: number;
}

/**
 * Month-by-month forecast from each deal's expected close date.
 *
 * Three numbers rather than one, because a single "pipeline value" is the most
 * misleading figure in any CRM: it counts a 10%-probability deal the same as a
 * signed one. Committed is money in, weighted is the honest expectation, best
 * case is the ceiling.
 */
export function forecast(
  opps: Opportunity[],
  today: string,
  monthsAhead = 6
): ForecastMonth[] {
  const start = monthKey(today);
  const months: string[] = [];
  const d = new Date(`${today.slice(0, 8)}01T00:00:00`);
  for (let i = 0; i < monthsAhead; i++) {
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    d.setMonth(d.getMonth() + 1);
  }

  const empty = (month: string): ForecastMonth => ({
    month,
    committed: 0,
    weighted: 0,
    bestCase: 0,
    openCount: 0,
  });
  const byMonth = new Map(months.map((m) => [m, empty(m)]));

  for (const o of opps) {
    const value = Number(o.value) || 0;
    if (o.stage === CLOSED_WON) {
      // A won deal belongs to when it closed, not when someone hoped it would.
      const key = monthKey(o.closed_at || o.expected_close || o.created_at);
      const row = byMonth.get(key);
      if (row) row.committed += value;
      continue;
    }
    if (o.stage === CLOSED_LOST) continue;

    // An open deal with no date, or one whose date has already passed, is still
    // real work — fold it into the current month rather than dropping it, which
    // is how pipeline quietly goes missing.
    const raw = o.expected_close ? monthKey(o.expected_close) : start;
    const key = raw < start ? start : raw;
    const row = byMonth.get(key);
    if (!row) continue; // beyond the horizon
    const p = Math.max(0, Math.min(100, Number(o.probability) || 0));
    row.weighted += (value * p) / 100;
    row.bestCase += value;
    row.openCount += 1;
  }

  return months.map((m) => {
    const r = byMonth.get(m)!;
    return {
      ...r,
      committed: Math.round(r.committed * 100) / 100,
      weighted: Math.round(r.weighted * 100) / 100,
      bestCase: Math.round(r.bestCase * 100) / 100,
    };
  });
}

export type RiskKind = "no_next_step" | "stalled" | "overdue_close" | "no_value";

export interface DealRisk {
  kind: RiskKind;
  /** Shown to the user as-is — a flag with no reason is just noise. */
  reason: string;
}

export interface DealHealth {
  opportunity: Opportunity;
  risks: DealRisk[];
  daysSinceTouched: number;
  hasNextStep: boolean;
}

export interface HealthOptions {
  /** Days without an update before a deal counts as stalled. */
  stalledAfterDays?: number;
}

/**
 * Flag open deals that need attention. Deliberately a small set of rules that a
 * salesperson would agree with on sight — a deal nobody has a next step for is
 * the single most common way pipeline dies quietly.
 */
export function dealHealth(
  opps: Opportunity[],
  activities: Activity[],
  tasks: CrmTask[],
  today: string,
  opts: HealthOptions = {}
): DealHealth[] {
  const stalledAfter = opts.stalledAfterDays ?? 21;

  // A deal is addressed as target_type "deal" in crm_activities / crm_tasks —
  // there is no "opportunity" member of CrmTargetType, and filtering on that
  // matched nothing, which flagged every open deal as neglected.
  // Counts as a next step only while still open and not already in the past.
  const withNextStep = new Set<number>();
  for (const a of activities) {
    if (a.target_type !== "deal" || a.target_id == null) continue;
    if (a.done) continue;
    if (a.due_date && a.due_date < today) continue;
    withNextStep.add(a.target_id);
  }
  for (const t of tasks) {
    if (t.target_type !== "deal" || t.target_id == null) continue;
    if (t.status === "done" || t.status === "cancelled") continue;
    if (t.due_date && t.due_date < today) continue;
    withNextStep.add(t.target_id);
  }

  const out: DealHealth[] = [];
  for (const o of opps) {
    if (!isOpen(o)) continue;
    const touched = o.updated_at || o.created_at;
    const daysSinceTouched = touched ? Math.max(0, daysBetween(touched, today)) : 0;
    const hasNextStep = withNextStep.has(o.id);
    const risks: DealRisk[] = [];

    if (!hasNextStep)
      risks.push({
        kind: "no_next_step",
        reason: "Nothing scheduled — no call, task or meeting on the books",
      });

    if (daysSinceTouched >= stalledAfter)
      risks.push({
        kind: "stalled",
        reason: `No movement in ${daysSinceTouched} days`,
      });

    if (o.expected_close && o.expected_close < today)
      risks.push({
        kind: "overdue_close",
        reason: `Expected to close ${Math.abs(daysBetween(o.expected_close, today))} days ago and still open`,
      });

    if (!(Number(o.value) > 0))
      risks.push({
        kind: "no_value",
        reason: "No value set, so it counts for nothing in the forecast",
      });

    if (risks.length) out.push({ opportunity: o, risks, daysSinceTouched, hasNextStep });
  }

  // Worst first: most risks, then biggest deal — a stalled AED 90k beats a
  // stalled AED 900.
  return out.sort(
    (a, b) =>
      b.risks.length - a.risks.length ||
      (Number(b.opportunity.value) || 0) - (Number(a.opportunity.value) || 0)
  );
}

export interface WinLoss {
  won: number;
  lost: number;
  /** Percentage of decided deals that were won. Null when nothing has closed. */
  winRate: number | null;
  wonValue: number;
  lostValue: number;
  /** Mean value of a won deal. */
  averageWon: number;
  /** Mean days from created to closed, won deals only. Null when unknown. */
  averageCycleDays: number | null;
  /** Most common close_reason on lost deals, commonest first. */
  lossReasons: { reason: string; count: number }[];
}

/**
 * Win/loss summary. Rate is computed over *decided* deals only — including open
 * ones in the denominator would make a healthy growing pipeline look like a
 * worsening win rate, which is the opposite of the truth.
 */
export function winLoss(opps: Opportunity[]): WinLoss {
  const won = opps.filter((o) => o.stage === CLOSED_WON);
  const lost = opps.filter((o) => o.stage === CLOSED_LOST);
  const decided = won.length + lost.length;

  const wonValue = won.reduce((s, o) => s + (Number(o.value) || 0), 0);
  const lostValue = lost.reduce((s, o) => s + (Number(o.value) || 0), 0);

  const cycles = won
    .map((o) => (o.closed_at ? daysBetween(o.created_at, o.closed_at) : null))
    .filter((d): d is number => d != null && d >= 0);

  const reasons = new Map<string, number>();
  for (const o of lost) {
    const r = (o.close_reason || "").trim();
    if (!r) continue;
    reasons.set(r, (reasons.get(r) ?? 0) + 1);
  }

  return {
    won: won.length,
    lost: lost.length,
    winRate: decided ? Math.round((won.length / decided) * 100) : null,
    wonValue: Math.round(wonValue * 100) / 100,
    lostValue: Math.round(lostValue * 100) / 100,
    averageWon: won.length ? Math.round((wonValue / won.length) * 100) / 100 : 0,
    averageCycleDays: cycles.length
      ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length)
      : null,
    lossReasons: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
  };
}

/** Value sitting in each open stage — the shape of the funnel right now. */
export function stageBreakdown(
  opps: Opportunity[]
): { stage: string; count: number; value: number }[] {
  const by = new Map<string, { count: number; value: number }>();
  for (const o of opps) {
    if (!isOpen(o)) continue;
    const cur = by.get(o.stage) ?? { count: 0, value: 0 };
    cur.count += 1;
    cur.value += Number(o.value) || 0;
    by.set(o.stage, cur);
  }
  return [...by.entries()]
    .map(([stage, v]) => ({ stage, ...v, value: Math.round(v.value * 100) / 100 }))
    .sort((a, b) => b.value - a.value);
}
