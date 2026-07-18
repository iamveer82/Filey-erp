// UAE Electronic Invoice — Peppol PINT-AE (UBL 2.1) serializer + validator.
//
// Turns a captured invoice into the structured XML the FTA mandate requires.
// Built to UBL 2.1 / Peppol BIS Billing conventions; the AE-specific bits
// (CustomizationID, EndpointID scheme 0235, transaction-type placement) are
// marked — confirm them against the published PINT-AE Data Dictionary before
// relying on this for live submission. Capture + structure are correct; this is
// not a certified Schematron validation.

import { docLineAmount } from "./docItems";
import { r2 } from "./money";
import {
  PINT_AE_SPEC_IDENTIFIER,
  PINT_AE_PROCESS_ID,
  UAE_EAS_SCHEME,
  UAE_COUNTRY_CODE,
  DEFAULT_TAX_SCHEME,
  DEFAULT_INVOICE_TYPE_CODE,
  DEFAULT_TAX_CATEGORY,
  DEFAULT_TRANSACTION_TYPE,
  TAX_EXEMPTION_REASONS,
  CORRECTIVE_TYPE_CODES,
  tinFromTrn,
  normalizeEmirate,
} from "./einvoice";

export interface EInvoiceItem {
  description: string;
  qty: number;
  unit_price: number;
  unit?: string | null;
  tax_category?: string | null;
  calcMode?: "auto" | "manual" | "formula";
  amount?: number;
  itemFormula?: { a: string; b?: string } | null;
}

export interface EInvoiceDoc {
  number: string;
  issue_date?: string | null;
  due_date?: string | null;
  currency?: string | null;
  invoice_type_code?: string | null;
  transaction_type?: string | null;
  payment_means_code?: string | null;
  tax_rate?: number | null;
  discount?: number | null;
  unit_price_formula?: { a: string; b?: string } | null;
  // Corrective documents (credit/debit note 381/383) reference the original.
  original_invoice_number?: string | null;
  original_invoice_date?: string | null;
  // Rate to AED for the mandatory tax total in the accounting currency when the
  // document currency isn't AED (BT-6 / BR-53). 1 doc-currency unit = N AED.
  aed_exchange_rate?: number | null;
  seller_name?: string | null;
  seller_address?: string | null;
  seller_trn?: string | null;
  seller_city?: string | null;
  seller_country_subdivision?: string | null;
  seller_legal_id?: string | null;
  seller_legal_id_type?: string | null;
  customer_name?: string | null;
  customer_address?: string | null;
  customer_trn?: string | null;
  buyer_city?: string | null;
  buyer_country_subdivision?: string | null;
  buyer_country_code?: string | null;
  items: EInvoiceItem[];
}

// --- tax math (mirrors the FTA print template) ------------------------------
// VAT applies only to standard-rated ("S") lines; a document discount is
// allocated across categories pro-rata by net so the breakdown reconciles.
export interface TaxRow {
  category: string;
  taxable: number;
  rate: number;
  tax: number;
}
export interface EInvoiceTotals {
  lineExtension: number; // sum of line nets (before discount)
  discount: number;
  taxExclusive: number; // taxable base after discount
  taxTotal: number; // total VAT
  taxInclusive: number; // payable
  rows: TaxRow[];
}

export function computeTotals(doc: EInvoiceDoc): EInvoiceTotals {
  const rate = doc.tax_rate || 0;
  const nets = doc.items.map((it) => ({
    cat: it.tax_category || DEFAULT_TAX_CATEGORY,
    net: docLineAmount(it as any, doc.unit_price_formula),
  }));
  const lineExtension = r2(nets.reduce((s, n) => s + n.net, 0));
  const discount = r2(doc.discount || 0);
  const taxExclusive = r2(lineExtension - discount);
  const byCat: Record<string, number> = {};
  for (const n of nets) byCat[n.cat] = (byCat[n.cat] || 0) + n.net;
  const rows: TaxRow[] = Object.entries(byCat).map(([category, net]) => {
    const taxable = lineExtension > 0 ? r2(taxExclusive * (net / lineExtension)) : 0;
    const r = category === "S" ? rate : 0;
    return { category, taxable, rate: r, tax: r2((taxable * r) / 100) };
  });
  const taxTotal = r2(rows.reduce((s, t) => s + t.tax, 0));
  return {
    lineExtension,
    discount,
    taxExclusive,
    taxTotal,
    taxInclusive: r2(taxExclusive + taxTotal),
    rows,
  };
}

