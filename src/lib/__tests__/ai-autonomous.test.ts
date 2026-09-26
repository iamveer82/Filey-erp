import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiAutonomous, aiAgent, setAiConfig } from "../ai";
import { listRuns, recordRun } from "../agentJournal";
import { setCacheOrg } from "../api";

/* The autonomous loop must: offer the task_complete finish tool, execute a
 * real tool round, then terminate when the model calls task_complete and
 * return that call's summary. fetch is mocked so no network/model is needed. */

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
  setCacheOrg("test-org", "test-user");
  setAiConfig({
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiKey: "test-key",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const oaMsg = (content: string, toolCalls?: unknown[]) => ({
  choices: [{ message: { role: "assistant", content, tool_calls: toolCalls } }],
});

describe("aiAutonomous loop", () => {
  it("ordinary chats learn from failures and replay the lesson next time", async () => {
    const sent: { messages: { content: string }[] }[] = [];
    let turn = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      const body = turn++ === 0
        ? oaMsg("", [{ id: "m1", type: "function", function: { name: "remember", arguments: '{"text":""}' } }])
        : oaMsg("Please give me a fact to remember.");
      return { ok: true, json: async () => body } as Response;
    }));
    await aiAgent([{ role: "user", text: "Remember something" }], { isOwner: true });
    expect(listRuns()).toHaveLength(1);
    expect(listRuns()[0].failures[0].tool).toBe("remember");
    await aiAgent([{ role: "user", text: "Try again" }], { isOwner: true });
    expect(JSON.stringify(sent[sent.length - 1])).toContain("WHAT DID NOT WORK BEFORE");
    expect(listRuns()).toHaveLength(1);
  });

  it("does not expose the owner's run journal to non-owner chats", async () => {
    recordRun({ goal: "private customer task", reason: "exhausted", failures: [] });
    const fetchFn = vi.fn(async () => ({ ok: true, json: async () => oaMsg("Hello") }) as Response);
    vi.stubGlobal("fetch", fetchFn);
    await aiAgent([{ role: "user", text: "Hello" }], { isOwner: false });
    expect(JSON.stringify(fetchFn.mock.calls)).not.toContain("private customer task");
    expect(listRuns()).toHaveLength(1);
  });

  it("runs a tool round, then finishes via task_complete and returns the summary", async () => {
    const bodies = [
      // round 1: model calls a real (safe, local) tool
      oaMsg("Planning…", [
        { id: "c1", type: "function", function: { name: "recall", arguments: "{}" } },
      ]),
      // round 2: model signals completion
      oaMsg("", [
        {
          id: "c2",
          type: "function",
          function: {
            name: "task_complete",
            arguments: JSON.stringify({ summary: "Reviewed memory; nothing to do." }),
          },
        },
      ]),
    ];
    let i = 0;
    const sentBodies: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: any) => {
        sentBodies.push(JSON.parse(init.body));
        const body = bodies[i++];
        return { ok: true, json: async () => body } as unknown as Response;
      })
    );

    const progress: string[] = [];
    const out = await aiAutonomous("Check my memory", {
      onProgress: (t) => progress.push(t),
    });

    expect(out).toBe("Reviewed memory; nothing to do.");
    expect(sentBodies.length).toBe(2); // looped twice, then stopped
    // the finish tool was offered to the model
    expect(
      sentBodies[0].tools.some((t: any) => t.function.name === "task_complete")
    ).toBe(true);
    // intermediate assistant text surfaced via onProgress
    expect(progress).toContain("Planning…");
  });

  it("stops at maxRounds if the model never finishes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () =>
          oaMsg("thinking", [
            { id: "x", type: "function", function: { name: "recall", arguments: "{}" } },
          ]),
      })) as unknown as typeof fetch
    );
    const out = await aiAutonomous("Loop forever", { maxRounds: 3 });
    // It must stop rather than loop, and it must account for itself: running
    // out of steps after changing data and saying only "I couldn't finish" is
    // how a user ends up not knowing what happened.
    expect(out).toMatch(/ran out of steps|couldn't finish/i);
    expect(out).toMatch(/recall/); // the step it actually took is named
  });
});
