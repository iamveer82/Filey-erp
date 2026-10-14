import { expect, it } from "vitest";
import type { AgentEvent } from "../agentHarness";
import { fileyAgentOrFallback } from "../fileyAgent";

async function* agent(events: AgentEvent[], failAt: number, reply = "agent reply"): AsyncGenerator<AgentEvent, string> {
  for (const [i, event] of events.entries()) {
    if (i === failAt) throw new Error("The Filey Agent is offline right now.");
    yield event;
  }
  if (failAt === events.length) throw new Error("The Filey Agent is offline right now.");
  return reply;
}
async function* builtIn(): AsyncGenerator<AgentEvent, string> {
  yield { type: "done", text: "built-in reply", reason: "answered" };
  return "built-in reply";
}
async function run(stream: AsyncGenerator<AgentEvent, string>) {
  const events: AgentEvent[] = [];
  for (;;) {
    const step = await stream.next();
    if (step.done) return { events, reply: step.value };
    events.push(step.value);
  }
}

it("answers with the built-in chat, and says so, when the agent can't start", async () => {
  const { events, reply } = await run(fileyAgentOrFallback(agent([], 0), builtIn));
  expect(reply).toMatch(/^_The Filey Agent is offline right now\. Filey AI answered instead\._\n\nbuilt-in reply$/);
  expect(events).toEqual([{ type: "done", text: reply, reason: "answered" }]);
});

it("never falls back once the agent has started, so an action can't run twice", async () => {
  const started = fileyAgentOrFallback(agent([{ type: "tool_call", id: "1", name: "create_invoice", args: {} }], 1), builtIn);
  await expect(run(started)).rejects.toThrow("offline");
});

it("passes a working agent turn through untouched", async () => {
  const { events, reply } = await run(fileyAgentOrFallback(agent([{ type: "text", text: "hi" }], -1), builtIn));
  expect(events).toEqual([{ type: "text", text: "hi" }]);
  expect(reply).toBe("agent reply");
});
