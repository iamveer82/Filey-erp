import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { aiAgent, setFileyAiReasoning } from "../ai";
import { setCacheOrg } from "../api";
import { setDataMode } from "../dataMode";
import { supabase } from "../supabase";
import { getHermesJobReceipt, resumeHermesAgentStream } from "../hermesAgent";
import { AI_CREDITS_EVENT, getCreditStatus } from "../aiCredits";

const message = [{ role: "user" as const, text: "Summarize my invoices" }];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let invoke: ReturnType<typeof vi.fn>, network: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  setDataMode("cloud"); setCacheOrg("hermes-qa", "hermes-user");
  vi.stubEnv("VITE_FILEY_HERMES_PILOT_URL", "https://pilot.fixture.test");
  vi.spyOn(supabase!.auth, "getSession").mockResolvedValue({
    data: { session: { user: { id: "hermes-user" }, access_token: "fixture-hermes-user-token" } }, error: null,
  } as never);
  invoke = vi.fn().mockResolvedValue({ data: { state: "complete", completion: { choices: [{ message: { role: "assistant", content: "Existing Filey answer" } }] } }, error: null });
  vi.spyOn(supabase!, "functions", "get").mockReturnValue({ invoke } as never);
  network = vi.fn(async (_url: string, init: RequestInit) => init.method === "POST" ?
    json({ id: JSON.parse(String(init.body)).request_id, status: "queued" }, 202) :
    json({ events: [], status: "completed", result: "Pilot answer" }));
  vi.stubGlobal("fetch", network);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); setCacheOrg(null); });

it("keeps the existing managed harness by default even when a trusted pilot endpoint exists", async () => {
  expect(await aiAgent(message, { isOwner: true })).toBe("Existing Filey answer");
  expect(invoke).toHaveBeenCalledOnce();
  expect(network).not.toHaveBeenCalled();
});

it("uses Hermes only for explicit owner opt-in, retaining the actual reasoning preference", async () => {
  setFileyAiReasoning(true);
  expect(await aiAgent([{ role: "system", text: "Local memory fixture never sent to Hermes" }, ...message], { runtime: "hermes", isOwner: true })).toBe("Pilot answer");
  expect(invoke).not.toHaveBeenCalled();
  expect(network).toHaveBeenCalledTimes(2);
  expect(JSON.parse(String(network.mock.calls[0][1].body))).toEqual({ request_id: expect.any(String), messages: message, reasoning: true });
  expect(network.mock.calls[0][1].headers).toMatchObject({ Authorization: "Bearer fixture-hermes-user-token", "X-Filey-Org": "hermes-qa" });
});

it("never falls back to the managed harness after a pilot job fails", async () => {
  network.mockResolvedValueOnce(json({ id: "wrong-receipt", status: "queued" }, 202));
  await expect(aiAgent(message, { runtime: "hermes", isOwner: true })).rejects.toThrow("invalid job receipt");
  expect(invoke).not.toHaveBeenCalled();
  expect(network).toHaveBeenCalledOnce();
});

it("keeps local records out of the pilot and does not silently choose a different funded agent", async () => {
  setDataMode("local");
  await expect(aiAgent(message, { runtime: "hermes", isOwner: true })).rejects.toThrow("owner's cloud");
  expect(invoke).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
});

it("does not activate an explicit pilot request when the deployment has no configured URL", async () => {
  vi.stubEnv("VITE_FILEY_HERMES_PILOT_URL", "");
  await expect(aiAgent(message, { runtime: "hermes", isOwner: true })).rejects.toThrow("not enabled");
  expect(invoke).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
});

it("recovers the actual account-scoped persisted receipt with GET only and isolates it after an account switch", async () => {
  await aiAgent(message, { runtime: "hermes", isOwner: true });
  const saved = getHermesJobReceipt();
  expect(saved).toMatchObject({ user_id: "hermes-user", org_id: "hermes-qa", status: "completed" });
  network.mockClear();
  const stream = resumeHermesAgentStream(saved!.id, { funding: "credits", isOwner: true });
  for (;;) { if ((await stream.next()).done) break; }
  expect(network).toHaveBeenCalledOnce();
  expect(network.mock.calls[0][1].method).toBe("GET");
  network.mockClear();
  setCacheOrg("hermes-qa", "another-user");
  expect(getHermesJobReceipt()).toBeNull();
  await expect(resumeHermesAgentStream(saved!.id, { funding: "credits", isOwner: true }).next()).rejects.toThrow("not saved for the current");
  expect(network).not.toHaveBeenCalled();
});

it("invalidates an already cached wallet and emits one balance-refresh event after pilot completion", async () => {
  invoke.mockResolvedValueOnce({ data: { account: { available_micros: 5000000 } }, error: null })
    .mockResolvedValueOnce({ data: { account: { available_micros: 4999000 } }, error: null });
  expect((await getCreditStatus()).account.available_micros).toBe(5000000);
  expect((await getCreditStatus()).account.available_micros).toBe(5000000);
  expect(invoke).toHaveBeenCalledOnce();
  const refreshed = vi.fn();
  window.addEventListener(AI_CREDITS_EVENT, refreshed);
  try {
    await aiAgent(message, { runtime: "hermes", isOwner: true });
    expect(refreshed).toHaveBeenCalledOnce();
    expect((await getCreditStatus()).account.available_micros).toBe(4999000);
    expect(invoke).toHaveBeenCalledTimes(2);
  } finally { window.removeEventListener(AI_CREDITS_EVENT, refreshed); }
});
