import type DodoPayments from "https://esm.sh/dodopayments@2.50.0?target=deno";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const TABLE = "subscription_refund_requests";
type Payment = Awaited<ReturnType<DodoPayments["payments"]["retrieve"]>>;
type Org = {
  id: string;
  dodo_subscription_id?: string | null;
  dodo_customer_id?: string | null;
};
export function billingReviewer(userId: string) {
  // A workspace owner (or an agent's OWNER_USER_ID) is not a merchant admin.
  return (Deno.env.get("FILEY_BILLING_ADMIN_USER_IDS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(userId);
}
export function checkRefundPayment(
  payment: Payment,
  subscription: string,
  customer: string
) {
  if (
    !subscription ||
    !customer ||
    payment.subscription_id !== subscription ||
    payment.customer.customer_id !== customer ||
    payment.metadata?.type === "ai_credits"
  )
    throw new Error("Only this workspace's subscription payments can be refunded.");
  if (
    payment.status !== "succeeded" ||
    !Number.isSafeInteger(payment.total_amount) ||
    payment.total_amount <= 0
  )
    throw new Error("Only successful, non-zero payments can be refunded.");
  if (
    payment.refunds.some((r) => r.status !== "failed") ||
    payment.disputes.some((d) => d.dispute_status !== "dispute_won")
  )
    throw new Error(
      "This payment already has a refund or dispute. Review it in Dodo Payments."
    );
}
async function verifiedPayment(
  dodo: DodoPayments,
  paymentId: string,
  subscription: string,
  customer: string
) {
  const payment = await dodo.payments.retrieve(paymentId);
  checkRefundPayment(payment, subscription, customer);
  const sub = await dodo.subscriptions.retrieve(subscription);
  const product = Deno.env.get("DODO_PRODUCT_CLOUD");
  if (!product || sub.product_id !== product || sub.customer.customer_id !== customer)
    throw new Error("This payment is not a Filey subscription.");
  return payment;
}
function checked<T extends { error: unknown }>(result: T): T {
  if (result.error) throw result.error;
  return result;
}

/** Read current provider state, never regress a terminal status on late webhooks. */
export async function reconcileSubscriptionRefund(
  dodo: DodoPayments,
  db: SupabaseClient,
  paymentId: string
) {
  const { data: row } = checked(
    await db.from(TABLE).select("*").eq("payment_id", paymentId).maybeSingle()
  );
  if (!row) return false;
  const payment = await dodo.payments.retrieve(paymentId);
  if (
    payment.subscription_id !== row.subscription_id ||
    payment.customer.customer_id !== row.customer_id ||
    payment.metadata?.type === "ai_credits"
  )
    throw new Error("Refund payment ownership mismatch.");
  const refunds = payment.refunds;
  const succeeded = refunds.filter((r) => r.status === "succeeded");
  if (
    succeeded.some(
      (r) =>
        !Number.isSafeInteger(r.amount) || r.amount! < 0 || r.currency !== row.currency
    )
  )
    throw new Error("Refund amount could not be verified.");
  const amount = succeeded.reduce((n, r) => n + r.amount!, 0);
  if (row.status === "refunded" || amount < row.refunded_amount) return true;
  let status: string | undefined;
  if (amount >= row.amount) status = "refunded";
  else if (refunds.some((r) => r.status === "pending" || r.status === "review"))
    status = "pending";
  else if (amount > 0) status = "partially_refunded";
  else if (
    refunds.some((r) => r.refund_id === row.provider_refund_id && r.status === "failed")
  )
    status = "failed";
  if (!status) return true; // An uncertain submission is never retried automatically.
  // A late response cannot replace a confirmed refund, nor overwrite a newer amount.
  checked(
    await db
      .from(TABLE)
      .update({ status, refunded_amount: amount, updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", row.status)
      .eq("refunded_amount", row.refunded_amount)
  );
  return true;
}

export async function subscriptionRefundAction(
  dodo: DodoPayments,
  db: SupabaseClient,
  userId: string,
  org: Org | null,
  payload: Record<string, unknown>
) {
  const action = payload.action;
  const reviewer = billingReviewer(userId);
  if (action === "subscription_refunds") {
    const { data: requests } = org
      ? checked(
          await db
            .from(TABLE)
            .select("*")
            .eq("org_id", org.id)
            .order("created_at", { ascending: false })
            .limit(50)
        )
      : { data: [] };
    const { data: queue } = reviewer
      ? checked(
          await db
            .from(TABLE)
            .select("*")
            .in("status", [
              "requested",
              "processing",
              "pending",
              "needs_review",
              "failed",
              "partially_refunded",
            ])
            .order("created_at")
            .limit(100)
        )
      : { data: [] };
    return { requests: requests ?? [], queue: queue ?? [], reviewer, can_manage: !!org };
  }
  if (action === "subscription_refund_payments") {
    if (!org) throw new Error("Only a workspace owner or admin can manage billing.");
    if (!org.dodo_subscription_id || !org.dodo_customer_id) return { payments: [] };
    // Fetch one page only; loading Billing itself makes no provider calls.
    const page = await dodo.payments.list({
      subscription_id: org.dodo_subscription_id,
      customer_id: org.dodo_customer_id,
      status: "succeeded",
      page_size: 20,
      page_number: 0,
    });
    return {
      payments: page.items.map((p) => ({
        payment_id: p.payment_id,
        amount: p.total_amount,
        currency: p.currency,
        created_at: p.created_at,
      })),
    };
  }
  if (action === "request_subscription_refund") {
    if (!org?.dodo_subscription_id || !org.dodo_customer_id)
      throw new Error("No subscription is linked to this workspace.");
    const reason = String(payload.reason ?? "").trim();
    const paymentId = String(payload.payment_id ?? "");
    if (
      reason.length < 10 ||
      reason.length > 2000 ||
      !/^pay_[A-Za-z0-9_-]{1,150}$/.test(paymentId)
    )
      throw new Error("Choose a payment and provide a reason (10–2,000 characters).");
    const payment = await verifiedPayment(
      dodo,
      paymentId,
      org.dodo_subscription_id,
      org.dodo_customer_id
    );
    const { error } = await db
      .from(TABLE)
      .insert({
        org_id: org.id,
        requested_by: userId,
        payment_id: paymentId,
        subscription_id: org.dodo_subscription_id,
        customer_id: org.dodo_customer_id,
        amount: payment.total_amount,
        currency: payment.currency,
        reason,
      });
    if (error && error.code !== "23505") throw error;
    return {
      message: error
        ? "A request already exists for this payment."
        : "Your refund request has been submitted for review.",
    };
  }
  if (!reviewer) throw new Error("Only Filey billing administrators can review refunds.");
  const { data: row } = checked(
    await db
      .from(TABLE)
      .select("*")
      .eq("id", String(payload.id ?? ""))
      .single()
  );
  if (action === "refresh_subscription_refund") {
    await reconcileSubscriptionRefund(dodo, db, row.payment_id);
    return { message: "Refund status checked with Dodo Payments." };
  }
  if (action !== "review_subscription_refund") throw new Error("Unknown refund action.");
  if (payload.decision !== "approve" && payload.decision !== "reject")
    throw new Error("Choose approve or reject.");
  const note = String(payload.note ?? "").trim();
  if (note.length < 5 || note.length > 1000)
    throw new Error("Add a review note (5–1,000 characters).");
  if (row.status !== "requested")
    return { message: "This request has already been reviewed. Refresh its status." };
  if (payload.decision === "approve") {
    const payment = await verifiedPayment(
      dodo,
      row.payment_id,
      row.subscription_id,
      row.customer_id
    );
    if (payment.total_amount !== row.amount || payment.currency !== row.currency)
      throw new Error("Payment details changed. Review this payment in Dodo Payments.");
  }
  // Conditional UPDATE is the atomic claim. Even concurrent admins can submit only once.
  const { data: claimed } = checked(
    await db
      .from(TABLE)
      .update({
        status: payload.decision === "approve" ? "processing" : "rejected",
        reviewed_by: userId,
        review_note: note,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("status", "requested")
      .select("id")
      .maybeSingle()
  );
  if (!claimed) return { message: "Another review has already handled this request." };
  if (payload.decision === "reject")
    return { message: "Request declined. Your note is visible to the customer." };
  try {
    const refund = await dodo.refunds.create(
      {
        payment_id: row.payment_id,
        reason: row.reason,
        metadata: { filey_refund_request: row.id },
      },
      { maxRetries: 0 }
    );
    if (refund.payment_id !== row.payment_id)
      throw new Error("Provider refund mismatch.");
    checked(
      await db
        .from(TABLE)
        .update({ provider_refund_id: refund.refund_id })
        .eq("id", row.id)
    );
    checked(
      await db
        .from(TABLE)
        .update({
          status: refund.status === "failed" ? "failed" : "pending",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("status", "processing")
    );
    await reconcileSubscriptionRefund(dodo, db, row.payment_id);
    return {
      message:
        "Refund submitted to Dodo Payments. The final status follows the provider.",
    };
  } catch {
    checked(
      await db
        .from(TABLE)
        .update({ status: "needs_review", updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("status", "processing")
    );
    return {
      message:
        "Submission needs verification. Check status or inspect the payment in Dodo before any further action. No automatic retry was made.",
    };
  }
}
