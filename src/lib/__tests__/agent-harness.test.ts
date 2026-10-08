import { billing, crm, quotes, setCacheOrg } from "../api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiAgent, aiAgentStream, setAiConfig } from "../ai";
import { runAgentStream, type AgentEvent } from "../agentHarness";
import * as desktop from "../desktopBrowser";
import { setDataMode } from "../dataMode";
import { runTool } from "../aiTools";
import { headroomReset } from "../headroom";
import { priorAgentProgress } from "../agentRunState";
import { setAgentMode } from "../agentMode";
import { agentStorageKey } from "../agentStorage";
import { listRuns } from "../agentJournal";

/* The loop is written once and shared by every provider. These tests pin the
 * two things that regressed when there were two copies of it:
 *
 *  1. the run is observable step by step, not just as a final string;
 *  2. both providers produce the SAME sequence of steps for the same
 *     conversation. The round budget was once raised in one loop and not the
 *     other, and nothing failed until a user noticed the agent giving up early.
 */

beforeEach(() => { localStorage.clear(); setDataMode("local"); setCacheOrg(null); setCacheOrg("test-org", "test-user"); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** A big enough result that headroom pages it (>6000 chars on the wire). */
async function seedManyCustomers() {
  setDataMode("local");
  for (let i = 0; i < 20; i++) {
    await runTool("create_customer", {
      name: `Customer Number ${i} Trading LLC ${"Regional wholesale distribution ".repeat(10)}`,
      email: `c${i}@example.com`,
    });
  }
  headroomReset();
}

/** One OpenAI-shaped assistant turn. */
const oa = (content: string, toolCalls?: unknown[]) => ({
  choices: [{ message: { role: "assistant", content, tool_calls: toolCalls } }],
});

/** The same turn, Anthropic-shaped. */
const an = (text: string, toolUse?: { id: string; name: string; input: unknown }) => ({
  stop_reason: toolUse ? "tool_use" : "end_turn",
  content: [
    { type: "text", text },
    ...(toolUse ? [{ type: "tool_use", ...toolUse }] : []),
  ],
});

function stubResponses(bodies: unknown[]) {
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => bodies[Math.min(i++, bodies.length - 1)],
    }))
  );
}

async function collect(stream: AsyncGenerator<AgentEvent, string, void>) {
  const events: AgentEvent[] = [];
  for (;;) {
    const step = await stream.next();
    if (step.done) return { events, final: step.value };
    events.push(step.value);
  }
}

it("discards a provider reply if the workspace changed away and back while it was pending", async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const fetchFn = vi.fn(async () => {
    await pending;
    return new Response(JSON.stringify(oa("Private original workspace answer")));
  });
  const result = collect(runAgentStream([{ role: "user", text: "Review finance" }], {}, {
    cfg: { provider: "openai", baseUrl: "https://example.test", model: "test", apiKey: "test" }, fetchFn,
  }));
  await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());
  setCacheOrg("other-org", "test-user");
  setCacheOrg("test-org", "test-user");
  const stopped = expect(result).rejects.toMatchObject({ name: "AbortError" });
  release();
  await stopped;
  expect(fetchFn).toHaveBeenCalledOnce();
});

