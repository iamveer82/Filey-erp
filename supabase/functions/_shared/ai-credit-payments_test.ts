import { fixtureJwt } from "./test-auth-fixture.ts";
import { createCreditCheckout, reconcileCreditPayment } from "./ai-credit-payments.ts";
function assert(ok: unknown, message = "Assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}
function fixtureEnvironment() {
  const original = Deno.env.get;
  const values = new Map<string, string>();
  Deno.env.get = (name) => values.get(name);
  return { values, restore: () => { Deno.env.get = original; } };
}
Deno.test("legacy video provider keys cannot enable Coin purchases without managed chat", async () => {
  const { values: env, restore } = fixtureEnvironment();
  env.set("DODO_PAYMENTS_API_KEY", "fixture-payment-key");
  env.set("DODO_PAYMENTS_WEBHOOK_KEY", "fixture-webhook-key");
  env.set("HF_API_KEY_ID", "fixture-video-id");
  env.set("HF_API_KEY_SECRET", "fixture-video-secret");
  let lookups = 0;
  const unexpected = () => { lookups++; throw new Error("Must not create a paid checkout"); };
  const dodo = { products: { retrieve: unexpected }, checkoutSessions: { create: unexpected } } as unknown as Parameters<typeof createCreditCheckout>[0];
  const db = { from: unexpected } as unknown as Parameters<typeof createCreditCheckout>[1];
  const user = { id: "30000000-0000-4000-8000-000000000001", email: "fixture@example.test", email_confirmed_at: "2026-10-03" } as Parameters<typeof createCreditCheckout>[2];
  try {
    for (const custom of [false, true]) {
      let error: unknown;
      try { await createCreditCheckout(dodo, db, user, custom ? undefined : "pdt_fixture", custom ? 1000 : undefined); }
      catch (caught) { error = caught; }
      assert(error instanceof Error && error.message === "Filey-funded AI is not available yet.");
      assert(lookups === 0, "Video-only setup must fail before product, order or payment operations");
    }
  } finally { restore(); }
});
const order = {
  id: "40000000-0000-4000-8000-000000000001",
  user_id: "30000000-0000-4000-8000-000000000001",
  product_id: "pdt_fixture",
  credits_micros: 5000000,
  service_fee_cents: 50,
};
Deno.test("custom checkout fixes the total and records only purchased credit, rejecting invalid choices before payment", async () => {
  const names = ["FILEY_AI_DEEPSEEK_KEY", "DODO_AI_CREDIT_PRODUCT_ID", "DODO_AI_CREDIT_PACKS"];
  const { values: env, restore } = fixtureEnvironment();
  env.set(names[0], "fixture-not-a-real-key");
  env.set(names[1], "pdt_custom");
  env.set(names[2], "[]");
  env.set("DODO_PAYMENTS_API_KEY", "fixture-payment-key");
  env.set("DODO_PAYMENTS_WEBHOOK_KEY", "fixture-webhook-key");
  try {
    let lookups = 0;
    const orders: Record<string, unknown>[] = [];
    const checkouts: Record<string, unknown>[] = [];
    const price = { type: "one_time_price", currency: "USD", price: 550,
      pay_what_you_want: true, discount: 0, discount_bps: 0, purchasing_power_parity: false };
    const product = { price, is_recurring: false };
    const dodo = {
      products: { retrieve: async (id: string) => {
        assert(id === "pdt_custom", "The caller cannot select an arbitrary product");
        lookups++;
        return product;
      } },
      checkoutSessions: { create: async (body: Record<string, unknown>) => {
        checkouts.push(body);
        return { checkout_url: "https://checkout.dodopayments.com/fixture", session_id: "checkout_fixture" };
      } },
    } as unknown as Parameters<typeof createCreditCheckout>[0];
    const db = { from: (table: string) => {
      assert(table === "ai_credit_orders", "Checkout may only record an order, not grant credits");
      return { insert: async (value: Record<string, unknown>) => { orders.push(value); return { error: null }; } };
    } } as unknown as Parameters<typeof createCreditCheckout>[1];
    const user = { id: order.user_id, email: "fixture@example.test", email_confirmed_at: "2026-09-20" } as Parameters<typeof createCreditCheckout>[2];
    const rejected = async (packId: unknown, amount: unknown) => {
      const count = orders.length;
      let failed = false;
      try { await createCreditCheckout(dodo, db, user, packId, amount); } catch { failed = true; }
      assert(failed && orders.length === count && checkouts.length === count,
        "Rejected choices must not create an order or checkout");
    };
    for (const amount of [undefined, null, "1234", true, 0, 499, 500.1, 10001, Infinity])
      await rejected(undefined, amount);
    await rejected("pdt_custom", 1234);
    await rejected("pdt_unconfigured", undefined);
    assert(lookups === 0, "Invalid values are rejected before provider calls");
    for (const amount of [500, 1234, 10000]) {
      const result = await createCreditCheckout(dodo, db, user, undefined, amount);
      const saved = orders.at(-1)!;
      const checkout = checkouts.at(-1)!;
      assert(saved.credits_micros === amount * 10000 && saved.service_fee_cents === 50);
      assert(saved.product_id === "pdt_custom");
      assert(result.order_id === saved.id && result.session_id === "checkout_fixture",
        "Checkout must return the exact saved order identity alongside its session");
      for (const [field, state] of [["return_url", "returned"], ["cancel_url", "cancelled"]]) {
        const returned = new URL(String(checkout[field]));
        const query = new URLSearchParams(returned.hash.split("?")[1]);
        assert(query.get("section") === "credits" && query.get("credit_checkout") === state &&
          query.get("credit_order") === saved.id,
          "Both app return paths must correlate only to this saved order");
      }
      assert(JSON.stringify(checkout.product_cart) === JSON.stringify([
        { product_id: "pdt_custom", quantity: 1, amount: amount + 50 },
      ]), "A PWYW amount must always be fixed server-side, including the fee");
      const metadata = checkout.metadata as Record<string, unknown>;
      assert(metadata.credit_order === saved.id && metadata.user_id === user.id);
      assert(checkout.billing_currency === "USD");
      const flags = checkout.feature_flags as Record<string, unknown>;
      assert(flags.allow_discount_code === false && flags.allow_currency_selection === false);
    }
    for (const patch of [
      { type: "recurring_price" }, { currency: "EUR" }, { price: 500 }, { price: 600 },
      { pay_what_you_want: false }, { discount: 5 }, { discount_bps: 100 }, { purchasing_power_parity: true },
    ]) {
      const original = { ...price };
      Object.assign(price, patch);
      await rejected(undefined, 1234);
      Object.assign(price, original);
    }
    product.is_recurring = true;
    await rejected(undefined, 1234);
    product.is_recurring = false;
    env.delete(names[1]);
    await rejected(undefined, 1234);
  } finally {
    restore();
  }
});

Deno.test("custom credit settlement uses the saved order and rejects an underpaid or substituted purchase", async () => {
  const saved = { ...order, product_id: "pdt_custom", credits_micros: 12340000 };
  const payment = { payment_id: "pay_custom", status: "succeeded", currency: "USD", total_amount: 1283,
    metadata: { type: "ai_credits", credit_order: saved.id, user_id: saved.user_id, amount_cents: "10000" },
    product_cart: [{ product_id: "pdt_custom", quantity: 1 }], refunds: [], disputes: [] };
  const applied: Record<string, unknown>[] = [];
  const dodo = { payments: { retrieve: async () => payment } } as unknown as Parameters<typeof reconcileCreditPayment>[0];
  const db = {
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: saved, error: null }) }) }) }),
    rpc: async (_name: string, args: Record<string, unknown>) => { applied.push(args); return { error: null }; },
  } as unknown as Parameters<typeof reconcileCreditPayment>[1];
  let failed = false;
  try { await reconcileCreditPayment(dodo, db, payment.payment_id); } catch { failed = true; }
  assert(failed && applied.length === 0, "Underpayment cannot grant credits");
  payment.total_amount = 1284;
  payment.product_cart[0].product_id = "pdt_other";
  failed = false;
  try { await reconcileCreditPayment(dodo, db, payment.payment_id); } catch { failed = true; }
  assert(failed && applied.length === 0, "An unrelated product cannot settle this order");
  payment.product_cart[0].product_id = "pdt_custom";
  assert(await reconcileCreditPayment(dodo, db, payment.payment_id));
  assert(Number(applied.length) === 1 && applied[0].p_action === "reconcile_payment");
  assert(JSON.stringify(applied[0].p_args) === JSON.stringify({ order_id: saved.id, payment_id: payment.payment_id, paid_cents: 1284, refunds: [] }),
    "Settlement must not take any credit value from payment metadata");
});

