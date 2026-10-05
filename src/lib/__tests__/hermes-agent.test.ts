import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../agentHarness";
import { getHermesJobReceipt, getHermesPilotConfig, hermesAgentStream, resumeHermesAgentStream } from "../hermesAgent";
import { writeAgentStorage } from "../agentStorage";

const fixture = vi.hoisted(() => ({ scope: "cloud:fixture-org:user:fixture-user" as string | null, org: "fixture-org" as string | null,
  identity: 1, session: vi.fn(), fetch: vi.fn(), invalidateWallet: vi.fn(), storage: new Map<string, string>() }));
vi.mock("../agentStorage", () => ({ AGENT_STORAGE_EVENT: "filey:agent-storage", agentStorageScope: () => fixture.scope,
  readAgentStorage: (key: string) => fixture.storage.get(`${fixture.scope}:${key}`) ?? null,
  writeAgentStorage: vi.fn((key: string, value: string, expected?: string) => {
    if (!fixture.scope || (expected && expected !== fixture.scope)) throw new Error("Scope changed");
    fixture.storage.set(`${fixture.scope}:${key}`, value);
  }),
}));
vi.mock("../api", () => ({ getCacheIdentity: () => fixture.identity, getCacheOrg: () => fixture.org }));
vi.mock("../aiCredits", () => ({ aiAccountSession: fixture.session, invalidateCreditStatus: fixture.invalidateWallet }));

const messages = [{ role: "user" as const, text: "Summarize my latest invoices" }];
const options = { funding: "credits" as const, isOwner: true };
let visible = true, online = true;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const id = () => (JSON.parse(fixture.fetch.mock.calls.find(([, init]) => init.method === "POST" && init.body)![1].body) as { request_id: string }).request_id;
const countCreates = () => fixture.fetch.mock.calls.filter(([url, init]) => url.endsWith("/v1/jobs") && init.method === "POST").length;
const collect = async (stream = hermesAgentStream(messages, options)) => {
  const events: AgentEvent[] = [];
  for (;;) {
    const next = await stream.next();
    if (next.done) return { events, result: next.value };
    events.push(next.value);
  }
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("VITE_FILEY_HERMES_PILOT_URL", "https://pilot.fixture.test");
  vi.stubEnv("DEV", true);
  fixture.scope = "cloud:fixture-org:user:fixture-user"; fixture.org = "fixture-org"; fixture.identity = 1;
  fixture.storage.clear(); vi.mocked(writeAgentStorage).mockClear();
  fixture.invalidateWallet.mockReset();
  fixture.session.mockReset().mockResolvedValue({ access_token: "fixture-user-jwt", user: { id: "fixture-user" } });
  fixture.fetch.mockReset().mockImplementation(async (url, init) => {
    if (url.endsWith("/cancel")) return json({ id: id(), status: "cancelled" });
    if (init.method === "POST") return json({ id: JSON.parse(init.body).request_id, status: "queued" }, 202);
    return json({ events: [], status: "completed", result: "Verified summary" });
  });
  vi.stubGlobal("fetch", fixture.fetch);
  visible = true; online = true;
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visible ? "visible" : "hidden");
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("trusted pilot configuration", () => {
  it("stays disabled unless a deployment supplies a trusted URL", () => {
    vi.stubEnv("VITE_FILEY_HERMES_PILOT_URL", "");
    expect(getHermesPilotConfig()).toBeNull();
  });
  it.each(["http://pilot.fixture.test", "http://localhost:16472", "http://127.0.0.1:9999", "https://user:secret@pilot.fixture.test", "https://pilot.fixture.test/v1", "https://pilot.fixture.test/?key=private", "https://pilot.fixture.test/#key", "not a URL"])("rejects unsafe build endpoint %s", url => {
    vi.stubEnv("VITE_FILEY_HERMES_PILOT_URL", url);
    expect(getHermesPilotConfig()).toBeNull();
  });
  it("allows only the fixed development loopback port, never a production HTTP transport", () => {
    vi.stubEnv("VITE_FILEY_HERMES_PILOT_URL", "http://127.0.0.1:16472/");
    expect(getHermesPilotConfig()).toEqual({ url: "http://127.0.0.1:16472", readOnly: true });
    vi.stubEnv("DEV", false);
    expect(getHermesPilotConfig()).toBeNull();
  });
});

