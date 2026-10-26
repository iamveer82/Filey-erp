// Synthetic requests only; every auth/database/provider fetch is intercepted.
// deno-lint-ignore-file require-await
import { fixtureJwt } from "./test-auth-fixture.ts";

function assert(ok: unknown, message = "Assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}
const userId = "30000000-0000-4000-8000-000000000001";
// The Dodo SDK captures fetch when constructed; keep its test dispatcher stable
// while each test installs an isolated synthetic provider implementation.
let billingFetchFixture: typeof fetch;

Deno.test("billing rejects malformed and oversized action/webhook requests before side effects", async () => {
  const originalEnv = Deno.env.get;
  const originalFetch = globalThis.fetch;
  Deno.env.get = (name) => ({
    SUPABASE_URL: "https://fixture.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key",
    DODO_PAYMENTS_API_KEY: "fixture-payment-key",
    DODO_PAYMENTS_WEBHOOK_KEY: "whsec_Zml4dHVyZS13ZWJob29rLWtleQ==",
    DODO_PRODUCT_CLOUD: "pdt_cloud",
    FILEY_AI_DEEPSEEK_KEY: "fixture-model-key",
    DODO_AI_CREDIT_PACKS: '[{"id":"pdt_fixture","cents":500}]',
  })[name];
  let calls = 0;
  billingFetchFixture = (async () => { calls++; throw new Error("Unexpected external call"); }) as typeof fetch;
  globalThis.fetch = (...args) => billingFetchFixture(...args);
  try {
    const { handleRequest } = await import("../dodo/index.ts");
    for (const body of ["null", "[]", "false", '"value"', "{", '{"action":{}}']) {
      const response = await handleRequest(new Request("https://fixture/dodo", { method: "POST", body }));
      assert(response.status === 400, `Malformed body must fail closed: ${body}`);
    }
    for (const headers of [new Headers(), new Headers({ "content-length": "1" }), new Headers({ "content-length": "20000" })]) {
      const body = JSON.stringify({ action: "license_status", extra: "a".repeat(20_000) });
      const response = await handleRequest(new Request("https://fixture/dodo", { method: "POST", headers, body }));
      assert(response.status === 413, "Byte bounds must not rely on a truthful Content-Length");
    }
    let cancelled = false;
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(4_096));
      },
      cancel() { cancelled = true; },
    });
    const streamed = await handleRequest(new Request("https://fixture/dodo", { method: "POST", body: stream }));
    assert(streamed.status === 413 && cancelled && pulls <= 6,
      "Oversized chunked uploads must be cancelled without buffering the remainder");
    const webhook = await handleRequest(new Request("https://fixture/dodo", {
      method: "POST", headers: { "webhook-signature": "v1,fixture" }, body: "a".repeat(1_000_001),
    }));
    assert(webhook.status === 413, "Unsigned oversized webhook data cannot be buffered indefinitely");
    const invalidSignature = await handleRequest(new Request("https://fixture/dodo", {
      method: "POST", headers: { "webhook-signature": "v1,invalid" }, body: "{}",
    }));
    assert(invalidSignature.status === 401 &&
      JSON.stringify(await invalidSignature.json()) === '{"error":"Invalid webhook signature."}',
      "Signature errors must not expose verifier internals");
    const raw = JSON.stringify({ type: "payment.failed", timestamp: new Date().toISOString(),
      data: { payment_id: "pay_fixture", customer: { name: "Référence" } } });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signingKey = await crypto.subtle.importKey("raw", new TextEncoder().encode("fixture-webhook-key"),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signatureBytes = new Uint8Array(await crypto.subtle.sign("HMAC", signingKey,
      new TextEncoder().encode(`msg_fixture.${timestamp}.${raw}`)));
    const signed = await handleRequest(new Request("https://fixture/dodo", {
      method: "POST", headers: { "webhook-id": "msg_fixture", "webhook-timestamp": timestamp,
        "webhook-signature": `v1,${btoa(String.fromCharCode(...signatureBytes))}` }, body: raw,
    }));
    assert(signed.status === 200 && (await signed.json()).ignored === "payment.failed",
      "Bounded reading must preserve verified UTF-8 webhook delivery");
    assert(calls === 0, "Rejected bodies/signatures cannot call auth, database or checkout providers");
  } finally {
    Deno.env.get = originalEnv;
    globalThis.fetch = originalFetch;
  }
});

