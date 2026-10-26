// Every customer/coupon/payment/database operation below is synthetic.
// deno-lint-ignore-file require-await
import { createCreditCheckout, reconcileCreditPayment } from "./ai-credit-payments.ts";
import { dodoCheckoutUrl, PROMOTION_OPENED, PROMOTION_UNAVAILABLE, publicTestPromotion, testPromotionForUser } from "./ai-credit-promotion.ts";
import { fixtureJwt } from "./test-auth-fixture.ts";

function assert(ok: unknown, message = "Assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}
const userId = "30000000-0000-4000-8000-000000000001";
const promotionId = "70000000-0000-4000-8000-000000000001";
const user = { id: userId, email: "owner@fixture.test", email_confirmed_at: "2026-10-04" } as Parameters<typeof createCreditCheckout>[2];
function promotion() {
  return { id: promotionId, user_id: userId, email: user.email, customer_id: "cus_fixture", discount_id: "dsc_fixture",
    discount_code: "FIXTURETEST", product_id: "pdt_custom", cents: 500, expires_at: new Date(Date.now() + 3_600_000).toISOString() };
}
function environment() {
  const previous = Deno.env.get;
  const config = promotion();
  const values = new Map(Object.entries({ SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key",
    FILEY_AI_DEEPSEEK_KEY: "fixture-model-key", DODO_PAYMENTS_API_KEY: "fixture-payment-key", DODO_PAYMENTS_WEBHOOK_KEY: "fixture-webhook-key",
    DODO_AI_CREDIT_PRODUCT_ID: "pdt_custom", DODO_AI_CREDIT_PACKS: "[]", FILEY_AI_TEST_PROMOTION: JSON.stringify(config) }));
  Deno.env.get = (name) => values.get(name);
  return { config, values, restore: () => { Deno.env.get = previous; } };
}
function checkoutFixture(config: ReturnType<typeof promotion>) {
  const state = { orders: [] as Record<string, unknown>[], checkouts: [] as Record<string, unknown>[], reads: 0,
    duplicate: false, saveFails: false, nextPage: [] as { customer_id: string }[], allowed: [{ customer_id: config.customer_id }],
    discount: { discount_id: config.discount_id, code: config.discount_code, type: "percentage", amount: 10000, customer_eligibility: "specific",
      restricted_to: [config.product_id], usage_limit: 1, per_customer_usage_limit: 1, times_used: 0, starts_at: null,
      expires_at: config.expires_at, currency_options: [], business_id: "bsn_fixture" } as Record<string, unknown>,
    customer: { customer_id: config.customer_id, email: config.email, business_id: "bsn_fixture", blocked_at: null } as Record<string, unknown> };
  const dodo = {
    products: { retrieve: async (id: string) => { state.reads++; assert(id === config.product_id);
      return { price: { type: "one_time_price", currency: "USD", price: 550, pay_what_you_want: true }, is_recurring: false }; } },
    discounts: { retrieve: async (id: string) => { state.reads++; assert(id === config.discount_id); return state.discount; } },
    customers: { retrieve: async (id: string) => { state.reads++; assert(id === config.customer_id); return state.customer; } },
    get: async (path: string, options: { query: { page_number: number; page_size: number } }) => {
      state.reads++; assert(path === `/discounts/${config.discount_id}/customers` && options.query.page_size === 100);
      return { items: options.query.page_number === 0 ? state.allowed : state.nextPage };
    },
    checkoutSessions: { create: async (body: Record<string, unknown>, options: { maxRetries: number }) => {
      assert(options.maxRetries === 0, "An uncertain test checkout must not be retried automatically");
      state.checkouts.push(body); return { checkout_url: "https://checkout.dodopayments.com/fixture", session_id: "session_fixture" };
    } },
  } as unknown as Parameters<typeof createCreditCheckout>[0];
  const db = { from: (table: string) => {
    assert(table === "ai_credit_orders", "Opening a checkout must never grant wallet credit");
    return {
      select: () => ({ or: () => ({ limit: async () => ({ data: state.duplicate ? [{ id: "fixture" }] : state.orders, error: null }) }) }),
      insert: async (row: Record<string, unknown>) => {
        if (state.duplicate) return { error: { code: "23505", message: "private duplicate fixture" } };
        state.orders.push({ payment_id: null, paid_cents: null, refunded_micros: 0, disputed: false,
          checkout_session_id: null, checkout_url: null, ...row }); return { error: null };
      },
      update: (patch: Record<string, unknown>) => {
        const filters: Record<string, unknown> = {};
        const builder = { eq: (key: string, value: unknown) => { filters[key] = value; return builder; },
          is: (key: string, value: unknown) => { filters[key] = value; return builder; },
          select: () => builder, single: async () => {
            assert(filters.user_id === userId && filters.payment_id === null && filters.paid_cents === null &&
              filters.checkout_session_id === null && filters.checkout_url === null && filters.product_id === config.product_id &&
              filters.promotion_id === config.id && filters.promotion_discount_id === config.discount_id &&
              filters.promotion_customer_id === config.customer_id && filters.promotion_discount_code === config.discount_code &&
              filters.promotion_email === config.email && filters.promotion_expires_at === config.expires_at &&
              filters.expected_paid_cents === 0 && filters.credits_micros === 5_000_000 && filters.service_fee_cents === 50 &&
              filters.refunded_micros === 0 && filters.disputed === false);
            const row = state.orders.find((entry) => entry.id === filters.id);
            assert(row); if (state.saveFails || Object.entries(filters).some(([key, value]) => row[key] !== value))
              return { error: { message: "private save fixture" }, data: null };
            Object.assign(row, patch); return { data: { id: row.id }, error: null };
          } };
        return builder;
      },
    };
  } } as unknown as Parameters<typeof createCreditCheckout>[1];
  return { state, dodo, db };
}

Deno.test("test promotion config binds verified account, exact credit amount and a bounded expiration", async () => {
  const { config, values, restore } = environment();
  try {
    assert(testPromotionForUser(user)?.id === promotionId);
    for (const changedUser of [{ ...user, id: "30000000-0000-4000-8000-000000000002" },
      { ...user, email: "other@fixture.test" }, { ...user, email_confirmed_at: null }]) {
      assert(testPromotionForUser(changedUser as typeof user) === null);
    }
    for (const patch of [{ id: `${promotionId}\n` }, { cents: 1000 }, { expires_at: "invalid" },
      { expires_at: new Date(Date.now() - 1).toISOString() }, { expires_at: new Date(Date.now() + 8 * 86_400_000).toISOString() },
      { discount_code: "FIXTURETEST\n" }, { customer_id: "cus_fixture/path" }, { email: "owner@fixture.test\nwrong" }]) {
      values.set("FILEY_AI_TEST_PROMOTION", JSON.stringify({ ...config, ...patch }));
      assert(testPromotionForUser(user) === null, `Invalid configuration became public: ${JSON.stringify(patch)}`);
    }
    values.set("FILEY_AI_TEST_PROMOTION", "{"); assert(testPromotionForUser(user) === null);
  } finally { restore(); }
});

Deno.test("promotion checkout fixes customer/coupon/session and claims one order without any cash or credit fallback", async () => {
  const { config, restore } = environment();
  try {
    const { state, dodo, db } = checkoutFixture(config);
    const result = await createCreditCheckout(dodo, db, user, undefined, 500, promotionId);
    const order = state.orders[0], checkout = state.checkouts[0];
    assert(result.order_id === order.id && order.expected_paid_cents === 0 && order.credits_micros === 5_000_000 &&
      order.service_fee_cents === 50 && order.promotion_id === promotionId && order.promotion_discount_id === config.discount_id &&
      order.promotion_email === user.email && order.checkout_session_id === result.session_id && order.checkout_url === result.url);
    assert(JSON.stringify(checkout.customer) === JSON.stringify({ customer_id: config.customer_id }) &&
      JSON.stringify(checkout.discount_codes) === JSON.stringify([config.discount_code]));
    const flags = checkout.feature_flags as Record<string, unknown>;
    assert(flags.allow_discount_code === true && flags.allow_customer_editing_email === false && flags.always_create_new_customer === false);
    assert(JSON.stringify(checkout.product_cart) === JSON.stringify([{ product_id: config.product_id, quantity: 1, amount: 550 }]),
      "The full five-Coin plus fee total is discounted, never a fabricated paid receipt");
    state.duplicate = true;
    let reason = "";
    try { await createCreditCheckout(dodo, db, user, undefined, 500, promotionId); }
    catch (error) { reason = (error as Error).message; }
    assert(reason === PROMOTION_OPENED && state.checkouts.length === 1 && state.orders.length === 1,
      "Duplicate claims must reject before a second checkout or normal paid fallback");
    const before = state.reads;
    for (const [actor, amount, selected] of [[{ ...user, email: "other@fixture.test" }, 500, promotionId],
      [user, 1000, promotionId], [user, 500, "70000000-0000-4000-8000-000000000002"], [user, 500, null]] as const) {
      reason = "";
      try { await createCreditCheckout(dodo, db, actor as typeof user, undefined, amount, selected); }
      catch (error) { reason = (error as Error).message; }
      assert(reason === PROMOTION_UNAVAILABLE && state.checkouts.length === 1);
    }
    assert(state.reads === before, "Wrong owner, amount or promotion must fail before provider reads");
  } finally { restore(); }
});

Deno.test("saved private promotion resumes the same unpaid link without a provider call or second claim", async () => {
  const { config, restore } = environment();
  try {
    const { state, dodo, db } = checkoutFixture(config);
    const first = await createCreditCheckout(dodo, db, user, undefined, 500, promotionId);
    const before = state.reads;
    for (let i = 0; i < 3; i++) {
      assert(JSON.stringify(await createCreditCheckout(dodo, db, user, undefined, 500, promotionId)) === JSON.stringify(first));
    }
    const offer = await publicTestPromotion(db, user);
    assert(offer?.id === promotionId && !JSON.stringify(offer).includes(first.url) &&
      state.checkouts.length === 1 && state.orders.length === 1 && state.reads === before,
      "A ready checkout must resume its persisted identity and keep its URL private");
  } finally { restore(); }
});

Deno.test("unknown, paid, foreign-owner or changed promotion claims never resume or silently reopen", async () => {
  const { config, restore } = environment();
  try {
    for (const patch of [{ id: "invalid" }, { user_id: "30000000-0000-4000-8000-000000000002" },
      { product_id: "pdt_other" }, { credits_micros: 10_000_000 }, { service_fee_cents: 0 }, { expected_paid_cents: 550 },
      { promotion_id: "70000000-0000-4000-8000-000000000002" }, { promotion_discount_id: "dsc_other" },
      { promotion_customer_id: "cus_other" }, { promotion_discount_code: "OTHER" }, { promotion_email: "other@fixture.test" },
      { promotion_expires_at: new Date(Date.parse(config.expires_at) + 1_000).toISOString() },
      { checkout_session_id: null }, { checkout_url: null }, { checkout_url: "https://dodopayments.com.evil.test/checkout" },
      { payment_id: "pay_already" }, { paid_cents: 0 }, { refunded_micros: 1 }, { disputed: true }]) {
      const { state, dodo, db } = checkoutFixture(config);
      await createCreditCheckout(dodo, db, user, undefined, 500, promotionId);
      Object.assign(state.orders[0], patch);
      const before = state.reads;
      let reason = "";
      try { await createCreditCheckout(dodo, db, user, undefined, 500, promotionId); }
      catch (error) { reason = (error as Error).message; }
      assert(reason === PROMOTION_OPENED && state.checkouts.length === 1 && state.orders.length === 1 && state.reads === before);
      assert(await publicTestPromotion(db, user) === undefined);
    }
  } finally { restore(); }
});

Deno.test("private checkout links are validated and persisted under an unchanged unpaid binding before exposure", async () => {
  const { config, restore } = environment();
  try {
    for (const url of [null, "http://checkout.dodopayments.com/a", "https://dodopayments.com.evil.test/a",
      "https://user:secret@checkout.dodopayments.com/a", "https://checkout.dodopayments.com:8443/a",
      "https://checkout.dodopayments.com/a\n", "https://checkout.dodopayments.com/" + "a".repeat(2_048)]) {
      assert(dodoCheckoutUrl(url) === null);
      const { state, dodo, db } = checkoutFixture(config);
      dodo.checkoutSessions.create = (async () => ({ checkout_url: url, session_id: "session_fixture" })) as unknown as typeof dodo.checkoutSessions.create;
      let rejected = false;
      try { await createCreditCheckout(dodo, db, user, undefined, 500, promotionId); } catch { rejected = true; }
      assert(rejected && state.orders[0].checkout_url === null && state.orders[0].checkout_session_id === null);
    }
    for (const change of [{ payment_id: "pay_changed" }, { checkout_session_id: "session_changed" },
      { promotion_customer_id: "cus_changed" }, { disputed: true }]) {
      const { state, dodo, db } = checkoutFixture(config);
      dodo.checkoutSessions.create = (async () => {
        Object.assign(state.orders[0], change);
        return { checkout_url: "https://checkout.dodopayments.com/fixture", session_id: "session_fixture" };
      }) as unknown as typeof dodo.checkoutSessions.create;
      let rejected = false;
      try { await createCreditCheckout(dodo, db, user, undefined, 500, promotionId); } catch { rejected = true; }
      assert(rejected && state.orders[0].checkout_url === null, "Late provider response cannot overwrite changed order authority");
    }
  } finally { restore(); }
});

Deno.test("promotion checkout refuses provider coupon/customer/allowlist drift before saving or opening an order", async () => {
  const { config, restore } = environment();
  try {
    for (const patch of [{ amount: 9999 }, { type: "flat" }, { code: "OTHER" }, { customer_eligibility: "any" },
      { usage_limit: 2 }, { per_customer_usage_limit: 2 }, { times_used: 1 }, { expires_at: null },
      { expires_at: new Date(Date.parse(config.expires_at) - 1).toISOString() }, { expires_at: "invalid" }, { restricted_to: [] },
      { restricted_to: [config.product_id, "pdt_other"] }, { currency_options: [{ currency: "USD", max_amount_possible: 100 }] }]) {
      const { state, dodo, db } = checkoutFixture(config); Object.assign(state.discount, patch);
      let reason = ""; try { await createCreditCheckout(dodo, db, user, undefined, 500, promotionId); }
      catch (error) { reason = (error as Error).message; }
      assert(reason === PROMOTION_UNAVAILABLE && state.orders.length === 0 && state.checkouts.length === 0);
    }
    for (const mutation of ["wrongEmail", "blocked", "missingCustomer", "extraCustomer", "extraPage"] as const) {
      const { state, dodo, db } = checkoutFixture(config);
      if (mutation === "wrongEmail") state.customer.email = "other@fixture.test";
      if (mutation === "blocked") state.customer.blocked_at = new Date().toISOString();
      if (mutation === "missingCustomer") state.allowed = [];
      if (mutation === "extraCustomer") state.allowed.push({ customer_id: "cus_other" });
      if (mutation === "extraPage") state.nextPage = [{ customer_id: "cus_other" }];
      let reason = ""; try { await createCreditCheckout(dodo, db, user, undefined, 500, promotionId); }
      catch (error) { reason = (error as Error).message; }
      assert(reason === PROMOTION_UNAVAILABLE && state.orders.length === 0 && state.checkouts.length === 0);
    }
  } finally { restore(); }
});

Deno.test("provider expiry must cover the private cutoff without extending the saved first-grant window", async () => {
  const { config, restore } = environment();
  try {
    const privateExpiry = Date.parse(config.expires_at);
    for (const expiry of [config.expires_at, new Date(privateExpiry + 86_400_000).toISOString()]) {
      const { state, dodo, db } = checkoutFixture(config);
      state.discount.expires_at = expiry;
      await createCreditCheckout(dodo, db, user, undefined, 500, promotionId);
      assert(state.orders.length === 1 && state.checkouts.length === 1);
      assert(state.orders[0].promotion_expires_at === config.expires_at,
        "The provider's longer date must not extend Filey's saved authorization");
    }
    for (const expiry of [new Date(privateExpiry - 1).toISOString(), null, "invalid", "Infinity"]) {
      const { state, dodo, db } = checkoutFixture(config);
      state.discount.expires_at = expiry;
      let reason = "";
      try { await createCreditCheckout(dodo, db, user, undefined, 500, promotionId); }
      catch (error) { reason = (error as Error).message; }
      assert(reason === PROMOTION_UNAVAILABLE && state.orders.length === 0 && state.checkouts.length === 0);
    }
    const f = settlementFixture();
    f.order.promotion_expires_at = config.expires_at;
    // This succeeded event is inside the accepted provider's longer lifetime,
    // but after Filey's private deadline and therefore cannot mint any Coin.
    let rejected = false;
    try { await reconcileCreditPayment(f.dodo, f.db, f.payment.payment_id,
      { ...f.event, timestamp: new Date(privateExpiry + 1_000).toISOString() }); }
    catch { rejected = true; }
    assert(rejected && f.writes.length === 0);
  } finally { restore(); }
});

function settlementFixture() {
  const config = promotion();
  const order = { id: "40000000-0000-4000-8000-000000000001", user_id: userId, product_id: config.product_id,
    credits_micros: 5_000_000, service_fee_cents: 50, payment_id: null as string | null, promotion_id: promotionId,
    promotion_discount_id: config.discount_id, promotion_discount_code: config.discount_code,
    promotion_customer_id: config.customer_id, promotion_email: config.email, promotion_expires_at: config.expires_at,
    expected_paid_cents: 0, checkout_session_id: "session_fixture" };
  const payment = { payment_id: "pay_promotion", status: "succeeded", currency: "USD", total_amount: 0,
    metadata: { type: "ai_credits", credit_order: order.id, user_id: userId, promotion_id: promotionId },
    customer: { customer_id: config.customer_id, email: config.email }, checkout_session_id: order.checkout_session_id,
    product_cart: [{ product_id: config.product_id, quantity: 1 }],
    discounts: [{ discount_id: config.discount_id, code: config.discount_code, type: "percentage", amount: 10000, restricted_to: [config.product_id] }],
    refunds: [] as { status: string; amount: number; currency: string; refund_id: string }[],
    disputes: [] as { dispute_status: string }[] };
  const writes: Record<string, unknown>[] = [];
  const dodo = { payments: { retrieve: async () => payment } } as unknown as Parameters<typeof reconcileCreditPayment>[0];
  const db = { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: order, error: null }) }) }) }),
    rpc: async (_name: string, args: Record<string, unknown>) => { writes.push(args); return { error: null }; } } as unknown as Parameters<typeof reconcileCreditPayment>[1];
  return { order, payment, writes, dodo, db, event: { type: "payment.succeeded", timestamp: new Date().toISOString() } };
}