it("submits one read-only cloud job with a user JWT and pinned tenant, omitting cookies and browser system instructions", async () => {
  const result = await collect(hermesAgentStream([
    { role: "system", text: "Private local memory and instructions that must not be uploaded" },
    ...messages,
  ], { ...options, reasoningEnabled: true }));
  expect(result.result).toBe("Verified summary");
  expect(result.events[0]).toMatchObject({ type: "text", text: expect.stringContaining("Filey AI preview is read-only") });
  expect(result.events[result.events.length - 1]).toEqual({ type: "done", text: "Verified summary", reason: "answered" });
  const [, init] = fixture.fetch.mock.calls[0];
  const body = JSON.parse(init.body);
  expect(body).toEqual({ request_id: expect.stringMatching(/^[0-9a-f-]{36}$/), messages, reasoning: true });
  expect(init.headers).toEqual({ Authorization: "Bearer fixture-user-jwt", "X-Filey-Org": "fixture-org", "Content-Type": "application/json" });
  for (const [, request] of fixture.fetch.mock.calls) expect(request).toMatchObject({ credentials: "omit", redirect: "error", cache: "no-store" });
  expect(countCreates()).toBe(1);
});

it.each([
  { funding: "byok" as const, isOwner: true }, { funding: "free" as const, isOwner: true },
  { funding: "credits" as const, isOwner: false }, { funding: "credits" as const },
  { ...options, agentId: "whatsapp:fixture-owner" },
])("does not upload data for an unsupported funding or owner context %#", async opts => {
  await expect(collect(hermesAgentStream(messages, opts))).rejects.toThrow("owner's cloud");
  expect(fixture.fetch).not.toHaveBeenCalled();
  expect(fixture.session).not.toHaveBeenCalled();
});

it.each(["local:fixture-org:user:fixture-user", null])("does not upload device data or anonymous data (%s)", async scope => {
  fixture.scope = scope;
  await expect(collect()).rejects.toThrow("owner's cloud");
  expect(fixture.fetch).not.toHaveBeenCalled();
});

it("rejects images before submitting anything and defaults reasoning off", async () => {
  await expect(collect(hermesAgentStream([{ ...messages[0], images: [{ mediaType: "image/png", dataBase64: "fixture" }] }], options))).rejects.toThrow("image attachments");
  expect(fixture.fetch).not.toHaveBeenCalled();
  await collect();
  expect(JSON.parse(fixture.fetch.mock.calls[0][1].body).reasoning).toBe(false);
});

it.each([
  Array.from({ length: 31 }, () => messages[0]),
  [{ role: "user" as const, text: "x".repeat(16001) }],
  [{ role: "assistant" as const, text: "No current user instruction" }],
  [{ role: "user" as const, text: " " }],
  Array.from({ length: 8 }, () => ({ role: "user" as const, text: "😀".repeat(2000) })),
].map(conversation => ({ conversation })))("rejects a conversation exceeding the service's actual limits before upload %#", async ({ conversation }) => {
  await expect(collect(hermesAgentStream(conversation, options))).rejects.toThrow();
  expect(fixture.fetch).not.toHaveBeenCalled();
  expect(fixture.session).not.toHaveBeenCalled();
});

it("recovers a lost POST acknowledgement by the same job ID, without replaying inference", async () => {
  fixture.fetch.mockRejectedValueOnce(new TypeError("private network diagnostic and credential"));
  const result = collect();
  await vi.advanceTimersByTimeAsync(0);
  const jobId = id();
  expect(fixture.fetch).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(3000);
  expect((await result).result).toBe("Verified summary");
  expect(fixture.fetch.mock.calls[1][0]).toBe(`https://pilot.fixture.test/v1/jobs/${jobId}/events?after=0`);
  expect(countCreates()).toBe(1);
});

