// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from "vitest";
import { billing, erp, fin, type InvoiceDocInput } from "../api";
import { setDataMode } from "../dataMode";
import { groupInvoiceRows, invoiceImportIssues, readSupplierInvoice } from "../invoiceImport";
import { buildInvoiceXml, computeTotals } from "../einvoiceXml";
import { docTotals } from "../docItems";

vi.mock("../exchange-rates", async (original) => ({
  ...await original<typeof import("../exchange-rates")>(), getExchangeRates: async () => ({ AED: 1 }),
}));
const base = (): InvoiceDocInput => ({ number: "INV-DEMO", customer_name: "Demo customer", seller_name: "Demo seller",
  status: "draft", template: "corporate", accent: "#222222", currency: "AED", issue_date: "2026-09-29",
  tax_country_code: "AE", tax_rate: 5, discount: 0, einvoice: {}, items: [{ description: "Service", qty: 1, unit_price: 100 }] });
beforeEach(() => { localStorage.clear(); setDataMode("local"); });

test("saved identity survives edits; copies receive a different UUID", async () => {
  const id = await billing.saveDoc(base());
  const first = await billing.getDoc(id);
  expect(first.einvoice?.uuid).toMatch(/^[a-f0-9-]{36}$/);
  await billing.saveDoc({ ...first, einvoice: { uuid: crypto.randomUUID(), buyer: { tin: "1000000001" } } });
  expect((await billing.getDoc(id)).einvoice?.uuid).toBe(first.einvoice?.uuid);
  const copy = await billing.saveDoc({ ...first, id: undefined, number: "INV-COPY" });
  expect((await billing.getDoc(copy)).einvoice?.uuid).not.toBe(first.einvoice?.uuid);
});

test.each(["381", "81"])("credit note %s reduces AR, revenue and VAT without changing stock; reverting restores balances", async (invoice_type_code) => {
  const product = await erp.createProduct({ sku: "CREDIT-TEST", name: "Sample", quantity: 20, cost_price: 10, unit_price: 100, reorder_level: 0 } as never);
  const sale = { ...base(), status: "sent", items: [{ description: "Sample", product_id: product, qty: 1, unit_price: 100 }] };
  const saleId = await billing.saveDoc(sale);
  await expect(billing.saveDoc({ ...sale, id: saleId, invoice_type_code, original_invoice_number: "OTHER", original_invoice_date: sale.issue_date })).rejects.toThrow("separate credit note");
  const cn = await billing.saveDoc({ ...sale, number: "CN-DEMO", invoice_type_code, original_invoice_number: sale.number, original_invoice_date: sale.issue_date });
  const balance = async (name: RegExp) => Number((await fin.accounts()).find(account => name.test(account.name))?.balance ?? 0);
  expect(await balance(/sales revenue/i)).toBe(0);
  expect(await balance(/receivable/i)).toBe(0);
  expect(await balance(/output vat/i)).toBe(0);
  expect((await erp.products())[0].quantity).toBe(19);
  const summary = (await billing.listDocs()).find(doc => doc.id === cn);
  expect(summary?.total).toBe(-105);
  expect(summary?.net_by_tax_category).toEqual({ S: -100 });
  await expect(billing.addPayment(cn, 10, "cash", "2026-09-29")).rejects.toThrow("credit note");
  await billing.setStatus(cn, "draft");
  expect(await balance(/sales revenue/i)).toBe(100);
  expect(await balance(/receivable/i)).toBe(105);
  expect((await erp.products())[0].quantity).toBe(19);
});

test.each(["381", "81"])("credit note %s cannot post without an original reference or use the supplier invoice workflow", async (invoice_type_code) => {
  const credit = { ...base(), number: "CN-VALIDATION", invoice_type_code };
  await expect(billing.saveDoc({ ...credit, status: "sent" })).rejects.toThrow("original invoice number and date");
  const missingReference = await billing.saveDoc(credit);
  await expect(billing.setStatus(missingReference, "sent")).rejects.toThrow("original invoice number and date");
  expect((await billing.getDoc(missingReference)).status).toBe("draft");

  const supplierCredit = { ...credit, number: "CN-SUPPLIER", doc_type: "purchase", original_invoice_number: "BILL-ORIGINAL", original_invoice_date: credit.issue_date };
  await expect(billing.saveDoc({ ...supplierCredit, status: "sent" })).rejects.toThrow("supplier credit");
  const supplierDraft = await billing.saveDoc(supplierCredit);
  await expect(billing.setStatus(supplierDraft, "sent")).rejects.toThrow("Supplier credit");
  expect((await billing.getDoc(supplierDraft)).status).toBe("draft");
  expect(await fin.accounts()).toEqual([]);
});

