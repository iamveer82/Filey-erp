import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { aiAgent, aiChat, aiReady, getActiveAiConfig, getFileyAiReasoning, setFileyAiReasoning } from "../ai";
import { agentStorageScope } from "../agentStorage";
import { aiEffortLevels, openAiGenerationOptions } from "../aiEndpoint";
import { setCacheOrg } from "../api";
import { setDataMode } from "../dataMode";
import { supabase } from "../supabase";

const response = (message: Record<string, unknown>) => ({
  data: { completion: { choices: [{ message }] }, charged_micros: 1 },
  error: null,
});

beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
  setCacheOrg("managed-qa", "managed-user");
  vi.spyOn(supabase!.auth, "getSession").mockResolvedValue({
    data: { session: { user: { id: "managed-user" }, access_token: "fixture-managed-token" } }, error: null,
  } as never);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); setCacheOrg(null); });

it("routes a fresh account's Filey AI chat through its wallet without a browser provider key", async () => {
  const invoke = vi.fn().mockResolvedValue(response({ role: "assistant", content: "Hello." }));
  vi.spyOn(supabase!, "functions", "get").mockReturnValue({ invoke } as never);
  const network = vi.fn();
  vi.stubGlobal("fetch", network);
  expect(getActiveAiConfig()).toMatchObject({ model: "filey-ai", apiKey: "", billing: "credits" });
  expect(aiReady()).toBe(true);
  expect(await aiChat([{ role: "user", text: "Hello" }])).toBe("Hello.");
  expect(invoke).toHaveBeenCalledOnce();
  expect(invoke).toHaveBeenCalledWith("ai-credits", { headers: { Authorization: "Bearer fixture-managed-token" }, body: expect.objectContaining({
    funding: "credits", action: "completion", request: expect.objectContaining({ model: "filey-ai", reasoning_enabled: false, max_tokens: 2048 }),
  }) });
  expect(network).not.toHaveBeenCalled();
  expect(invoke.mock.calls[0][1].body.request).not.toHaveProperty("reasoning_effort");
});

it("keeps tool continuation reasoning and a shared task budget on the paid agent route", async () => {
  const invoke = vi.fn()
    .mockResolvedValueOnce(response({ role: "assistant", content: "", reasoning_content: "Continuation fixture.",
      tool_calls: [{ id: "memory-read", type: "function", function: { name: "recall", arguments: "{}" } }],
    }))
    .mockResolvedValueOnce(response({ role: "assistant", content: "Memory reviewed." }));
  vi.spyOn(supabase!, "functions", "get").mockReturnValue({ invoke } as never);
  const network = vi.fn();
  vi.stubGlobal("fetch", network);
  expect(await aiAgent([{ role: "user", text: "Review memory." }], { isOwner: true, reasoningEnabled: true })).toBe("Memory reviewed.");
  expect(invoke).toHaveBeenCalledTimes(2);
  const first = invoke.mock.calls[0][1].body;
  const second = invoke.mock.calls[1][1].body;
  expect(second.run_id).toBe(first.run_id);
  expect(second.request_id).not.toBe(first.request_id);
  expect(second.request.messages).toContainEqual(expect.objectContaining({ role: "assistant", reasoning_content: "Continuation fixture." }));
  expect(second.request.messages).toContainEqual(expect.objectContaining({ role: "tool", tool_call_id: "memory-read" }));
  expect(second.request.model).toBe("filey-ai");
  expect(first.request.reasoning_enabled).toBe(true);
  expect(second.request.reasoning_enabled).toBe(true);
  expect(network).not.toHaveBeenCalled();
});

it("caps managed reasoning output and does not enable arbitrary or retired paid models", () => {
  expect(aiEffortLevels({ provider: "openai", model: "filey-ai" })).toEqual(["auto", "low", "high", "max"]);
  expect(openAiGenerationOptions("filey-ai", 100_000, 0.2, "max", true)).toEqual({ max_tokens: 8192, reasoning_enabled: true, reasoning_effort: "max" });
  expect(openAiGenerationOptions("filey-ai", 2048, 0.2)).toEqual({ max_tokens: 2048, reasoning_enabled: false });
  expect(openAiGenerationOptions("filey-ai", 2048, 0.2, "max", false)).toEqual({ max_tokens: 2048, reasoning_enabled: false });
  expect(aiReady({ provider: "openai", model: "arbitrary-paid-model", apiKey: "", baseUrl: "https://filey-credits.invalid/v1", billing: "credits" })).toBe(false);
  expect(aiReady({ provider: "openai", model: "filey-ai", apiKey: "", baseUrl: "https://filey-credits.invalid/v1", billing: "free" })).toBe(false);
});

