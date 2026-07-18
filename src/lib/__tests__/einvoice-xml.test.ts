// @vitest-environment jsdom
import { test, expect } from "vitest";
import {
  computeTotals,
  validateEInvoice,
  buildInvoiceXml,
  type EInvoiceDoc,
} from "../einvoiceXml";

const sample = (): EInvoiceDoc => ({
  number: "INV-2026-001",
  issue_date: "2026-06-24",
  due_date: "2026-07-24",
  currency: "AED",
  invoice_type_code: "380",
  transaction_type: "00000001",
  payment_means_code: "30",
  tax_rate: 5,
  discount: 0,
  seller_name: "Acme FZE",
  seller_trn: "100123456700003",
  seller_legal_id: "CN-1234567",
  seller_legal_id_type: "TL",
  seller_address: "Office 1",
  seller_city: "Dubai",
  seller_country_subdivision: "DXB",
  customer_name: "Buyer LLC",
  customer_trn: "100777456700003",
  buyer_city: "Sharjah",
  buyer_country_subdivision: "SHJ",
  buyer_country_code: "AE",
  items: [
    { description: "Widget", qty: 2, unit_price: 100, tax_category: "S" }, // 200 net, 10 VAT
    { description: "Export item", qty: 1, unit_price: 50, tax_category: "Z" }, // 50 net, 0 VAT
  ],
});

test("computeTotals: VAT only on standard lines", () => {
  const t = computeTotals(sample());
  expect(t.lineExtension).toBe(250);
  expect(t.taxExclusive).toBe(250);
  expect(t.taxTotal).toBe(10);
  expect(t.taxInclusive).toBe(260);
  const s = t.rows.find((r) => r.category === "S")!;
  const z = t.rows.find((r) => r.category === "Z")!;
  expect(s.tax).toBe(10);
  expect(z.tax).toBe(0);
});

test("validate: clean doc has no errors; missing seller name errors", () => {
  expect(validateEInvoice(sample()).errors).toHaveLength(0);
  expect(validateEInvoice({ ...sample(), seller_name: "" }).errors).toContain(
    "Seller name"
  );
});

test("validate: corrective note needs original ref; foreign currency needs AED rate", () => {
  const cn = { ...sample(), invoice_type_code: "381" };
  expect(validateEInvoice(cn).errors).toContain(
    "Original invoice number (credit/debit note)"
  );
  expect(
    validateEInvoice({ ...cn, original_invoice_number: "INV-1" }).errors
  ).not.toContain("Original invoice number (credit/debit note)");

  const fx = { ...sample(), currency: "USD" };
  expect(validateEInvoice(fx).errors).toContain(
    "AED exchange rate (foreign-currency invoice)"
  );
  expect(
    validateEInvoice({ ...fx, aed_exchange_rate: 3.67 }).errors
  ).not.toContain("AED exchange rate (foreign-currency invoice)");
});

test("validate: missing seller TRN/emirate now block (mandatory)", () => {
  expect(validateEInvoice({ ...sample(), seller_trn: "" }).errors).toContain(
    "Seller TRN / TIN (Company settings)"
  );
  expect(
    validateEInvoice({ ...sample(), seller_country_subdivision: "" }).errors
  ).toContain("Seller emirate (Company settings)");
});

test("buildInvoiceXml: exemption reason on non-standard line, no AE endpoint for foreign buyer", () => {
  const xml = buildInvoiceXml(sample()); // has a Z line
  expect(xml).toContain("<cbc:TaxExemptionReason>Zero-rated supply</cbc:TaxExemptionReason>");
  // Foreign buyer → no UAE-scheme endpoint stamped.
  const foreign = buildInvoiceXml({
    ...sample(),
    buyer_country_code: "IN",
    customer_trn: "AAACX1234C",
  });
  const customerBlock = foreign.split("AccountingCustomerParty")[1];
  expect(customerBlock).not.toContain('schemeID="0235"');
});

test("buildInvoiceXml: credit note carries BillingReference; foreign currency adds AED tax total", () => {
  const cn = buildInvoiceXml({
    ...sample(),
    invoice_type_code: "381",
    original_invoice_number: "INV-2026-001",
    original_invoice_date: "2026-06-01",
  });
  expect(cn).toContain("<cac:BillingReference>");
  expect(cn).toContain("<cbc:ID>INV-2026-001</cbc:ID>");

  const fx = buildInvoiceXml({ ...sample(), currency: "USD", aed_exchange_rate: 3.6725 });
  expect(fx).toContain("<cbc:TaxCurrencyCode>AED</cbc:TaxCurrencyCode>");
  // VAT 10 USD × 3.6725 = 36.73 AED.
  expect(fx).toContain('<cbc:TaxAmount currencyID="AED">36.73</cbc:TaxAmount>');
});

