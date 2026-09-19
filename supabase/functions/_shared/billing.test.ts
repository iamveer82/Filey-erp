// Runnable check for the subscription → plan mapping. These assertions are
// the difference between "your card failed" and "your business is locked out".
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buyerOf, grantsCloud, planPatchFor } from "./billing.ts";

Deno.test("an active subscription puts the org on the paid plan", () => {
  const patch = planPatchFor("active", "2026-10-15T00:00:00Z");
  assertEquals(patch.plan, "cloud");
  assertEquals(patch.plan_status, "active");
  assertEquals(patch.current_period_end, "2026-10-15T00:00:00Z");
});

Deno.test("a failed renewal keeps the cloud working while the card is retried", () => {
  for (const status of ["past_due", "on_hold"]) {
    const patch = planPatchFor(status);
    assertEquals(patch.plan, "cloud", `${status} must not drop the plan`);
    // resolveTier() only recognises active/trialing/past_due as entitled, so
    // on_hold has to be reported as past_due or the client locks them out.
    assertEquals(patch.plan_status, "past_due");
    assertEquals(grantsCloud(status), true);
  }
});

Deno.test("ending a subscription returns the org to free", () => {
  for (const status of ["cancelled", "expired", "failed", "paused"]) {
    assertEquals(planPatchFor(status).plan, "free", `${status} must drop to free`);
    assertEquals(grantsCloud(status), false);
  }
});

Deno.test("a subscription that was never paid grants nothing", () => {
  assertEquals(planPatchFor("pending").plan, "free");
  assertEquals(grantsCloud("pending"), false);
  // An unknown future status must fail closed, not fall through as paid.
  assertEquals(planPatchFor("some_new_status_dodo_adds").plan, "free");
  assertEquals(grantsCloud("some_new_status_dodo_adds"), false);
});

Deno.test("a storefront purchase with no metadata is recognised by product and email", () => {
  const storefront = { product_cart: [{ product_id: "pdt_ultra" }], customer: { email: "a@b.co" } };
  assertEquals(buyerOf(storefront, "pdt_ultra", "freedom_license"), { email: "a@b.co" });
  assertEquals(buyerOf(storefront, "pdt_pro", "cloud_subscription"), null);
  const sub = { product_id: "pdt_pro", customer: { email: "a@b.co" } };
  assertEquals(buyerOf(sub, "pdt_pro", "cloud_subscription"), { email: "a@b.co" });
});

Deno.test("our own checkouts are identified by metadata, never by product", () => {
  const inApp = { metadata: { type: "freedom_license", user_id: "u1" }, product_cart: [{ product_id: "pdt_ultra" }] };
  assertEquals(buyerOf(inApp, "pdt_ultra", "freedom_license"), { userId: "u1", orgId: undefined, email: undefined });
  const cloudFirstCharge = { metadata: { type: "cloud_subscription" }, product_cart: [{ product_id: "pdt_pro" }] };
  assertEquals(buyerOf(cloudFirstCharge, "pdt_pro", "freedom_license"), null);
  // An unset product id must never match a payload that also lacks one.
  assertEquals(buyerOf({ customer: { email: "a@b.co" } }, "", "freedom_license"), null);
});
