import { beforeEach, expect, it, vi } from "vitest";
import { billing, erp, fin } from "../api";
import { setDataMode } from "../dataMode";
import { localClient } from "../localdb";

vi.mock("../exchange-rates", async (importOriginal) => ({
  ...await importOriginal<typeof import("../exchange-rates")>(),
  getExchangeRates: async () => ({ AED: 1, USD: 3.6725 }),
}));
beforeEach(() => { localStorage.clear(); setDataMode("local"); });
const invoice = (extra = {}) => ({ number: "INV-LIFE", customer_name: "Acme", status: "sent",
  currency: "AED", tax_rate: 0, discount: 0,
  items: [{ description: "Service", qty: 1, unit_price: 100 }], ...extra }) as never;
const balance = async (name: RegExp) => Number((await fin.accounts()).find((a) => name.test(a.name))?.balance ?? 0);
const pay = (id: number, amount: number) => billing.addPayment(id, amount, "cash", "2026-09-04");

it("removes only the selected payment and preserves the sale and other receipts", async () => {
  const id = await billing.saveDoc(invoice());
  const first = await pay(id, 30);
  await pay(id, 70);
  await billing.removePayment(first!);
  expect(await balance(/sales revenue/i)).toBe(100);
  expect(await balance(/cash|bank/i)).toBe(70);
  expect(await balance(/receivable/i)).toBe(30);
  expect(await billing.payments(id)).toHaveLength(1);
});

it("preserves receipts when an invoice is edited or renamed", async () => {
  const id = await billing.saveDoc(invoice());
  const payment = await pay(id, 40);
  await billing.saveDoc(invoice({ id, number: "INV-RENAMED" }));
  expect(await balance(/cash|bank/i)).toBe(40);
  expect(await balance(/receivable/i)).toBe(60);
  await billing.removePayment(payment!);
  expect(await balance(/cash|bank/i)).toBe(0);
  expect(await balance(/receivable/i)).toBe(100);
});

it("deletes an invoice, its receipts and child rows, but preserves other invoices", async () => {
  const id = await billing.saveDoc(invoice());
  await pay(id, 40);
  const other = await billing.saveDoc(invoice({ number: "INV-OTHER" }));
  await pay(other, 20);
  await billing.deleteDoc(id);
  expect(await balance(/sales revenue/i)).toBe(100);
  expect(await balance(/cash|bank/i)).toBe(20);
  expect(await balance(/receivable/i)).toBe(80);
  for (const table of ["invoice_doc_items", "invoice_payments", "transactions"]) {
    const { data } = await localClient.from(table).select("*").eq("invoice_id", id);
    expect(data).toHaveLength(0);
  }
  expect((await billing.listDocs()).map((d) => d.id)).toEqual([other]);
});

it("restores the old quantity when editing stock-linked lines, then restores stock on delete", async () => {
  const productId = await erp.createProduct({ sku: "LIFE", name: "Widget", quantity: 20,
    cost_price: 4, unit_price: 10, reorder_level: 0 } as never);
  const lines = (qty: number) => [{ description: "Widget", qty, unit_price: 10, product_id: productId }];
  const id = await billing.saveDoc(invoice({ items: lines(3) }));
  await billing.saveDoc(invoice({ id, items: lines(7) }));
  expect((await erp.products())[0].quantity).toBe(13);
  await billing.deleteDoc(id);
  expect((await erp.products())[0].quantity).toBe(20);
  expect(await balance(/sales revenue/i)).toBe(0);
});

it("keeps overdue invoices posted", async () => {
  const id = await billing.saveDoc(invoice());
  await billing.setStatus(id, "overdue");
  expect(await balance(/sales revenue/i)).toBe(100);
  expect(await balance(/receivable/i)).toBe(100);
});

it("restores free stock items even when the invoice has no ledger entries", async () => {
  const productId = await erp.createProduct({ sku: "FREE", name: "Sample", quantity: 10,
    cost_price: 0, unit_price: 0, reorder_level: 0 } as never);
  const id = await billing.saveDoc(invoice({ items: [{ description: "Sample", qty: 3,
    unit_price: 0, product_id: productId }] }));
  await billing.setStatus(id, "overdue");
  expect((await erp.products())[0].quantity).toBe(7);
  await billing.deleteDoc(id);
  expect((await erp.products())[0].quantity).toBe(10);
  expect(await erp.orders()).toHaveLength(0);
});

it("preserves the account balance if deleting its transaction fails", async () => {
  const id = await billing.saveDoc(invoice());
  const before = await fin.accounts();
  const realFrom = localClient.from.bind(localClient);
  const spy = vi.spyOn(localClient, "from").mockImplementation((table) => {
    const builder = realFrom(table);
    if (table === "transactions") builder.delete = () => ({ eq: async () => ({ data: null,
      error: new Error("Delete denied") }) }) as never;
    return builder;
  });
  try { await expect(billing.deleteDoc(id)).rejects.toThrow("Delete denied"); }
  finally { spy.mockRestore(); }
  expect(await fin.accounts()).toEqual(before);
});

it("can identify an older receipt without removing the other legacy payment", async () => {
  const id = await billing.saveDoc(invoice());
  const first = await pay(id, 30);
  await pay(id, 70);
  await localClient.from("transactions").update({ ref: "Invoice INV-LIFE Payment" }).eq("source", "payment");
  await billing.removePayment(first!);
  expect(await balance(/sales revenue/i)).toBe(100);
  expect(await balance(/cash|bank/i)).toBe(70);
  expect(await balance(/receivable/i)).toBe(30);
});

it("does not delete the invoice when ledger cleanup fails", async () => {
  const id = await billing.saveDoc(invoice());
  const realFrom = localClient.from.bind(localClient);
  const spy = vi.spyOn(localClient, "from").mockImplementation((table) => {
    if (table === "transactions") return { select: () => ({ eq: async () => ({ data: null, error: new Error("Ledger unavailable") }) }) } as never;
    return realFrom(table);
  });
  try { await expect(billing.deleteDoc(id)).rejects.toThrow("Ledger unavailable"); }
  finally { spy.mockRestore(); }
  expect((await billing.getDoc(id)).items).toHaveLength(1);
});