describe("cancellation at a yielded completion boundary", () => {
  it.each([
    ["openai", "stop"], ["openai", "other-workspace"], ["openai", "away-and-back"],
    ["anthropic", "stop"], ["anthropic", "other-workspace"], ["anthropic", "away-and-back"],
  ] as const)("rejects %s %s after final text instead of declaring completion", async (provider, interruption) => {
    const controller = new AbortController();
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(provider === "openai" ? oa("The answer is ready.") : an("The answer is ready."))));
    const stream = runAgentStream([{ role: "user", text: "Answer a simple question" }], { signal: controller.signal }, {
      cfg: { provider, baseUrl: "https://example.test/v1", model: "fixture", apiKey: "test" }, fetchFn,
    });
    expect((await stream.next()).value).toEqual({ type: "text", text: "The answer is ready." });
    if (interruption === "stop") controller.abort();
    else {
      setCacheOrg("other-org", "test-user");
      if (interruption === "away-and-back") setCacheOrg("test-org", "test-user");
    }
    await expect(stream.next()).rejects.toMatchObject({ name: "AbortError" });
    expect(await stream.next()).toEqual({ done: true, value: undefined });
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it.each(["stop", "away-and-back"] as const)("prioritizes %s over a provider transport error that arrives late", async interruption => {
    let reject!: (error: Error) => void;
    const controller = new AbortController();
    const fetchFn = vi.fn(() => new Promise<Response>((_resolve, fail) => { reject = fail; }));
    const stream = runAgentStream([{ role: "user", text: "Check the task" }], { signal: controller.signal }, {
      cfg: { provider: "openai", baseUrl: "https://example.test/v1", model: "fixture", apiKey: "test" }, fetchFn,
    });
    const response = stream.next();
    const stopped = expect(response).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());
    if (interruption === "stop") controller.abort();
    else { setCacheOrg("other-org", "test-user"); setCacheOrg("test-org", "test-user"); }
    reject(new Error("Network error after the session was invalidated"));
    await stopped;
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("does not accept an explicit finish call after the user stops on its accompanying text", async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(oa("Finished.", [{ id: "finish", type: "function", function: {
      name: "task_complete", arguments: '{"summary":"Finished.","status":"completed"}',
    } }]))));
    const stream = runAgentStream([{ role: "user", text: "Finish the task" }], {
      signal: controller.signal, finishToolName: "task_complete", extraTools: [{ name: "task_complete", description: "Finish", parameters: {
        type: "object", properties: { summary: { type: "string" }, status: { type: "string", enum: ["completed", "blocked"] } }, required: ["summary", "status"],
      } }],
    }, { cfg: { provider: "openai", baseUrl: "https://example.test/v1", model: "fixture", apiKey: "test" }, fetchFn });
    expect((await stream.next()).value).toMatchObject({ type: "text" });
    controller.abort();
    await expect(stream.next()).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("honors Stop requested from the final progress callback instead of returning successful text", async () => {
    setAiConfig({ provider: "openai", baseUrl: "https://api.openai.com/v1", model: "fixture", apiKey: "test" });
    stubResponses([oa("Final answer.")]);
    const controller = new AbortController(), progress = vi.fn(() => controller.abort());
    await expect(aiAgent([{ role: "user", text: "Reply briefly" }], { signal: controller.signal, onProgress: progress }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(progress).toHaveBeenCalledExactlyOnceWith("Final answer.");
    expect(fetch).toHaveBeenCalledOnce();
    expect(listRuns()).toEqual([]);
  });

  it.each(["stop", "other-workspace", "away-and-back"] as const)("rejects %s after the final tool result instead of marking the run exhausted", async interruption => {
    const controller = new AbortController();
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(oa("", [{ id: "plan", type: "function", function: {
      name: "update_plan", arguments: '{"steps":[{"step":"Check the task","status":"completed"}]}',
    } }]))));
    const stream = runAgentStream([{ role: "user", text: "Check a task" }], { signal: controller.signal, maxRounds: 1 }, {
      cfg: { provider: "openai", baseUrl: "https://example.test/v1", model: "fixture", apiKey: "test" }, fetchFn,
    });
    expect((await stream.next()).value).toMatchObject({ type: "tool_call" });
    expect((await stream.next()).value).toMatchObject({ type: "plan" });
    expect((await stream.next()).value).toMatchObject({ type: "tool_result" });
    if (interruption === "stop") controller.abort();
    else {
      setCacheOrg("other-org", "test-user");
      if (interruption === "away-and-back") setCacheOrg("test-org", "test-user");
    }
    await expect(stream.next()).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("keeps the last completed action receipt stopped when its consumer cancels before exhaustion", async () => {
    setAiConfig({ provider: "openai", baseUrl: "https://api.openai.com/v1", model: "fixture", apiKey: "test" });
    stubResponses([oa("", [{ id: "recall", type: "function", function: { name: "recall", arguments: "{}" } }])]);
    const controller = new AbortController();
    const stream = aiAgentStream([{ role: "user", text: "Check what is remembered" }], { signal: controller.signal, maxRounds: 1, isOwner: true, agentId: "cancel-final-result" });
    expect((await stream.next()).value).toMatchObject({ type: "tool_call" });
    expect((await stream.next()).value).toMatchObject({ type: "tool_result" });
    controller.abort();
    await expect(stream.next()).rejects.toMatchObject({ name: "AbortError" });
    const rows = JSON.parse(localStorage.getItem(agentStorageKey("filey.agent.progress")!)!);
    expect(rows).toEqual([expect.objectContaining({ outcome: "stopped", actions: [expect.objectContaining({ name: "recall", status: "completed" })] })]);
    expect(listRuns()).toEqual([]);
    expect(fetch).toHaveBeenCalledOnce();
  });
});

it("keeps canonical insufficient-Coin guidance in a managed agent failure without retrying or running tools", async () => {
  const fetchFn = vi.fn(async () => { throw new Error("Insufficient credit. Add Coin to continue."); });
  const result = await collect(runAgentStream([{ role: "user", text: "Make an invoice" }], {}, {
    cfg: { provider: "openai", baseUrl: "https://filey-credits.invalid/v1", model: "filey-ai", apiKey: "", billing: "credits" }, fetchFn,
  }));
  expect(result.events).toEqual([expect.objectContaining({ type: "done", reason: "error" })]);
  expect(result.final).toContain("Insufficient credit. Add Coin to continue.");
  expect(result.final).toContain("Nothing was executed from that response.");
  expect(fetchFn).toHaveBeenCalledOnce();
});

it("preserves managed task-size guidance without repeating inference", async () => {
  const message = "This task has too much information for one request. Start a new chat with just the relevant details and attachments.";
  const fetchFn = vi.fn(async () => { throw new Error(message); });
  const result = await collect(runAgentStream([{ role: "user", text: "Read attached items" }], {}, {
    cfg: { provider: "openai", baseUrl: "https://filey-credits.invalid/v1", model: "filey-ai", apiKey: "", billing: "credits" }, fetchFn,
  }));
  expect(result.final).toContain(message);
  expect(result.events).toEqual([expect.objectContaining({ type: "done", reason: "error" })]);
  expect(fetchFn).toHaveBeenCalledOnce();
});

it.each([
  ["credits", "Insufficient credit. Add Coin to continue. SQL SELECT private_customer_rows"],
  ["credits", "Private provider failure: secret-key-fixture"],
  [undefined, "Insufficient credit. Add Coin to continue."],
] as const)("never forwards non-allowlisted %s diagnostics into its reply", async (billing, message) => {
  const fetchFn = vi.fn(async () => { throw new Error(message); });
  const result = await collect(runAgentStream([{ role: "user", text: "Make an invoice" }], {}, {
    cfg: { provider: "openai", baseUrl: "https://example.test/v1", model: "fixture", apiKey: "", billing }, fetchFn,
  }));
  expect(result.final).toContain("Filey AI couldn't continue.");
  expect(result.final).not.toContain(message);
  expect(result.events).toEqual([expect.objectContaining({ type: "done", reason: "error" })]);
  expect(fetchFn).toHaveBeenCalledOnce();
});

it("persists the call before dispatch and restores its record reference on follow-up", async () => {
  setAiConfig({ provider: "openai", baseUrl: "https://api.openai.com/v1", model: "fixture", apiKey: "test" });
  setAgentMode("accept_edits");
  stubResponses([
    oa("", [{ id: "create", type: "function", function: { name: "create_customer", arguments: '{"name":"Harness fixture"}' } }]),
    oa("Created"),
  ]);
  const stream = aiAgentStream([{ role: "user", text: "Create fixture" }], { isOwner: true, agentId: "checkpoint-chat" });
  expect((await stream.next()).value).toMatchObject({ type: "tool_call" });
  expect(priorAgentProgress("checkpoint-chat")).toContain('"status":"started"');
  expect(JSON.stringify(await runTool("find_customers", { query: "Harness fixture" }))).not.toContain("Harness fixture");
  await collect(stream);
  expect(priorAgentProgress("checkpoint-chat")).toContain('"status":"completed"');
  expect(priorAgentProgress("checkpoint-chat")).toContain('"id":');
  await collect(aiAgentStream([{ role: "user", text: "Continue" }], { isOwner: true, agentId: "checkpoint-chat" }));
  const calls = vi.mocked(fetch).mock.calls;
  const init = calls[calls.length - 1][1]!;
  expect(String(init.body)).toContain("Recorded actions from this conversation");
});

it("searches and loads specialist tools while respecting access mode", async () => {
  const bodies: { tools: { function: { name: string } }[] }[] = [];
  const run = async () => {
    let round = 0;
    return collect(runAgentStream([{ role: "user", text: "Search payroll tools" }], { isOwner: true }, {
      cfg: { provider: "openai", baseUrl: "https://example.test", model: "test", apiKey: "test" },
      fetchFn: async (_url, init) => {
        bodies.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify(round++ === 0 ? oa("", [{ id: "search", type: "function", function: { name: "search_tools", arguments: '{"query":"payroll"}' } }]) : oa("Found")));
      },
    }));
  };
  setAgentMode("auto");
  await run();
  expect(bodies[0].tools.some(t => t.function.name === "run_payroll")).toBe(false);
  expect(bodies[1].tools.some(t => t.function.name === "run_payroll")).toBe(true);
  setAgentMode("plan");
  const result = await run();
  expect(JSON.stringify(result.events)).not.toContain('"name":"run_payroll"');
});

it("refuses invalid business arguments before requesting approval or writing", async () => {
  const confirm = vi.fn(async () => true);
  const result = await runTool("create_customer", { name: 123 }, confirm, true);
  expect(result).toMatchObject({ code: "invalid_arguments", retry_safe: true });
  expect(confirm).not.toHaveBeenCalled();
});

it("grounds desktop browser availability on the first request without exposing it to remote runs", async () => {
  vi.spyOn(desktop, "desktopBrowserSupported").mockReturnValue(true);
  vi.spyOn(desktop, "getBrowserPanelState").mockReturnValue({
    open: true, paused: false, agentId: null, activeId: "tab-1",
    tabs: [{ id: "tab-1", window_id: "window-1", url: "https://www.instagram.com/", title: "Untrusted page title", loading: false, canGoBack: false, canGoForward: false }],
  });
  const bodies: { messages: { content: string }[]; tools: { function: { name: string } }[] }[] = [];
  const deps = {
    cfg: { provider: "openai" as const, baseUrl: "https://example.com/v1", model: "fixture", apiKey: "test" },
    fetchFn: async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(oa("Ready.")));
    },
  };
  await collect(runAgentStream([{ role: "user", text: "Open Instagram" }], { isOwner: true, computerSession: async () => 1 }, deps));
  const prompt = bodies[0].messages.map(m => m.content).join("\n");
  expect(prompt).toContain("panel is open, with 1 known tabs");
  expect(prompt).toContain("Use workspace_browser list");
  expect(prompt).toContain("Opening URLs and listing tabs work even with a text-only model");
  expect(prompt).toContain("Never ask for a password in chat");
  expect(prompt).not.toContain("Untrusted page title");
  expect(bodies[0].tools.some(t => t.function.name === "workspace_browser")).toBe(true);
  await collect(runAgentStream([{ role: "user", text: "Open Instagram" }], { isOwner: true }, deps));
  expect(bodies[1].messages.map(m => m.content).join("\n")).not.toContain("panel is open");
});

