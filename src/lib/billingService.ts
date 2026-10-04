import { supabase, invokeFn } from "./supabase";
import { serviceError } from "./serviceError";
import { isNativeApp, openNativeExternal } from "./nativePlatform";
import { getCacheOrg } from "./api";
import { agentStorageScope, AGENT_STORAGE_EVENT } from "./agentStorage";

export const BILLING_UNAVAILABLE =
  "Payments are temporarily unavailable. Please try again shortly or contact Filey support.";

/** Account-bound billing calls must never be automatically repeated. */
export async function billingRequest<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error("Sign in to your Filey account to manage your plan.");
  const scope = agentStorageScope();
  const org = getCacheOrg();
  const reviewedUser = scope?.includes(":user:")
    ? scope.slice(scope.lastIndexOf(":user:") + 6)
    : null;
  const assertCurrent = () => {
    if (scope !== agentStorageScope())
      throw new Error("Your workspace changed. Reopen Billing.");
  };
  const {
    data: { session },
    error: authError,
  } = await supabase.auth.getSession();
  assertCurrent();
  if (authError || !session)
    throw new Error(
      "Sign in to your Filey account to manage your plan. Your device records stay on this device."
    );
  if (!session.access_token?.trim())
    throw new Error("Sign in to your Filey account again to manage your plan.");
  if (reviewedUser && reviewedUser !== session.user.id)
    throw new Error("Your account changed. Reopen Billing.");
  const controller = new AbortController();
  const abortStale = () => {
    try { assertCurrent(); } catch { controller.abort(); }
  };
  const events = [AGENT_STORAGE_EVENT, "filey:workspace-changed", "storage"];
  for (const event of events) window.addEventListener(event, abortStale);
  let result;
  try {
    result = await invokeFn(supabase, "dodo", {
      body: { ...body, ...(org ? { expected_org_id: org } : {}) },
      headers: { Authorization: `Bearer ${session.access_token}` },
      signal: controller.signal,
    }, 0);
  } catch (error) {
    assertCurrent();
    throw await serviceError(error, BILLING_UNAVAILABLE);
  } finally {
    for (const event of events) window.removeEventListener(event, abortStale);
  }
  assertCurrent();
  const data = result.data as { error?: string } | null;
  if (result.error || data?.error)
    throw await serviceError(result.error ?? new Error(data!.error), BILLING_UNAVAILABLE);
  const current = await supabase.auth.getSession();
  assertCurrent();
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

/** Packaged apps keep checkout outside their trusted WebView. */
export async function openBilling(value: unknown): Promise<"browser" | "redirected"> {
  const url = paymentUrl(value);
  if (isNativeApp()) {
    await openNativeExternal(url);
    return "browser";
  }
  if ("__TAURI_INTERNALS__" in window) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return "browser";
  }
  window.location.assign(url);
  return "redirected";
}
