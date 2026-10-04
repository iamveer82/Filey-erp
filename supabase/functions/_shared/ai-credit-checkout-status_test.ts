// Synthetic auth/database fetches only; no provider or wallet access is permitted.
// deno-lint-ignore-file require-await
import { fixtureJwt } from "./test-auth-fixture.ts";

function assert(ok: unknown, message = "Assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}
const userId = "30000000-0000-4000-8000-000000000001";
const foreignUserId = "30000000-0000-4000-8000-000000000002";
const orderId = "40000000-0000-4000-8000-000000000001";
const foreignOrderId = "40000000-0000-4000-8000-000000000002";
const missingOrderId = "40000000-0000-4000-8000-000000000003";
const paidOrder = {
  payment_id: "pay_fixture",
  paid_cents: 550,
  credits_micros: 5_000_000,
  refunded_micros: 0,
  disputed: false,
};

async function withFixture(
  run: (fixture: {
    call: (id: unknown, extra?: Record<string, unknown>) => Promise<Response>;
    state: {
      authenticated: boolean;
      mfa: boolean;
      rateAllowed: boolean;
      databaseFails: boolean;
      orders: Record<string, unknown>[];
      rateReads: number;
      orderReads: number;
    };
  }) => Promise<void>,
) {
  const originalEnv = Deno.env.get;
  const originalFetch = globalThis.fetch;
  // Confirmation must also work while the managed model/payment keys are absent.
  Deno.env.get = (name) => ({
    SUPABASE_URL: "https://fixture.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key",
  })[name];
  const state = {
    authenticated: true,
    mfa: false,
    rateAllowed: true,
    databaseFails: false,
    orders: [
      { id: orderId, user_id: userId, ...paidOrder },
      { id: foreignOrderId, user_id: foreignUserId, ...paidOrder },
    ] as Record<string, unknown>[],
    rateReads: 0,
    orderReads: 0,
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.href === "https://fixture.supabase.co/auth/v1/user") {
      return Response.json(state.authenticated
        ? { id: userId, factors: state.mfa ? [{ status: "verified" }] : [] }
        : { message: "Invalid token" }, { status: state.authenticated ? 200 : 401 });
    }
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    assert(headers.get("Authorization") === "Bearer fixture-service-key",
      "The private order table must only be read through server authority");
    if (url.pathname === "/rest/v1/rpc/filey_take_rate_limit") {
      state.rateReads++;
      const raw = init?.body ?? (input instanceof Request ? await input.clone().text() : "");
      const args = JSON.parse(String(raw));
      assert(method === "POST" && args.p_subject === userId && args.p_action === "ai_credits_read" &&
        args.p_limit === 120 && args.p_window_seconds === 3600);
      return Response.json(state.rateAllowed);
    }
    if (url.pathname === "/rest/v1/ai_credit_orders") {
      state.orderReads++;
      assert(method === "GET", "Checkout confirmation cannot mutate a saved order");
      assert(url.searchParams.get("user_id") === `eq.${userId}`,
        "The order lookup must filter by the verified account, never caller identity");
      assert(url.searchParams.get("select") ===
        "payment_id,paid_cents,credits_micros,refunded_micros,disputed,promotion_id,promotion_discount_id,promotion_discount_code,promotion_customer_id,promotion_email,promotion_expires_at,expected_paid_cents,checkout_session_id,service_fee_cents",
        "Do not read or disclose unrelated private order metadata");
      if (state.databaseFails) {
        return Response.json({ message: "fixture-private-payment-secret" }, { status: 400 });
      }
      const requestedId = url.searchParams.get("id");
      assert(requestedId?.startsWith("eq."));
      const rows = state.orders.filter((row) => `eq.${row.id}` === requestedId && row.user_id === userId);
      const selected = url.searchParams.get("select")!.split(",");
      return Response.json(rows.map((row) => Object.fromEntries(selected.map((key) => [key, row[key]]))));
    }
    throw new Error(`Status must never invoke providers, wallets or ledgers: ${url.href}`);
  }) as typeof fetch;
  try {
    const { handleRequest } = await import("../ai-credits/index.ts");
    const call = (id: unknown, extra: Record<string, unknown> = {}) => handleRequest(new Request("https://fixture/ai-credits", {
      method: "POST",
      headers: { Authorization: `Bearer ${fixtureJwt(userId)}` },
      body: JSON.stringify({ action: "checkout_status", order_id: id, ...extra }),
    }));
    await run({ call, state });
  } finally {
    Deno.env.get = originalEnv;
    globalThis.fetch = originalFetch;
  }
}

Deno.test("checkout status is tied to the exact authenticated order, never another top-up or return flag", async () => {
  await withFixture(async ({ call, state }) => {
    for (const [id, expected] of [[orderId, true], [foreignOrderId, false], [missingOrderId, false]] as const) {
      const result = await call(id, { user_id: foreignUserId, credit_checkout: "returned", confirmed: true });
      assert(result.status === 200 && JSON.stringify(await result.json()) === JSON.stringify({ confirmed: expected }),
        "The response must contain only the authoritative confirmation boolean");
    }
    // An unrelated confirmed purchase exists, but this checkout is still pending.
    state.orders[0] = { id: orderId, user_id: userId, ...paidOrder, payment_id: null, paid_cents: null };
    state.orders.push({ id: missingOrderId, user_id: userId, ...paidOrder });
    const pending = await call(orderId);
    assert(pending.status === 200 && (await pending.json()).confirmed === false);
    assert(state.orderReads === 4 && state.rateReads === 4);
  });
});

