import { describe, it, expect, vi, afterEach } from "vitest";
import { aiFetch } from "../ai";

const resp = (status: number, body = "{}") =>
  new Response(body, { status, headers: { "content-type": "application/json" } });

describe("aiFetch retry", () => {
  afterEach(() => vi.restoreAllMocks());

  it("retries a transient 503 then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(resp(503, '{"error":{"message":"busy"}}'))
      .mockResolvedValueOnce(resp(200, '{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);
    const r = await aiFetch("http://x", { method: "POST" }, { baseDelayMs: 1 });
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a 400 — throws immediately", async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp(400, '{"error":{"message":"bad"}}'));
    vi.stubGlobal("fetch", fetchMock);
    await expect(aiFetch("http://x", {}, { baseDelayMs: 1 })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a network error then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(resp(200));
    vi.stubGlobal("fetch", fetchMock);
    const r = await aiFetch("http://x", {}, { baseDelayMs: 1 });
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after retries are exhausted", async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp(503));
    vi.stubGlobal("fetch", fetchMock);
    await expect(aiFetch("http://x", {}, { retries: 2, baseDelayMs: 1 })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("never retries a user abort", async () => {
    const fetchMock = vi.fn().mockRejectedValue(
      Object.assign(new Error("aborted"), { name: "AbortError" })
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(aiFetch("http://x", {}, { baseDelayMs: 1 })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
