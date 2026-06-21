import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiAutonomous, setAiConfig } from "../ai";

/* The autonomous loop must: offer the task_complete finish tool, execute a
 * real tool round, then terminate when the model calls task_complete and
 * return that call's summary. fetch is mocked so no network/model is needed. */

beforeEach(() => {
  localStorage.clear();
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
    expect(out).toContain("couldn't finish");
  });
});