Deno.test("billing redacts provider/database failures and binds credit checkout to the verified account", async () => {
  const originalEnv = Deno.env.get;
  const originalFetch = globalThis.fetch;
  Deno.env.get = (name) => ({
    SUPABASE_URL: "https://fixture.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key",
    DODO_PAYMENTS_API_KEY: "fixture-payment-key",
    DODO_PAYMENTS_WEBHOOK_KEY: "whsec_Zml4dHVyZS13ZWJob29rLWtleQ==",
    DODO_PRODUCT_CLOUD: "pdt_cloud",
    FILEY_AI_DEEPSEEK_KEY: "fixture-model-key",
    DODO_AI_CREDIT_PACKS: '[{"id":"pdt_fixture","cents":500}]',
  })[name];
  let failure: "provider" | "database" | "none" = "provider";
  let orders = 0, checkouts = 0;
  let savedOrderId = "";
  const fixtureUrls: string[] = [];
  const secret = "fixture-private-key-and-customer-address";
  billingFetchFixture = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    fixtureUrls.push(url);
    const requestBody = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
    if (url.endsWith("/auth/v1/user")) return Response.json({
      id: userId, email: "fixture@example.test", email_confirmed_at: "2026-10-03", factors: [],
    });
    if (url.endsWith("/rpc/filey_take_rate_limit")) return Response.json(true);
    if (url.endsWith("/rest/v1/audit_log")) return Response.json(null, { status: 201 });
    if (url.includes("/rest/v1/profiles?")) return Response.json({ message: secret }, { status: 400 });
    if (url.includes("/products/pdt_fixture")) return failure === "provider"
      ? Response.json({ message: secret }, { status: 400 })
      : Response.json({ price: { type: "one_time_price", currency: "USD", price: 550 }, is_recurring: false });
    if (url.endsWith("/rest/v1/ai_credit_orders")) {
      if (failure === "database") return Response.json({ message: secret }, { status: 400 });
      const order = JSON.parse(String(requestBody));
      assert(order.user_id === userId && order.credits_micros === 5_000_000,
        "Forged caller owner/amount must not determine a Coin order");
      savedOrderId = order.id;
      orders++;
      return Response.json(null, { status: 201 });
    }
    if (url.endsWith("/checkouts")) {
      const checkout = JSON.parse(String(requestBody));
      assert(checkout.metadata.user_id === userId && checkout.metadata.type === "ai_credits");
      assert(checkout.metadata.credit_order === savedOrderId);
      for (const field of ["return_url", "cancel_url"]) {
        const query = new URLSearchParams(new URL(checkout[field]).hash.split("?")[1]);
        assert(query.get("credit_order") === savedOrderId,
          "A checkout return cannot confirm another Coin order");
      }
      checkouts++;
      return Response.json({ checkout_url: "https://checkout.dodopayments.com/fixture", session_id: "session_fixture" });
    }
    throw new Error(`Unexpected fixture URL: ${url}`);
  }) as typeof fetch;
  globalThis.fetch = (...args) => billingFetchFixture(...args);
  try {
    const { handleRequest } = await import("../dodo/index.ts");
    const request = (body: Record<string, unknown>) => handleRequest(new Request("https://fixture/dodo", {
      method: "POST", headers: { Authorization: `Bearer ${fixtureJwt(userId)}` }, body: JSON.stringify(body),
    }));
    const payload = { action: "checkout_ai_credits", pack_id: "pdt_fixture", expected_org_id: "old-workspace",
      user_id: "30000000-0000-4000-8000-000000000002", credits_micros: 100_000_000 };
    for (const kind of ["provider", "database"] as const) {
      failure = kind;
      const response = await request(payload);
      const body = await response.text();
      assert(response.status === 503 && !body.includes(secret) && body.includes("Billing is temporarily unavailable"),
        `${kind} failures cannot expose private details in public responses`);
    }
    const orgFailure = await request({ action: "portal" });
    assert(orgFailure.status === 503 && !(await orgFailure.text()).includes(secret));
    failure = "none";
    const success = await request(payload);
    assert(success.status === 200 && orders === 1 && checkouts === 1,
      `A valid checkout still opens after verified account/order binding; status ${success.status}, orders ${orders}, checkouts ${checkouts}; ${fixtureUrls.join(", ")}`);
    const successfulCheckout = await success.json();
    assert(successfulCheckout.order_id === savedOrderId && savedOrderId.length === 36 &&
      successfulCheckout.session_id === "session_fixture" &&
      successfulCheckout.url === "https://checkout.dodopayments.com/fixture",
      "The actual billing endpoint must return the persisted order identity for exact confirmation");
    const invalidChoice = await request({ action: "checkout_ai_credits", pack_id: "pdt_other" });
    assert(invalidChoice.status === 400 &&
      (await invalidChoice.json()).error === "Choose an available AI credit pack.",
      "First-party validation remains actionable without raw provider errors");
  } finally {
    Deno.env.get = originalEnv;
    globalThis.fetch = originalFetch;
  }
});

