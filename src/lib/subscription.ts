import { supabase } from "./supabase";

/* Client side of Stripe billing. Reads the org's plan (RLS scopes it to the
 * member's own org) and invokes the `stripe` edge function for checkout /
 * the billing portal. Live once the function is deployed and keys are set. */

export type Plan = "free" | "pro" | "business";

export interface Subscription {
  plan: Plan;
  plan_status?: string | null;
  current_period_end?: string | null;
}

export const PLANS: { id: Plan; name: string; price: string; features: string[] }[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    features: ["Core ERP & CRM", "Bring-your-own AI key", "Community support"],
  },
  {
    id: "pro",
    name: "Pro",
    price: "$19/mo",
    features: ["Everything in Free", "More storage", "Recurring invoices", "Priority support"],
  },
  {
    id: "business",
    name: "Business",
    price: "$49/mo",
    features: ["Everything in Pro", "Team seats", "Customer portal", "Highest limits"],
  },
];

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
  const { data, error } = await supabase.functions.invoke("stripe", { body });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  if (!data?.url) throw new Error("Billing isn't set up yet — add Stripe keys to the edge function.");
  return data.url as string;
}

export async function startCheckout(plan: Plan): Promise<void> {
  window.location.href = await invokeStripe({ action: "checkout", plan });
}

export async function openBillingPortal(): Promise<void> {
  window.location.href = await invokeStripe({ action: "portal" });
}
