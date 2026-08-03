import { describe, it, expect } from "vitest";
import { forecast, dealHealth, winLoss, stageBreakdown, isOpen } from "../pipeline";
import type { Activity, CrmTask, Opportunity } from "../api";

const TODAY = "2026-08-03";

const opp = (o: Partial<Opportunity> & { id: number }): Opportunity =>
  ({
    title: "Deal",
    customer_name: "Acme",
    stage: "qualification",
    value: 0,
    probability: 50,
    created_at: "2026-01-01T00:00:00Z",
    ...o,
  }) as Opportunity;

const activity = (a: Partial<Activity> & { id: number }): Activity =>
  ({
    kind: "task",
    subject: "Call",
    done: false,
    created_at: TODAY,
    ...a,
  }) as Activity;

const task = (t: Partial<CrmTask> & { id: number }): CrmTask =>
  ({ title: "Follow up", status: "open", created_at: TODAY, ...t }) as CrmTask;

describe("forecast", () => {
  it("separates committed, weighted and best case", () => {
    const rows = forecast(
      [
        opp({ id: 1, stage: "won", value: 10_000, closed_at: "2026-08-10" }),
        opp({ id: 2, value: 20_000, probability: 25, expected_close: "2026-08-20" }),
        opp({ id: 3, value: 40_000, probability: 75, expected_close: "2026-09-05" }),
        opp({ id: 4, stage: "lost", value: 99_000, expected_close: "2026-08-20" }),
      ],
      TODAY,
      3
    );
    const aug = rows.find((r) => r.month === "2026-08")!;
    expect(aug.committed).toBe(10_000);
    expect(aug.weighted).toBe(5_000); // 20k × 25%
    expect(aug.bestCase).toBe(20_000); // the lost deal contributes nothing
    expect(aug.openCount).toBe(1);

    const sep = rows.find((r) => r.month === "2026-09")!;
    expect(sep.weighted).toBe(30_000); // 40k × 75%
  });

  it("pulls a past-due open deal into this month rather than dropping it", () => {
    const rows = forecast(
      [opp({ id: 1, value: 5_000, probability: 100, expected_close: "2026-05-01" })],
      TODAY,
      3
    );
    expect(rows[0].month).toBe("2026-08");
    expect(rows[0].weighted).toBe(5_000);
  });

  it("treats an open deal with no date as this month", () => {
    const rows = forecast([opp({ id: 1, value: 1_000, probability: 50 })], TODAY, 2);
    expect(rows[0].weighted).toBe(500);
  });

  it("files a won deal by when it closed, not when it was forecast", () => {
    const rows = forecast(
      [
        opp({
          id: 1,
          stage: "won",
          value: 7_000,
          expected_close: "2026-08-01",
          closed_at: "2026-09-15",
        }),
      ],
      TODAY,
      3
    );
    expect(rows.find((r) => r.month === "2026-08")!.committed).toBe(0);
    expect(rows.find((r) => r.month === "2026-09")!.committed).toBe(7_000);
  });

  it("clamps a nonsense probability instead of inventing money", () => {
    const rows = forecast(
      [opp({ id: 1, value: 1_000, probability: 400, expected_close: "2026-08-10" })],
      TODAY,
      2
    );
    expect(rows[0].weighted).toBe(1_000);
  });

  it("returns the requested number of months, even when empty", () => {
    expect(forecast([], TODAY, 6)).toHaveLength(6);
    expect(forecast([], TODAY, 6)[0].month).toBe("2026-08");
    expect(forecast([], TODAY, 6)[5].month).toBe("2027-01");
  });
});

