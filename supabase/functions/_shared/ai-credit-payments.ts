import { appCheckoutReturn } from "./checkout-return.ts";
import { creditGateway } from "./ai-credit-gateway.ts";
import { isAuthorizedZeroCreditOrder, normalizeEmail, PROMOTION_OPENED, PROMOTION_UNAVAILABLE,
  testPromotionClaimed, testPromotionForUser, verifyTestPromotion } from "./ai-credit-promotion.ts";
import type DodoPayments from "https://esm.sh/dodopayments@2.50.0?target=deno";
import type { SupabaseClient, User } from "https://esm.sh/@supabase/supabase-js@2";
import {
  creditPacks,
  creditTopupCents,
  customCreditProduct,
  MIN_TOPUP_CENTS,
  TOPUP_FEE_CENTS,
  UUID,
} from "./ai-credits.ts";

export function creditPaymentsReady() {
  return !!Deno.env.get("DODO_PAYMENTS_API_KEY")?.trim() &&
    !!Deno.env.get("DODO_PAYMENTS_WEBHOOK_KEY")?.trim();
}

export async function createCreditCheckout(
  dodo: DodoPayments,
  db: SupabaseClient,
  user: User,
  packId: unknown,
  amountCents?: unknown,
  promotionId?: unknown,
) {
  // A payment cannot safely grant Coin without verified payment delivery.
  if (!creditPaymentsReady()) throw new Error("Coin payments are not available yet.");
  if (!creditGateway())
    throw new Error("Filey-funded AI is not available yet.");
  if (!user.email_confirmed_at || !user.email)
    throw new Error("Verify your email before adding AI credits.");
  const promotion = promotionId === undefined ? null : testPromotionForUser(user);
  if (promotionId !== undefined && (!promotion || promotionId !== promotion.id))
    throw new Error(PROMOTION_UNAVAILABLE);
  if ((packId !== undefined) === (amountCents !== undefined))
    throw new Error("Choose one AI credit pack or enter a custom amount.");
  const custom = amountCents !== undefined;
  const customId = customCreditProduct(Deno.env.get("DODO_AI_CREDIT_PRODUCT_ID") ?? "");
  const pack = custom
    ? { id: customId, cents: creditTopupCents(amountCents) }
    : creditPacks(Deno.env.get("DODO_AI_CREDIT_PACKS") ?? "").find(
        (p) => p.id === packId
      );
  if (custom && !customId)
    throw new Error("Custom AI credit amounts are not available yet.");
  if (!pack?.id) throw new Error("Choose an available AI credit pack.");
  const productId = pack.id;
  if (promotion && (pack.cents !== 500 || productId !== promotion.product_id))
    throw new Error(PROMOTION_UNAVAILABLE);
  if (promotion && await testPromotionClaimed(db, promotion)) throw new Error(PROMOTION_OPENED);
  const product = await dodo.products.retrieve(productId);
  const price = product.price;
  if (
    price.type !== "one_time_price" ||
    price.currency !== "USD" ||
    (custom
      ? price.price !== MIN_TOPUP_CENTS + TOPUP_FEE_CENTS ||
        price.pay_what_you_want !== true
      : price.price !== pack.cents + TOPUP_FEE_CENTS || price.pay_what_you_want) ||
    price.discount ||
    price.discount_bps ||
    price.purchasing_power_parity ||
    product.is_recurring
  )
    throw new Error("This AI credit pack is not configured correctly.");
  if (promotion) await verifyTestPromotion(dodo, promotion);
  const id = crypto.randomUUID();
  const { error } = await db.from("ai_credit_orders").insert({
    id,
    user_id: user.id,
    product_id: productId,
    credits_micros: pack.cents * 10000,
    service_fee_cents: TOPUP_FEE_CENTS,
    ...(promotion ? {
      promotion_id: promotion.id, promotion_discount_id: promotion.discount_id,
      promotion_discount_code: promotion.discount_code, promotion_customer_id: promotion.customer_id,
      promotion_email: promotion.email, promotion_expires_at: promotion.expires_at, expected_paid_cents: 0,
    } : {}),
  });
  if (error) {
    if (promotion && error.code === "23505") throw new Error(PROMOTION_OPENED);
    throw error;
  }
  const session = await dodo.checkoutSessions.create({
    // Dodo's PWYW `amount` fixes this session's price. Omitting it would let
    // the buyer change the payment independently of the saved credit order.
    product_cart: [
      {
        product_id: productId,
        quantity: 1,
        ...(custom ? { amount: pack.cents + TOPUP_FEE_CENTS } : {}),
      },
    ],
    customer: promotion ? { customer_id: promotion.customer_id } : { email: user.email },
    billing_currency: "USD",
    feature_flags: { allow_discount_code: false, allow_currency_selection: false,
      ...(promotion ? { allow_customer_editing_email: false, always_create_new_customer: false } : {}) },
    ...(promotion ? { discount_codes: [promotion.discount_code] } : {}),
    metadata: { type: "ai_credits", credit_order: id, user_id: user.id,
      ...(promotion ? { promotion_id: promotion.id } : {}) },
    return_url: appCheckoutReturn({ section: "credits", credit_checkout: "returned", credit_order: id }),
    cancel_url: appCheckoutReturn({ section: "credits", credit_checkout: "cancelled", credit_order: id }),
  }, promotion ? { maxRetries: 0, timeout: 15_000 } : undefined);
  if (!session.checkout_url) throw new Error("Dodo did not return a checkout URL.");
  if (promotion) {
    if (typeof session.session_id !== "string" || session.session_id.length < 2 || session.session_id.length > 200 ||
      /[^A-Za-z0-9_-]/.test(session.session_id)) throw new Error(PROMOTION_UNAVAILABLE);
    const { data, error: saveError } = await db.from("ai_credit_orders")
      .update({ checkout_session_id: session.session_id }).eq("id", id).eq("user_id", user.id).is("payment_id", null)
      .select("id").single();
    if (saveError || data?.id !== id) throw saveError ?? new Error(PROMOTION_UNAVAILABLE);
  }
  return { url: session.checkout_url, session_id: session.session_id, order_id: id };
}

