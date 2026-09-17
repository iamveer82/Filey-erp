import { beforeEach, describe, expect, it, vi } from "vitest";

// Free is a LOCAL tier now: the whole ERP on-device, five invoices a month.
// The cap used to skip local mode entirely, back when local was the paid
// thing — so this is the assertion that the inversion actually took.
vi.mock("../dataMode", () => ({
  isLocalMode: () => true,
  assertWorkspaceCurrent: () => {},
}));

vi.mock("../supabase", () => ({
  isConfigured: false,
  cloudConfigured: false,
  supabase: null,
  invokeFn: async () => ({ data: {}, error: null }),
}));

describe("the free invoice cap on a local workspace", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("refuses the sixth invoice this month", async () => {
    const { checkFreeInvoiceCap, FREE_LIMITS, clearEntitlementCache } = await import("../license");
    clearEntitlementCache();
    await expect(
      checkFreeInvoiceCap(async () => FREE_LIMITS.invoicesPerMonth)
    ).rejects.toThrow(/Free plan limit reached/);
  });

  it("names both ways out in the message", async () => {
    const { checkFreeInvoiceCap, clearEntitlementCache } = await import("../license");
    clearEntitlementCache();
    // Someone who has hit the wall needs to know the two prices, not just that
    // they are blocked.
    await expect(checkFreeInvoiceCap(async () => 99)).rejects.toThrow(/\$1\/month/);
    await expect(checkFreeInvoiceCap(async () => 99)).rejects.toThrow(/Freedom/);
  });

  it("lets the fifth through", async () => {
    const { checkFreeInvoiceCap, FREE_LIMITS, clearEntitlementCache } = await import("../license");
    clearEntitlementCache();
    await expect(
      checkFreeInvoiceCap(async () => FREE_LIMITS.invoicesPerMonth - 1)
    ).resolves.toBeUndefined();
  });
});
