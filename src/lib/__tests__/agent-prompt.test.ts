import { describe, expect, it, vi } from "vitest";
import { AGENT_IDENTITY, agentSystemBase, MEMORY_NUDGE_INTERVAL, memoryNudge, platformHint, taskNeedsTools, withoutMemoryNudge } from "../agentPrompt";
import type { AiMessage } from "../ai";

const streamed: AiMessage[][] = [];
vi.mock("../ai", () => ({
  aiAgentStream: async function* (messages: AiMessage[]) { streamed.push(messages); yield { type: "done", text: "ok", reason: "answered" }; return "ok"; },
  aiAutonomousStream: vi.fn(),
  buildSystemPrompt: (base: string) => base,
  getPersona: () => ({ assistantName: "Filey", userName: "", role: "", vibe: "Friendly" }),
}));
vi.mock("../aiMemory", () => ({ AGENT_HABITS: "HABITS", memoryDigest: () => "" }));
vi.mock("../agentSkills", () => ({ skillsIndex: () => "" }));
vi.mock("../aiContext", () => ({ buildAiContext: async () => "" }));
vi.mock("../fileyAgent", () => ({ fileyAgentEnabled: () => false, fileyAgentTurn: vi.fn() }));
const learn = { allowed: true };
vi.mock("../capabilities", () => ({ isToolAllowed: () => learn.allowed }));
vi.mock("../agentMode", () => ({ gateFor: () => "run" }));

describe("Filey's brief (the Hermes identity and guidance)", () => {
  it("opens with the SOUL: a personal agent that sizes its reply to the ask", () => {
    const app = agentSystemBase("app");
    expect(app.startsWith(AGENT_IDENTITY)).toBe(true);
    expect(AGENT_IDENTITY).toContain("personal AI agent");
    expect(AGENT_IDENTITY).toContain("match the length of your reply to the weight of the ask");
    expect(AGENT_IDENTITY).toContain("Depth is earned");
  });

  it("carries the Hermes guidance blocks, translated to Filey's tools", () => {
    const app = agentSystemBase("app");
    for (const heading of ["# Finishing the job", "# Several tools in one round", "# Act, don't narrate", "# Execution discipline", "# Memory", "# Skills"])
      expect(app).toContain(heading);
    expect(app).toContain("search_conversations");
    expect(app).toContain("# How you work");
    expect(taskNeedsTools("make an invoice")).toBe(true);
    expect(taskNeedsTools("hello")).toBe(false);
    expect(app).toMatch(/tag "user"/);
    // Hermes names terminal and execute_code; Filey has neither in the app brief.
    expect(app).not.toMatch(/\bterminal\b|execute_code|skill_manage|session_search/);
  });

  it("formats for the surface: Markdown in the app, plain text on chat channels", () => {
    expect(platformHint("app")).toContain("renders Markdown");
    expect(platformHint("whatsapp")).toContain("plain text only");
    expect(platformHint("telegram")).toContain("Telegram");
    const channel = agentSystemBase("whatsapp");
    expect(channel).toContain(AGENT_IDENTITY);
    expect(channel).toContain("# Memory");
    // Channel turns are billed per message, so the long discipline block stays in the app.
    expect(channel).not.toContain("# Execution discipline");
    expect(channel).not.toContain("SHOW, DON'T JUST TELL");
  });

  it("names learn_skill only when that write is offered and runs unasked, like Hermes gates skill_manage", () => {
    const open = agentSystemBase("app", { canLearnSkills: true });
    const closed = agentSystemBase("app", { canLearnSkills: false });
    expect(open).toContain("record it with learn_skill");
    expect(closed).not.toContain("learn_skill");
    expect(closed).toContain("belongs in skills, not in memory, even when skill writing is unavailable");
    expect(closed).toContain("load it with use_skill");
    expect(memoryNudge(10, { canLearnSkills: false })).not.toContain("learn_skill");
  });

  it("gives records and journals the user's words back, without the nudge", () => {
    const nudge = memoryNudge(20)!;
    expect(withoutMemoryNudge(`send the pdf again\n\n${nudge}`)).toBe("send the pdf again");
    expect(withoutMemoryNudge("send the pdf again")).toBe("send the pdf again");
    // A user who happens to type the opener keeps their text: only a complete trailing note is cut.
    expect(withoutMemoryNudge("about that\n\n[Memory check from Filey's runtime, I think")).toBe("about that\n\n[Memory check from Filey's runtime, I think");
  });

  it("nudges itself to persist knowledge every tenth user turn, in words the harness classifiers ignore", () => {
    expect(MEMORY_NUDGE_INTERVAL).toBe(10);
    for (const turn of [0, 1, 9, 11, 19, 10.5]) expect(memoryNudge(turn)).toBeUndefined();
    for (const turn of [10, 20, 30]) {
      const nudge = memoryNudge(turn)!;
      expect(nudge).toContain(`${turn} messages in`);
      expect(nudge).toContain("remember");
      expect(nudge).toContain("learn_skill");
      expect(nudge).toContain("not from the user");
      // A "?" or a figures word would make agentHarness ship the card schemas for a runtime note.
      expect(nudge).not.toMatch(/\?|\b(?:show|plan|steps?|status|report\w*|what|how|which)\b/i);
    }
  });

  it("rides the nudge on the user message, never the system prompt", async () => {
    const { builtInAgentTurn: runAgentTurn } = await import("../agentTurn");
    const options = { isOwner: true, signal: new AbortController().signal, agentId: "chat", confirm: () => true };
    const turns = (n: number): AiMessage[] => Array.from({ length: n }, (_, i) => [
      { role: "user" as const, text: `u${i}` }, { role: "assistant" as const, text: `a${i}` }]).flat();

    const quiet = runAgentTurn({ chatId: "c", goalText: "hi", history: turns(3), auto: false }, options);
    for await (const _ of quiet) { /* drain */ }
    const tenth = runAgentTurn({ chatId: "c", goalText: "hi", history: turns(9), auto: false }, options);
    for await (const _ of tenth) { /* drain */ }

    // The model history is capped at 30 turns, so a long chat passes its real count.
    const long = runAgentTurn({ chatId: "c", goalText: "hi", history: turns(15), userTurn: 40, auto: false }, options);
    for await (const _ of long) { /* drain */ }

    learn.allowed = false;
    const gated = runAgentTurn({ chatId: "c", goalText: "hi", history: turns(9), auto: false }, options);
    for await (const _ of gated) { /* drain */ }
    learn.allowed = true;

    const last = (m: AiMessage[]) => m[m.length - 1];
    expect(last(streamed[0]).text).toBe("hi");
    expect(last(streamed[1]).text).toMatch(/^hi\n\n\[Memory check/);
    expect(last(streamed[2]).text).toContain("40 messages in");
    expect(streamed[1][0].text).not.toContain("Memory check");
    expect(streamed[1][0].text).toContain(AGENT_IDENTITY);
    expect(streamed[1][0].text).toContain("record it with learn_skill");
    expect(streamed[3][0].text).not.toContain("learn_skill");
    expect(last(streamed[3]).text).toContain("[Memory check");
    expect(last(streamed[3]).text).not.toContain("learn_skill");
  });
});
