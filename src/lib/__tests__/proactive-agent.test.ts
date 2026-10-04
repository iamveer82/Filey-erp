import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  scope: "org:user:alice" as string | null,
  connected: (_value: { state: string }) => {},
  bridge: vi.fn(), send: vi.fn(), warn: vi.fn(),
}));
vi.mock("../api", () => ({ getCacheScope: () => state.scope }));
vi.mock("../ai", () => ({ aiReady: () => false, aiAutonomous: vi.fn(), DENY_SENSITIVE: vi.fn() }));
vi.mock("../aiCredits", () => ({ creditChoice: () => ({ funding: "credits" }) }));
vi.mock("../log", () => ({ log: { warn: state.warn } }));
vi.mock("../waAgent", () => ({ waFormat: (text: string) => text }));
vi.mock("../waBridge", () => ({
  hasDesktop: true, bridgeState: state.bridge, sendWa: state.send,
  getBridgeConfig: () => ({ ownerNumber: "" }),
  onBridgeState: (callback: typeof state.connected) => { state.connected = callback; },
}));

beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers();
  localStorage.clear(); localStorage.setItem("filey_data_mode", "local");
  state.scope = "org:user:alice";
  state.bridge.mockReset().mockResolvedValue({ me: "alice@s.whatsapp.net" });
  state.send.mockReset().mockResolvedValue("receipt"); state.warn.mockReset();
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

async function setup() {
  const reminders = await import("../reminders");
  (await import("../proactiveAgent")).startProactiveAgent();
  return reminders;
}

it("serializes due sweeps and preserves additions and cancellations while sending", async () => {
  const reminders = await setup();
  reminders.addReminder("Due", Date.now() - 1);
  const cancelled = reminders.addReminder("Cancel while sending", Date.now() - 1);
  let release!: (receipt: string) => void;
  state.send.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  state.connected({ state: "connected" });
  await vi.waitFor(() => expect(state.send).toHaveBeenCalledTimes(1));
  reminders.removeReminder(cancelled.id);
  reminders.addReminder("New reminder", Date.now() + 100_000);
  state.connected({ state: "connected" });
  await Promise.resolve();
  expect(state.send).toHaveBeenCalledTimes(1);
  release("receipt");
  await vi.waitFor(() => expect(reminders.loadReminders().map(r => r.text)).toEqual(["New reminder"]));
});

it.each(["owner", "send"])("does not send or persist Alice's reminders in Bob's workspace after a switch during %s resolution", async phase => {
  const reminders = await setup();
  reminders.addReminder("Alice private reminder", Date.now() - 1);
  let release!: (value: unknown) => void;
  const waiting = new Promise(resolve => { release = resolve; });
  if (phase === "owner") state.bridge.mockImplementationOnce(() => waiting);
  else state.send.mockImplementationOnce(() => waiting);
  state.connected({ state: "connected" });
  await vi.waitFor(() => expect(phase === "owner" ? state.bridge : state.send).toHaveBeenCalledTimes(1));
  state.scope = "org:user:bob";
  reminders.addReminder("Bob reminder", Date.now() + 100_000);
  release(phase === "owner" ? { me: "bob@s.whatsapp.net" } : "receipt");
  await vi.waitFor(() => expect(state.warn).toHaveBeenCalled());
  expect(state.send).toHaveBeenCalledTimes(phase === "owner" ? 0 : 1);
  expect(reminders.loadReminders().map(r => r.text)).toEqual(["Bob reminder"]);
  state.scope = "org:user:alice";
  expect(reminders.loadReminders().map(r => r.text)).toEqual(["Alice private reminder"]);
});