Deno.test("wallet advertises custom amounts only with configured AI and payments", async () => {
  const names = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "FILEY_AI_DEEPSEEK_KEY",
    "HF_API_KEY_ID", "HF_API_KEY_SECRET", "DODO_AI_CREDIT_PRODUCT_ID", "DODO_PAYMENTS_API_KEY", "DODO_AI_CREDIT_PACKS"];
  const { values: env, restore } = fixtureEnvironment();
  env.set(names[0], "https://fixture.supabase.co");
  env.set(names[1], "fixture-service-key");
  env.set(names[2], "fixture-chat-key");
  env.set(names[3], "fixture-video-id");
  env.set(names[4], "fixture-video-secret");
  env.set(names[5], "pdt_custom");
  env.set(names[7], "[]");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/auth/v1/user")) return Response.json({ id: order.user_id });
    if (url.endsWith("/rpc/filey_take_rate_limit")) return Response.json(true);
    if (url.endsWith("/rpc/filey_ai_wallet")) return Response.json({ balance_micros: 0 });
    if (url.includes("/rest/v1/ai_credit_ledger?")) return Response.json([]);
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  try {
    const { handleRequest } = await import("../ai-credits/index.ts");
    const status = async () => {
      const response = await handleRequest(new Request("https://fixture/ai-credits", {
        method: "POST", headers: { Authorization: `Bearer ${fixtureJwt(order.user_id)}` }, body: JSON.stringify({ action: "status" }),
      }));
      assert(response.status === 200);
      return response.json();
    };
    let state = await status();
    assert(!state.topups_enabled && !state.custom_topup, "Missing payment configuration must hide custom checkout");
    env.set(names[6], "fixture-payment-key");
    state = await status();
    assert(!state.topups_enabled && !state.custom_topup,
      "An API key without webhook verification must never offer a checkout");
    env.set("DODO_PAYMENTS_WEBHOOK_KEY", "fixture-webhook-key");
    state = await status();
    assert(state.topups_enabled && state.packs.length === 0,
      "Custom checkout can work without fixed packs");
    assert(JSON.stringify(state.custom_topup) === JSON.stringify({ min_cents: 500, max_cents: 10000 }));
    assert(state.topup_fee_cents === 50 && !JSON.stringify(state).includes("pdt_custom"),
      "Status publishes only the range and fee, never a caller-selectable custom product");
    env.delete("DODO_PAYMENTS_WEBHOOK_KEY");
    state = await status();
    assert(!state.topups_enabled && !state.custom_topup,
      "Losing webhook verification disables credit sales immediately");
    env.set("DODO_PAYMENTS_WEBHOOK_KEY", "fixture-webhook-key");
    env.delete(names[2]);
    state = await status();
    assert(!state.topups_enabled && !state.custom_topup, "Video-only configuration must not offer Coin top-ups");
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});
Deno.test(
  "credit payment verifies provider order, handles existing refunds and refuses spoofed buyers",
  async () => {
    const events: { action: string; args: Record<string, unknown> }[] = [];
    const payment = {
      payment_id: "pay_fixture",
      status: "succeeded",
      metadata: { type: "ai_credits", credit_order: order.id, user_id: order.user_id },
      currency: "USD",
      total_amount: 575,
      product_cart: [{ product_id: "pdt_fixture", quantity: 1 }],
      refunds: [
        {
          refund_id: "refund_fixture",
          status: "succeeded",
          amount: 575,
          currency: "USD",
        },
      ],
      disputes: [],
    };
    const dodo = { payments: { retrieve: async () => payment } } as unknown as Parameters<
      typeof reconcileCreditPayment
    >[0];
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({ single: async () => ({ data: order, error: null }) }),
        }),
      }),
      rpc: async (
        _name: string,
        args: { p_action: string; p_args: Record<string, unknown> }
      ) => {
        events.push({ action: args.p_action, args: args.p_args });
        return { error: null };
      },
    } as unknown as Parameters<typeof reconcileCreditPayment>[1];
    assert(await reconcileCreditPayment(dodo, db, "pay_fixture"));
    assert(events.length === 1 && events[0].action === "reconcile_payment" && !events[0].args.dispute_action,
      "An ordinary payment snapshot must never clear a dispute block");
    assert(events[0].args.paid_cents === 575 &&
      JSON.stringify(events[0].args.refunds) === JSON.stringify([{ refund_id: "refund_fixture", refund_cents: 575 }]),
      "The verified payment and reversals must arrive in one atomic wallet call");
    payment.total_amount = 500;
    let underpaid = false;
    try {
      await reconcileCreditPayment(dodo, db, "pay_fixture");
    } catch {
      underpaid = true;
    }
    assert(underpaid && events.length === 1, "The service fee must also be paid");
    payment.total_amount = 575;
    payment.metadata.user_id = "wrong-user";
    let rejected = false;
    try {
      await reconcileCreditPayment(dodo, db, "pay_fixture");
    } catch {
      rejected = true;
    }
    assert(
      rejected && events.length === 1,
      "Spoofed payment must never reach the ledger"
    );
  }
);
Deno.test(
  "checkout grants nothing and checks the configured product price before taking payment",
  async () => {
    const names = [
      "FILEY_AI_DEEPSEEK_KEY",
      "DODO_AI_CREDIT_PACKS",
      "HF_API_KEY_ID",
      "HF_API_KEY_SECRET",
    ];
    const { values: env, restore } = fixtureEnvironment();
    env.set(names[0], "fixture-not-a-real-key");
    env.set(names[1], '[{"id":"pdt_fixture","cents":500}]');
    env.set("DODO_PAYMENTS_API_KEY", "fixture-payment-key");
    env.set("DODO_PAYMENTS_WEBHOOK_KEY", "fixture-webhook-key");
    try {
      let inserts = 0,
        checkouts = 0;
      const price = { type: "one_time_price", currency: "USD", price: 550 };
      const dodo = {
        products: { retrieve: async () => ({ price, is_recurring: false }) },
        checkoutSessions: {
          create: async (body: Record<string, unknown>) => {
            checkouts++;
            assert((body.metadata as { type: string }).type === "ai_credits");
            assert(
              (body.feature_flags as { allow_discount_code: boolean })
                .allow_discount_code === false
            );
            return {
              checkout_url: "https://checkout.dodopayments.com/fixture",
              session_id: "checkout_fixture",
            };
          },
        },
      } as unknown as Parameters<typeof createCreditCheckout>[0];
      const db = {
        from: () => ({
          insert: async (value: {
            credits_micros: number;
            service_fee_cents: number;
          }) => {
            assert(
              value.credits_micros === 5000000 && value.service_fee_cents === 50,
              "The fee must never become spendable credit"
            );
            inserts++;
            return { error: null };
          },
        }),
      } as unknown as Parameters<typeof createCreditCheckout>[1];
      const user = {
        id: order.user_id,
        email: "fixture@example.test",
        email_confirmed_at: "2026-09-20",
      } as Parameters<typeof createCreditCheckout>[2];
      await createCreditCheckout(dodo, db, user, "pdt_fixture");
      assert(inserts === 1 && checkouts === 1);
      env.delete(names[0]);
      env.set(names[2], "fixture-video-id");
      env.set(names[3], "fixture-video-secret");
      let rejected = false;
      try {
        await createCreditCheckout(dodo, db, user, "pdt_fixture");
      } catch {
        rejected = true;
      }
      assert(rejected && Number(inserts) === 1 && Number(checkouts) === 1,
        "Video-only configuration cannot create a Coin checkout");
      env.set(names[0], "fixture-not-a-real-key");
      price.price = 100;
      rejected = false;
      try { await createCreditCheckout(dodo, db, user, "pdt_fixture"); }
      catch { rejected = true; }
      assert(rejected && Number(inserts) === 1 && Number(checkouts) === 1,
        "Managed chat readiness must not bypass fixed product-price validation");
    } finally {
      restore();
    }
  }
);

