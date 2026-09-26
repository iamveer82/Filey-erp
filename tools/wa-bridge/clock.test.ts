import { afterEach, expect, it, vi } from "vitest";
import { whatsappClock } from "./clock.mjs";

afterEach(() => vi.useRealTimers());

it.each([-3, 3])("uses server time when the device is %s hours out, and survives clock corrections", async hours => {
  vi.useFakeTimers();
  const server = Date.parse("2026-09-24T12:00:00Z");
  vi.setSystemTime(server + hours * 3600_000);
  const send = vi.fn().mockResolvedValue(new Response(null, { headers: { date: new Date(server).toUTCString() } }));
  const clock = await whatsappClock(send);
  expect(clock.startedAtSeconds).toBe(server / 1000);
  expect(clock.nowSeconds()).toBe(server / 1000);
  await vi.advanceTimersByTimeAsync(5000);
  vi.setSystemTime(server - 3600_000);
  expect(clock.nowSeconds()).toBe(server / 1000 + 5);
  expect(send).toHaveBeenCalledExactlyOnceWith("https://web.whatsapp.com/", expect.objectContaining({ method: "HEAD", cache: "no-store", redirect: "error" }));
});

it.each(["missing date", "network error"])("keeps a bounded local-time guard when the time check fails: %s", async failure => {
  vi.useFakeTimers();
  const now = Date.now();
  const send = failure === "network error" ? vi.fn().mockRejectedValue(new Error("Offline")) : vi.fn().mockResolvedValue(new Response());
  const clock = await whatsappClock(send);
  expect(clock.startedAtSeconds).toBe(Math.floor(now / 1000));
  await vi.advanceTimersByTimeAsync(2000);
  expect(clock.nowSeconds()).toBe(Math.floor(now / 1000) + 2);
});