it("never resubmits a lost acknowledgement when the same job is missing", async () => {
  fixture.fetch.mockRejectedValueOnce(new TypeError("Connection lost")).mockResolvedValueOnce(json({ error: "Private details" }, 404));
  const result = collect();
  const rejected = expect(result).rejects.toThrow("could not be found. The request was not repeated");
  await vi.advanceTimersByTimeAsync(3000);
  await rejected;
  expect(countCreates()).toBe(1);
});

it("deduplicates overlapping event batches and advances the cursor without executing service tool events", async () => {
  const first = { sequence: 1, event: { type: "tool_call", id: "read-1", name: "list_invoices", args: {} } };
  const second = { sequence: 2, event: { type: "tool_result", id: "read-1", name: "list_invoices", result: { count: 3 } } };
  // The create receipt must match its request UUID, which is only known at dispatch.
  fixture.fetch.mockReset().mockImplementation(async (url, init) => {
    if (init.method === "POST") return json({ id: JSON.parse(init.body).request_id, status: "running" }, 202);
    return url.endsWith("after=0") ? json({ events: [first], status: "running" }) :
      json({ events: [first, second, { sequence: 3, event: { type: "done", text: "Three invoices", reason: "answered" } }], status: "completed", result: "Three invoices" });
  });
  const result = collect();
  await vi.advanceTimersByTimeAsync(500);
  const completed = await result;
  expect(completed.events.filter(event => event.type === "tool_call")).toHaveLength(1);
  expect(completed.events.filter(event => event.type === "tool_result")).toHaveLength(1);
  expect(completed.events.filter(event => event.type === "done")).toHaveLength(1);
  expect(fixture.fetch.mock.calls[2][0]).toContain("events?after=1");
  expect(countCreates()).toBe(1);
});

it("drains completed paginated history before delivering its verified final result", async () => {
  const base = fixture.fetch.getMockImplementation()!;
  fixture.fetch.mockImplementation(async (url, init) => init.method === "POST" ? base(url, init) :
    url.endsWith("after=0") ? json({ events: [{ sequence: 1, event: { type: "text", text: "First retained event" } }], last_sequence: 3, status: "completed", result: "Final answer" }) :
    json({ events: [{ sequence: 2, event: { type: "text", text: "Later retained event" } }, { sequence: 3, event: { type: "done", text: "Final answer", reason: "answered" } }], last_sequence: 3, status: "completed", result: "Final answer" }));
  const result = await collect();
  expect(result.events.slice(1)).toEqual([
    { type: "text", text: "First retained event" },
    { type: "text", text: "Later retained event" },
    { type: "done", text: "Final answer", reason: "answered" },
  ]);
  expect(fixture.fetch.mock.calls[2][0]).toContain("events?after=1");
  expect(countCreates()).toBe(1);
});

it("does not claim success when a completed receipt declares unreturned events", async () => {
  const base = fixture.fetch.getMockImplementation()!;
  fixture.fetch.mockImplementation(async (url, init) => init.method === "POST" ? base(url, init) :
    json({ events: [], last_sequence: 1, status: "completed", result: "Unverified answer" }));
  await expect(collect()).rejects.toThrow("history is incomplete");
  expect(countCreates()).toBe(1);
});

it("uses GET-only backoff after transient polling failures", async () => {
  const base = fixture.fetch.getMockImplementation()!;
  let reads = 0;
  fixture.fetch.mockImplementation(async (url, init) => init.method === "POST" ? base(url, init) :
    ++reads === 1 ? json({ diagnostic: "private upstream failure" }, 503) : json({ events: [], status: "completed", result: "Recovered" }));
  const result = collect();
  await vi.advanceTimersByTimeAsync(2999);
  expect(reads).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  expect((await result).result).toBe("Recovered");
  expect(countCreates()).toBe(1);
});

