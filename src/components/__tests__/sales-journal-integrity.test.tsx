import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { billing, type CompanyProfile, type CrmCustomer, type InvoiceDoc, type ReceiptSummary } from "../../lib/api";
import { buildSalesJournal } from "../statements/buildSalesJournal";
import { SalesJournalTemplate } from "../statements/SalesJournalTemplate";

const customer = { id: 7, name: "Journal customer", company: "Journal company" } as CrmCustomer;
const company = { name: "Seller", country_code: "IN", currency: "INR" } as CompanyProfile;
const invoice = (patch: Partial<InvoiceDoc> = {}): InvoiceDoc => ({
  id: 1, number: "INV-1", customer_id: 7, customer_name: customer.name, status: "sent",
  template: "corporate", accent: "#000", currency: "USD", seller_name: company.name,
  tax_rate: 5, discount: 0, issue_date: "2026-09-01", created_at: "2026-09-01", updated_at: "2026-09-01",
  items: [{ description: "Service", qty: 1, unit_price: 100 }], ...patch,
});
const receipt = (patch: Partial<ReceiptSummary> = {}): ReceiptSummary => ({
  id: 8, number: "REC-8", customer_name: customer.name, status: "paid", template: "corporate",
  amount: 20, currency: "USD", payment_date: "2026-09-02", updated_at: "2026-09-02", ...patch,
});
const build = (ids: number[] = [1], receipts: ReceiptSummary[] = []) => buildSalesJournal({
  customerId: customer.id, customer, company, invoiceIds: ids, receipts,
});
beforeEach(() => { vi.spyOn(billing, "payments").mockResolvedValue([]); });
afterEach(() => vi.restoreAllMocks());

it.each(["missing", "rejected"])("refuses incomplete journals when an invoice is %s", async failure => {
  vi.spyOn(billing, "getDoc").mockImplementation(async id => {
    if (id === 2) { if (failure === "rejected") throw new Error("Offline"); return null as unknown as InvoiceDoc; }
    return invoice();
  });
  await expect(build([1, 2])).rejects.toThrow("1 of 2 invoices could not be loaded");
});

it("keeps only issued sales and completed receipts in a single explicitly labelled currency", async () => {
  const docs = [invoice(), invoice({ id: 2, number: "DRAFT", status: "draft" }), invoice({ id: 3, currency: "AED", number: "OTHER-CURRENCY" })];
  vi.spyOn(billing, "getDoc").mockImplementation(async id => docs.find(doc => doc.id === id)!);
  const data = await build([1, 2, 3], [receipt(), receipt({ id: 9, status: "draft", amount: 800 }), receipt({ id: 10, currency: "AED", amount: 900 })]);
  expect(data.summary).toEqual({ totalSales: 105, totalReceived: 20, totalVat: 5, netBalance: -85 });
  expect(data.transactions.some(line => line.invoiceNo === "DRAFT" || line.invoiceNo === "OTHER-CURRENCY")).toBe(false);
  const html = renderToStaticMarkup(<SalesJournalTemplate data={data} />);
  expect(html).toContain("USD 105.00");
  expect(html).toContain("AED transactions are excluded");
  expect(html).toContain("GST breakdown");
  expect(html).not.toContain("AED 105.00");
});

it("reconciles persisted manual lines, per-line discounts and tax categories, document discounts and round-off", async () => {
  vi.spyOn(billing, "getDoc").mockResolvedValue(invoice({
    discount: 10, round_off: true,
    items: [
      { description: "Manual taxed", qty: 9, unit_price: 500, custom: { __calc_mode: "manual", __manual_amount: "123.45", __disc_pct: "10", __tax_pct: "7" } },
      { description: "Exempt", qty: 2, unit_price: 20, tax_category: "E" },
    ],
  }));
  const data = await build();
  expect(data.summary).toEqual({ totalSales: 148, totalReceived: 0, totalVat: 7.26, netBalance: -148 });
  const sales = data.transactions.filter(line => line.received === "—");
  const sum = (key: "amount" | "vat" | "total") => Math.round(sales.reduce((n, line) => n + (Number(line[key]) || 0), 0) * 100) / 100;
  expect(sum("total")).toBe(data.summary.totalSales);
  expect(sum("vat")).toBe(data.summary.totalVat);
  expect(sum("amount")).toBe(140.74);
  expect(sales.find(line => line.description === "Exempt")?.vat).toBe("—");
  expect(sales.some(line => line.description === "Invoice discount and tax adjustment")).toBe(true);
  expect(sales.some(line => line.description === "Round-off adjustment")).toBe(true);
});

