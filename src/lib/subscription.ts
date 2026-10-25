import { supabase } from "./supabase";
import { billingRequest, paymentUrl, openBilling } from "./billingService";
import { clearEntitlementCache, resolveTier, CLOUD_DEVICE_LIMIT } from "./license";
import { agentStorageScope } from "./agentStorage";

/* Client side of billing. Reads the org's plan (RLS scopes it to the member's
 * own org) and invokes the `dodo` edge function for checkout and the customer
 * portal. Dodo Payments is the merchant of record; Stripe is retired. */

export type Plan = "free" | "cloud" | "pro" | "business" | "enterprise";

/** How a plan card is sold: monthly subscription, one-time paid licence, or
 * contact-sales only. */
export type PlanKind = "subscription" | "license" | "contact";

export interface PlanCard {
  /** Card identity; also the org plan value for subscription plans. */
  id: "free" | "cloud" | "lite" | "pro" | "enterprise";
  kind: PlanKind;
  name: string;
  price: string;
  period?: string;
  blurb: string;
  recommended?: boolean;
  features: string[];
}

/* Display names: Basic (id "free", the 14-day trial), Pro (id "cloud"), Freedom (id "lite").
 * The ids are what the database, the webhook and licence tokens store, so they never follow
 * a rename. Prices are what Dodo charges: Pro 36 AED a month, Freedom 1499 AED once. */
export const PLANS: PlanCard[] = [
  {
    id: "free",
    kind: "subscription",
    name: "Basic",
    price: "Free",
    period: " for 14 days",
    blurb: "Try all of Filey free for 14 days on your computer. No card needed.",
    features: [
      "Every app: invoicing, CRM, inventory, accounting, Word, Sheets, PDF and Slides",
      "Your data saved on your computer",
      "$1 of Filey AI to try the agent",
      "Keep everything you made when you get Freedom",
    ],
  },
  {
    id: "cloud",
    kind: "subscription",
    name: "Pro",
    price: "36 AED",
    period: " / month",
    blurb: "Your workspace in the cloud, on every device you use.",
    features: [
      `Cloud sync on up to ${CLOUD_DEVICE_LIMIT} devices`,
      "Filey on the web at app.gofiley.com",
      "Team members share one workspace",
      "Backed up off your machine",
      "Every app, unlimited invoices",
      "Cancel any time from Billing",
    ],
  },
  {
    // id stays "lite": issued licence tokens key off it.
    id: "lite",
    kind: "license",
    name: "Freedom",
    price: "1499 AED",
    period: " one-time",
    recommended: true,
    blurb: "Filey on your computer for life. Pay once, own it.",
    features: [
      "Lifetime use of Filey, every app",
      "Regular updates and support",
      "Your data stays on your computer",
      "On 2 computers, and move it to a new PC any time",
      "No monthly bill",
    ],
  },
  {
    id: "enterprise",
    kind: "contact",
    name: "Enterprise",
    price: "Custom",
    blurb: "Volume licensing, onboarding and support for larger teams.",
    features: [
      "Custom device and seat counts",
      "Priority onboarding",
      "Deployment planning and support",
      "Talk to us about your deployment",
    ],
  },
];

/* Legacy Pro and Business values remain readable for existing organizations.
 * Display-card mapping does not change their resolveTier() entitlements. */

/** Map an org's stored plan value onto its display card. A plan that is no
 *  longer sold has no card of its own, so it shows as Freedom — the closest
 *  thing still on the menu, and never a downgrade in what it implies. */
export function planCardFor(orgPlan: string | null | undefined): PlanCard {
  if (orgPlan === "pro" || orgPlan === "business")
    return PLANS.find((p) => p.id === "lite")!;
  return PLANS.find((p) => p.id === orgPlan) ?? PLANS[0];
}

export interface Subscription {
  plan: Plan;
  plan_status?: string | null;
  current_period_end?: string | null;
}

export async function getSubscription(): Promise<Subscription> {
  if (!supabase) return { plan: "free" };
  const scope = agentStorageScope();
  const assertCurrent = () => {
    if (scope !== agentStorageScope()) throw new Error("Your workspace changed. Reopen Billing.");
  };
  const { data: orgId, error: orgError } = await supabase.rpc("current_org");
  assertCurrent();
  if (orgError) throw orgError;
  if (!orgId) return { plan: "free" };
  const { data, error } = await supabase
    .from("organizations")
    .select("plan, plan_status, current_period_end")
    .eq("id", orgId)
    .maybeSingle();
  assertCurrent();
  if (error) throw error;
  return {
    plan: (data?.plan as Plan) ?? "free",
    plan_status: data?.plan_status ?? null,
    current_period_end: data?.current_period_end ?? null,
  };
}

async function invokeDodo(body: Record<string, unknown>): Promise<string> {
  const data = await billingRequest<{ url?: string }>(body);
  return paymentUrl(data?.url);
}

/** Subscribe to the Cloud plan. The webhook sets the org's plan; the caller
 *  refreshes the subscription afterwards to show it. */
export async function startCheckout(
  plan: Plan = "cloud"
): Promise<"redirected" | "browser"> {
  if (plan !== "cloud") throw new Error(`No checkout for the ${plan} plan.`);
  return openBilling(await invokeDodo({ action: "checkout_cloud", from: "app" }));
}

/** Dodo's customer portal: change card, download invoices, cancel. */
export async function openBillingPortal(): Promise<"redirected" | "browser"> {
  return openBilling(await invokeDodo({ action: "portal" }));
}

export interface SubscriptionRefund {
  id: string;
  org_id: string;
  payment_id: string;
  amount: number;
  currency: string;
  reason: string;
  status: string;
  refunded_amount: number;
  review_note: string;
  created_at: string;
}
export interface RefundOverview {
  requests: SubscriptionRefund[];
  queue: SubscriptionRefund[];
  reviewer: boolean;
  can_manage: boolean;
}
export interface RefundPayment {
  payment_id: string;
  amount: number;
  currency: string;
  created_at: string;
}
/** Financial actions deliberately bypass invokeFn's automatic retries. */
export async function refundAction<T>(body: Record<string, unknown>): Promise<T> {
  return billingRequest<T>(body);
}

/** Poll the org's plan until the webhook has switched it on, for the desktop
 *  flow where the buyer pays in a separate browser window and this one waits. */
export async function awaitCloudPlan(
  attempts = 60,
  delayMs = 5000
): Promise<Subscription | null> {
  const scope = agentStorageScope();
  const assertCurrent = () => {
    if (scope !== agentStorageScope()) throw new Error("Your workspace changed. Reopen Billing.");
  };
  for (let attempt = 0; attempt < attempts; attempt++) {
    assertCurrent();
    const sub = await getSubscription();
    assertCurrent();
    if (resolveTier(false, sub.plan, sub.plan_status) === "pro") {
      // Tier and cloud access are cached; without this the app keeps refusing
      // to sync for someone whose subscription just went live.
      clearEntitlementCache();
      return sub;
    }
    if (attempt < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}