/** Provider state is authoritative. Reconcile all succeeded refunds together so
 * out-of-order/refired webhooks cannot restore spent or refunded credits. */
export async function reconcileCreditPayment(
  dodo: DodoPayments,
  db: SupabaseClient,
  paymentId: string,
  event?: { type: string; timestamp: string },
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
  const promotional = order.promotion_id != null;
  if (promotional) {
    const discounts = payment.discounts;
    const discount = discounts?.[0];
    const firstGrant = order.payment_id == null;
    if (!isAuthorizedZeroCreditOrder(order) || payment.total_amount !== 0 || payment.payment_id !== paymentId ||
      payment.metadata?.promotion_id !== order.promotion_id || payment.checkout_session_id !== order.checkout_session_id ||
      payment.customer?.customer_id !== order.promotion_customer_id || normalizeEmail(payment.customer?.email) !== order.promotion_email ||
      !Array.isArray(discounts) || discounts.length !== 1 || !discount || discount.discount_id !== order.promotion_discount_id ||
      discount.type !== "percentage" || discount.amount !== 10000 || discount.code !== order.promotion_discount_code ||
      !Array.isArray(discount.restricted_to) || discount.restricted_to.length !== 1 || discount.restricted_to[0] !== order.product_id ||
      (firstGrant && (!event || event.type !== "payment.succeeded" || !Number.isFinite(Date.parse(event.timestamp)) ||
        Date.parse(event.timestamp) > Date.parse(order.promotion_expires_at))))
      throw new Error("Credit payment does not match its order.");
  }
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
    (promotional ? payment.total_amount !== 0 : payment.total_amount < order.credits_micros / 10000 + order.service_fee_cents)
  )
    throw new Error("Credit payment does not match its order.");
  if (payment.status !== "succeeded") return true;
  const refunds = (payment.refunds ?? []).filter((refund) => refund.status === "succeeded").map((refund) => {
    if (promotional || !Number.isSafeInteger(refund.amount) || Number(refund.amount) <= 0 ||
      refund.currency !== payment.currency || typeof refund.refund_id !== "string" ||
      refund.refund_id.length < 2 || refund.refund_id.length > 200)
      throw new Error("Refund amount/currency could not be verified.");
    return { refund_id: refund.refund_id, refund_cents: refund.amount };
  });
  const disputes = payment.disputes ?? [];
  const disputed = disputes.some((d) => d.dispute_status !== "dispute_won");
  const resolving = !disputed && event?.type === "dispute.won" && disputes.length > 0;
  if (disputed || resolving) {
    if (!event || !Number.isFinite(Date.parse(event.timestamp)))
      throw new Error("Credit dispute event lacks a verified timestamp.");
  }
  // Payment/refund snapshots never unblock a dispute. Only a signed won event,
  // verified against a nonempty current provider list, may restore spending.
  // Apply the entire verified snapshot under one account lock: a reservation
  // cannot spend temporarily granted funds before known reversals are debited.
  const { error: applyError } = await db.rpc("filey_ai_wallet", {
    p_action: "reconcile_payment",
    p_user: order.user_id,
    p_args: {
      order_id: orderId,
      payment_id: payment.payment_id,
      paid_cents: payment.total_amount,
      refunds,
      ...(promotional && order.payment_id == null ? { event_type: event!.type, event_at: event!.timestamp } : {}),
      ...((disputed || resolving) ? {
        dispute_action: disputed ? "dispute" : "resolve_dispute",
        event_type: event!.type,
        event_at: event!.timestamp,
      } : {}),
    },
  });
  if (applyError) throw applyError;
  return true;
}
