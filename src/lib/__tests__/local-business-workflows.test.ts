import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { localClient } from "../localdb";
import { advances, billing, erp, fin, pos, setCacheOrg } from "../api";
vi.mock("../exchange-rates", async original => ({ ...await original<typeof import("../exchange-rates")>(), getExchangeRates: async () => ({ AED: 1, USD: 4, EUR: 5 }) }));
beforeEach(() => {
  localStorage.clear(); localStorage.setItem("filey_data_mode", "local");
  setCacheOrg(null); setCacheOrg("local-business-tests", "local-business-owner");
});
afterEach(() => setCacheOrg(null));
const rows = async (table: string) => (await localClient.from(table).select()).data;
const balance = async (name: RegExp) => Number((await fin.accounts()).find(row => name.test(row.name))?.balance || 0);
const purchase = (extra = {}) => ({ po_number: "PO-ATOMIC", supplier_name: "Supplier", status: "draft", currency: "USD", fx_rate: 4,
  tax_rate: 5, discount: 0, items: [{ product_id: 1, description: "Stock", quantity: 10, unit_cost: 6 }], ...extra }) as never;
const invoice = (extra = {}) => ({ number: "INV-ADV", customer_name: "Buyer", customer_id: 1, status: "sent", currency: "USD", fx_rate: 4,
  tax_rate: 0, discount: 0, items: [{ description: "Service", qty: 1, unit_price: 100 }], ...extra }) as never;

it("does not consume or delete explicitly foreign workspace advance rows", async () => {
  await localClient.from("crm_customers").insert({ id: 1, name: "Buyer" });
  const id = await billing.saveDoc(invoice({ status: "draft", currency: "AED", fx_rate: 1, items: [{ description: "Service", qty: 1, unit_price: 1000 }] }));
  await localClient.from("advances").insert([
    { id: 5001, party_type: "customer", party_id: 1, amount: 100, paid_at: "2026-10-04" },
    { id: 5002, party_type: "customer", party_id: 1, amount: 900, org_id: "another-workspace", paid_at: "2026-10-04" },
    { id: 5003, party_type: "customer", party_id: 1, amount: -10, org_id: "another-workspace", note: `applied:inv#${id}`, paid_at: "2026-10-04" },
  ]);
  expect(await advances.creditForInvoice(1, id)).toBe(100);
  await expect(advances.applyToInvoice(1, "Buyer", id, 150)).rejects.toThrow("Insufficient customer advance");
  await advances.applyToInvoice(1, "Buyer", id, 60);
  await advances.applyToInvoice(1, "Buyer", id, 0);
  expect((await rows("advances")).filter((row: any) => row.org_id === "another-workspace")).toHaveLength(2);
  expect((await rows("advances")).find((row: any) => row.id === 5001)?.amount).toBe(100);
});

it("retains another author's imported document without making unsupported offline effects", async () => {
  await localClient.from("invoice_docs").insert({ id: 8100, number: "IMPORTED-MEMBER", status: "draft", user_id: "another-author", org_id: "local-business-tests", currency: "AED", tax_rate: 0 });
  await localClient.from("invoice_doc_items").insert({ invoice_id: 8100, description: "Imported", qty: 1, unit_price: 100, user_id: "another-author" });
  await expect(billing.setStatus(8100, "sent")).rejects.toThrow("Open cloud mode");
  expect((await rows("invoice_docs"))[0].status).toBe("draft");
  expect(await rows("transactions")).toEqual([]);
  expect(await rows("stock_movements")).toEqual([]);
});

