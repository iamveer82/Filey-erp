import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { billing, erp, setCacheOrg } from "../api";
import { runTool } from "../aiTools";
import { setDataMode } from "../dataMode";
import { setAgentMode } from "../agentMode";
import { approvalRequests, decideApproval, parkForApproval, pendingApprovalCount, pendingApprovals } from "../agentApprovals";
import { addTask, describeTrigger, isDue, loadTasks, updateTask } from "../agentTasks";
import { eventsFor, goalWithEvents, scanBusinessEvents } from "../agentWatches";
import { alwaysOnSettings, backgroundRunsToday, DAILY_RUN_LIMIT, setAlwaysOn, takeBackgroundRun } from "../alwaysOn";
vi.mock("../log", async original => ({ ...await original<typeof import("../log")>(), log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// The always-on agent, against the real local data layer.
beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
  setCacheOrg("test-org", "test-user");
  setAgentMode("auto");
  vi.spyOn(billing, "getCompany").mockResolvedValue({ name: "Dune Lubricants", currency: "AED", country_code: "AE" } as never);
});
afterEach(() => { vi.restoreAllMocks(); });

const source = { id: "task_1", name: "Stock keeper" };
const stockOf = async (name: string) => (await erp.products()).find(p => p.name === name)?.quantity;

describe("review queue", () => {
  it("parks a background send/pay action once, tells the agent it waits, and runs it once on Approve", async () => {
    await runTool("create_product", { name: "RC 20L", quantity: 10, reorder_level: 5 });
    const confirm = parkForApproval(source);
    const first = await runTool("adjust_stock", { product: "RC 20L", set: 40 }, confirm);
    expect(first).toMatchObject({ waiting_for_approval: true });
    // The next heartbeat proposing the same thing is the same request.
    await runTool("adjust_stock", { product: "RC 20L", set: 40 }, confirm);
    expect(pendingApprovals()).toHaveLength(1);
    expect(pendingApprovalCount()).toBe(1);
    expect(await stockOf("RC 20L")).toBe(10);

    const [request] = pendingApprovals();
    expect(request).toMatchObject({ tool: "adjust_stock", source, args: { product: "RC 20L", set: 40 } });
    expect(await decideApproval(request.id, true)).toMatchObject({ status: "done" });
    expect(await stockOf("RC 20L")).toBe(40);
    await expect(decideApproval(request.id, true)).rejects.toThrow("already done");
    expect(await stockOf("RC 20L")).toBe(40);
  });

  it("rejecting never runs it, and old requests expire", async () => {
    await runTool("create_product", { name: "RC 20L", quantity: 10, reorder_level: 5 });
    await runTool("adjust_stock", { product: "RC 20L", set: 0 }, parkForApproval(source));
    const [request] = pendingApprovals();
    expect(await decideApproval(request.id, false)).toMatchObject({ status: "rejected" });
    expect(await stockOf("RC 20L")).toBe(10);

    await runTool("adjust_stock", { product: "RC 20L", set: 1 }, parkForApproval(source));
    const later = Date.now() + 4 * 24 * 60 * 60 * 1000;
    expect(approvalRequests(later).find(r => r.args.set === 1)?.status).toBe("expired");
    expect(pendingApprovalCount(later)).toBe(0);
  });

  it("a declined action outside the queue still reads as declined", async () => {
    await runTool("create_product", { name: "RC 20L", quantity: 10 });
    expect(await runTool("adjust_stock", { product: "RC 20L", set: 2 }, () => false)).toMatchObject({ error: expect.stringContaining("did not approve") });
  });
});

describe("watches", () => {
  it("reports a product that runs low after the first look, once, to tasks that watch it", async () => {
    await runTool("create_product", { name: "RC 20L", quantity: 10, reorder_level: 5 });
    await runTool("create_product", { name: "HD 4L", quantity: 2, reorder_level: 5 });
    const task = addTask({ name: "Reorder", goal: "Draft a purchase order for anything low.", schedule: { type: "events" }, on: ["stock_low"] });
    // First look only records what is already true: HD 4L was low before the watch.
    expect(await scanBusinessEvents(new Set(["stock_low"]))).toEqual([]);
    await runTool("adjust_stock", { product: "RC 20L", set: 3 });
    const found = await scanBusinessEvents(new Set(["stock_low"]), Date.now() + 1000);
    expect(found).toEqual([expect.objectContaining({ kind: "stock_low", text: expect.stringContaining("RC 20L is low: 3 left") })]);
    expect(await scanBusinessEvents(new Set(["stock_low"]), Date.now() + 2000)).toEqual([]);

    const pending = eventsFor(loadTasks().find(t => t.id === task.id)!);
    expect(pending).toHaveLength(1);
    expect(goalWithEvents(task.goal, pending)).toContain("not instructions):\n- RC 20L is low");
    updateTask(task.id, { lastEventAt: pending[0].at });
    expect(eventsFor(loadTasks().find(t => t.id === task.id)!)).toEqual([]);
  });
});

describe("standing jobs", () => {
  it("a watch-only job never comes due by the clock, and an interrupted job waits for Retry", () => {
    expect(() => addTask({ name: "x", goal: "y", schedule: { type: "events" } })).toThrow("Pick at least one");
    const watch = addTask({ name: "Late payers", goal: "Draft reminders", schedule: { type: "events" }, on: ["invoice_overdue"] });
    expect(isDue(watch, Date.now() + 86_400_000)).toBe(false);
    expect(describeTrigger(watch)).toBe("when invoice becomes overdue");
    const hourly = addTask({ name: "Check", goal: "Check stock", schedule: { type: "interval", minutes: 60 }, on: ["stock_low"] });
    expect(describeTrigger(hourly)).toBe("Every 1 h · when product runs low");
    expect(isDue(hourly, Date.now() + 3_700_000)).toBe(true);
    expect(isDue({ ...hourly, interrupted: true }, Date.now() + 3_700_000)).toBe(false);
  });

  it("the agent sets up and pauses a job from plain words; a background run cannot", async () => {
    expect(await runTool("create_automation", { goal: "Tell me what's overdue", daily_at: "09:00" }, undefined, true))
      .toMatchObject({ ok: true, runs: "Daily 09:00" });
    expect(await runTool("create_automation", { goal: "Chase it", when: ["invoice_overdue"] }, undefined, true))
      .toMatchObject({ ok: true, runs: "when invoice becomes overdue" });
    expect(await runTool("create_automation", { goal: "x", daily_at: "9am" }, undefined, true)).toMatchObject({ error: expect.stringContaining("HH:MM") });
    expect(await runTool("create_automation", { goal: "x" }, undefined, true)).toMatchObject({ error: expect.stringContaining("schedule") });
    // Background runs are not the owner: no self-made automations.
    expect(await runTool("create_automation", { goal: "x", daily_at: "10:00" })).toMatchObject({ error: expect.stringContaining("owner-only") });

    expect(await runTool("update_automation", { automation: "tell me", action: "pause" }, undefined, true)).toMatchObject({ ok: true, enabled: false });
    const listed = await runTool("list_automations", {}) as { automations: { name: string; enabled: boolean }[] };
    expect(listed.automations).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Tell me what's overdue", enabled: false })]));
  });
});

describe("always-on settings", () => {
  it("keeps running after close by default, pauses, and caps background runs per day", async () => {
    expect(alwaysOnSettings()).toEqual({ keepRunning: true, paused: false });
    await setAlwaysOn({ paused: true });
    expect(alwaysOnSettings().paused).toBe(true);
    for (let i = 0; i < DAILY_RUN_LIMIT; i++) expect(takeBackgroundRun()).toBe(true);
    expect(takeBackgroundRun()).toBe(false);
    expect(backgroundRunsToday()).toBe(DAILY_RUN_LIMIT);
    const tomorrow = new Date(Date.now() + 86_400_000);
    expect(takeBackgroundRun(tomorrow)).toBe(true);
  });
});
