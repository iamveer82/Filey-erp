import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

type Subscription = {
  id: string;
  customer: string | { id: string };
  status: string;
  created: number;
  current_period_end?: number;
  metadata?: Record<string, string> | null;
  items?: { data: { price: { id: string }; current_period_end?: number }[] };
};
type Provider = { subscriptions: { retrieve(id: string): Promise<Subscription> } };

/** Existing paid access is managed through billing instead of buying a second
 * subscription. Terminal/expired subscriptions can start a new checkout. */
export function stripeSubscriptionCheckoutAllowed(org: {
  plan: unknown;
  plan_status: unknown;
  cloud_grandfathered?: unknown;
}) {
  return (
    org.cloud_grandfathered !== true &&
    org.plan !== "ultra" &&
    !(
      ["pro", "business", "cloud"].includes(String(org.plan)) &&
      ["active", "trialing", "past_due"].includes(String(org.plan_status))
    )
  );
}

/** Webhook snapshots can arrive in any order. Only current provider state is
 * eligible for the service-only transaction; the snapshot supplies its id. */
export async function applyStripeSubscription(
  supa: SupabaseClient,
  provider: Provider,
  id: string,
  eventCreated: number,
  bind = false,
  prices: Record<string, string | undefined> = {},
  now = () => new Date()
) {
  if (
    !/^sub_[A-Za-z0-9]+$/.test(id) ||
    !Number.isSafeInteger(eventCreated) ||
    eventCreated <= 0
  )
    throw new Error("Invalid subscription event identity");
  const observed = now().toISOString();
  const current = await provider.subscriptions.retrieve(id);
  const customer =
    typeof current.customer === "string" ? current.customer : current.customer?.id;
  const period = current.current_period_end ?? current.items?.data[0]?.current_period_end;
  if (
    current.id !== id ||
    !/^cus_[A-Za-z0-9]+$/.test(customer ?? "") ||
    !Number.isSafeInteger(current.created) ||
    current.created <= 0 ||
    !Number.isSafeInteger(period) ||
    (period ?? 0) <= 0 ||
    ![
      "active",
      "trialing",
      "past_due",
      "incomplete",
      "incomplete_expired",
      "canceled",
      "unpaid",
      "paused",
    ].includes(current.status)
  )
    throw new Error("Current subscription state could not be verified");
  const price = current.items?.data[0]?.price.id;
  const matched = Object.entries(prices).find(
    ([, value]) => !!value && value === price
  )?.[0];
  // Old Stripe installs may have retired price configuration, but the
  // provider-owned subscription still carries Filey's original plan metadata.
  const plan = matched ?? current.metadata?.plan;
  if (!plan || !["pro", "business"].includes(plan))
    throw new Error("Unsupported Stripe subscription plan");
  const org = current.metadata?.org_id || null;
  if (org && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(org))
    throw new Error("Invalid Stripe workspace metadata");
  const { data, error } = await supa.rpc("filey_apply_stripe_subscription", {
    p_subscription: id,
    p_customer: customer,
    p_org: org,
    p_plan: plan,
    p_status: current.status,
    p_period_end: new Date(period! * 1000).toISOString(),
    p_created_at: new Date(current.created * 1000).toISOString(),
    p_event_at: new Date(eventCreated * 1000).toISOString(),
    p_observed_at: observed,
    p_bind: bind,
  });
  if (error || typeof data !== "string")
    throw new Error("Subscription update could not be saved. Delivery will be retried.");
  return data;
}
