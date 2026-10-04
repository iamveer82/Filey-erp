// All requests and identities are synthetic. No payment/auth endpoint is contacted.
// deno-lint-ignore-file require-await
import { fixtureJwt } from "./test-auth-fixture.ts";

function assert(ok: unknown, message = "Assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}
const user = "33000000-0000-4000-8000-000000000001";
const vars: Record<string, string> = {
  SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key",
  STRIPE_WEBHOOK_SECRET: "fixture-webhook-secret", STRIPE_PRICE_PRO: "price_fixture",
};

Deno.test("legacy billing bounds untrusted bodies and license activation works without retired Stripe credentials", async () => {
  const originalEnv = Deno.env.get, originalFetch = globalThis.fetch;
  Deno.env.get = (name) => vars[name];
  let calls = 0, licenseCalls = 0;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    calls++;
    assert(url.hostname === "fixture.supabase.co", "License-only calls cannot require Stripe");
    if (url.pathname === "/auth/v1/user") return Response.json({ id: user, factors: [] });
    if (url.pathname.endsWith("/filey_take_rate_limit")) return Response.json(true);
    if (url.pathname.endsWith("/audit_log")) return Response.json(null, { status: 201 });
    if (url.pathname.endsWith("/filey_claim_license_device")) {
      const body = await req.json();
      assert(body.p_user === user && body.p_fingerprint === "fixture-device");
      licenseCalls++;
      return Response.json({ code: "PT404", message: "No active license" }, { status: 404 });
    }
    if (url.pathname.endsWith("/licenses")) {
      assert(url.searchParams.get("user_id") === `eq.${user}`);
      licenseCalls++;
      return Response.json([]);
    }
    throw new Error("Unexpected fixture path");
  };
  try {
    const { handleRequest } = await import("../stripe/index.ts");
    const invoke = (body: string, headers: HeadersInit = {}) => handleRequest(new Request("https://fixture/stripe", { method: "POST", headers, body }));
    assert((await handleRequest(new Request("https://fixture/stripe"))).status === 405);
    for (const body of ["null", "[]", "false", "{", '{"action":{}}', '{"action":"unknown"}'])
      assert((await invoke(body)).status === 400);
    for (const headers of [new Headers(), new Headers({ "content-length": "1" })])
      assert((await invoke(JSON.stringify({ action: "license_activate", extra: "a".repeat(20000) }), headers)).status === 413);
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(4096)); }, cancel() { canceled = true; } });
    assert((await handleRequest(new Request("https://fixture/stripe", { method: "POST", body: stream }))).status === 413 && canceled);
    assert((await invoke("a".repeat(1000001), { "stripe-signature": "invalid" })).status === 413);
    assert((await invoke('{"action":"pay_invoice"}')).status === 410);
    assert(calls === 0, "Malformed/oversized/retired requests cannot trigger auth or billing side effects");
    const headers = { Authorization: `Bearer ${fixtureJwt(user)}` };
    for (const action of ["license_activate", "license_deactivate"])
      assert((await invoke(JSON.stringify({ action, fingerprint: "fixture-device" }), headers)).status === 404);
    assert(licenseCalls === 2, "Both old license operations remain usable with no Stripe secret");
  } finally {
    Deno.env.get = originalEnv;
    globalThis.fetch = originalFetch;
  }
});

Deno.test("legacy billing redacts provider/database/signature details and still accepts a signed webhook", async () => {
  const originalEnv = Deno.env.get, originalFetch = globalThis.fetch;
  Deno.env.get = (name) => name === "STRIPE_SECRET_KEY" ? "sk_test_fixture" : vars[name];
  const privateDetail = "fixture-stripe-key-private-customer-and-row";
  let providerCalls = 0, failSettlement = false;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    if (url.hostname === "api.stripe.com") {
      providerCalls++;
      return Response.json({ error: { type: "invalid_request_error", message: privateDetail } }, { status: 400 });
    }
    assert(url.hostname === "fixture.supabase.co", "Unexpected live request");
    if (url.pathname === "/auth/v1/user") return Response.json({ id: user, factors: [] });
    if (url.pathname.endsWith("/filey_take_rate_limit")) return Response.json(true);
    if (url.pathname.endsWith("/audit_log")) return Response.json(null, { status: 201 });
    if (url.pathname.endsWith("/profiles")) return Response.json([{ org_id: "fixture-org" }]);
    if (url.pathname.endsWith("/org_members")) return Response.json([{ role: "owner" }]);
    if (url.pathname.endsWith("/organizations")) return Response.json([{ id: "fixture-org", plan: "free", plan_status: "active", stripe_customer_id: "cus_fixture" }]);
    if (url.pathname.endsWith("/filey_settle_stripe_checkout")) return failSettlement ? Response.json({ code: "XX000", message: privateDetail }, { status: 500 }) : Response.json({ received: true });
    throw new Error("Unexpected fixture route");
  };
  const sign = async (raw: string) => {
    const t = String(Math.floor(Date.now() / 1000));
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(vars.STRIPE_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${raw}`)));
    return `t=${t},v1=${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  };
  try {
    const { handleRequest } = await import("../stripe/index.ts");
    const call = async (body: unknown) => {
      const res = await handleRequest(new Request("https://fixture/stripe", { method: "POST", headers: { Authorization: `Bearer ${fixtureJwt(user)}` }, body: JSON.stringify(body) }));
      return { status: res.status, text: await res.text() };
    };
    const invalidPlan = await call({ action: "checkout", plan: "__proto__" });
    assert(invalidPlan.status === 400 && providerCalls === 0, "A reflected or inherited plan must never create a provider customer");
    const failedProvider = await call({ action: "portal" });
    assert(failedProvider.status === 503 && !failedProvider.text.includes(privateDetail) && Number(providerCalls) === 1);
    const invalidSignature = await handleRequest(new Request("https://fixture/stripe", { method: "POST", headers: { "stripe-signature": "invalid" }, body: "{}" }));
    assert(invalidSignature.status === 401 && await invalidSignature.text() === '{"error":"Invalid webhook signature."}');
    const raw = JSON.stringify({ id: "evt_fixture", created: Math.floor(Date.now() / 1000), type: "checkout.session.completed", data: { object: { id: "cs_fixture", mode: "payment", payment_status: "paid", amount_total: 5000, currency: "usd", payment_intent: "pi_fixture", metadata: { type: "lite_license", user_id: user } } } });
    for (const failed of [false, true]) {
      failSettlement = failed;
      const response = await handleRequest(new Request("https://fixture/stripe", { method: "POST", headers: { "stripe-signature": await sign(raw) }, body: raw }));
      assert(response.status === (failed ? 503 : 200) && !(await response.text()).includes(privateDetail), "Verified settlement works and failed delivery retains retry without row leakage");
    }
  } finally {
    Deno.env.get = originalEnv;
    globalThis.fetch = originalFetch;
  }
});
