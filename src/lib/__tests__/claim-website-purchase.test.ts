import { beforeEach, describe, expect, it, vi } from "vitest";

// Someone buys on gofiley.com before Filey is on their machine. The payment is
// parked against the email they typed, and this is the call that collects it
// at sign-in. It runs on every sign-in, so it has to be quiet when there is
// nothing to claim — and it must never leave a paying customer on Free.
const rpc = { calls: [] as string[], result: null as unknown, error: null as unknown };

vi.mock("../supabase", () => ({
  isConfigured: true,
  cloudConfigured: true,
  supabase: {
    rpc: async (name: string) => {
      rpc.calls.push(name);
      return { data: rpc.result, error: rpc.error };
    },
  },
  invokeFn: async () => ({ data: {}, error: null }),
}));

vi.mock("../dataMode", () => ({ isLocalMode: () => false, assertWorkspaceCurrent: () => {} }));

describe("claiming a purchase made on the website", () => {
  beforeEach(() => {
    rpc.calls.length = 0;
    rpc.result = null;
    rpc.error = null;
    localStorage.clear();
  });

  it("reports a claim so the caller can refresh the plan", async () => {
    const { claimWebsitePurchases } = await import("../license");
    rpc.result = { claimed: true, cloud: 0, licences: 1 };
    expect(await claimWebsitePurchases()).toBe(true);
    expect(rpc.calls).toEqual(["filey_claim_entitlements"]);
  });

  it("stays quiet when there is nothing waiting", async () => {
    const { claimWebsitePurchases } = await import("../license");
    rpc.result = { claimed: false, cloud: 0, licences: 0 };
    expect(await claimWebsitePurchases()).toBe(false);
  });

  it("never throws into the sign-in path", async () => {
    const { claimWebsitePurchases } = await import("../license");
    // Offline, or the migration is not applied on this project yet. Sign-in
    // must still complete — the purchase stays parked for next time.
    rpc.error = { message: "function public.filey_claim_entitlements does not exist" };
    await expect(claimWebsitePurchases()).resolves.toBe(false);
  });
});
