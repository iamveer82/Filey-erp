// UAE Electronic Invoice — Peppol PINT-AE (UBL 2.1) serializer + validator.
//
// Turns a captured invoice into the structured XML the FTA mandate requires.
// Built against the vendored PINT-AE 1.0.4 rules. Browser checks cover supported
// scenarios; the accredited provider must perform final submission validation.

import { docLineAmount, docTaxBreakdown, type DocItem } from "./docItems";
import codes from "./einvoiceCodes.json";
import { r2, taxBreakdown } from "./money";
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
  partyTin,
  CREDIT_REASONS,
  EMIRATES,
  PINT_AE_INVOICE_TYPE_CODES,
  TAX_EXEMPTION_CODES,
  REVERSE_CHARGE_TYPES,
  TAX_CATEGORY_CODES,
  TRANSACTION_TYPE_FLAGS,
  type EInvoiceDetails,
  type EInvoiceParty,
  normalizeEmirate,
  isCreditNote,
  isCommercialInvoice,
  buyerEndpoint,
  isInvoiceUuid,
} from "./einvoice";

export interface EInvoiceItem extends DocItem {
  description: string;
  qty: number;
  unit_price: number;
  unit?: string;
  tax_category?: string | null;
  calcMode?: "auto" | "manual" | "formula";
  amount?: number;
  itemFormula?: { a: string; b?: string } | null;
}

export interface EInvoiceDoc {
  einvoice?: EInvoiceDetails;
  advance_applied?: number | null;
  round_off?: boolean | null;
  fx_rate?: number | null;
  date_of_supply?: string | null;
  po_number?: string | null;
  notes?: string | null;
  terms?: string | null;
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
  tax_country_code?: string | null;
  seller_name?: string | null;
  seller_address?: string | null;
  seller_trn?: string | null;
  seller_email?: string | null;
  seller_phone?: string | null;
  seller_city?: string | null;
  seller_country_subdivision?: string | null;
  seller_legal_id?: string | null;
  seller_legal_id_type?: string | null;
  customer_name?: string | null;
  customer_address?: string | null;
  customer_trn?: string | null;
  customer_email?: string | null;
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
  net: number;
  discount: number;
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
  prepaid: number;
  rounding: number;
  payable: number;
  rows: TaxRow[];
}

export function computeTotals(doc: EInvoiceDoc): EInvoiceTotals {
  const rows = docTaxBreakdown(doc.items, doc.discount || 0, doc.tax_rate || 0, doc.unit_price_formula);
  const lineExtension = r2(rows.reduce((s, row) => s + row.net, 0));
  const discount = r2(rows.reduce((s, row) => s + row.discount, 0));
  const taxExclusive = r2(lineExtension - discount);
  const taxTotal = r2(rows.reduce((s, t) => s + t.tax, 0));
  const taxInclusive = r2(taxExclusive + taxTotal);
  const prepaid = r2(doc.advance_applied || 0);
  const rounding = doc.round_off ? r2(Math.round(taxInclusive) - taxInclusive) : 0;
  return {
    lineExtension,
    discount,
    taxExclusive,
    taxTotal,
    taxInclusive, prepaid, rounding, payable: r2(taxInclusive + rounding - prepaid),
    rows,
  };
}

// --- validation -------------------------------------------------------------
export interface EInvoiceIssue { field: string; label: string; section: "details" | "items" | "einvoice" }
const validDate = (value?: string | null) => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !value.startsWith("0000") && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const validVat = (value: string) => /^1\d{12}03$/.test(value.trim());
// Cent calculations must stay within JavaScript's exact integer range.
const safeAmount = (value: number) => finite(value) && Number.isSafeInteger(Math.round(value * 100));
// GS1 check digit, also used by the official PINT IBR-068 GLN rule.
const validGs1 = (value: string) => {
  const sum = [...value.slice(0, -1)].reverse().reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 1 : 3), 0);
  return (10 - sum % 10) % 10 === Number(value.slice(-1));
};

/** Fast checks run offline. The accredited provider must also validate the
 * complete XML against the versioned PINT-AE Schematrons before submission. */
