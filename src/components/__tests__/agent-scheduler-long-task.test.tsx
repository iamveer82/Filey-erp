import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// A long task is called again and again until the agent says it is done, and nothing short of
// the owner stopping it ends it early: a failed turn is retried, a turn cut off by Filey
// closing is picked up on the next launch.
const state = vi.hoisted(() => ({ turn: vi.fn(), engine: "ready", success: vi.fn(), error: vi.fn() }));
vi.mock("../../lib/api", () => ({ getCacheScope: () => "org:user:alice" }));
vi.mock("../../lib/fileyAgent", () => ({
  fileyAgentReply: vi.fn(),
  fileyAgentStatus: () => ({ state: state.engine }),
  fileyAgentTurn: (...args: unknown[]) => state.turn(...args),
  restartFileyAgentEngine: vi.fn(async () => {}),
}));
vi.mock("../../lib/ui", () => ({ useUI: () => ({ toast: { success: state.success, error: state.error } }) }));
import AgentScheduler from "../AgentScheduler";
import { addTask, loadTasks, saveTasks } from "../../lib/agentTasks";
import { backgroundRunsToday } from "../../lib/alwaysOn";

const reply = (text: string, tools = 1) => async function* () {
  for (let i = 0; i < tools; i++) yield { type: "tool_call", id: String(i), name: "create_product", args: {} };
  yield { type: "done", text, reason: "answered" };
  return text;
};

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
  state.turn.mockReset();
  state.engine = "ready";
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("calls the agent turn after turn, with its own last note, until it reports done", async () => {
  addTask({ name: "Import", goal: "Add all 120 products", schedule: { type: "until_done" } });
  state.turn
    .mockImplementationOnce(reply("Added 60.\nSTATUS: CONTINUE - 60 of 120 done"))
    .mockImplementationOnce(reply("Added the rest.\nSTATUS: CONTINUE - 120 added, checking totals"))
    .mockImplementationOnce(reply("All 120 are in and the totals match.\nSTATUS: DONE"));
  render(<AgentScheduler />);
  await act(async () => { await vi.advanceTimersByTimeAsync(8100); });
  // No waiting for the next heartbeat between turns.
  expect(state.turn).toHaveBeenCalledTimes(3);
  expect(state.turn.mock.calls.map(call => String(call[1]).includes("Your last note:"))).toEqual([false, true, true]);
  expect(String(state.turn.mock.calls[2][1])).toContain("Your last note: 120 added, checking totals");
  expect(loadTasks()[0]).toMatchObject({ done: true, turns: 3, lastResult: "All 120 are in and the totals match." });
  expect(loadTasks()[0].runningSince).toBeUndefined();
  // Done means done: later heartbeats do not start it again, and the daily cap was not spent on it.
  await act(async () => { await vi.advanceTimersByTimeAsync(180_000); });
  expect(state.turn).toHaveBeenCalledTimes(3);
  expect(backgroundRunsToday()).toBe(0);
});

it("picks itself up after Filey was closed mid-turn, and retries by itself after a failure", async () => {
  const task = addTask({ name: "Import", goal: "Add all 120 products", schedule: { type: "until_done" } });
  // Left "running" by a previous launch.
  saveTasks([{ ...task, runningSince: Date.now() - 60_000, turns: 2, note: "60 of 120 done" }]);
  state.turn
    .mockImplementationOnce(() => { throw new Error("Filey Agent stopped unexpectedly."); })
    .mockImplementationOnce(reply("Checked: 60 were already in. Added the other 60.\nSTATUS: DONE"));
  render(<AgentScheduler />);
  await act(async () => { await vi.advanceTimersByTimeAsync(8100); });
  expect(state.turn).toHaveBeenCalledTimes(1);
  expect(String(state.turn.mock.calls[0][1])).toContain("cut off (Filey was closed)");
  expect(loadTasks()[0]).toMatchObject({ failures: 1, lastError: "Filey Agent stopped unexpectedly." });
  // Not parked for a person: no "interrupted, press Retry", no "needs you".
  expect(loadTasks()[0].interrupted ?? loadTasks()[0].blocked).toBeUndefined();
  // It waits out the back-off (30 s), then the next heartbeat tries again without anyone pressing Retry.
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  expect(state.turn).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(state.turn).toHaveBeenCalledTimes(2);
  expect(String(state.turn.mock.calls[1][1])).toContain("cut off (Filey Agent stopped unexpectedly.)");
  expect(loadTasks()[0]).toMatchObject({ done: true, turns: 3, failures: 0 });
});

it("starts the turn even when the engine had given up, and stops mid-turn when paused", async () => {
  const task = addTask({ name: "Import", goal: "Add all 120 products", schedule: { type: "until_done" } });
  state.engine = "unavailable";
  let signal!: AbortSignal;
  state.turn.mockImplementationOnce(async function* (_chat: string, _prompt: string, ctx: { signal: AbortSignal }) {
    signal = ctx.signal;
    await new Promise<void>(resolve => ctx.signal.addEventListener("abort", () => resolve()));
    yield { type: "done", text: "", reason: "stopped" };
    return "";
  });
  render(<AgentScheduler />);
  await act(async () => { await vi.advanceTimersByTimeAsync(8100); });
  expect(state.turn).toHaveBeenCalledTimes(1); // asking for a turn is what restarts the engine
  saveTasks([{ ...loadTasks()[0], enabled: false }]);
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(signal.aborted).toBe(true);
  expect(loadTasks()[0]).toMatchObject({ id: task.id, enabled: false, cutOff: "it was paused" });
  expect(loadTasks()[0].runningSince).toBeUndefined();
  expect(state.turn).toHaveBeenCalledTimes(1);
});