Deno.test("missing or blank webhook verification rejects fixed and custom checkout before all side effects", async () => {
  const { values: env, restore } = fixtureEnvironment();
  env.set("FILEY_AI_DEEPSEEK_KEY", "fixture-model-key");
  env.set("DODO_PAYMENTS_API_KEY", "fixture-payment-key");
  env.set("DODO_AI_CREDIT_PRODUCT_ID", "pdt_custom");
  env.set("DODO_AI_CREDIT_PACKS", '[{"id":"pdt_fixture","cents":500}]');
  let calls = 0;
  const unexpected = () => { calls++; throw new Error("Checkout was submitted without verification"); };
  const dodo = {
    products: { retrieve: unexpected }, checkoutSessions: { create: unexpected },
  } as unknown as Parameters<typeof createCreditCheckout>[0];
  const db = { from: unexpected } as unknown as Parameters<typeof createCreditCheckout>[1];
  const user = { id: order.user_id, email: "fixture@example.test", email_confirmed_at: "2026-09-20" } as Parameters<typeof createCreditCheckout>[2];
  try {
    for (const key of [undefined, "", "   "]) {
      if (key === undefined) env.delete("DODO_PAYMENTS_WEBHOOK_KEY");
      else env.set("DODO_PAYMENTS_WEBHOOK_KEY", key);
      for (const custom of [false, true]) {
        let detail = "";
        try { await createCreditCheckout(dodo, db, user, custom ? undefined : "pdt_fixture", custom ? 1000 : undefined); }
        catch (error) { detail = (error as Error).message; }
        assert(detail === "Coin payments are not available yet.");
      }
    }
    assert(calls === 0, "Missing verification must not read a product, create an order or open checkout");
  } finally { restore(); }
});

