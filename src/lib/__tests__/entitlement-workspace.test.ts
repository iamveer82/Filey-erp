import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../supabase", () => ({
  supabase: {
    rpc: async (name: string) => ({
      data: name === "current_org" ? "workspace" : false,
      error: null,
    }),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: state.read }) }) }),
  },
  invokeFn: vi.fn(),
}));
import { cloudAccess, clearEntitlementCache } from "../license";
it("a previous workspace's late billing response cannot overwrite the new workspace cache", async () => {
  clearEntitlementCache();
  let finish!: (v: unknown) => void;
  state.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const old = cloudAccess(true);
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  clearEntitlementCache();
  state.read.mockResolvedValue({ data: { plan: "free", plan_status: null } });
  expect((await cloudAccess(true)).reason).toBe("basic");
  finish({ data: { plan: "cloud", plan_status: "active" } });
  await old;
  expect((await cloudAccess()).reason).toBe("basic");
});
