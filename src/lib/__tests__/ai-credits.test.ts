import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { aiChat, getAiConfig, setAiConfig } from "../ai";
import { setCacheOrg } from "../api";
import { supabase } from "../supabase";
import {
  createCreditFetch,
  creditChoice,
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
beforeEach(() => {
  localStorage.clear();
  setCacheOrg(null);
  setCacheOrg("org-a", "user-a");
  vi.spyOn(supabase!.auth, "getSession").mockResolvedValue({
    data: { session: { user: { id: "user-a" } } },
    error: null,
  } as never);
  vi.spyOn(supabase!, "functions", "get").mockReturnValue({invoke:vi.fn().mockResolvedValue({
    data: { completion: reply, account }, error: null,
  })} as never);
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
  expect(await aiChat([{ role: "user", text: "hello" }])).toBe("done");
  expect(supabase!.functions.invoke).toHaveBeenCalledWith(
    "ai-credits",
    expect.objectContaining({
      body: expect.objectContaining({
        action: "completion",
        request: expect.objectContaining({ model: "fixture/model" }),
      }),
    })
  );
  expect(getAiConfig().model).toBe("local-model");
  setCreditChoice("byok");
  expect(getAiConfig().baseUrl).toBe("http://localhost:11434/v1");
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
