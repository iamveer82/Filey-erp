import type { SupabaseClient, User } from "https://esm.sh/@supabase/supabase-js@2";
import type DodoPayments from "npm:dodopayments@2.50.0";
import { UUID } from "./ai-credits.ts";

export const PROMOTION_UNAVAILABLE = "This Coin promotion is not available for this account or amount.";
export const PROMOTION_OPENED = "This Coin promotion has already been opened. Complete your original checkout.";
export type CreditTestPromotion = {
  id: string;
  user_id: string;
  email: string;
  customer_id: string;
  discount_id: string;
  discount_code: string;
  product_id: string;
  cents: 500;
  expires_at: string;
};

const providerId = (value: unknown): value is string => typeof value === "string" &&
  value.length >= 2 && value.length <= 200 && !/[^A-Za-z0-9_-]/.test(value);
const canonicalUuid = (value: unknown): value is string => typeof value === "string" &&
  value.length === 36 && UUID.test(value);
const normalizeEmail = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "";

/** A private, short-lived test grant, never inferred from caller coupon data. */
export function testPromotionForUser(user: User, now = Date.now()): CreditTestPromotion | null {
  const raw = Deno.env.get("FILEY_AI_TEST_PROMOTION");
  if (!raw || raw.length > 4_096 || !user.email_confirmed_at || !user.email) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const promotion = value as Record<string, unknown>;
    const email = normalizeEmail(promotion.email);
    const expiry = typeof promotion.expires_at === "string" && promotion.expires_at.endsWith("Z") &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(promotion.expires_at)
      ? Date.parse(promotion.expires_at) : NaN;
    if (!canonicalUuid(promotion.id) || !canonicalUuid(promotion.user_id) || promotion.user_id !== user.id ||
      !email || email.length > 254 || /\s/.test(email) || !email.includes("@") || email !== normalizeEmail(user.email) ||
      !providerId(promotion.customer_id) || !providerId(promotion.discount_id) || !providerId(promotion.product_id) ||
      typeof promotion.discount_code !== "string" || promotion.discount_code.length < 3 ||
      promotion.discount_code.length > 16 || /[^A-Z0-9_-]/.test(promotion.discount_code) || promotion.cents !== 500 ||
      !Number.isFinite(expiry) || expiry <= now || expiry > now + 7 * 86_400_000) return null;
    return { ...promotion, email, expires_at: new Date(expiry).toISOString() } as CreditTestPromotion;
  } catch {
    return null;
  }
}

/** Only publish a new offer or an already saved unpaid checkout to its owner. */
export async function publicTestPromotion(db: SupabaseClient, user: User) {
  const promotion = testPromotionForUser(user);
  if (!promotion) return undefined;
  const orders = await testPromotionOrders(db, promotion);
  if (orders.length && (orders.length !== 1 || !resumableTestPromotion(orders[0], promotion))) return undefined;
  return { id: promotion.id, cents: promotion.cents, discount_cents: 550, expires_at: promotion.expires_at };
}

export async function testPromotionOrders(db: SupabaseClient, promotion: CreditTestPromotion): Promise<Record<string, unknown>[]> {
  const { data, error } = await db.from("ai_credit_orders")
    .select("id,user_id,product_id,credits_micros,service_fee_cents,payment_id,paid_cents,refunded_micros,disputed,promotion_id,promotion_discount_id,promotion_discount_code,promotion_customer_id,promotion_email,promotion_expires_at,expected_paid_cents,checkout_session_id,checkout_url")
    .or(`promotion_id.eq.${promotion.id},promotion_discount_id.eq.${promotion.discount_id}`).limit(2);
  if (error) throw error;
  return data ?? [];
}

/** Provider URLs remain outside Filey's trusted application origin. */
export function dodoCheckoutUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048 ||
    [...value].some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127) || value.includes("\\")) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
        /(^|\.)dodopayments\.com$/.test(url.hostname)
      ? url.href : null;
  } catch { return null; }
}

