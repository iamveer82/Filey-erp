// Async fixtures implement the provider and wallet Promise contracts.
// deno-lint-ignore-file require-await
import { creditGateway } from "./ai-credit-gateway.ts";
import { prepareCreditRequest } from "./ai-credits.ts";
import {
  FILEY_AI_MODEL,
  fileyAICompletion,
  FileyAIError,
  fileyAIUsage,
  prepareFileyAIRequest,
} from "./filey-ai-completion.ts";

function assert(ok: unknown, message = "Assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}
function rejects(run: () => unknown) {
  let rejected = false;
  try {
    run();
  } catch {
    rejected = true;
  }
  assert(rejected);
}
function fixtureEnvironment(
  initial: Record<string, string> = { FILEY_AI_DEEPSEEK_KEY: "fixture-key" },
) {
  const original = Deno.env.get;
  const values = new Map(Object.entries(initial));
  Deno.env.get = (name) => values.get(name);
  return {
    values,
    restore: () => {
      Deno.env.get = original;
    },
  };
}
const user = {
  id: "30000000-0000-4000-8000-000000000001",
  email_confirmed_at: "2026-10-03",
};
const tools = [{
  type: "function",
  function: {
    name: "list_invoices",
    description: "Read invoices",
    parameters: { type: "object", properties: {} },
  },
}];
const request = {
  model: "filey-ai",
  messages: [{ role: "user", content: "Hi" }],
  tools,
};
function completion() {
  return {
    id: "chatcmpl-fixture",
    model: "deepseek-flash",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: "Ready",
        reasoning_content: "Reasoning fixture",
      },
      finish_reason: "stop",
    }],
    usage: {
      prompt_tokens: 100,
      prompt_cache_hit_tokens: 20,
      prompt_cache_miss_tokens: 80,
      completion_tokens: 20,
      total_tokens: 120,
      completion_tokens_details: { reasoning_tokens: 5 },
    },
  };
}
function tokenReceipt(hit: number, miss: number, output: number) {
  const raw = completion();
  raw.usage = {
    prompt_tokens: hit + miss,
    prompt_cache_hit_tokens: hit,
    prompt_cache_miss_tokens: miss,
    completion_tokens: output,
    total_tokens: hit + miss + output,
    completion_tokens_details: { reasoning_tokens: 0 },
  };
  return raw;
}

Deno.test("managed chat only accepts Filey's fixed alias and strips caller routing and prices", () => {
  const prepared = prepareFileyAIRequest({
    ...request,
    reasoning_enabled: true,
    reasoning_effort: "xhigh",
    temperature: 0.3,
    baseURL: "https://attacker.invalid",
    api_key: "attacker",
    provider: { only: ["attacker"] },
    usage: { cost: 999 },
    route: "fallback",
    thinking: { type: "disabled" },
    max_tokens: 393216,
  });
  assert(
    prepared.request.model === "deepseek-flash" &&
      prepared.request.max_tokens === 8192,
  );
  assert(
    prepared.request.reasoning_effort === "high" &&
      prepared.request.thinking.type === "enabled",
  );
  assert(JSON.stringify(prepared.request.tools) === JSON.stringify(tools));
  assert(
    !JSON.stringify(prepared.request).includes("attacker") &&
      !JSON.stringify(prepared.request).includes("temperature") &&
      !JSON.stringify(prepared.request).includes("cost"),
  );
  assert(
    prepareFileyAIRequest({ ...request, model: undefined }).request
      .thinking.type === "disabled",
  );
  assert(
    prepareFileyAIRequest({ ...request, reasoning_enabled: true, reasoning_effort: "max" }).request
      .reasoning_effort === "max",
  );
  for (
    const model of [
      "deepseek-flash",
      "deepseek-v4-pro",
      "openrouter/free",
      "openai/gpt-4.1",
      "",
    ]
  ) {
    rejects(() => prepareFileyAIRequest({ ...request, model }));
  }
  rejects(() =>
    prepareFileyAIRequest({ ...request, reasoning_effort: "attacker" })
  );
  assert(
    prepared.reserve > 0 && FILEY_AI_MODEL.name === "Filey AI" &&
      !FILEY_AI_MODEL.free,
  );
  assert(
    FILEY_AI_MODEL.input === 0.25 / 1_000_000 &&
      FILEY_AI_MODEL.output === 1.00 / 1_000_000,
  );
  const peak = prepareCreditRequest(request, {
    ...FILEY_AI_MODEL,
    input: 0.50 / 1_000_000,
    output: 2.00 / 1_000_000,
  });
  assert(
    prepareFileyAIRequest(request).reserve === peak.reserve,
    "Published charge rates do not lower the safe peak hold",
  );
});