it("executes a requested website open in the built-in browser with a text-only model", async () => {
  vi.spyOn(desktop, "desktopBrowserSupported").mockReturnValue(true);
  vi.spyOn(desktop, "getBrowserPanelState").mockReturnValue({ open: false, paused: false, agentId: null, activeId: null, tabs: [] });
  const open = vi.spyOn(desktop, "desktopBrowserCommand").mockResolvedValue({ tabs: [], tab: {
    id: "filey-browser-fixture", title: "Instagram", url: "https://www.instagram.com/", loading: false,
    window_id: "123", canGoBack: false, canGoForward: false,
  } });
  setAgentMode("auto");
  const replies = [oa("", [{ id: "open-site", type: "function", function: {
    name: "workspace_browser", arguments: '{"action":"open","url":"https://www.instagram.com/"}',
  } }]), oa("Instagram is open. Sign in in the browser.")];
  const session = vi.fn(async () => 1);
  const result = await collect(runAgentStream([{ role: "user", text: "Open Instagram" }], {
    isOwner: true, computerSession: session,
  }, { cfg: { provider: "openai", baseUrl: "https://example.test", model: "text-only-fixture", apiKey: "test" },
    fetchFn: async () => new Response(JSON.stringify(replies.shift())),
  }));
  expect(open).toHaveBeenCalledWith({ action: "open", url: "https://www.instagram.com/" }, undefined);
  expect(session).not.toHaveBeenCalled();
  expect(result.events).toContainEqual(expect.objectContaining({ type: "tool_result", name: "workspace_browser", result: expect.objectContaining({ tab: expect.objectContaining({ title: "Instagram" }) }) }));
});

