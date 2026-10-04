// Provider and RPC are local fixtures; this suite runs without network access.
// deno-lint-ignore-file require-await
import { recoverFileyAICompletion } from "./ai-completion-recovery.ts";
import { FileyAIError } from "./filey-ai-completion.ts";

function assert(ok: unknown, message = "Assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}
const user = { id: "38000000-0000-4000-8000-000000000001", email_confirmed_at: "2026-10-04" };
const body = {
  action: "completion", funding: "credits", recoverable: true,
  request_id: "58000000-0000-4000-8000-000000000001",
  run_id: "68000000-0000-4000-8000-000000000001", org_id: "recovery-a",
  request: { model: "filey-ai", max_tokens: 2048, messages: [{ role: "user", content: "Synthetic private prompt" }] },
};
function completion() {
  return {
    id: "fixture-completion", model: "deepseek-flash",
    choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Synthetic answer", reasoning_content: "Synthetic reasoning" } }],
    usage: { prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 20, prompt_cache_miss_tokens: 80, total_tokens: 120 },
    api_key: "private-provider-detail", provider: "private-provider-detail",
  };
}
function environment() {
  const fetch = globalThis.fetch, get = Deno.env.get;
  Deno.env.get = (name: string) => name === "FILEY_AI_DEEPSEEK_KEY" ? "fixture-key" : undefined;
  globalThis.fetch = () => { throw new Error("Unexpected provider call"); };
  return () => { globalThis.fetch = fetch; Deno.env.get = get; };
}
function fixtureRpc(loseSettlementAck = false) {
  const calls: { action: string; args: Record<string, unknown> }[] = [];
  let result: Record<string, unknown> = { state: "missing" };
  return {
    calls,
    rpc: async (action: string, args: Record<string, unknown>) => {
      calls.push({ action, args });
      if (action === "begin" && result.state === "missing") {
        result = { state: "pending" };
        return { state: "pending", dispatch: true };
      }
      if (action === "settle" && result.state === "pending") {
        result = { state: "complete", completion: args.completion, charged_micros: args.charged_micros, account: { balance_micros: 999959 } };
        if (loseSettlementAck) throw new Error("Synthetic lost settlement acknowledgement");
      }
      if (action === "fail" && result.state === "pending") result = { state: "failed" };
      return result;
    },
  };
}

Deno.test("recovery validates identity and request boundaries before database or provider work", async () => {
  const restore = environment();
  let calls = 0;
  const rpc = async () => { calls++; return {}; };
  try {
    for (const patch of [
      { request_id: body.request_id + "\n" }, { run_id: "invalid" }, { org_id: "" },
      { org_id: "a".repeat(201) }, { org_id: "workspace\n" }, { funding: "free" },
      { recoverable: false }, { request: { ...body.request, model: "deepseek-flash" } },
      { request: undefined }, { action: "settle" },
    ]) {
      let failure: unknown;
      try { await recoverFileyAICompletion(user, { ...body, ...patch }, rpc); } catch (error) { failure = error; }
      assert(failure instanceof FileyAIError && failure.status === 400, JSON.stringify(patch));
    }
    for (const patch of [{ id: user.id + "\n" }, { email_confirmed_at: null }]) {
      let failure: unknown;
      try { await recoverFileyAICompletion({ ...user, ...patch }, body, rpc); } catch (error) { failure = error; }
      assert(failure instanceof FileyAIError && failure.status === 403);
    }
    assert(calls === 0, "Invalid input reached the recovery database");
  } finally { restore(); }
});

Deno.test("status reads only original request/workspace binding and works without provider configuration", async () => {
  const restore = environment();
  Deno.env.get = () => undefined;
  const calls: { action: string; args: Record<string, unknown> }[] = [];
  try {
    const response = await recoverFileyAICompletion(user, { ...body, action: "completion_status", user_id: "spoofed-user" }, async (action, args) => {
      calls.push({ action, args }); return { state: "pending" };
    });
    assert(response.state === "pending" && calls.length === 1 && calls[0].action === "status");
    assert(JSON.stringify(calls[0].args) === JSON.stringify({ request_id: body.request_id, org_id: body.org_id }));
  } finally { restore(); }
});

Deno.test("async recovery dispatches once, persists only a hash/result, and retrieves a reply after disconnect", async () => {
  const restore = environment(), fixture = fixtureRpc();
  const background: Promise<unknown>[] = [];
  let providerCalls = 0;
  let releaseProvider!: (response: Response) => void;
  const waiting = new Promise<Response>((resolve) => { releaseProvider = resolve; });
  globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    providerCalls++;
    assert(init?.redirect === "error");
    assert(JSON.parse(String(init?.body)).user_id === user.id);
    return await waiting;
  };
  try {
    const pending = await recoverFileyAICompletion(user, body, fixture.rpc, (work) => background.push(work));
    assert(pending.state === "pending" && background.length === 1 && providerCalls === 1);
    const duplicate = await recoverFileyAICompletion(user, body, fixture.rpc, (work) => background.push(work));
    assert(duplicate.state === "pending" && background.length === 1 && providerCalls === 1, "Retry dispatched another inference");
    assert(/^[a-f0-9]{64}$/.test(String(fixture.calls[0].args.fingerprint)));
    assert(fixture.calls[0].args.run_id === body.run_id && fixture.calls[0].args.org_id === body.org_id);
    assert(!JSON.stringify(fixture.calls).includes("Synthetic private prompt"), "Request prompt entered persistent RPC arguments");
    releaseProvider(Response.json(completion()));
    await Promise.all(background);
    const response = await recoverFileyAICompletion(user, { ...body, action: "completion_status" }, fixture.rpc);
    const cached = response.completion as ReturnType<typeof completion>;
    assert(response.state === "complete" && response.charged_micros === 41);
    assert(cached.model === "filey-ai" && cached.choices[0].message.content === "Synthetic answer");
    assert(!JSON.stringify(response).includes("private-provider-detail") && !JSON.stringify(response).includes("fixture-key"));
    assert(fixture.calls.filter(call => call.action === "settle").length === 1);
    assert(!fixture.calls.some(call => call.action === "reserve"), "Worker reserved an already held request twice");
    const replay = await recoverFileyAICompletion(user, body, fixture.rpc, (work) => background.push(work));
    assert(replay.state === "complete" && providerCalls === 1 && background.length === 1);
  } finally {
    releaseProvider(Response.json(completion()));
    await Promise.all(background);
    restore();
  }
});

