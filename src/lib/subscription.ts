import { supabase } from "./supabase";
import { billingRequest, paymentUrl, openBilling } from "./billingService";
import { clearEntitlementCache, resolveTier } from "./license";

/* Client side of billing. Reads the org's plan (RLS scopes it to the member's
 * own org) and invokes the `dodo` edge function for checkout and the customer
 * portal. Dodo Payments is the merchant of record; Stripe is retired. */

export type Plan = "free" | "cloud" | "pro" | "business" | "enterprise";

/** How a plan card is sold: monthly subscription, one-time offline licence, or
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

/* Display names: Basic (id "free"), Pro (id "cloud"), Ultra (id "lite"). The
 * ids are what the database, the webhook and licence tokens store, so they
 * never follow a rename. */
export const PLANS: PlanCard[] = [
  {
    id: "free",
    kind: "subscription",
    name: "Basic",
    price: "$0",
    blurb: "On the web or your device, with 5 new invoices a month.",
    features: [
      "Core ERP & CRM, all modules",
      "5 new invoices per month, unlimited edits",
      "Filey on the web with cloud sync",
      "Local storage and backups on this device",
      "“Made with Filey” on documents",
      "Bring-your-own AI key",
    ],
  },
  {
    id: "cloud",
    kind: "subscription",
    name: "Pro",
    price: "$5",
    period: " / month",
    blurb: "Your workspace everywhere, on every device you use.",
    features: [
      "Cloud sync on up to 5 registered devices",
      "Filey on the web at app.gofiley.com",
      "Unlimited invoices — no monthly cap",
      "Team members share one workspace",
      "Backed up off your machine",
      "Cancel any time from Billing",
    ],
  },
  {
    // id stays "lite" — issued licence tokens key off it.
    id: "lite",
    kind: "license",
    name: "Ultra",
    price: "$100",
    period: " one-time",
    recommended: true,
    blurb: "Own it outright. Full local Filey, yours on your machine.",
    features: [
      "Unlimited invoices, no monthly cap",
      "Works fully offline — verified without a network",
      "2 device slots",
      "Free updates included",
      "No watermark",
      "Filey on the web at app.gofiley.com",
    ],
  },
];

/* Pro and Enterprise were withdrawn from sale: two plans, one of them free and
 * one bought outright. The Plan type below still carries "pro" / "business" /
 * "enterprise" on purpose — those values exist on real organizations rows, and
 * narrowing the type would make the app fail to read its own database. Anyone
 * already on one keeps every entitlement they had; resolveTier() in license.ts
 * is untouched, so nothing they can do today stops working. */

/** Map an org's stored plan value onto its display card. A plan that is no
 *  longer sold has no card of its own, so it shows as Freedom — the closest
 *  thing still on the menu, and never a downgrade in what it implies. */
export function planCardFor(orgPlan: string | null | undefined): PlanCard {
  if (orgPlan === "pro" || orgPlan === "business" || orgPlan === "enterprise")
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
  const { data: orgId, error: orgError } = await supabase.rpc("current_org");
  if (orgError) throw orgError;
  if (!orgId) return { plan: "free" };
  const { data, error } = await supabase
    .from("organizations")
    .select("plan, plan_status, current_period_end")
    .eq("id", orgId)
    .maybeSingle();
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
  for (let attempt = 0; attempt < attempts; attempt++) {
    const sub = await getSubscription();
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
