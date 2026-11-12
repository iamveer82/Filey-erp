import { describe, expect, it, vi } from "vitest";

const runTool = vi.fn();
const computer = vi.hoisted(() => ({ get: vi.fn(async () => 7), stop: vi.fn(async () => {}) }));
vi.mock("../computerUse", () => ({ taskComputerSession: () => computer }));
vi.mock("../aiTools", () => ({
  TOOLS: [
    { name: "create_invoice_draft", description: "Create draft invoice. Long detail.", parameters: { type: "object" }, run: vi.fn() },
    { name: "record_payment", description: "Record a payment.", parameters: { type: "object" }, sensitive: true, run: vi.fn() },
  ],
  runTool: (...args: unknown[]) => runTool(...args),
}));

import { FileyAgentClient, fileyAgentStream, fileyToolCatalog, type AgentTransport } from "../fileyAgent";

/** A scripted agent on the other end of the wire. */
function fakeAgent() {
  let deliver: (line: string) => void = () => {};
  const sent: Record<string, unknown>[] = [];
  const toAgent: ((frame: Record<string, unknown>) => void)[] = [];
  const transport: AgentTransport = {
    send: line => { const f = JSON.parse(line); sent.push(f); toAgent.forEach(cb => cb(f)); },
    onLine: cb => { deliver = cb; return () => { deliver = () => {}; }; },
  };
  const emit = (frame: unknown) => deliver(JSON.stringify(frame));
  const event = (type: string, payload: unknown, session_id = "s1") =>
    emit({ jsonrpc: "2.0", method: "event", params: { type, session_id, payload } });
  return { transport, sent, emit, event, onFrame: (cb: (f: Record<string, unknown>) => void) => toAgent.push(cb) };
}