it("scopes the optional reasoning preference and honors explicit per-turn overrides", async () => {
  const invoke = vi.fn().mockResolvedValue(response({ role: "assistant", content: "Done." }));
  vi.spyOn(supabase!, "functions", "get").mockReturnValue({ invoke } as never);
  const scope = agentStorageScope()!;
  expect(getFileyAiReasoning()).toBe(false);
  setFileyAiReasoning(true, scope);
  expect(getActiveAiConfig().reasoningEnabled).toBe(true);
  await aiChat([{ role: "user", text: "Check." }]);
  expect(invoke.mock.calls[0][1].body.request).toMatchObject({ reasoning_enabled: true, reasoning_effort: "low" });
  await aiChat([{ role: "user", text: "Quick." }], { reasoningEnabled: false });
  expect(invoke.mock.calls[1][1].body.request).toMatchObject({ reasoning_enabled: false });
  expect(invoke.mock.calls[1][1].body.request).not.toHaveProperty("reasoning_effort");
  setCacheOrg("other-workspace", "managed-user");
  expect(getFileyAiReasoning()).toBe(false);
  expect(() => setFileyAiReasoning(true, scope)).toThrow(/account changed/i);
  setCacheOrg("managed-qa", "managed-user");
  expect(getFileyAiReasoning()).toBe(true);
  setDataMode("cloud");
  expect(getFileyAiReasoning()).toBe(false);
});

it("completes a quick tool run without any reasoning trace", async () => {
  const invoke = vi.fn()
    .mockResolvedValueOnce(response({ role: "assistant", content: "", tool_calls: [{ id: "quick-memory", type: "function", function: { name: "recall", arguments: "{}" } }] }))
    .mockResolvedValueOnce(response({ role: "assistant", content: "Done." }));
  vi.spyOn(supabase!, "functions", "get").mockReturnValue({ invoke } as never);
  expect(await aiAgent([{ role: "user", text: "Reuse the last details." }], { isOwner: true })).toBe("Done.");
  for (const call of invoke.mock.calls) {
    expect(call[1].body.request.reasoning_enabled).toBe(false);
    expect(call[1].body.request).not.toHaveProperty("reasoning_effort");
  }
  expect(invoke.mock.calls[1][1].body.request.messages).toContainEqual(expect.objectContaining({ role: "assistant", tool_calls: expect.any(Array) }));
});

it("keeps the reasoning choice fixed for all rounds of an active run", async () => {
  const invoke = vi.fn()
    .mockImplementationOnce(async () => {
      setFileyAiReasoning(true);
      return response({ role: "assistant", content: "", tool_calls: [{ id: "pinned-memory", type: "function", function: { name: "recall", arguments: "{}" } }] });
    })
    .mockResolvedValueOnce(response({ role: "assistant", content: "Done." }));
  vi.spyOn(supabase!, "functions", "get").mockReturnValue({ invoke } as never);
  await aiAgent([{ role: "user", text: "Quick task." }], { isOwner: true });
  expect(invoke).toHaveBeenCalledTimes(2);
  for (const call of invoke.mock.calls) expect(call[1].body.request.reasoning_enabled).toBe(false);
  expect(getFileyAiReasoning()).toBe(true);
});

it("can enable reasoning on a follow-up without inventing traces for previous replies", async () => {
  const invoke = vi.fn().mockResolvedValue(response({ role: "assistant", content: "Reviewed." }));
  vi.spyOn(supabase!, "functions", "get").mockReturnValue({ invoke } as never);
  await aiAgent([
    { role: "user", text: "Make a quick draft." },
    { role: "assistant", text: "Draft prepared." },
    { role: "user", text: "Now check it carefully." },
  ], { reasoningEnabled: true });
  const request = invoke.mock.calls[0][1].body.request;
  expect(request.reasoning_enabled).toBe(true);
  expect(request.messages).not.toContainEqual(expect.objectContaining({ role: "assistant" }));
  expect(request.messages).toContainEqual(expect.objectContaining({ role: "user", content: expect.stringContaining('"Draft prepared."') }));
  expect(request.messages).toContainEqual({ role: "user", content: "Now check it carefully." });
});
