import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { supabase } from "../supabase";
import { billingRequest, paymentUrl, openBilling, BILLING_UNAVAILABLE } from "../billingService";
import { startFreedomCheckout, collectPurchases } from "../license";
import { startCheckout, refundAction } from "../subscription";
import { buyAiCredits } from "../aiCredits";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const session = { user: { id: "billing-owner" } };
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(supabase!.auth, "getSession").mockResolvedValue({
    data: { session },
    error: null,
  } as never);
  vi.spyOn(supabase!, "functions", "get").mockReturnValue({ invoke: vi.fn() } as never);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; });

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
  vi.mocked(supabase!.functions.invoke).mockResolvedValue({ data: { url }, error: null });
  expect(await buyAiCredits("pdt_credit_fixture")).toBe("browser");
  expect(supabase!.functions.invoke).toHaveBeenCalledExactlyOnceWith("dodo", {
    body: { action: "checkout_ai_credits", pack_id: "pdt_credit_fixture" },
  });
  expect(openUrl).toHaveBeenCalledExactlyOnceWith(url);
  expect(localStorage.getItem("filey_data_mode")).toBe("local");
});

it("sends custom credit amounts in cents and rejects invalid amounts before checkout", async () => {
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  vi.mocked(openUrl).mockClear();
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  const url = "https://checkout.dodopayments.com/custom-credit-fixture";
  vi.mocked(supabase!.functions.invoke).mockResolvedValue({ data: { url }, error: null });
  expect(await buyAiCredits(1251)).toBe("browser");
  expect(supabase!.functions.invoke).toHaveBeenCalledExactlyOnceWith("dodo", {
    body: { action: "checkout_ai_credits", amount_cents: 1251 },
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
