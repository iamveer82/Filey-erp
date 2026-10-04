import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createCreditFetch } from "../aiCredits";
import { setCacheOrg } from "../api";
import { setDataMode } from "../dataMode";
import { supabase } from "../supabase";

const reply = { choices: [{ message: { role: "assistant", content: "Recovered answer" } }] };
const complete = { state: "complete", completion: reply, account: { available_micros: 4_999_999 }, charged_micros: 1 };
const request = { body: '{"messages":[{"role":"user","content":"Create my invoice"}],"model":"filey-ai"}' };
let visible = true, online = true;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  setDataMode("cloud");
  setCacheOrg("fixture-org", "fixture-user");
  visible = true; online = true;
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visible ? "visible" : "hidden");
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  vi.spyOn(supabase!.auth, "getSession").mockResolvedValue({
    data: { session: { user: { id: "fixture-user" }, access_token: "fixture-user-token" } }, error: null,
  } as never);
  vi.spyOn(supabase!, "functions", "get").mockReturnValue({ invoke: vi.fn().mockResolvedValue({ data: complete, error: null }) } as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  setCacheOrg(null);
});
const invoke = () => vi.mocked(supabase!.functions.invoke);
const bodyAt = (index: number) => invoke().mock.calls[index][1]!.body as Record<string, unknown>;
const session = { data: { session: { user: { id: "fixture-user" }, access_token: "fixture-user-token" } }, error: null };
const authNetworkError = { name: "AuthRetryableFetchError", message: "private authentication gateway failed", status: 503 };

it("waits for a transient initial authentication failure before dispatching exactly one cloud inference", async () => {
  vi.mocked(supabase!.auth.getSession).mockResolvedValueOnce({ data: { session: null }, error: authNetworkError } as never);
  const response = createCreditFetch()("ignored", request);
  await vi.waitFor(() => expect(supabase!.auth.getSession).toHaveBeenCalledOnce());
  expect(invoke()).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(3000);
  expect(await (await response).json()).toEqual(reply);
  expect(invoke()).toHaveBeenCalledOnce();
  expect(bodyAt(0).action).toBe("completion");
});

it("rechecks the same receipt after transient authentication failures before dispatch and after acknowledgement", async () => {
  vi.mocked(supabase!.auth.getSession)
    .mockResolvedValueOnce(session as never)
    .mockResolvedValueOnce({ data: { session: null }, error: authNetworkError } as never);
  invoke().mockResolvedValueOnce({ data: { state: "missing" }, error: null });
  const response = createCreditFetch()("ignored", request);
  await vi.waitFor(() => expect(supabase!.auth.getSession).toHaveBeenCalledTimes(2));
  expect(invoke()).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(6000);
  expect(await (await response).json()).toEqual(reply);
  expect(invoke().mock.calls.map((_, index) => bodyAt(index).action)).toEqual(["completion_status", "completion"]);
  expect(bodyAt(0).request_id).toBe(bodyAt(1).request_id);

  invoke().mockClear();
  vi.mocked(supabase!.auth.getSession)
    .mockResolvedValueOnce(session as never)
    .mockResolvedValueOnce(session as never)
    .mockRejectedValueOnce(authNetworkError);
  const recovered = createCreditFetch()("ignored", request);
  await vi.waitFor(() => expect(invoke()).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(3000);
  expect(await (await recovered).json()).toEqual(reply);
  expect(invoke().mock.calls.map((_, index) => bodyAt(index).action)).toEqual(["completion", "completion_status"]);
  expect(bodyAt(0).request_id).toBe(bodyAt(1).request_id);
});

it.each([401, 403])("does not retry an authentication rejection with HTTP %s even if its message resembles a network error", async status => {
  vi.mocked(supabase!.auth.getSession).mockResolvedValueOnce({ data: { session: null }, error: { ...authNetworkError, status } } as never);
  await expect(createCreditFetch()("ignored", request)).rejects.toThrow("Sign in");
  expect(invoke()).not.toHaveBeenCalled();
  expect(supabase!.auth.getSession).toHaveBeenCalledOnce();
});

it.each([2, 3])("Stop releases pending authentication check %s immediately without using its late answer", async pendingCheck => {
  let finish!: (value: unknown) => void;
  const auth = vi.mocked(supabase!.auth.getSession);
  for (let check = 1; check < pendingCheck; check++) auth.mockResolvedValueOnce(session as never);
  auth.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }) as never);
  const controller = new AbortController();
  const response = createCreditFetch()("ignored", { ...request, signal: controller.signal });
  const stopped = expect(response).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(auth).toHaveBeenCalledTimes(pendingCheck));
  controller.abort();
  await stopped;
  finish(session);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(invoke()).toHaveBeenCalledTimes(pendingCheck === 3 ? 1 : 0);
  expect(vi.getTimerCount()).toBe(0);
});

