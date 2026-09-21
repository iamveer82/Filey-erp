import type DodoPayments from "https://esm.sh/dodopayments@2.50.0?target=deno";
import type { SupabaseClient, User } from "https://esm.sh/@supabase/supabase-js@2";
import { creditPacks, TOPUP_FEE_CENTS, UUID } from "./ai-credits.ts";

export async function createCreditCheckout(
  dodo: DodoPayments,
  db: SupabaseClient,
  user: User,
  packId: unknown
) {
  if (!Deno.env.get("FILEY_AI_OPENROUTER_KEY"))
    throw new Error("Filey-funded AI is not available yet.");
  if (!user.email_confirmed_at || !user.email)
    throw new Error("Verify your email before adding AI credits.");
  const pack = creditPacks(Deno.env.get("DODO_AI_CREDIT_PACKS") ?? "").find(
    (p) => p.id === packId
  );
  if (!pack) throw new Error("Choose an available AI credit pack.");
  const product = await dodo.products.retrieve(pack.id);
  const price = product.price;
  if (
    price.type !== "one_time_price" ||
    price.currency !== "USD" ||
    price.price !== pack.cents + TOPUP_FEE_CENTS ||
    price.pay_what_you_want ||
    price.discount ||
    price.discount_bps ||
    product.is_recurring
  )
    throw new Error("This AI credit pack is not configured correctly.");
  const id = crypto.randomUUID();
  const { error } = await db.from("ai_credit_orders").insert({
    id,
    user_id: user.id,
    product_id: pack.id,
    credits_micros: pack.cents * 10000,
    service_fee_cents: TOPUP_FEE_CENTS,
  });
  if (error) throw error;
  const configured = Deno.env.get("FILEY_APP_URL") ?? "https://app.gofiley.com";
  const base = new URL(configured);
  if (
    base.protocol !== "https:" &&
    base.hostname !== "127.0.0.1" &&
    base.hostname !== "localhost"
  )
    throw new Error("Invalid app return URL");
  const session = await dodo.checkoutSessions.create({
    product_cart: [{ product_id: pack.id, quantity: 1 }],
    customer: { email: user.email },
    billing_currency: "USD",
    feature_flags: { allow_discount_code: false, allow_currency_selection: false },
    metadata: { type: "ai_credits", credit_order: id, user_id: user.id },
    return_url: `${base.origin}/#/settings?section=credits&credit_checkout=returned`,
    cancel_url: `${base.origin}/#/settings?section=credits&credit_checkout=cancelled`,
  });
  if (!session.checkout_url) throw new Error("Dodo did not return a checkout URL.");
  return { url: session.checkout_url, session_id: session.session_id };
}

/** Provider state is authoritative. Reconcile all succeeded refunds together so
 * out-of-order/refired webhooks cannot restore spent or refunded credits. */
export async function reconcileCreditPayment(
  dodo: DodoPayments,
  db: SupabaseClient,
  paymentId: string
): Promise<boolean> {
  const payment = await dodo.payments.retrieve(paymentId);
  if (payment.metadata?.type !== "ai_credits") return false;
  const orderId = payment.metadata.credit_order;
  if (typeof orderId !== "string" || !UUID.test(orderId))
    throw new Error("Credit payment lacks an order.");
  const { data: order, error } = await db
    .from("ai_credit_orders")
    .select("*")
    .eq("id", orderId)
    .single();
  if (error || !order) throw new Error("Credit order was not found.");
  const cart = payment.product_cart;
  if (
    payment.metadata.user_id !== order.user_id ||
    cart?.length !== 1 ||
    cart[0].product_id !== order.product_id ||
    cart[0].quantity !== 1 ||
    payment.currency !== "USD" ||
    !Number.isSafeInteger(order.service_fee_cents) ||
    order.service_fee_cents < 0 ||
    !Number.isSafeInteger(payment.total_amount) ||
    payment.total_amount < order.credits_micros / 10000 + order.service_fee_cents
  )
    throw new Error("Credit payment does not match its order.");
  if (payment.status !== "succeeded") return true;
  const apply = async (action: string, args: Record<string, unknown>) => {
    const { error } = await db.rpc("filey_ai_wallet", {
      p_action: action,
      p_user: order.user_id,
      p_args: { order_id: orderId, ...args },
    });
    if (error) throw error;
  };
  await apply("topup", {
    payment_id: payment.payment_id,
    paid_cents: payment.total_amount,
  });
  for (const refund of payment.refunds ?? []) {
    if (refund.status !== "succeeded") continue;
    if (!refund.amount || refund.currency !== payment.currency)
      throw new Error("Refund amount/currency could not be verified.");
    await apply("refund", { refund_id: refund.refund_id, refund_cents: refund.amount });
  }
  // An unresolved/lost dispute blocks spending. A won dispute restores access.
  const disputed = (payment.disputes ?? []).some(
    (d) => d.dispute_status !== "dispute_won"
  );
  await apply(disputed ? "dispute" : "resolve_dispute", {});
  return true;
}
