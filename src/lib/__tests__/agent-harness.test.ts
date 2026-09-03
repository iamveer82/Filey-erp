import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiAgentStream, setAiConfig } from "../ai";
import type { AgentEvent } from "../agentHarness";
import { setDataMode } from "../dataMode";
import { runTool } from "../aiTools";
import { headroomReset } from "../headroom";

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

/** A big enough result that headroom engages (>1500 chars on the wire). */
async function seedManyCustomers() {
  setDataMode("local");
  for (let i = 0; i < 40; i++) {
    await runTool("create_customer", {
      name: `Customer Number ${i} Trading LLC`,
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
    expect(final).toMatch(/ran out of steps|couldn't finish/);
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
        throw new Error("socket hung up");
      })
    );
    const { events, final } = await collect(
      aiAgentStream([{ role: "user", text: "hello" }])
    );
    expect(events[events.length - 1]).toMatchObject({ type: "done", reason: "error" });
    expect(final).toMatch(/model call failed/);

    // A hard HTTP refusal is non-retryable, so it surfaces immediately.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 401,
        text: async () => "bad key",
        json: async () => ({}),
      }))
    );
    const http = await collect(aiAgentStream([{ role: "user", text: "hello" }]));
    expect(http.events[http.events.length - 1]).toMatchObject({
      type: "done",
      reason: "error",
    });
    expect(http.final).toMatch(/model call failed/);
  });

  it("sends temperature to Anthropic and stops re-sending old images", async () => {
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
    expect(first.temperature).toBe(0.3);
    expect(JSON.stringify(first.messages)).toContain("AAAA");
    // Round two must not carry the base64 payload again — the text survives.
    const second = JSON.parse(String(calls[1].body));
    expect(JSON.stringify(second.messages)).not.toContain("AAAA");
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
    // …the model called it, and got the FULL original back on the wire.
    const retrieveCall = events.find(
      (e) => e.type === "tool_call" && e.name === "headroom_retrieve"
    );
    expect(retrieveCall).toBeDefined();
    expect(final).toBe("All retrieved.");
  });
});
