import { afterEach, expect, it } from "vitest";
import { receiptFromDoc, receiptHtml, receiptPrefs, saveReceiptPrefs } from "../receipt";
import type { CompanyProfile, InvoiceDoc, InvoicePayment } from "../api";

afterEach(() => localStorage.clear());

const company = { name: "Corner <Store>", address: "12 Main Rd", city: "Pune", phone: "+91 98765 43210", trn: "27AAPFU0939F1ZV",
  currency: "INR", country_code: "IN", default_accent: "#000", default_template: "receipt" } as CompanyProfile;
const doc = {
  id: 9, number: "CM-0009", currency: "INR", tax_country_code: "IN", doc_title: "Tax Invoice", tax_rate: 5, discount: 0, round_off: true,
  seller_name: "Corner Store", seller_trn: "27AAPFU0939F1ZV", seller_country_subdivision: "Maharashtra",
  buyer_country_code: "IN", buyer_country_subdivision: "Maharashtra", customer_name: "Walk-in customer",
  issue_date: "2026-11-01", created_at: "2026-11-01T10:00:00Z", notes: "Thank you",
  items: [
    { description: "Paracetamol <500mg>", qty: 2, unit_price: 11.43, custom: { batch: "NEW2", exp: "2027-06" } },
    { description: "Cotton T-shirt", qty: 1, unit_price: 23.81, custom: {} },
  ],
} as unknown as InvoiceDoc;
const pays = [{ id: 1, invoice_id: 9, amount: 49, method: "upi", paid_at: "2026-11-01" }] as InvoicePayment[];

it("shows prices with tax included, the tax inside them by head, and a total that adds up", () => {
  const r = receiptFromDoc(doc, company, pays, { tendered: 0 });
  expect(r.lines.map((l) => [l.price, l.amount])).toEqual([[12, 24], [25, 25]]);
  expect(r.total).toBe(49);
  expect(r.roundOff).toBe(0);
  expect(r.taxes.map((t) => t.label)).toEqual(["CGST (2.5%)", "SGST (2.5%)"]);
  expect(r.paidBy).toEqual(["UPI"]);
  expect(r.shop.taxIdLabel).toBe("GSTIN");
  expect(r.lines[0]).toMatchObject({ batch: "NEW2", exp: "2027-06" });
});

it("escapes every value and sizes the page for the till roll", () => {
  const html = receiptHtml(receiptFromDoc(doc, company, pays, { tendered: 100, change: 51 }), "80mm");
  expect(html).toContain("Corner &lt;Store&gt;");
  expect(html).toContain("Paracetamol &lt;500mg&gt;");
  expect(html).not.toContain("<Store>");
  expect(html).toContain("size:80mm auto");
  expect(html).toContain("Cash given");
  expect(html).toContain("Batch NEW2");
  expect(receiptHtml(receiptFromDoc(doc, company, pays), "a4")).toContain("size:A4");
});

it("keeps the printer choice on this device", () => {
  expect(receiptPrefs()).toEqual({ width: "80mm", auto: false });
  saveReceiptPrefs({ width: "58mm", auto: true });
  expect(receiptPrefs()).toEqual({ width: "58mm", auto: true });
  localStorage.setItem("filey_receipt_prefs", "{bad");
  expect(receiptPrefs()).toEqual({ width: "80mm", auto: false });
});
