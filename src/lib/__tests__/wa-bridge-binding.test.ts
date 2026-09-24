// Membership denial is exercised by module-access tests; these fixtures isolate native pairing ownership.
vi.mock("../moduleAccess", () => ({requireModuleAccess: vi.fn(async () => {})}));
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { requireModuleAccess } from "../moduleAccess";

const session = vi.hoisted(() => ({
  account: "org:user:one" as string | null,
  mode: "local",
}));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: rpc }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("../api", () => ({ getCacheScope: () => session.account }));
vi.mock("../agentStorage", () => ({
  agentStorageScope: () =>
    session.account ? `${session.mode}:${session.account}` : null,
  AGENT_STORAGE_EVENT: "test:account",
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
  session.account = "org:user:one";
  session.mode = "local";
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  rpc.mockResolvedValue({ state: "connected", me: "971500000001@s.whatsapp.net", sessionId: "session-one" });
});
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

it("does not automatically claim legacy pairing or expose its owner preferences", async () => {
  localStorage.setItem("filey.wa_bridge.owner", "971599999999");
  const bridge = await import("../waBridge");
  await bridge.autoStartBridge();
  expect(rpc).not.toHaveBeenCalled();
  expect(bridge.getBridgeConfig()).toEqual({ autoStart: false, ownerNumber: "" });
  expect(await bridge.bridgeState()).toMatchObject({
    state: "stopped",
    error: expect.stringContaining("Connect WhatsApp once"),
  });
  await expect(bridge.sendWa("971500000001", "private data")).rejects.toThrow(
    "Connect WhatsApp once"
  );
});

it("binds explicit Connect and retains it across modes but blocks another account", async () => {
  const bridge = await import("../waBridge");
  await bridge.startBridge();
  bridge.setBridgeConfig({ ownerNumber: "971500000002" });
  session.mode = "cloud";
  await bridge.sendWa("971500000001", "hello");
  expect(rpc).toHaveBeenCalledWith("wa_bridge_send", {
    to: "971500000001",
    text: "hello",
    sessionId: "session-one",
  });
  session.account = "different-org:user:two";
  expect(bridge.getBridgeConfig().ownerNumber).toBe("");
  expect(await bridge.bridgeState()).toMatchObject({ state: "stopped" });
  await expect(bridge.startBridge()).rejects.toThrow("Re-pair");
  await expect(bridge.sendWa("971500000001", "other account data")).rejects.toThrow(
    "another Filey account"
  );
});

it("stops a connection completed after the user signs out without assigning it", async () => {
  const bridge = await import("../waBridge");
  let finish!: (state: { state: string }) => void;
  rpc.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const connecting = bridge.startBridge();
  const rejected = expect(connecting).rejects.toThrow("account changed");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  session.account = null;
  finish({ state: "connected" });
  await rejected;
  expect(rpc).toHaveBeenCalledWith("wa_bridge_stop");
  expect(localStorage.getItem("filey.wa_bridge.account")).toBeNull();
});

it("does not claim a pairing when the native connection fails", async () => {
  const bridge = await import("../waBridge");
  rpc.mockRejectedValueOnce(new Error("binary missing"));
  await expect(bridge.startBridge()).rejects.toThrow("binary missing");
  expect(localStorage.getItem("filey.wa_bridge.account")).toBeNull();
});

it("validates and normalizes the owner number before changing access", async () => {
  const bridge = await import("../waBridge");
  expect(bridge.setBridgeConfig({ ownerNumber: "+971 50 000 0002" }).ownerNumber).toBe("971500000002");
  expect(() => bridge.setBridgeConfig({ ownerNumber: "customer-971500000003" })).toThrow("full phone number");
  expect(bridge.getBridgeConfig().ownerNumber).toBe("971500000002");
  await bridge.startBridge();
  expect(rpc).toHaveBeenCalledWith("wa_bridge_start", { ownerNumber: "971500000002" });
});

it("resumes a bound account only after authentication and stops on sign-out", async () => {
  localStorage.setItem("filey.wa_bridge.account", "org:user:one");
  session.account = null;
  const bridge = await import("../waBridge");
  await bridge.autoStartBridge();
  expect(rpc).not.toHaveBeenCalledWith("wa_bridge_start", expect.anything());
  session.account = "org:user:one";
  await bridge.autoStartBridge();
  expect(rpc).toHaveBeenCalledWith("wa_bridge_start", { ownerNumber: "" });
  rpc.mockClear();
  session.account = null;
  await bridge.autoStartBridge();
  expect(rpc).toHaveBeenCalledWith("wa_bridge_stop");
  expect(rpc).not.toHaveBeenCalledWith("wa_bridge_start", expect.anything());
});

it("binds every reply and attachment to the incoming bridge generation", async () => {
  const bridge = await import("../waBridge");
  await bridge.startBridge();
  await bridge.replyWa("request-one", "Ready", "session-one");
  expect(rpc).toHaveBeenCalledWith("wa_bridge_reply", { id: "request-one", text: "Ready", sessionId: "session-one" });
  await bridge.sendWaFile("971500000001", { path: "C:/Exports/report.pdf", filename: "report.pdf" }, "session-one");
  expect(rpc).toHaveBeenCalledWith("wa_bridge_send_file", expect.objectContaining({ sessionId: "session-one" }));
  rpc.mockClear();
  await expect(bridge.sendWaFile("971500000001", { path: "C:/Exports/report.pdf", filename: "report.pdf" }, "expired-session")).rejects.toThrow("restarted");
  expect(rpc).not.toHaveBeenCalledWith("wa_bridge_send_file", expect.anything());
  await expect(bridge.replyWa("old-request", "Private data", "")).rejects.toThrow("expired");
});

it("captures the send session before permissions resolve instead of using a re-paired phone", async () => {
  const bridge = await import("../waBridge");
  await bridge.startBridge();
  let permit!: () => void;
  vi.mocked(requireModuleAccess).mockImplementationOnce(() => new Promise(resolve => { permit = resolve; }));
  const sending = bridge.sendWa("971500000001", "Hello");
  await vi.waitFor(() => expect(permit).toBeTypeOf("function"));
  rpc.mockResolvedValue({ state: "connected", me: "971500000002@s.whatsapp.net", sessionId: "session-two" });
  permit();
  await sending;
  // The native layer compares this captured ID atomically before writing.
  expect(rpc).toHaveBeenCalledWith("wa_bridge_send", { to: "971500000001", text: "Hello", sessionId: "session-one" });
});

it("preserves the pairing across storage modes but cancels an in-flight send during a switch", async () => {
  const bridge = await import("../waBridge");
  await bridge.startBridge();
  let permit!: () => void;
  vi.mocked(requireModuleAccess).mockImplementationOnce(() => new Promise(resolve => { permit = resolve; }));
  const sending = bridge.sendWa("971500000001", "Old workspace output");
  const rejected = expect(sending).rejects.toThrow("Workspace changed");
  await vi.waitFor(() => expect(permit).toBeTypeOf("function"));
  session.mode = "cloud";
  permit();
  await rejected;
  expect(rpc).not.toHaveBeenCalledWith("wa_bridge_send", expect.anything());
  expect(localStorage.getItem("filey.wa_bridge.account")).toBe(session.account);
});
