import { afterEach, expect, it, vi } from "vitest";

const engine = vi.hoisted(() => ({ turn: vi.fn(), restart: vi.fn(async () => {}) }));
vi.mock("../fileyAgent", () => ({ fileyAgentTurn: (...args: unknown[]) => engine.turn(...args), restartFileyAgentEngine: engine.restart }));
vi.mock("../agentApprovals", () => ({ parkForApproval: () => () => false }));

import { isDue, type AgentTask } from "../agentTasks";
import { afterFailure, afterTurn, IDLE_TURN_LIMIT, longTaskPrompt, readStatus, retryDelayMs, runLongTaskTurn, SILENT_TURN_MS } from "../longTask";

const task = (patch: Partial<AgentTask> = {}): AgentTask => ({
  id: "t1", name: "Import price list", goal: "Add all 120 products from prices.xlsx", schedule: { type: "until_done" }, enabled: true, createdAt: 0, ...patch,
});

afterEach(() => { vi.useRealTimers(); engine.turn.mockReset(); engine.restart.mockClear(); });

it("reads the agent's closing status line, however it is dressed", () => {
  expect(readStatus("Added 40 products.\n\nSTATUS: CONTINUE - 40 of 120 done; next rows 41-80"))
    .toEqual({ status: "continue", note: "40 of 120 done; next rows 41-80", body: "Added 40 products." });
  expect(readStatus("All 120 are in.\n**STATUS: DONE**\n")).toMatchObject({ status: "done", body: "All 120 are in." });
  expect(readStatus("> status: blocked — the supplier's TRN is missing")).toMatchObject({ status: "blocked", note: "the supplier's TRN is missing" });
  // No status line: the reply's own ending is the note, and the caller treats it as "go on".
  expect(readStatus("I added a few more.")).toEqual({ status: null, note: "I added a few more.", body: "I added a few more." });
});

it("goes again after a working turn, finishes on DONE, and stops for the owner when blocked or idle", () => {
  const working = afterTurn(task(), { reply: "Added 40.\nSTATUS: CONTINUE - 40 done", tools: 12 }, 1000);
  expect(working.patch).toMatchObject({ turns: 1, note: "40 done", idleTurns: 0, failures: 0, lastError: undefined, runningSince: undefined });
  expect(working.tell).toBeUndefined();
  expect(isDue(task(working.patch), 1000)).toBe(true);

  const done = afterTurn(task({ turns: 3 }), { reply: "All 120 are in and checked.\nSTATUS: DONE", tools: 2 });
  expect(done.patch).toMatchObject({ done: true, turns: 4, lastResult: "All 120 are in and checked." });
  expect(done.tell?.title).toBe("Import price list finished");
  expect(isDue(task(done.patch))).toBe(false);

  const blocked = afterTurn(task(), { reply: "STATUS: BLOCKED - which price list is the current one?", tools: 1 });
  expect(blocked.patch.blocked).toBe("which price list is the current one?");
  expect(isDue(task(blocked.patch))).toBe(false);

  // Three turns of talk and no tool: it is going round in circles.
  let t = task();
  for (let i = 0; i < IDLE_TURN_LIMIT; i++) t = { ...t, ...afterTurn(t, { reply: "Thinking about it.\nSTATUS: CONTINUE", tools: 0 }).patch };
  expect(t.blocked).toContain("stopped making progress");
});

