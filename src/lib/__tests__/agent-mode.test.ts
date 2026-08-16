import { beforeEach, describe, expect, it } from "vitest";
import { gateFor, getAgentMode, setAgentMode, modeSystemNote } from "../agentMode";

beforeEach(() => localStorage.clear());

// One read tool, one plain write, one money/outbound tool — the three kinds the
// modes have to tell apart.
const READ = "get_stats";
const WRITE = "create_invoice_draft";
const SENSITIVE = "send_invoice";

describe("agent mode gate", () => {
  it("defaults to accept_edits: edits run, money asks", () => {
    expect(getAgentMode()).toBe("accept_edits");
    expect(gateFor(READ)).toBe("run");
    expect(gateFor(WRITE)).toBe("run");
    expect(gateFor(SENSITIVE, true)).toBe("ask");
  });

  it("auto runs everything, sensitive included", () => {
    setAgentMode("auto");
    expect(gateFor(READ)).toBe("run");
    expect(gateFor(WRITE)).toBe("run");
    expect(gateFor(SENSITIVE, true)).toBe("run");
  });

  it("manual asks before any change but never before a read", () => {
    setAgentMode("manual");
    expect(gateFor(READ)).toBe("run");
    expect(gateFor(WRITE)).toBe("ask");
    expect(gateFor(SENSITIVE, true)).toBe("ask");
  });

  it("plan blocks every change and still allows reads", () => {
    setAgentMode("plan");
    expect(gateFor(READ)).toBe("run");
    expect(gateFor(WRITE)).toBe("block");
    expect(gateFor(SENSITIVE, true)).toBe("block");
  });

  it("a sensitive tool is gated even when it belongs to no capability group", () => {
    setAgentMode("accept_edits");
    expect(gateFor("some_unlisted_tool", true)).toBe("ask");
    expect(gateFor("some_unlisted_tool")).toBe("run");
  });

  it("survives a junk stored value rather than widening permissions", () => {
    localStorage.setItem("filey.agent.mode", "god");
    expect(getAgentMode()).toBe("accept_edits");
    expect(gateFor(SENSITIVE, true)).toBe("ask");
  });

  it("tells the model about the restrictive modes only", () => {
    expect(modeSystemNote("plan")).toContain("PLAN MODE");
    expect(modeSystemNote("manual")).toContain("MANUAL MODE");
    expect(modeSystemNote("accept_edits")).toBe("");
  });
});