export function eInvoiceIssues(doc: EInvoiceDoc): EInvoiceIssue[] {
  const issues: EInvoiceIssue[] = [];
  const add = (field: string, label: string, section: EInvoiceIssue["section"] = "details") => issues.push({ field, label, section });
  // Imported/legacy JSON is untrusted even though the editor has typed fields.
  // Validate text before calling string methods; never turn a corrupt identity
  // into an empty value that could be replaced by another entity's default.
  const text = (value: unknown, field: string, section: EInvoiceIssue["section"] = "einvoice") => {
    if (value != null && typeof value !== "string") add(field, `${field}: the saved value must contain text`, section);
    // Reject XML-forbidden characters without changing a supplied identity.
    // eslint-disable-next-line no-control-regex
    if (typeof value === "string" && /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/u.test(value))
      add(field, `${field}: contains a character not supported by XML; correct the original value`, section);
  };
  const record = (value: unknown, field: string, section: EInvoiceIssue["section"] = "einvoice") => {
    if (value == null) return undefined;
    if (typeof value !== "object" || Array.isArray(value)) {
      add(field, `${field}: saved details must be an object`, section);
      return undefined;
    }
    return value as Record<string, unknown>;
  };
  const metadata = record(doc.einvoice, "einvoice");
  for (const key of ["uuid", "credit_reason", "payment_account_id", "payment_account_name", "beneficiary_id", "buyer_delivery_mode"])
    text(metadata?.[key], `einvoice.${key}`);
  for (const role of ["seller", "buyer"] as const) {
    const party = record(metadata?.[role], `einvoice.${role}`);
    for (const key of ["corporate_trn", "tin", "endpoint_id", "endpoint_scheme", "legal_id", "legal_id_type", "legal_authority", "identifier", "phone"])
      text(party?.[key], `einvoice.${role}.${key}`);
  }
  const deliveryDetails = record(metadata?.delivery, "einvoice.delivery");
  for (const key of ["address", "city", "region", "country_code"]) text(deliveryDetails?.[key], `einvoice.delivery.${key}`);
  for (const key of ["number", "issue_date", "due_date", "date_of_supply", "original_invoice_date", "currency", "invoice_type_code", "transaction_type", "payment_means_code", "tax_country_code", "notes", "terms", "po_number", "original_invoice_number", "seller_name", "seller_address", "seller_trn", "seller_email", "seller_phone", "seller_city", "seller_country_subdivision", "seller_legal_id", "seller_legal_id_type", "customer_name", "customer_address", "customer_trn", "customer_email", "buyer_city", "buyer_country_subdivision", "buyer_country_code"] as const)
    text(doc[key], key, "details");
  if (!Array.isArray(doc.items)) {
    add("items", "Invoice lines must be a list", "items");
    return issues;
  }
  doc.items.forEach((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      add(`items.${index}`, `Item ${index + 1}: saved line must be an object`, "items");
      return;
    }
    for (const key of ["description", "unit", "tax_category"] as const) text(item[key], `items.${index}.${key}`, "items");
    const custom = record(item.custom, `items.${index}.custom`, "items");
    for (const [key, value] of Object.entries(custom || {})) text(value, `items.${index}.custom.${key}`, "items");
  });
  if (issues.length) return issues;
  // Missing UUID is allowed here: Save & export assigns it before serialization.
  // An existing invalid identity must not be silently regenerated on export.
  if (doc.einvoice?.uuid && !isInvoiceUuid(doc.einvoice.uuid))
    add("einvoice.uuid", "This saved identifier is not in Filey's UUID format. It is preserved unchanged; contact support to review this record before XML preparation.", "einvoice");
  if (doc.tax_country_code && doc.tax_country_code !== "AE") add("tax_country_code", "PINT-AE export requires a UAE tax document");
  if (!esc(doc.number).trim()) add("number", "Invoice number");
  if (!validDate(doc.issue_date)) add("issue_date", "Valid invoice date");
  if (doc.due_date && !validDate(doc.due_date)) add("due_date", "Valid due date");
  if (doc.date_of_supply && !validDate(doc.date_of_supply)) add("date_of_supply", "Valid supply date");
  if (!codes.currencies.includes(doc.currency || "")) add("currency", "Supported currency");
  const type = doc.invoice_type_code || DEFAULT_INVOICE_TYPE_CODE;
  if (!isCreditNote(type) && doc.date_of_supply && doc.issue_date && doc.date_of_supply > doc.issue_date)
    add("date_of_supply", "Supply date must not follow the invoice date for this export");
  if (!PINT_AE_INVOICE_TYPE_CODES.some(code => code.code === type)) add("invoice_type_code", "Choose a UAE tax invoice, commercial invoice or credit note for electronic export");
  if (!/^[01]{8}$/.test(doc.transaction_type || DEFAULT_TRANSACTION_TYPE)) add("transaction_type", "Transaction type must contain eight flags");
  for (const index of [1, 2, 3, 4, 5, 6]) {
    if (doc.transaction_type?.[index] === "1") add("transaction_type", `Use your provider's form for ${TRANSACTION_TYPE_FLAGS[index].label.toLowerCase()} invoices. Filey export does not support this scenario yet.`);
  }
  if (doc.transaction_type?.[0] === "1" && !/^1(?:\d{9}|\d{12}03)$/.test(doc.einvoice?.beneficiary_id?.trim() || ""))
    add("einvoice.beneficiary_id", "Beneficiary TRN or TIN for free-zone supply", "einvoice");
  const delivery = doc.einvoice?.delivery;
  if (doc.transaction_type?.[7] === "1") {
    if (!esc(delivery?.address).trim()) add("einvoice.delivery.address", "Export delivery street address", "einvoice");
    if (!esc(delivery?.city).trim()) add("einvoice.delivery.city", "Export delivery city", "einvoice");
    if (!esc(delivery?.region).trim()) add("einvoice.delivery.region", "Export delivery region", "einvoice");
    if (!codes.countries.includes(delivery?.country_code || "") || delivery?.country_code === "AE")
      add("einvoice.delivery.country_code", "Export delivery country outside the UAE", "einvoice");
  }
  if (doc.einvoice?.buyer_delivery_mode === "export-unregistered" && doc.transaction_type?.[7] !== "1")
    add("einvoice.buyer_delivery_mode", "Select Exports before using the unregistered export recipient", "einvoice");
  // IBR-191-AE: credit notes do not require payment instructions.
  if ((doc.payment_means_code || !isCreditNote(type)) && !codes.payments.includes(doc.payment_means_code || "")) add("payment_means_code", "Choose a supported payment method");
  if (doc.payment_means_code === "30" && !esc(doc.einvoice?.payment_account_id).trim()) add("einvoice.payment_account_id", "Bank account / IBAN for credit transfer", "einvoice");
  if (!doc.items.length || doc.items.length > 500) add("items", "Use between 1 and 500 line items", "items");
  doc.items.forEach((item, index) => {
    const prefix = `Item ${index + 1}: `;
    const error = (field: string, label: string) => add(`items.${index}.${field}`, prefix + label, "items");
    if (!esc(item.description).trim()) error("description", "add a description");
    if (!finite(item.qty) || item.qty <= 0) error("qty", "quantity must be greater than zero");
    if (!finite(item.unit_price) || item.unit_price < 0) error("unit_price", "enter a valid non-negative price");
    if (item.calcMode === "manual" && (!finite(item.amount) || item.amount! < 0)) error("amount", "enter a valid line amount");
    if (item.discount != null && (!finite(item.discount) || item.discount < 0 || item.discount > 100)) error("discount", "discount must be between 0 and 100%");
    if (item.tax != null && (!finite(item.tax) || item.tax < 0 || item.tax > 100)) error("tax", "enter a valid tax rate");
    if ((item.tax_category || "S") === "S" && (item.tax || doc.tax_rate || 0) !== 5) error("tax", "UAE standard-rated items must use 5% VAT");
    if (!TAX_CATEGORY_CODES.some(code => code.code === (item.tax_category || "S"))) error("tax_category", "choose a supported tax category");
    const category = item.tax_category || "S";
    if (isCommercialInvoice(type) && !["E", "O", "Z"].includes(category)) error("tax_category", "commercial invoices can only use exempt, out-of-scope or zero-rated categories");
    if (category === "E" && !TAX_EXEMPTION_CODES.some(code => code.code === item.custom?.einvoice_exemption_code)) error("custom.einvoice_exemption_code", "choose a VAT exemption reason");
    const gtin = item.custom?.einvoice_gtin?.trim();
    const nature = item.custom?.einvoice_nature;
    if ((category === "AE" || nature?.trim()) && !REVERSE_CHARGE_TYPES.some(code => code.code === nature))
      error("custom.einvoice_nature", "choose a supported reverse-charge goods or services type");
    if (category === "AE") {
      if (!gtin) error("custom.einvoice_gtin", "enter the item's GTIN for reverse charge");
    }
    if (gtin && (!/^(?:\d{8}|\d{12,14})$/.test(gtin) || !validGs1(gtin))) error("custom.einvoice_gtin", "enter a valid GTIN including its check digit");
    const itemType = item.custom?.einvoice_item_type;
    if (itemType && !["G", "S", "B"].includes(itemType)) error("custom.einvoice_item_type", "choose a supported item type");
    if (["G", "B"].includes(itemType || "") && !esc(item.custom?.einvoice_hs_code).trim()) error("custom.einvoice_hs_code", "goods require an HS classification code");
    if (["S", "B"].includes(itemType || "") && !esc(item.custom?.einvoice_service_code).trim()) error("custom.einvoice_service_code", "services require a service accounting code");
    if (!unitCode(item.unit)) error("unit", "choose a recognised unit code, for example H87 (piece), KGM (kg) or HUR (hour)");
    const formula = item.calcMode !== "manual" && (item.calcMode === "formula" && item.itemFormula?.a ? item.itemFormula : doc.unit_price_formula);
    if (formula && formula.a !== "qty") {
      const multiplier = item.custom?.[formula.a];
      if (!multiplier?.trim() || !Number.isFinite(Number(multiplier)) || Number(multiplier) !== parseFloat(multiplier) || Number(multiplier) < 0)
        error(`custom.${formula.a}`, "enter a valid non-negative formula quantity");
    }
    const net = docLineAmount(item, doc.unit_price_formula);
    if (!safeAmount(net) || net < 0) error(item.calcMode === "manual" ? "amount" : "unit_price", "line amount must be non-negative and small enough to calculate accurately");
    // IBR-147-AE uses exact cent reconciliation. Six-decimal effective prices
    // can lose a cent on very large quantities; never export a mismatched line.
    else if (finite(item.qty) && item.qty > 0 && (!finite(net / item.qty) || (net / item.qty).toFixed(6).includes("e") || r2(item.qty * Number((net / item.qty).toFixed(6))) !== net))
      error(item.calcMode === "manual" ? "amount" : "unit_price", "quantity and effective price cannot reconcile to the line amount; adjust the quantity or amount");
  });
  if (doc.items.some(item => item.tax_category === "AE") && !doc.customer_trn?.trim()) add("customer_trn", "Buyer VAT TRN for reverse charge");
  if (["380", "381"].includes(type) && doc.items.length && doc.items.every(item => ["E", "O"].includes(item.tax_category || "S")))
    add("invoice_type_code", "Use a commercial invoice or commercial credit note when every line is exempt or out of scope");
  if (doc.tax_rate != null && (!finite(doc.tax_rate) || doc.tax_rate < 0 || doc.tax_rate > 100)) add("tax_rate", "Tax rate must be between 0 and 100%", "items");
  const net = doc.items.reduce((sum, item) => sum + docLineAmount(item, doc.unit_price_formula), 0);
  if (!safeAmount(net)) add("items", "Line totals are too large to calculate accurately", "items");
  if (doc.discount != null && (!finite(doc.discount) || doc.discount < 0 || doc.discount > net)) add("discount", "Discount cannot exceed the line total", "items");
  if (doc.advance_applied != null && (!finite(doc.advance_applied) || doc.advance_applied < 0)) add("advance_applied", "Enter a valid advance amount");
  if ((doc.currency || "AED") !== "AED") {
    const rate = doc.aed_exchange_rate ?? doc.fx_rate;
    if (!(finite(rate) && rate > 0)) add("aed_exchange_rate", "AED exchange rate (foreign-currency invoice)");
    else if (Number(rate.toFixed(6)) !== rate) add("aed_exchange_rate", "AED exchange rate must have at most six decimal places");
  }

  for (const role of ["seller", "buyer"] as const) {
    const seller = role === "seller";
    const party = doc.einvoice?.[role];
    const label = seller ? "Seller" : "Buyer";
    const country = seller ? "AE" : doc.buyer_country_code || "AE";
    const name = seller ? doc.seller_name : doc.customer_name;
    const address = seller ? doc.seller_address : doc.customer_address;
    const city = seller ? doc.seller_city : doc.buyer_city;
    const emirate = normalizeEmirate(seller ? doc.seller_country_subdivision : doc.buyer_country_subdivision);
    const vat = (seller ? doc.seller_trn : doc.customer_trn)?.trim();
    const legal = seller ? doc.seller_legal_id || party?.legal_id : party?.legal_id;
    const legalType = seller ? doc.seller_legal_id_type || party?.legal_id_type : party?.legal_id_type;
    const check = (field: string, message: string, section: EInvoiceIssue["section"] = "einvoice") => add(field, `${label} ${message}`, section);
    const identityField = (field: string) => `einvoice.${role}.${field}`;
    const legalField = seller ? "seller_legal_id" : identityField("legal_id");
    const legalTypeField = seller ? "seller_legal_id_type" : identityField("legal_id_type");
    if (!esc(name).trim()) add(seller ? "seller_name" : "customer_name", `${label} name`);
    if (!esc(address).trim()) check(seller ? "seller_address" : "customer_address", "street address", "details");
    if (!esc(city).trim()) check(seller ? "seller_city" : "buyer_city", "city", "details");
    if (!codes.countries.includes(country)) check("buyer_country_code", "country code", "details");
    if (!esc(emirate).trim() || (country === "AE" && !EMIRATES.some(entry => entry.code === emirate))) check(seller ? "seller_country_subdivision" : "buyer_country_subdivision", "emirate / region", "details");
    if (vat && country === "AE" && !validVat(vat)) check(seller ? "seller_trn" : "customer_trn", "VAT TRN must contain 15 digits, start with 1 and end with 03", "details");
    if (seller && !vat && !isCommercialInvoice(type)) check("seller_trn", "VAT TRN", "details");
    if (seller && !vat && isCommercialInvoice(type) && !/^1\d{9}$/.test(partyTin(party))) check(identityField("tin"), "TIN for a business without a VAT TRN");
    const buyer = buyerEndpoint(doc.einvoice, country);
    const endpoint = seller ? party?.endpoint_id?.trim() || (country === "AE" ? partyTin(party) : "") : buyer.id;
    const scheme = seller ? party?.endpoint_scheme || (country === "AE" ? UAE_EAS_SCHEME : "") : buyer.scheme;
    if (!endpoint) check(identityField("endpoint_id"), "electronic invoicing address / TIN");
    if (!codes.endpoints.includes(scheme)) check(identityField("endpoint_scheme"), "electronic address scheme");
    // MoF programme identity: the UAE seller uses 0235 and its own TIN.
    if (seller && scheme !== UAE_EAS_SCHEME) check(identityField("endpoint_scheme"), "UAE electronic address scheme must be 0235");
    if (scheme === UAE_EAS_SCHEME && endpoint && !(seller ? /^1\d{9}$/ : /^[19]\d{9}$/).test(endpoint)) check(identityField("endpoint_id"), seller ? "TIN must contain 10 digits and start with 1" : "electronic address must contain 10 digits and start with 1 or 9");
    if (party?.tin && !/^1\d{9}$/.test(party.tin.trim())) check(identityField("tin"), "TIN must contain 10 digits and start with 1");
    if (party?.corporate_trn && !/^1\d{14}$/.test(party.corporate_trn.trim())) check(identityField("corporate_trn"), "own FTA TRN must contain 15 digits and start with 1");
    // Supplied identity sources must describe the same entity. A tax-group
    // VAT snapshot is deliberately never used to infer this own-entity TIN.
    if (party?.corporate_trn && /^1\d{14}$/.test(party.corporate_trn.trim()) && party.tin?.trim() && party.tin.trim() !== party.corporate_trn.trim().slice(0, 10))
      check(identityField("tin"), "TIN must match the first ten digits of the entity's own FTA TRN");
    if (scheme === UAE_EAS_SCHEME && /^1\d{9}$/.test(endpoint) && partyTin(party) && endpoint !== partyTin(party))
      check(identityField("endpoint_id"), "electronic address must match the entity's TIN");
    if (scheme === "0088" && endpoint && (!/^\d{13}$/.test(endpoint) || !validGs1(endpoint))) check(identityField("endpoint_id"), "GLN electronic address must contain 13 digits with a valid GS1 check digit");
    if (scheme === "0184" && endpoint && !/^DK\d{8}$/.test(endpoint)) check(identityField("endpoint_id"), "Danish electronic address must use DK followed by eight digits");
    if (!seller && scheme === UAE_EAS_SCHEME && endpoint === "9900000099" && doc.transaction_type?.[7] !== "1") check("einvoice.buyer_delivery_mode", "unregistered export address requires the Exports transaction flag");
    // IBR-136/149-AE: a tax-invoice buyer with a 1/9-prefix UAE address
    // does not need a legal ID solely because it has no VAT registration.
    if ((seller || isCommercialInvoice(type) || (scheme === UAE_EAS_SCHEME && endpoint && !/^[19]\d{9}$/.test(endpoint) && !vat)) && !esc(legal).trim()) check(legalField, "legal registration number", seller ? "details" : "einvoice");
    if (!seller && scheme === UAE_EAS_SCHEME && !/^1\d{9}$/.test(endpoint) && doc.transaction_type?.[7] !== "1" && !vat && !esc(party?.identifier).trim()) check(identityField("identifier"), "identifier for this electronic recipient");
    if (legal && !legalType && scheme === UAE_EAS_SCHEME) check(legalTypeField, "legal registration type", seller ? "details" : "einvoice");
    if (legalType && scheme === UAE_EAS_SCHEME && !["TL", "EID", "PAS", "CD"].includes(legalType)) check(legalTypeField, "supported legal registration type", seller ? "details" : "einvoice");
    if (legal && (legalType === "TL" || legalType === "PAS") && !esc(party?.legal_authority).trim()) check(identityField("legal_authority"), legalType === "PAS" ? "passport issuing country code" : "trade licence issuing authority");
    if (legalType === "PAS" && party?.legal_authority && !codes.countries.includes(party.legal_authority)) check(identityField("legal_authority"), "valid passport issuing country code");
  }
  if (CORRECTIVE_TYPE_CODES.includes(type) && doc.einvoice?.credit_reason !== "VD") {
    if (!esc(doc.original_invoice_number).trim()) add("original_invoice_number", "Original invoice number (credit/debit note)");
  }
  // IBT-026 is optional; IBR-073 validates it whenever supplied.
  if (doc.original_invoice_date && !validDate(doc.original_invoice_date)) add("original_invoice_date", "Valid original invoice date (credit/debit note)");
  if (isCreditNote(type) && !CREDIT_REASONS.some(reason => reason.code === doc.einvoice?.credit_reason)) add("einvoice.credit_reason", "Credit note reason", "einvoice");
  if (!issues.some(issue => issue.section === "items")) {
    const total = computeTotals(doc);
    if (![total.lineExtension, total.discount, total.taxExclusive, total.taxTotal, total.taxInclusive, total.prepaid, total.rounding, total.payable].every(safeAmount))
      add("items", "Invoice totals are too large to calculate accurately", "items");
    const rate = doc.aed_exchange_rate ?? doc.fx_rate;
    if (doc.currency !== "AED" && finite(rate) && rate > 0 &&
      (![total.taxTotal * rate, total.taxInclusive * rate].every(safeAmount) || doc.items.some(item => {
        const amount = docLineAmount(item, doc.unit_price_formula);
        const lineTax = (item.tax_category || "S") === "S" ? r2(amount * (item.tax || doc.tax_rate || 0) / 100) : 0;
        return !safeAmount((amount + lineTax) * rate);
      }))) add("aed_exchange_rate", "AED converted amounts are too large to calculate accurately");
    if (total.payable < 0) add("advance_applied", "Advance cannot exceed the invoice total");
    if (!isCreditNote(type) && total.payable > 0 && !validDate(doc.due_date)) add("due_date", "Payment due date for an invoice with an outstanding amount");
  }
  return issues;
}