it.each(["visibility", "offline"])("pauses polling during %s and resumes the original job on return", async reason => {
  const base = fixture.fetch.getMockImplementation()!;
  let reads = 0;
  fixture.fetch.mockImplementation(async (url, init) => init.method === "POST" ? base(url, init) :
    ++reads === 1 ? json({ events: [], status: "running" }) : json({ events: [], status: "completed", result: "Returned" }));
  const result = collect();
  await vi.advanceTimersByTimeAsync(0);
  if (reason === "visibility") { visible = false; document.dispatchEvent(new Event("visibilitychange")); }
  else { online = false; window.dispatchEvent(new Event("offline")); }
  await vi.advanceTimersByTimeAsync(3600000);
  expect(reads).toBe(1);
  if (reason === "visibility") { visible = true; document.dispatchEvent(new Event("visibilitychange")); }
  else { online = true; window.dispatchEvent(new Event("online")); }
  await vi.advanceTimersByTimeAsync(0);
  expect((await result).result).toBe("Returned");
  expect(countCreates()).toBe(1);
});

it("Stop cancels exactly the original job and ignores a late polling response", async () => {
  let finish!: (response: Response) => void;
  const base = fixture.fetch.getMockImplementation()!;
  fixture.fetch.mockImplementation((url, init) => url.includes("/events?") ? new Promise(resolve => { finish = resolve; }) : base(url, init));
  const controller = new AbortController();
  const result = collect(hermesAgentStream(messages, { ...options, signal: controller.signal }));
  const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(0);
  const jobId = id();
  controller.abort();
  await rejected;
  finish(json({ events: [{ sequence: 1, event: { type: "text", text: "Late private reply" } }], status: "completed", result: "Late private reply" }));
  await vi.advanceTimersByTimeAsync(0);
  expect(fixture.fetch.mock.calls.filter(([url]) => url.endsWith("/cancel"))).toEqual([[`https://pilot.fixture.test/v1/jobs/${jobId}/cancel`, expect.objectContaining({
    headers: { Authorization: "Bearer fixture-user-jwt", "X-Filey-Org": "fixture-org" },
  })]]);
  expect(countCreates()).toBe(1);
});

it("rejects account transitions even when the workspace string returns to the original value", async () => {
  let finish!: (response: Response) => void;
  const base = fixture.fetch.getMockImplementation()!;
  fixture.fetch.mockImplementation((url, init) => url.includes("/events?") ? new Promise(resolve => { finish = resolve; }) : base(url, init));
  const result = collect();
  const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(0);
  fixture.identity++;
  window.dispatchEvent(new Event("filey:agent-storage"));
  await rejected;
  finish(json({ events: [], status: "completed", result: "Must not enter next account" }));
  expect(fixture.fetch.mock.calls.filter(([url]) => url.endsWith("/cancel"))).toHaveLength(1);
  expect(countCreates()).toBe(1);
});

it("Stop releases pending authentication before any job can be submitted", async () => {
  let finish!: (value: unknown) => void;
  fixture.session.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController();
  const result = collect(hermesAgentStream(messages, { ...options, signal: controller.signal }));
  const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  await rejected;
  finish({ access_token: "next-account-jwt", user: { id: "another-user" } });
  await vi.advanceTimersByTimeAsync(0);
  expect(fixture.fetch).not.toHaveBeenCalled();
});

it("bounds stalled startup authentication without submitting an uncertain job", async () => {
  fixture.session.mockImplementationOnce(() => new Promise(() => undefined));
  const result = collect();
  const rejected = expect(result).rejects.toThrow("No task was submitted");
  await vi.advanceTimersByTimeAsync(15000);
  await rejected;
  expect(fixture.fetch).not.toHaveBeenCalled();
  expect(getHermesJobReceipt()).toBeNull();
});

