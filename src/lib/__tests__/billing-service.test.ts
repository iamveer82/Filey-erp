import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { supabase } from "../supabase";
import { billingRequest, paymentUrl, openBilling, BILLING_UNAVAILABLE } from "../billingService";
import { startFreedomCheckout, collectPurchases } from "../license";
import { startCheckout, refundAction } from "../subscription";
import { buyAiCredits } from "../aiCredits";
import { setCacheOrg } from "../api";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const session = { user: { id: "billing-owner" }, access_token: "fixture-billing-owner-token" };
beforeEach(() => {
  localStorage.clear();
  setCacheOrg(null);
  setCacheOrg("billing-org", session.user.id);
  vi.spyOn(supabase!.auth, "getSession").mockResolvedValue({
    data: { session },
    error: null,
  } as never);
  vi.spyOn(supabase!, "functions", "get").mockReturnValue({ invoke: vi.fn() } as never);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); setCacheOrg(null); delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; });

it("pins the reviewed account and organization before the SDK can choose another session", async () => {
  vi.mocked(supabase!.functions.invoke).mockImplementation(async (_name, options) => {
    expect(options?.headers).toEqual({ Authorization: "Bearer fixture-billing-owner-token" });
    expect(options?.body).toEqual({ action: "checkout", expected_org_id: "billing-org" });
    vi.mocked(supabase!.auth.getSession).mockResolvedValue({
      data: { session: { user: { id: "another" }, access_token: "another-token" } }, error: null,
    } as never);
    return { data: { url: "https://checkout.dodopayments.com/fixture" }, error: null };
  });
  await expect(billingRequest({ action: "checkout", expected_org_id: "unreviewed-org" })).rejects.toThrow("Your account changed");
  expect(supabase!.functions.invoke).toHaveBeenCalledTimes(1);
});

it("stops billing before dispatch if account lookup finishes in another workspace", async () => {
  vi.mocked(supabase!.auth.getSession).mockImplementationOnce(async () => {
    setCacheOrg("another-org", session.user.id);
    return { data: { session }, error: null } as never;
  });
  await expect(billingRequest({ action: "checkout" })).rejects.toThrow("Your workspace changed");
  expect(supabase!.functions.invoke).not.toHaveBeenCalled();
});

it("stops billing when the session changed before the reviewed cache caught up", async () => {
  vi.mocked(supabase!.auth.getSession).mockResolvedValue({
    data: { session: { user: { id: "another" }, access_token: "another-token" } },
    error: null,
  } as never);
  await expect(billingRequest({ action: "checkout" })).rejects.toThrow("Your account changed");
  expect(supabase!.functions.invoke).not.toHaveBeenCalled();
});

it("permits account billing during the temporary personal sign-in scope", async () => {
  setCacheOrg(null, session.user.id);
  vi.mocked(supabase!.functions.invoke).mockResolvedValue({ data: { claimed: false }, error: null });
  await expect(billingRequest({ action: "claim" })).resolves.toEqual({ claimed: false });
  expect(supabase!.functions.invoke).toHaveBeenCalledExactlyOnceWith("dodo", {
    body: { action: "claim" },
    headers: { Authorization: "Bearer fixture-billing-owner-token" },
    signal: expect.any(AbortSignal),
  });
});

it("aborts delayed billing dispatch after a workspace switch and never retries", async () => {
  vi.mocked(supabase!.functions.invoke).mockImplementation(async (_name, options) => {
    expect(options?.signal?.aborted).toBe(false);
    setCacheOrg("another-org", session.user.id);
    expect(options?.signal?.aborted).toBe(true);
    return { data: null, error: new Error("Aborted") } as never;
  });
  await expect(billingRequest({ action: "portal" })).rejects.toThrow("Your workspace changed");
  expect(supabase!.functions.invoke).toHaveBeenCalledTimes(1);
});

it("does not dispatch billing with a missing account token", async () => {
  vi.mocked(supabase!.auth.getSession).mockResolvedValue({ data: { session: { user: session.user, access_token: "" } }, error: null } as never);
  await expect(billingRequest({ action: "checkout" })).rejects.toThrow("Sign in to your Filey account again");
  expect(supabase!.functions.invoke).not.toHaveBeenCalled();
});

it("explains an owned Ultra plan instead of displaying the edge function error", async () => {
  vi.mocked(supabase!.functions.invoke).mockResolvedValue({
    data: null,
    error: {
      message: "Edge Function returned a non-2xx status code",
      context: new Response('{"error":"This account already owns Ultra."}', {
        status: 409,
      }),
    },
  } as never);
  await expect(startFreedomCheckout()).rejects.toThrow(
    "This account already owns Ultra."
  );
  expect(supabase!.functions.invoke).toHaveBeenCalledTimes(1);
});

