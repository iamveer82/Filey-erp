// @vitest-environment jsdom
import { test, expect } from "vitest";
import {
  computeTotals,
  eInvoiceIssues,
  validateEInvoice,
  buildInvoiceXml,
  type EInvoiceDoc,
} from "../einvoiceXml";
import { buyerEndpoint, isCreditNote, partyTin, tinFromCorporateTrn } from "../einvoice";

test("legacy non-string identity values do not crash previews or become invented identifiers", () => {
  for (const malformed of [123, {}, [], false]) {
    expect(tinFromCorporateTrn(malformed as never)).toBe("");
    expect(partyTin({ tin: malformed, corporate_trn: malformed } as never)).toBe("");
    expect(buyerEndpoint({ buyer: { endpoint_id: malformed, endpoint_scheme: malformed, tin: malformed } } as never))
      .toEqual({ id: "", scheme: "0235" });
  }
  expect(partyTin({ tin: 123 as never, corporate_trn: "100123456700003" })).toBe("1001234567");
});

const sample = (): EInvoiceDoc => ({
  einvoice: { uuid: "e054df09-2f88-41ee-a45e-559f1d5f5408",
    seller: { corporate_trn: "100123456700003", legal_authority: "Dubai Economy" },
    payment_account_id: "AE070331234567890123456",
    buyer: { tin: "1007774567" }, credit_reason: "DL8.61.1.D" },
  customer_address: "Office 2",
  number: "INV-2026-001",
  issue_date: "2026-06-24",
  date_of_supply: "2026-06-23",
  notes: "Synthetic validation document",
  terms: "Pay within thirty days",
  due_date: "2026-07-24",
  currency: "AED",
  invoice_type_code: "380",
  transaction_type: "00000000",
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

const extendedSamples = (): Record<string, EInvoiceDoc> => {
  const doc = sample();
  const commercial: EInvoiceDoc = { ...doc, invoice_type_code: "480", seller_trn: "", customer_trn: "", tax_rate: 0,
    einvoice: { ...doc.einvoice, buyer: { tin: "1007774567", legal_id: "BUYER-LICENCE", legal_id_type: "TL", legal_authority: "Sharjah Economic Development" } },
    items: [{ description: "Out-of-scope service", qty: 1, unit_price: 100, tax_category: "O" }] };
  return {
    exempt: { ...doc, discount: 7, items: [doc.items[0], { description: "Residential lease", qty: 1, unit_price: 50, tax_category: "E", custom: { einvoice_exemption_code: "DL8.46.2" } }] },
    outOfScope: { ...doc, discount: 7, items: [doc.items[0], { description: "Out-of-scope supply", qty: 1, unit_price: 50, tax_category: "O" }] },
    reverse: { ...doc, items: [{ description: "Electronic device", qty: 1, unit_price: 100, tax_category: "AE",
      custom: { einvoice_nature: "DL8.48.8.2", einvoice_gtin: "4006381333931" } }] },
    export: { ...doc, transaction_type: "00000001", buyer_country_code: "IN", buyer_country_subdivision: "Maharashtra", buyer_city: "Mumbai", customer_trn: "",
      einvoice: { ...doc.einvoice, buyer: {}, buyer_delivery_mode: "export-unregistered",
        delivery: { address: "Demo export destination", city: "Mumbai", region: "Maharashtra", country_code: "IN" } },
      items: [{ description: "Export goods", qty: 1, unit_price: 100, tax_category: "Z" }] },
    freezone: { ...doc, transaction_type: "10000000", einvoice: { ...doc.einvoice, beneficiary_id: "1001234567" } },
    contacts: { ...doc, seller_phone: "+971 50 123 4567", seller_email: "accounts@example.test", customer_email: "buyer@example.test",
      einvoice: { ...doc.einvoice, buyer: { ...doc.einvoice?.buyer, phone: "+971 50 765 4321" } } },
    unicode: { ...doc, seller_name: "شركة دبي · 🛢️", customer_name: "客户 · شركة", notes: 'تجارة & "Oil" <supply>' },
    classified: { ...doc, items: [{ ...doc.items[0], custom: { einvoice_item_type: "B", einvoice_gtin: "4006381333931",
      einvoice_hs_code: "271019", einvoice_service_code: "9987" } }] },
    commercial,
    commercialCredit: { ...commercial, invoice_type_code: "81", original_invoice_number: "COMMERCIAL-OLD", original_invoice_date: "2026-06-01" },
    creditOptionalFields: { ...doc, invoice_type_code: "381", original_invoice_number: "INV-OLD", payment_means_code: undefined, original_invoice_date: undefined, due_date: undefined },
    commercialNoTaxRate: { ...commercial, tax_rate: undefined },
    buyerWithoutVat: { ...doc, customer_trn: "" },
    foreignCommercial: { ...commercial, buyer_country_code: "IN", einvoice: { ...commercial.einvoice,
      buyer: { endpoint_scheme: "0088", endpoint_id: "4006381333931", legal_id: "FOREIGN-LICENCE" } } },
    tinyQuantity: { ...doc, items: [{ description: "Small quantity", qty: 1e-7, unit_price: 100000000 }] },
    blankOptional: { ...doc, notes: "\t", terms: " ", po_number: " ", customer_trn: "  ",
      einvoice: { ...doc.einvoice, payment_account_name: " ", buyer: { tin: "1007774567", identifier: "\n" } },
      items: [{ ...doc.items[0], custom: { einvoice_hs_code: " ", einvoice_service_code: "\r", einvoice_gtin: " " } }] },
    exemptReasons: { ...doc, discount: 13.37, items: [doc.items[0],
      { description: "Residential lease", qty: 1, unit_price: 50, tax_category: "E", custom: { einvoice_exemption_code: "DL8.46.2" } },
      { description: "Bare land", qty: 1, unit_price: 30, tax_category: "E", custom: { einvoice_exemption_code: "DL8.46.3" } },
    ] },
  };
};

test("conditional UAE scenarios validate and preserve the supplied identities in XML", () => {
  const cases = extendedSamples();
  for (const doc of Object.values(cases)) expect(validateEInvoice(doc).errors).toEqual([]);
  expect(buildInvoiceXml(cases.export)).toContain('<cbc:EndpointID schemeID="0235">9900000099</cbc:EndpointID>');
  expect(buildInvoiceXml(cases.export)).toContain("<cbc:StreetName>Demo export destination</cbc:StreetName>");
  expect(buildInvoiceXml(cases.freezone)).toContain("<cac:BuyerCustomerParty>");
  const commercial = buildInvoiceXml(cases.commercial);
  expect(commercial).toContain("<cbc:InvoiceTypeCode>480</cbc:InvoiceTypeCode>");
  expect(commercial).toContain("<cbc:ID>TIN</cbc:ID>");
  expect(commercial).not.toContain("<cbc:CompanyID></cbc:CompanyID>");
  expect(buildInvoiceXml(cases.commercialCredit)).toContain("<cbc:CreditNoteTypeCode>81</cbc:CreditNoteTypeCode>");
  expect(isCreditNote("81")).toBe(true);
});

test("required due date, export address and free-zone beneficiary cannot be omitted", () => {
  expect(validateEInvoice({ ...sample(), due_date: "" }).errors.join()).toContain("Payment due date");
  expect(validateEInvoice({ ...sample(), due_date: "", advance_applied: 260 }).errors).toEqual([]);
  expect(validateEInvoice({ ...sample(), transaction_type: "10000000" }).errors.join()).toContain("Beneficiary");
  expect(validateEInvoice({ ...sample(), transaction_type: "00000001" }).errors.join()).toContain("Export delivery");
  expect(buyerEndpoint({ buyer_delivery_mode: "outside-uae-scope" })).toEqual({ id: "9900000098", scheme: "0235" });
  expect(validateEInvoice({ ...sample(), einvoice: { ...sample().einvoice, buyer_delivery_mode: "export-unregistered" } }).errors.join()).toContain("Select Exports");
});

test("exempt and out-of-scope categories omit rates; exemptions require a selected code", () => {
  const cases = extendedSamples();
  const exempt = new DOMParser().parseFromString(buildInvoiceXml(cases.exempt), "application/xml");
  for (const category of Array.from(exempt.getElementsByTagName("cac:TaxCategory"))) {
    if (category.getElementsByTagName("cbc:ID")[0]?.textContent === "E") {
      if (category.parentElement?.tagName === "cac:TaxSubtotal") expect(category.getElementsByTagName("cbc:Percent")).toHaveLength(0);
      else expect(category.getElementsByTagName("cbc:Percent")[0]?.textContent).toBe("0");
    }
  }
  const lines = Array.from(exempt.getElementsByTagName("cac:InvoiceLine"));
  expect(lines[1].getElementsByTagName("cbc:TaxExemptionReasonCode")[0]?.textContent).toBe("DL8.46.2");
  expect(lines[1].getElementsByTagName("cbc:Percent")).toHaveLength(0);
  expect(lines[1].getElementsByTagName("cac:TaxTotal")).toHaveLength(0);
  expect(buildInvoiceXml(cases.exempt)).toContain("<cbc:AllowanceChargeReasonCode>100</cbc:AllowanceChargeReasonCode>");
  expect(validateEInvoice({ ...cases.exempt, items: [{ ...cases.exempt.items[1], custom: {} }] }).errors.join()).toContain("VAT exemption reason");
  const out = new DOMParser().parseFromString(buildInvoiceXml(cases.outOfScope), "application/xml");
  for (const category of Array.from(out.getElementsByTagName("cac:TaxCategory"))) {
    if (category.getElementsByTagName("cbc:ID")[0]?.textContent === "O") expect(category.getElementsByTagName("cbc:Percent")).toHaveLength(0);
  }
});

test("reverse-charge classification and standard identifier come from saved item custom metadata", () => {
  const doc = extendedSamples().reverse;
  const xml = buildInvoiceXml(doc);
  expect(xml).toContain("<cbc:NatureCode>DL8.48.8.2</cbc:NatureCode>");
  expect(xml).toContain('<cbc:ID schemeID="0160">4006381333931</cbc:ID>');
  expect(xml).toContain('<cbc:TaxAmount currencyID="AED">0.00</cbc:TaxAmount>');
  expect(validateEInvoice({ ...doc, items: [{ ...doc.items[0], custom: {} }], customer_trn: "" }).errors.join()).toMatch(/reverse-charge.*GTIN.*Buyer VAT TRN/);
});

test("commercial categories, unsupported legacy types, VAT format and exchange-rate precision are checked", () => {
  const doc = sample();
  expect(validateEInvoice({ ...doc, invoice_type_code: "480" }).errors.join()).toContain("commercial invoices");
  expect(validateEInvoice({ ...doc, items: [{ description: "Lease", qty: 1, unit_price: 10, tax_category: "E", custom: { einvoice_exemption_code: "DL8.46.2" } }] }).errors.join()).toContain("Use a commercial invoice");
  for (const type of ["383", "386"]) {
    expect(validateEInvoice({ ...doc, invoice_type_code: type }).errors.join()).toContain("Choose a UAE");
    expect(() => buildInvoiceXml({ ...doc, invoice_type_code: type })).toThrow("not supported");
  }
  expect(validateEInvoice({ ...doc, seller_trn: "999123456700999" }).errors.join()).toContain("start with 1 and end with 03");
  expect(validateEInvoice({ ...doc, currency: "USD", aed_exchange_rate: 3.672512345 }).errors.join()).toContain("six decimal places");
  expect(validateEInvoice({ ...doc, invoice_type_code: "381", einvoice: { ...doc.einvoice, credit_reason: "VD" } }).errors).toEqual([]);
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
    "Seller VAT TRN"
  );
  expect(
    validateEInvoice({ ...sample(), seller_country_subdivision: "" }).errors
  ).toContain("Seller emirate / region");
});

test("buildInvoiceXml: exemption reason on non-standard line, no AE endpoint for foreign buyer", () => {
  const xml = buildInvoiceXml(sample()); // has a Z line
  expect(xml).toContain("<cbc:TaxExemptionReason>Zero-rated supply</cbc:TaxExemptionReason>");
  // Foreign buyer → no UAE-scheme endpoint stamped.
  const foreign = buildInvoiceXml({
    ...sample(),
    buyer_country_code: "IN",
    customer_trn: "AAACX1234C",
    einvoice: { ...sample().einvoice, buyer: { endpoint_scheme: "0088", endpoint_id: "4006381333931" } },
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

test("buildInvoiceXml: PINT-AE mandatory fields (1.0.4 structure)", () => {
  const xml = buildInvoiceXml({ ...sample(), transaction_type: "00000001", einvoice: { ...sample().einvoice,
    delivery: { address: "Destination office", city: "Mumbai", region: "Maharashtra", country_code: "IN" } } });
  // UUID (BTAE-07) — fatal mandatory.
  expect(xml).toMatch(/<cbc:UUID>[0-9a-f-]{36}<\/cbc:UUID>/);
  // Transaction type lives in ProfileExecutionID, not a Note.
  expect(xml).toContain("<cbc:ProfileExecutionID>00000001</cbc:ProfileExecutionID>");
  expect(xml).not.toContain("TRANSACTION-TYPE:");
  // Legal ID uses schemeAgencyID + schemeAgencyName, not schemeID.
  expect(xml).toContain('schemeAgencyID="TL"');
  expect(xml).toContain('schemeAgencyName="Dubai Economy"');
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

// Generate only synthetic samples for the separate official Schematron check.
if (process.env.FILEY_PINT_OUTPUT) {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  mkdirSync(process.env.FILEY_PINT_OUTPUT, { recursive: true });
  for (const [name, doc] of Object.entries({
    invoice: sample(),
    discounted: { ...sample(), discount: 13.37, advance_applied: 10, round_off: true },
    foreign: { ...sample(), currency: "USD", aed_exchange_rate: 3.6725 },
    credit: { ...sample(), invoice_type_code: "381", original_invoice_number: "INV-ORIGINAL", original_invoice_date: "2026-06-01" },
    foreignCredit: { ...sample(), invoice_type_code: "381", original_invoice_number: "INV-USD", original_invoice_date: "2026-06-01", currency: "USD", aed_exchange_rate: 3.6725, discount: 13.37 },
    volumeCredit: { ...sample(), invoice_type_code: "381", original_invoice_number: "INV-OLD", einvoice: { ...sample().einvoice, credit_reason: "VD" } },
    ...extendedSamples(),
  })) writeFileSync(join(process.env.FILEY_PINT_OUTPUT, `${name}.xml`), buildInvoiceXml(doc));
}

test("stable identity, canonical credit-note root and explicit TIN", () => {
  const doc = sample();
  expect(buildInvoiceXml(doc)).toBe(buildInvoiceXml(doc));
  const xml = buildInvoiceXml({ ...doc, invoice_type_code: "381", original_invoice_number: "INV-OLD" });
  expect(xml).toContain("<CreditNote xmlns=");
  expect(xml).toContain("<cbc:CreditedQuantity");
  expect(xml).not.toContain("<cac:InvoiceLine>");
  expect(xml).not.toContain("<cbc:TaxPointDate>");
  expect(buildInvoiceXml({ ...doc, date_of_supply: doc.issue_date })).not.toContain("<cbc:TaxPointDate>");
  expect(() => buildInvoiceXml({ ...doc, einvoice: { uuid: doc.einvoice!.uuid } })).toThrow("electronic invoicing address / TIN");
  expect(() => buildInvoiceXml({ ...doc, einvoice: undefined })).toThrow("Save this invoice");
});

test("readiness distinguishes an unsaved UUID from an invalid saved identity without replacing it", () => {
  const doc = sample();
  const unsaved = { ...doc, einvoice: { ...doc.einvoice, uuid: undefined } };
  expect(eInvoiceIssues(unsaved)).toEqual([]); // Save & export assigns the UUID first.
  expect(() => buildInvoiceXml(unsaved)).toThrow("Save this invoice");
  for (const uuid of ["not-a-uuid", "1001234567", "100123456700003"]) {
    const invalid = { ...doc, einvoice: { ...doc.einvoice, uuid } };
    expect(eInvoiceIssues(invalid)).toContainEqual(expect.objectContaining({ field: "einvoice.uuid" }));
    expect(() => buildInvoiceXml(invalid)).toThrow("UUID");
    expect(invalid.einvoice.uuid).toBe(uuid);
  }
});

test("malformed saved metadata produces field-specific checks instead of crashing or inventing IDs", () => {
  const doc = sample();
  for (const value of [123, {}, [], false]) {
    const invalid = { ...doc, einvoice: { ...doc.einvoice, seller: { ...doc.einvoice?.seller, endpoint_id: value } } } as unknown as EInvoiceDoc;
    expect(eInvoiceIssues(invalid)).toContainEqual(expect.objectContaining({ field: "einvoice.seller.endpoint_id" }));
    expect(() => buildInvoiceXml(invalid)).toThrow("electronic invoice checks");
    const line = { ...doc, items: [{ ...doc.items[0], custom: { einvoice_gtin: value } }] } as unknown as EInvoiceDoc;
    expect(eInvoiceIssues(line)).toContainEqual(expect.objectContaining({ field: "items.0.custom.einvoice_gtin" }));
  }
  expect(eInvoiceIssues({ ...doc, einvoice: [] } as unknown as EInvoiceDoc))
    .toContainEqual(expect.objectContaining({ field: "einvoice" }));
  expect(eInvoiceIssues({ ...doc, seller_trn: 123 } as unknown as EInvoiceDoc))
    .toContainEqual(expect.objectContaining({ field: "seller_trn" }));
  expect(eInvoiceIssues({ ...doc, issue_date: 123 } as unknown as EInvoiceDoc))
    .toContainEqual(expect.objectContaining({ field: "issue_date" }));
  expect(eInvoiceIssues({ ...doc, items: null } as unknown as EInvoiceDoc))
    .toContainEqual(expect.objectContaining({ field: "items" }));
  expect(eInvoiceIssues({ ...doc, items: [null] } as unknown as EInvoiceDoc))
    .toContainEqual(expect.objectContaining({ field: "items.0" }));
});

test("discounts reconcile in cents across categories and preserve payable adjustments", () => {
  const doc = { ...sample(), discount: 13.37, advance_applied: 10, round_off: true };
  const total = computeTotals(doc);
  expect(total.rows.reduce((sum, row) => Math.round(sum * 100 + row.taxable * 100) / 100, 0)).toBe(total.taxExclusive);
  expect(total.payable).toBe(Math.round(total.taxInclusive) - 10);
  const xml = buildInvoiceXml(doc);
  expect(xml).toContain('<cbc:PrepaidAmount currencyID="AED">10.00</cbc:PrepaidAmount>');
  expect(xml).toContain('<cbc:PayableRoundingAmount');
  expect(xml).toContain('<cbc:AllowanceChargeReason>Discount</cbc:AllowanceChargeReason>');
});

test("invalid values and unknown units cannot pass readiness checks", () => {
  const doc = sample();
  doc.items[0] = { description: "Bad", qty: NaN, unit_price: -1, unit: "made-up" };
  doc.issue_date = "2026-02-30";
  const result = validateEInvoice(doc).errors.join(" ");
  expect(result).toContain("quantity");
  expect(result).toContain("unit code");
  expect(result).toContain("Valid invoice date");
  expect(validateEInvoice({ ...sample(), tax_rate: 10 }).errors.join()).toContain("5% VAT");
  expect(validateEInvoice({ ...sample(), transaction_type: "00100000" }).errors.join()).toContain("does not support");
  expect(() => buildInvoiceXml(doc)).toThrow("unit code");
});

test("issues point to the precise invoice, party and line controls", () => {
  const doc = sample();
  const issues = eInvoiceIssues({ ...doc, seller_address: "", seller_city: "", seller_trn: "",
    buyer_city: "", einvoice: { ...doc.einvoice, buyer: { tin: "123" } },
    items: [{ description: "", qty: 0, unit_price: -1, unit: "invalid", tax_category: "E", custom: {} }] });
  expect(issues.map(issue => issue.field)).toEqual(expect.arrayContaining([
    "seller_address", "seller_city", "seller_trn", "buyer_city", "einvoice.buyer.tin",
    "items.0.description", "items.0.qty", "items.0.unit_price", "items.0.unit", "items.0.custom.einvoice_exemption_code",
  ]));
  expect(issues.some(issue => /^(?:einvoice\.(?:seller|buyer)|items\.\d+)$/.test(issue.field))).toBe(false);
});

test.each(["381", "81"])("credit note %s allows omitted payment and preceding date, but validates supplied values", invoice_type_code => {
  const doc = invoice_type_code === "81" ? extendedSamples().commercialCredit : { ...sample(), invoice_type_code, original_invoice_number: "INV-OLD" };
  const credit = { ...doc, original_invoice_date: undefined, payment_means_code: undefined, due_date: undefined };
  expect(validateEInvoice(credit).errors).toEqual([]);
  expect(buildInvoiceXml(credit)).not.toContain("<cac:PaymentMeans>");
  expect(eInvoiceIssues({ ...credit, payment_means_code: "invalid" }).map(issue => issue.field)).toContain("payment_means_code");
  expect(eInvoiceIssues({ ...credit, payment_means_code: "30", einvoice: { ...credit.einvoice, payment_account_id: "" } }).map(issue => issue.field)).toContain("einvoice.payment_account_id");
  expect(eInvoiceIssues({ ...credit, original_invoice_date: "2026-02-30" }).map(issue => issue.field)).toContain("original_invoice_date");
});

test("conditional tax and buyer legal requirements do not block valid documents", () => {
  expect(validateEInvoice({ ...extendedSamples().commercial, tax_rate: undefined }).errors).toEqual([]);
  expect(validateEInvoice({ ...sample(), tax_rate: undefined, items: [{ description: "Own rate", qty: 1, unit_price: 100, tax: 5 }] }).errors).toEqual([]);
  const inherited = { ...sample(), items: [{ description: "Legacy zero inherits document rate", qty: 1, unit_price: 100, tax: 0 }] };
  expect(validateEInvoice(inherited).errors).toEqual([]);
  expect(computeTotals(inherited).taxTotal).toBe(5);
  expect(buildInvoiceXml(inherited)).toContain("<cbc:Percent>5</cbc:Percent>");
  expect(validateEInvoice({ ...sample(), customer_trn: "" }).errors).toEqual([]);
  const foreign = { ...extendedSamples().commercial, buyer_country_code: "IN",
    einvoice: { ...sample().einvoice, buyer: { endpoint_scheme: "0088", endpoint_id: "4006381333931", legal_id: "FOREIGN-LICENCE" } } };
  expect(validateEInvoice(foreign).errors).toEqual([]);
});

test("UAE identity, special routing and supplied GS1 identifiers are checked", () => {
  const doc = sample();
  const fields = (over: Partial<EInvoiceDoc>) => eInvoiceIssues({ ...doc, ...over }).map(issue => issue.field);
  expect(fields({ einvoice: { ...doc.einvoice, seller: { endpoint_id: "9001234567", endpoint_scheme: "0235" } } })).toContain("einvoice.seller.endpoint_id");
  expect(fields({ einvoice: { ...doc.einvoice, seller: { ...doc.einvoice!.seller, endpoint_scheme: "0088", endpoint_id: "4006381333931" } } })).toContain("einvoice.seller.endpoint_scheme");
  expect(fields({ einvoice: { ...doc.einvoice, buyer: { endpoint_id: "9900000099", endpoint_scheme: "0235", identifier: "FOREIGN-BUYER" } } })).toContain("einvoice.buyer_delivery_mode");
  expect(fields({ buyer_country_code: "IN", einvoice: { ...doc.einvoice, buyer: { endpoint_scheme: "0088", endpoint_id: "4006381333932" } } })).toContain("einvoice.buyer.endpoint_id");
  expect(fields({ buyer_country_code: "DK", einvoice: { ...doc.einvoice, buyer: { endpoint_scheme: "0184", endpoint_id: "12345678" } } })).toContain("einvoice.buyer.endpoint_id");
  expect(fields({ items: [{ ...doc.items[0], custom: { einvoice_gtin: "4006381333932" } }] })).toContain("items.0.custom.einvoice_gtin");
  expect(fields({ einvoice: { ...doc.einvoice, seller: { corporate_trn: "100123456700003", tin: "1009994567", endpoint_id: "1008884567", legal_authority: "Dubai Economy" } } })).toEqual(expect.arrayContaining(["einvoice.seller.tin", "einvoice.seller.endpoint_id"]));
});

test("XML export enforces the shared checks and refuses numeric overflow or lost line precision", () => {
  expect(() => buildInvoiceXml({ ...sample(), seller_city: "" })).toThrow("Seller city");
  const large = { ...sample(), items: [{ description: "Too large", qty: 1e307, unit_price: 1e307 }] };
  expect(eInvoiceIssues(large).map(issue => issue.field)).toContain("items.0.unit_price");
  expect(() => buildInvoiceXml(large)).toThrow("calculate accurately");
  const precision = { ...sample(), items: [{ description: "Manual", qty: 1e8, unit_price: 0, calcMode: "manual" as const, amount: 0.01 }] };
  expect(eInvoiceIssues(precision).map(issue => issue.field)).toContain("items.0.amount");
  const formula = { ...sample(), unit_price_formula: { a: "litres" }, items: [{ description: "Formula", qty: 1, unit_price: 100, custom: { litres: "invalid" } }] };
  expect(eInvoiceIssues(formula).map(issue => issue.field)).toContain("items.0.custom.litres");
  expect(eInvoiceIssues({ ...formula, items: [{ ...formula.items[0], custom: { litres: "0x10" } }] }).map(issue => issue.field)).toContain("items.0.custom.litres");
  expect(eInvoiceIssues({ ...sample(), currency: "USD", aed_exchange_rate: 1e15 }).map(issue => issue.field)).toContain("aed_exchange_rate");
  const tiny = { ...sample(), items: [{ description: "Small quantity", qty: 1e-7, unit_price: 100000000 }] };
  expect(buildInvoiceXml(tiny)).toContain('<cbc:InvoicedQuantity unitCode="C62">0.0000001</cbc:InvoicedQuantity>');
  expect(eInvoiceIssues({ ...sample(), issue_date: "0000-01-01" }).map(issue => issue.field)).toContain("issue_date");
});

test("optional XML whitespace is omitted, while forbidden characters and required blank values block export", () => {
  const xml = new DOMParser().parseFromString(buildInvoiceXml(extendedSamples().blankOptional), "application/xml");
  expect(Array.from(xml.getElementsByTagName("*")).filter(element => !element.children.length && !element.textContent?.trim())).toEqual([]);
  expect(xml.getElementsByTagName("cbc:Note")).toHaveLength(0);
  expect(xml.getElementsByTagName("cac:PartyIdentification")).toHaveLength(0);
  expect(eInvoiceIssues({ ...sample(), seller_name: "\u0000", items: [{ ...sample().items[0], description: "\u0001" }] }).map(issue => issue.field)).toEqual(expect.arrayContaining(["seller_name", "items.0.description"]));
  const commercial = buildInvoiceXml({ ...extendedSamples().commercial, seller_trn: " " });
  expect(commercial).toContain("<cbc:ID>TIN</cbc:ID>");
  expect(commercial).not.toContain("<cbc:CompanyID></cbc:CompanyID>");
});

test("optional supplied nature codes must match the official list even on standard-rated lines", () => {
  const source = sample();
  source.items[0].custom = { einvoice_nature: "not-a-code" };
  expect(eInvoiceIssues(source)).toContainEqual(expect.objectContaining({ field: "items.0.custom.einvoice_nature" }));
  expect(() => buildInvoiceXml(source)).toThrow("electronic invoice checks");
});

test("saved seller and buyer contacts reach XML without making optional contacts mandatory", () => {
  const source = extendedSamples().contacts;
  const xml = new DOMParser().parseFromString(buildInvoiceXml(source), "application/xml");
  const seller = xml.getElementsByTagName("cac:AccountingSupplierParty")[0];
  const buyer = xml.getElementsByTagName("cac:AccountingCustomerParty")[0];
  expect(seller.getElementsByTagName("cbc:Telephone")[0]?.textContent).toBe(source.seller_phone);
  expect(seller.getElementsByTagName("cbc:ElectronicMail")[0]?.textContent).toBe(source.seller_email);
  expect(buyer.getElementsByTagName("cbc:Telephone")[0]?.textContent).toBe(source.einvoice?.buyer?.phone);
  expect(buyer.getElementsByTagName("cbc:ElectronicMail")[0]?.textContent).toBe(source.customer_email);
  expect(buildInvoiceXml(sample())).not.toContain("<cac:Contact>");
  expect(eInvoiceIssues({ ...source, seller_email: "a\u0000@example.test" })).toContainEqual(expect.objectContaining({ field: "seller_email" }));
});

test("combined goods and services identifiers follow UBL sequence order", () => {
  const source = extendedSamples().classified;
  expect(eInvoiceIssues(source)).toEqual([]);
  const xml = new DOMParser().parseFromString(buildInvoiceXml(source), "application/xml");
  const names = Array.from(xml.getElementsByTagName("cac:Item")[0].children).map(element => element.tagName);
  expect(names.indexOf("cac:StandardItemIdentification")).toBeLessThan(names.indexOf("cac:AdditionalItemIdentification"));
});

test("exempt document allowances preserve each exemption reason and reconcile in cents", () => {
  const doc = { ...sample(), discount: 13.37, items: [sample().items[0],
    { description: "Residential", qty: 1, unit_price: 50, tax_category: "E", custom: { einvoice_exemption_code: "DL8.46.2" } },
    { description: "Land", qty: 1, unit_price: 30, tax_category: "E", custom: { einvoice_exemption_code: "DL8.46.3" } },
  ] };
  const xml = new DOMParser().parseFromString(buildInvoiceXml(doc), "application/xml");
  const allowances = Array.from(xml.documentElement.children).filter(element => element.tagName === "cac:AllowanceCharge" && element.getElementsByTagName("cbc:ID")[0]?.textContent === "E");
  expect(allowances).toHaveLength(2);
  expect(allowances.map(element => element.getElementsByTagName("cbc:TaxExemptionReasonCode")[0]?.textContent)).toEqual(["DL8.46.2", "DL8.46.3"]);
  const amount = allowances.reduce((sum, element) => sum + Number(element.getElementsByTagName("cbc:Amount")[0]?.textContent), 0);
  expect(Math.round(amount * 100) / 100).toBe(computeTotals(doc).rows.find(row => row.category === "E")!.discount);
});
