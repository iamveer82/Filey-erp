import { beforeEach, describe, expect, it } from "vitest";
import { isToolAllowed, setCapabilityEnabled } from "../capabilities";
import { isDue, type AgentTask } from "../agentTasks";

beforeEach(() => localStorage.clear());

describe("capabilities gate", () => {
  it("ungrouped read/nav tools are always allowed", () => {
    expect(isToolAllowed("get_stats")).toBe(true);
    expect(isToolAllowed("find_customers")).toBe(true);
    expect(isToolAllowed("recall")).toBe(true);
  });

  it("grouped tools default to allowed", () => {
    expect(isToolAllowed("send_gmail")).toBe(true);
    expect(isToolAllowed("create_invoice_draft")).toBe(true);
  });

  it("disabling a capability blocks only its tools", () => {
    setCapabilityEnabled("channels", false);
    expect(isToolAllowed("send_gmail")).toBe(false);
    expect(isToolAllowed("composio_run")).toBe(false);
    expect(isToolAllowed("create_invoice_draft")).toBe(true); // different group
    setCapabilityEnabled("channels", true);
    expect(isToolAllowed("send_gmail")).toBe(true);
  });
});

describe("task scheduling (isDue)", () => {
  const mk = (
    schedule: AgentTask["schedule"],
    over: Partial<AgentTask> = {}
  ): AgentTask => ({
    id: "t",
    name: "t",
    goal: "g",
    schedule,
    enabled: true,
    createdAt: Date.now(),
    ...over,
  });

  it("interval task fires only after the interval elapses", () => {
    expect(isDue(mk({ type: "interval", minutes: 30 }, { createdAt: Date.now() - 31 * 60_000 }))).toBe(true);
    expect(isDue(mk({ type: "interval", minutes: 30 }, { createdAt: Date.now() - 10 * 60_000 }))).toBe(false);
  });

  it("disabled tasks never fire", () => {
    expect(isDue(mk({ type: "interval", minutes: 1 }, { enabled: false, createdAt: 0 }))).toBe(false);
  });

  it("daily task fires after its time, once per day", () => {
    expect(isDue(mk({ type: "daily", time: "00:00" }))).toBe(true);
    expect(isDue(mk({ type: "daily", time: "00:00" }, { lastRun: Date.now() }))).toBe(false);
  });
});