it("dispatches a cloud-funded round once and retrieves its pending result by the same owner-scoped request ID", async () => {
  invoke().mockResolvedValueOnce({ data: { state: "pending" }, error: null });
  const response = createCreditFetch()("ignored", request);
  await vi.advanceTimersByTimeAsync(0);
  expect(invoke()).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(499);
  expect(invoke()).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(await (await response).json()).toEqual(reply);
  expect(bodyAt(0)).toMatchObject({ action: "completion", recoverable: true, org_id: "fixture-org" });
  expect(bodyAt(1)).toEqual({ action: "completion_status", request_id: bodyAt(0).request_id, org_id: "fixture-org" });
  expect(bodyAt(1)).not.toHaveProperty("request");
  expect(invoke()).toHaveBeenCalledTimes(2);
  for (const [, options] of invoke().mock.calls) expect(options?.headers).toEqual({ Authorization: "Bearer fixture-user-token" });
});

it("delivers five healthy tool rounds in 2.5 seconds of polling instead of adding fifteen seconds", async () => {
  invoke().mockImplementation(async (_name, options) => ({
    data: (options?.body as Record<string, unknown>).action === "completion" ? { state: "pending" } : complete,
    error: null,
  }));
  const send = createCreditFetch(), start = Date.now();
  for (let round = 0; round < 5; round++) {
    const response = send("ignored", request);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(await (await response).json()).toEqual(reply);
  }
  expect(Date.now() - start).toBe(2500);
  expect(invoke()).toHaveBeenCalledTimes(10);
  const dispatches = invoke().mock.calls.map((_, index) => bodyAt(index)).filter(body => body.action === "completion");
  expect(dispatches).toHaveLength(5);
  expect(new Set(dispatches.map(body => body.request_id)).size).toBe(5);
  expect(new Set(dispatches.map(body => body.run_id)).size).toBe(1);
});

it("backs healthy pending receipts off from 500ms to 1s to 1.5s and then stays at 3s", async () => {
  const controller = new AbortController();
  invoke().mockResolvedValue({ data: { state: "pending" }, error: null });
  const response = createCreditFetch()("ignored", { ...request, signal: controller.signal });
  const stopped = expect(response).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(0);
  expect(invoke()).toHaveBeenCalledOnce();
  for (const [index, delay] of [500, 1000, 1500, 3000, 3000].entries()) {
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(invoke()).toHaveBeenCalledTimes(index + 1);
    await vi.advanceTimersByTimeAsync(1);
    expect(invoke()).toHaveBeenCalledTimes(index + 2);
  }
  expect(new Set(invoke().mock.calls.map((_, index) => bodyAt(index).request_id)).size).toBe(1);
  expect(invoke().mock.calls.slice(1).every((_, index) => bodyAt(index + 1).action === "completion_status")).toBe(true);
  controller.abort();
  await stopped;
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps slow polling after a transient status failure even when the connection responds again", async () => {
  invoke()
    .mockResolvedValueOnce({ data: { state: "pending" }, error: null })
    .mockResolvedValueOnce({ data: null, error: { name: "FunctionsFetchError", message: "Connection lost" } } as never)
    .mockResolvedValueOnce({ data: { state: "pending" }, error: null });
  const response = createCreditFetch()("ignored", request);
  await vi.advanceTimersByTimeAsync(500);
  expect(invoke()).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(2999);
  expect(invoke()).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(invoke()).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(2999);
  expect(invoke()).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(1);
  expect(await (await response).json()).toEqual(reply);
  expect(invoke().mock.calls.map((_, index) => bodyAt(index).action)).toEqual(["completion", "completion_status", "completion_status", "completion_status"]);
});