it("keeps retrying after failures, quickly at first, then every 15 minutes, and tells the owner once", () => {
  expect([1, 2, 3, 4, 5, 6, 7, 500].map(retryDelayMs)).toEqual([30, 60, 120, 300, 600, 900, 900, 900].map(s => s * 1000));
  let t = task();
  const told: string[] = [];
  for (let i = 0; i < 200; i++) {
    const { patch, tell } = afterFailure(t, "Filey Agent stopped unexpectedly.", 5000);
    t = { ...t, ...patch };
    if (tell) told.push(tell.title);
  }
  expect(t).toMatchObject({ failures: 200, retryAt: 5000 + 900_000, cutOff: "Filey Agent stopped unexpectedly." });
  expect(t.blocked).toBeUndefined(); // never gives up
  expect(told).toEqual(["Import price list is waiting"]);
  expect(isDue(t, 5000 + 899_000)).toBe(false);
  expect(isDue(t, 5000 + 900_000)).toBe(true);
  // The turn after a failure is told to check before repeating anything.
  expect(longTaskPrompt(t)).toContain("cut off (Filey Agent stopped unexpectedly.)");
  expect(afterTurn(t, { reply: "STATUS: CONTINUE - checked", tools: 1 }).patch).toMatchObject({ failures: 0, retryAt: undefined, cutOff: undefined });
});

it("opens every turn with the goal and the agent's own last note", () => {
  const prompt = longTaskPrompt(task({ turns: 4, note: "80 of 120 done; next rows 81-120" }));
  expect(prompt).toContain('[Long task "Import price list", turn 5.');
  expect(prompt).toContain("Goal: Add all 120 products from prices.xlsx");
  expect(prompt).toContain("Your last note: 80 of 120 done; next rows 81-120");
  expect(prompt).not.toContain("cut off");
  // What the owner said on Resume reaches the next turn once, then is dropped.
  const answered = task({ answer: "Use the April list" });
  expect(longTaskPrompt(answered)).toContain("Their answer: Use the April list");
  const next = { ...answered, ...afterTurn(answered, { reply: "STATUS: CONTINUE - using April", tools: 1 }).patch };
  expect(longTaskPrompt(next)).not.toContain("Their answer");
});

it("runs one turn unattended: counts the tools used and fails on an engine error", async () => {
  engine.turn.mockImplementationOnce(async function* (_chat: string, _prompt: string, ctx: { onActivity?: () => void }) {
    ctx.onActivity?.();
    yield { type: "tool_call", id: "1", name: "create_product", args: {} };
    yield { type: "tool_result", id: "1", name: "create_product", result: { ok: true } };
    yield { type: "done", text: "Added one.", reason: "answered" };
    return "Added one.\nSTATUS: CONTINUE - 1 done";
  });
  expect(await runLongTaskTurn(task(), new AbortController().signal)).toEqual({ reply: "Added one.\nSTATUS: CONTINUE - 1 done", tools: 1 });
  const [chat, prompt, ctx] = engine.turn.mock.calls[0] as [string, string, { isOwner: boolean; confirmCommand: () => boolean }];
  expect(chat).toBe("longtask:t1"); // its own engine session, kept from turn to turn
  expect(prompt).toContain("Goal: Add all 120 products");
  expect(ctx.isOwner).toBe(false);
  expect(ctx.confirmCommand()).toBe(false);

  engine.turn.mockImplementationOnce(async function* () {
    yield { type: "done", text: "Filey AI is not reachable right now.", reason: "error" };
    return "Filey AI is not reachable right now.";
  });
  await expect(runLongTaskTurn(task(), new AbortController().signal)).rejects.toThrow("not reachable");
});

it("interrupts a turn that went silent, and restarts an engine that does not even answer that", async () => {
  vi.useFakeTimers();
  let signal!: AbortSignal;
  engine.turn.mockImplementationOnce((_chat: string, _prompt: string, ctx: { signal: AbortSignal }) => {
    signal = ctx.signal;
    return { next: () => new Promise(() => {}), return: async () => ({ done: true, value: "" }), throw: async () => ({ done: true, value: "" }), [Symbol.asyncIterator]() { return this; } };
  });
  const turn = runLongTaskTurn(task(), new AbortController().signal);
  const failed = expect(turn).rejects.toThrow("went silent");
  await vi.advanceTimersByTimeAsync(SILENT_TURN_MS - 1000);
  expect(signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1000);
  expect(signal.aborted).toBe(true);
  expect(engine.restart).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(engine.restart).toHaveBeenCalledOnce();
  await failed;
});
