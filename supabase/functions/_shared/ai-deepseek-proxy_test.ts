// Async fixtures implement fetch's Promise contract.
// deno-lint-ignore-file require-await
import { fixtureJwt } from "./test-auth-fixture.ts";

function assert(ok: unknown, message = "Assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}
function fixtureEnvironment(initial: Record<string, string>) {
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

Deno.test("Filey hosted chat verifies session, MFA, email and funding before its fixed paid route", async () => {
  const env = {
    SUPABASE_URL: "https://fixture.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key",
    FILEY_AI_DEEPSEEK_KEY: "fixture-key",
    FILEY_AI_OPENROUTER_KEY: "fixture-old-key",
    FILEY_AI_GATEWAY: "omniroute",
    DODO_AI_CREDIT_PRODUCT_ID: "pdt_fixture",
    DODO_AI_CREDIT_PACKS: "[]",
  };
  const { values, restore } = fixtureEnvironment(env);
  const previousFetch = globalThis.fetch;
  const id = "30000000-0000-4000-8000-000000000001";
  let authenticated = true, confirmed = true, mfa = false, providers = 0;
  let providerStatus = 200, walletError = "";
  const events: string[] = [];
  const walletArgs: Record<string, unknown>[] = [];
  const providerRequests: Record<string, unknown>[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "https://fixture.supabase.co/auth/v1/user") {
      return Response.json(
        authenticated
          ? {
            id,
            email_confirmed_at: confirmed ? "2026-10-03" : null,
            factors: mfa ? [{ status: "verified" }] : [],
          }
          : { message: "Invalid token" },
        { status: authenticated ? 200 : 401 },
      );
    }
    if (url.endsWith("/rpc/filey_ai_wallet")) {
      const args = JSON.parse(String(init?.body));
      assert(
        args.p_user === id,
        "Wallet must belong to the authenticated account, never caller-supplied owner",
      );
      events.push(args.p_action);
      walletArgs.push(args.p_args);
      if (args.p_action === "reserve" && walletError) {
        return Response.json({ message: walletError }, { status: 400 });
      }
      return Response.json({ balance_micros: 1_000_000, reserved_micros: 0 });
    }
    if (url === "https://api.deepseek.com/chat/completions") {
      providers++;
      events.push("provider");
      const request = JSON.parse(String(init?.body));
      providerRequests.push(request);
      assert(
        request.user_id === id,
        "Provider isolation must override forged request identity",
      );
      assert(request.model === "deepseek-flash");
      assert(
        !request.provider && !request.usage && !request.baseURL &&
          !request.api_key,
      );
      assert(
        new Headers(init?.headers).get("Authorization") ===
            "Bearer fixture-key" && init?.redirect === "error",
      );
      return Response.json({
        id: "chatcmpl-fixture",
        model: "deepseek-flash",
        choices: [{
          index: 0,
          message: {
            role: "assistant",
            content: "Ready",
            reasoning_content: "Fixture",
          },
          finish_reason: "stop",
        }],
        usage: {
          prompt_tokens: 100,
          prompt_cache_hit_tokens: 20,
          prompt_cache_miss_tokens: 80,
          completion_tokens: 20,
          total_tokens: 120,
          cost: 999,
        },
      }, { status: providerStatus });
    }
    throw new Error(`Unexpected fixture request: ${url}`);
  }) as typeof fetch;
  try {
    const { handleRequest } = await import("../ai-credits/index.ts");
    const call = (
      patch: Record<string, unknown> = {},
      model: unknown = "filey-ai",
    ) => {
      events.length = 0;
      walletArgs.length = 0;
      return handleRequest(
        new Request("https://fixture/ai-credits", {
          method: "POST",
          headers: { Authorization: `Bearer ${fixtureJwt(id)}` },
          body: JSON.stringify({
            action: "completion",
            funding: "credits",
            request_id: crypto.randomUUID(),
            run_id: crypto.randomUUID(),
            user_id: "attacker-owner",
            request: {
              model,
              messages: [{ role: "user", content: "Hi" }],
              provider: { only: ["attacker"] },
              baseURL: "https://attacker.invalid",
              api_key: "attacker",
              usage: { cost: 999 },
              user_id: "attacker-owner",
            },
            ...patch,
          }),
        }),
      );
    };
    authenticated = false;
    assert((await call()).status === 401 && events.length === 0);
    authenticated = true;
    mfa = true;
    assert((await call()).status === 403 && events.length === 0);
    mfa = false;
    confirmed = false;
    assert((await call()).status === 403 && events.length === 0);
    confirmed = true;
    for (const funding of [undefined, "free", "byok", "attacker"]) {
      assert((await call({ funding })).status === 400 && events.length === 0);
    }
    for (const action of ["withdraw", "transfer", "refund", "topup"]) {
      assert(
        (await call({ action, amount_micros: 5000000 })).status === 400 &&
          events.length === 0,
        "Normal users cannot cash out, transfer, refund or manufacture Coin through the AI endpoint",
      );
    }
    const retired = await call({
      action: "limits",
      task_limit_micros: 10000,
      daily_limit_micros: 10000,
    });
    assert(
      retired.status === 400 && events.length === 0 &&
        (await retired.json()).error ===
          "Spending limits are no longer used. Coin usage uses your available balance.",
      "Retired spending controls cannot change the wallet through the public API",
    );
    for (
      const model of [
        "deepseek-flash",
        "deepseek-v4-pro",
        "openrouter/free",
        "openai/gpt-4.1",
      ]
    ) {
      assert((await call({}, model)).status === 400 && events.length === 0);
    }
    assert(
      providers === 0,
      "Auth, model and funding denials happen before reserve/inference",
    );
    const response = await call();
    const body = await response.json();
    assert(
      (providerRequests[0].thinking as { type: string }).type === "disabled" &&
        !("reasoning_effort" in providerRequests[0]),
      "Hosted Filey AI must explicitly default thinking off without a positive effort override",
    );
    assert(
      response.status === 200 && body.charged_micros === 41 &&
        body.completion.model === "filey-ai",
    );
    assert(
      events.join(",") === "reserve,provider,settle" && Number(providers) === 1,
    );
    assert(
      walletArgs[1].provider_cost_micros === null &&
        walletArgs[1].charged_micros === 41,
    );
    assert(
      !JSON.stringify(body).includes("deepseek") &&
        !JSON.stringify(body).includes("fixture-key"),
    );
    walletError =
      "Not enough available AI credits for this request. Add credits or lower the output limit.";
    const insufficient = await call();
    assert(
      insufficient.status === 402 &&
        (await insufficient.json()).error ===
          "Insufficient credit. Add Coin to continue.",
    );
    assert(
      events.join(",") === "reserve" && Number(providers) === 1,
      "Insufficient balance must stop the authenticated request before paid inference",
    );
    walletError = "";
    providerStatus = 429;
    assert(
      (await call()).status === 429 &&
        events.join(",") === "reserve,provider,release" &&
        Number(providers) === 2,
    );
    providerStatus = 200;
    const reasoningResponse = await call({ request: {
      model: "filey-ai",
      messages: [{ role: "user", content: "Think through this fixture" }],
      reasoning_enabled: true,
      reasoning_effort: "high",
      tools: [{ type: "function", function: { name: "list_invoices", parameters: { type: "object", properties: {} } } }],
    } });
    const reasoningBody = await reasoningResponse.json();
    const enabled = providerRequests[2];
    assert(
      reasoningResponse.status === 200 && Number(providers) === 3 &&
        events.join(",") === "reserve,provider,settle" &&
        (enabled.thinking as { type: string }).type === "enabled" &&
        enabled.reasoning_effort === "high" &&
        !("reasoning_enabled" in enabled),
      "An explicit reasoning toggle must reach the fixed hosted provider contract",
    );
    assert(
      reasoningBody.charged_micros === 41 &&
        reasoningBody.completion.choices[0].message.reasoning_content === "Fixture",
      "Reasoning-on tool requests retain real reasoning and the verified usage tariff",
    );
    values.delete("FILEY_AI_DEEPSEEK_KEY");
    assert(
      (await call()).status === 503 && events.length === 0 &&
        Number(providers) === 3,
      "An old OpenRouter key cannot provide a hosted fallback",
    );
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});

Deno.test("wallet status only publishes Filey AI and requires verified payments for top-ups", async () => {
  const env = {
    SUPABASE_URL: "https://fixture.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key",
    FILEY_AI_DEEPSEEK_KEY: "fixture-key",
    DODO_PAYMENTS_API_KEY: "fixture-payment-key",
    DODO_PAYMENTS_WEBHOOK_KEY: "fixture-webhook-key",
    DODO_AI_CREDIT_PRODUCT_ID: "pdt_fixture",
    DODO_AI_CREDIT_PACKS: "[]",
  };
  const { values, restore } = fixtureEnvironment(env);
  const previousFetch = globalThis.fetch;
  const id = "30000000-0000-4000-8000-000000000001";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/auth/v1/user")) return Response.json({ id });
    if (url.endsWith("/rpc/filey_ai_wallet")) {
      return Response.json({ balance_micros: 0 });
    }
    if (url.endsWith("/rpc/filey_take_rate_limit")) return Response.json(true);
    if (url.includes("/rest/v1/ai_credit_ledger?")) return Response.json([]);
    throw new Error(`Unexpected fixture request: ${url}`);
  }) as typeof fetch;
  try {
    const { handleRequest } = await import("../ai-credits/index.ts");
    const status = async () => {
      const response = await handleRequest(
        new Request("https://fixture/ai-credits", {
          method: "POST",
          headers: { Authorization: `Bearer ${fixtureJwt(id)}` },
          body: JSON.stringify({ action: "status" }),
        }),
      );
      assert(response.status === 200);
      return response.json();
    };
    const first = await status();
    assert(
      first.configured && first.models.length === 1 &&
        first.models[0].id === "filey-ai" &&
        first.models[0].name === "Filey AI",
    );
    assert(first.models[0].free === false && first.free_requests_per_day === 0);
    assert(
      first.topups_enabled && first.custom_topup.min_cents === 500 &&
        first.topup_fee_cents === 50,
    );
    assert(
      !JSON.stringify(first).includes("deepseek") &&
        !JSON.stringify(first).includes("fixture-key"),
    );
    values.delete("DODO_PAYMENTS_WEBHOOK_KEY");
    const unverified = await status();
    assert(
      unverified.configured && !unverified.topups_enabled,
      "Managed AI can remain available while unverifiable new purchases are disabled",
    );
    values.set("DODO_PAYMENTS_WEBHOOK_KEY", "fixture-webhook-key");
    values.delete("FILEY_AI_DEEPSEEK_KEY");
    values.set("HF_API_KEY_ID", "fixture-video-id");
    values.set("HF_API_KEY_SECRET", "fixture-video-secret");
    const second = await status();
    assert(
      !second.configured && second.models.length === 0 &&
        !second.topups_enabled && !second.custom_topup &&
        !second.video_configured && second.packs.length === 0,
      "Legacy video server keys cannot enable Filey Coin purchases",
    );
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});
