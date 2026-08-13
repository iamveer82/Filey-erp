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
    price: "AED 0",
    blurb: "Start free with the essentials.",
    features: [
      "Core ERP & CRM — all modules",
      "5 invoices/month",
      "Cloud sync & backup included",
      "“Made with Filey” on documents",
      "Bring-your-own AI key",
    ],
  },
  {
    // id stays "lite" — Stripe products and issued licence tokens key off it.
    id: "lite",
    kind: "license",
    name: "Freedom",
    price: "AED 1,499",
    period: " one-time",
    recommended: true,
    blurb: "Own it outright — yours, on your machine.",
    features: [
      "Unlimited invoices — no monthly cap",
      "Works fully offline — data stays on your device",
      "Cloud sync on demand, whenever you want it",
      "2 device slots",
      "Free updates included",
      "No watermark",
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
