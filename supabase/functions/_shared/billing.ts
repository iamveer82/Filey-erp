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
 *  a $5 renewal is a card problem, not a decision to stop using the product,
 *  and locking someone out of their own invoices over it costs more than the
 *  charge. resolveTier() in the app already treats past_due as entitled, which
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

/** Who bought what, in the fields this app needs from a Dodo payload. */
export interface DodoPurchase {
  metadata?: Record<string, string> | null;
  product_cart?: { product_id?: string }[] | null;
  product_id?: string | null;
  customer?: { email?: string | null } | null;
}

/** The buyer behind a purchase of `product`, or null when it is not one.
 *
 *  Checkouts this app creates carry metadata saying what they are and whose
 *  they are. Dodo's own storefront and payment links carry none — so without
 *  this fallback a customer who paid there got nothing. For those, the product
 *  id says what was bought and the email Dodo collected says who bought it.
 *  A plan can have several ids: the one on sale now and retired ones whose
 *  subscriptions still send renewals and expiries. */
export function buyerOf(
  data: DodoPurchase,
  product: string | string[],
  type: "freedom_license" | "cloud_subscription"
): { userId?: string; orgId?: string; email?: string } | null {
  const meta = data.metadata ?? {};
  const ids = [product].flat().filter(Boolean);
  const bought =
    ids.includes(data.product_id ?? "") || (data.product_cart ?? []).some((i) => ids.includes(i.product_id ?? ""));
  if (!bought || (meta.type && meta.type !== type)) return null;
  const email = data.customer?.email || meta.email || undefined;
  return meta.type ? { userId: meta.user_id, orgId: meta.org_id, email } : { email };
}

/** Share of the price a refund under Filey's policy returns (gofiley.com/refunds).
 *  The other 10% covers payment costs. */
export const REFUND_SHARE = 0.9;

/** Each line of a payment refunded at REFUND_SHARE, in Dodo's partial-refund shape. */
export function policyRefundItems(items: { items_id: string; refundable_amount: number }[]) {
  return items
    .filter((i) => Number.isSafeInteger(i.refundable_amount) && i.refundable_amount > 0)
    .map((i) => ({ item_id: i.items_id, amount: Math.floor(i.refundable_amount * REFUND_SHARE), tax_inclusive: true }));
}

/** The parts of a Dodo payment that say whether its money went back. */
export interface DodoReversible {
  currency?: string | null;
  total_amount?: number | null;
  settlement_amount?: number | null;
  settlement_currency?: string | null;
  refunds?: { status?: string | null; amount?: number | null; currency?: string | null; is_partial?: boolean | null }[] | null;
  disputes?: { dispute_status?: string | null }[] | null;
}

/** Why a one-time purchase no longer stands, or null while it does.
 *
 *  Dodo takes its own entitlements back on a refund and on a dispute the
 *  merchant lost or accepted; a Freedom licence follows the same rule. Filey's
 *  refunds return 90% (REFUND_SHARE), so anything from half the price up counts
 *  as a refund. A small goodwill refund keeps the licence, and an open or won
 *  dispute changes nothing until it is decided.
 *
 *  A refund can be entered in the customer's currency or in the settlement
 *  currency, so each one is measured against the total in its own currency. */
export function licenceReversal(p: DodoReversible): "refunded" | "charged_back" | null {
  if ((p.disputes ?? []).some((d) => d.dispute_status === "dispute_lost" || d.dispute_status === "dispute_accepted"))
    return "charged_back";
  const done = (p.refunds ?? []).filter((r) => r.status === "succeeded");
  if (done.some((r) => r.is_partial === false)) return "refunded";
  const base = (currency?: string | null) =>
    currency && p.settlement_currency && currency === p.settlement_currency && currency !== p.currency
      ? Number(p.settlement_amount ?? 0)
      : Number(p.total_amount ?? 0);
  const share = done.reduce((n, r) => {
    const of = base(r.currency);
    return of > 0 && Number.isFinite(r.amount) ? n + Number(r.amount) / of : n;
  }, 0);
  return share >= 0.5 ? "refunded" : null;
}