it("shares the request allowance with delegates instead of multiplying it per child", async () => {
  setAiConfig({ provider: "openai", baseUrl: "https://api.openai.com/v1", model: "fixture", apiKey: "k" });
  stubResponses([
    oa("", [{ id: "delegate", type: "function", function: { name: "spawn_subtask", arguments: JSON.stringify({ goal: "Look up my preferences" }) } }]),
    oa("", [{ id: "read", type: "function", function: { name: "recall", arguments: "{}" } }]),
  ]);
  const result = await collect(aiAgentStream([{ role: "user", text: "Review my preferences" }], { maxRounds: 2 }));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(result.events[result.events.length - 1]).toMatchObject({ type: "done", reason: "exhausted" });
});

describe("delegated task outcomes", () => {
  const call = (name: string, args: unknown) => ({ id: name, type: "function", function: { name, arguments: JSON.stringify(args) } });
  const goal = "Read the saved preferences";
  it.each(["direct", "delegate"] as const)("preserves a failed child outcome and permits verified %s recovery", async recovery => {
    const bodies: unknown[] = [];
    const replies = [
      oa("", [call("spawn_subtask", { goal })]),
      new Error("Provider unavailable"),
      oa("", [call(recovery === "direct" ? "recall" : "spawn_subtask", recovery === "direct" ? {} : { goal })]),
      ...(recovery === "delegate" ? [oa("", [call("recall", {})]), oa("No saved preferences.")] : []),
      oa("No saved preferences."),
    ];
    const result = await collect(runAgentStream([{ role: "user", text: goal }], {}, {
      cfg: { provider: "openai", baseUrl: "https://example.test", model: "fixture", apiKey: "test" },
      fetchFn: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        const reply = replies.shift();
        if (reply instanceof Error) throw reply;
        return new Response(JSON.stringify(reply));
      },
    }));
    expect(result.events).toContainEqual(expect.objectContaining({ type: "tool_result", name: "spawn_subtask", result: expect.objectContaining({ ok: false, outcome: "error", error: expect.any(String) }) }));
    expect(JSON.stringify(bodies[2])).toContain('\\"outcome\\":\\"error\\"');
    expect(result.events).toContainEqual(expect.objectContaining({ type: "tool_result", name: "recall", result: { memories: [] } }));
    expect(result.events[result.events.length - 1]).toMatchObject({ type: "done", reason: "answered", text: "No saved preferences." });
    if (recovery === "delegate") expect(result.events).toContainEqual(expect.objectContaining({ type: "tool_result", name: "spawn_subtask", result: expect.objectContaining({ ok: true, outcome: "answered" }) }));
  });

  it("reports an exhausted child separately from the parent's remaining request budget", async () => {
    let count = 0;
    const result = await collect(runAgentStream([{ role: "user", text: goal }], {}, {
      cfg: { provider: "openai", baseUrl: "https://example.test", model: "fixture", apiKey: "test" },
      fetchFn: async () => new Response(JSON.stringify(++count === 1
        ? oa("", [call("spawn_subtask", { goal })])
        : count <= 9 ? oa("", [call("list_toolsets", {})]) : oa("This work did not finish."))),
    }));
    expect(result.events).toContainEqual(expect.objectContaining({ type: "tool_result", name: "spawn_subtask", result: expect.objectContaining({ ok: false, outcome: "exhausted", error: expect.any(String) }) }));
    expect(count).toBe(10);
  });
});

