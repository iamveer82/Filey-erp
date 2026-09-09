import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ failTable: "", pages: [] as number[] }));
vi.mock("../supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "owner" } } } }) },
    from: (table: string) => ({
      select: () => ({
        order: () => ({
          range: async (from: number, to: number) => {
            if (table === state.failTable)
              return { data: null, error: { message: "Read failed" } };
            if (table !== "products") return { data: [], error: null };
            state.pages.push(from);
            return {
              data: Array.from(
                { length: Math.max(0, Math.min(to - from + 1, 1205 - from)) },
                (_, i) => ({ id: from + i + 1, name: "Cloud product" })
              ),
              error: null,
            };
          },
        }),
      }),
    }),
  },
}));
import { migrateCloudToLocal } from "../migrate";
import { loadColl, localClient, journalSnapshot } from "../localdb";
beforeEach(() => {
  localStorage.clear();
  state.failTable = "";
  state.pages = [];
});
it("copies all pages and retires the replaced local journal", async () => {
  await localClient.from("products").insert({ name: "Old local product" });
  await migrateCloudToLocal();
  expect(await loadColl("products")).toHaveLength(1205);
  expect(state.pages).toEqual([0, 1000]);
  expect((await journalSnapshot()).tables.products).toBeUndefined();
  expect(localStorage.getItem("filey_cloud_seeded")).toBe("1");
});
it("preserves every existing collection if any source read fails", async () => {
  await localClient.from("products").insert({ name: "Keep this local product" });
  state.failTable = "orders";
  await expect(migrateCloudToLocal()).rejects.toThrow("orders: Read failed");
  expect(await loadColl("products")).toEqual([
    expect.objectContaining({ name: "Keep this local product" }),
  ]);
  expect((await journalSnapshot()).tables.products).toBeTruthy();
});
