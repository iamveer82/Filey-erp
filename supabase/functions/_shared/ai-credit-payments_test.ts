import { createCreditCheckout, reconcileCreditPayment } from "./ai-credit-payments.ts";
function assert(ok: unknown, message = "Assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}
const order = {
  id: "40000000-0000-4000-8000-000000000001",
  user_id: "30000000-0000-4000-8000-000000000001",
  product_id: "pdt_fixture",
  credits_micros: 5000000,
  service_fee_cents: 50,
};
Deno.test("custom checkout fixes the total and records only purchased credit, rejecting invalid choices before payment", async () => {
  const names = ["FILEY_AI_OPENROUTER_KEY", "DODO_AI_CREDIT_PRODUCT_ID", "DODO_AI_CREDIT_PACKS"];
  const previous = names.map(name => Deno.env.get(name));
  Deno.env.set(names[0], "fixture-not-a-real-key");
  Deno.env.set(names[1], "pdt_custom");
  Deno.env.set(names[2], "[]");
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
      await createCreditCheckout(dodo, db, user, undefined, amount);
      const saved = orders.at(-1)!;
      const checkout = checkouts.at(-1)!;
      assert(saved.credits_micros === amount * 10000 && saved.service_fee_cents === 50);
      assert(saved.product_id === "pdt_custom");
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
    Deno.env.delete(names[1]);
    await rejected(undefined, 1234);
  } finally {
    names.forEach((name, i) => previous[i] === undefined ? Deno.env.delete(name) : Deno.env.set(name, previous[i]!));
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
  assert(applied[0].p_action === "topup");
  assert(JSON.stringify(applied[0].p_args) === JSON.stringify({ order_id: saved.id, payment_id: payment.payment_id, paid_cents: 1284 }),
    "Settlement must not take any credit value from payment metadata");
});

Deno.test("wallet advertises custom amounts only with configured AI and payments", async () => {
  const names = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "FILEY_AI_OPENROUTER_KEY",
    "HF_API_KEY_ID", "HF_API_KEY_SECRET", "DODO_AI_CREDIT_PRODUCT_ID", "DODO_PAYMENTS_API_KEY", "DODO_AI_CREDIT_PACKS"];
  const previous = names.map(name => Deno.env.get(name));
  Deno.env.set(names[0], "https://fixture.supabase.co");
  Deno.env.set(names[1], "fixture-service-key");
  Deno.env.delete(names[2]);
  Deno.env.set(names[3], "fixture-video-id");
  Deno.env.set(names[4], "fixture-video-secret");
  Deno.env.set(names[5], "pdt_custom");
  Deno.env.delete(names[6]);
  Deno.env.set(names[7], "[]");
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
        method: "POST", headers: { Authorization: "Bearer fixture" }, body: JSON.stringify({ action: "status" }),
      }));
      assert(response.status === 200);
      return response.json();
    };
    let state = await status();
    assert(!state.topups_enabled && !state.custom_topup, "Missing payment configuration must hide custom checkout");
    Deno.env.set(names[6], "fixture-payment-key");
    state = await status();
    assert(state.topups_enabled && state.packs.length === 0,
      "Custom checkout can work without fixed packs");
    assert(JSON.stringify(state.custom_topup) === JSON.stringify({ min_cents: 500, max_cents: 10000 }));
    assert(state.topup_fee_cents === 50 && !JSON.stringify(state).includes("pdt_custom"),
      "Status publishes only the range and fee, never a caller-selectable custom product");
    Deno.env.delete(names[3]);
    Deno.env.delete(names[4]);
    state = await status();
    assert(!state.topups_enabled && !state.custom_topup, "Unconfigured AI must not offer top-ups");
  } finally {
    globalThis.fetch = originalFetch;
    names.forEach((name, i) => previous[i] === undefined ? Deno.env.delete(name) : Deno.env.set(name, previous[i]!));
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
    assert(events.map((e) => e.action).join(",") === "topup,refund,resolve_dispute");
    assert(events[0].args.paid_cents === 575 && events[1].args.refund_cents === 575);
    payment.total_amount = 500;
    let underpaid = false;
    try {
      await reconcileCreditPayment(dodo, db, "pay_fixture");
    } catch {
      underpaid = true;
    }
    assert(underpaid && events.length === 3, "The service fee must also be paid");
    payment.total_amount = 575;
    payment.metadata.user_id = "wrong-user";
    let rejected = false;
    try {
      await reconcileCreditPayment(dodo, db, "pay_fixture");
    } catch {
      rejected = true;
    }
    assert(
      rejected && events.length === 3,
      "Spoofed payment must never reach the ledger"
    );
  }
);
Deno.test(
  "checkout grants nothing and checks the configured product price before taking payment",
  async () => {
    const names = [
      "FILEY_AI_OPENROUTER_KEY",
      "DODO_AI_CREDIT_PACKS",
      "HF_API_KEY_ID",
      "HF_API_KEY_SECRET",
    ];
    const previous = names.map((n) => Deno.env.get(n));
    Deno.env.set(names[0], "fixture-not-a-real-key");
    Deno.env.set(names[1], '[{"id":"pdt_fixture","cents":500}]');
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
      Deno.env.delete(names[0]);
      Deno.env.set(names[2], "fixture-video-id");
      Deno.env.set(names[3], "fixture-video-secret");
      await createCreditCheckout(dodo, db, user, "pdt_fixture");
      assert(
        Number(inserts) === 2 && Number(checkouts) === 2,
        "Video-only accounts can add credits without a chat provider key"
      );
      price.price = 100;
      let rejected = false;
      try {
        await createCreditCheckout(dodo, db, user, "pdt_fixture");
      } catch {
        rejected = true;
      }
      assert(rejected && Number(inserts) === 2 && Number(checkouts) === 2);
    } finally {
      names.forEach((n, i) =>
        previous[i] === undefined ? Deno.env.delete(n) : Deno.env.set(n, previous[i]!)
      );
    }
  }
);
