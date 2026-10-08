import { describe, it, expect, vi, afterEach } from "vitest";
import { aiFetch } from "../ai";

const resp = (status: number, body = "{}") =>
  new Response(body, { status, headers: { "content-type": "application/json" } });

describe("aiFetch retry", () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it.each(["GET", "HEAD"])("retries a transient 503 for %s then succeeds", async (method) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(resp(503, '{"error":{"message":"busy"}}'))
      .mockResolvedValueOnce(resp(200, '{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);
    const r = await aiFetch("https://example.test", { method }, { baseDelayMs: 1 });
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([408, 425, 500, 502, 503, 504])("never replays a paid POST after an ambiguous %s response", async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(resp(status));
    vi.stubGlobal("fetch", fetchMock);
    await expect(aiFetch("https://example.test", { method: "post", body: '{"model":"paid-model"}' }, { baseDelayMs: 1 }))
      .rejects.toMatchObject({ status });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    new TypeError("Failed to fetch"),
    new DOMException("Timed out", "TimeoutError"),
  ])("never replays a paid POST after $name", async (error) => {
    const fetchMock = vi.fn().mockRejectedValue(error);
    vi.stubGlobal("fetch", fetchMock);
    await expect(aiFetch("https://example.test", { method: "POST" }, { baseDelayMs: 1 })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a POST rejected with an explicit rate limit", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(resp(429)).mockResolvedValueOnce(resp(200));
    vi.stubGlobal("fetch", fetchMock);
    const r = await aiFetch("https://example.test", { method: "POST" }, { baseDelayMs: 1 });
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops retrying a POST when a rate-limit retry loses its response", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(resp(429)).mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(aiFetch("https://example.test", { method: "POST" }, { baseDelayMs: 1 })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a 400 — throws immediately", async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp(400, '{"error":{"message":"bad"}}'));
    vi.stubGlobal("fetch", fetchMock);
    await expect(aiFetch("https://example.test", {}, { baseDelayMs: 1 })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a network error then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(resp(200));
    vi.stubGlobal("fetch", fetchMock);
    const r = await aiFetch("https://example.test", {}, { baseDelayMs: 1 });
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after retries are exhausted", async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp(503));
    vi.stubGlobal("fetch", fetchMock);
    await expect(aiFetch("https://example.test", {}, { retries: 2, baseDelayMs: 1 })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("never retries a user abort", async () => {
    const fetchMock = vi.fn().mockRejectedValue(
      Object.assign(new Error("aborted"), { name: "AbortError" })
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(aiFetch("https://example.test", {}, { baseDelayMs: 1 })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // A `Retry-After: 60` used to mean Stop did nothing for a minute: the wait
  // ran to completion and only the attempt after it noticed the abort.
  it("aborts during the backoff wait instead of sleeping it out", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response("{}", { status: 429, headers: { "retry-after": "30" } })
      );
    vi.stubGlobal("fetch", fetchMock);
    const ctl = new AbortController();
    const p = aiFetch("https://example.test", { method: "POST", signal: ctl.signal }, { baseDelayMs: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    ctl.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1); // no second attempt
    expect(vi.getTimerCount()).toBe(0);
  });
});
