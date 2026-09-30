import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  applyStripeSubscription,
  stripeSubscriptionCheckoutAllowed,
} from "./stripe-subscriptions.ts";

const subscription = (patch = {}) => ({
  id: "sub_current",
  customer: "cus_owner",
  status: "active",
  created: 100,
  current_period_end: 200,
  metadata: { plan: "pro", org_id: "10000000-0000-0000-0000-000000000001" },
  items: { data: [{ price: { id: "price_pro" } }] },
  ...patch,
});
function database(result: unknown = "applied", error: unknown = null) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const supa = {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return Promise.resolve({ data: result, error });
    },
  } as unknown as SupabaseClient;
  return { supa, calls };
}
const observed = () => new Date("2026-10-01T00:00:00Z");

Deno.test(
  "Stripe checkout rejects existing paid access while free and expired access can renew",
  () => {
    for (const plan of ["pro", "business", "cloud"])
      for (const plan_status of ["active", "trialing", "past_due"])
        assertEquals(stripeSubscriptionCheckoutAllowed({ plan, plan_status }), false);
    assertEquals(
      stripeSubscriptionCheckoutAllowed({ plan: "ultra", plan_status: "active" }),
      false
    );
    assertEquals(
      stripeSubscriptionCheckoutAllowed({
        plan: "free",
        plan_status: "inactive",
        cloud_grandfathered: true,
      }),
      false
    );
    for (const plan_status of ["canceled", "incomplete_expired", "inactive", "unpaid"])
      assertEquals(stripeSubscriptionCheckoutAllowed({ plan: "pro", plan_status }), true);
    assertEquals(
      stripeSubscriptionCheckoutAllowed({ plan: "free", plan_status: "inactive" }),
      true
    );
  }
);

Deno.test(
  "Stripe lifecycle reads current provider state; a stale snapshot cannot grant or cancel",
  async () => {
    const db = database();
    const ids: string[] = [];
    const provider = {
      subscriptions: {
        retrieve(id: string) {
          ids.push(id);
          return Promise.resolve(subscription({ status: "canceled" }));
        },
      },
    };
    assertEquals(
      await applyStripeSubscription(
        db.supa,
        provider,
        "sub_current",
        150,
        false,
        {},
        observed
      ),
      "applied"
    );
    assertEquals(ids, ["sub_current"]);
    assertEquals(db.calls[0].name, "filey_apply_stripe_subscription");
    assertEquals(db.calls[0].args, {
      p_subscription: "sub_current",
      p_customer: "cus_owner",
      p_org: "10000000-0000-0000-0000-000000000001",
      p_plan: "pro",
      p_status: "canceled",
      p_period_end: "1970-01-01T00:03:20.000Z",
      p_created_at: "1970-01-01T00:01:40.000Z",
      p_event_at: "1970-01-01T00:02:30.000Z",
      p_observed_at: "2026-10-01T00:00:00.000Z",
      p_bind: false,
    });
  }
);

Deno.test(
  "Stripe checkout binding uses current price instead of stale plan metadata and expanded references",
  async () => {
    const db = database("ignored replaced subscription");
    const provider = {
      subscriptions: {
        retrieve() {
          return Promise.resolve(
            subscription({
              customer: { id: "cus_owner" },
              current_period_end: undefined,
              items: {
                data: [{ price: { id: "price_business" }, current_period_end: 250 }],
              },
            })
          );
        },
      },
    };
    assertEquals(
      await applyStripeSubscription(
        db.supa,
        provider,
        "sub_current",
        150,
        true,
        { pro: "price_pro", business: "price_business" },
        observed
      ),
      "ignored replaced subscription"
    );
    assertEquals(db.calls[0].args.p_plan, "business");
    assertEquals(db.calls[0].args.p_bind, true);
    assertEquals(db.calls[0].args.p_customer, "cus_owner");
  }
);

Deno.test(
  "Stripe lifecycle rejects invalid identity and unverifiable provider state without saving",
  async () => {
    const db = database();
    const provider = {
      subscriptions: {
        retrieve() {
          return Promise.resolve(subscription());
        },
      },
    };
    for (const [id, time] of [
      ["null", 150],
      ["sub_current", NaN],
      ["sub_current", 0],
    ] as [string, number][])
      await assertRejects(
        () => applyStripeSubscription(db.supa, provider, id, time),
        Error,
        "Invalid subscription"
      );
    for (const patch of [
      { id: "sub_other" },
      { customer: "null" },
      { current_period_end: NaN },
      { created: 0 },
      { status: "invented" },
      { metadata: { plan: "unknown" } },
      { metadata: { plan: "pro", org_id: "OTHER" } },
    ]) {
      await assertRejects(() =>
        applyStripeSubscription(
          db.supa,
          {
            subscriptions: {
              retrieve() {
                return Promise.resolve(subscription(patch));
              },
            },
          },
          "sub_current",
          150
        )
      );
    }
    assertEquals(db.calls.length, 0);
  }
);

Deno.test(
  "Stripe provider and database failures request retry; missing migration never acknowledges access",
  async () => {
    const db = database();
    await assertRejects(
      () =>
        applyStripeSubscription(
          db.supa,
          {
            subscriptions: {
              retrieve() {
                return Promise.reject(new Error("provider unavailable"));
              },
            },
          },
          "sub_current",
          150
        ),
      Error,
      "provider unavailable"
    );
    assertEquals(db.calls.length, 0);
    const provider = {
      subscriptions: {
        retrieve() {
          return Promise.resolve(subscription());
        },
      },
    };
    for (const failure of [database(null, { code: "PGRST202" }), database(null)])
      await assertRejects(
        () => applyStripeSubscription(failure.supa, provider, "sub_current", 150),
        Error,
        "will be retried"
      );
  }
);
