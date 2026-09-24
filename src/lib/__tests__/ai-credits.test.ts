import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { aiAgent, aiChat, aiReady, getActiveAiConfig, getAiConfig, setAiConfig } from "../ai";
import { setCacheOrg } from "../api";
import { supabase } from "../supabase";
import {
  createCreditFetch,
  creditChoice,
  creditPaper,
  getCreditStatus,
  setCreditChoice,
} from "../aiCredits";

const account = {
  balance_micros: 5000000,
  reserved_micros: 0,
  available_micros: 5000000,
  task_limit_micros: 1000000,
  daily_limit_micros: 5000000,
  blocked: false,
};
const reply = { choices: [{ message: { role: "assistant", content: "done" } }] };
it("displays USD micros as Paper without losing the smallest usage charge", () => {
  expect(creditPaper(1_000_000)).toBe("1 Paper");
  expect(creditPaper(12_510_000)).toBe("12.51 Paper");
  expect(creditPaper(1, true)).toBe("0.000001 Paper");
  expect(creditPaper(-100_000, true)).toBe("-0.1 Paper");
  expect(creditPaper(0)).toBe("0 Paper");
});
beforeEach(() => {
  localStorage.clear();
  setCacheOrg(null);
  setCacheOrg("org-a", "user-a");
  vi.spyOn(supabase!.auth, "getSession").mockResolvedValue({
    data: { session: { user: { id: "user-a" } } },
    error: null,
  } as never);
  vi.spyOn(supabase!, "functions", "get").mockReturnValue({
    invoke: vi.fn().mockResolvedValue({
      data: { completion: reply, account },
      error: null,
    }),
  } as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setCacheOrg(null);
});

it("keeps BYOK as default and preserves its configuration when credits are selected", async () => {
  setAiConfig({
    provider: "openai",
    baseUrl: "http://localhost:11434/v1",
    model: "local-model",
    apiKey: "",
  });
  expect(creditChoice().funding).toBe("byok");
  setCreditChoice("credits", "fixture/model");
  expect(getActiveAiConfig().model).toBe("fixture/model");
  expect(await aiChat([{ role: "user", text: "hello" }])).toBe("done");
  expect(await aiAgent([{ role: "user", text: "hello" }])).toBe("done");
  expect(supabase!.functions.invoke).toHaveBeenCalledTimes(2);
  expect(supabase!.functions.invoke).toHaveBeenCalledWith(
    "ai-credits",
    expect.objectContaining({
      body: expect.objectContaining({
        action: "completion",
        request: expect.objectContaining({ model: "fixture/model" }),
      }),
    })
  );
  for (const [, options] of vi.mocked(supabase!.functions.invoke).mock.calls)
    expect(options?.body).toMatchObject({ request: { model: "fixture/model" } });
  expect(getAiConfig().model).toBe("local-model");
  setCreditChoice("byok");
  expect(getAiConfig().baseUrl).toBe("http://localhost:11434/v1");
});

it("requires an explicit model for the retired automatic paid selection", async () => {
  setCreditChoice("credits", "filey-ai");
  expect(aiReady()).toBe(false);
  expect(getActiveAiConfig().model).toBe("");
  await expect(aiChat([{ role: "user", text: "hello" }])).rejects.toThrow("Choose a model");
  await expect(aiAgent([{ role: "user", text: "hello" }])).rejects.toThrow("Choose a model");
  expect(supabase!.functions.invoke).not.toHaveBeenCalled();
});

it("never retries or falls back after a paid request fails", async () => {
  setCreditChoice("credits", "fixture/model");
  vi.mocked(supabase!.functions.invoke).mockResolvedValue({
    data: null,
    error: { context: { json: async () => ({ error: "Balance too low" }) } },
  } as never);
  const network = vi.fn();
  vi.stubGlobal("fetch", network);
  await expect(aiChat([{ role: "user", text: "hello" }])).rejects.toThrow(
    "Balance too low"
  );
  expect(supabase!.functions.invoke).toHaveBeenCalledTimes(1);
  expect(network).not.toHaveBeenCalled();
});

it("free mode routes without a wallet balance and stays free across rounds", async () => {
  setCreditChoice("free", "openrouter/free");
  vi.mocked(supabase!.functions.invoke).mockResolvedValue({
    data: { completion: reply, charged_micros: 0 },
    error: null,
  });
  expect(await aiChat([{ role: "user", text: "hello" }])).toBe("done");
  const send = createCreditFetch("free");
  setCreditChoice("credits", "fixture/paid");
  await send("ignored", { body: '{"model":"openrouter/free"}' });
  const calls = vi.mocked(supabase!.functions.invoke).mock.calls;
  for (const call of calls) expect(call[1]?.body).toMatchObject({ funding: "free" });
  vi.mocked(supabase!.functions.invoke).mockResolvedValue({
    data: null,
    error: { context: { json: async () => ({ error: "Free allowance exhausted" }) } },
  } as never);
  await expect(send("ignored", { body: '{"model":"openrouter/free"}' })).rejects.toThrow(
    "Free allowance exhausted"
  );
  expect(supabase!.functions.invoke).toHaveBeenCalledTimes(3);
});

it("BYOK failure never starts a wallet request; connection tests use BYOK even with credits selected", async () => {
  setAiConfig({
    provider: "openai",
    baseUrl: "http://localhost:11434/v1",
    model: "local-model",
    apiKey: "",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response('{"error":{"message":"Rejected"}}', { status: 401 }))
  );
  await expect(aiChat([{ role: "user", text: "hello" }])).rejects.toThrow("Rejected");
  setCreditChoice("credits", "fixture/model");
  await expect(
    aiChat([{ role: "user", text: "test" }], { funding: "byok" })
  ).rejects.toThrow("Rejected");
  expect(supabase!.functions.invoke).not.toHaveBeenCalled();
});

it("shares a task ID across rounds, uses unique request IDs and stops across workspace changes", async () => {
  const send = createCreditFetch();
  await send("ignored", { body: '{"model":"fixture/model"}' });
  await send("ignored", { body: '{"model":"fixture/model"}' });
  const calls = vi.mocked(supabase!.functions.invoke).mock.calls;
  const a = calls[0][1]!.body as Record<string, unknown>,
    b = calls[1][1]!.body as Record<string, unknown>;
  expect(a.run_id).toBe(b.run_id);
  expect(a.request_id).not.toBe(b.request_id);
  setCacheOrg("org-b", "user-a");
  await expect(send("ignored", { body: "{}" })).rejects.toThrow("workspace changed");
  expect(creditChoice().funding).toBe("byok");
});

it("a cached balance cannot cross account boundaries", async () => {
  vi.mocked(supabase!.functions.invoke).mockResolvedValue({
    data: { account, models: [], history: [] },
    error: null,
  });
  await getCreditStatus(true);
  vi.mocked(supabase!.auth.getSession).mockResolvedValue({
    data: { session: { user: { id: "user-b" } } },
    error: null,
  } as never);
  await getCreditStatus();
  expect(supabase!.functions.invoke).toHaveBeenCalledTimes(2);
});

it("a stopped request cannot return output to execute tools, even when provider work finishes", async () => {
  const controller = new AbortController();
  const send = createCreditFetch();
  vi.mocked(supabase!.functions.invoke).mockImplementation(async () => {
    controller.abort();
    return { data: { completion: reply, account }, error: null };
  });
  await expect(
    send("ignored", { body: "{}", signal: controller.signal })
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(supabase!.functions.invoke).toHaveBeenCalledTimes(1);
});
