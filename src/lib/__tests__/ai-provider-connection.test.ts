import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setCacheOrg } from "../api";
import { aiAgent, aiChat, aiFetch, listAiModels, setAiConfig } from "../ai";
import { AI_DEV_ORIGINS } from "../aiEndpoint";

beforeEach(() => { localStorage.clear(); setCacheOrg(null); setCacheOrg("provider-qa", "qa-user"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const reply = () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));

it("uses reasoning-compatible parameters in both chat and agent requests", async () => {
  const fetch = vi.fn(async () => reply());
  vi.stubGlobal("fetch", fetch);
  setAiConfig({ provider: "openai", baseUrl: "https://api.openai.com/v1", model: " gpt-5-mini ", apiKey: "fixture-key" });
  expect(await aiChat([{ role: "user", text: "Hello" }])).toBe("ok");
  expect(await aiAgent([{ role: "user", text: "Hello" }])).toBe("ok");
  for (const [, init] of fetch.mock.calls as unknown as [string, RequestInit][]) {
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("gpt-5-mini");
    expect(body.max_completion_tokens).toBe(2048);
    expect(body).not.toHaveProperty("max_tokens");
    expect(body).not.toHaveProperty("temperature");
  }
});

it("discovers Claude models using Anthropic headers at the selected endpoint", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "claude-model" }] })));
  vi.stubGlobal("fetch", fetch);
  expect(await listAiModels({ provider: "anthropic", baseUrl: "https://api.anthropic.com/v1", model: "", apiKey: "fixture-claude" })).toEqual(["claude-model"]);
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://api.anthropic.com/v1/models");
  expect(new Headers(init.headers).get("x-api-key")).toBe("fixture-claude");
  expect(new Headers(init.headers).has("authorization")).toBe(false);
});

it("routes only exact allowlisted origins through the localhost proxy in development", async () => {
  vi.stubEnv("DEV", true); vi.stubEnv("MODE", "development");
  const fetch = vi.fn(async () => reply());
  vi.stubGlobal("fetch", fetch);
  for (const origin of ["https://opencode.ai", "https://api.anthropic.com", "https://api.openai.com"])
    await aiFetch(`${origin}/v1/models`, { method: "GET" });
  for (const [index, origin] of ["https://opencode.ai", "https://api.anthropic.com", "https://api.openai.com"].entries())
    expect((fetch.mock.calls[index] as unknown as [string])[0]).toBe(`/__filey_ai/${AI_DEV_ORIGINS.indexOf(origin)}/v1/models`);
  await aiFetch("https://api.openai.com.example/v1/models", {});
  expect((fetch.mock.calls[3] as unknown as [string])[0]).toBe("https://api.openai.com.example/v1/models");
  vi.stubEnv("DEV", false);
  await aiFetch("https://opencode.ai/zen/v1/models", {});
  expect((fetch.mock.calls[4] as unknown as [string])[0]).toBe("https://opencode.ai/zen/v1/models");
});

it("does not retry an expired request", async () => {
  const fetch = vi.fn().mockRejectedValue(new DOMException("Timed out", "TimeoutError"));
  vi.stubGlobal("fetch", fetch);
  await expect(aiFetch("https://api.openai.com/v1/models", {})).rejects.toThrow("too long");
  expect(fetch).toHaveBeenCalledTimes(1);
});
