// The agent's memory of its own competence — see agentJournal.ts.
import { describe, it, expect, beforeEach } from "vitest";
import {
  recordRun,
  journalDigest,
  listRuns,
  clearJournal,
  failuresFrom,
} from "../agentJournal";

beforeEach(() => {
  localStorage.clear();
  clearJournal();
});

describe("failuresFrom", () => {
  it("picks out tool results carrying an error", () => {
    expect(
      failuresFrom([
        { type: "tool_call", name: "adjust_stock" },
        { type: "tool_result", name: "adjust_stock", result: { error: "no such product" } },
        { type: "tool_result", name: "get_stats", result: { revenue: 10 } },
      ])
    ).toEqual([{ tool: "adjust_stock", error: "no such product" }]);
  });

  it("records a repeatedly-failing tool once", () => {
    // Five identical failures teach the next run one thing, not five.
    const events = Array.from({ length: 5 }, () => ({
      type: "tool_result",
      name: "email_invoice",
      result: { error: "SMTP not configured" },
    }));
    expect(failuresFrom(events)).toHaveLength(1);
  });

  it("is not fooled by a result that merely mentions the word error", () => {
    expect(
      failuresFrom([
        { type: "tool_result", name: "search_web", result: { text: "error handling guide" } },
      ])
    ).toEqual([]);
  });
});

describe("recordRun", () => {
  it("keeps a run that gave up", () => {
    recordRun({ goal: "reconcile invoices", reason: "exhausted", failures: [] });
    expect(listRuns()).toHaveLength(1);
  });

  it("keeps a run that finished but had tool errors", () => {
    recordRun({
      goal: "email the overdue list",
      reason: "finished",
      failures: [{ tool: "email_invoice", error: "SMTP not configured" }],
    });
    expect(listRuns()).toHaveLength(1);
  });

  it("drops a clean run — it has nothing to teach", () => {
    recordRun({ goal: "what is my revenue", reason: "answered", failures: [] });
    expect(listRuns()).toEqual([]);
  });

  it("stays bounded as runs accumulate", () => {
    for (let i = 0; i < 50; i++)
      recordRun({ goal: `goal ${i}`, reason: "exhausted", failures: [] });
    expect(listRuns().length).toBeLessThanOrEqual(30);
    // and it kept the NEWEST, not the first 30
    expect(listRuns()[0].goal).toBe("goal 49");
  });
});

describe("journalDigest", () => {
  it("is empty when there is nothing to warn about", () => {
    expect(journalDigest()).toBe("");
  });

  it("names the goal, what went wrong, and the failing tool", () => {
    recordRun({
      goal: "send reminders to overdue customers",
      reason: "finished",
      failures: [{ tool: "email_invoice", error: "SMTP not configured" }],
    });
    const d = journalDigest();
    expect(d).toMatch(/send reminders to overdue customers/);
    expect(d).toMatch(/email_invoice/);
    expect(d).toMatch(/SMTP not configured/);
  });

  it("shows the newest runs first and caps the list", () => {
    for (let i = 0; i < 9; i++)
      recordRun({ goal: `goal ${i}`, reason: "exhausted", failures: [] });
    const d = journalDigest();
    expect(d).toMatch(/goal 8/);
    expect(d).not.toMatch(/goal 3/); // beyond the digest window
    expect(d.indexOf("goal 8")).toBeLessThan(d.indexOf("goal 7"));
  });

  it("survives a corrupt journal rather than breaking the run", () => {
    localStorage.setItem("filey.agent.journal", "{not json");
    expect(journalDigest()).toBe("");
    expect(listRuns()).toEqual([]);
  });
});
