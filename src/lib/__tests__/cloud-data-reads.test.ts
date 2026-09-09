import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ fail: false, offsets: [] as number[] }));
vi.mock("../supabase", () => ({
  isConfigured: true,
  supabase: null,
  sb: () => ({
    from: () => {
      let offset = 0;
      const query = {
        select: () => query,
        order: () => query,
        range: (start: number) => {
          offset = start;
          state.offsets.push(start);
          return query;
        },
        then: (resolve: (value: unknown) => unknown) =>
          resolve(
            state.fail
              ? { data: null, error: { message: "Database unavailable" } }
              : {
                  data: Array.from(
                    { length: Math.max(0, Math.min(500, 1205 - offset)) },
                    (_, i) => ({ id: offset + i + 1, name: `Product ${offset + i}`, po_id: 1, amount: 10 })
                  ),
                  error: null,
                }
          ),
      };
      return query;
    },
  }),
}));
import { billing, erp, pos, setCacheOrg } from "../api";
beforeEach(() => {
  localStorage.clear();
  state.fail = false;
  state.offsets = [];
  setCacheOrg(null);
});
it("reads beyond the cloud row cap with stable pagination", async () => {
  expect(await erp.products()).toHaveLength(1205);
  expect(state.offsets).toEqual([0, 500, 1000]);
});
it("surfaces a failed initial load instead of returning an empty business", async () => {
  state.fail = true;
  await expect(erp.products()).rejects.toMatchObject({ message: "Database unavailable" });
});

it("includes every PO payment beyond the server cap", async () => {
  const payments = await pos.allPayments();
  expect(payments).toHaveLength(1205);
  expect(payments.reduce((sum, payment) => sum + payment.amount, 0)).toBe(12050);
  expect(state.offsets).toEqual([0, 500, 1000]);
});

it("does not report no payments when the payment read fails", async () => {
  state.fail = true;
  await expect(pos.allPayments()).rejects.toMatchObject({ message: "Database unavailable" });
});

it("loads every invoice payment beyond the server cap and rejects unavailable history", async () => {
  const payments = await billing.allPayments();
  expect(payments).toHaveLength(1205);
  expect(state.offsets).toEqual([0, 500, 1000]);
  setCacheOrg("another-workspace", "user-two");
  state.fail = true;
  await expect(billing.allPayments()).rejects.toMatchObject({ message: "Database unavailable" });
});

it("does not reuse another user's cloud cache in the same organization", async () => {
  setCacheOrg("default", "user-one");
  await erp.products();
  setCacheOrg("default", "user-two");
  state.fail = true;
  await expect(erp.products()).rejects.toMatchObject({ message: "Database unavailable" });
});

it("rejects cloud saves offline instead of reporting an unsaved record as saved", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  await expect(erp.updateProduct(1, { name: "Offline change" })).rejects.toThrow(
    "will not be saved"
  );
  expect(localStorage.getItem("outbox")).toBeNull();
  vi.restoreAllMocks();
});