it("does not send checkout while signed out", async () => {
  vi.mocked(supabase!.auth.getSession).mockResolvedValue({
    data: { session: null },
    error: null,
  });
  await expect(startFreedomCheckout()).rejects.toThrow("Sign in to your Filey account");
  expect(supabase!.functions.invoke).not.toHaveBeenCalled();
});

it("never retries checkout or refunds and hides private server details", async () => {
  vi.mocked(supabase!.functions.invoke).mockImplementation(
    async () =>
      ({
        data: null,
        error: {
          message: "Edge Function returned a non-2xx status code",
          context: new Response(
            '{"error":"SQL relation missing; DODO_PAYMENTS_API_KEY invalid"}',
            { status: 500 }
          ),
        },
      }) as never
  );
  await expect(startCheckout()).rejects.toThrow(BILLING_UNAVAILABLE);
  await expect(refundAction({ action: "request_subscription_refund" })).rejects.toThrow(
    BILLING_UNAVAILABLE
  );
  expect(supabase!.functions.invoke).toHaveBeenCalledTimes(2);
});

it("rejects a result from a previous account and non-provider checkout URLs", async () => {
  vi.mocked(supabase!.auth.getSession)
    .mockResolvedValueOnce({ data: { session }, error: null } as never)
    .mockResolvedValue({
      data: { session: { user: { id: "another" } } },
      error: null,
    } as never);
  vi.mocked(supabase!.functions.invoke).mockResolvedValue({
    data: { url: "https://checkout.dodopayments.com/example" },
    error: null,
  });
  await expect(billingRequest({ action: "checkout" })).rejects.toThrow(
    "Your account changed"
  );
  for (const url of [
    undefined,
    "http://checkout.dodopayments.com",
    "https://dodopayments.com.evil.test",
    "https://user:secret@checkout.dodopayments.com",
  ])
    expect(() => paymentUrl(url)).toThrow(BILLING_UNAVAILABLE);
  expect(paymentUrl("https://checkout.dodopayments.com/example")).toBe(
    "https://checkout.dodopayments.com/example"
  );
});

it("automatically applies Ultra on a second eligible device, but respects full and removed slots", async () => {
  let devices: { fingerprint: string; deactivated_at: string | null }[] = [
    { fingerprint: "first", deactivated_at: null },
  ];
  localStorage.setItem("filey:device_id", "second");
  vi.spyOn(supabase!, "rpc").mockResolvedValue({
    data: { claimed: false },
    error: null,
  } as never);
  vi.spyOn(supabase!, "from").mockImplementation((table) => {
    const query = {
      select: () => query,
      eq: () => query,
      limit: () => query,
      maybeSingle: async () => ({ data: { id: "owned", status: "active" }, error: null }),
      order: async () => ({ data: devices, error: null }),
    };
    expect(["licenses", "license_devices"]).toContain(table);
    return query as never;
  });
  vi.spyOn(crypto.subtle, "importKey").mockResolvedValue({} as never);
  vi.spyOn(crypto.subtle, "verify").mockResolvedValue(true);
  const token =
    btoa(
      JSON.stringify({
        product: "filey-desktop",
        device_id: "second",
        email: "test@example.invalid",
      })
    ) + ".AA";
  vi.mocked(supabase!.functions.invoke).mockResolvedValue({
    data: { token },
    error: null,
  });
  expect(await collectPurchases()).toBe(true);
  expect(supabase!.functions.invoke).toHaveBeenCalledTimes(1);
  localStorage.removeItem("filey:license_token");
  devices = [
    { fingerprint: "first", deactivated_at: null },
    { fingerprint: "third", deactivated_at: null },
  ];
  expect(await collectPurchases()).toBe(false);
  devices = [{ fingerprint: "second", deactivated_at: "2026-09-20" }];
  expect(await collectPurchases()).toBe(false);
  expect(supabase!.functions.invoke).toHaveBeenCalledTimes(1);
});


it("opens the system browser on desktop and navigates the same tab on mobile web", async () => {
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  const url = "https://checkout.dodopayments.com/fixture";
  const assign = vi.fn();
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {}, location: { assign } });
  expect(await openBilling(url)).toBe("browser");
  expect(openUrl).toHaveBeenCalledWith(url);
  expect(assign).not.toHaveBeenCalled();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  expect(await openBilling(url)).toBe("redirected");
  expect(assign).toHaveBeenCalledExactlyOnceWith(url);
});