test.each(["381", "81"])("volume discount credit note %s can post without an original reference but supplier credits remain blocked", async (invoice_type_code) => {
  const credit = { ...base(), number: "CN-VOLUME", invoice_type_code, einvoice: { credit_reason: "VD" } };
  const posted = await billing.saveDoc({ ...credit, status: "sent" });
  expect((await billing.getDoc(posted)).status).toBe("sent");
  const draft = await billing.saveDoc({ ...credit, number: "CN-VOLUME-DRAFT" });
  await billing.setStatus(draft, "sent");
  expect((await billing.getDoc(draft)).status).toBe("sent");
  expect(Number((await fin.accounts()).find(account => /receivable/i.test(account.name))?.balance)).toBe(-210);

  const supplier = { ...credit, number: "CN-SUPPLIER-VOLUME", doc_type: "purchase" };
  await expect(billing.saveDoc({ ...supplier, status: "sent" })).rejects.toThrow("supplier credit");
  const supplierDraft = await billing.saveDoc(supplier);
  await expect(billing.setStatus(supplierDraft, "sent")).rejects.toThrow("Supplier credit");
  expect((await billing.getDoc(supplierDraft)).status).toBe("draft");
});

test("CSV groups lines, flags duplicates and never hides invalid quantities", () => {
  const row = { number: "CSV-1", customer_name: "Sample", issue_date: "2026-09-29", description: "Work", qty: "2", unit_price: "10" };
  const drafts = groupInvoiceRows([row, { ...row, description: "Extra" }], base());
  expect(drafts).toHaveLength(1); expect(drafts[0].items).toHaveLength(2);
  expect(invoiceImportIssues(drafts[0], new Set())).toEqual([]);
  expect(invoiceImportIssues(drafts[0], new Set(["csv-1"])).join()).toContain("already exists");
  expect(() => groupInvoiceRows([row, { ...row, customer_name: "Different" }], base())).toThrow("different customer");
  expect(invoiceImportIssues(groupInvoiceRows([{ ...row, qty: "oops" }], base())[0], new Set()).join()).toContain("quantity");
  expect(invoiceImportIssues(groupInvoiceRows([{ ...row, due_date: "2026-02-30", tax_category: "unknown" }], base())[0], new Set()).join()).toMatch(/due date.*tax category/);
});

test("supplier XML stays a draft, preserves line totals, and rejects entities or unsupported adjustments", () => {
  const source = { ...base(), due_date: "2026-10-29", payment_means_code: "10",
    seller_address: "Office 1", seller_city: "Dubai", seller_country_subdivision: "DXB", seller_legal_id: "LICENCE-1", seller_legal_id_type: "TL",
    customer_address: "Office 2", buyer_city: "Dubai", buyer_country_subdivision: "DXB",
    einvoice: { uuid: crypto.randomUUID(), seller: { tin: "1000000000", legal_authority: "Dubai Economy" }, buyer: { tin: "1007774567" } }, seller_trn: "100000000000003" };
  const xml = buildInvoiceXml(source);
  const imported = readSupplierInvoice(xml, base());
  expect(imported.doc_type).toBe("purchase"); expect(imported.status).toBe("draft");
  expect(imported.customer_name).toBe("Demo seller"); expect(imported.items[0].unit_price).toBe(100);
  expect(imported.customer_trn).toBe(source.seller_trn);
  expect(() => readSupplierInvoice(xml, { ...base(), tax_country_code: "IN" })).toThrow("UAE workspaces");
  expect(() => readSupplierInvoice('<!DOCTYPE Invoice [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + xml, base())).toThrow("entities");
  expect(() => readSupplierInvoice(buildInvoiceXml({ ...source, discount: 5 }), base())).toThrow("adjustments");
});

test("screen, PDF and XML calculations agree for line discounts, mixed VAT and cent allocation", () => {
  const doc = { ...base(), discount: 7.73, items: [
    { description: "S", qty: 3, unit_price: 19.99, discount: 12, tax_category: "S" },
    { description: "Z", qty: 2, unit_price: 31.43, tax_category: "Z" },
    { description: "E", qty: 1, unit_price: 4.99, tax_category: "E" },
  ] };
  const screen = docTotals(doc.items, doc.discount, doc.tax_rate);
  const xml = computeTotals(doc);
  expect(xml.taxTotal).toBe(screen.tax); expect(xml.taxInclusive).toBe(screen.total);
  expect(xml.taxExclusive).toBeCloseTo(screen.subtotal - screen.discount, 2);
});