Deno.test("workspace billing rejects stale or malformed workspace intent before provider calls", async () => {
  const originalEnv = Deno.env.get;
  const originalFetch = globalThis.fetch;
  Deno.env.get = (name) => ({
    SUPABASE_URL: "https://fixture.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key",
    DODO_PAYMENTS_API_KEY: "fixture-payment-key",
    DODO_PAYMENTS_WEBHOOK_KEY: "whsec_Zml4dHVyZS13ZWJob29rLWtleQ==",
    DODO_PRODUCT_CLOUD: "pdt_cloud",
  })[name];
  let profileReads = 0, externalCalls = 0;
  billingFetchFixture = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/auth/v1/user")) return Response.json({ id: userId, factors: [] });
    if (url.endsWith("/rpc/filey_take_rate_limit")) return Response.json(true);
    if (url.endsWith("/rest/v1/audit_log")) return Response.json(null, { status: 201 });
    if (url.includes("/rest/v1/profiles?")) {
      profileReads++;
      return Response.json({ org_id: "workspace-current" });
    }
    externalCalls++;
    throw new Error("A stale billing action reached a provider or workspace table");
  }) as typeof fetch;
  globalThis.fetch = (...args) => billingFetchFixture(...args);
  try {
    const { handleRequest } = await import("../dodo/index.ts");
    const send = (action: string, expectedOrg: unknown) => handleRequest(new Request("https://fixture/dodo", {
      method: "POST", headers: { Authorization: `Bearer ${fixtureJwt(userId)}` },
      body: JSON.stringify({ action, expected_org_id: expectedOrg }),
    }));
    for (const action of ["checkout_cloud", "portal", "request_subscription_refund", "subscription_refunds"]) {
      const response = await send(action, "workspace-reviewed");
      assert(response.status === 409 &&
        (await response.json()).error === "Workspace changed. Reopen Billing before continuing.",
        "A reviewed action cannot move into a newly selected workspace");
    }
    const beforeMalformed = profileReads;
    for (const invalid of [null, "", {}, "a".repeat(201)]) {
      assert((await send("portal", invalid)).status === 409);
    }
    assert(profileReads === beforeMalformed && externalCalls === 0,
      "Malformed/stale workspace intent must stop before provider or organization access");
  } finally {
    Deno.env.get = originalEnv;
    globalThis.fetch = originalFetch;
  }
});