// --- validation -------------------------------------------------------------
/** Errors block export; warnings are surfaced but allow export. */
export function validateEInvoice(doc: EInvoiceDoc): {
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!doc.number?.trim()) errors.push("Invoice number");
  if (!doc.issue_date) errors.push("Invoice date");
  if (!doc.currency?.trim()) errors.push("Currency");
  if (!(doc.invoice_type_code || DEFAULT_INVOICE_TYPE_CODE)) errors.push("Invoice type code");
  const validLines = doc.items.filter(
    (i) => i.description?.trim() && i.qty > 0
  );
  if (!validLines.length) errors.push("At least one valid line item");

  if (!doc.seller_name?.trim()) errors.push("Seller name");
  // Seller TRN + emirate are mandatory on a UAE tax invoice — block, don't warn.
  if (!doc.seller_trn?.trim()) errors.push("Seller TRN / TIN (Company settings)");
  if (!doc.seller_country_subdivision?.trim())
    errors.push("Seller emirate (Company settings)");
  if (!doc.seller_legal_id?.trim())
    warnings.push("Seller legal registration ID (Company settings)");

  if (!doc.customer_name?.trim()) errors.push("Buyer name");
  // Buyer TRN stays a warning: simplified (B2C) tax invoices don't carry one.
  if (!doc.customer_trn?.trim()) warnings.push("Buyer TRN / TIN (Customer record)");
  if (!doc.buyer_country_subdivision?.trim())
    warnings.push("Buyer emirate (Customer record)");

  // Credit/debit notes must reference the original invoice.
  const typeCode = doc.invoice_type_code || DEFAULT_INVOICE_TYPE_CODE;
  if (CORRECTIVE_TYPE_CODES.includes(typeCode) && !doc.original_invoice_number?.trim())
    errors.push("Original invoice number (credit/debit note)");

  // Foreign-currency invoices need a rate to state VAT in AED.
  if ((doc.currency || "AED") !== "AED" && !(doc.aed_exchange_rate && doc.aed_exchange_rate > 0))
    errors.push("AED exchange rate (foreign-currency invoice)");

  return { errors, warnings };
}

// --- XML serialization ------------------------------------------------------

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const amt = (n: number, ccy: string) =>
  `currencyID="${esc(ccy)}">${(n || 0).toFixed(2)}`;

// Tax-exemption reason line for a non-standard category (BT-120). Goes between
// <cbc:Percent> and <cac:TaxScheme> in both ClassifiedTaxCategory and TaxCategory.
const exemptReason = (cat: string) => {
  const reason = cat !== "S" && TAX_EXEMPTION_REASONS[cat];
  return reason ? `        <cbc:TaxExemptionReason>${esc(reason)}</cbc:TaxExemptionReason>\n` : "";
};

// Map the free-text unit to a UN/ECE Rec 20 code (default C62 = "one").
// ponytail: only the common ones; extend when a unit actually needs it.
const UNECE: Record<string, string> = {
  pcs: "C62",
  pc: "C62",
  unit: "C62",
  ea: "EA",
  kg: "KGM",
  g: "GRM",
  l: "LTR",
  ltr: "LTR",
  m: "MTR",
  km: "KMT",
  hr: "HUR",
  hour: "HUR",
  day: "DAY",
  box: "XBX",
};
const unitCode = (u?: string | null) =>
  (u && UNECE[u.toLowerCase().trim()]) || "C62";