it("recovers a stalled authentication refresh with GET only after the job is accepted", async () => {
  fixture.session.mockResolvedValueOnce({ access_token: "fixture-user-jwt", user: { id: "fixture-user" } })
    .mockImplementationOnce(() => new Promise(() => undefined));
  const result = collect();
  await vi.advanceTimersByTimeAsync(15000);
  expect(fixture.fetch).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(3000);
  expect((await result).result).toBe("Verified summary");
  expect(countCreates()).toBe(1);
  expect(fixture.fetch.mock.calls[1][1].method).toBe("GET");
});

it.each([401, 403, 402])("does not replay rejected submissions with HTTP %s or expose their diagnostics", async status => {
  fixture.fetch.mockResolvedValueOnce(json({ error: "provider-key-secret upstream stacktrace" }, status));
  await expect(collect()).rejects.toThrow(status === 402 ? "Insufficient credit. Add Coin to continue." : status === 401 ? "Sign in again" : "workspace cannot");
  expect(countCreates()).toBe(1);
  expect(fixture.fetch).toHaveBeenCalledOnce();
});

it("fails safely on missing event sequences and never substitutes another job", async () => {
  const base = fixture.fetch.getMockImplementation()!;
  fixture.fetch.mockImplementation(async (url, init) => init.method === "POST" ? base(url, init) :
    json({ events: [{ sequence: 2, event: { type: "text", text: "Unverified result" } }], status: "completed", result: "Unverified result" }));
  await expect(collect()).rejects.toThrow("history is incomplete");
  expect(countCreates()).toBe(1);
});

it("rejects an event beyond the receipt's declared final sequence", async () => {
  const base = fixture.fetch.getMockImplementation()!;
  fixture.fetch.mockImplementation(async (url, init) => init.method === "POST" ? base(url, init) :
    json({ events: [{ sequence: 1, event: { type: "done", text: "Unconfirmed", reason: "answered" } }], last_sequence: 0, status: "completed", result: "Unconfirmed" }));
  await expect(collect()).rejects.toThrow("history is inconsistent");
  expect(countCreates()).toBe(1);
});

it("gets a stored final result when the event envelope omits it and verifies its terminal receipt", async () => {
  const base = fixture.fetch.getMockImplementation()!;
  fixture.fetch.mockImplementation(async (url, init) => init.method === "POST" ? base(url, init) : url.includes("/events?") ?
    json({ events: [{ sequence: 1, event: { type: "done", text: "Stored result", reason: "finished" } }], status: "completed" }) :
    json({ id: id(), status: "completed", result: "Stored result" }));
  const result = await collect();
  expect(result.events[result.events.length - 1]).toEqual({ type: "done", text: "Stored result", reason: "finished" });
  expect(fixture.fetch).toHaveBeenCalledTimes(3);
});

it("does not report success when the final event disagrees with the stored result", async () => {
  const base = fixture.fetch.getMockImplementation()!;
  fixture.fetch.mockImplementation(async (url, init) => init.method === "POST" ? base(url, init) :
    json({ events: [{ sequence: 1, event: { type: "done", text: "Incorrect claim", reason: "answered" } }], status: "completed", result: "Actual result" }));
  await expect(collect()).rejects.toThrow("did not confirm");
  expect(countCreates()).toBe(1);
});

it.each(["failed", "cancelled", "interrupted"])("maps terminal %s without leaking server errors or restarting work", async status => {
  const base = fixture.fetch.getMockImplementation()!;
  fixture.fetch.mockImplementation(async (url, init) => init.method === "POST" ? base(url, init) :
    json({ events: [], status, result: "Private internal server diagnostic" }));
  const result = await collect();
  expect(result.result).not.toContain("Private internal");
  expect(result.events[result.events.length - 1]).toMatchObject({ type: "done", reason: status === "cancelled" ? "stopped" : "error" });
  expect(countCreates()).toBe(1);
});