Deno.test("reasoning defaults off, cannot be enabled by effort alone, and validates explicit boolean switches", () => {
  for (const reasoning_enabled of [undefined, false]) {
    const prepared = prepareFileyAIRequest({ ...request, reasoning_enabled, reasoning_effort: "max", thinking: { type: "enabled" } });
    assert(prepared.request.thinking.type === "disabled" && prepared.request.reasoning_effort === undefined);
    assert(!("reasoning_enabled" in prepared.request), "Internal toggle was forwarded to the provider");
  }
  for (const [effort, expected] of [[undefined, "low"], ["auto", "low"], ["low", "low"], ["medium", "high"], ["xhigh", "high"], ["max", "max"]]) {
    const prepared = prepareFileyAIRequest({ ...request, reasoning_enabled: true, reasoning_effort: effort });
    assert(prepared.request.thinking.type === "enabled" && prepared.request.reasoning_effort === expected);
    assert(prepared.reserve === prepareFileyAIRequest(request).reserve, "Toggle changed the safe reservation tariff");
  }
  for (const reasoning_enabled of [null, "true", "false", 0, 1, [], {}]) {
    rejects(() => prepareFileyAIRequest({ ...request, reasoning_enabled }));
  }
});

Deno.test("thinking tool continuations replay exact traces while nonthinking calls need no reasoning", () => {
  const messages = [{ role: "user", content: "Read invoices" }, {
    role: "assistant",
    content: null,
    reasoning_content: "Exact prior reasoning",
    tool_calls: [{
      id: "call-fixture",
      type: "function",
      function: { name: "list_invoices", arguments: "{}" },
    }],
  }, { role: "tool", tool_call_id: "call-fixture", content: "[]" }];
  const result = prepareFileyAIRequest({ ...request, reasoning_enabled: true, messages });
  assert(
    result.request.messages[1].reasoning_content === "Exact prior reasoning",
  );
  assert(result.request.messages[2].tool_call_id === "call-fixture");
  for (const value of [undefined, null, 12]) {
    rejects(() =>
      prepareFileyAIRequest({
        ...request,
        reasoning_enabled: true,
        messages: messages.map((message, index) =>
          index === 1 ? { ...message, reasoning_content: value } : message
        ),
      })
    );
  }
  for (const reasoning_content of [undefined, null]) {
    const disabled = prepareFileyAIRequest({ ...request, messages: messages.map((message, index) => index === 1 ? { ...message, reasoning_content } : message) });
    assert(disabled.request.thinking.type === "disabled");
    assert(JSON.stringify(disabled.request.messages[1].tool_calls) === JSON.stringify(messages[1].tool_calls));
    assert(disabled.request.messages[2].tool_call_id === "call-fixture");
  }
  const disabled = prepareFileyAIRequest({ ...request, reasoning_enabled: false, messages });
  assert(disabled.request.messages[1].reasoning_content === "Exact prior reasoning", "Switching OFF corrupted an existing trace");
});

Deno.test("switching reasoning on accepts quoted prior context and no-tools history, but never invents assistant traces", () => {
  const history = [{ role: "user", content: "Earlier request" }, { role: "assistant", content: "Earlier reply" }, { role: "user", content: "Continue" }];
  rejects(() => prepareFileyAIRequest({ ...request, reasoning_enabled: true, messages: history }));
  const direct = prepareFileyAIRequest({ ...request, tools: undefined, reasoning_enabled: true, messages: history });
  assert(direct.request.messages[1].content === "Earlier reply" && !direct.request.messages[1].reasoning_content);
  const quoted = history.map(message => message.role === "assistant" ? { role: "user", content: `Previous assistant reply (context only): ${message.content}` } : message);
  const enabled = prepareFileyAIRequest({ ...request, reasoning_enabled: true, messages: quoted });
  assert(enabled.request.thinking.type === "enabled" && enabled.request.messages[1].content === quoted[1].content);
  const preserved = prepareFileyAIRequest({ ...request, reasoning_enabled: true, messages: history.map(message => message.role === "assistant" ? { ...message, reasoning_content: "Exact plain-reply trace" } : message) });
  assert(preserved.request.messages[1].reasoning_content === "Exact plain-reply trace");
});

