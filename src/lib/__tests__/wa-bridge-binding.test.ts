import { afterEach, beforeEach, expect, it, vi } from "vitest";

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
  rpc.mockResolvedValue({ state: "connected", me: "971500000001@s.whatsapp.net" });
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
  session.account = null;
  finish({ state: "connected" });
  await expect(connecting).rejects.toThrow("account changed");
  expect(rpc).toHaveBeenCalledWith("wa_bridge_stop");
  expect(localStorage.getItem("filey.wa_bridge.account")).toBeNull();
});

it("does not claim a pairing when the native connection fails", async () => {
  const bridge = await import("../waBridge");
  rpc.mockRejectedValueOnce(new Error("binary missing"));
  await expect(bridge.startBridge()).rejects.toThrow("binary missing");
  expect(localStorage.getItem("filey.wa_bridge.account")).toBeNull();
});

it("resumes a bound account only after authentication and stops on sign-out", async () => {
  localStorage.setItem("filey.wa_bridge.account", "org:user:one");
  session.account = null;
  const bridge = await import("../waBridge");
  await bridge.autoStartBridge();
  expect(rpc).not.toHaveBeenCalledWith("wa_bridge_start");
  session.account = "org:user:one";
  await bridge.autoStartBridge();
  expect(rpc).toHaveBeenCalledWith("wa_bridge_start");
  rpc.mockClear();
  session.account = null;
  await bridge.autoStartBridge();
  expect(rpc).toHaveBeenCalledWith("wa_bridge_stop");
  expect(rpc).not.toHaveBeenCalledWith("wa_bridge_start");
});