describe("Filey Agent client", () => {
  it("runs the agent's filey.tool request through the app's own runTool and streams the turn", async () => {
    const agent = fakeAgent();
    const client = new FileyAgentClient(agent.transport);
    agent.onFrame(f => { if (f.method === "client.capabilities") agent.emit({ jsonrpc: "2.0", id: f.id, result: { server_requests: ["filey.tool"] } }); });
    agent.event("gateway.ready", {});
    await client.ready;
    expect(agent.sent[0]).toMatchObject({ method: "client.capabilities", params: { server_requests: true } });

    runTool.mockResolvedValueOnce({ ok: true, id: 41, number: "INV-0041", total: 1050 });
    agent.onFrame(f => {
      if (f.method !== "prompt.submit") return;
      agent.emit({ jsonrpc: "2.0", id: f.id, result: { status: "streaming" } });
      agent.event("tool.start", { tool_id: "t1", name: "filey_run", args: { name: "create_invoice_draft" } });
      agent.emit({ jsonrpc: "2.0", id: "srq-1", method: "filey.tool",
        params: { session_id: "s1", op: "run", name: "create_invoice_draft", args: { customer_name: "Acme", items: [{ description: "Oil", qty: 2, unit_price: 500 }] } } });
    });
    agent.onFrame(f => {
      if (f.id !== "srq-1") return;
      const value = JSON.parse((f.result as { value: string }).value);
      agent.event("tool.complete", { tool_id: "t1", name: "filey_run", args: { name: "create_invoice_draft" }, result: JSON.stringify(value) });
      agent.event("message.complete", { text: `Created ${value.number}.`, status: "complete" });
    });

    const confirm = vi.fn(() => true);
    const controller = new AbortController();
    const events = [];
    const stream = fileyAgentStream(client, "s1", "Invoice Acme for 2 oil at 500", { confirm, isOwner: true, turnId: "t9", agentId: "chat-1", signal: controller.signal });
    let step = await stream.next();
    while (!step.done) { events.push(step.value); step = await stream.next(); }

    expect(runTool).toHaveBeenCalledWith("create_invoice_draft",
      { customer_name: "Acme", items: [{ description: "Oil", qty: 2, unit_price: 500 }] }, confirm, true, "t9", expect.any(AbortSignal), computer.get, "chat-1");
    expect(computer.stop).toHaveBeenCalledOnce();
    expect(events).toEqual([
      // The business action's own arguments (none in this fixture), not the filey_run wrapper.
      { type: "tool_call", id: "t1", name: "create_invoice_draft", args: {} },
      { type: "tool_result", id: "t1", name: "create_invoice_draft", result: { ok: true, id: 41, number: "INV-0041", total: 1050 } },
      { type: "done", text: "Created INV-0041.", reason: "answered" },
    ]);
    expect(step.value).toBe("Created INV-0041.");
  });

  it("answers a window request immediately so the gateway does not keep waiting", async () => {
    const agent = fakeAgent();
    const client = new FileyAgentClient(agent.transport);
    const answered = new Promise<Record<string, unknown>>(resolve => agent.onFrame(f => { if (f.id === "srq-win") resolve(f); }));
    agent.emit({ jsonrpc: "2.0", id: "srq-win", method: "preview.read", params: { session_id: "s1" } });
    expect(await answered).toMatchObject({ error: { code: 4404 } });
    client.close();
  });

  it("a throwing tool still answers the agent instead of leaving it waiting", async () => {
    const agent = fakeAgent();
    const client = new FileyAgentClient(agent.transport);
    client.context = { confirm: () => true, isOwner: true };
    runTool.mockRejectedValueOnce(new Error("save timed out"));
    const answered = new Promise<Record<string, unknown>>(resolve => agent.onFrame(f => { if (f.id === "srq-9") resolve(f); }));
    agent.emit({ jsonrpc: "2.0", id: "srq-9", method: "filey.tool", params: { session_id: "s1", op: "run", name: "create_invoice_draft", args: {} } });
    expect(JSON.parse(((await answered).result as { value: string }).value)).toEqual({ error: "save timed out", retry_safe: false });
  });

  it("stops a tool still waiting for approval when the agent gives up on it, so a late OK runs nothing", async () => {
    const agent = fakeAgent();
    const client = new FileyAgentClient(agent.transport);
    client.context = { confirm: () => new Promise<boolean>(() => {}), isOwner: true };
    // Like runTool: an abort while the approval card is open rejects before anything runs.
    runTool.mockImplementationOnce((...args: unknown[]) => new Promise((_, reject) => (args[5] as AbortSignal)
      .addEventListener("abort", () => reject(new DOMException("Stopped before approval.", "AbortError")))));
    const answered = new Promise<Record<string, unknown>>(resolve => agent.onFrame(f => { if (f.id === "srq-7") resolve(f); }));
    agent.emit({ jsonrpc: "2.0", id: "srq-7", method: "filey.tool", params: { session_id: "s1", op: "run", name: "record_payment", args: {} } });
    agent.event("request.cancel", { id: "srq-7", method: "filey.tool", reason: "timeout" });
    expect(JSON.parse(((await answered).result as { value: string }).value)).toEqual({ error: expect.stringContaining("Stopped before approval."), retry_safe: false });
  });

  it("catalog filters by words and returns full schemas by name", () => {
    expect(fileyToolCatalog(undefined, "invoice")).toMatchObject({ count: 1, tools: [{ name: "create_invoice_draft", purpose: "Create draft invoice." }] });
    expect(fileyToolCatalog("record_payment")).toMatchObject({ name: "record_payment", needs_approval: true, parameters: { type: "object" } });
    expect(fileyToolCatalog("nope")).toMatchObject({ error: expect.stringContaining("Unknown") });
  });

  it("redirects a message typed mid-answer into the live turn", async () => {
    vi.useFakeTimers();
    try {
      const agent = fakeAgent();
      const client = new FileyAgentClient(agent.transport);
      const redirects: string[] = [];
      agent.onFrame(f => {
        if (f.method === "prompt.submit") {
          agent.emit({ jsonrpc: "2.0", id: f.id, result: { status: "streaming" } });
          agent.event("message.delta", { text: "Drafting the invoice." });
        }
        if (f.method === "session.redirect") {
          redirects.push(String((f.params as { text: string }).text));
          agent.emit({ jsonrpc: "2.0", id: f.id, result: { status: "redirected" } });
          agent.event("message.complete", { text: "Drafting it with the blue template.", status: "complete" });
        }
      });
      const queued = ["Use the blue template instead"];
      let drained = false;
      const stream = fileyAgentStream(client, "s1", "Invoice Acme", {
        confirm: () => true, isOwner: true,
        drainSteer: () => (drained ? [] : (drained = true, queued.splice(0))),
      });
      expect(await stream.next()).toEqual({ done: false, value: { type: "delta", text: "Drafting the invoice." } });
      await vi.advanceTimersByTimeAsync(450);
      expect(await stream.next()).toEqual({
        done: false,
        value: { type: "done", text: "Drafting it with the blue template.", reason: "answered" },
      });
      expect(await stream.next()).toEqual({ done: true, value: "Drafting it with the blue template." });
      expect(redirects).toEqual(["Use the blue template instead"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers a message that arrives as the turn ends instead of dropping it", async () => {
    const agent = fakeAgent();
    const client = new FileyAgentClient(agent.transport);
    const prompts: { text: string; queued?: boolean }[] = [];
    agent.onFrame(f => {
      if (f.method !== "prompt.submit") return;
      const params = f.params as { text: string; queued?: boolean };
      prompts.push({ text: params.text, ...(params.queued ? { queued: true } : {}) });
      agent.emit({ jsonrpc: "2.0", id: f.id, result: { status: "streaming" } });
      agent.event("message.complete", { text: prompts.length === 1 ? "First answer." : "Second answer.", status: "complete" });
    });
    const queued = ["Also add the VAT note"];
    let drained = false;
    const stream = fileyAgentStream(client, "s1", "Start", {
      confirm: () => true, isOwner: true,
      drainSteer: () => (drained ? [] : (drained = true, queued.splice(0))),
    });
    for (;;) {
      const step = await stream.next();
      if (step.done) { expect(step.value).toBe("First answer.\n\nSecond answer."); break; }
    }
    expect(prompts).toEqual([{ text: "Start" }, { text: "Also add the VAT note", queued: true }]);
  });

  it("stays on the session when the engine queued the next turn itself", async () => {
    const agent = fakeAgent();
    const client = new FileyAgentClient(agent.transport);
    let prompts = 0;
    agent.onFrame(f => {
      if (f.method !== "prompt.submit") return;
      prompts++;
      agent.emit({ jsonrpc: "2.0", id: f.id, result: { status: "streaming" } });
      if (prompts === 1) {
        agent.event("message.complete", { text: "First.", status: "complete", continuing: true });
        // The engine starts the queued follow-up itself: no second prompt.submit from the app.
        agent.event("message.start", {});
        agent.event("message.complete", { text: "Second.", status: "complete" });
      }
    });
    const stream = fileyAgentStream(client, "s1", "Start", { confirm: () => true, isOwner: true });
    for (;;) {
      const step = await stream.next();
      if (step.done) { expect(step.value).toBe("First.\n\nSecond."); break; }
    }
    expect(prompts).toBe(1);
  });
});