Deno.test("billing's real SDK route saves and resumes one selected-customer promotion without a paid fallback", async () => {
  const originalEnv = Deno.env.get, originalFetch = globalThis.fetch;
  const promotion = { id: "70000000-0000-4000-8000-000000000001", user_id: userId, email: "fixture@example.test",
    customer_id: "cus_fixture", discount_id: "dsc_fixture", discount_code: "FIXTURETEST", product_id: "pdt_fixture",
    cents: 500, expires_at: new Date(Date.now() + 3_600_000).toISOString() };
  Deno.env.get = (name) => ({ SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key",
    DODO_PAYMENTS_API_KEY: "fixture-payment-key", DODO_PAYMENTS_WEBHOOK_KEY: "fixture-webhook-key",
    FILEY_AI_DEEPSEEK_KEY: "fixture-model-key", DODO_AI_CREDIT_PACKS: '[{"id":"pdt_fixture","cents":500}]',
    FILEY_AI_TEST_PROMOTION: JSON.stringify(promotion) })[name];
  let saved: Record<string, unknown> | null = null, checkouts = 0, providerReads = 0;
  billingFetchFixture = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const raw = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
    if (url.pathname === "/auth/v1/user") return Response.json({ id: userId, email: promotion.email, email_confirmed_at: "2026-10-04", factors: [] });
    if (url.pathname === "/rest/v1/rpc/filey_take_rate_limit") return Response.json(true);
    if (url.pathname === "/rest/v1/audit_log") return Response.json(null, { status: 201 });
    if (url.pathname === "/rest/v1/ai_credit_orders") {
      if (method === "GET") return Response.json(saved ? [saved] : []);
      if (method === "POST") { saved = { payment_id: null, paid_cents: null, refunded_micros: 0, disputed: false,
          checkout_session_id: null, checkout_url: null, ...JSON.parse(String(raw)) };
        assert(saved?.user_id === userId && saved?.promotion_id === promotion.id && saved?.expected_paid_cents === 0);
        return Response.json(null, { status: 201 }); }
      if (method === "PATCH") { assert(saved && url.searchParams.get("id") === `eq.${saved.id}` && url.searchParams.get("user_id") === `eq.${userId}` &&
        url.searchParams.get("payment_id") === "is.null" && url.searchParams.get("checkout_session_id") === "is.null" &&
        url.searchParams.get("checkout_url") === "is.null" && url.searchParams.get("promotion_customer_id") === `eq.${promotion.customer_id}`);
        Object.assign(saved, JSON.parse(String(raw))); return Response.json({ id: saved.id }); }
    }
    if (url.pathname === "/products/pdt_fixture") { providerReads++; return Response.json({ price: { type: "one_time_price", currency: "USD", price: 550 }, is_recurring: false }); }
    if (url.pathname === "/discounts/dsc_fixture") { providerReads++; return Response.json({ ...promotion, discount_id: promotion.discount_id,
      code: promotion.discount_code, type: "percentage", amount: 10000, customer_eligibility: "specific", restricted_to: [promotion.product_id],
      usage_limit: 1, per_customer_usage_limit: 1, times_used: 0, currency_options: [], business_id: "bsn_fixture" }); }
    if (url.pathname === "/customers/cus_fixture") { providerReads++; return Response.json({ customer_id: promotion.customer_id, email: promotion.email, business_id: "bsn_fixture" }); }
    if (url.pathname === "/discounts/dsc_fixture/customers") { providerReads++; assert(url.searchParams.get("page_size") === "100");
      return Response.json({ items: url.searchParams.get("page_number") === "0" ? [{ customer_id: promotion.customer_id }] : [] }); }
    if (url.pathname === "/checkouts") { checkouts++; const body = JSON.parse(String(raw));
      // Regression for the actual provider's 422 response to the former
      // contradictory preapplied-coupon/disabled-coupon checkout payload.
      if (body.discount_codes?.length && body.feature_flags?.allow_discount_code === false)
        return Response.json({ code: "INVALID_REQUEST_PARAMETERS",
          message: "Discount code is not allowed if allow_discount_code is false" }, { status: 422 });
      assert(JSON.stringify(body.discount_codes) === JSON.stringify([promotion.discount_code]) && body.customer.customer_id === promotion.customer_id &&
        body.feature_flags.allow_discount_code === true && body.feature_flags.allow_customer_editing_email === false && body.metadata.promotion_id === promotion.id);
      return Response.json({ checkout_url: "https://checkout.dodopayments.com/fixture", session_id: "session_promotion" }); }
    throw new Error(`Unexpected synthetic billing operation: ${url.href}`);
  }) as typeof fetch;
  globalThis.fetch = (...args) => billingFetchFixture(...args);
  try {
    const { handleRequest } = await import("../dodo/index.ts");
    const request = () => handleRequest(new Request("https://fixture/dodo", { method: "POST",
      headers: { Authorization: `Bearer ${fixtureJwt(userId)}` },
      body: JSON.stringify({ action: "checkout_ai_credits", pack_id: "pdt_fixture", promotion_id: promotion.id }) }));
    const first = await request(), result = await first.json();
    assert(first.status === 200 && result.order_id === (saved as Record<string, unknown> | null)?.id && checkouts === 1 && providerReads === 5);
    const resumed = await request(); assert(resumed.status === 200 && JSON.stringify(await resumed.json()) === JSON.stringify(result) &&
      checkouts === 1 && providerReads === 5);
    (saved as Record<string, unknown> | null)!.checkout_session_id = null;
    const unknown = await request(); assert(unknown.status === 400 &&
      (await unknown.json()).error === "This Coin promotion has already been opened. Complete your original checkout." && checkouts === 1 && providerReads === 5);
  } finally { Deno.env.get = originalEnv; globalThis.fetch = originalFetch; }
});

