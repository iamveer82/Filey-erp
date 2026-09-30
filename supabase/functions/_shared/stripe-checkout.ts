/** The signed provider event proves provenance, not that checkout was paid.
 *  Async payment methods emit completed while payment_status is still unpaid. */
export interface StripeCheckout {
  id: string;
  payment_status: string;
  mode: string | null;
  amount_total: number | null;
  currency: string | null;
  payment_intent: string | { id: string } | null;
  metadata: Record<string, string> | null;
}

export function stripeCheckoutArgs(session: StripeCheckout): Record<string, unknown> | null {
  if (session.payment_status !== "paid") return null;
  const type = session.metadata?.type;
  if (type !== "invoice_payment" && type !== "lite_license") return null;
  const intent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (session.mode !== "payment" || !/^cs_[A-Za-z0-9_]+$/.test(session.id) ||
    !intent || !/^pi_[A-Za-z0-9_]+$/.test(intent) ||
    !Number.isSafeInteger(session.amount_total) || Number(session.amount_total) <= 0 ||
    !session.currency || !/^[a-z]{3}$/i.test(session.currency))
    throw new Error("Invalid paid Stripe checkout.");
  const invoice = type === "invoice_payment" ? Number(session.metadata?.invoice_id) : null;
  const user = type === "lite_license" ? session.metadata?.user_id : null;
  if (type === "invoice_payment" && (!Number.isSafeInteger(invoice) || Number(invoice) <= 0) ||
    type === "lite_license" && (!user || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user)))
    throw new Error("Invalid Stripe checkout owner.");
  // Filey's supported legacy invoice currencies use two minor digits.
  return { p_session: session.id, p_kind: type, p_user: user, p_invoice: invoice,
    p_amount: Number(session.amount_total) / 100, p_currency: session.currency.toUpperCase(), p_intent: intent };
}
