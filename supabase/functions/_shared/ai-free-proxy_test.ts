function assert(ok: unknown, message = "Assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}

Deno.test(
  "free proxy authenticates, enforces quota and never calls the wallet or paid fallback",
  async () => {
    const names = [
      "FILEY_AI_OPENROUTER_KEY",
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
    ];
    const previous = names.map((name) => Deno.env.get(name));
    Deno.env.set(names[0], "fixture-not-a-real-key");
    Deno.env.set(names[1], "https://fixture.supabase.co");
    Deno.env.set(names[2], "fixture-service-key");
    const originalFetch = globalThis.fetch;
    let allowed = true,
      authenticated = true,
      upstreamStatus = 200,
      cost = 0,
      calls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/auth/v1/user"))
        return Response.json(
          authenticated
            ? {
                id: "30000000-0000-4000-8000-000000000001",
                email_confirmed_at: "2026-09-21",
              }
            : { message: "Invalid token" },
          { status: authenticated ? 200 : 401 }
        );
      if (url.endsWith("/api/v1/models"))
        return Response.json({
          data: [
            {
              id: "openrouter/free",
              name: "Free",
              supported_parameters: ["tools"],
              context_length: 32768,
              pricing: { prompt: "0", completion: "0" },
            },
            {
              id: "openai/gpt-4.1-mini",
              name: "Paid",
              supported_parameters: ["tools"],
              context_length: 32768,
              pricing: { prompt: "0.000001", completion: "0.000002" },
            },
          ],
        });
      if (url.endsWith("/rpc/filey_take_rate_limit")) return Response.json(allowed);
      if (url.endsWith("/api/v1/chat/completions")) {
        calls++;
        const body = JSON.parse(String(init?.body));
        assert(
          body.model === "openrouter/free" &&
            body.provider.max_price.prompt === 0 &&
            body.provider.max_price.completion === 0 &&
            !body.plugins
        );
        return Response.json(
          {
            choices: [{ message: { role: "assistant", content: "Ready" } }],
            usage: { cost },
          },
          { status: upstreamStatus }
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;
    try {
      const { handleRequest } = await import("../ai-credits/index.ts");
      const request = (funding = "free", model = "openrouter/free") =>
        handleRequest(
          new Request("https://fixture/ai-credits", {
            method: "POST",
            headers: { Authorization: "Bearer fixture" },
            body: JSON.stringify({
              action: "completion",
              funding,
              request_id: crypto.randomUUID(),
              run_id: crypto.randomUUID(),
              request: { model, messages: [{ role: "user", content: "Ready?" }] },
            }),
          })
        );
      const result = await request();
      const body = await result.json();
      assert(
        result.status === 200 && body.charged_micros === 0 && !body.account && calls === 1
      );
      assert((await request("free", "openai/gpt-4.1-mini")).status === 400);
      assert((await request("credits")).status === 400);
      assert(calls === 1, "Changing funding or model cannot start a paid call");
      allowed = false;
      assert((await request()).status === 429 && calls === 1);
      allowed = true;
      upstreamStatus = 429;
      assert(
        (await request()).status === 429 && Number(calls) === 2,
        "No automatic retry"
      );
      upstreamStatus = 200;
      cost = 0.1;
      assert(
        (await request()).status === 503,
        "Unexpected paid usage is never passed to the wallet"
      );
      authenticated = false;
      assert((await request()).status === 401 && Number(calls) === 3);
    } finally {
      globalThis.fetch = originalFetch;
      names.forEach((name, i) =>
        previous[i] === undefined
          ? Deno.env.delete(name)
          : Deno.env.set(name, previous[i]!)
      );
    }
  }
);
