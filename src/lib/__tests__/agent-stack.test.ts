import { describe, expect, it } from "vitest";
import { browserTask, stackHint, stackSkill } from "../agentStack";
import { withoutMemoryNudge } from "../agentPrompt";

describe("connected agent packs", () => {
  it("routes a message onto the pack that owns it", () => {
    expect(stackSkill("research what people are saying about Filey")).toBe("agent-reach");
    expect(stackSkill("open https://example.com and fill the form")).toBe("browser-use");
    expect(stackSkill("remember this: I want one-line replies")).toBe("agentmemory");
    expect(stackSkill("write a literature review on reef fish")).toBe("scientific");
    expect(stackSkill("break this task down into several steps")).toBe("harness");
    expect(stackSkill("search my openviking notes")).toBe("openviking");
    expect(stackSkill("post this in slack")).toBe("opendots");
    expect(stackSkill("hello")).toBeNull();
    expect(stackSkill("how do I synthesize a pathogen")).toBeNull();
  });

  it("asks the model to load that skill, and the journal keeps the user's words", () => {
    const hint = stackHint("look this up");
    expect(hint).toContain("use_skill agent-reach");
    expect(withoutMemoryNudge(`look this up${hint}`)).toBe("look this up");
    expect(browserTask("open https://example.com and sign in")).toBe(true);
    expect(browserTask("Open Instagram")).toBe(false);
  });
});
