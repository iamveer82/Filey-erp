import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ bridge: { state: "connected", sessionId: "s1" } as { state: string; sessionId?: string } }));
vi.hoisted(() => { (globalThis as { window?: unknown }).window ??= globalThis; (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}; });
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (cmd: string) => (cmd === "wa_bridge_state" ? state.bridge : null)) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("../api", () => ({ getCacheScope: () => "org:1:user:1" }));
vi.mock("../agentStorage", () => ({ agentStorageScope: () => "local:org:1:user:1", AGENT_STORAGE_EVENT: "agent-storage" }));
vi.mock("../moduleAccess", () => ({ requireModuleAccess: async () => {} }));
vi.mock("../log", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { checkBridgeAlive, restartDelay } from "../waBridge";

beforeEach(() => {
  localStorage.setItem("filey.wa_bridge.account", "org:1:user:1");
  state.bridge = { state: "connected", sessionId: "s1" };
});

it("restarts a bridge only after two missed pings in a row", async () => {
  const dead = vi.fn(async () => { throw new Error("timeout"); });
  expect(await checkBridgeAlive(dead)).toBe("missed");
  expect(await checkBridgeAlive(dead)).toBe("restart");
  expect(await checkBridgeAlive(async () => {})).toBe("ok");
  expect(await checkBridgeAlive(dead)).toBe("missed");
});

it("does not count a disconnect or a replaced session as a freeze", async () => {
  expect(await checkBridgeAlive(async () => { state.bridge = { state: "connected", sessionId: "s2" }; throw new Error("replaced"); })).toBe("idle");
  state.bridge = { state: "reconnecting", sessionId: "s2" };
  const ping = vi.fn();
  expect(await checkBridgeAlive(ping)).toBe("idle");
  expect(ping).not.toHaveBeenCalled();
});

it("backs off crash restarts up to a minute", () => {
  expect([0, 1, 2, 3, 10].map(restartDelay)).toEqual([3000, 6000, 12000, 24000, 60000]);
});
