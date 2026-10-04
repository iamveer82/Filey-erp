import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ failTable: "", pages: [] as number[], bodies: 0 }));
vi.mock("../supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "owner" } } } }) },
    rpc: async (_name: string, args: {p_tables: string[]; p_offset: number; p_limit: number}) => {
      if (args.p_tables.includes(state.failTable)) return {error: {message: "Read failed"}};
      if (args.p_tables.includes("products")) state.pages.push(args.p_offset);
      return {data: Object.fromEntries(args.p_tables.map(table => [table, table === "products"
        ? Array.from({length: Math.max(0, Math.min(args.p_limit, 1205 - args.p_offset))}, (_, i) => ({id: args.p_offset + i + 1, sync_revision: 1})) : []])), error: null};
    },
    from: (table: string) => ({
      select: () => ({
        in: async (_key: string, ids: number[]) => {
          state.bodies += ids.length;
          return {data: ids.map(id => ({id, name: "Cloud product", sync_revision: 1})), error: null};
        },
        order: () => ({
          range: async (from: number, to: number) => {
            if (table === state.failTable)
              return { data: null, error: { message: "Read failed" } };
            if (table !== "products") return { data: [], error: null };
            state.bodies += Math.max(0, Math.min(to - from + 1, 1205 - from));
            return {
              data: Array.from(
                { length: Math.max(0, Math.min(to - from + 1, 1205 - from)) },
                (_, i) => ({ id: from + i + 1, name: "Cloud product", sync_revision: 1 })
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
import { loadColl, localClient, journalSnapshot, replaceColl, replaceWorkspaceSnapshot } from "../localdb";
beforeEach(() => {
  localStorage.clear();
  state.failTable = "";
  state.pages = [];
  state.bodies = 0;
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
  await expect(migrateCloudToLocal()).rejects.toThrow("Read failed");
  expect(await loadColl("products")).toEqual([
    expect.objectContaining({ name: "Keep this local product" }),
  ]);
  expect((await journalSnapshot()).tables.products).toBeTruthy();
});

it("reuses unchanged bodies on repeat downloads and copies every synchronized table", async () => {
  await migrateCloudToLocal();
  expect(state.bodies).toBe(1205);
  state.bodies = 0;
  await replaceColl("products", [...await loadColl("products"), {id: 2000, name: "Deleted on cloud", sync_revision: 1}]);
  const result = await migrateCloudToLocal();
  expect(state.bodies).toBe(0);
  expect(await loadColl("products")).toHaveLength(1205);
  expect(result.map(r => r.table)).toEqual(expect.arrayContaining(["entity_links", "org_channels", "org_messages", "email_messages", "call_logs"]));
});

it("rolls back browser records and the sync queue together when storage fills, then allows retry", async () => {
  await localClient.from("products").insert({id: 1, name: "Keep product"});
  await localClient.from("orders").insert({id: 2, order_number: "KEEP-2", name: "Keep order"});
  const before = await journalSnapshot();
  const write = Storage.prototype.setItem;
  let failed = false;
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key === "syncjournal" && !failed) { failed = true; throw new Error("Quota exceeded"); }
    return write.call(this, key, value);
  });
  try {
    await expect(migrateCloudToLocal()).rejects.toThrow("Quota exceeded");
    expect(await loadColl("products")).toEqual([expect.objectContaining({name: "Keep product"})]);
    expect(await loadColl("orders")).toEqual([expect.objectContaining({name: "Keep order"})]);
    expect(await journalSnapshot()).toEqual(before);
  } finally { spy.mockRestore(); }
  await migrateCloudToLocal();
  expect(await loadColl("products")).toHaveLength(1205);
  expect((await journalSnapshot()).tables).toEqual({});
});

it("does not replace edits made while a cloud snapshot was downloading", async () => {
  const before = await journalSnapshot();
  await localClient.from("products").insert({id: 1, name: "Just saved"});
  await expect(replaceWorkspaceSnapshot(new Map([["products", []]]), before.v)).rejects.toThrow("Local records changed");
  expect(await loadColl("products")).toEqual([expect.objectContaining({name: "Just saved"})]);
  expect((await journalSnapshot()).tables.products).toBeTruthy();
});
