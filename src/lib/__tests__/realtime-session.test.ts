import { expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ session: vi.fn(), channel: vi.fn(), setAuth: vi.fn(), remove: vi.fn() }));
vi.mock("../supabase", () => ({ isConfigured: true, supabase: { auth: { getSession: mock.session }, realtime: { setAuth: mock.setAuth }, channel: mock.channel, removeChannel: mock.remove } }));
import { startRealtime, stopRealtime } from "../realtime";

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