Deno.test("checkout status rejects noncanonical order IDs before private reads or rate reservation", async () => {
  await withFixture(async ({ call, state }) => {
    for (const invalid of [undefined, null, 1, {}, [], "", "pay_fixture", `${orderId}\n`, ` ${orderId}`,
      "40000000-0000-0000-8000-000000000001", "40000000-0000-4000-0000-000000000001"]) {
      const result = await call(invalid);
      assert(result.status === 400 && JSON.stringify(await result.json()) === '{"error":"Invalid Coin order."}');
    }
    assert(state.rateReads === 0 && state.orderReads === 0);
  });
});

Deno.test("checkout status confirms unreversed paid credit and refuses pending, refunded, disputed or malformed receipts", async () => {
  await withFixture(async ({ call, state }) => {
    const denied = [
      { payment_id: null }, { payment_id: "" }, { payment_id: "   " },
      { paid_cents: null }, { paid_cents: 0 }, { paid_cents: -1 }, { paid_cents: 550.5 },
      { paid_cents: "550" }, { paid_cents: Number.MAX_SAFE_INTEGER + 1 },
      { credits_micros: 0 }, { credits_micros: -1 }, { credits_micros: Number.MAX_SAFE_INTEGER + 1 },
      { refunded_micros: 5_000_000 }, { refunded_micros: 5_000_001 },
      { refunded_micros: -1 }, { refunded_micros: null }, { refunded_micros: "0" },
      { disputed: true }, { disputed: null }, { disputed: undefined },
    ];
    for (const patch of denied) {
      state.orders[0] = { id: orderId, user_id: userId, ...paidOrder, ...patch };
      const result = await call(orderId);
      assert(result.status === 200 && JSON.stringify(await result.json()) === '{"confirmed":false}',
        `Invalid or unusable order must not confirm: ${JSON.stringify(patch)}`);
    }
    for (const refunded_micros of [0, 1, 2_500_000, 4_999_999]) {
      state.orders[0] = { id: orderId, user_id: userId, ...paidOrder, refunded_micros };
      const result = await call(orderId);
      assert(result.status === 200 && JSON.stringify(await result.json()) === '{"confirmed":true}');
    }
    assert(state.orderReads === denied.length + 4);
  });
});

Deno.test("checkout status requires authentication/MFA and obeys the read rate limit before looking up an order", async () => {
  await withFixture(async ({ call, state }) => {
    state.authenticated = false;
    assert((await call(orderId)).status === 401);
    state.authenticated = true;
    state.mfa = true;
    assert((await call(orderId)).status === 403);
    assert(state.rateReads === 0 && state.orderReads === 0);
    state.mfa = false;
    state.rateAllowed = false;
    assert((await call(orderId)).status === 429);
    assert(Number(state.rateReads) === 1 && state.orderReads === 0);
  });
});

Deno.test("zero checkout status needs complete saved promotion authority and never exposes its private bindings", async () => {
  await withFixture(async ({ call, state }) => {
    const promotionOrder = { id: orderId, user_id: userId, ...paidOrder, paid_cents: 0,
      promotion_id: "70000000-0000-4000-8000-000000000001", promotion_discount_id: "dsc_fixture",
      promotion_discount_code: "FIXTURETEST", promotion_customer_id: "cus_fixture", promotion_email: "owner@fixture.test",
      promotion_expires_at: "2026-01-01T00:00:00Z", expected_paid_cents: 0, checkout_session_id: "session_fixture", service_fee_cents: 50 };
    state.orders[0] = promotionOrder;
    const valid = await call(orderId);
    assert(valid.status === 200 && JSON.stringify(await valid.json()) === '{"confirmed":true}',
      "A saved grant remains verifiable after the promotion expires");
    for (const patch of [{ promotion_id: null }, { checkout_session_id: null }, { expected_paid_cents: null },
      { promotion_customer_id: "" }, { service_fee_cents: 0 }, { credits_micros: 6_000_000 }, { disputed: true },
      { refunded_micros: 5_000_000 }, { payment_id: null }]) {
      state.orders[0] = { ...promotionOrder, ...patch };
      const denied = await call(orderId);
      assert(denied.status === 200 && JSON.stringify(await denied.json()) === '{"confirmed":false}');
    }
  });
});

Deno.test("checkout status fails closed with a generic response on a private database failure", async () => {
  await withFixture(async ({ call, state }) => {
    state.databaseFails = true;
    const result = await call(orderId);
    const body = await result.text();
    assert(result.status === 503 && body.includes("Coins are temporarily unavailable") &&
      !body.includes("fixture-private-payment-secret") && !body.includes("payment_id") && !body.includes(orderId));
    assert(state.orderReads === 1 && state.rateReads === 1);
  });
});
