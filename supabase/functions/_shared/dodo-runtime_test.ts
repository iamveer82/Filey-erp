import DodoPayments from "npm:dodopayments@2.50.0";

function assert(ok: unknown, message = "Assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}

// Real SDK serialization and parsing, with every HTTP operation intercepted.
// This validates the package used by the deployed handler, not a mock SDK.
const checkout = {
  product_cart: [{ product_id: "pdt_runtime_fixture", quantity: 1 }],
  customer: { customer_id: "cus_runtime_fixture" },
  billing_currency: "USD" as const,
  discount_codes: ["RUNTIMEFIXTURE100"],
  feature_flags: {
    allow_discount_code: true,
    allow_currency_selection: false,
    allow_customer_editing_email: false,
    always_create_new_customer: false,
  },
  metadata: {
    type: "ai_credits",
    credit_order: "80000000-0000-4000-8000-000000000001",
    user_id: "80000000-0000-4000-8000-000000000002",
    promotion_id: "80000000-0000-4000-8000-000000000003",
  },
  return_url: "https://app.example.test/?credit_order=80000000-0000-4000-8000-000000000001",
  cancel_url: "https://app.example.test/?credit_checkout=cancelled",
};

Deno.test("native npm Dodo SDK sends the exact hosted promotion checkout and parses a checkout link", async () => {
  let calls = 0;
  const client = new DodoPayments({
    bearerToken: "fixture-payment-key",
    environment: "live_mode",
    fetch: async (input, init) => {
      calls++;
      const request = new Request(input, init);
      assert(request.url === "https://live.dodopayments.com/checkouts" && request.method === "POST");
      assert(request.headers.get("authorization") === "Bearer fixture-payment-key");
      assert(request.headers.get("content-type")?.includes("application/json"));
      const body = await request.json();
      if (body.discount_codes?.length && body.feature_flags?.allow_discount_code === false)
        return Response.json({ code: "INVALID_REQUEST_PARAMETERS",
          message: "Discount code is not allowed if allow_discount_code is false" }, { status: 422 });
      assert(JSON.stringify(body) === JSON.stringify(checkout), "SDK must preserve private customer, coupon, cart and order binding");
      assert(!("confirm" in body) && !("payment_method_id" in body) && !("return_checkout_url" in body));
      return Response.json({ session_id: "session_runtime_fixture", checkout_url: "https://checkout.dodopayments.com/runtime-fixture" });
    },
  });
  const result = await client.checkoutSessions.create(checkout, { maxRetries: 0, timeout: 15_000 });
  assert(calls === 1 && result.session_id === "session_runtime_fixture" && result.checkout_url === "https://checkout.dodopayments.com/runtime-fixture");
});

Deno.test("Dodo's observed preapplied-discount constraint rejects the former contradictory checkout flags", async () => {
  let calls = 0;
  const client = new DodoPayments({
    bearerToken: "fixture-payment-key", environment: "test_mode",
    fetch: async (input, init) => {
      calls++;
      const body = await new Request(input, init).json();
      if (body.discount_codes?.length && body.feature_flags?.allow_discount_code === false)
        return Response.json({ code: "INVALID_REQUEST_PARAMETERS",
          message: "Discount code is not allowed if allow_discount_code is false" }, { status: 422 });
      return Response.json({ session_id: "session_runtime_fixture", checkout_url: "https://checkout.dodopayments.com/runtime-fixture" });
    },
  });
  let error: unknown;
  try { await client.checkoutSessions.create({ ...checkout, feature_flags: { ...checkout.feature_flags, allow_discount_code: false } }, { maxRetries: 0 }); }
  catch (caught) { error = caught; }
  assert(error instanceof DodoPayments.APIError && error.status === 422 && calls === 1);
  const allowed = await client.checkoutSessions.create(checkout, { maxRetries: 0 });
  assert(Number(calls) === 2 && allowed.session_id === "session_runtime_fixture");
});

Deno.test("native npm Dodo SDK previews a zero-total discount without creating a session", async () => {
  let calls = 0;
  const client = new DodoPayments({
    bearerToken: "fixture-payment-key",
    environment: "test_mode",
    fetch: async (input, init) => {
      calls++;
      const request = new Request(input, init);
      assert(request.url === "https://test.dodopayments.com/checkouts/preview" && request.method === "POST");
      const body = await request.json();
      assert(body.customer.customer_id === checkout.customer.customer_id && JSON.stringify(body.discount_codes) === JSON.stringify(checkout.discount_codes));
      return Response.json({ currency: "USD", total_price: 0, total_tax: 0, total_discount: 550 });
    },
  });
  const preview = await client.checkoutSessions.preview(checkout, { maxRetries: 0 });
  assert(calls === 1 && preview.total_price === 0 && preview.currency === "USD");
});

Deno.test("native npm Dodo SDK exposes definitive rejection and never retries an uncertain promotion POST", async () => {
  for (const status of [400, 503]) {
    let calls = 0;
    const client = new DodoPayments({
      bearerToken: "fixture-payment-key",
      environment: "live_mode",
      fetch: async (input, init) => {
        calls++;
        const request = new Request(input, init);
        assert(new URL(request.url).pathname === "/checkouts" && request.method === "POST");
        return Response.json({ message: "Synthetic provider failure" }, { status });
      },
    });
    let error: unknown;
    try { await client.checkoutSessions.create(checkout, { maxRetries: 0, timeout: 15_000 }); }
    catch (caught) { error = caught; }
    assert(error instanceof DodoPayments.APIError && error.status === status && calls === 1,
      "Unconfirmed provider failures must not issue another coupon checkout");
  }
});
