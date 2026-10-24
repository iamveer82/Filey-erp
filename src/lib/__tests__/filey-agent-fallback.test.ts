import { afterEach, expect, it, vi } from "vitest";
import type { AgentEvent } from "../agentHarness";
import { FileyAgentClient, fileyAgentStream, type AgentTransport } from "../fileyAgent";

// Filey Agent (Hermes) is the only agent: no backup brain answers when it is down,
// and its replies stream into the chat token by token.

function fakeEngine(events: { type: string; payload?: Record<string, unknown> }[]) {
  const subs = new Set<(line: string) => void>();
  const sent: { method?: string; params?: Record<string, unknown> }[] = [];
  const emit = (frame: unknown) => subs.forEach(cb => cb(JSON.stringify(frame)));
  const transport: AgentTransport = {
    send(line) {
      const frame = JSON.parse(line);
      sent.push(frame);
      if (frame.method === "prompt.submit") {
        emit({ jsonrpc: "2.0", id: frame.id, result: { ok: true } });
        for (const ev of events) emit({ jsonrpc: "2.0", method: "event", params: { ...ev, session_id: "s1" } });
      } else if (frame.id) {
        emit({ jsonrpc: "2.0", id: frame.id, result: {} });
      }
    },
    onLine(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
  return { client: new FileyAgentClient(transport), sent };
}

async function run(stream: AsyncGenerator<AgentEvent, string>) {
  const events: AgentEvent[] = [];
  for (;;) {
    const step = await stream.next();
    if (step.done) return { events, reply: step.value };
    events.push(step.value);
  }
}

afterEach(() => { vi.restoreAllMocks(); });

it("streams the reply token by token, seals segments, and ends with the final text", async () => {
  const { client } = fakeEngine([
    { type: "message.start" },
    { type: "message.delta", payload: { text: "Checking " } },
    { type: "message.delta", payload: { text: "stock…" } },
    { type: "message.interim", payload: { text: "Checking stock…", already_streamed: true } },
    { type: "tool.start", payload: { tool_id: "t1", name: "filey_run", args: { name: "find_products", args: {} } } },
    { type: "tool.complete", payload: { tool_id: "t1", name: "filey_run", args: { name: "find_products" }, result: "{\"count\":2}" } },
    { type: "message.delta", payload: { text: "Two products." } },
    { type: "message.complete", payload: { text: "Two products.", status: "complete" } },
  ]);
  const { events, reply } = await run(fileyAgentStream(client, "s1", "how much stock?", { confirm: () => false, isOwner: true }));
  expect(events).toEqual([
    { type: "delta", text: "Checking " },
    { type: "delta", text: "stock…" },
    { type: "text", text: "Checking stock…" },
    { type: "tool_call", id: "t1", name: "find_products", args: {} },
    { type: "tool_result", id: "t1", name: "find_products", result: { count: 2 } },
    { type: "delta", text: "Two products." },
    { type: "done", text: "Two products.", reason: "answered" },
  ]);
  expect(reply).toBe("Two products.");
});

it("hands a card's own arguments to the chat, not the filey_run wrapper", async () => {
  const card = { title: "Overdue", rows: [["INV-0023", "640.00"]] };
  const { client } = fakeEngine([
    { type: "tool.start", payload: { tool_id: "c1", name: "filey_run", args: { name: "show_ui", args: card } } },
    { type: "message.complete", payload: { text: "Here it is.", status: "complete" } },
  ]);
  const { events } = await run(fileyAgentStream(client, "s1", "show overdue", { confirm: () => false, isOwner: true }));
  expect(events[0]).toEqual({ type: "tool_call", id: "c1", name: "show_ui", args: card });
});

it("finds Filey tools from how people ask, not only exact words", async () => {
  const { fileyToolCatalog } = await import("../fileyAgent");
  const names = (query: string) => (fileyToolCatalog(undefined, query) as { tools: { name: string }[] }).tools.map(t => t.name);
  expect(names("rennox gave a 5000 deposit")).toContain("record_advance");
  expect(names("سند قبض")).toContain("create_payment_receipt");
  expect(names("chase late payers")).not.toEqual([]);
});

it("a failed engine turn is an error, never a different agent's answer", async () => {
  const { client } = fakeEngine([{ type: "error", payload: { message: "Filey Agent stopped unexpectedly." } }]);
  await expect(run(fileyAgentStream(client, "s1", "hi", { confirm: () => false, isOwner: true }))).rejects.toThrow("stopped unexpectedly");
});

it("outside the desktop app the chat says the agent lives on the computer", async () => {
  const { runAgentTurn } = await import("../agentTurn");
  const turn = runAgentTurn({ chatId: "c", goalText: "hi", history: [], auto: false },
    { isOwner: true, signal: new AbortController().signal, agentId: "c", confirm: () => false });
  await expect(run(turn)).rejects.toThrow("runs on your computer");
});
