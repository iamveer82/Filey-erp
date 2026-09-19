import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ licensed: false, grandfathered: false, used: 5 }));
vi.mock("../dataMode", () => ({ isLocalMode: () => false }));
vi.mock("../supabase", () => ({
  supabase: {
    rpc: async (name: string) => ({ data: name === "current_org" ? "workspace" : state.licensed, error: null }),
    from: () => {
      const query = {
        select: () => query, eq: () => query,
        maybeSingle: async () => ({ data: { plan: "free", cloud_grandfathered: state.grandfathered }, error: null }),
      };
      return query;
    },
  },
}));
import { checkFreeInvoiceCap, clearEntitlementCache, cloudAccess } from "../license";

beforeEach(() => {
  localStorage.clear();
  clearEntitlementCache();
  state.licensed = state.grandfathered = false;
  state.used = 5;
});
it("opens Basic web access without bypassing the creation cap", async () => {
  expect(await cloudAccess()).toEqual({ allowed: true, reason: "basic" });
  await expect(checkFreeInvoiceCap(async () => state.used)).rejects.toThrow(/Editing existing invoices is unlimited/);
  state.used = 4;
  await expect(checkFreeInvoiceCap(async () => state.used)).resolves.toBeUndefined();
});
it.each(["licensed", "grandfathered"] as const)("preserves %s unlimited cloud invoicing", async (flag) => {
  state[flag] = true;
  const count = vi.fn(async () => 99);
  await expect(checkFreeInvoiceCap(count)).resolves.toBeUndefined();
  expect(count).not.toHaveBeenCalled();
});
