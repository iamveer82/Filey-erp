import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiAgentStream, setAiConfig } from "../ai";
import type { AgentEvent } from "../agentHarness";

/* The loop is written once and shared by every provider. These tests pin the
 * two things that regressed when there were two copies of it:
 *
 *  1. the run is observable step by step, not just as a final string;
 *  2. both providers produce the SAME sequence of steps for the same
 *     conversation. The round budget was once raised in one loop and not the
 *     other, and nothing failed until a user noticed the agent giving up early.
 */

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

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
    expect(final).toMatch(/ran out of steps|couldn't finish/);
    // Two rounds means two model calls, not an unbounded run.
    expect(events.filter((e) => e.type === "tool_call")).toHaveLength(2);
  });
});
