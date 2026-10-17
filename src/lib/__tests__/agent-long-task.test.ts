import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setCacheOrg } from "../api";
import { fitWire, requestBytes, runAgentStream, wireBudget, type AgentEvent } from "../agentHarness";
import { setDataMode } from "../dataMode";
import { runTool } from "../aiTools";
import { headroomReset } from "../headroom";
import type { AiConfig } from "../ai";

// A long task must never outgrow Filey AI's request gate (about 2 tokens a byte inside a
// 128K context): each round is fitted before it is sent, and a refused round goes again.
const cfg = { provider: "openai", baseUrl: "https://example.test", model: "test", apiKey: "test", billing: "credits" } as unknown as AiConfig;
const call = (id: string, name: string, args: unknown) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
const turn = (content: string, calls?: unknown[]) => ({ choices: [{ message: { role: "assistant", content, tool_calls: calls } }] });

beforeEach(async () => {
  localStorage.clear();
  setDataMode("local");
  setCacheOrg("test-org", "test-user");
  // Customers with long names, so every lookup returns a large result.
  for (let i = 0; i < 20; i++) await runTool("create_customer", { name: `Customer ${i} Trading LLC ${"Regional wholesale distribution ".repeat(10)}` });
  headroomReset();
});
afterEach(() => { vi.restoreAllMocks(); });

async function drain(stream: AsyncGenerator<AgentEvent, string, void>) {
  for (;;) { const step = await stream.next(); if (step.done) return step.value; }
}

it("keeps every round of a 25-step task inside the gate and finishes it", async () => {
  const sizes: { bytes: number; budget: number }[] = [];
  const final = await drain(runAgentStream([{ role: "system", text: "You are Filey." }, { role: "user", text: "Check every customer, one at a time." }], { isOwner: true, maxTokens: 4096 }, {
    cfg,
    fetchFn: async (_url, init) => {
      const body = JSON.parse(String(init.body));
      sizes.push({ bytes: requestBytes(String(init.body)), budget: wireBudget(cfg, 4096, body.messages.length) });
      const n = sizes.length;
      // Each step also sends a long argument, like a big Word batch.
      return new Response(JSON.stringify(n <= 25
        ? turn("", [call(`c${n}`, "find_customers", { query: "Customer", note: "x".repeat(3000) })])
        : turn("Done: all 25 checks finished.")));
    },
  }));
  expect(final).toBe("Done: all 25 checks finished.");
  expect(sizes).toHaveLength(26);
  for (const s of sizes) expect(s.bytes).toBeLessThanOrEqual(s.budget);
});

it("sends a refused round again, fitted tighter, without running anything twice", async () => {
  let requests = 0;
  const final = await drain(runAgentStream([{ role: "user", text: "hello" }], { isOwner: true }, {
    cfg,
    fetchFn: async () => ++requests === 1
      ? new Response(JSON.stringify({ error: "This conversation is too large for the selected model. Start a new chat or choose a larger-context model." }), { status: 400 })
      : new Response(JSON.stringify(turn("Hi."))),
  }));
  expect(requests).toBe(2);
  expect(final).toBe("Hi.");
});

it("folds the oldest rounds into a progress note, keeping the request and the latest rounds", () => {
  const user = { role: "user", content: "Make 10 invoices" };
  const convo: Record<string, unknown>[] = [{ role: "system", content: "You are Filey." }, user];
  for (let i = 1; i <= 10; i++) {
    convo.push({ role: "assistant", content: "", tool_calls: [call(`c${i}`, "create_invoice_draft", { customer_name: `Customer ${i}` })] });
    convo.push({ role: "tool", tool_call_id: `c${i}`, content: `Invoice INV-${i} saved. ${"detail ".repeat(100)}` });
  }
  const wire = { convo, system: "You are Filey." };
  fitWire(wire, user, () => JSON.stringify(wire.convo).length < 2_600, [{ step: "Make 10 invoices", status: "in_progress" }]);
  expect(JSON.stringify(wire.convo).length).toBeLessThan(2_600);
  expect(wire.convo.slice(0, 2)).toEqual([{ role: "system", content: "You are Filey." }, user]);
  const note = String(wire.convo[2].content);
  expect(note.startsWith("[Progress so far, shortened to fit: earlier rounds ran create_invoice_draft ×")).toBe(true);
  expect(note).toContain("Plan: → Make 10 invoices.");
  // The newest round is whole and still answers its own call.
  const last = wire.convo.slice(-2);
  expect(last[0]).toMatchObject({ role: "assistant" });
  expect(last[1]).toMatchObject({ role: "tool", tool_call_id: "c10" });
});
