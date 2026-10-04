import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { aiAgent, aiChat, aiReady, getActiveAiConfig, getAiConfig, setAiConfig } from "../ai";
import { setCacheOrg } from "../api";
import { supabase } from "../supabase";
import { writeAgentStorage } from "../agentStorage";
import {
  createCreditFetch,
  buyAiCredits,
  creditHistory,
  creditChoice,
  creditCoin,
  getCreditStatus,
  verifyCreditCheckout,
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
it("displays USD micros as Coin without losing the smallest usage charge", () => {
  expect(creditCoin(1_000_000)).toBe("1 Coin");
  expect(creditCoin(12_510_000)).toBe("12.51 Coin");
  expect(creditCoin(1, true)).toBe("0.000001 Coin");
  expect(creditCoin(-100_000, true)).toBe("-0.1 Coin");
  expect(creditCoin(0)).toBe("0 Coin");
});
beforeEach(() => {
  localStorage.clear();
  setCacheOrg(null);
  setCacheOrg("org-a", "user-a");
  vi.spyOn(supabase!.auth, "getSession").mockResolvedValue({
    data: { session: { user: { id: "user-a" }, access_token: "fixture-user-a-token" } },
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

it("defaults to Filey AI and preserves explicit BYOK configuration when credits are selected", async () => {
  expect(creditChoice()).toEqual({ funding: "credits", model: "filey-ai" });
  setAiConfig({
    provider: "openai",
    baseUrl: "http://localhost:11434/v1",
    model: "local-model",
    apiKey: "",
  });
  expect(creditChoice()).toEqual({ funding: "byok", model: "" });
  expect(getActiveAiConfig().model).toBe("local-model");
  setCreditChoice("credits", "fixture/model");
  expect(getActiveAiConfig().model).toBe("filey-ai");
  expect(await aiChat([{ role: "user", text: "hello" }])).toBe("done");
  expect(await aiAgent([{ role: "user", text: "hello" }])).toBe("done");
  expect(supabase!.functions.invoke).toHaveBeenCalledTimes(2);
  expect(supabase!.functions.invoke).toHaveBeenCalledWith(
    "ai-credits",
    expect.objectContaining({
      body: expect.objectContaining({
        action: "completion",
        request: expect.objectContaining({ model: "filey-ai" }),
      }),
    })
  );
  for (const [, options] of vi.mocked(supabase!.functions.invoke).mock.calls)
    expect(options?.body).toMatchObject({ request: { model: "filey-ai" } });
  expect(getAiConfig().model).toBe("local-model");
  setCreditChoice("byok");
  expect(getAiConfig().baseUrl).toBe("http://localhost:11434/v1");
});

it("uses the public Filey AI alias without requiring a model selection", async () => {
  setCreditChoice("credits", "filey-ai");
  expect(aiReady()).toBe(true);
  expect(getActiveAiConfig().model).toBe("filey-ai");
  expect(await aiChat([{ role: "user", text: "hello" }])).toBe("done");
  expect(await aiAgent([{ role: "user", text: "hello" }])).toBe("done");
  expect(supabase!.functions.invoke).toHaveBeenCalledTimes(2);
});

it("normalizes previous paid models but keeps existing BYOK and damaged choices safe", () => {
  writeAgentStorage("filey.ai.funding", JSON.stringify({ funding: "credits", model: "provider/old-model" }));
  expect(creditChoice()).toEqual({ funding: "credits", model: "filey-ai" });
  writeAgentStorage("filey.ai.funding", JSON.stringify({ funding: "byok", model: "provider/old-model" }));
  expect(creditChoice()).toEqual({ funding: "byok", model: "" });
  writeAgentStorage("filey.ai.funding", "{damaged");
  expect(creditChoice()).toEqual({ funding: "byok", model: "" });
});

it("scopes the previous BYOK connection and does not overwrite an explicit Coin choice when settings change", () => {
  setAiConfig({ provider: "openai", baseUrl: "http://localhost:11434/v1", model: "local-model", apiKey: "" });
  expect(creditChoice().funding).toBe("byok");
  setCacheOrg("org-b", "user-a");
  expect(creditChoice()).toEqual({ funding: "credits", model: "filey-ai" });
  setCacheOrg("org-a", "user-a");
  expect(creditChoice().funding).toBe("byok");
  setCreditChoice("credits");
  setAiConfig({ model: "different-local-model" });
  expect(creditChoice()).toEqual({ funding: "credits", model: "filey-ai" });
  setCreditChoice("byok");
  expect(getActiveAiConfig().model).toBe("different-local-model");
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

it("never converts a retired free choice into a paid request without explicit selection", async () => {
  writeAgentStorage("filey.ai.funding", JSON.stringify({ funding: "free", model: "openrouter/free" }));
  expect(creditChoice()).toEqual({ funding: "free", model: "" });
  expect(aiReady()).toBe(false);
  await expect(aiChat([{ role: "user", text: "hello" }])).rejects.toThrow();
  expect(() => setCreditChoice("free", "openrouter/free")).toThrow("Choose Filey AI");
  expect(() => createCreditFetch("free")).toThrow("Choose Filey AI");
  expect(supabase!.functions.invoke).not.toHaveBeenCalled();
  setCreditChoice("credits");
  expect(await aiChat([{ role: "user", text: "hello" }])).toBe("done");
  expect(supabase!.functions.invoke).toHaveBeenCalledTimes(1);
});

it("BYOK failure never starts a wallet request; connection tests use BYOK even with credits selected", async () => {
  setCreditChoice("byok");
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
  expect(a).toMatchObject({ funding: "credits", request: { model: "filey-ai" } });
  expect(b).toMatchObject({ funding: "credits", request: { model: "filey-ai" } });
  expect(a.run_id).toBe(b.run_id);
  expect(a.request_id).not.toBe(b.request_id);
  setCacheOrg("org-b", "user-a");
  await expect(send("ignored", { body: "{}" })).rejects.toThrow("workspace changed");
  expect(creditChoice()).toEqual({ funding: "credits", model: "filey-ai" });
});

it("a cached balance cannot cross account boundaries", async () => {
  vi.mocked(supabase!.functions.invoke).mockResolvedValue({
    data: { account, models: [], history: [] },
    error: null,
  });
  await getCreditStatus(true);
  vi.mocked(supabase!.auth.getSession).mockResolvedValue({
    data: { session: { user: { id: "user-b" }, access_token: "fixture-user-b-token" } },
    error: null,
  } as never);
  setCacheOrg("org-b", "user-b");
  await getCreditStatus();
  expect(supabase!.functions.invoke).toHaveBeenCalledTimes(2);
});

it("rejects an SDK account switch before the reviewed cache catches up, without charging or opening checkout", async () => {
  vi.mocked(supabase!.auth.getSession).mockResolvedValue({
    data: { session: { user: { id: "user-b" }, access_token: "fixture-user-b-token" } },
    error: null,
  } as never);
  const network = vi.fn();
  vi.stubGlobal("fetch", network);
  await expect(getCreditStatus(true)).rejects.toThrow("account changed");
  await expect(creditHistory(10)).rejects.toThrow("account changed");
  await expect(buyAiCredits(500)).rejects.toThrow("account changed");
  await expect(createCreditFetch()("ignored", { body: "{}" })).rejects.toThrow("account changed");
  expect(supabase!.functions.invoke).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
});

it("does not return a cached wallet after the scope changes during authentication", async () => {
  vi.mocked(supabase!.functions.invoke).mockResolvedValue({ data: { account, models: [], history: [] }, error: null });
  await getCreditStatus(true);
  vi.mocked(supabase!.auth.getSession).mockImplementationOnce(async () => {
    setCacheOrg("org-b", "user-b");
    return { data: { session: { user: { id: "user-a" }, access_token: "fixture-user-a-token" } }, error: null } as never;
  });
  await expect(getCreditStatus()).rejects.toThrow("workspace changed");
  expect(supabase!.functions.invoke).toHaveBeenCalledOnce();
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

it("does not dispatch a paid request stopped while authentication is pending", async () => {
  const controller = new AbortController();
  vi.mocked(supabase!.auth.getSession).mockImplementationOnce(async () => {
    controller.abort();
    return { data: { session: { user: { id: "user-a" }, access_token: "fixture-user-a-token" } }, error: null } as never;
  });
  await expect(createCreditFetch()("ignored", { body: "{}", signal: controller.signal }))
    .rejects.toMatchObject({ name: "AbortError" });
  expect(supabase!.functions.invoke).not.toHaveBeenCalled();
});

it("does not dispatch when the workspace changes during the second authentication check", async () => {
  const session = { data: { session: { user: { id: "user-a" }, access_token: "fixture-user-a-token" } }, error: null };
  vi.mocked(supabase!.auth.getSession)
    .mockResolvedValueOnce(session as never)
    .mockImplementationOnce(async () => {
      setCacheOrg("org-b", "user-a");
      return session as never;
    });
  await expect(createCreditFetch()("ignored", { body: "{}" })).rejects.toThrow("workspace changed");
  expect(supabase!.functions.invoke).not.toHaveBeenCalled();
});

it("pins the paying account token and discards output after an account switch", async () => {
  vi.mocked(supabase!.functions.invoke).mockImplementation(async (_name, options) => {
    expect(options?.headers).toEqual({ Authorization: "Bearer fixture-user-a-token" });
    vi.mocked(supabase!.auth.getSession).mockResolvedValue({
      data: { session: { user: { id: "user-b" }, access_token: "fixture-user-b-token" } }, error: null,
    } as never);
    return { data: { completion: reply, account }, error: null };
  });
  await expect(createCreditFetch()("ignored", { body: "{}" })).rejects.toThrow("account changed");
  expect(supabase!.functions.invoke).toHaveBeenCalledOnce();
});

it("never lets the SDK select another paying account when the session token is missing", async () => {
  vi.mocked(supabase!.auth.getSession).mockResolvedValue({
    data: { session: { user: { id: "user-a" }, access_token: "" } }, error: null,
  } as never);
  await expect(createCreditFetch()("ignored", { body: "{}" })).rejects.toThrow("sign in");
  expect(supabase!.functions.invoke).not.toHaveBeenCalled();
});

it("verifies only a valid own checkout ID and requires a strict server confirmation", async () => {
  for (const id of ["", "paid", "1", "00000000-0000-4000-8000-000000000051&user=other", "00000000-0000-4000-8000-000000000051\n"])
    expect(await verifyCreditCheckout(id)).toBe(false);
  expect(supabase!.functions.invoke).not.toHaveBeenCalled();
  const id = "00000000-0000-4000-8000-000000000051";
  vi.mocked(supabase!.functions.invoke).mockResolvedValue({ data: { confirmed: "true" }, error: null });
  expect(await verifyCreditCheckout(id)).toBe(false);
  expect(supabase!.functions.invoke).toHaveBeenCalledExactlyOnceWith("ai-credits", {
    body: { action: "checkout_status", order_id: id },
    headers: { Authorization: "Bearer fixture-user-a-token" },
  });
  vi.mocked(supabase!.functions.invoke).mockResolvedValue({ data: { confirmed: true }, error: null });
  expect(await verifyCreditCheckout(id)).toBe(true);
});

it("does not cache an older wallet load after a newer balance has arrived", async () => {
  let finishOld!: (value: { data: unknown; error: null }) => void;
  const older = { account, models: [], history: [] };
  const newer = { ...older, account: { ...account, balance_micros: 4500000, available_micros: 4500000 } };
  vi.mocked(supabase!.functions.invoke)
    .mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
    .mockResolvedValue({ data: newer, error: null });
  const first = getCreditStatus(true);
  await vi.waitFor(() => expect(supabase!.functions.invoke).toHaveBeenCalledOnce());
  expect(await getCreditStatus(true)).toEqual(newer);
  finishOld({ data: older, error: null });
  await first;
  expect(await getCreditStatus()).toEqual(newer);
  expect(supabase!.functions.invoke).toHaveBeenCalledTimes(2);
});

it("cannot revive a pre-usage cached balance after a paid request completes", async () => {
  let finishOld!: (value: { data: unknown; error: null }) => void;
  const older = { account, models: [], history: [] };
  const newer = { ...older, account: { ...account, balance_micros: 4500000, available_micros: 4500000 } };
  vi.mocked(supabase!.functions.invoke)
    .mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
    .mockResolvedValueOnce({ data: { completion: reply, account: newer.account }, error: null })
    .mockResolvedValue({ data: newer, error: null });
  const first = getCreditStatus(true);
  await vi.waitFor(() => expect(supabase!.functions.invoke).toHaveBeenCalledOnce());
  await createCreditFetch()("ignored", { body: "{}" });
  finishOld({ data: older, error: null });
  await first;
  expect(await getCreditStatus()).toEqual(newer);
  expect(supabase!.functions.invoke).toHaveBeenCalledTimes(3);
});
