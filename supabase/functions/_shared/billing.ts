// Filey — what a Dodo subscription status means for an organisation's plan.
//
// Kept separate from the webhook plumbing because this is the part that
// decides whether someone can still use the cloud tomorrow morning, and it
// should be readable and testable without a payment provider in the room.

/** Statuses Dodo can report for a subscription. */
export type DodoSubscriptionStatus =
  | "pending"
  | "active"
  | "on_hold"
  | "paused"
  | "cancelled"
  | "failed"
  | "expired"
  | "past_due";

export interface PlanPatch {
  plan: string;
  plan_status: string;
  current_period_end: string | null;
}

/** The plan an org lands on for a given subscription status.
 *
 *  `past_due` and `on_hold` both keep the cloud working: a card that failed on
 *  a $1 renewal is a card problem, not a decision to stop using the product,
 *  and locking someone out of their own invoices over it costs more than the
 *  dollar. resolveTier() in the app already treats past_due as entitled, which
 *  is why on_hold is reported as past_due rather than inventing a status the
 *  client would not recognise.
 *
 *  Everything terminal drops to free. `pending` has never been paid, so it
 *  grants nothing either. */
export function planPatchFor(
  status: DodoSubscriptionStatus | string,
  nextBillingDate?: string | null,
  paidPlan = "cloud"
): PlanPatch {
  const periodEnd = nextBillingDate ?? null;
  switch (status) {
    case "active":
      return { plan: paidPlan, plan_status: "active", current_period_end: periodEnd };
    case "past_due":
    case "on_hold":
      return { plan: paidPlan, plan_status: "past_due", current_period_end: periodEnd };
    case "paused":
      return { plan: "free", plan_status: "paused", current_period_end: periodEnd };
    case "cancelled":
      return { plan: "free", plan_status: "canceled", current_period_end: periodEnd };
    case "expired":
      return { plan: "free", plan_status: "expired", current_period_end: periodEnd };
    case "failed":
      return { plan: "free", plan_status: "failed", current_period_end: periodEnd };
    case "pending":
    default:
      return { plan: "free", plan_status: status || "unknown", current_period_end: periodEnd };
  }
}

/** Does this status leave the org able to use paid cloud features? Mirrors
 *  resolveTier() in src/lib/license.ts — if these two ever disagree, someone
 *  is either paying for nothing or using what they stopped paying for. */
export const grantsCloud = (status: DodoSubscriptionStatus | string): boolean =>
  planPatchFor(status).plan !== "free";