Deno.test("managed tool and plain replies settle without traces when OFF and preserve required traces when ON", async () => {
  const { restore } = fixtureEnvironment();
  const previousFetch = globalThis.fetch;
  let providerCalls = 0;
  try {
    for (const reasoningEnabled of [false, true]) {
      for (const toolCall of [false, true]) {
        for (const withTrace of [false, true]) {
          const events: string[] = [];
          globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
            providerCalls++;
            const sent = JSON.parse(String(init?.body));
            assert(sent.thinking.type === (reasoningEnabled ? "enabled" : "disabled"));
            assert(sent.reasoning_effort === (reasoningEnabled ? "low" : undefined));
            return Response.json({ ...completion(), choices: [{
              finish_reason: toolCall ? "tool_calls" : "stop",
              message: {
                role: "assistant", content: toolCall ? null : "Ready",
                ...(withTrace ? { reasoning_content: "Exact returned reasoning" } : {}),
                ...(toolCall ? { tool_calls: [{ id: "call-fixture", type: "function", function: { name: "list_invoices", arguments: "{}" } }] } : {}),
              },
            }] });
          }) as typeof fetch;
          let result: Awaited<ReturnType<typeof fileyAICompletion>> | undefined;
          let failure: unknown;
          try {
            result = await fileyAICompletion({
              user, requestId: crypto.randomUUID(), runId: crypto.randomUUID(),
              request: { ...request, reasoning_enabled: reasoningEnabled },
              wallet: async action => { events.push(action); return {}; },
            });
          } catch (error) { failure = error; }
          if (reasoningEnabled && !withTrace) {
            assert(failure instanceof FileyAIError && events.join(",") === "reserve,release", "Unusable thinking history was charged");
          } else {
            assert(result && events.join(",") === "reserve,settle" && result.charged_micros === 41);
            assert(result.completion.choices[0].message.reasoning_content === (withTrace ? "Exact returned reasoning" : undefined));
            if (toolCall) assert(result.completion.choices[0].message.tool_calls?.[0].id === "call-fixture");
          }
        }
      }
    }
    assert(providerCalls === 8, "A provider call was retried or skipped");
  } finally { globalThis.fetch = previousFetch; restore(); }
});

Deno.test("Filey's fixed tariff uses one exact micro-unit rounding and never double-charges reasoning", () => {
  const raw = completion();
  const first = fileyAIUsage(raw, 2048);
  assert(
    first.chargedMicros === 41 && first.inputTokens === 100 &&
      first.outputTokens === 20,
  );
  Object.assign(raw.usage, {
    prompt_tokens: 2000,
    prompt_cache_hit_tokens: 1000,
    prompt_cache_miss_tokens: 1000,
    completion_tokens: 1000,
    total_tokens: 3000,
  });
  assert(fileyAIUsage(raw, 2048).chargedMicros === 1255);
  Object.assign(raw.usage, {
    prompt_tokens: 1,
    prompt_cache_hit_tokens: 1,
    prompt_cache_miss_tokens: 0,
    completion_tokens: 0,
    total_tokens: 1,
  });
  raw.usage.completion_tokens_details.reasoning_tokens = 0;
  assert(
    fileyAIUsage(raw, 2048).chargedMicros === 1,
    "Fractional micro-dollar rounds once upward",
  );
});

Deno.test("three dollars of base token usage becomes five Coin across valid capped completions", () => {
  // Each full receipt costs $0.018 at the base rate and $0.03 with Filey.
  // The final $0.012 base receipt contributes $0.02, without relaxing caps.
  const full = tokenReceipt(0, 100_000, 5000);
  const tail = tokenReceipt(0, 80_000, 0);
  let charged = 0;
  for (let n = 0; n < 166; n++) {
    charged += fileyAIUsage(full, 5000).chargedMicros;
  }
  charged += fileyAIUsage(tail, 2048).chargedMicros;
  assert(166 * 18_000 + 12_000 === 3_000_000);
  assert(charged === 5_000_000, "$3 base use must cost exactly 5 Coin");
});

