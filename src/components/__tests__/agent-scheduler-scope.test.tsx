import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ scope: "org:user:alice", run: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("../../lib/api", () => ({ getCacheScope: () => state.scope }));
vi.mock("../../lib/ai", () => ({ aiReady: () => true, aiAutonomous: state.run, DENY_SENSITIVE: () => "deny" }));
vi.mock("../../lib/ui", () => ({ useUI: () => ({ toast: { success: state.success, error: state.error } }) }));
import AgentScheduler from "../AgentScheduler";
import { loadTasks, saveTasks } from "../../lib/agentTasks";
import { AGENT_STORAGE_EVENT } from "../../lib/agentStorage";

afterEach(() => { cleanup(); vi.useRealTimers(); });

it("aborts a scheduled run on identity change and never stores its result in the next workspace", async () => {
  vi.useFakeTimers(); localStorage.clear(); localStorage.setItem("filey_data_mode", "local");
  const task = { id: "same-id", name: "Alice", goal: "Private customer task", schedule: { type: "interval" as const, minutes: 1 }, enabled: true, createdAt: 0 };
  saveTasks([task]);
  let complete!: (value: string) => void;
  state.run.mockImplementationOnce(() => new Promise<string>((resolve) => { complete = resolve; }));
  render(<AgentScheduler />);
  await act(async () => { vi.advanceTimersByTime(8000); });
  expect(state.run).toHaveBeenCalledTimes(1);
  const signal = state.run.mock.calls[0][1].signal as AbortSignal;
  state.scope = "org:user:bob";
  window.dispatchEvent(new Event(AGENT_STORAGE_EVENT));
  saveTasks([{ ...task, name: "Bob", goal: "Bob's own task" }]);
  expect(signal.aborted).toBe(true);
  await act(async () => { complete("Alice's private result"); });
  expect(loadTasks()[0]).toEqual(expect.objectContaining({ name: "Bob", goal: "Bob's own task" }));
  expect(loadTasks()[0].lastResult).toBeUndefined();
  expect(state.success).not.toHaveBeenCalled();
  expect(state.error).not.toHaveBeenCalled();
});
