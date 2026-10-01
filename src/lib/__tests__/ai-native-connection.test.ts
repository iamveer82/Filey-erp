import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());
vi.mock("@capacitor/core", async importOriginal => ({
  ...await importOriginal<typeof import("@capacitor/core")>(),
  CapacitorHttp: { request },
}));
vi.mock("../nativePlatform", () => ({ isNativeApp: () => true }));
import { aiFetch } from "../ai";

const endpoint = "https://provider.example/v1/chat/completions";
const headers = { "Content-Type": "application/json", Authorization: "Bearer fixture-key", "x-api-key": "fixture-second-key" };
const response = (status: number, data: unknown, extraHeaders = {}) => ({
  status, data, headers: { "content-type": "application/json", ...extraHeaders }, url: endpoint,
});

describe("native AI transport", () => {
  beforeEach(() => {
    request.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("preserves JSON requests, status and headers without browser fetch or redirects", async () => {
    const body = JSON.stringify({ model: "fixture-model", messages: [{ role: "user", content: "hello" }] });
    request.mockResolvedValue(response(201, '{"ok":true}', { "retry-after": "4" }));
    const res = await aiFetch(endpoint, { method: "post", headers, body });
    expect(request).toHaveBeenCalledExactlyOnceWith({
      url: endpoint, method: "POST", data: body,
      headers: { "content-type": "application/json", authorization: "Bearer fixture-key", "x-api-key": "fixture-second-key" },
      responseType: "text", disableRedirects: true, connectTimeout: 180_000, readTimeout: 180_000,
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("retry-after")).toBe("4");
    expect(await res.json()).toEqual({ ok: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts Capacitor-parsed JSON for model listings and empty responses", async () => {
    request.mockResolvedValueOnce(response(200, { data: [{ id: "fixture-model" }] }))
      .mockResolvedValueOnce(response(204, ""));
    const models = await aiFetch("https://provider.example/v1/models", { headers });
    expect(await models.json()).toEqual({ data: [{ id: "fixture-model" }] });
    expect(request.mock.calls[0][0]).toMatchObject({ method: "GET", data: undefined });
    const empty = await aiFetch(endpoint, { headers });
    expect(empty.status).toBe(204);
    expect(await empty.text()).toBe("");
  });

  it.each([
    "http://provider.example/v1", "http://localhost:11434/v1",
    "https://user:fixture-key@provider.example/v1", "ftp://provider.example/v1", "invalid URL",
  ])("rejects an untrusted endpoint before transmitting credentials: %s", async url => {
    await expect(aiFetch(url, { headers })).rejects.toThrow("valid HTTPS endpoint without embedded credentials");
    expect(request).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("redacts provider HTTP errors without retrying or logging secrets", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    request.mockResolvedValue(response(401, { error: { message: "Rejected fixture-key and fixture-second-key" } }));
    const error = await aiFetch(endpoint, { headers }).catch(error => error);
    expect(error).toMatchObject({ status: 401 });
    expect(error.message).toContain("[REDACTED]");
    expect(error.message).not.toContain("fixture-key");
    expect(error.message).not.toContain("fixture-second-key");
    expect(request).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });

  it("retains retries and redacts native connection errors", async () => {
    request.mockResolvedValueOnce(response(503, { error: { message: "busy" } }))
      .mockResolvedValueOnce(response(200, { ok: true }));
    expect(await (await aiFetch(endpoint, { headers }, { baseDelayMs: 1 })).json()).toEqual({ ok: true });
    expect(request).toHaveBeenCalledTimes(2);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    request.mockRejectedValue(new Error("Connection failed with fixture-key and fixture-second-key"));
    const error = await aiFetch(endpoint, { headers }, { retries: 0 }).catch(error => error);
    expect(error.message).toContain("[REDACTED]");
    expect(error.message).not.toContain("fixture-key");
    expect(error.message).not.toContain("fixture-second-key");
    expect(log).not.toHaveBeenCalled();
  });

  it("rejects a cancelled request immediately without retrying", async () => {
    request.mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();
    const pending = aiFetch(endpoint, { headers, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("never sends an already cancelled request", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(aiFetch(endpoint, { headers, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(request).not.toHaveBeenCalled();
  });
});