function disputeFixture() {
  const payment = {
    payment_id: "pay_dispute_fixture", status: "succeeded", currency: "USD", total_amount: 550,
    metadata: { type: "ai_credits", credit_order: order.id, user_id: order.user_id },
    product_cart: [{ product_id: order.product_id, quantity: 1 }],
    refunds: [] as { refund_id: string; status: string; amount: number; currency: string }[],
    disputes: [] as { dispute_status: string }[],
  };
  const events: { action: string; args: Record<string, unknown> }[] = [];
  const dodo = { payments: { retrieve: async () => payment } } as unknown as Parameters<typeof reconcileCreditPayment>[0];
  const db = {
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: order, error: null }) }) }) }),
    rpc: async (_name: string, args: { p_user: string; p_action: string; p_args: Record<string, unknown> }) => {
      assert(args.p_user === order.user_id, "Only the verified purchase owner can receive a wallet update");
      events.push({ action: args.p_action, args: args.p_args });
      return { error: null };
    },
  } as unknown as Parameters<typeof reconcileCreditPayment>[1];
  return { payment, events, dodo, db };
}

Deno.test("payment and refund snapshots never clear a dispute, including an all-won provider list", async () => {
  const f = disputeFixture();
  f.payment.disputes = [{ dispute_status: "dispute_won" }];
  f.payment.refunds = [{ refund_id: "ref_fixture", status: "succeeded", amount: 110, currency: "USD" }];
  for (const type of ["payment.succeeded", "refund.succeeded"]) {
    await reconcileCreditPayment(f.dodo, f.db, f.payment.payment_id, { type, timestamp: "2026-10-03T12:00:00Z" });
  }
  assert(f.events.length === 2 && f.events.every(e => e.action === "reconcile_payment" && !e.args.dispute_action),
    "A late successful payment or refund cannot authorize reopening spending");
});

