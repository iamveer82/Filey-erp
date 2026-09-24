import { appCheckoutReturn } from "./checkout-return.ts";
import { creditGateway } from "./ai-credit-gateway.ts";
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

export async function createCreditCheckout(
  dodo: DodoPayments,
  db: SupabaseClient,
  user: User,
  packId: unknown,
  amountCents?: unknown
) {
  if (
    !creditGateway() &&
    !(Deno.env.get("HF_API_KEY_ID") && Deno.env.get("HF_API_KEY_SECRET"))
  )
    throw new Error("Filey-funded AI is not available yet.");
  if (!user.email_confirmed_at || !user.email)
    throw new Error("Verify your email before adding AI credits.");
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
  const id = crypto.randomUUID();
  const { error } = await db.from("ai_credit_orders").insert({
    id,
    user_id: user.id,
    product_id: productId,
    credits_micros: pack.cents * 10000,
    service_fee_cents: TOPUP_FEE_CENTS,
  });
  if (error) throw error;
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
    customer: { email: user.email },
    billing_currency: "USD",
    feature_flags: { allow_discount_code: false, allow_currency_selection: false },
    metadata: { type: "ai_credits", credit_order: id, user_id: user.id },
    return_url: appCheckoutReturn({ section: "credits", credit_checkout: "returned" }),
    cancel_url: appCheckoutReturn({ section: "credits", credit_checkout: "cancelled" }),
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
