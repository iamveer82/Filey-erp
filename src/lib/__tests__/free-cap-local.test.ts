import { beforeEach, describe, expect, it, vi } from "vitest";

// Basic's five-creation limit applies locally as well as on the web.
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
    ).rejects.toThrow(/Basic plan limit reached/);
  });

  it("names both ways out in the message", async () => {
    const { checkFreeInvoiceCap, clearEntitlementCache } = await import("../license");
    clearEntitlementCache();
    // Someone who has hit the wall needs to know the two prices, not just that
    // they are blocked.
    await expect(checkFreeInvoiceCap(async () => 99)).rejects.toThrow(/\$5\/month/);
    await expect(checkFreeInvoiceCap(async () => 99)).rejects.toThrow(/Ultra/);
  });

  it("lets the fifth through", async () => {
    const { checkFreeInvoiceCap, FREE_LIMITS, clearEntitlementCache } = await import("../license");
    clearEntitlementCache();
    await expect(
      checkFreeInvoiceCap(async () => FREE_LIMITS.invoicesPerMonth - 1)
    ).resolves.toBeUndefined();
  });
});
