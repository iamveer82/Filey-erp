import { beforeEach, expect, it } from "vitest";
import { setDataMode } from "../dataMode";
import { erp } from "../api";
import { TOOLS } from "../aiTools";
import { readBatches } from "../batches";

// The agent adds and corrects products through the same checks as the product page:
// a scanned barcode finds the item, duplicates are refused, and an edit keeps the batches.
beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
});

const run = (name: string, args: Record<string, unknown>) => {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`${name} is not registered`);
  return tool.run(args) as Promise<Record<string, unknown>>;
};

it("adds, finds by barcode and corrects a product without losing its batches", async () => {
  expect(await run("create_product", { name: "Paracetamol 500mg Strip", barcode: "4006381333931", unit: "strip",
    unit_price: 12, mrp: 15, quantity: 20, batch_no: "a1", expiry: "01/30" })).toMatchObject({ ok: true, sku: "PARA-500-STRI" });
  expect(await run("create_product", { name: "Other", barcode: "4006381333931" }))
    .toMatchObject({ error: expect.stringContaining("Already on Paracetamol") });

  const [hit] = (await run("find_products", { query: "4006381333931" })) as unknown as Record<string, unknown>[];
  expect(hit).toMatchObject({ unit: "strip", mrp: 15, stock: 20, sellable: 20, next_batch: { batch: "A1", expiry: "2030-01-31" } });

  expect(await run("update_product", { name: "4006381333931", new_name: "Paracetamol 500 mg", mrp: 16 })).toMatchObject({ ok: true });
  const [p] = await erp.products({ fresh: true });
  expect(p).toMatchObject({ name: "Paracetamol 500 mg", quantity: 20 });
  expect(p.custom_fields?.mrp).toBe("16");
  expect(readBatches(p)).toHaveLength(1);

  expect(await run("profit_report", {})).toMatchObject({ sales: 0, bills: 0 });
});