Deno.test("zero settlement requires a succeeded receipt with all saved coupon/customer/checkout bindings and signed event", async () => {
  const valid = settlementFixture();
  assert(await reconcileCreditPayment(valid.dodo, valid.db, valid.payment.payment_id, valid.event));
  const args = valid.writes[0].p_args as Record<string, unknown>;
  assert(valid.writes.length === 1 && args.paid_cents === 0 && args.event_type === "payment.succeeded" &&
    args.event_at === valid.event.timestamp && JSON.stringify(args.refunds) === "[]", "Record actual zero cash, never nominal payment");
  for (const change of ["noEvent", "wrongEvent", "expiredEvent", "wrongDiscount", "wrongPercent", "stacked", "wrongCustomer",
    "wrongEmail", "wrongSession", "wrongPromotion", "underpaidCash", "pending", "refund", "noAuthority"] as const) {
    const f = settlementFixture(); let event: typeof f.event | undefined = f.event;
    if (change === "noEvent") event = undefined;
    if (change === "wrongEvent") event = { ...f.event, type: "checkout.completed" };
    if (change === "expiredEvent") event = { ...f.event, timestamp: new Date(Date.now() + 7_200_000).toISOString() };
    if (change === "wrongDiscount") f.payment.discounts[0].discount_id = "dsc_other";
    if (change === "wrongPercent") f.payment.discounts[0].amount = 9999;
    if (change === "stacked") f.payment.discounts.push({ ...f.payment.discounts[0] });
    if (change === "wrongCustomer") f.payment.customer.customer_id = "cus_other";
    if (change === "wrongEmail") f.payment.customer.email = "other@fixture.test";
    if (change === "wrongSession") f.payment.checkout_session_id = "session_other";
    if (change === "wrongPromotion") f.payment.metadata.promotion_id = "70000000-0000-4000-8000-000000000002";
    if (change === "underpaidCash") f.payment.total_amount = 1;
    if (change === "pending") f.payment.status = "processing";
    if (change === "refund") f.payment.refunds.push({ status: "succeeded", amount: 1, currency: "USD", refund_id: "ref_fixture" });
    if (change === "noAuthority") f.order.expected_paid_cents = 550;
    let rejected = false;
    try { await reconcileCreditPayment(f.dodo, f.db, f.payment.payment_id, event); } catch { rejected = true; }
    assert((rejected || change === "pending") && f.writes.length === 0, `Unsafe zero receipt wrote a wallet: ${change}`);
  }
});