it.each(["Insufficient credit. Add Coin to continue.", "Insufficient credit. Add Coin to continue. private upstream diagnostic"])("exposes only exact allowlisted wallet guidance (%s)", async message => {
  const base = fixture.fetch.getMockImplementation()!;
  fixture.fetch.mockImplementation(async (url, init) => init.method === "POST" ? base(url, init) :
    json({ events: [], status: "failed", result: message }));
  const result = await collect();
  expect(result.result).toBe(message.endsWith("diagnostic") ? "Filey AI preview could not finish this task. It was not repeated." : message);
  expect(result.events[result.events.length - 1]).toMatchObject({ type: "done", reason: "error" });
});

it("removes scope and connectivity listeners after completion", async () => {
  const add = vi.spyOn(window, "addEventListener"), remove = vi.spyOn(window, "removeEventListener");
  const documentAdd = vi.spyOn(document, "addEventListener"), documentRemove = vi.spyOn(document, "removeEventListener");
  await collect();
  for (const [event, callback] of add.mock.calls)
    if (["filey:agent-storage", "storage", "filey:workspace-changed", "filey:workspace-transition", "online", "offline", "focus"].includes(event))
      expect(remove).toHaveBeenCalledWith(event, callback);
  for (const [event, callback] of documentAdd.mock.calls)
    if (event === "visibilitychange") expect(documentRemove).toHaveBeenCalledWith(event, callback);
});

it("closing the generator after an event cancels its unfinished job", async () => {
  const base = fixture.fetch.getMockImplementation()!;
  fixture.fetch.mockImplementation(async (url, init) => init.method === "POST" ? base(url, init) :
    json({ events: [{ sequence: 1, event: { type: "text", text: "Read progress" } }], status: "running" }));
  const stream = hermesAgentStream(messages, options);
  await stream.next();
  expect((await stream.next()).value).toEqual({ type: "text", text: "Read progress" });
  await stream.return("");
  expect(fixture.fetch.mock.calls.filter(([url]) => url.endsWith("/cancel"))).toHaveLength(1);
});

it.each(["completed", "failed", "cancelled", "interrupted"])("refreshes the current owner's wallet once after a confirmed %s job", async status => {
  const base = fixture.fetch.getMockImplementation()!;
  fixture.fetch.mockImplementation(async (url, init) => init.method === "POST" ? base(url, init) :
    json({ events: [], status, result: "Verified reply" }));
  await collect();
  expect(fixture.invalidateWallet).toHaveBeenCalledOnce();
});

it("does not refresh another workspace's wallet from a late terminal response", async () => {
  let finish!: (response: Response) => void;
  const base = fixture.fetch.getMockImplementation()!;
  fixture.fetch.mockImplementation((url, init) => url.includes("/events?") ? new Promise(resolve => { finish = resolve; }) : base(url, init));
  const result = collect();
  const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(0);
  fixture.scope = "cloud:another-org:user:another-user"; fixture.org = "another-org"; fixture.identity++;
  finish(json({ events: [], status: "completed", result: "Old workspace private reply" }));
  await rejected;
  expect(fixture.invalidateWallet).not.toHaveBeenCalled();
});

it("does not refresh wallet balance for a pending job or an unconfirmed terminal answer", async () => {
  const base = fixture.fetch.getMockImplementation()!;
  let reads = 0;
  fixture.fetch.mockImplementation(async (url, init) => init.method === "POST" ? base(url, init) : ++reads === 1 ?
    json({ events: [], status: "running" }) : json({ events: [{ sequence: 1, event: { type: "done", text: "Incorrect reply", reason: "answered" } }], status: "completed", result: "Actual reply" }));
  const result = collect();
  const rejected = expect(result).rejects.toThrow("did not confirm");
  await vi.advanceTimersByTimeAsync(0);
  expect(fixture.invalidateWallet).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(500);
  await rejected;
  expect(fixture.invalidateWallet).not.toHaveBeenCalled();
});