/** An uncertain claim is never recreated. Resume only its exact saved link. */
export function resumableTestPromotion(order: Record<string, unknown>, promotion: CreditTestPromotion) {
  const url = dodoCheckoutUrl(order.checkout_url);
  if (!url || !canonicalUuid(order.id) || !isAuthorizedZeroCreditOrder(order) ||
    order.user_id !== promotion.user_id || order.product_id !== promotion.product_id || order.promotion_id !== promotion.id ||
    order.promotion_discount_id !== promotion.discount_id || order.promotion_discount_code !== promotion.discount_code ||
    order.promotion_customer_id !== promotion.customer_id || order.promotion_email !== promotion.email ||
    Date.parse(String(order.promotion_expires_at)) !== Date.parse(promotion.expires_at) ||
    order.payment_id !== null || order.paid_cents !== null || order.refunded_micros !== 0 || order.disputed !== false) return null;
  return { url, session_id: order.checkout_session_id as string, order_id: order.id };
}

/** Read-only provider checks; a specific coupon must allow only this customer. */
export async function verifyTestPromotion(dodo: DodoPayments, promotion: CreditTestPromotion) {
  const options = { timeout: 10_000, maxRetries: 0 };
  const [discount, customer, allowed, nextPage] = await Promise.all([
    dodo.discounts.retrieve(promotion.discount_id, options),
    dodo.customers.retrieve(promotion.customer_id, options),
    // This documented endpoint is absent from the pinned SDK resource helpers.
    // Its normal authenticated transport preserves the fixed provider origin.
    dodo.get<{ items: { customer_id: string }[] }>(`/discounts/${promotion.discount_id}/customers`, {
      ...options, query: { page_size: 100, page_number: 0 },
    }),
    dodo.get<{ items: { customer_id: string }[] }>(`/discounts/${promotion.discount_id}/customers`, {
      ...options, query: { page_size: 100, page_number: 1 },
    }),
  ]);
  const start = discount.starts_at == null ? 0 : Date.parse(discount.starts_at);
  const providerExpiry = Date.parse(discount.expires_at ?? "");
  // Filey's earlier private cutoff is saved on the order and governs both
  // checkout availability and the first succeeded receipt. A provider date
  // must cover that window, but cannot extend Filey's authorization lifetime.
  if (discount.discount_id !== promotion.discount_id || discount.code !== promotion.discount_code ||
    discount.type !== "percentage" || discount.amount !== 10000 || discount.customer_eligibility !== "specific" ||
    discount.usage_limit !== 1 || discount.per_customer_usage_limit !== 1 || discount.times_used !== 0 ||
    !Number.isFinite(providerExpiry) || providerExpiry < Date.parse(promotion.expires_at) || !Number.isFinite(start) || start > Date.now() ||
    !Array.isArray(discount.restricted_to) || discount.restricted_to.length !== 1 || discount.restricted_to[0] !== promotion.product_id ||
    (discount.currency_options != null && (!Array.isArray(discount.currency_options) || discount.currency_options.length > 0)) ||
    customer.customer_id !== promotion.customer_id || normalizeEmail(customer.email) !== promotion.email || customer.blocked_at ||
    !customer.business_id || customer.business_id !== discount.business_id || !Array.isArray(allowed.items) ||
    allowed.items.length !== 1 || allowed.items[0]?.customer_id !== promotion.customer_id ||
    !Array.isArray(nextPage.items) || nextPage.items.length !== 0 ||
    Date.parse(promotion.expires_at) <= Date.now()) throw new Error(PROMOTION_UNAVAILABLE);
}

/** Saved authority is sufficient for delayed reversal delivery after expiry. */
export function isAuthorizedZeroCreditOrder(order: Record<string, unknown>): boolean {
  return canonicalUuid(order.promotion_id) && providerId(order.promotion_discount_id) &&
    providerId(order.promotion_customer_id) && providerId(order.checkout_session_id) &&
    typeof order.promotion_discount_code === "string" && order.promotion_discount_code.length >= 3 &&
    order.promotion_discount_code.length <= 16 && !/[^A-Z0-9_-]/.test(order.promotion_discount_code) &&
    typeof order.promotion_email === "string" && !!normalizeEmail(order.promotion_email) &&
    Number.isFinite(Date.parse(String(order.promotion_expires_at))) &&
    order.expected_paid_cents === 0 && order.credits_micros === 5_000_000 && order.service_fee_cents === 50;
}

export { normalizeEmail };