Deno.test("zero settlement remains idempotent/reversal-safe after config removal or expiry and preserves signed disputes", async () => {
  const f = settlementFixture(); f.order.payment_id = f.payment.payment_id; f.order.promotion_expires_at = "2026-01-01T00:00:00Z";
  assert(await reconcileCreditPayment(f.dodo, f.db, f.payment.payment_id));
  f.payment.disputes = [{ dispute_status: "dispute_opened" }];
  const event = { type: "dispute.opened", timestamp: new Date().toISOString() };
  assert(await reconcileCreditPayment(f.dodo, f.db, f.payment.payment_id, event));
  const disputed = f.writes[1].p_args as Record<string, unknown>;
  assert(disputed.paid_cents === 0 && disputed.dispute_action === "dispute" && disputed.event_at === event.timestamp);
  f.payment.disputes = [{ dispute_status: "dispute_won" }];
  assert(await reconcileCreditPayment(f.dodo, f.db, f.payment.payment_id, { ...event, type: "payment.succeeded" }));
  assert(!(f.writes[2].p_args as Record<string, unknown>).dispute_action, "An ordinary snapshot must not clear a dispute");
  assert(await reconcileCreditPayment(f.dodo, f.db, f.payment.payment_id, { ...event, type: "dispute.won" }));
  assert((f.writes[3].p_args as Record<string, unknown>).dispute_action === "resolve_dispute");
});

