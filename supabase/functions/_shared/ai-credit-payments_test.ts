import { createCreditCheckout, reconcileCreditPayment } from "./ai-credit-payments.ts";
function assert(ok: unknown, message = "Assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}
const order = {
  id: "40000000-0000-4000-8000-000000000001",
  user_id: "30000000-0000-4000-8000-000000000001",
  product_id: "pdt_fixture",
  credits_micros: 5000000,
};
Deno.test(
  "credit payment verifies provider order, handles existing refunds and refuses spoofed buyers",
  async () => {
    const events: { action: string; args: Record<string, unknown> }[] = [];
    const payment = {
      payment_id: "pay_fixture",
      status: "succeeded",
      metadata: { type: "ai_credits", credit_order: order.id, user_id: order.user_id },
      currency: "USD",
      total_amount: 525,
      product_cart: [{ product_id: "pdt_fixture", quantity: 1 }],
      refunds: [
        {
          refund_id: "refund_fixture",
          status: "succeeded",
          amount: 525,
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
    assert(events[0].args.paid_cents === 525 && events[1].args.refund_cents === 525);
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
    const names = ["FILEY_AI_OPENROUTER_KEY", "DODO_AI_CREDIT_PACKS"];
    const previous = names.map((n) => Deno.env.get(n));
    Deno.env.set(names[0], "fixture-not-a-real-key");
    Deno.env.set(names[1], '[{"id":"pdt_fixture","cents":500}]');
    try {
      let inserts = 0,
        checkouts = 0;
      const price = { type: "one_time_price", currency: "USD", price: 500 };
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
          insert: async () => {
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
      price.price = 100;
      let rejected = false;
      try {
        await createCreditCheckout(dodo, db, user, "pdt_fixture");
      } catch {
        rejected = true;
      }
      assert(rejected && inserts === 1 && checkouts === 1);
    } finally {
      names.forEach((n, i) =>
        previous[i] === undefined ? Deno.env.delete(n) : Deno.env.set(n, previous[i]!)
      );
    }
  }
);
