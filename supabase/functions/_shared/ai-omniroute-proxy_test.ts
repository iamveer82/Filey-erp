function assert(ok: unknown, message = "Assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}

Deno.test("OmniRoute uses authenticated, reserved Paper with verified cost and no paid fallback", async () => {
  const env = {
    FILEY_AI_GATEWAY: "omniroute",
    FILEY_AI_OMNIROUTE_URL: "https://gateway.example/v1",
    FILEY_AI_OMNIROUTE_KEY: "fixture-gateway-key",
    FILEY_AI_OPENROUTER_KEY: "fixture-direct-key",
    FILEY_AI_MARKUP_BPS: "2000",
    FILEY_AI_MODELS: "openai/gpt-4.1-mini,openai/gpt-4.1",
    SUPABASE_URL: "https://fixture.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key",
  };
  const previous = Object.keys(env).map((name) => [name, Deno.env.get(name)]);
  Object.entries(env).forEach(([name, value]) => Deno.env.set(name, value));
  const originalFetch = globalThis.fetch;
  const userId = "30000000-0000-4000-8000-000000000001";
  const model = "openai/gpt-4.1-mini";
  const generationId = "gen-fileyfixture";
  const functionTools = [{
    type: "function",
    function: {
      name: "list_invoices",
      description: "Read invoices",
      parameters: { type: "object", properties: {} },
    },
  }];
  let authenticated = true;
  let verified = true;
  let reserveAllowed = true;
  let upstreamStatus = 200;
  let cost: unknown = 0.002;
  let gatewayCost: unknown = undefined;
  let requestId = "";
  let receiptOverrides: Record<string, unknown> = {};
  let receiptStatus = 200;
  let receiptNotFound = 0;
  let networkFailure = false;
  let invalidJson = false;
  let overflowCost = false;
  let providerError = false;
  let missingId = false;
  let events: string[] = [];
  let walletCalls: { action: string; args: Record<string, unknown> }[] = [];
  let gatewayCalls = 0;
  let freeCalls = 0;
  let directPaidCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "https://fixture.supabase.co/auth/v1/user") {
      return Response.json(
        authenticated
          ? { id: userId, email_confirmed_at: verified ? "2026-09-21" : null }
          : { message: "Invalid token" },
        { status: authenticated ? 200 : 401 },
      );
    }
    if (url === "https://openrouter.ai/api/v1/models") {
      return Response.json({
        data: [
          {
            id: "openai/gpt-4.1",
            name: "Expensive paid model",
            supported_parameters: ["tools"],
            context_length: 32768,
            pricing: { prompt: "0.000005", completion: "0.00001" },
          },
          {
            id: model,
            name: "Paid model",
            supported_parameters: ["tools"],
            context_length: 32768,
            pricing: { prompt: "0.000001", completion: "0.000002" },
          },
          {
            id: "openrouter/free",
            name: "Free model",
            supported_parameters: ["tools"],
            context_length: 32768,
            pricing: { prompt: "0", completion: "0" },
          },
        ],
      });
    }
    if (
      url === "https://fixture.supabase.co/rest/v1/rpc/filey_take_rate_limit"
    ) {
      return Response.json(true);
    }
    if (url === "https://fixture.supabase.co/rest/v1/rpc/filey_ai_wallet") {
      const body = JSON.parse(String(init?.body));
      assert(
        body.p_user === userId,
        "Wallet belongs to the authenticated user",
      );
      events.push(body.p_action);
      walletCalls.push({ action: body.p_action, args: body.p_args });
      if (body.p_action === "reserve" && !reserveAllowed) {
        return Response.json({ message: "Insufficient balance" }, {
          status: 400,
        });
      }
      return Response.json({ balance_micros: 2_000_000, reserved_micros: 0 });
    }
    if (url === "https://openrouter.ai/api/v1/chat/completions") {
      const body = JSON.parse(String(init?.body));
      assert(
        init?.redirect === "error",
        "Provider credentials cannot follow redirects",
      );
      assert(
        new Headers(init?.headers).get("Authorization") ===
          "Bearer fixture-direct-key",
      );
      if (body.model === model) {
        directPaidCalls++;
        events.push("direct");
        assert(
          Deno.env.get("FILEY_AI_GATEWAY") === "openrouter",
          "Direct paid inference is explicit configuration, never fallback",
        );
        assert(
          body.provider.sort === "price" &&
            body.provider.require_parameters === true,
        );
        assert(
          body.provider.max_price.prompt === 1 &&
            body.provider.max_price.completion === 2,
        );
        assert(JSON.stringify(body.tools) === JSON.stringify(functionTools));
        assert(
          !body.baseURL && !body.base_url && !body.api_key && !body.apiKey &&
            !body.plugins,
        );
        return Response.json({
          id: generationId,
          model,
          choices: [{
            message: { role: "assistant", content: "Paid response" },
          }],
          usage: { cost, prompt_tokens: 40, completion_tokens: 20 },
        });
      }
      freeCalls++;
      events.push("free");
      assert(
        body.model === "openrouter/free",
        "Paid requests never fall back directly",
      );
      assert(
        body.provider.max_price.prompt === 0 &&
          body.provider.max_price.completion === 0,
      );
      return Response.json({
        choices: [{ message: { role: "assistant", content: "Free response" } }],
        usage: { cost: 0 },
      });
    }
    if (url === `https://openrouter.ai/api/v1/generation?id=${generationId}`) {
      events.push("receipt");
      assert(
        init?.redirect === "error",
        "Receipt credentials cannot follow redirects",
      );
      assert(
        new Headers(init?.headers).get("Authorization") ===
          "Bearer fixture-direct-key",
        "The receipt is verified directly against Filey's OpenRouter account",
      );
      if (receiptNotFound > 0) {
        receiptNotFound--;
        return Response.json({ error: "Not found yet" }, { status: 404 });
      }
      const data = {
        id: generationId,
        model,
        external_user: requestId,
        is_byok: false,
        total_cost: cost,
        native_tokens_prompt: 40,
        native_tokens_completion: 20,
        ...receiptOverrides,
      };
      if (overflowCost) {
        return new Response(
          JSON.stringify({ data }).replace(
            '"total_cost":0.002',
            '"total_cost":1e999',
          ),
        );
      }
      return Response.json({ data }, { status: receiptStatus });
    }
    if (url === "https://gateway.example/v1/chat/completions") {
      gatewayCalls++;
      events.push("gateway");
      const body = JSON.parse(String(init?.body));
      assert(
        init?.redirect === "error",
        "Gateway credentials cannot follow redirects",
      );
      assert(
        new Headers(init?.headers).get("Authorization") ===
          "Bearer fixture-gateway-key",
      );
      assert(
        body.model === `openrouter/${model}`,
        "Server chooses the gateway provider route",
      );
      assert(
        JSON.stringify(body.tools) === JSON.stringify(functionTools),
        "Function tools survive routing",
      );
      assert(
        body.provider.sort === "price" &&
          body.provider.require_parameters === true,
      );
      assert(
        body.provider.max_price.prompt === 1 &&
          body.provider.max_price.completion === 2,
      );
      assert(body.stream === false && body.max_tokens === 2048);
      assert(
        body.user === requestId,
        "A server request identifier binds the provider receipt",
      );
      assert(
        !body.baseURL && !body.base_url && !body.api_key && !body.apiKey &&
          !body.plugins,
      );
      assert(
        !body.usage && !body.models && !body.route,
        "Untrusted routing and cost fields are removed",
      );
      if (networkFailure) throw new TypeError("Fixture network failure");
      if (invalidJson) return new Response("invalid JSON");
      return Response.json({
        id: missingId ? undefined : generationId,
        model: `openrouter/${model}`,
        ...(providerError
          ? { error: { message: "Fixture provider failure" } }
          : {}),
        choices: [{ message: { role: "assistant", content: "Ready" } }],
        usage: {
          cost: gatewayCost,
          prompt_tokens: 99999,
          completion_tokens: 99999,
        },
      }, { status: upstreamStatus, headers: { "x-omniroute-cost": "999" } });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  try {
    const { handleRequest } = await import("../ai-credits/index.ts");
    const request = (
      overrides: Record<string, unknown> = {},
      funding = "credits",
    ) => {
      events = [];
      walletCalls = [];
      requestId = crypto.randomUUID();
      return handleRequest(
        new Request("https://fixture/ai-credits", {
          method: "POST",
          headers: { Authorization: "Bearer fixture-user-token" },
          body: JSON.stringify({
            action: "completion",
            funding,
            request_id: requestId,
            run_id: crypto.randomUUID(),
            request: {
              model,
              messages: [{ role: "user", content: "List my invoices" }],
              tools: functionTools,
              provider: {
                only: ["attacker"],
                max_price: { prompt: 99999, completion: 99999 },
              },
              baseURL: "https://attacker.example/v1",
              base_url: "https://attacker.example/v1",
              api_key: "attacker-key",
              apiKey: "attacker-key",
              models: ["attacker/model"],
              plugins: [{ id: "web" }],
              route: "fallback",
              usage: { cost: 999 },
              user: "attacker-request-id",
              ...overrides,
            },
          }),
        }),
      );
    };

    authenticated = false;
    assert((await request()).status === 401 && events.length === 0);
    authenticated = true;
    verified = false;
    assert((await request()).status === 403 && events.length === 0);
    verified = true;
    for (
      const id of [
        "attacker/model",
        `openrouter/${model}`,
        "https://attacker.example/model",
      ]
    ) {
      assert(
        (await request({ model: id })).status === 400 && events.length === 0,
      );
    }
    assert((await request({}, "free")).status === 400 && events.length === 0);
    assert(gatewayCalls === 0 && freeCalls === 0);

    reserveAllowed = false;
    assert((await request()).status === 402 && events.join() === "reserve");
    assert(
      gatewayCalls === 0,
      "No upstream call before successfully reserving funds",
    );
    reserveAllowed = true;
    const success = await request();
    const result = await success.json();
    assert(success.status === 200 && result.charged_micros === 2000);
    assert(
      result.completion.model === model,
      "Response preserves the user's explicit model choice",
    );
    assert(events.join() === "reserve,gateway,receipt,settle");
    const reserve = walletCalls[0].args;
    const settlement = walletCalls[1].args;
    assert(reserve.model === model && Number(reserve.amount_micros) >= 2000);
    assert(
      reserve.markup_bps === 0 && settlement.request_id === reserve.request_id,
    );
    assert(
      settlement.charged_micros === 2000 &&
        settlement.provider_cost_micros === 2000,
    );
    assert(settlement.provider_id === generationId);
    assert(settlement.input_tokens === 40 && settlement.output_tokens === 20);
    const serialized = JSON.stringify(result);
    assert(
      !serialized.includes("fixture-gateway-key") &&
        !serialized.includes("fixture-direct-key"),
    );

    assert(
      (await request({ model: "filey-ai" })).status === 400 &&
        events.length === 0,
      "Legacy automatic aliases require an explicit model choice",
    );
    assert(
      (await request({ model: "filey-ai" }, "free")).status === 400 &&
        events.length === 0,
    );

    gatewayCost = 999;
    const untrustedCost = await request();
    assert(
      untrustedCost.status === 200 &&
        (await untrustedCost.json()).charged_micros === 2000,
    );
    assert(
      events.join() === "reserve,gateway,receipt,settle",
      "Gateway estimates cannot set the charge",
    );
    gatewayCost = undefined;

    for (const invalidCost of [undefined, null, "0.002", -0.1, 1001]) {
      cost = invalidCost;
      const callsBefore: number = gatewayCalls;
      assert((await request()).status === 503);
      assert(
        events.join() === "reserve,gateway,receipt,release",
        "Invalid cost releases the hold without charging",
      );
      assert(
        gatewayCalls === callsBefore + 1 && freeCalls === 0,
        "No retry or paid fallback",
      );
    }
    cost = 0.002;
    overflowCost = true;
    assert(
      (await request()).status === 503 &&
        events.join() === "reserve,gateway,receipt,release",
    );
    overflowCost = false;
    for (
      const invalidReceipt of [
        { id: undefined },
        { id: "gen-other" },
        { model: undefined },
        { model: "attacker/model" },
        { external_user: undefined },
        { external_user: "replayed-request" },
        { is_byok: undefined },
        { is_byok: true },
      ]
    ) {
      receiptOverrides = invalidReceipt;
      assert(
        (await request()).status === 503 &&
          events.join() === "reserve,gateway,receipt,release",
      );
    }
    receiptOverrides = {};
    receiptStatus = 500;
    assert(
      (await request()).status === 503 &&
        events.join() === "reserve,gateway,receipt,release",
    );
    receiptStatus = 200;
    receiptNotFound = 2;
    const eventual = await request();
    assert(
      eventual.status === 200 &&
        events.join() === "reserve,gateway,receipt,receipt,receipt,settle",
    );
    receiptNotFound = 4;
    assert(
      (await request()).status === 503 &&
        events.join() === "reserve,gateway,receipt,receipt,receipt,release",
    );
    receiptNotFound = 0;
    providerError = true;
    assert(
      (await request()).status === 503 &&
        events.join() === "reserve,gateway,release",
    );
    providerError = false;
    missingId = true;
    assert(
      (await request()).status === 503 &&
        events.join() === "reserve,gateway,release",
    );
    missingId = false;
    invalidJson = true;
    assert(
      (await request()).status === 503 &&
        events.join() === "reserve,gateway,release",
    );
    invalidJson = false;
    networkFailure = true;
    assert(
      (await request()).status === 503 &&
        events.join() === "reserve,gateway,release",
    );
    networkFailure = false;
    for (const status of [429, 500]) {
      upstreamStatus = status;
      const callsBefore: number = gatewayCalls;
      assert((await request()).status === (status === 429 ? 429 : 502));
      assert(events.join() === "reserve,gateway,release");
      assert(gatewayCalls === callsBefore + 1 && freeCalls === 0);
    }
    upstreamStatus = 200;
    cost = 0;
    const zero = await request();
    assert(zero.status === 200 && (await zero.json()).charged_micros === 0);
    assert(
      events.join() === "reserve,gateway,receipt,settle",
      "A verified zero-cost response is allowed",
    );

    Deno.env.set("FILEY_AI_GATEWAY", "openrouter");
    cost = 0.002;
    const direct = await request();
    const directResult = await direct.json();
    assert(direct.status === 200 && directResult.completion.model === model);
    assert(
      directResult.charged_micros === 2000,
      "A legacy markup setting cannot increase direct usage charges",
    );
    assert(events.join() === "reserve,direct,settle" && directPaidCalls === 1);
    assert(
      walletCalls[0].args.markup_bps === 0 &&
        walletCalls[1].args.provider_cost_micros === 2000,
    );
    cost = -0.1;
    assert(
      (await request()).status === 503 &&
        events.join() === "reserve,direct,release",
    );
    assert(
      Number(directPaidCalls) === 2,
      "Invalid paid usage never retries inference",
    );
    Deno.env.set("FILEY_AI_GATEWAY", "omniroute");

    const callsBefore: number = gatewayCalls;
    const free = await request({ model: "openrouter/free" }, "free");
    assert(free.status === 200 && (await free.json()).charged_micros === 0);
    assert(events.join() === "free" && walletCalls.length === 0);
    assert(gatewayCalls === callsBefore && Number(freeCalls) === 1);
  } finally {
    globalThis.fetch = originalFetch;
    previous.forEach(([name, value]) =>
      value === undefined ? Deno.env.delete(name!) : Deno.env.set(name!, value)
    );
  }
});

Deno.test("OmniRoute configuration fails closed while free routing stays independent", async () => {
  const env = {
    FILEY_AI_GATEWAY: "omniroute",
    FILEY_AI_OMNIROUTE_URL: "https://gateway.example/v1",
    FILEY_AI_OMNIROUTE_KEY: "fixture-gateway-key",
    FILEY_AI_OPENROUTER_KEY: "fixture-receipt-key",
  };
  const previous = Object.keys(env).map((name) => [name, Deno.env.get(name)]);
  Object.entries(env).forEach(([name, value]) => Deno.env.set(name, value));
  try {
    const { creditGateway } = await import("./ai-credit-gateway.ts");
    assert(
      creditGateway()?.url === "https://gateway.example/v1/chat/completions",
    );
    for (
      const invalidUrl of [
        "",
        "http://gateway.example/v1",
        "https://user:password@gateway.example/v1",
        "https://127.0.0.1/v1",
        "https://gateway.local/v1",
        "https://gateway.example:9443/v1",
        "https://gateway.example/v1?key=client",
        "https://gateway.example/v1#fragment",
        "https://gateway.example/v2",
        "https://gateway.example/proxy/v1",
      ]
    ) {
      Deno.env.set("FILEY_AI_OMNIROUTE_URL", invalidUrl);
      assert(
        creditGateway() === null,
        `Invalid paid gateway must not fall back: ${invalidUrl}`,
      );
      assert(
        creditGateway(true)?.kind === "openrouter",
        "Free routing is independent of paid configuration",
      );
    }
    Deno.env.set("FILEY_AI_OMNIROUTE_URL", env.FILEY_AI_OMNIROUTE_URL);
    Deno.env.delete("FILEY_AI_OMNIROUTE_KEY");
    assert(
      creditGateway() === null && creditGateway(true)?.kind === "openrouter",
    );
    Deno.env.set("FILEY_AI_OMNIROUTE_KEY", "   ");
    assert(creditGateway() === null);
    Deno.env.set("FILEY_AI_OMNIROUTE_KEY", env.FILEY_AI_OMNIROUTE_KEY);
    Deno.env.set("FILEY_AI_GATEWAY", "omnirout");
    assert(
      creditGateway() === null && creditGateway(true)?.kind === "openrouter",
    );
    Deno.env.set("FILEY_AI_GATEWAY", env.FILEY_AI_GATEWAY);
    Deno.env.delete("FILEY_AI_OPENROUTER_KEY");
    assert(
      creditGateway() === null && creditGateway(true) === null,
      "Paid billing requires a receipt-verification key",
    );
    Deno.env.set("FILEY_AI_OPENROUTER_KEY", "   ");
    assert(creditGateway() === null);
    Deno.env.set("FILEY_AI_OPENROUTER_KEY", env.FILEY_AI_OPENROUTER_KEY);
    Deno.env.delete("FILEY_AI_GATEWAY");
    assert(
      creditGateway()?.kind === "openrouter",
      "Existing explicitly unconfigured installations keep direct routing",
    );
  } finally {
    previous.forEach(([name, value]) =>
      value === undefined ? Deno.env.delete(name!) : Deno.env.set(name!, value)
    );
  }
});