Deno.test("promotion status reveals only the verified owner's public offer and hides any claimed campaign/discount", async () => {
  const { config, restore } = environment();
  try {
    let reads = 0, opened = false;
    const db = { from: (table: string) => { assert(table === "ai_credit_orders"); return {
      select: (columns: string) => { assert(columns.includes("checkout_url") && columns.includes("user_id")); return { or: (filter: string) => {
        assert(filter === `promotion_id.eq.${config.id},promotion_discount_id.eq.${config.discount_id}`);
        return { limit: async (limit: number) => { assert(limit === 2); reads++; return { data: opened ? [{ id: "fixture" }] : [], error: null }; } };
      } }; },
    }; } } as unknown as Parameters<typeof publicTestPromotion>[0];
    const offer = await publicTestPromotion(db, user);
    assert(JSON.stringify(offer) === JSON.stringify({ id: config.id, cents: 500, discount_cents: 550, expires_at: config.expires_at }));
    assert(!JSON.stringify(offer).includes(config.discount_code) && !JSON.stringify(offer).includes(config.customer_id));
    assert(await publicTestPromotion(db, { ...user, email: "other@fixture.test" }) === undefined && reads === 1);
    opened = true; assert(await publicTestPromotion(db, user) === undefined && Number(reads) === 2);
  } finally { restore(); }
});

