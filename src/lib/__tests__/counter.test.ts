import { beforeEach, expect, it, vi } from "vitest";
import { billing, erp, fin, type Product } from "../api";
import { BATCHES_KEY } from "../batches";
import { cartTotal, counterItems, counterMethods, findProducts, isCounterSale, lineFor, sellable, sellAtCounter } from "../counter";
import { applyRoundOff } from "../money";
import { docTotals } from "../docItems";

vi.mock("../exchange-rates", async (original) => ({
  ...await original<typeof import("../exchange-rates")>(),
  getExchangeRates: async () => ({ AED: 1 }),
}));
vi.mock("../documentNumbers", () => ({ allocateDocumentNumber: vi.fn(async () => "CM-0001") }));
beforeEach(() => { localStorage.clear(); localStorage.setItem("filey_data_mode", "local"); });

const TODAY = "2026-11-01";
const med = (extra: Partial<Product> = {}) => ({ id: 1, name: "Paracetamol 500mg", sku: "PCM500", barcode: "8901234567890", category: "Tablets",
  quantity: 30, unit_price: 10, cost_price: 6, reorder_level: 5, created_at: "",
  custom_fields: { [BATCHES_KEY]: JSON.stringify([{ no: "OLD1", exp: "2026-09-30", qty: 10 }, { no: "NEW2", exp: "2027-06-30", qty: 20, mrp: 12 }]) }, ...extra }) as Product;
const tee = (extra: Partial<Product> = {}) => ({ id: 2, name: "Cotton T-shirt", sku: "TS-M", barcode: "111", category: "Clothing",
  quantity: 1, unit_price: 25, cost_price: 12, reorder_level: 0, created_at: "", custom_fields: {}, ...extra }) as Product;

it("finds any product by barcode or SKU exactly, or by name, category and batch", () => {
  const list = [med(), tee()];
  expect(findProducts(list, "8901234567890").map((p) => p.id)).toEqual([1]);
  expect(findProducts(list, "ts-m").map((p) => p.id)).toEqual([2]);
  expect(findProducts(list, "clothing").map((p) => p.id)).toEqual([2]);
  expect(findProducts(list, "new2").map((p) => p.id)).toEqual([1]);
  expect(findProducts(list, "  ")).toEqual([]);
});

it("sells a batched product from its in-date batch at MRP, and a plain one at its price", () => {
  expect(lineFor(med(), TODAY)).toEqual({ productId: 1, name: "Paracetamol 500mg", qty: 1, price: 12, batch: "NEW2", exp: "2027-06-30" });
  expect(sellable(med(), TODAY)).toBe(20);
  expect(() => lineFor(med({ quantity: 4, custom_fields: { [BATCHES_KEY]: JSON.stringify([{ no: "OLD1", exp: "2026-09-30", qty: 10 }]) } }), TODAY)).toThrow("Only expired stock");
  // A product without batches sells like an invoice line, even past zero stock.
  expect(lineFor(tee({ quantity: 0 }), TODAY, 2)).toEqual({ productId: 2, name: "Cotton T-shirt", qty: 2, price: 25 });
});

it("offers UPI to Indian businesses only", () => {
  expect(counterMethods(true).map(([v]) => v)).toEqual(["cash", "card", "upi", "bank transfer"]);
  expect(counterMethods(false).map(([v]) => v)).toEqual(["cash", "card", "bank transfer"]);
});

it("prices lines before tax so the bill, rounded, equals the shelf price", () => {
  const lines = [{ productId: 1, name: "A", qty: 3, price: 12 }, { productId: 2, name: "B", qty: 1, price: 99 }];
  const items = counterItems(lines, 5);
  expect(cartTotal(lines)).toBe(135);
  expect(applyRoundOff(docTotals(items, 0, 5, null), true).total).toBe(135);
});

it("records a counter sale as a paid receipt that takes the stock, batched or not", async () => {
  await erp.createProduct({ ...med(), id: undefined } as never);
  await erp.createProduct({ ...tee(), id: undefined } as never);
  const [pcm, shirt] = [...await erp.products({ fresh: true })].sort((a, b) => a.name.localeCompare(b.name)).reverse();
  await expect(sellAtCounter({ lines: [{ ...lineFor(pcm, TODAY), productId: pcm.id, qty: 25 }], method: "cash", today: TODAY })).rejects.toThrow("Only 20");
  const sale = await sellAtCounter({ lines: [{ ...lineFor(pcm, TODAY), productId: pcm.id, qty: 2 }, { ...lineFor(shirt, TODAY), productId: shirt.id, qty: 3 }],
    method: "card", patient: "R. Sharma", doctor: "Dr Rao", customer: "Asha", today: TODAY });
  expect(sale).toMatchObject({ number: "CM-0001", total: 99 });
  const doc = await billing.getDoc(sale.id);
  expect(doc.status).toBe("paid");
  expect(isCounterSale(doc)).toBe(true);
  // The default workspace charges tax, so the receipt is a tax invoice.
  expect(doc.doc_title).toBe("Tax Invoice");
  expect(doc.customer_name).toBe("Asha");
  expect(doc.notes).toBe("Patient: R. Sharma · Prescribed by: Dr Rao");
  expect(doc.items?.[0].custom).toMatchObject({ batch: "NEW2", exp: "2027-06" });
  const after = await erp.products({ fresh: true });
  expect(after.find((p) => p.id === pcm.id)?.quantity).toBe(28);
  expect(after.find((p) => p.id === shirt.id)?.quantity).toBe(-2);
  expect(Number((await fin.accounts()).find((a) => /cash|bank/i.test(a.name))?.balance)).toBe(99);
});