Deno.test("small cache and uncached bills scale before rounding, never rounding the base first", () => {
  for (
    const [hit, miss, output, expected] of [
      [0, 1, 0, 1],
      [0, 4, 0, 1],
      [0, 0, 1, 1],
      [1, 0, 0, 1],
      [200, 0, 0, 1],
      [201, 0, 0, 2],
      [1000, 1000, 1000, 1255],
      [0, 0, 0, 0],
    ]
  ) {
    assert(
      fileyAIUsage(tokenReceipt(hit, miss, output), 2048).chargedMicros ===
        expected,
    );
  }
});

Deno.test("scaled peak reservations cover maximum validated context and output without caller pricing", () => {
  const payload = {
    model: "filey-ai",
    max_tokens: 8192,
    messages: [{
      role: "user",
      content: [{
        type: "image_url",
        image_url: { url: "data:image/png;base64,YQ==" },
      }],
    }],
  };
  const prepared = prepareFileyAIRequest(payload);
  const maxInput = FILEY_AI_MODEL.context - prepared.request.max_tokens;
  const largest =
    fileyAIUsage(tokenReceipt(0, maxInput, 8192), 8192).chargedMicros;
  assert(
    largest === 38_912 && prepared.reserve >= 77_824,
    "Peak holds must include the same tariff and remain above the maximum customer bill",
  );
  assert(prepared.reserve >= largest);
  const forged = prepareFileyAIRequest({
    ...payload,
    input_price: 0,
    output_price: 0,
    markup_bps: -10_000,
    reserve: 1,
    usage: { cost: 0 },
  });
  assert(
    forged.reserve === prepared.reserve &&
      JSON.stringify(forged.request) === JSON.stringify(prepared.request),
    "A caller cannot discount or shrink the server's tariff or reservation",
  );
});

Deno.test("missing, inconsistent, unsafe or substituted token receipts cannot debit Coins", () => {
  for (
    const patch of [
      { prompt_tokens: "100" },
      { prompt_tokens: -1 },
      { prompt_tokens: 100.5 },
      { prompt_tokens: Number.MAX_SAFE_INTEGER },
      { prompt_cache_hit_tokens: undefined },
      { prompt_cache_miss_tokens: 79 },
      { total_tokens: 119 },
      { completion_tokens: 3000, total_tokens: 3100 },
      { completion_tokens_details: { reasoning_tokens: 21 } },
      { completion_tokens_details: { reasoning_tokens: "5" } },
    ]
  ) {
    const raw = completion();
    Object.assign(raw.usage, patch);
    rejects(() => fileyAIUsage(raw, 2048));
  }
  for (
    const model of [undefined, "filey-ai", "deepseek-v4-pro", "openai/gpt-4.1"]
  ) {
    rejects(() => fileyAIUsage({ ...completion(), model }, 2048));
  }
  for (
    const id of [undefined, "", "https://provider.invalid/id", "x".repeat(201)]
  ) {
    rejects(() => fileyAIUsage({ ...completion(), id }, 2048));
  }
  rejects(() => fileyAIUsage(completion(), NaN));
});

Deno.test("managed gateway ignores all previous provider configuration and offers no hosted free route", () => {
  const { values: env, restore } = fixtureEnvironment({
    FILEY_AI_DEEPSEEK_KEY: "fixture-key",
    FILEY_AI_GATEWAY: "omniroute",
    FILEY_AI_OPENROUTER_KEY: "fixture-old-key",
    FILEY_AI_OMNIROUTE_URL: "https://attacker.invalid/v1",
  });
  try {
    assert(
      creditGateway()?.url === "https://api.deepseek.com/chat/completions",
    );
    assert(
      creditGateway()?.key === "fixture-key" && creditGateway(true) === null,
    );
    env.delete("FILEY_AI_DEEPSEEK_KEY");
    assert(
      creditGateway() === null,
      "No old-provider fallback without DeepSeek key",
    );
  } finally {
    restore();
  }
});