describe("dealHealth", () => {
  const open = opp({
    id: 1,
    value: 5_000,
    updated_at: TODAY,
    expected_close: "2026-12-01",
  });

  it("flags a deal with nothing scheduled", () => {
    const [h] = dealHealth([open], [], [], TODAY);
    expect(h.hasNextStep).toBe(false);
    expect(h.risks.map((r) => r.kind)).toContain("no_next_step");
  });

  it("counts an open future task as a next step", () => {
    const health = dealHealth(
      [open],
      [],
      [task({ id: 9, target_type: "deal", target_id: 1, due_date: "2026-08-20" })],
      TODAY
    );
    expect(health).toHaveLength(0); // healthy — nothing to report
  });

  it("does not count a done or overdue task as a next step", () => {
    const done = dealHealth(
      [open],
      [],
      [task({ id: 9, target_type: "deal", target_id: 1, status: "done" })],
      TODAY
    );
    expect(done[0].hasNextStep).toBe(false);

    const past = dealHealth(
      [open],
      [activity({ id: 8, target_type: "deal", target_id: 1, due_date: "2026-07-01" })],
      [],
      TODAY
    );
    expect(past[0].hasNextStep).toBe(false);
  });

  it("flags a stalled deal with the day count in the reason", () => {
    const stale = opp({
      id: 2,
      value: 1_000,
      updated_at: "2026-06-01",
      expected_close: "2026-12-01",
    });
    const [h] = dealHealth([stale], [], [], TODAY);
    const stalled = h.risks.find((r) => r.kind === "stalled")!;
    expect(stalled.reason).toMatch(/63 days/);
  });

  it("respects a custom stalled threshold", () => {
    const o = opp({
      id: 3,
      value: 1,
      updated_at: "2026-07-30",
      expected_close: "2026-12-01",
    });
    expect(
      dealHealth([o], [], [], TODAY, { stalledAfterDays: 2 })[0].risks.map((r) => r.kind)
    ).toContain("stalled");
    expect(
      dealHealth([o], [], [], TODAY, { stalledAfterDays: 90 })[0].risks.map((r) => r.kind)
    ).not.toContain("stalled");
  });

  it("flags a close date that has already passed", () => {
    const late = opp({
      id: 4,
      value: 100,
      updated_at: TODAY,
      expected_close: "2026-07-04",
    });
    const [h] = dealHealth([late], [], [], TODAY);
    expect(h.risks.find((r) => r.kind === "overdue_close")!.reason).toMatch(
      /30 days ago/
    );
  });

  it("never reports a won or lost deal", () => {
    expect(
      dealHealth(
        [opp({ id: 5, stage: "won" }), opp({ id: 6, stage: "lost" })],
        [],
        [],
        TODAY
      )
    ).toEqual([]);
  });

  it("puts the worst deal first — most risks, then biggest", () => {
    const health = dealHealth(
      [
        opp({ id: 1, value: 90_000, updated_at: TODAY, expected_close: "2026-12-01" }),
        opp({
          id: 2,
          value: 500,
          updated_at: "2026-01-01",
          expected_close: "2026-01-05",
        }),
        opp({ id: 3, value: 80_000, updated_at: TODAY, expected_close: "2026-12-01" }),
      ],
      [],
      [],
      TODAY
    );
    expect(health[0].opportunity.id).toBe(2); // 3 risks
    expect(health[1].opportunity.id).toBe(1); // 1 risk, bigger
    expect(health[2].opportunity.id).toBe(3);
  });
});

describe("winLoss", () => {
  const deals = [
    opp({
      id: 1,
      stage: "won",
      value: 10_000,
      created_at: "2026-01-01",
      closed_at: "2026-01-31",
    }),
    opp({
      id: 2,
      stage: "won",
      value: 30_000,
      created_at: "2026-02-01",
      closed_at: "2026-03-03",
    }),
    opp({ id: 3, stage: "lost", value: 5_000, close_reason: "Price" }),
    opp({ id: 4, stage: "lost", value: 2_000, close_reason: "Price" }),
    opp({ id: 5, stage: "lost", value: 1_000, close_reason: "Timing" }),
    opp({ id: 6, value: 999_999 }), // still open — must not affect the rate
  ];

  it("rates over decided deals only, so open pipeline never drags it down", () => {
    const w = winLoss(deals);
    expect(w.won).toBe(2);
    expect(w.lost).toBe(3);
    expect(w.winRate).toBe(40); // 2 of 5 decided, not 2 of 6
  });

  it("reports value, average size and mean cycle length", () => {
    const w = winLoss(deals);
    expect(w.wonValue).toBe(40_000);
    expect(w.lostValue).toBe(8_000);
    expect(w.averageWon).toBe(20_000);
    expect(w.averageCycleDays).toBe(30); // 30 and 30 days
  });

  it("ranks loss reasons, commonest first, ignoring blanks", () => {
    expect(winLoss(deals).lossReasons).toEqual([
      { reason: "Price", count: 2 },
      { reason: "Timing", count: 1 },
    ]);
  });

  it("says null rather than 0% when nothing has closed yet", () => {
    const w = winLoss([opp({ id: 1, value: 100 })]);
    expect(w.winRate).toBeNull();
    expect(w.averageCycleDays).toBeNull();
  });
});

describe("stageBreakdown", () => {
  it("totals open deals per stage, biggest first", () => {
    const rows = stageBreakdown([
      opp({ id: 1, stage: "proposal", value: 5_000 }),
      opp({ id: 2, stage: "qualification", value: 9_000 }),
      opp({ id: 3, stage: "proposal", value: 1_000 }),
      opp({ id: 4, stage: "won", value: 99_000 }),
    ]);
    expect(rows).toEqual([
      { stage: "qualification", count: 1, value: 9_000 },
      { stage: "proposal", count: 2, value: 6_000 },
    ]);
  });
});

describe("isOpen", () => {
  it("is true for anything not won or lost", () => {
    expect(isOpen({ stage: "negotiation" })).toBe(true);
    expect(isOpen({ stage: "won" })).toBe(false);
    expect(isOpen({ stage: "lost" })).toBe(false);
  });
});