function partyXml(
  role: "AccountingSupplierParty" | "AccountingCustomerParty",
  p: {
    name?: string | null;
    trn?: string | null;
    legalId?: string | null;
    legalScheme?: string | null;
    street?: string | null;
    city?: string | null;
    emirate?: string | null;
    country?: string | null;
  }
): string {
  const tin = tinFromTrn(p.trn);
  const country = (p.country || UAE_COUNTRY_CODE).toUpperCase();
  // Legal-registration ID scheme (IBT-030/047): PINT-AE puts the type in
  // schemeAgencyID + a schemeAgencyName, NOT schemeID. See docs/pint-ae.
  const legalSchemeName: Record<string, string> = {
    TL: "Trade License issuing Authority",
    EID: "Emirates ID",
    PAS: "Passport",
    CD: "Cabinet Decision",
  };
  // Peppol endpoint scheme 0235 is the UAE TIN scheme — only valid for a UAE
  // party. Foreign buyers use a different scheme we can't infer, so omit it.
  const endpoint =
    tin && country === UAE_COUNTRY_CODE
      ? `      <cbc:EndpointID schemeID="${UAE_EAS_SCHEME}">${esc(tin)}</cbc:EndpointID>\n`
      : "";
  return `  <cac:${role}>
    <cac:Party>
${endpoint}      <cac:PostalAddress>
${p.street ? `        <cbc:StreetName>${esc(p.street)}</cbc:StreetName>\n` : ""}${p.city ? `        <cbc:CityName>${esc(p.city)}</cbc:CityName>\n` : ""}${p.emirate ? `        <cbc:CountrySubentity>${esc(normalizeEmirate(p.emirate))}</cbc:CountrySubentity>\n` : ""}        <cac:Country>
          <cbc:IdentificationCode>${esc(country)}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
${p.trn ? `      <cac:PartyTaxScheme>
        <cbc:CompanyID>${esc(p.trn)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>${DEFAULT_TAX_SCHEME}</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>\n` : ""}      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${esc(p.name)}</cbc:RegistrationName>
${p.legalId ? `        <cbc:CompanyID${p.legalScheme ? ` schemeAgencyID="${esc(p.legalScheme)}" schemeAgencyName="${esc(legalSchemeName[p.legalScheme] || p.legalScheme)}"` : ""}>${esc(p.legalId)}</cbc:CompanyID>\n` : ""}      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:${role}>`;
}

/** Serialize an invoice to PINT-AE UBL 2.1 XML. */
export function buildInvoiceXml(doc: EInvoiceDoc): string {
  const ccy = doc.currency || "AED";
  const t = computeTotals(doc);
  const typeCode = doc.invoice_type_code || DEFAULT_INVOICE_TYPE_CODE;
  // UUID is fatal-mandatory (BTAE-07 / ibr-193-ae). ponytail: generated per
  // export; store it on the doc if a stable cross-export identifier is needed.
  const uuid = globalThis.crypto?.randomUUID?.() ?? "";

  // Corrective documents (credit/debit note) must reference the invoice they
  // adjust (BG-3 / BR-AE).
  const billingRef =
    CORRECTIVE_TYPE_CODES.includes(typeCode) && doc.original_invoice_number?.trim()
      ? `  <cac:BillingReference>
    <cac:InvoiceDocumentReference>
      <cbc:ID>${esc(doc.original_invoice_number)}</cbc:ID>
${doc.original_invoice_date ? `      <cbc:IssueDate>${esc(doc.original_invoice_date)}</cbc:IssueDate>\n` : ""}    </cac:InvoiceDocumentReference>
  </cac:BillingReference>\n`
      : "";

  // When the document currency isn't AED, a second tax total stating the VAT in
  // AED (the accounting currency) is mandatory (BT-6 / BR-53).
  const aedRate = doc.aed_exchange_rate || 0;
  const needAed = ccy !== "AED" && aedRate > 0;
  const taxCurrencyCode = needAed ? `  <cbc:TaxCurrencyCode>AED</cbc:TaxCurrencyCode>\n` : "";
  const aedTaxTotal = needAed
    ? `  <cac:TaxTotal>
    <cbc:TaxAmount ${amt(r2(t.taxTotal * aedRate), "AED")}</cbc:TaxAmount>
  </cac:TaxTotal>\n`
    : "";

  const lines = doc.items
    .filter((i) => i.description?.trim())
    .map((it, i) => {
      const net = r2(docLineAmount(it as any, doc.unit_price_formula));
      const cat = it.tax_category || DEFAULT_TAX_CATEGORY;
      const rate = cat === "S" ? doc.tax_rate || 0 : 0;
      const lineTax = r2((net * rate) / 100);
      // ItemPriceExtension: line amount incl. VAT (BTAE-10) + line VAT (BTAE-08),
      // both fatal-mandatory (ibr-104/194-ae). Per the MoF mandatory-fields list
      // (fields 48-49) both are AED amounts even on foreign-currency invoices —
      // convert at the frozen rate when the doc currency isn't AED.
      const lineCcy = needAed ? "AED" : ccy;
      const lineAmount = needAed ? r2((net + lineTax) * aedRate) : r2(net + lineTax);
      const lineVat = needAed ? r2(lineTax * aedRate) : lineTax;
      return `  <cac:InvoiceLine>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${unitCode(it.unit)}">${it.qty}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount ${amt(net, ccy)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Description>${esc(it.description)}</cbc:Description>
      <cbc:Name>${esc(it.description)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${cat}</cbc:ID>
        <cbc:Percent>${rate}</cbc:Percent>
${exemptReason(cat)}        <cac:TaxScheme><cbc:ID>${DEFAULT_TAX_SCHEME}</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount ${amt(it.unit_price, ccy)}</cbc:PriceAmount>
      <cbc:BaseQuantity unitCode="${unitCode(it.unit)}">1</cbc:BaseQuantity>
    </cac:Price>
    <cac:ItemPriceExtension>
      <cbc:Amount ${amt(lineAmount, lineCcy)}</cbc:Amount>
      <cac:TaxTotal>
        <cbc:TaxAmount ${amt(lineVat, lineCcy)}</cbc:TaxAmount>
      </cac:TaxTotal>
    </cac:ItemPriceExtension>
  </cac:InvoiceLine>`;
    })
    .join("\n");

  const taxSubtotals = t.rows
    .map(
      (row) => `    <cac:TaxSubtotal>
      <cbc:TaxableAmount ${amt(row.taxable, ccy)}</cbc:TaxableAmount>
      <cbc:TaxAmount ${amt(row.tax, ccy)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${row.category}</cbc:ID>
        <cbc:Percent>${row.rate}</cbc:Percent>
${exemptReason(row.category)}        <cac:TaxScheme><cbc:ID>${DEFAULT_TAX_SCHEME}</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`
    )
    .join("\n");

  const allowance =
    t.discount > 0
      ? `  <cac:AllowanceCharge>
    <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
    <cbc:AllowanceChargeReason>Discount</cbc:AllowanceChargeReason>
    <cbc:Amount ${amt(t.discount, ccy)}</cbc:Amount>
  </cac:AllowanceCharge>\n`
      : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>${PINT_AE_SPEC_IDENTIFIER}</cbc:CustomizationID>
  <cbc:ProfileID>${PINT_AE_PROCESS_ID}</cbc:ProfileID>
  <cbc:ProfileExecutionID>${esc(doc.transaction_type || DEFAULT_TRANSACTION_TYPE)}</cbc:ProfileExecutionID>
  <cbc:ID>${esc(doc.number)}</cbc:ID>
  <cbc:UUID>${uuid}</cbc:UUID>
  <cbc:IssueDate>${esc(doc.issue_date)}</cbc:IssueDate>
${doc.due_date ? `  <cbc:DueDate>${esc(doc.due_date)}</cbc:DueDate>\n` : ""}  <cbc:InvoiceTypeCode>${esc(typeCode)}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${esc(ccy)}</cbc:DocumentCurrencyCode>
${taxCurrencyCode}${billingRef}${partyXml("AccountingSupplierParty", {
    name: doc.seller_name,
    trn: doc.seller_trn,
    legalId: doc.seller_legal_id,
    legalScheme: doc.seller_legal_id_type,
    street: doc.seller_address,
    city: doc.seller_city,
    emirate: doc.seller_country_subdivision,
    country: UAE_COUNTRY_CODE,
  })}
${partyXml("AccountingCustomerParty", {
    name: doc.customer_name,
    trn: doc.customer_trn,
    street: doc.customer_address,
    city: doc.buyer_city,
    emirate: doc.buyer_country_subdivision,
    country: doc.buyer_country_code,
  })}
${doc.payment_means_code ? `  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>${esc(doc.payment_means_code)}</cbc:PaymentMeansCode>
  </cac:PaymentMeans>\n` : ""}${allowance}  <cac:TaxTotal>
    <cbc:TaxAmount ${amt(t.taxTotal, ccy)}</cbc:TaxAmount>
    <cbc:TaxIncludedIndicator>false</cbc:TaxIncludedIndicator>
${taxSubtotals}
  </cac:TaxTotal>
${aedTaxTotal}  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount ${amt(t.lineExtension, ccy)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount ${amt(t.taxExclusive, ccy)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount ${amt(t.taxInclusive, ccy)}</cbc:TaxInclusiveAmount>
${t.discount > 0 ? `    <cbc:AllowanceTotalAmount ${amt(t.discount, ccy)}</cbc:AllowanceTotalAmount>\n` : ""}    <cbc:PayableAmount ${amt(t.taxInclusive, ccy)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${lines}
</Invoice>`;
}