Deno.test("fingerprint binds prepared provider content without persisting caller prompts or provider settings", async () => {
  const restore = environment();
  const fingerprints: unknown[] = [];
  const rpc = async (_action: string, args: Record<string, unknown>) => { fingerprints.push(args.fingerprint); return { state: "pending" }; };
  try {
    await recoverFileyAICompletion(user, body, rpc);
    await recoverFileyAICompletion(user, { ...body, request: { ...body.request, api_key: "ignored", provider: "ignored" } }, rpc);
    await recoverFileyAICompletion(user, { ...body, request: { ...body.request, messages: [{ role: "user", content: "Changed private prompt" }] } }, rpc);
    assert(fingerprints[0] === fingerprints[1], "Ignored routing fields changed request identity");
    assert(fingerprints[0] !== fingerprints[2], "Different provider content reused a fingerprint");
  } finally { restore(); }
});

Deno.test("lost begin acknowledgement never starts a provider call or blindly releases an uncertain job", async () => {
  const restore = environment();
  const actions: string[] = [];
  try {
    let failure: unknown;
    try {
      await recoverFileyAICompletion(user, body, async (action) => { actions.push(action); throw new Error("private-database-detail"); });
    } catch (error) { failure = error; }
    assert(failure instanceof FileyAIError && !failure.message.includes("private-database-detail"));
    assert(actions.join(",") === "begin");
    const response = await recoverFileyAICompletion(user, body, async () => ({ state: "pending" }));
    assert(response.state === "pending");
  } finally { restore(); }
});

Deno.test("lost settlement acknowledgement recovers the committed reply without recharging or redispatch", async () => {
  const restore = environment(), fixture = fixtureRpc(true);
  let providerCalls = 0;
  globalThis.fetch = async () => { providerCalls++; return Response.json(completion()); };
  try {
    const response = await recoverFileyAICompletion(user, body, fixture.rpc);
    assert(response.state === "complete" && response.charged_micros === 41 && providerCalls === 1);
    assert(fixture.calls.filter(call => call.action === "settle").length === 1);
    assert(fixture.calls.some(call => call.action === "fail"), "Uncertain settlement cleanup was not exercised");
    const retry = await recoverFileyAICompletion(user, body, fixture.rpc);
    assert(retry.state === "complete" && providerCalls === 1);
  } finally { restore(); }
});

Deno.test("provider failures remain terminal without repeat inference or a settlement debit", async () => {
  const restore = environment();
  try {
    for (const failure of ["network", "status", "usage"]) {
      const fixture = fixtureRpc();
      let providerCalls = 0;
      globalThis.fetch = async () => {
        providerCalls++;
        if (failure === "network") throw new Error("private-provider-detail");
        if (failure === "status") return Response.json({ error: "private-provider-detail" }, { status: 503 });
        return Response.json({ ...completion(), usage: { cost: 1 } });
      };
      const response = await recoverFileyAICompletion(user, body, fixture.rpc);
      assert(response.state === "failed" && providerCalls === 1, failure);
      assert(!fixture.calls.some(call => call.action === "settle"), failure);
      assert(!JSON.stringify(response).includes("private-provider-detail"), failure);
      const retry = await recoverFileyAICompletion(user, body, fixture.rpc);
      assert(retry.state === "failed" && providerCalls === 1, failure);
    }
  } finally { restore(); }
});
