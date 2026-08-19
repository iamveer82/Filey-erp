// Auto mode must not defeat a caller's own approval gate.
//
// The bug: gateFor() returns "run" for everything in Auto mode, and runTool
// only consulted `confirm` when the gate said "ask". So waAgent's two-pass
// reply-YES gate — whose comment promises "Nothing leaves without approval" —
// was skipped entirely, and the agent sent WhatsApp messages to customers with
// no approval at all. Reported in the wild as the agent spamming contacts.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { runTool } from "../aiTools";
import { setAgentMode } from "../agentMode";

const sendWa = vi.fn();
vi.mock("../waBridge", () => ({
  hasDesktop: true,
  bridgeState: async () => ({ state: "connected", me: "971500000000@s.whatsapp.net" }),
  sendWa: (...a: unknown[]) => {
    sendWa(...a);
    return Promise.resolve();
  },
}));
vi.mock("../waLog", () => ({ waLogAdd: () => {}, waLogList: () => [] }));

beforeEach(() => {
  sendWa.mockClear();
  localStorage.clear();
});

describe("Auto mode vs a caller-supplied confirm", () => {
  it("refuses a sensitive tool when the caller's confirm says no, even in Auto", async () => {
    setAgentMode("auto");
    const deny = vi.fn(() => false);

    const out = (await runTool(
      "send_whatsapp",
      { to: "971509999999", text: "spam" },
      deny,
      true
    )) as { error?: string };

    expect(deny).toHaveBeenCalled(); // the whole bug was that it was not
    expect(out.error).toMatch(/did not approve/i);
    expect(sendWa).not.toHaveBeenCalled();
  });

  it("still sends when the caller's confirm approves", async () => {
    setAgentMode("auto");

    const out = (await runTool(
      "send_whatsapp",
      { to: "971509999999", text: "hello" },
      () => true,
      true
    )) as { ok?: boolean };

    expect(out.ok).toBe(true);
    expect(sendWa).toHaveBeenCalledTimes(1);
  });

  it("leaves Auto mode alone when no confirm is supplied (the in-app chat)", async () => {
    setAgentMode("auto");

    const out = (await runTool(
      "send_whatsapp",
      { to: "971509999999", text: "hello" },
      undefined,
      true
    )) as { ok?: boolean };

    // Auto means auto for the surface the owner is actually watching.
    expect(out.ok).toBe(true);
    expect(sendWa).toHaveBeenCalledTimes(1);
  });

  it("does not make a non-sensitive write ask just because a confirm exists", async () => {
    setAgentMode("auto");
    const deny = vi.fn(() => false);

    // A read is never gated, with or without a confirm.
    const out = (await runTool("list_whatsapp_messages", {}, deny, true)) as {
      error?: string;
    };

    expect(deny).not.toHaveBeenCalled();
    expect(out.error).toBeUndefined();
  });
});