it("persists only a scoped owner/org job receipt and recovers it after a module reload using GETs only", async () => {
  await collect();
  const jobId = id();
  expect(getHermesJobReceipt()).toEqual({ id: jobId, user_id: "fixture-user", org_id: "fixture-org", status: "completed" });
  const stored = [...fixture.storage.values()];
  expect(stored).toHaveLength(1);
  expect(Object.keys(JSON.parse(stored[0])).sort()).toEqual(["id", "org_id", "status", "user_id"]);
  expect(stored[0]).not.toContain(messages[0].text);
  expect(stored[0]).not.toContain("fixture-user-jwt");
  fixture.fetch.mockClear(); fixture.session.mockClear();
  vi.resetModules();
  const reloaded = await import("../hermesAgent");
  expect(reloaded.getHermesJobReceipt()?.id).toBe(jobId);
  expect((await collect(reloaded.resumeHermesAgentStream(jobId, options))).result).toBe("Verified summary");
  expect(fixture.fetch).toHaveBeenCalledOnce();
  expect(fixture.fetch.mock.calls[0]).toEqual([`https://pilot.fixture.test/v1/jobs/${jobId}/events?after=0`, expect.objectContaining({ method: "GET" })]);
});

it("never retrieves another account's saved receipt or job", async () => {
  await collect();
  const jobId = id();
  fixture.fetch.mockClear(); fixture.session.mockClear();
  fixture.scope = "cloud:fixture-org:user:another-user"; fixture.identity++;
  expect(getHermesJobReceipt()).toBeNull();
  await expect(collect(resumeHermesAgentStream(jobId, options))).rejects.toThrow("not saved for the current");
  expect(fixture.fetch).not.toHaveBeenCalled();
  expect(fixture.session).not.toHaveBeenCalled();
});

it("does not accept a forged owner or org in the current scoped receipt", async () => {
  const jobId = crypto.randomUUID();
  writeAgentStorage("filey.ai.hermes-job", JSON.stringify({ id: jobId, user_id: "other-user", org_id: "fixture-org", status: "running" }));
  expect(getHermesJobReceipt()).toBeNull();
  await expect(collect(resumeHermesAgentStream(jobId, options))).rejects.toThrow("not saved for the current");
  expect(fixture.fetch).not.toHaveBeenCalled();
});

it("refuses submission if the durable request reference cannot be saved", async () => {
  vi.mocked(writeAgentStorage).mockImplementationOnce(() => { throw new Error("Local storage full private diagnostic"); });
  await expect(collect()).rejects.toThrow("No task was submitted");
  expect(fixture.fetch).not.toHaveBeenCalled();
});

it("preserves a pending job's receipt rather than overwriting it with a second prompt", async () => {
  const controller = new AbortController();
  fixture.fetch.mockRejectedValueOnce(new TypeError("Acknowledgement lost"));
  const running = collect(hermesAgentStream(messages, { ...options, signal: controller.signal }));
  const stopped = expect(running).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(0);
  const saved = getHermesJobReceipt();
  expect(saved).toMatchObject({ id: id(), status: "unknown" });
  await expect(collect()).rejects.toThrow("A Filey AI preview task is already saved");
  expect(getHermesJobReceipt()).toEqual(saved);
  expect(countCreates()).toBe(1);
  controller.abort();
  await stopped;
});

it("marks a confirmed missing receipt interrupted without replay, so a later explicit task is possible", async () => {
  const jobId = crypto.randomUUID();
  writeAgentStorage("filey.ai.hermes-job", JSON.stringify({ id: jobId, user_id: "fixture-user", org_id: "fixture-org", status: "unknown" }));
  fixture.fetch.mockResolvedValueOnce(json({ error: "Task unavailable" }, 404));
  await expect(collect(resumeHermesAgentStream(jobId, options))).rejects.toThrow("request was not repeated");
  expect(getHermesJobReceipt()).toMatchObject({ id: jobId, status: "interrupted" });
  expect(countCreates()).toBe(0);
  expect((await collect()).result).toBe("Verified summary");
  expect(countCreates()).toBe(1);
  expect(getHermesJobReceipt()?.id).not.toBe(jobId);
});