Deno.test("the actual wallet status exposes a promotion only before its private claim, without provider metadata", async () => {
  const { config, restore } = environment(); const previousFetch = globalThis.fetch;
  let owned = true, opened = false, reads = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/auth/v1/user") return Response.json({ ...user, email: owned ? user.email : "other@fixture.test", factors: [] });
    if (url.pathname === "/rest/v1/rpc/filey_take_rate_limit") return Response.json(true);
    if (url.pathname === "/rest/v1/rpc/filey_ai_wallet") return Response.json({ balance_micros: 0 });
    if (url.pathname === "/rest/v1/ai_credit_ledger") return Response.json([]);
    if (url.pathname === "/rest/v1/ai_credit_orders") { reads++; assert(url.searchParams.get("select")?.includes("checkout_url")); return Response.json(opened ? [{ id: "fixture" }] : []); }
    throw new Error(`No provider call permitted: ${url.href}`);
  }) as typeof fetch;
  try {
    const { handleRequest } = await import("../ai-credits/index.ts");
    const request = () => handleRequest(new Request("https://fixture/ai-credits", { method: "POST", headers: { Authorization: `Bearer ${fixtureJwt(userId)}` }, body: '{"action":"status"}' }));
    let response = await request(), body = await response.json();
    assert(response.status === 200 && body.test_promotion.id === config.id && body.test_promotion.discount_cents === 550);
    assert(!JSON.stringify(body).includes(config.discount_code) && !JSON.stringify(body).includes(config.customer_id));
    opened = true; response = await request(); body = await response.json(); assert(response.status === 200 && !body.test_promotion);
    owned = false; response = await request(); body = await response.json(); assert(response.status === 200 && !body.test_promotion && reads === 2);
  } finally { globalThis.fetch = previousFetch; restore(); }
});
