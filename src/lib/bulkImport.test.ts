// CSV import used to call the single-row create once per row, and each of
// those reloads the whole collection, re-serialises it and rewrites the sync
// journal. Measured on this store: 2000 rows took 1658ms that way and 20ms as
// one write, and the gap widens with the collection because the old shape is
// quadratic. These pin the bulk path: every row lands, and the journal records
// them all so sync still uploads the import.
import { describe, it, expect, beforeEach } from "vitest";
import { erp, crm } from "./api";
import type { Product, CrmCustomer } from "./api";
import { localClient, journalSnapshot } from "./localdb";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
});

const products = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    sku: `SKU-${i}`,
    name: `Product ${i}`,
    unit_price: 10 + i,
    cost_price: 5,
    quantity: 3,
    reorder_level: 1,
    description: "",
  })) as Omit<Product, "id" | "created_at">[];

describe("bulk import", () => {
  it("writes every product and gives each a distinct id", async () => {
    const ids = await erp.createProducts(products(250));
    expect(ids).toHaveLength(250);
    expect(new Set(ids).size).toBe(250);

    const { data } = await localClient.from("products").select("*");
    expect(data).toHaveLength(250);
    expect(data?.[0].name).toBe("Product 0");
  });

  // Chunked at 500, so a real import crosses the boundary more than once. Every
  // row still has to land, with no id reused across chunks.
  it("imports past the chunk boundary without losing or repeating a row", async () => {
    const ids = await erp.createProducts(products(1200));
    expect(ids).toHaveLength(1200);
    expect(new Set(ids).size).toBe(1200);

    const { data } = await localClient.from("products").select("*");
    expect(data).toHaveLength(1200);
    const names = new Set((data ?? []).map((r: any) => r.name));
    expect(names.has("Product 0")).toBe(true);
    expect(names.has("Product 1199")).toBe(true);
    expect(names.size).toBe(1200);
  });

  it("journals the whole import so sync still uploads it", async () => {
    await erp.createProducts(products(120));
    const j = await journalSnapshot();
    expect(j.tables.products?.changed).toHaveLength(120);
  });

  it("does nothing for an empty file rather than writing an empty row", async () => {
    expect(await erp.createProducts([])).toEqual([]);
    const { data } = await localClient.from("products").select("*");
    expect(data).toHaveLength(0);
  });

  // Bulk-select delete had the same shape: 200 selected rows meant 200 whole
  // collection rewrites (147ms vs 7ms on a 1000-row table).
  it("deletes a whole selection in one write, leaving the rest alone", async () => {
    await erp.createProducts(products(300));
    const { data: before } = await localClient.from("products").select("*");
    const doomed = (before ?? []).slice(0, 200).map((r: any) => r.id);

    await erp.deleteProducts(doomed);

    const { data: after } = await localClient.from("products").select("*");
    expect(after).toHaveLength(100);
    expect(after?.some((r: any) => doomed.includes(r.id))).toBe(false);
  });

  // Deletes chunk at 100 because the id filter rides in the URL.
  it("deletes past the chunk boundary, and only the selected rows", async () => {
    await erp.createProducts(products(400));
    const { data: before } = await localClient.from("products").select("*");
    const doomed = (before ?? []).slice(0, 250).map((r: any) => r.id);
    const survivors = (before ?? []).slice(250).map((r: any) => r.id);

    await erp.deleteProducts(doomed);

    const { data: after } = await localClient.from("products").select("*");
    expect(after).toHaveLength(150);
    expect((after ?? []).map((r: any) => r.id).sort()).toEqual(survivors.sort());
  });

  it("journals the deletes so sync removes them from the cloud too", async () => {
    await erp.createProducts(products(20));
    const { data } = await localClient.from("products").select("*");
    const ids = (data ?? []).slice(0, 5).map((r: any) => r.id);
    await erp.deleteProducts(ids);
    const j = await journalSnapshot();
    expect(j.tables.products?.deleted).toEqual(expect.arrayContaining(ids));
  });

  it("an empty selection deletes nothing", async () => {
    await erp.createProducts(products(10));
    await erp.deleteProducts([]);
    const { data } = await localClient.from("products").select("*");
    expect(data).toHaveLength(10);
  });

  it("imports customers the same way", async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      name: `Customer ${i}`,
      email: `c${i}@example.com`,
    })) as Omit<CrmCustomer, "id" | "created_at">[];
    const ids = await crm.createCustomers(rows);
    expect(ids).toHaveLength(100);
    const { data } = await localClient.from("crm_customers").select("*");
    expect(data).toHaveLength(100);
  });
});