it("does not spend imported other-author credit or overwrite its same-org allocation", async () => {
  await localClient.from("crm_customers").insert({ id: 1, name: "Buyer" });
  const id = await billing.saveDoc(invoice({ status: "draft", currency: "AED", fx_rate: 1, items: [{ description: "Service", qty: 1, unit_price: 1000 }] }));
  await localClient.from("advances").insert([
    { id: 5101, party_type: "customer", party_id: 1, amount: 100, paid_at: "2026-10-04" },
    { id: 5102, party_type: "customer", party_id: 1, amount: 900, org_id: "local-business-tests", user_id: "other-author", paid_at: "2026-10-04" },
  ]);
  expect(await advances.creditForInvoice(1, id)).toBe(100);
  expect(await advances.creditFor(1)).toBe(100);
  await expect(advances.applyToInvoice(1, "Buyer", id, 150)).rejects.toThrow("Insufficient customer advance");
  await advances.applyToInvoice(1, "Buyer", id, 60);
  await expect(advances.remove(5101)).rejects.toThrow("already allocated");
  await localClient.from("advances").insert({ id: 5103, party_type: "customer", party_id: 1, amount: -10,
    org_id: "local-business-tests", user_id: "other-author", note: `applied:inv#${id}`, paid_at: "2026-10-04" });
  const before = await rows("advances");
  await expect(advances.applyToInvoice(1, "Buyer", id, 0)).rejects.toThrow("Open cloud mode to reconcile");
  expect(await rows("advances")).toEqual(before);
  expect((await rows("invoice_docs"))[0].advance_applied).toBe(60);
});

it("refuses an intact-looking own deposit when legacy borrowing overdraws another author's pool", async () => {
  await localClient.from("crm_customers").insert({ id: 1, name: "Buyer" });
  const id = await billing.saveDoc(invoice({ status: "draft", currency: "AED", fx_rate: 1, items: [{ description: "Service", qty: 1, unit_price: 1000 }] }));
  await localClient.from("advances").insert({ id: 5201, party_type: "customer", party_id: 1, amount: 100, paid_at: "2026-10-04" });
  await advances.applyToInvoice(1, "Buyer", id, 20);
  const allocation = (await rows("advances")).find((row: any) => row.note === `applied:inv#${id}`).id;
  await localClient.from("advances").insert({ id: 5202, party_type: "customer", party_id: 1, amount: -60,
    org_id: "local-business-tests", user_id: "borrower-author", note: "applied:inv#9999", paid_at: "2026-10-04" });
  const before = await rows("advances");
  await expect(advances.creditForInvoice(1, id)).rejects.toThrow("overdrawn author pool");
  await expect(advances.applyToInvoice(1, "Buyer", id, 80)).rejects.toThrow("overdrawn author pool");
  await expect(advances.remove(5201)).rejects.toThrow("overdrawn author pool");
  expect(await rows("advances")).toEqual(before);
  expect((await rows("invoice_docs"))[0].advance_applied).toBe(20);
  await billing.saveDoc(invoice({ id, status: "draft", currency: "AED", fx_rate: 1, advance_applied: 20, notes: "Safe note edit",
    items: [{ description: "Service", qty: 1, unit_price: 1000 }] }));
  expect((await rows("advances")).find((row: any) => row.note === `applied:inv#${id}`).id).toBe(allocation);
  await advances.update(5201, { note: "Deposit notes remain editable" });
  expect((await rows("advances")).find((row: any) => row.id === 5201).note).toBe("Deposit notes remain editable");
  await advances.applyToInvoice(1, "Buyer", id, 0);
  expect((await rows("advances")).find((row: any) => row.id === 5202).amount).toBe(-60);
  expect((await rows("invoice_docs"))[0].advance_applied).toBe(0);
  expect(await rows("transactions")).toEqual([]);
  // Fixture maintenance represents explicit reconciliation of the imported
  // foreign-author history, rather than deleting it through an own-author UI.
  await localClient.from("advances").delete().eq("id", 5202);
  expect(await advances.creditForInvoice(1, id)).toBe(100);
  await advances.applyToInvoice(1, "Buyer", id, 80);
  expect(await advances.creditFor(1)).toBe(20);
});

