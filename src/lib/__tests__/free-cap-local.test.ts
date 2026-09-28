import { beforeEach, describe, expect, it, vi } from "vitest";

// Hosted quotas must never gate an offline, local save.
vi.mock("../dataMode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../dataMode")>()),
  isLocalMode: () => true,
  effectiveDataMode: () => "local" as const,
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

  it("allows local saves without counting usage or offering an upgrade", async () => {
    const { checkFreeInvoiceCap, clearEntitlementCache } = await import("../license");
    clearEntitlementCache();
    const count = vi.fn(async () => { throw new Error("No connection"); });
    const upgrade = vi.fn();
    window.addEventListener("filey:upgrade", upgrade);
    try {
      await expect(checkFreeInvoiceCap(count)).resolves.toBeUndefined();
      expect(count).not.toHaveBeenCalled();
      expect(upgrade).not.toHaveBeenCalled();
    } finally { window.removeEventListener("filey:upgrade", upgrade); }
  });
});
