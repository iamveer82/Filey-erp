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

// Stripe charge units differ from ISO units for ISK/UGX, and HUF/TWD are
// two-decimal charges despite their zero-decimal payout rules.
// https://docs.stripe.com/currencies#zero-decimal
// https://support.stripe.com/questions/which-payments-methods-and-products-are-available-in-the-uae
const ZERO_DECIMAL = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "VND", "VUV", "XAF", "XOF", "XPF"]);
const THREE_DECIMAL = new Set(["BHD", "JOD", "KWD", "OMR", "TND"]);
const WHOLE_MAJOR = new Set(["ISK", "UGX"]);

function chargeUnits(currency: string): number {
  if (!/^[a-z]{3}$/i.test(currency)) throw new Error("Invalid Stripe currency.");
  const code = currency.toUpperCase();
  return ZERO_DECIMAL.has(code) ? 1 : THREE_DECIMAL.has(code) ? 1000 : 100;
}

/** Refuse amounts Stripe cannot represent rather than silently changing the
 *  amount due, particularly fractional JPY/KRW balances. */
export function stripeAmountToMinorUnits(amount: number, currency: string): number {
  const units = chargeUnits(currency);
  const scaled = amount * units;
  const minor = Math.round(scaled);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(minor) || minor <= 0 ||
    Math.abs(scaled - minor) > 0.000001 ||
    // Filey's existing invoice/payment ledger accepts two major decimals.
    THREE_DECIMAL.has(currency.toUpperCase()) && minor % 10 !== 0 ||
    WHOLE_MAJOR.has(currency.toUpperCase()) && !Number.isInteger(amount))
    throw new Error(`The invoice balance cannot be charged in ${currency.toUpperCase()}. Check its currency and amount in Filey.`);
  return minor;
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
  return { p_session: session.id, p_kind: type, p_user: user, p_invoice: invoice,
    p_amount: Number(session.amount_total) / chargeUnits(session.currency), p_currency: session.currency.toUpperCase(), p_intent: intent };
}