it("subtracts credit notes instead of increasing customer sales", async () => {
  vi.spyOn(billing, "getDoc").mockImplementation(async id => invoice({ id, number: id === 1 ? "INV-1" : "CN-2", invoice_type_code: id === 2 ? "381" : "380", items: [{ description: "Service", qty: 1, unit_price: id === 1 ? 100 : 25 }] }));
  const data = await build([1, 2]);
  expect(data.summary.totalSales).toBe(78.75);
  expect(data.summary.totalVat).toBe(3.75);
  expect(data.transactions.find(line => line.invoiceNo === "CN-2")?.total).toBe("-26.25");
});

it("sorts calendar dates chronologically and keeps invoice items before same-day receipts", async () => {
  vi.spyOn(billing, "getDoc").mockImplementation(async id => invoice({ id, number: `INV-${id}`, issue_date: id === 1 ? "2026-09-02" : "2026-10-01" }));
  const data = await build([2, 1], [receipt({ payment_date: "2026-09-02" }), receipt({ id: 9, payment_date: "2026-08-31" })]);
  expect(data.transactions.map(line => line.invoiceNo || "receipt")).toEqual(["receipt", "INV-1", "receipt", "INV-2"]);
  expect(data.period.from).toContain("31");
  expect(data.period.from).toContain("Aug");
});

it("deduplicates document IDs and reconciles category tax rounding rather than taxing every displayed line twice", async () => {
  const read = vi.spyOn(billing, "getDoc").mockResolvedValue(invoice({ items: [
    { description: "Small line A", qty: 1, unit_price: 0.1 },
    { description: "Small line B", qty: 1, unit_price: 0.1 },
  ] }));
  const data = await build([1, 1]);
  expect(read).toHaveBeenCalledTimes(1);
  expect(data.summary.totalSales).toBe(0.21);
  expect(data.summary.totalVat).toBe(0.01);
  expect(data.transactions.find(line => line.description === "Tax rounding adjustment")?.vat).toBe("-0.01");
});

it("allows a separate journal in an explicitly selected currency", async () => {
  vi.spyOn(billing, "getDoc").mockImplementation(async id => invoice({ id, currency: id === 1 ? "USD" : "AED" }));
  const data = await buildSalesJournal({ customerId: customer.id, customer, company, invoiceIds: [1, 2], receipts: [receipt({ currency: "AED" })], currency: "AED" });
  expect(data.currency).toBe("AED");
  expect(data.excludedCurrencies).toEqual(["USD"]);
  expect(data.summary.totalSales).toBe(105);
  expect(data.summary.totalReceived).toBe(20);
});

it("refuses wrong-customer or undated entries rather than issuing an inaccurate journal", async () => {
  const read = vi.spyOn(billing, "getDoc").mockResolvedValue(invoice({ customer_id: 99 }));
  await expect(build()).rejects.toThrow("different customer");
  read.mockResolvedValue(invoice());
  await expect(build([1], [receipt({ payment_date: "" })])).rejects.toThrow("Receipt REC-8 has no valid date");
});

it("includes normal invoice payments in collections without requiring a standalone receipt", async () => {
  vi.spyOn(billing, "getDoc").mockResolvedValue(invoice({ status: "paid" }));
  vi.mocked(billing.payments).mockResolvedValue([{ id: 18, invoice_id: 1, amount: 105, method: "bank", paid_at: "2026-09-02" }]);
  const data = await build();
  expect(data.summary.totalReceived).toBe(105);
  expect(data.summary.netBalance).toBe(0);
  expect(data.transactions.find(line => line.received === "105.00")?.invoiceNo).toBe("INV-1");
});

it("refuses a journal with unreadable invoice payment history", async () => {
  vi.spyOn(billing, "getDoc").mockResolvedValue(invoice());
  vi.mocked(billing.payments).mockRejectedValue(new Error("Connection failed"));
  await expect(build()).rejects.toThrow("Payments for invoice INV-1 could not be loaded");
});