describe("in-flight action receipts after Stop", () => {
  it.each(["stop", "other-workspace", "away-and-back"] as const)("handles %s after a quotation save is dispatched", async interruption => {
    setAiConfig({ provider: "openai", baseUrl: "https://api.openai.com/v1", model: "fixture", apiKey: "test" });
    vi.spyOn(crm, "customers").mockResolvedValue([]);
    vi.spyOn(quotes, "listDocs").mockResolvedValue([]);
    let release!: (id: number) => void;
    const save = vi.spyOn(quotes, "saveDoc").mockImplementation(() => new Promise<number>(resolve => { release = resolve; }));
    const args = { customer_name: "Receipt fixture", items: [{ description: "Service", qty: 2, rate: 10 }] };
    stubResponses([oa("", [
      { id: "first", type: "function", function: { name: "create_quote", arguments: JSON.stringify(args) } },
      { id: "second", type: "function", function: { name: "create_quote", arguments: JSON.stringify({ ...args, customer_name: "Must not run" }) } },
    ])]);
    const controller = new AbortController();
    const stream = aiAgentStream([{ role: "user", text: "Create two quotation drafts" }], { signal: controller.signal, isOwner: true, agentId: "stop-save-receipt" });
    expect((await stream.next()).value).toMatchObject({ type: "tool_call", id: "first" });
    const pending = stream.next();
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    if (interruption === "stop") {
      controller.abort();
      release(42);
      expect((await pending).value).toMatchObject({ type: "tool_result", id: "first", result: { ok: true, id: 42 } });
      await expect(stream.next()).rejects.toMatchObject({ name: "AbortError" });
      const rows = JSON.parse(localStorage.getItem(agentStorageKey("filey.agent.progress")!)!);
      expect(rows).toEqual([expect.objectContaining({ outcome: "stopped", actions: [expect.objectContaining({ id: "first", status: "completed", references: expect.objectContaining({ id: 42 }) })] })]);
    } else {
      setCacheOrg("other-org", "test-user");
      if (interruption === "away-and-back") setCacheOrg("test-org", "test-user");
      const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
      release(42);
      await rejected;
      expect(priorAgentProgress("stop-save-receipt")).not.toContain('"status":"completed"');
    }
    expect(save).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe("agent harness", () => {
  it("streams text, the tool call, its result, then done", async () => {
    setAiConfig({
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      apiKey: "k",
    });
    stubResponses([
      oa("Looking that up…", [
        { id: "c1", type: "function", function: { name: "recall", arguments: "{}" } },
      ]),
      oa("Nothing on file."),
    ]);

    const { events, final } = await collect(
      aiAgentStream([{ role: "user", text: "what do you remember?" }])
    );

    expect(events.map((e) => e.type)).toEqual([
      "text",
      "tool_call",
      "tool_result",
      "text",
      "done",
    ]);
    const call = events.find((e) => e.type === "tool_call");
    expect(call).toMatchObject({ name: "recall" });
    expect(final).toBe("Nothing on file.");
  });

  // The Stop button in both chats keys off the throw. The loop used to treat an
  // abort as a provider hiccup, so pressing Stop answered "the model call
  // failed (Aborted)" and threw away the partial reply instead of keeping it.
  it("lets a user abort out rather than reporting it as a failed model call", async () => {
    setAiConfig({
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      apiKey: "k",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      })
    );

    await expect(
      collect(aiAgentStream([{ role: "user", text: "hi" }]))
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("reports the same steps whichever provider ran them", async () => {
    setAiConfig({
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      apiKey: "k",
    });
    stubResponses([
      oa("One moment", [
        { id: "c1", type: "function", function: { name: "recall", arguments: "{}" } },
      ]),
      oa("Done."),
    ]);
    const openai = await collect(aiAgentStream([{ role: "user", text: "hi" }]));

    setAiConfig({
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-opus-5",
      apiKey: "k",
    });
    stubResponses([
      an("One moment", { id: "c1", name: "recall", input: {} }),
      an("Done."),
    ]);
    const anthropic = await collect(aiAgentStream([{ role: "user", text: "hi" }]));

    expect(anthropic.events.map((e) => e.type)).toEqual(
      openai.events.map((e) => e.type)
    );
    expect(anthropic.final).toBe(openai.final);
  });

  it("ends with an exhausted reason, naming what it managed to do", async () => {
    setAiConfig({
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      apiKey: "k",
    });
    // Always asks for another tool call: the budget must stop it.
    stubResponses([
      oa("thinking", [
        { id: "c1", type: "function", function: { name: "recall", arguments: "{}" } },
      ]),
    ]);

    const { events, final } = await collect(
      aiAgentStream([{ role: "user", text: "loop forever" }], { maxRounds: 2 })
    );

    const done = events[events.length - 1];
    expect(done).toMatchObject({ type: "done", reason: "exhausted" });
    expect(final).toMatch(/couldn't finish/);
    expect(final).not.toContain("recall");
    // Two rounds means two model calls, not an unbounded run.
    expect(events.filter((e) => e.type === "tool_call")).toHaveLength(2);
  });

  it("a provider failure ends in an error done event, not a silent death", async () => {
    setAiConfig({
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      apiKey: "k",
    });
    // Network death: the retry wrapper gives up eventually, and the run must
    // surface that as a done event rather than dying mid-stream.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("socket hung up: private-provider-body");
      })
    );
    const { events, final } = await collect(
      aiAgentStream([{ role: "user", text: "hello" }])
    );
    expect(events[events.length - 1]).toMatchObject({ type: "done", reason: "error" });
    expect(final).toContain("Filey AI couldn't continue.");
    expect(final).not.toContain("private-provider-body");

    // A hard HTTP refusal is non-retryable, so it surfaces immediately.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 401,
        text: async () => "bad key: private-provider-body",
        json: async () => ({}),
      }))
    );
    const http = await collect(aiAgentStream([{ role: "user", text: "hello" }]));
    expect(http.events[http.events.length - 1]).toMatchObject({
      type: "done",
      reason: "error",
    });
    expect(http.final).toContain("Your AI provider key was rejected");
    expect(http.final).not.toContain("private-provider-body");
  });

  it.each(["openai", "anthropic"] as const)("keeps all current attachments for %s after lookups while dropping earlier images", async provider => {
    const requests: string[] = [];
    const replies = provider === "openai"
      ? [oa("", [{ id: "lookup", type: "function", function: { name: "recall", arguments: "{}" } }]), oa("Ready to draft.")]
      : [an("", { id: "lookup", name: "recall", input: {} }), an("Ready to draft.")];
    const result = await collect(runAgentStream([
      { role: "user", text: "Earlier attachment", images: [{ mediaType: "image/png", dataBase64: "OLDIMAGE" }] },
      { role: "assistant", text: "Earlier task finished." },
      { role: "user", text: "Invoice both attached items", images: [
        { mediaType: "image/png", dataBase64: "FIRSTIMAGE" }, { mediaType: "image/jpeg", dataBase64: "SECONDIMAGE" },
      ] },
    ], { isOwner: true }, {
      cfg: { provider, baseUrl: "https://example.test/v1", model: "fixture", apiKey: "test" },
      fetchFn: async (_url, init) => { requests.push(String(init.body)); return new Response(JSON.stringify(replies.shift())); },
    }));
    expect(requests).toHaveLength(2);
    expect(requests[0]).toContain("OLDIMAGE");
    expect(requests[1]).not.toContain("OLDIMAGE");
    for (const request of requests) {
      expect(request).toContain("FIRSTIMAGE"); expect(request).toContain("SECONDIMAGE");
    }
    expect(result.final).toBe("Ready to draft.");
  });

  it("omits unsupported temperature for current Claude and keeps current image details through lookups", async () => {
    setAiConfig({
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-opus-5",
      apiKey: "k",
    });
    const calls: RequestInit[] = [];
    let round = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push(init);
        return {
          ok: true,
          status: 200,
          json: async () =>
            round++ === 0
              ? an("reading it", { id: "c1", name: "recall", input: {} })
              : an("done"),
        };
      })
    );

    await collect(
      aiAgentStream([
        {
          role: "user",
          text: "what is this?",
          images: [{ mediaType: "image/png", dataBase64: "AAAA" }],
        },
      ])
    );

    const first = JSON.parse(String(calls[0].body));
    expect(first).not.toHaveProperty("temperature");
    expect(JSON.stringify(first.messages)).toContain("AAAA");
    // The lookup did not transcribe the attachment. Its details must remain
    // visible when the next round prepares the actual document.
    const second = JSON.parse(String(calls[1].body));
    expect(JSON.stringify(second.messages)).toContain("AAAA");
    expect(JSON.stringify(second.messages)).toContain("what is this?");
  });

  it("compresses large tool output on the wire and offers headroom_retrieve", async () => {
    await seedManyCustomers();
    setAiConfig({
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      apiKey: "k",
    });
    const bodies: string[] = [];
    let round = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(String(init.body));
        const r = round;
        round++;
        return {
          ok: true,
          status: 200,
          json: async () =>
            r === 0
              ? oa("Listing customers.", [
                  {
                    id: "c1",
                    type: "function",
                    function: { name: "find_customers", arguments: "{}" },
                  },
                ])
              : r === 1
                ? oa("", [
                    {
                      id: "c2",
                      type: "function",
                      function: { name: "headroom_retrieve", arguments: '{"id":"hr1"}' },
                    },
                  ])
                : oa("All retrieved."),
        };
      })
    );

    const { events, final } = await collect(
      aiAgentStream([{ role: "user", text: "list every customer" }])
    );

    // Round 2's wire carried the compressed marker, not the raw JSON blob.
    expect(bodies[1]).toContain("[headroom]");
    expect(bodies[1].length).toBeLessThan(bodies[0].length + 8000);
    // After compression, the retrieve tool is offered…
    expect(bodies[2]).toContain('"headroom_retrieve"');
    // …the model called it and received a page of the exact original.
    const retrieveCall = events.find(
      (e) => e.type === "tool_call" && e.name === "headroom_retrieve"
    );
    expect(retrieveCall).toBeDefined();
    expect(final).toBe("All retrieved.");
  });

  it.each(["openai", "anthropic"] as const)("keeps the saved invoice total and nested lines on the %s wire beside a workspace aggregate", async provider => {
    vi.spyOn(billing, "listDocs").mockResolvedValue([{ id: 28, number: "INV-DLS-028-26", total: 50934.96, balance: 50934.96, paid: 0 }] as never);
    vi.spyOn(billing, "getDoc").mockResolvedValue({
      id: 28, number: "INV-DLS-028-26", issue_date: "2026-09-01", currency: "AED",
      tax_rate: 5, discount: 0, status: "draft", doc_type: "sales",
      ...Object.fromEntries(Array.from({ length: 45 }, (_, i) => [`saved_field_${i}`, "Saved optional header setting ".repeat(2)])),
      items: [{ description: "Test goods", qty: 2, unit_price: 100, custom: { "T.Liters": "200" } }],
    } as never);
    vi.spyOn(billing, "verifyPendingInvoiceSaves").mockResolvedValue([]);
    const bodies: { messages: { role: string; content: unknown }[] }[] = [];
    const result = await collect(runAgentStream([
      { role: "system", text: "Workspace-wide outstanding: AED 50,934.96 across all invoices. This is not an individual invoice total." },
      { role: "user", text: "Read invoice INV-DLS-028-26 and tell me its saved number, date and total. Do not create or edit anything." },
    ], { isOwner: true }, {
      cfg: { provider, baseUrl: "https://example.test/v1", model: "fixture", apiKey: "test" },
      fetchFn: async (_url, init) => {
        bodies.push(JSON.parse(String(init.body)));
        const first = bodies.length === 1;
        return new Response(JSON.stringify(provider === "openai"
          ? first ? oa("", [{ id: "invoice-read", type: "function", function: { name: "get_invoice", arguments: '{"invoice_number":"INV-DLS-028-26"}' } }]) : oa("INV-DLS-028-26 · 2026-09-01 · AED 210.00")
          : first ? an("", { id: "invoice-read", name: "get_invoice", input: { invoice_number: "INV-DLS-028-26" } }) : an("INV-DLS-028-26 · 2026-09-01 · AED 210.00")));
      },
    }));
    const messages = bodies[1].messages;
    const wireResult = provider === "openai"
      ? messages.find(message => message.role === "tool")?.content
      : messages.flatMap(message => Array.isArray(message.content) ? message.content : []).find((block: { type?: string }) => block.type === "tool_result")?.content;
    const saved = JSON.parse(String(wireResult));
    expect(saved).toMatchObject({ number: "INV-DLS-028-26", issue_date: "2026-09-01", total: 210,
      items: [{ qty: 2, unit_price: 100, custom: { "T.Liters": "200" } }] });
    expect(String(wireResult)).not.toContain("50934.96");
    expect(saved.saved_field_44).toBe("Saved optional header setting ".repeat(2));
    expect(result.events.filter(event => event.type === "tool_call").map(event => event.name)).toEqual(["get_invoice"]);
    expect(result.final).toBe("INV-DLS-028-26 · 2026-09-01 · AED 210.00");
  });
});
