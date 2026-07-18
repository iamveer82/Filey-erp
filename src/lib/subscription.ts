import { supabase, invokeFn } from "./supabase";

/* Client side of Stripe billing. Reads the org's plan (RLS scopes it to the
 * member's own org) and invokes the `stripe` edge function for checkout /
 * the billing portal. Live once the function is deployed and keys are set. */

export type Plan = "free" | "pro" | "business" | "enterprise";

/** How a plan card is sold: monthly subscription via Stripe, one-time
 * offline license via the license checkout, or contact-sales only. */
export type PlanKind = "subscription" | "license" | "contact";

export interface PlanCard {
  /** Card identity; also the org plan value for subscription plans. */
  id: "free" | "lite" | "pro" | "enterprise";
  kind: PlanKind;
  name: string;
  price: string;
  period?: string;
  blurb: string;
  recommended?: boolean;
  features: string[];
}

export const PLANS: PlanCard[] = [
  {
    id: "free",
    kind: "subscription",
    name: "Free",
    price: "$0",
    blurb: "Start free with the essentials.",
    features: [
      "Core ERP & CRM — all modules",
      "20 invoices/month",
      "Cloud account — 1 device",
      "“Made with Filey” on documents",
      "Bring-your-own AI key",
    ],
  },
  {
    id: "lite",
    kind: "license",
    name: "Offline",
    price: "$99",
    period: " one-time",
    blurb: "Own it outright — runs fully offline.",
    features: [
      "Everything in Free — no monthly cap",
      "Fully offline — data stays on your device",
      "2 device slots",
      "Free updates included",
      "No watermark",
    ],
  },
  {
    id: "pro",
    kind: "subscription",
    name: "Pro",
    price: "$19",
    period: "/month",
    blurb: "Cloud sync for growing businesses.",
    recommended: true,
    features: [
      "Everything in Offline",
      "Cloud sync, backup & multi-device",
      "Up to 5 devices, team included",
      "Recurring invoices",
      "Priority support",
    ],
  },
  {
    id: "enterprise",
    kind: "contact",
    name: "Enterprise",
    price: "Custom",
    blurb: "For teams that run on Filey.",
    features: [
      "Everything in Pro",
      "Team seats & roles",
      "Customer portal",
      "Highest limits",
      "Priority onboarding",
    ],
  },
];

/** Map an org's stored plan value onto its display card (legacy "business"
 *  subscribers show as Enterprise). */
export function planCardFor(orgPlan: string | null | undefined): PlanCard {
  if (orgPlan === "business" || orgPlan === "enterprise")
    return PLANS.find((p) => p.id === "enterprise")!;
  return PLANS.find((p) => p.id === orgPlan) ?? PLANS[0];
}

export interface Subscription {
  plan: Plan;
  plan_status?: string | null;
  current_period_end?: string | null;
}

export async function getSubscription(): Promise<Subscription> {
  if (!supabase) return { plan: "free" };
  const { data } = await supabase
    .from("organizations")
    .select("plan, plan_status, current_period_end")
    .limit(1)
    .maybeSingle();
  return {
    plan: (data?.plan as Plan) ?? "free",
    plan_status: data?.plan_status ?? null,
    current_period_end: data?.current_period_end ?? null,
  };
}

async function invokeStripe(body: Record<string, unknown>): Promise<string> {
  if (!supabase) throw new Error("Not configured");
  const { data, error } = (await invokeFn(supabase, "stripe", { body })) as {
    data: { url?: string; error?: string } | null;
    error: { message: string } | null;
  };
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  if (!data?.url)
    throw new Error("Billing isn't set up yet — add Stripe keys to the edge function.");
  return data.url as string;
}

export async function startCheckout(plan: Plan): Promise<void> {
  window.location.href = await invokeStripe({ action: "checkout", plan });
}

export async function openBillingPortal(): Promise<void> {
  window.location.href = await invokeStripe({ action: "portal" });
}
