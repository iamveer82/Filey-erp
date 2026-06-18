import { beforeEach, describe, expect, it } from "vitest";
import { setDataMode } from "../dataMode";
import { erp } from "../api";

// Proves the api layer (used by every feature page) does full CRUD against the
// local on-device store when in local/offline mode — i.e. feature parity with
// the cloud build, no Supabase required.
beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
});

const sampleProduct = {
  sku: "P1",
  name: "Widget",
  unit_price: 10,
  cost_price: 5,
  quantity: 3,
  reorder_level: 1,
} as any;

describe("api feature parity in local mode", () => {
  it("creates and lists a product offline", async () => {
    const id = await erp.createProduct(sampleProduct);
    expect(typeof id).toBe("number");
    const list = await erp.products();
    expect(list.find((p) => p.sku === "P1")?.name).toBe("Widget");
  });

  it("updates and deletes a product offline", async () => {
    const id = (await erp.createProduct({ ...sampleProduct, sku: "P2", name: "Gadet" })) as number;
    await erp.updateProduct(id, { name: "Gadget" });
    let list = await erp.products();
    expect(list.find((p) => p.sku === "P2")?.name).toBe("Gadget");

    await erp.deleteProduct(id);
    list = await erp.products();
    expect(list.find((p) => p.sku === "P2")).toBeUndefined();
  });

  it("persists to the on-device store (survives a fresh read)", async () => {
    await erp.createProduct({ ...sampleProduct, sku: "P3" });
    const raw = localStorage.getItem("localdb:products");
    expect(raw).toContain("P3");
  });
});
