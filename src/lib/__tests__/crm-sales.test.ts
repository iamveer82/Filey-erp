import { beforeEach, expect, it, vi } from "vitest";
import { quotes, billing, setCacheOrg } from "../api";
import { localClient } from "../localdb";
import { dealQuoteContext, linkDealQuotation } from "../crmSales";
beforeEach(() => { localStorage.clear(); localStorage.setItem("filey_data_mode", "local"); setCacheOrg("test", "owner"); });
const draft = { number: "QT-001", status: "draft", template: "minimal", accent: "#111111", seller_name: "Seller", customer_name: "Customer", currency: "USD", fx_rate: 3.6725, notes: "Agreed scope", terms: "Net 30", tax_rate: 0, discount: 0, items: [{ product: "Consulting", qty: 1, rate: 120, tax: 0, discount: 0 }] } as never;
it("converts once under simultaneous requests, preserves currency and terms and produces no payment", async () => {
  const quote = await quotes.saveDoc(draft);
  await quotes.saveDoc({ ...draft as object, id: quote, fx_rate: null } as never);
  expect((await quotes.getDoc(quote)).fx_rate).toBe(3.6725);
  const [a, b] = await Promise.all([quotes.convertToInvoice(quote), quotes.convertToInvoice(quote)]);
  expect(a).toBe(b);
  expect(await billing.listDocs()).toHaveLength(1);
  const invoice = await billing.getDoc(a);
  expect(invoice).toMatchObject({ quotation_id: quote, currency: "USD", fx_rate: 3.6725, notes: "Agreed scope", terms: "Net 30", status: "draft" });
  expect(invoice.items).toHaveLength(1);
  expect((await quotes.getDoc(quote)).status).toBe("accepted");
  expect((await localClient.from("invoice_payments").select()).data).toEqual([]);
});
it("rolls back the new invoice and quote status when line persistence fails", async () => {
  const quote = await quotes.saveDoc(draft);
  const original = Storage.prototype.setItem;
  const failure = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function(this: Storage, key, value) {
    if (key === "localdb:invoice_doc_items") throw new Error("Disk full");
    original.call(this, key, value);
  });
  try { await expect(quotes.convertToInvoice(quote)).rejects.toThrow("Disk full"); }
  finally { failure.mockRestore(); }
  expect(await billing.listDocs()).toEqual([]);
  expect((await quotes.getDoc(quote)).status).toBe("draft");
  expect(await quotes.convertToInvoice(quote)).toBeGreaterThan(0);
});
it("links a compatible quote to a deal and refuses another company's document or replacement", async () => {
  await localClient.from("crm_customers").insert({ id: 1, company: "Acme", name: "A" });
  await localClient.from("crm_customers").insert({ id: 2, company: "Other", name: "B" });
  await localClient.from("crm_opportunities").insert({ id: 1, title: "Supply", customer_id: 1, quotation_id: null });
  const quote = await quotes.saveDoc({ ...draft as object, customer_id: 1 } as never);
  const wrong = await quotes.saveDoc({ ...draft as object, number: "QT-OTHER", customer_id: 2 } as never);
  await expect(linkDealQuotation(1, wrong)).rejects.toThrow("same company");
  await linkDealQuotation(1, quote); await linkDealQuotation(1, quote);
  expect((await dealQuoteContext(1)).deal.quotation_id).toBe(quote);
  await expect(linkDealQuotation(1, wrong)).rejects.toThrow("already has a quotation");
});