Deno.test("verified dispute updates carry signed ordering data in one payment transaction and only resolve when all disputes are won", async () => {
  const f = disputeFixture();
  const event = { type: "dispute.won", timestamp: "2026-10-03T12:00:00Z" };
  f.payment.disputes = [{ dispute_status: "dispute_won" }, { dispute_status: "dispute_opened" }];
  await reconcileCreditPayment(f.dodo, f.db, f.payment.payment_id, event);
  assert(f.events.length === 1 && f.events[0].action === "reconcile_payment" && f.events[0].args.dispute_action === "dispute",
    "A won event cannot reopen an account with another active dispute");
  assert(f.events[0].args.event_type === event.type && f.events[0].args.event_at === event.timestamp);
  f.events.length = 0;
  f.payment.disputes = [{ dispute_status: "dispute_won" }];
  await reconcileCreditPayment(f.dodo, f.db, f.payment.payment_id, event);
  assert(f.events.length === 1 && String(f.events[0].args.dispute_action) === "resolve_dispute");
  assert(f.events[0].args.event_at === event.timestamp && f.events[0].args.event_type === "dispute.won");
  f.events.length = 0;
  f.payment.disputes = [];
  await reconcileCreditPayment(f.dodo, f.db, f.payment.payment_id, event);
  assert(f.events.length === 1 && !f.events[0].args.dispute_action,
    "An absent dispute list is not proof of a won dispute");
});