Deno.test("rotating public checkout addresses cannot bypass a shared provider ceiling and per-address limits remain", async () => {
  const originalEnv = Deno.env.get, originalFetch = globalThis.fetch;
  Deno.env.get = (name) => ({ SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key", DODO_PAYMENTS_API_KEY: "fixture-payment-key", DODO_PAYMENTS_WEBHOOK_KEY: "whsec_Zml4dHVyZS13ZWJob29rLWtleQ==", DODO_PRODUCT_CLOUD: "pdt_cloud" })[name];
  const counts = new Map<string, number>();
  let checkouts = 0, emailReservations = 0;
  billingFetchFixture = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname.endsWith("/filey_take_rate_limit")) {
      const args = await request.json();
      const key = `${args.p_subject}:${args.p_action}`;
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      if (args.p_action === "dodo_public_checkout_global") assert(args.p_subject === "public:checkout" && args.p_limit === 100);
      else { emailReservations++; assert(args.p_limit === 5); }
      return Response.json(n <= args.p_limit);
    }
    if (url.pathname.endsWith("/checkouts")) {
      const body = await request.json();
      assert(body.metadata.type === "cloud_subscription" && body.product_cart[0].product_id === "pdt_cloud");
      checkouts++;
      return Response.json({ checkout_url: "https://checkout.dodopayments.com/fixture", session_id: "session_fixture" });
    }
    throw new Error("Unexpected auth/storage/provider route");
  }) as typeof fetch;
  globalThis.fetch = (...args) => billingFetchFixture(...args);
  try {
    const { handleRequest } = await import("../dodo/index.ts");
    const call = (email: string) => handleRequest(new Request("https://fixture/dodo", { method: "POST", body: JSON.stringify({ action: "public_checkout", plan: "cloud", email }) }));
    for (let n = 0; n < 6; n++) assert((await call("one@example.test")).status === (n < 5 ? 200 : 429));
    for (let n = 0; n < 94; n++) assert((await call(`rotated-${n}@example.test`)).status === 200);
    const before = emailReservations;
    for (let n = 0; n < 5; n++) assert((await call(`extra-${n}@example.test`)).status === 429);
    assert(checkouts === 99 && emailReservations === before, "Shared denial prevents checkout creation and further attacker-controlled rate subjects");
  } finally {
    Deno.env.get = originalEnv;
    globalThis.fetch = originalFetch;
  }
});
