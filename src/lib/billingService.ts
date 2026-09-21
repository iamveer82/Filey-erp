import { supabase, invokeFn } from "./supabase";
import { serviceError } from "./serviceError";

export const BILLING_UNAVAILABLE =
  "Payments are temporarily unavailable. Please try again shortly or contact Filey support.";

/** Account-bound billing calls must never be automatically repeated. */
export async function billingRequest<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error("Sign in to your Filey account to manage your plan.");
  const {
    data: { session },
    error: authError,
  } = await supabase.auth.getSession();
  if (authError || !session)
    throw new Error(
      "Sign in to your Filey account to manage your plan. Your device records stay on this device."
    );
  let result;
  try {
    result = await invokeFn(supabase, "dodo", { body }, 0);
  } catch (error) {
    throw await serviceError(error, BILLING_UNAVAILABLE);
  }
  const data = result.data as { error?: string } | null;
  if (result.error || data?.error)
    throw await serviceError(result.error ?? new Error(data!.error), BILLING_UNAVAILABLE);
  const current = await supabase.auth.getSession();
  if (current.data.session?.user.id !== session.user.id)
    throw new Error("Your account changed. Reopen Billing.");
  return result.data as T;
}

export function paymentUrl(value: unknown): string {
  try {
    const url = new URL(String(value));
    if (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      /(^|\.)dodopayments\.com$/.test(url.hostname)
    )
      return url.href;
  } catch {
    /* Missing or invalid payment destination. */
  }
  throw new Error(BILLING_UNAVAILABLE);
}