Deno.test("missing or invalid signed dispute timestamps fail before granting credits or changing a dispute", async () => {
  for (const status of ["dispute_opened", "dispute_won"]) {
    const f = disputeFixture();
    f.payment.disputes = [{ dispute_status: status }];
    const event = { type: "dispute.won", timestamp: "not-a-date" };
    let rejected = false;
    try { await reconcileCreditPayment(f.dodo, f.db, f.payment.payment_id, event); }
    catch { rejected = true; }
    assert(rejected && f.events.length === 0);
    if (status === "dispute_opened") {
      rejected = false;
      try { await reconcileCreditPayment(f.dodo, f.db, f.payment.payment_id); }
      catch { rejected = true; }
      assert(rejected && f.events.length === 0);
    }
  }
});

Deno.test("a delayed older payment snapshot cannot clear a newer dispute reconciliation", async () => {
  const f = disputeFixture();
  const oldPayment = structuredClone(f.payment);
  let resume!: (value: typeof f.payment) => void;
  const oldResponse = new Promise<typeof f.payment>((resolve) => { resume = resolve; });
  let reads = 0;
  const dodo = { payments: { retrieve: () => ++reads === 1 ? oldResponse : Promise.resolve(f.payment) } } as unknown as Parameters<typeof reconcileCreditPayment>[0];
  const old = reconcileCreditPayment(dodo, f.db, f.payment.payment_id, { type: "payment.succeeded", timestamp: "2026-10-03T11:00:00Z" });
  f.payment.disputes = [{ dispute_status: "dispute_opened" }];
  await reconcileCreditPayment(dodo, f.db, f.payment.payment_id, { type: "dispute.opened", timestamp: "2026-10-03T12:00:00Z" });
  resume(oldPayment);
  await old;
  assert(f.events.length === 2 && f.events[0].args.dispute_action === "dispute" && !f.events[1].args.dispute_action,
    "The delayed handler must preserve the newer dispute block");
});

Deno.test("all succeeded refunds are validated before the single wallet transaction, including later malformed reversals", async () => {
  for (const invalid of [
    { amount: 0 }, { amount: -1 }, { amount: 1.5 }, { amount: Number.MAX_SAFE_INTEGER + 1 },
    { currency: "EUR" }, { refund_id: "" }, { refund_id: "x".repeat(201) },
  ]) {
    const f = disputeFixture();
    f.payment.refunds = [
      { refund_id: "ref_valid", status: "succeeded", amount: 110, currency: "USD" },
      { refund_id: "ref_invalid", status: "succeeded", amount: 440, currency: "USD", ...invalid },
    ];
    let rejected = false;
    try { await reconcileCreditPayment(f.dodo, f.db, f.payment.payment_id); }
    catch { rejected = true; }
    assert(rejected && f.events.length === 0,
      "A later malformed reversal must not leave an earlier top-up or partial debit committed");
  }
  const f = disputeFixture();
  f.payment.refunds = [
    { refund_id: "ref_accepted", status: "succeeded", amount: 110, currency: "USD" },
    { refund_id: "ref_pending", status: "pending", amount: 440, currency: "USD" },
  ];
  await reconcileCreditPayment(f.dodo, f.db, f.payment.payment_id);
  assert(f.events.length === 1 && JSON.stringify(f.events[0].args.refunds) ===
    JSON.stringify([{ refund_id: "ref_accepted", refund_cents: 110 }]),
    "Only succeeded reversals can debit Coin");
});
