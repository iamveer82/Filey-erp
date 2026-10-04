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
import { setCacheOrg } from "../api";
import { setCapabilityEnabled } from "../capabilities";

const sendWa = vi.fn();
const bridgeState = vi.fn();
vi.mock("../waBridge", () => ({
  hasDesktop: true,
  bridgeState: (...args: unknown[]) => bridgeState(...args),
  sendWa: (...a: unknown[]) => {
    sendWa(...a);
    return Promise.resolve("provider-message-id");
  },
}));
vi.mock("../waLog", () => ({ waLogAdd: () => {}, waLogList: () => [] }));

beforeEach(() => {
  sendWa.mockClear();
  bridgeState.mockReset().mockResolvedValue({ state: "connected", me: "971500000000@s.whatsapp.net" });
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
  setCacheOrg("test-org", "test-user");
});

describe("Auto mode vs a caller-supplied confirm", () => {
  it("does not send after a bridge lookup crosses workspaces and returns to the original account", async () => {
    setAgentMode("auto");
    bridgeState.mockImplementationOnce(async () => {
      setCacheOrg("other-org", "other-user");
      setCacheOrg("test-org", "test-user");
      return { state: "connected", me: "971500000000@s.whatsapp.net" };
    });
    await expect(runTool("send_whatsapp", { to: "971509999999", text: "approved draft" }, () => true, true))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(sendWa).not.toHaveBeenCalled();
  });
  it.each(["capability", "plan mode"])("honors %s revocation while an outbound approval is pending", async (change) => {
    setAgentMode("auto");
    let approve!: (value: boolean) => void;
    const result = runTool("send_whatsapp", { to: "971509999999", text: "approved draft" }, () => new Promise<boolean>(resolve => { approve = resolve; }), true);
    await vi.waitFor(() => expect(approve).toBeTypeOf("function"));
    if (change === "capability") setCapabilityEnabled("channels", false);
    else setAgentMode("plan");
    approve(true);
    expect(await result).toMatchObject({
      error: expect.stringContaining(change === "capability" ? "capability was turned off" : "access mode changed"),
      retry_safe: false,
    });
    expect(sendWa).not.toHaveBeenCalled();
  });
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