it("recovers a lost dispatch acknowledgement using status and never submits inference again when its receipt exists", async () => {
  invoke().mockResolvedValueOnce({ data: null, error: { name: "FunctionsFetchError", message: "Failed to send a request to the Edge Function" } } as never);
  const response = createCreditFetch()("ignored", request);
  await vi.waitFor(() => expect(invoke()).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(3000);
  expect(await (await response).json()).toEqual(reply);
  expect(invoke().mock.calls.map((_, index) => bodyAt(index).action)).toEqual(["completion", "completion_status"]);
  expect(bodyAt(1).request_id).toBe(bodyAt(0).request_id);
});

it("only a missing status permits exact same-UUID payload resubmission, with no new paid round", async () => {
  invoke()
    .mockResolvedValueOnce({ data: null, error: { name: "FunctionsFetchError", message: "Connection lost" } } as never)
    .mockResolvedValueOnce({ data: { state: "missing" }, error: null })
    .mockResolvedValueOnce({ data: { state: "pending" }, error: null });
  const response = createCreditFetch()("ignored", request);
  await vi.waitFor(() => expect(invoke()).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(9000);
  expect(await (await response).json()).toEqual(reply);
  expect(invoke().mock.calls.map((_, index) => bodyAt(index).action)).toEqual(["completion", "completion_status", "completion", "completion_status"]);
  expect(bodyAt(2)).toEqual(bodyAt(0));
  expect(new Set(invoke().mock.calls.map((_, index) => bodyAt(index).request_id)).size).toBe(1);
});

it("waits through app suspension and an offline interval, then retrieves the result on foreground/online without wasting its retry budget", async () => {
  invoke().mockResolvedValueOnce({ data: { state: "pending" }, error: null });
  const response = createCreditFetch()("ignored", request);
  await vi.waitFor(() => expect(invoke()).toHaveBeenCalledOnce());
  visible = false;
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(20 * 60_000);
  expect(invoke()).toHaveBeenCalledOnce();
  online = false;
  window.dispatchEvent(new Event("offline"));
  visible = true;
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  expect(invoke()).toHaveBeenCalledOnce();
  online = true;
  window.dispatchEvent(new Event("online"));
  expect(await (await response).json()).toEqual(reply);
  expect(invoke()).toHaveBeenCalledTimes(2);
  expect(bodyAt(1).request_id).toBe(bodyAt(0).request_id);
});

it("explicit Stop immediately releases a suspended wait and prevents late response or further status calls", async () => {
  invoke().mockResolvedValueOnce({ data: { state: "pending" }, error: null });
  const controller = new AbortController();
  const response = createCreditFetch()("ignored", { ...request, signal: controller.signal });
  const stopped = expect(response).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(invoke()).toHaveBeenCalledOnce());
  visible = false;
  document.dispatchEvent(new Event("visibilitychange"));
  controller.abort();
  await stopped;
  visible = true;
  document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(invoke()).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("explicit Stop rejects an HTTP attempt promptly even when the transport returns an answer later", async () => {
  let finish!: (value: { data: typeof complete; error: null }) => void;
  invoke().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController();
  const response = createCreditFetch()("ignored", { ...request, signal: controller.signal });
  const stopped = expect(response).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(invoke()).toHaveBeenCalledOnce());
  controller.abort();
  await stopped;
  finish({ data: complete, error: null });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(invoke()).toHaveBeenCalledOnce();
});

it("explicit Stop releases initial authentication without allowing its late result to dispatch inference", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(supabase!.auth.getSession).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }) as never);
  const controller = new AbortController();
  const response = createCreditFetch()("ignored", { ...request, signal: controller.signal });
  const stopped = expect(response).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(supabase!.auth.getSession).toHaveBeenCalledOnce());
  controller.abort();
  await stopped;
  finish({ data: { session: { user: { id: "fixture-user" }, access_token: "fixture-user-token" } }, error: null });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(invoke()).not.toHaveBeenCalled();
});