Deno.test("shared completion authenticates, reserves once, settles precise usage and exposes only Filey AI", async () => {
  const { restore } = fixtureEnvironment();
  const previousFetch = globalThis.fetch;
  const calls: { action: string; args: Record<string, unknown> }[] = [];
  const consumed = new Set<string>();
  let providerCalls = 0;
  const wallet = async (action: string, args: Record<string, unknown> = {}) => {
    if (action === "reserve") {
      if (consumed.has(String(args.request_id))) {
        throw new Error(
          "This request was already submitted. Refresh your balance before retrying.",
        );
      }
      consumed.add(String(args.request_id));
    }
    calls.push({ action, args });
    return { balance_micros: 1_000_000, reserved_micros: 0 };
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert(String(input) === "https://api.deepseek.com/chat/completions");
    assert(
      init?.redirect === "error" &&
        new Headers(init.headers).get("Authorization") === "Bearer fixture-key",
    );
    const sent = JSON.parse(String(init?.body));
    assert(
      sent.user_id === user.id,
      "Provider isolation belongs to the verified account",
    );
    assert(
      sent.model === "deepseek-flash" && !sent.provider &&
        sent.thinking.type === "disabled" && sent.reasoning_effort === undefined,
    );
    assert(
      calls.at(-1)?.action === "reserve",
      "Reserve precedes any inference",
    );
    providerCalls++;
    return Response.json({
      ...completion(),
      api_key: "never-return",
      provider: "never-return",
      usage: { ...completion().usage, cost: 999 },
    });
  }) as typeof fetch;
  try {
    const requestId = crypto.randomUUID(), runId = crypto.randomUUID();
    const args = {
      user,
      wallet,
      requestId,
      runId,
      request: { ...request, user_id: "attacker-owner" },
    };
    const result = await fileyAICompletion(args);
    assert(
      calls.map((call) => call.action).join(",") === "reserve,settle" &&
        providerCalls === 1,
    );
    assert(
      calls[0].args.run_id === runId && calls[0].args.model === "filey-ai" &&
        calls[0].args.markup_bps === 0,
    );
    assert(
      Number(calls[0].args.amount_micros) > result.charged_micros,
      "Hold uses scaled peak upper bound, bill uses the fixed actual-token tariff",
    );
    assert(
      calls[1].args.charged_micros === 41 &&
        calls[1].args.provider_cost_micros === null,
    );
    assert(
      calls[1].args.input_tokens === 100 && calls[1].args.output_tokens === 20,
    );
    assert(
      result.completion.model === "filey-ai" &&
        result.completion.choices[0].message.reasoning_content ===
          "Reasoning fixture",
    );
    assert(
      !JSON.stringify(result).includes("never-return") &&
        !JSON.stringify(result).includes("deepseek"),
    );
    let duplicate: unknown;
    try {
      await fileyAICompletion(args);
    } catch (error) {
      duplicate = error;
    }
    assert(
      duplicate instanceof FileyAIError && duplicate.status === 402 &&
        providerCalls === 1,
    );
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});

Deno.test("failed, empty or unverifiable provider responses release the hold without retry or charge", async () => {
  const { restore } = fixtureEnvironment();
  const previousFetch = globalThis.fetch;
  try {
    for (
      const failure of [
        "network",
        "status",
        "json",
        "usage",
        "model",
        "error",
        "empty",
        "missing-reasoning",
      ]
    ) {
      const events: string[] = [];
      let calls = 0;
      globalThis.fetch = (async () => {
        calls++;
        if (failure === "network") throw new Error("private-provider-detail");
        if (failure === "status") {
          return Response.json({ error: "private-provider-detail" }, {
            status: 429,
          });
        }
        if (failure === "json") return new Response("private-provider-detail");
        const raw = completion() as Record<string, unknown>;
        if (failure === "usage") raw.usage = { cost: 0.000001 };
        if (failure === "model") raw.model = "deepseek-v4-pro";
        if (failure === "error") {
          raw.error = { message: "private-provider-detail" };
        }
        if (failure === "empty") {
          raw.choices = [{
            message: {
              role: "assistant",
              content: "",
              reasoning_content: "Only reasoning",
            },
          }];
        }
        if (failure === "missing-reasoning") {
          raw.choices = [{
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: "call",
                type: "function",
                function: { name: "list_invoices", arguments: "{}" },
              }],
            },
          }];
        }
        return Response.json(raw);
      }) as typeof fetch;
      let error: unknown;
      try {
        await fileyAICompletion({
          user,
          requestId: crypto.randomUUID(),
          runId: crypto.randomUUID(),
          request: { ...request, reasoning_enabled: failure === "missing-reasoning" },
          wallet: async (action) => {
            events.push(action);
            return {};
          },
        });
      } catch (caught) {
        error = caught;
      }
      assert(
        error instanceof FileyAIError &&
          !error.message.includes("private-provider-detail"),
        failure,
      );
      assert(events.join(",") === "reserve,release" && calls === 1, failure);
    }
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});

