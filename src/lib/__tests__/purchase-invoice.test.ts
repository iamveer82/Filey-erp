import { beforeEach, describe, expect, it } from "vitest";
import { setDataMode } from "../dataMode";
import { billing, fin, erp } from "../api";

// A purchase invoice (supplier bill) is the mirror of a sales invoice: stock IN,
// debit Purchases, credit Accounts Payable. Reverting must undo all of it.
beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
});

const bal = (accts: { name: string; balance: number }[], re: RegExp) =>
  accts.find((a) => re.test(a.name))?.balance ?? 0;

describe("purchase invoice (supplier bill)", () => {
  it("posts Purchases + Accounts Payable and increases stock", async () => {
    const pid = (await erp.createProduct({
      sku: "PX",
      name: "Bolt",
      unit_price: 0,
      cost_price: 4,
      quantity: 10,
      reorder_level: 0,
    } as any)) as number;

    const id = (await billing.saveDoc({
      number: "PINV-1",
      doc_type: "purchase",
      status: "sent",
      currency: "AED",
      tax_rate: 0,
      discount: 0,
      customer_name: "Acme Supplies",
      items: [{ description: "Bolt", qty: 5, unit_price: 4, product_id: pid }],
    } as any)) as number;

    const accts = await fin.accounts();
    expect(bal(accts, /inventory|stock/i)).toBe(20); // debit Inventory (asset up)
    expect(bal(accts, /payable|creditors/i)).toBe(20); // credit AP (creditor up)
    const prod = (await erp.products()).find((p) => p.sku === "PX");
    expect(prod?.quantity).toBe(15); // stock IN (+5)

    await billing.setStatus(id, "draft");
    const accts2 = await fin.accounts();
    expect(bal(accts2, /inventory|stock/i)).toBe(0); // reversed
    expect(bal(accts2, /payable|creditors/i)).toBe(0);
    const prod2 = (await erp.products()).find((p) => p.sku === "PX");
    expect(prod2?.quantity).toBe(10); // stock restored
  });

  it("keeps sales and purchase lists separate", async () => {
    await billing.saveDoc({
      number: "INV-9",
      status: "draft",
      currency: "AED",
      tax_rate: 0,
      discount: 0,
      customer_name: "C",
      items: [],
    } as any);
    await billing.saveDoc({
      number: "PINV-9",
      doc_type: "purchase",
      status: "draft",
      currency: "AED",
      tax_rate: 0,
      discount: 0,
      customer_name: "S",
      items: [],
    } as any);
    const sales = await billing.listDocs("sales");
    const purchases = await billing.listDocs("purchase");
    expect(sales.some((d) => d.number === "INV-9")).toBe(true);
    expect(sales.some((d) => d.number === "PINV-9")).toBe(false);
    expect(purchases.some((d) => d.number === "PINV-9")).toBe(true);
  });
});