test("buildInvoiceXml: price carries BaseQuantity; foreign-currency lines state AED amounts (MoF fields 45/48/49)", () => {
  // BaseQuantity is mandatory (field 45) and defaults to 1 with the line's UoM.
  const xml = buildInvoiceXml(sample());
  expect(xml).toContain('<cbc:BaseQuantity unitCode="C62">1</cbc:BaseQuantity>');

  // USD doc at 3.67: line 1 (net 200 + VAT 10 = 210) → 770.70 AED; line VAT 10 → 36.70 AED.
  const fx = buildInvoiceXml({ ...sample(), currency: "USD", aed_exchange_rate: 3.67 });
  expect(fx).toContain('<cbc:Amount currencyID="AED">770.70</cbc:Amount>');
  expect(fx).toContain('<cbc:TaxAmount currencyID="AED">36.70</cbc:TaxAmount>');
  // LineExtensionAmount stays in the document currency.
  expect(fx).toContain('<cbc:LineExtensionAmount currencyID="USD">200.00</cbc:LineExtensionAmount>');
});

test("buildInvoiceXml: legacy AE-xx emirate is normalized to 3-letter on export", () => {
  const xml = buildInvoiceXml({
    ...sample(),
    seller_country_subdivision: "AE-DU",
    buyer_country_subdivision: "AE-SH",
  });
  expect(xml).toContain("<cbc:CountrySubentity>DXB</cbc:CountrySubentity>");
  expect(xml).toContain("<cbc:CountrySubentity>SHJ</cbc:CountrySubentity>");
  expect(xml).not.toContain("AE-DU");
  expect(xml).not.toContain("AE-SH");
});

test("buildInvoiceXml: PINT-AE mandatory fields (2025-Q2 conformance)", () => {
  const xml = buildInvoiceXml({ ...sample(), transaction_type: "00000001" });
  // UUID (BTAE-07) — fatal mandatory.
  expect(xml).toMatch(/<cbc:UUID>[0-9a-f-]{36}<\/cbc:UUID>/);
  // Transaction type lives in ProfileExecutionID, not a Note.
  expect(xml).toContain("<cbc:ProfileExecutionID>00000001</cbc:ProfileExecutionID>");
  expect(xml).not.toContain("TRANSACTION-TYPE:");
  // Legal ID uses schemeAgencyID + schemeAgencyName, not schemeID.
  expect(xml).toContain('schemeAgencyID="TL"');
  expect(xml).toContain('schemeAgencyName="Trade License issuing Authority"');
  expect(xml).not.toMatch(/CompanyID schemeID=/);
  // 3-letter emirate code, not ISO 3166-2.
  expect(xml).toContain("<cbc:CountrySubentity>DXB</cbc:CountrySubentity>");
  // TaxIncludedIndicator + per-line ItemPriceExtension (BTAE-10/08).
  expect(xml).toContain("<cbc:TaxIncludedIndicator>false</cbc:TaxIncludedIndicator>");
  expect(xml).toContain("<cac:ItemPriceExtension>");
  // Standard line: net 200 + VAT 10 = 210 line amount, 10 line VAT.
  expect(xml).toContain('<cbc:Amount currencyID="AED">210.00</cbc:Amount>');
});

test("buildInvoiceXml: well-formed UBL with key fields", () => {
  const xml = buildInvoiceXml(sample());
  // Well-formed: jsdom injects <parsererror> on malformed XML.
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  expect(doc.querySelector("parsererror")).toBeNull();
  // Key fields present (namespaced tags → assert on the string).
  expect(xml).toContain("<cbc:ID>INV-2026-001</cbc:ID>");
  expect(xml).toContain("<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>");
  expect(xml).toContain("pint"); // PINT-AE CustomizationID
  expect(xml.split("<cac:InvoiceLine>").length - 1).toBe(2);
  expect(xml).toContain('<cbc:PayableAmount currencyID="AED">260.00</cbc:PayableAmount>');
  // Seller endpoint = TIN (first 10 of TRN) under scheme 0235.
  expect(xml).toContain('<cbc:EndpointID schemeID="0235">1001234567</cbc:EndpointID>');
});
