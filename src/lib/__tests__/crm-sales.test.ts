import { beforeEach, expect, it, vi } from "vitest";
import { quotes, billing, setCacheOrg } from "../api";
import { localClient } from "../localdb";
import { dealQuoteContext, linkDealQuotation } from "../crmSales";
import * as license from "../license";
beforeEach(() => { localStorage.clear(); localStorage.setItem("filey_data_mode", "local"); setCacheOrg("test", "owner"); });
const draft = { number: "QT-001", status: "draft", template: "minimal", accent: "#111111", seller_name: "Seller", customer_name: "Customer", currency: "USD", fx_rate: 3.6725, notes: "Agreed scope", terms: "Net 30", tax_rate: 0, discount: 0, items: [{ product: "Consulting", qty: 1, rate: 120, tax: 0, discount: 0 }] } as never;
it("keeps local quotation-to-invoice conversion free beyond five invoices", async () => {
  for (let i = 1; i <= 6; i++) {
    const quote = await quotes.saveDoc({ ...draft as object, number: `QT-FREE-${i}` } as never);
    await quotes.convertToInvoice(quote);
  }
  expect(await billing.listDocs()).toHaveLength(6);
});
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
it("returns an already converted invoice without consuming another number or reloading company artwork", async () => {
  const quote = await quotes.saveDoc(draft);
  const invoice = await quotes.convertToInvoice(quote);
  const before = (await localClient.from("document_number_reservations").select()).data;
  const company = vi.spyOn(billing, "getCompany");
  try {
    expect(await quotes.convertToInvoice(quote)).toBe(invoice);
    expect(await quotes.convertToInvoice(quote)).toBe(invoice);
    expect((await localClient.from("document_number_reservations").select()).data).toEqual(before);
    expect(company).not.toHaveBeenCalled();
    expect(await billing.listDocs()).toHaveLength(1);
  } finally { company.mockRestore(); }
});
it("fills missing seller presets on quotation conversion without replacing quoted contact details", async () => {
  await billing.saveCompany({ name: "Seller", country_code: "AE", city: "Dubai", address: "Current address", email: "current@example.test",
    country_subdivision: "DXB", legal_id: "TL-CURRENT", legal_id_type: "TL", currency: "AED", default_accent: "#111111", default_template: "minimal",
    einvoice: { tin: "1001234567", legal_authority: "Dubai Economy" } });
  const quote = await quotes.saveDoc({ ...draft as object, currency: "AED", seller_address: "Quoted address", seller_email: "quoted@example.test" } as never);
  const invoice = await billing.getDoc(await quotes.convertToInvoice(quote));
  expect(invoice).toMatchObject({ seller_address: "Quoted address", seller_email: "quoted@example.test", seller_city: "Dubai", tax_country_code: "AE",
    seller_legal_id: "TL-CURRENT", einvoice: { seller: { tin: "1001234567", legal_authority: "Dubai Economy" } } });
});
it("does not add a different company's identity to a quoted seller", async () => {
  await billing.saveCompany({ name: "Other seller", city: "Dubai", default_accent: "#111111", default_template: "minimal", einvoice: { tin: "1001234567" } });
  const quote = await quotes.saveDoc(draft);
  const invoice = await billing.getDoc(await quotes.convertToInvoice(quote));
  expect(invoice.seller_name).toBe("Seller");
  expect(invoice.seller_city).toBeFalsy();
  expect(invoice.einvoice?.seller?.tin).toBeFalsy();
});
it("uses the quote's saved customer ID to fill buyer presets while preserving quoted overrides", async () => {
  await localClient.from("crm_customers").insert({ id: 17, name: "Same buyer", address: "Current address", email: "current@example.test",
    city: "Sharjah", country_code: "AE", country_subdivision: "SHJ", phone_e164: "+971501234567", trn: "100777456700003",
    custom_fields: { einvoice_identity: JSON.stringify({ tin: "1007774567", legal_id: "BUYER-LICENCE" }) } });
  await localClient.from("crm_customers").insert({ id: 18, name: "Same buyer", city: "Wrong city" });
  const quote = await quotes.saveDoc({ ...draft as object, customer_id: 17, customer_name: "Same buyer",
    customer_address: "Quoted address", customer_email: "", seller_email: "" } as never);
  const invoice = await billing.getDoc(await quotes.convertToInvoice(quote));
  expect(invoice).toMatchObject({ customer_id: 17, customer_address: "Quoted address", customer_email: "", seller_email: "",
    customer_trn: "100777456700003", buyer_city: "Sharjah", buyer_country_code: "AE", buyer_country_subdivision: "SHJ",
    einvoice: { buyer: { tin: "1007774567", legal_id: "BUYER-LICENCE", phone: "+971501234567" } } });
  const unlinkedQuote = await quotes.saveDoc({ ...draft as object, number: "QT-UNLINKED", customer_name: "Same buyer" } as never);
  expect((await billing.getDoc(await quotes.convertToInvoice(unlinkedQuote))).einvoice?.buyer).toBeUndefined();
});
it("does not blend a manually overridden quote tax identity with saved customer routing", async () => {
  await localClient.from("crm_customers").insert({ id: 17, name: "Buyer", trn: "100777456700003",
    custom_fields: { einvoice_identity: JSON.stringify({ tin: "1007774567" }) } });
  const quote = await quotes.saveDoc({ ...draft as object, customer_id: 17, customer_trn: "100999456700003" } as never);
  const invoice = await billing.getDoc(await quotes.convertToInvoice(quote));
  expect(invoice.customer_trn).toBe("100999456700003");
  expect(invoice.einvoice?.buyer).toBeUndefined();
});
it("does not blend two VAT-group members that share a TRN", async () => {
  await localClient.from("crm_customers").insert({ id: 17, name: "Group member A", trn: "100777456700003",
    custom_fields: { einvoice_identity: JSON.stringify({ tin: "1007774567" }) } });
  const quote = await quotes.saveDoc({ ...draft as object, customer_id: 17, customer_name: "Group member B", customer_trn: "100777456700003" } as never);
  const invoice = await billing.getDoc(await quotes.convertToInvoice(quote));
  expect(invoice.customer_name).toBe("Group member B");
  expect(invoice.einvoice?.buyer).toBeUndefined();
});
it("rejects a workspace round-trip during quota validation before writing the converted invoice", async () => {
  const quote = await quotes.saveDoc(draft);
  const cap = vi.spyOn(license, "checkFreeInvoiceCap").mockImplementation(async () => {
    setCacheOrg("other", "owner"); setCacheOrg("test", "owner");
  });
  try { await expect(quotes.convertToInvoice(quote)).rejects.toThrow("workspace changed"); }
  finally { cap.mockRestore(); }
  expect((await localClient.from("invoice_docs").select()).data).toEqual([]);
  expect((await quotes.getDoc(quote)).status).toBe("draft");
});
it("rolls back a local conversion when the workspace changes during its line writes", async () => {
  const quote = await quotes.saveDoc(draft);
  const original = localClient.from;
  const from = vi.spyOn(localClient, "from").mockImplementation(table => {
    if (table === "invoice_doc_items") setCacheOrg("other", "owner");
    return original.call(localClient, table);
  });
  try { await expect(quotes.convertToInvoice(quote)).rejects.toThrow("workspace changed"); }
  finally { from.mockRestore(); setCacheOrg("test", "owner"); }
  expect((await localClient.from("invoice_docs").select()).data).toEqual([]);
  expect((await localClient.from("invoice_doc_items").select()).data).toEqual([]);
  expect((await quotes.getDoc(quote)).status).toBe("draft");
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