it("takes a desktop AI credit purchase to the provider page without changing local data mode", async () => {
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  vi.mocked(openUrl).mockClear();
  localStorage.setItem("filey_data_mode", "local");
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  const url = "https://checkout.dodopayments.com/credit-fixture";
  const order_id = "00000000-0000-4000-8000-000000000051";
  vi.mocked(supabase!.functions.invoke).mockResolvedValue({ data: { url, order_id }, error: null });
  expect(await buyAiCredits("pdt_credit_fixture")).toEqual({ mode: "browser", order_id });
  expect(supabase!.functions.invoke).toHaveBeenCalledExactlyOnceWith("dodo", {
    body: { action: "checkout_ai_credits", pack_id: "pdt_credit_fixture" },
    headers: { Authorization: "Bearer fixture-billing-owner-token" },
  });
  expect(openUrl).toHaveBeenCalledExactlyOnceWith(url);
  expect(localStorage.getItem("filey_data_mode")).toBe("local");
});

it("sends custom credit amounts in cents and rejects invalid amounts before checkout", async () => {
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  vi.mocked(openUrl).mockClear();
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  const url = "https://checkout.dodopayments.com/custom-credit-fixture";
  const order_id = "00000000-0000-4000-8000-000000000052";
  vi.mocked(supabase!.functions.invoke).mockResolvedValue({ data: { url, order_id }, error: null });
  expect(await buyAiCredits(1251)).toEqual({ mode: "browser", order_id });
  expect(supabase!.functions.invoke).toHaveBeenCalledExactlyOnceWith("dodo", {
    body: { action: "checkout_ai_credits", amount_cents: 1251 },
    headers: { Authorization: "Bearer fixture-billing-owner-token" },
  });
  expect(openUrl).toHaveBeenCalledExactlyOnceWith(url);
  for (const amount of [NaN, Infinity, -500, 499, 10001, 500.1])
    await expect(buyAiCredits(amount)).rejects.toThrow("$5 to $100");
  expect(supabase!.functions.invoke).toHaveBeenCalledOnce();
  vi.mocked(supabase!.functions.invoke).mockResolvedValue({
    data: null,
    error: { context: new Response('{"error":"Custom AI credit amounts are not available yet."}', { status: 400 }) },
  } as never);
  await expect(buyAiCredits(1251)).rejects.toThrow("Custom AI credit amounts are not available yet.");
});

it("does not open Coin checkout without a usable saved order identity", async () => {
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  vi.mocked(openUrl).mockClear();
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  for (const order_id of [undefined, null, "", "untrusted-order"]) {
    vi.mocked(supabase!.functions.invoke).mockResolvedValue({
      data: { url: "https://checkout.dodopayments.com/fixture", order_id }, error: null,
    });
    await expect(buyAiCredits(500)).rejects.toThrow(BILLING_UNAVAILABLE);
  }
  expect(openUrl).not.toHaveBeenCalled();
});

it("forwards only an explicitly selected valid test-promotion identity to Coin checkout", async () => {
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  vi.mocked(openUrl).mockClear();
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  const url = "https://checkout.dodopayments.com/promotional-credit-fixture";
  const order_id = "00000000-0000-4000-8000-000000000051";
  const promotion_id = "00000000-0000-4000-8000-000000000061";
  vi.mocked(supabase!.functions.invoke).mockResolvedValue({ data: { url, order_id }, error: null });
  expect(await buyAiCredits(500, promotion_id)).toEqual({ mode: "browser", order_id });
  expect(supabase!.functions.invoke).toHaveBeenCalledExactlyOnceWith("dodo", {
    body: { action: "checkout_ai_credits", amount_cents: 500, promotion_id },
    headers: { Authorization: "Bearer fixture-billing-owner-token" },
  });
  expect(openUrl).toHaveBeenCalledExactlyOnceWith(url);
});

it("rejects malformed promotion identities before authentication, networking or browser handoff", async () => {
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  vi.mocked(openUrl).mockClear();
  for (const promotion_id of ["", "test", "00000000-0000-4000-8000-000000000061\n", "00000000-0000-4000-8000-000000000061&user=other"]) {
    await expect(buyAiCredits(500, promotion_id)).rejects.toThrow();
  }
  expect(supabase!.auth.getSession).not.toHaveBeenCalled();
  expect(supabase!.functions.invoke).not.toHaveBeenCalled();
  expect(openUrl).not.toHaveBeenCalled();
});