it("rolls back receiving failure, posts once, and restores quantity, unit cost and AP on unreceive", async () => {
  await localClient.from("products").insert({ id: 1, name: "Stock", quantity: 10, cost_price: 2 });
  const id = await pos.save(purchase());
  const saved = Storage.prototype.setItem;
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key === "localdb:transactions") throw new Error("Ledger disk unavailable");
    saved.call(this, key, value);
  });
  try { await expect(pos.receive(id)).rejects.toThrow("Ledger disk unavailable"); } finally { spy.mockRestore(); }
  expect((await rows("products"))[0]).toMatchObject({ quantity: 10, cost_price: 2 });
  expect((await rows("purchase_orders"))[0]).toMatchObject({ status: "draft" });
  expect(await rows("transactions")).toEqual([]);
  await pos.receive(id); await pos.receive(id);
  expect((await rows("products"))[0]).toMatchObject({ quantity: 20, cost_price: 13 });
  expect(await balance(/payable/i)).toBe(252);
  expect((await rows("transactions")).every((row: any) => row.po_id === id)).toBe(true);
  await pos.setStatus(id, "draft");
  expect((await rows("products"))[0]).toMatchObject({ quantity: 10, cost_price: 2 });
  expect(await balance(/payable/i)).toBe(0);
});

it("posts supplier cash/AP/FX and prevents unposting or changing settlement identity until payment is reversed", async () => {
  const id = await pos.save(purchase({ items: [{ description: "Service", quantity: 1, unit_cost: 100 }], tax_rate: 0, currency: "EUR", fx_rate: 4 }));
  await pos.receive(id);
  const pay = await pos.addPayment(id, 100, "bank", "2026-10-04");
  expect(await balance(/cash|bank/i)).toBe(-500);
  expect(await balance(/payable/i)).toBe(0);
  expect(await balance(/foreign exchange/i)).toBe(100);
  await expect(pos.setStatus(id, "draft")).rejects.toThrow("Remove the recorded payments");
  await expect(pos.save(purchase({ id, status: "received", currency: "USD" }))).rejects.toThrow("Remove the recorded payments");
  await pos.removePayment(pay);
  expect(await balance(/cash|bank/i)).toBe(0);
  expect(await balance(/payable/i)).toBe(400);
  expect(await balance(/foreign exchange/i)).toBe(0);
});

it("consumes advances at frozen FX, refuses over-allocation or spent-deposit deletion, and releases credit on cancellation", async () => {
  await localClient.from("crm_customers").insert({ id: 1, name: "Buyer" });
  const deposit = await advances.add({ party_type: "customer", party_id: 1, party_name: "Buyer", amount: 100, paid_at: "2026-10-04" });
  expect(await balance(/cash|bank/i)).toBe(100);
  expect(await balance(/customer advances/i)).toBe(100);
  const id = await billing.saveDoc(invoice({ advance_applied: 20 }));
  expect(await balance(/receivable/i)).toBe(320);
  expect(await balance(/customer advances/i)).toBe(20);
  await expect(billing.saveDoc(invoice({ id, advance_applied: 26 }))).rejects.toThrow("Insufficient customer advance");
  expect(await balance(/receivable/i)).toBe(320);
  await expect(advances.remove(deposit)).rejects.toThrow("already allocated");
  await billing.setStatus(id, "cancelled");
  expect(await balance(/receivable/i)).toBe(0);
  expect((await rows("advances")).reduce((sum: number, row: any) => sum + Number(row.amount), 0)).toBe(100);
  await advances.remove(deposit);
  expect(await balance(/cash|bank/i)).toBe(0);
});

it("rejects receipt edits after downstream stock uses its average cost and leaves the document unchanged", async () => {
  await localClient.from("products").insert({ id: 1, name: "Stock", quantity: 10, cost_price: 2 });
  const id = await pos.save(purchase({ currency: "AED" }));
  await pos.receive(id); await erp.updateStock(1, -1);
  await expect(pos.setStatus(id, "draft")).rejects.toThrow("Later stock movements");
  expect((await rows("products"))[0]).toMatchObject({ quantity: 19, cost_price: 4 });
  expect((await rows("purchase_orders"))[0]).toMatchObject({ status: "received", stock_received: true });
  expect(await balance(/payable/i)).toBe(63);
});