Deno.test("unverified users, invalid aliases and wallet denials never make a provider request", async () => {
  const { restore } = fixtureEnvironment();
  const previousFetch = globalThis.fetch;
  let providerCalls = 0, walletCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls++;
    throw new Error("Should not fetch");
  }) as typeof fetch;
  try {
    const base = {
      user,
      requestId: crypto.randomUUID(),
      runId: crypto.randomUUID(),
      request,
      wallet: async () => {
        walletCalls++;
        throw new Error("private-wallet-detail");
      },
    };
    for (
      const patch of [
        { user: { ...user, email_confirmed_at: null } },
        { requestId: "invalid" },
        { request: { ...request, model: "deepseek-flash" } },
        { request: {} },
        { request: { ...request, reasoning_enabled: "true" } },
        { request: { ...request, reasoning_enabled: true, messages: [{ role: "assistant", content: "Old reply without a trace" }, { role: "user", content: "Continue" }] } },
      ]
    ) {
      try {
        await fileyAICompletion({ ...base, ...patch });
      } catch (error) {
        assert(error instanceof FileyAIError);
      }
    }
    assert(walletCalls === 0 && providerCalls === 0);
    try {
      await fileyAICompletion(base);
    } catch (error) {
      assert(
        error instanceof FileyAIError && error.status === 402 &&
          !error.message.includes("private-wallet-detail"),
      );
    }
    assert(Number(walletCalls) === 1 && providerCalls === 0);
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});

Deno.test("lost settlement acknowledgement closes the captured hold without another inference", async () => {
  const { restore } = fixtureEnvironment();
  const previousFetch = globalThis.fetch;
  let providerCalls = 0, charged = 0;
  const events: string[] = [];
  globalThis.fetch = (async () => {
    providerCalls++;
    return Response.json(completion());
  }) as typeof fetch;
  try {
    let error: unknown;
    try {
      await fileyAICompletion({
        user,
        requestId: crypto.randomUUID(),
        runId: crypto.randomUUID(),
        request,
        wallet: async (action, args) => {
          events.push(action);
          if (action === "settle") {
            charged = Number(args?.charged_micros);
            throw new Error("Lost ack");
          }
          // SQL release ignores a request that has already settled.
          return {};
        },
      });
    } catch (caught) {
      error = caught;
    }
    assert(
      error instanceof FileyAIError &&
        !error.message.includes("No Coins were charged"),
    );
    assert(
      events.join(",") === "reserve,settle,release" && providerCalls === 1 &&
        charged === 41,
    );
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});

Deno.test("the shared paid route gives exact Add Coin guidance only for the verified insufficient-balance denial", async () => {
  const { restore } = fixtureEnvironment();
  const previousFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls++;
    throw new Error("Must not infer without a reserve");
  }) as typeof fetch;
  const denial =
    "Not enough available AI credits for this request. Add credits or lower the output limit.";
  try {
    for (
      const detail of [
        denial,
        `${denial} SQL SELECT private_rows`,
        "private-wallet-detail",
        "Daily AI spending limit reached. Adjust it in AI Credits.",
        "Task spending limit reached. Adjust it in AI Credits or reduce the task.",
      ]
    ) {
      const actions: string[] = [];
      let error: unknown;
      try {
        await fileyAICompletion({
          user,
          requestId: crypto.randomUUID(),
          runId: crypto.randomUUID(),
          request,
          wallet: async (action) => {
            actions.push(action);
            throw new Error(detail);
          },
        });
      } catch (caught) {
        error = caught;
      }
      assert(error instanceof FileyAIError && error.status === 402);
      assert(
        error.message ===
          (detail === denial
            ? "Insufficient credit. Add Coin to continue."
            : "Coins are temporarily unavailable. Refresh your balance before trying again."),
      );
      assert(
        actions.join(",") === "reserve" && providerCalls === 0,
        "Both authenticated app and hosted channel callers must stop before provider dispatch on reserve denial",
      );
    }
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});