export function validateEInvoice(doc: EInvoiceDoc): { errors: string[]; warnings: string[] } {
  return { errors: eInvoiceIssues(doc).map(issue => issue.label), warnings: [] };
}

// --- XML serialization ------------------------------------------------------

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const amt = (n: number, ccy: string) =>
  `currencyID="${esc(ccy)}">${n.toFixed(2)}`;
// XML decimal values cannot use JavaScript's scientific notation.
const decimal = (n: number) => n.toLocaleString("en-US", { useGrouping: false, maximumSignificantDigits: 21 });

// Tax-exemption reason line for a non-standard category (BT-120). Goes between
// <cbc:Percent> and <cac:TaxScheme> in both ClassifiedTaxCategory and TaxCategory.
const exemptReason = (cat: string, code?: string) => {
  const reason = cat !== "S" && TAX_EXEMPTION_REASONS[cat];
  return `${cat === "E" && code ? `        <cbc:TaxExemptionReasonCode>${esc(code)}</cbc:TaxExemptionReasonCode>\n` : ""}${reason ? `        <cbc:TaxExemptionReason>${esc(reason)}</cbc:TaxExemptionReason>\n` : ""}`;
};
const taxPercent = (cat: string, rate: number) => ["E", "O"].includes(cat) ? "" : `        <cbc:Percent>${rate}</cbc:Percent>\n`;

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
export const unitCode = (u?: string | null): string => {
  if (!u?.trim()) return "C62";
  const value = u.trim();
  if (codes.units.includes(value.toUpperCase())) return value.toUpperCase();
  return UNECE[value.toLowerCase()] || "";
};

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
    phone?: string | null;
    email?: string | null;
    identity?: EInvoiceParty | null;
    endpoint?: { id: string; scheme: string };
    taxRegistration?: string;
  }
): string {
  const tin = partyTin(p.identity);
  const country = (p.country || UAE_COUNTRY_CODE).toUpperCase();
  // Legal-registration ID scheme (IBT-030/047): PINT-AE puts the type in
  // schemeAgencyID + a schemeAgencyName, NOT schemeID. See docs/pint-ae.
  const endpointId = p.endpoint?.id || p.identity?.endpoint_id?.trim() || (country === UAE_COUNTRY_CODE ? tin : "");
  const endpointScheme = p.endpoint?.scheme || p.identity?.endpoint_scheme || (country === UAE_COUNTRY_CODE ? UAE_EAS_SCHEME : "");
  const endpoint = endpointId && endpointScheme
    ? `      <cbc:EndpointID schemeID="${esc(endpointScheme)}">${esc(endpointId)}</cbc:EndpointID>\n` : "";
  return `  <cac:${role}>
    <cac:Party>
${endpoint}${esc(p.identity?.identifier).trim() ? `      <cac:PartyIdentification><cbc:ID>${esc(p.identity?.identifier)}</cbc:ID></cac:PartyIdentification>\n` : ""}      <cac:PostalAddress>
${p.street ? `        <cbc:StreetName>${esc(p.street)}</cbc:StreetName>\n` : ""}${p.city ? `        <cbc:CityName>${esc(p.city)}</cbc:CityName>\n` : ""}${p.emirate ? `        <cbc:CountrySubentity>${esc(normalizeEmirate(p.emirate))}</cbc:CountrySubentity>\n` : ""}        <cac:Country>
          <cbc:IdentificationCode>${esc(country)}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
${esc(p.trn).trim() ? `      <cac:PartyTaxScheme>
        <cbc:CompanyID>${esc(p.trn?.trim())}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>${DEFAULT_TAX_SCHEME}</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>\n` : ""}${p.taxRegistration ? `      <cac:PartyTaxScheme><cbc:CompanyID>${esc(p.taxRegistration)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>TIN</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>\n` : ""}      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${esc(p.name)}</cbc:RegistrationName>
${esc(p.legalId).trim() ? `        <cbc:CompanyID${p.legalScheme ? ` schemeAgencyID="${esc(p.legalScheme)}" schemeAgencyName="${esc(p.identity?.legal_authority || p.legalScheme)}"` : ""}>${esc(p.legalId)}</cbc:CompanyID>\n` : ""}      </cac:PartyLegalEntity>
${p.phone?.trim() || p.email?.trim() ? `      <cac:Contact>
${p.phone?.trim() ? `        <cbc:Telephone>${esc(p.phone)}</cbc:Telephone>\n` : ""}${p.email?.trim() ? `        <cbc:ElectronicMail>${esc(p.email)}</cbc:ElectronicMail>\n` : ""}      </cac:Contact>\n` : ""}    </cac:Party>
  </cac:${role}>`;
}

/** Serialize an invoice to PINT-AE UBL 2.1 XML. */
export function buildInvoiceXml(doc: EInvoiceDoc): string {
  if (doc.tax_country_code && doc.tax_country_code !== "AE") throw new Error("PINT-AE export requires a UAE tax document.");
  const ccy = doc.currency || "AED";
  const typeCode = doc.invoice_type_code || DEFAULT_INVOICE_TYPE_CODE;
  if (!PINT_AE_INVOICE_TYPE_CODES.some(type => type.code === typeCode)) throw new Error("This document type is not supported by UAE electronic invoicing.");
  // Identity belongs to the saved invoice, never to an export attempt.
  const uuid = doc.einvoice?.uuid;
  if (!uuid)
    throw new Error("Save this invoice before exporting its electronic document.");
  const issues = eInvoiceIssues(doc);
  if (issues.length) throw new Error(`Complete the electronic invoice checks: ${issues.map(issue => issue.label).join("; ")}`);
  const t = computeTotals(doc);
  const root = isCreditNote(typeCode) ? "CreditNote" : "Invoice";
  const quantity = isCreditNote(typeCode) ? "CreditedQuantity" : "InvoicedQuantity";

  // Corrective documents (credit/debit note) must reference the invoice they
  // adjust (BG-3 / BR-AE).
  const billingRef =
    CORRECTIVE_TYPE_CODES.includes(typeCode) && doc.original_invoice_number?.trim() && doc.einvoice?.credit_reason !== "VD"
      ? `  <cac:BillingReference>
    <cac:InvoiceDocumentReference>
      <cbc:ID>${esc(doc.original_invoice_number)}</cbc:ID>
${doc.original_invoice_date ? `      <cbc:IssueDate>${esc(doc.original_invoice_date)}</cbc:IssueDate>\n` : ""}    </cac:InvoiceDocumentReference>
  </cac:BillingReference>\n`
      : "";

  // When the document currency isn't AED, a second tax total stating the VAT in
  // AED (the accounting currency) is mandatory (BT-6 / BR-53).
  const aedRate = doc.aed_exchange_rate ?? doc.fx_rate ?? 0;
  const needAed = ccy !== "AED" && aedRate > 0;
  const taxCurrencyCode = needAed ? `  <cbc:TaxCurrencyCode>AED</cbc:TaxCurrencyCode>\n` : "";
  const aedTaxTotal = needAed
    ? `  <cac:TaxTotal>
    <cbc:TaxAmount ${amt(r2(t.taxTotal * aedRate), "AED")}</cbc:TaxAmount>
  </cac:TaxTotal>\n`
    : "";

  const lines = doc.items
    .map((it, i) => {
      const net = r2(docLineAmount(it, doc.unit_price_formula));
      const cat = it.tax_category || DEFAULT_TAX_CATEGORY;
      const rate = cat === "S" ? it.tax || doc.tax_rate || 0 : 0;
      const lineTax = r2((net * rate) / 100);
      // ItemPriceExtension: line amount incl. VAT (BTAE-10) + line VAT (BTAE-08),
      // both fatal-mandatory (ibr-104/194-ae). Per the MoF mandatory-fields list
      // (fields 48-49) both are AED amounts even on foreign-currency invoices —
      // convert at the frozen rate when the doc currency isn't AED.
      const lineCcy = needAed ? "AED" : ccy;
      const lineAmount = needAed ? r2((net + lineTax) * aedRate) : r2(net + lineTax);
      const lineVat = needAed ? r2(lineTax * aedRate) : lineTax;
      const unit = unitCode(it.unit);
      if (!unit) throw new Error(`Item ${i + 1}: choose a recognised unit code.`);
      // Manual amounts/formulas have an effective unit price. Six decimal places
      // retain line arithmetic within the PINT tolerance without double-discounting.
      const price = it.qty > 0 ? net / it.qty : 0;
      const custom = it.custom || {};
      const classification = esc(custom.einvoice_nature).trim() || esc(custom.einvoice_item_type).trim() || esc(custom.einvoice_hs_code).trim()
        ? `      <cac:CommodityClassification>
${esc(custom.einvoice_nature).trim() ? `        <cbc:NatureCode>${esc(custom.einvoice_nature)}</cbc:NatureCode>\n` : ""}${esc(custom.einvoice_item_type).trim() ? `        <cbc:CommodityCode>${esc(custom.einvoice_item_type)}</cbc:CommodityCode>\n` : ""}${esc(custom.einvoice_hs_code).trim() ? `        <cbc:ItemClassificationCode listID="HS">${esc(custom.einvoice_hs_code)}</cbc:ItemClassificationCode>\n` : ""}      </cac:CommodityClassification>\n` : "";
      return `  <cac:${root}Line>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:${quantity} unitCode="${unit}">${decimal(it.qty)}</cbc:${quantity}>
    <cbc:LineExtensionAmount ${amt(net, ccy)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Description>${esc(it.description)}</cbc:Description>
      <cbc:Name>${esc(it.description)}</cbc:Name>
${esc(custom.einvoice_gtin).trim() ? `      <cac:StandardItemIdentification><cbc:ID schemeID="0160">${esc(custom.einvoice_gtin.trim())}</cbc:ID></cac:StandardItemIdentification>\n` : ""}${esc(custom.einvoice_service_code).trim() ? `      <cac:AdditionalItemIdentification><cbc:ID schemeID="SAC">${esc(custom.einvoice_service_code)}</cbc:ID></cac:AdditionalItemIdentification>\n` : ""}${classification}      <cac:ClassifiedTaxCategory>
        <cbc:ID>${esc(cat)}</cbc:ID>
${taxPercent(cat, rate)}${exemptReason(cat, custom.einvoice_exemption_code)}        <cac:TaxScheme><cbc:ID>${DEFAULT_TAX_SCHEME}</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${esc(ccy)}">${price.toFixed(6)}</cbc:PriceAmount>
      <cbc:BaseQuantity unitCode="${unit}">1</cbc:BaseQuantity>
      <cac:AllowanceCharge>
        <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
        <cbc:Amount ${amt(0, ccy)}</cbc:Amount>
        <cbc:BaseAmount currencyID="${esc(ccy)}">${price.toFixed(6)}</cbc:BaseAmount>
      </cac:AllowanceCharge>
    </cac:Price>
    <cac:ItemPriceExtension>
      <cbc:Amount ${amt(lineAmount, lineCcy)}</cbc:Amount>
${cat !== "E" ? `      <cac:TaxTotal>
        <cbc:TaxAmount ${amt(lineVat, lineCcy)}</cbc:TaxAmount>
      </cac:TaxTotal>\n` : ""}
    </cac:ItemPriceExtension>
  </cac:${root}Line>`;
    })
    .join("\n");

  const taxSubtotals = t.rows
    .map(
      (row) => `    <cac:TaxSubtotal>
      <cbc:TaxableAmount ${amt(row.taxable, ccy)}</cbc:TaxableAmount>
      <cbc:TaxAmount ${amt(row.tax, ccy)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${row.category}</cbc:ID>
${taxPercent(row.category, row.rate)}${exemptReason(row.category)}        <cac:TaxScheme><cbc:ID>${DEFAULT_TAX_SCHEME}</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`
    )
    .join("\n");

  // IBT-196: an exempt allowance carries the exemption reason of the lines
  // it discounts. Reuse the cent allocator to split an E allowance when its
  // lines use different reasons; their sum preserves the shared tax totals.
  const allowanceRows = t.rows.filter(row => row.discount > 0).flatMap(row => row.category !== "E" ? [{ ...row, exemption: "" }] :
    taxBreakdown(doc.items.filter(item => item.tax_category === "E").map(item => ({
      category: item.custom!.einvoice_exemption_code, net: docLineAmount(item, doc.unit_price_formula), rate: 0,
    })), row.discount).filter(part => part.discount > 0).map(part => ({ ...part, category: "E", exemption: part.category })));
  const allowance = allowanceRows.map(row => `  <cac:AllowanceCharge>
    <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
    <cbc:AllowanceChargeReasonCode>100</cbc:AllowanceChargeReasonCode>
    <cbc:AllowanceChargeReason>Discount</cbc:AllowanceChargeReason>
    <cbc:Amount ${amt(row.discount, ccy)}</cbc:Amount>
    <cac:TaxCategory>
      <cbc:ID>${esc(row.category)}</cbc:ID>
${row.category === "E" ? "      <cbc:Percent>0</cbc:Percent>\n" : taxPercent(row.category, row.rate)}${row.exemption ? `      <cbc:TaxExemptionReasonCode>${esc(row.exemption)}</cbc:TaxExemptionReasonCode>\n` : ""}      <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
    </cac:TaxCategory>
  </cac:AllowanceCharge>\n`).join("");

  // PINT-AE ibr-141/124: only an earlier VAT point is specified; credit
  // notes must omit it. An equal supply/issue date needs no separate field.
  const taxPoint = root === "Invoice" && doc.date_of_supply && doc.date_of_supply < (doc.issue_date || "")
    ? `  <cbc:TaxPointDate>${esc(doc.date_of_supply)}</cbc:TaxPointDate>\n` : "";
  const exchangeRate = needAed ? `  <cac:TaxExchangeRate>
    <cbc:SourceCurrencyCode>${esc(ccy)}</cbc:SourceCurrencyCode>
    <cbc:TargetCurrencyCode>AED</cbc:TargetCurrencyCode>
    <cbc:CalculationRate>${decimal(aedRate)}</cbc:CalculationRate>
  </cac:TaxExchangeRate>\n` : "";
  // UBL CreditNote orders these elements differently from Invoice.
  const adjustments = root === "CreditNote" ? exchangeRate + allowance : allowance + exchangeRate;
  return `<?xml version="1.0" encoding="UTF-8"?>
<${root} xmlns="urn:oasis:names:specification:ubl:schema:xsd:${root}-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>${PINT_AE_SPEC_IDENTIFIER}</cbc:CustomizationID>
  <cbc:ProfileID>${PINT_AE_PROCESS_ID}</cbc:ProfileID>
  <cbc:ProfileExecutionID>${esc(doc.transaction_type || DEFAULT_TRANSACTION_TYPE)}</cbc:ProfileExecutionID>
  <cbc:ID>${esc(doc.number)}</cbc:ID>
  <cbc:UUID>${uuid}</cbc:UUID>
  <cbc:IssueDate>${esc(doc.issue_date)}</cbc:IssueDate>
${doc.due_date && root === "Invoice" ? `  <cbc:DueDate>${esc(doc.due_date)}</cbc:DueDate>\n` : ""}${root === "CreditNote" ? taxPoint : ""}  <cbc:${root}TypeCode>${esc(typeCode)}</cbc:${root}TypeCode>
${esc(doc.notes).trim() ? `  <cbc:Note>${esc(doc.notes)}</cbc:Note>\n` : ""}${root === "Invoice" ? taxPoint : ""}  <cbc:DocumentCurrencyCode>${esc(ccy)}</cbc:DocumentCurrencyCode>
${taxCurrencyCode}${root === "CreditNote" ? `  <cac:DiscrepancyResponse><cbc:ResponseCode>${esc(doc.einvoice?.credit_reason)}</cbc:ResponseCode></cac:DiscrepancyResponse>\n` : ""}${esc(doc.po_number).trim() ? `  <cac:OrderReference><cbc:ID>${esc(doc.po_number)}</cbc:ID></cac:OrderReference>\n` : ""}${billingRef}${needAed ? `  <cac:AdditionalDocumentReference>
    <cbc:ID>AED</cbc:ID><cbc:DocumentTypeCode>aedtotal-incl-vat</cbc:DocumentTypeCode>
    <cbc:DocumentDescription>${r2(t.taxInclusive * aedRate).toFixed(2)}</cbc:DocumentDescription>
  </cac:AdditionalDocumentReference>\n` : ""}${partyXml("AccountingSupplierParty", {
    name: doc.seller_name,
    trn: doc.seller_trn,
    legalId: doc.seller_legal_id || doc.einvoice?.seller?.legal_id,
    legalScheme: doc.seller_legal_id_type || doc.einvoice?.seller?.legal_id_type,
    street: doc.seller_address,
    city: doc.seller_city,
    emirate: doc.seller_country_subdivision,
    country: UAE_COUNTRY_CODE,
    identity: doc.einvoice?.seller,
    phone: doc.seller_phone?.trim() ? doc.seller_phone : doc.einvoice?.seller?.phone,
    email: doc.seller_email,
    taxRegistration: !doc.seller_trn?.trim() && isCommercialInvoice(typeCode) ? partyTin(doc.einvoice?.seller) : undefined,
  })}
${partyXml("AccountingCustomerParty", {
    name: doc.customer_name,
    trn: doc.customer_trn,
    street: doc.customer_address,
    city: doc.buyer_city,
    emirate: doc.buyer_country_subdivision,
    country: doc.buyer_country_code,
    identity: doc.einvoice?.buyer,
    phone: doc.einvoice?.buyer?.phone,
    email: doc.customer_email,
    legalId: doc.einvoice?.buyer?.legal_id,
    legalScheme: doc.einvoice?.buyer?.legal_id_type,
    endpoint: buyerEndpoint(doc.einvoice, doc.buyer_country_code || UAE_COUNTRY_CODE),
  })}
${doc.transaction_type?.[0] === "1" && doc.einvoice?.beneficiary_id ? `  <cac:BuyerCustomerParty><cac:Party><cac:PartyIdentification><cbc:ID>${esc(doc.einvoice.beneficiary_id.trim())}</cbc:ID></cac:PartyIdentification></cac:Party></cac:BuyerCustomerParty>\n` : ""}${doc.transaction_type?.[7] === "1" && doc.einvoice?.delivery ? `  <cac:Delivery><cac:DeliveryLocation><cac:Address>
    <cbc:StreetName>${esc(doc.einvoice.delivery.address)}</cbc:StreetName>
    <cbc:CityName>${esc(doc.einvoice.delivery.city)}</cbc:CityName>
    <cbc:CountrySubentity>${esc(doc.einvoice.delivery.region)}</cbc:CountrySubentity>
    <cac:Country><cbc:IdentificationCode>${esc(doc.einvoice.delivery.country_code)}</cbc:IdentificationCode></cac:Country>
  </cac:Address></cac:DeliveryLocation></cac:Delivery>\n` : ""}${doc.payment_means_code ? `  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>${esc(doc.payment_means_code)}</cbc:PaymentMeansCode>
${esc(doc.einvoice?.payment_account_id).trim() ? `    <cac:PayeeFinancialAccount>
      <cbc:ID>${esc(doc.einvoice?.payment_account_id)}</cbc:ID>
${esc(doc.einvoice?.payment_account_name).trim() ? `      <cbc:Name>${esc(doc.einvoice?.payment_account_name)}</cbc:Name>\n` : ""}    </cac:PayeeFinancialAccount>\n` : ""}
  </cac:PaymentMeans>\n` : ""}${esc(doc.terms).trim() ? `  <cac:PaymentTerms><cbc:Note>${esc(doc.terms)}</cbc:Note></cac:PaymentTerms>\n` : ""}${adjustments}  <cac:TaxTotal>
    <cbc:TaxAmount ${amt(t.taxTotal, ccy)}</cbc:TaxAmount>
    <cbc:TaxIncludedIndicator>false</cbc:TaxIncludedIndicator>
${taxSubtotals}
  </cac:TaxTotal>
${aedTaxTotal}  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount ${amt(t.lineExtension, ccy)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount ${amt(t.taxExclusive, ccy)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount ${amt(t.taxInclusive, ccy)}</cbc:TaxInclusiveAmount>
${t.discount > 0 ? `    <cbc:AllowanceTotalAmount ${amt(t.discount, ccy)}</cbc:AllowanceTotalAmount>\n` : ""}${t.prepaid ? `    <cbc:PrepaidAmount ${amt(t.prepaid, ccy)}</cbc:PrepaidAmount>\n` : ""}${t.rounding ? `    <cbc:PayableRoundingAmount ${amt(t.rounding, ccy)}</cbc:PayableRoundingAmount>\n` : ""}    <cbc:PayableAmount ${amt(t.payable, ccy)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${lines}
</${root}>`;
}
