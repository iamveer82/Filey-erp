import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ failLater: false, pages: [] as number[] }));
vi.mock("../moduleAccess", () => ({ loadModuleAccess: async () => ({ admin: true, modules: null }) }));
vi.mock("../supabase", () => ({ isConfigured: true, supabase: null, sb: () => ({
  from: (table: string) => {
    let offset = 0;
    const query = {
      select: () => query, single: () => query, order: () => query,
      eq: (key: string, id: number) => { expect([key, id]).toEqual([table === "quotations" ? "id" : "quotation_id", 7]); return query; },
      range: (from: number, to: number) => { expect(to).toBe(from + 499); offset = from; return query; },
      then: (resolve: (result: unknown) => unknown) => {
        if (table === "quotations") return Promise.resolve(resolve({ data: { id: 7, customer_name: "Fixture" }, error: null }));
        mock.pages.push(offset);
        return Promise.resolve(resolve(offset && mock.failLater
          ? { data: null, error: new Error("Connection interrupted") }
          : { data: Array.from({ length: offset < 1000 ? 500 : 1 }, (_, i) => ({ id: offset + i + 1, product: `Line ${offset + i}`, qty: 1, rate: 1, discount: 0, tax: 0 })), error: null }));
      },
    };
    return query;
  },
}) }));
import { quotes, setCacheOrg } from "../api";
beforeEach(() => {
  localStorage.clear(); localStorage.setItem("filey_data_mode", "cloud");
  setCacheOrg(null); setCacheOrg("fixture-org", "fixture-user");
  mock.failLater = false; mock.pages = [];
});
it("loads every child page without fetching another document's rows", async () => {
  expect((await quotes.getDoc(7)).items).toHaveLength(1001);
  expect(mock.pages).toEqual([0, 500, 1000]);
});
it("rejects a later-page failure instead of displaying a partial document", async () => {
  mock.failLater = true;
  await expect(quotes.getDoc(7)).rejects.toThrow("Connection interrupted");
});
