// Runnable check for the subscription → plan mapping. These assertions are
// the difference between "your card failed" and "your business is locked out".
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { grantsCloud, planPatchFor } from "./billing.ts";

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
