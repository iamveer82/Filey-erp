import { expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ session: vi.fn(), channel: vi.fn(), setAuth: vi.fn(), remove: vi.fn() }));
vi.mock("../supabase", () => ({ isConfigured: true, supabase: { auth: { getSession: mock.session }, realtime: { setAuth: mock.setAuth }, channel: mock.channel, removeChannel: mock.remove } }));
import { startRealtime, stopRealtime, watchRealtimeSession } from "../realtime";

it("cannot revive a previous user's channel when sign-out races with startup", async () => {
  let first!: (value: unknown) => void;
  let second!: (value: unknown) => void;
  mock.session.mockImplementationOnce(() => new Promise((resolve) => { first = resolve; }));
  mock.session.mockImplementationOnce(() => new Promise((resolve) => { second = resolve; }));
  const channel = { on: vi.fn(), subscribe: vi.fn() };
  channel.on.mockReturnValue(channel); channel.subscribe.mockReturnValue(channel);
  mock.channel.mockReturnValue(channel);
  const oldStart = startRealtime();
  stopRealtime();
  const currentStart = startRealtime();
  first({ data: { session: { access_token: "old-account-token" } } });
  await oldStart;
  await startRealtime(); // the newer startup must still hold the lock
  expect(mock.session).toHaveBeenCalledTimes(2);
  expect(mock.channel).not.toHaveBeenCalled();
  second({ data: { session: { access_token: "current-account-token" } } });
  await currentStart;
  expect(mock.setAuth).toHaveBeenCalledExactlyOnceWith("current-account-token");
  expect(channel.subscribe).toHaveBeenCalledTimes(1);
  stopRealtime();
});

it("releases idle background channels and catches up once when returning", async () => {
  vi.useFakeTimers(); mock.session.mockReset(); mock.remove.mockClear();
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  mock.session.mockResolvedValue({ data: { session: { access_token: "current-account-token" } } });
  const changed = vi.fn(); window.addEventListener("filey:cloud-change", changed);
  const stop = watchRealtimeSession();
  await vi.advanceTimersByTimeAsync(0);
  visibility.mockReturnValue("hidden"); document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(59_999); expect(mock.remove).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(mock.remove).toHaveBeenCalledOnce();
  visibility.mockReturnValue("visible"); document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(0); expect(changed).toHaveBeenCalledOnce();
  expect(mock.session).toHaveBeenCalledTimes(2);
  stop(); document.dispatchEvent(new Event("visibilitychange"));
  expect(mock.session).toHaveBeenCalledTimes(2);
  window.removeEventListener("filey:cloud-change", changed);
  vi.restoreAllMocks(); vi.useRealTimers();
});

it("catches up after a socket reconnect and ignores callbacks from a signed-out session", async () => {
  mock.session.mockResolvedValue({ data: { session: { access_token: "current-account-token", user: { id: "owner" } } } });
  let status!: (value: string) => void;
  const channel = { on: vi.fn(), subscribe: vi.fn((callback) => { status = callback; return channel; }) };
  channel.on.mockReturnValue(channel);
  mock.channel.mockReturnValue(channel);
  const changed = vi.fn();
  window.addEventListener("filey:cloud-change", changed);
  try {
    await startRealtime();
    status("SUBSCRIBED");
    expect(changed).not.toHaveBeenCalled();
    status("CHANNEL_ERROR");
    status("SUBSCRIBED");
    expect(changed).toHaveBeenCalledOnce();
    stopRealtime();
    status("SUBSCRIBED");
    expect(changed).toHaveBeenCalledOnce();
  } finally {
    stopRealtime();
    window.removeEventListener("filey:cloud-change", changed);
  }
});