it("never retrieves or resumes another account's completion after a workspace switch while suspended", async () => {
  invoke().mockResolvedValueOnce({ data: { state: "pending" }, error: null });
  const response = createCreditFetch()("ignored", request);
  const rejected = expect(response).rejects.toThrow("workspace changed");
  await vi.waitFor(() => expect(invoke()).toHaveBeenCalledOnce());
  visible = false;
  document.dispatchEvent(new Event("visibilitychange"));
  setCacheOrg("other-org", "other-user");
  await rejected;
  visible = true;
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(invoke()).toHaveBeenCalledOnce();
});

it("does not recover or resubmit authorization, insufficient-credit or terminal stored failures", async () => {
  invoke().mockResolvedValueOnce({ data: { state: "failed", message: "Insufficient credit. Add Coin to continue." }, error: null });
  await expect(createCreditFetch()("ignored", request)).rejects.toThrow("Insufficient credit");
  expect(invoke()).toHaveBeenCalledOnce();
  invoke().mockResolvedValueOnce({ data: null, error: { context: new Response('{"error":"Unauthorized"}', { status: 401 }) } } as never);
  await expect(createCreditFetch()("ignored", request)).rejects.toThrow("sign in");
  expect(invoke()).toHaveBeenCalledTimes(2);
});

it.each([
  ["This reply has expired. Start a new task.", "This reply has expired. Start a new task."],
  ["Filey AI could not finish this request. No Coins were charged.", "Filey AI could not finish this request. No Coins were charged."],
  ["Filey AI could not finish this request. No Coins were charged. private SQL details", "Filey AI could not complete this request. Check any earlier work before trying again."],
])("shows only an exact safe stored failure without replay: %s", async (message, expected) => {
  invoke().mockResolvedValueOnce({ data: { state: "failed", message }, error: null });
  await expect(createCreditFetch()("ignored", request)).rejects.toThrow(expected);
  expect(invoke()).toHaveBeenCalledOnce();
});

it("caps missing receipt retries at three identical submissions and never starts a new request UUID", async () => {
  invoke().mockImplementation(async (_name, options) => ({ data: { state: (options?.body as Record<string, unknown>).action === "completion" ? "pending" : "missing" }, error: null }));
  const response = createCreditFetch()("ignored", request);
  const rejected = expect(response).rejects.toThrow("request was not repeated");
  await vi.advanceTimersByTimeAsync(20_000);
  await rejected;
  expect(invoke().mock.calls.map((_, index) => bodyAt(index).action).filter(action => action === "completion")).toHaveLength(3);
  expect(new Set(invoke().mock.calls.map((_, index) => bodyAt(index).request_id)).size).toBe(1);
});

it("bounds foreground pending polling and never resubmits an existing request", async () => {
  invoke().mockResolvedValue({ data: { state: "pending" }, error: null });
  const response = createCreditFetch()("ignored", request);
  const rejected = expect(response).rejects.toThrow("still reconnecting");
  await vi.advanceTimersByTimeAsync(301_000);
  await rejected;
  expect(invoke().mock.calls.map((_, index) => bodyAt(index).action).filter(action => action === "completion")).toHaveLength(1);
  expect(invoke().mock.calls.length).toBeLessThanOrEqual(120);
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps local-mode Coin requests synchronous and never sends prompts to the cloud recovery cache", async () => {
  setDataMode("local");
  invoke().mockResolvedValueOnce({ data: { completion: reply }, error: null });
  expect(await (await createCreditFetch()("ignored", request)).json()).toEqual(reply);
  expect(bodyAt(0)).not.toHaveProperty("recoverable");
  expect(bodyAt(0)).not.toHaveProperty("org_id");
  expect(invoke()).toHaveBeenCalledOnce();
  invoke().mockResolvedValueOnce({ data: null, error: { name: "FunctionsFetchError", message: "Connection lost" } } as never);
  await expect(createCreditFetch()("ignored", request)).rejects.toThrow("Connection lost");
  expect(invoke()).toHaveBeenCalledTimes(2);
});
