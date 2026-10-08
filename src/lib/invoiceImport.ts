import type { InvoiceDocInput } from "./api";
import codes from "./einvoiceCodes.json";
import { mergeItemMeta } from "./docItems";
import { r2 } from "./money";
import { normalizeEmirate, TAX_CATEGORY_CODES, UAE_EAS_SCHEME, type EInvoiceParty } from "./einvoice";

export function invoiceImportIssues(doc: InvoiceDocInput, existing: Set<string>): string[] {
  const errors: string[] = [];
  if (!doc.number.trim()) errors.push("Enter an invoice number.");
  if (existing.has(doc.number.trim().toLowerCase())) errors.push("This invoice number already exists. It will not be overwritten.");
  if (!doc.customer_name.trim()) errors.push("Enter the customer or supplier name.");
  for (const [label, date] of [["invoice", doc.issue_date || ""], ["due", doc.due_date || ""]]) {
    if (label === "due" && !date) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) errors.push(`Use a valid ${label} date (YYYY-MM-DD).`);
  }
  if (!codes.currencies.includes(doc.currency)) errors.push("Choose a supported currency code.");
  if (!doc.items.length || doc.items.length > 500) errors.push("Use between 1 and 500 line items.");
  doc.items.forEach((item, index) => {
    if (!item.description.trim()) errors.push(`Item ${index + 1}: add a description.`);
    if (!Number.isFinite(item.qty) || item.qty <= 0 || !Number.isFinite(item.unit_price) || item.unit_price < 0) errors.push(`Item ${index + 1}: enter a positive quantity and non-negative price.`);
    if (!TAX_CATEGORY_CODES.some(category => category.code === (item.tax_category || "S"))) errors.push(`Item ${index + 1}: choose a supported tax category.`);
  });
  return errors;
}

/** Repeated invoice numbers represent lines. Conflicting headers must be fixed
 * in the source, rather than silently assigning a line to the wrong customer. */
export function groupInvoiceRows(rows: Record<string, unknown>[], base: InvoiceDocInput): InvoiceDocInput[] {
  const groups = new Map<string, InvoiceDocInput>();
  for (const [index, row] of rows.entries()) {
    const text = (key: string) => String(row[key] ?? "").trim();
    const number = text("number");
    const key = number.toLowerCase() || `missing:${index}`;
    const doc = groups.get(key) || { ...base, id: undefined, status: "draft", number,
      customer_name: text("customer_name"), issue_date: text("issue_date"),
      currency: text("currency").toUpperCase() || base.currency,
      customer_trn: text("customer_trn"), customer_address: text("customer_address"),
      due_date: text("due_date") || undefined, items: [],
      einvoice: { seller: base.einvoice?.seller } };
    for (const field of ["customer_name", "issue_date", "currency", "customer_trn", "customer_address", "due_date"] as const) {
      if (text(field) && text(field).toLowerCase() !== (doc[field] || "").toLowerCase()) throw new Error(`Invoice ${number}: its rows have different ${field.replace(/_/g, " ")}. Correct the source file first.`);
    }
    doc.items.push({ description: text("description"), qty: text("qty") ? Number(text("qty")) : NaN,
      unit_price: text("unit_price") ? Number(text("unit_price")) : NaN,
      unit: text("unit") || undefined, tax_category: text("tax_category").toUpperCase() || "S" });
    groups.set(key, doc);
  }
  return [...groups.values()];
}

/** Read a UBL supplier invoice into a reviewable purchase draft. Unknown XML is
 * never executed; DTDs/entities and adjustments we cannot preserve are rejected. */
export function readSupplierInvoice(xml: string, base: InvoiceDocInput): InvoiceDocInput {
  if (base.tax_country_code && base.tax_country_code !== "AE") throw new Error("Supplier XML import currently supports UAE workspaces. Use Excel or CSV for this workspace.");
  if (xml.length > 5 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Choose a UBL invoice without embedded XML entities, smaller than 5 MB.");
  const parsed = new DOMParser().parseFromString(xml, "application/xml");
  const root = parsed.documentElement;
  if (parsed.querySelector("parsererror") || root.localName !== "Invoice" || root.namespaceURI !== "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2") throw new Error("Choose a UBL supplier invoice XML file.");
  const ns = { cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2", cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" };
  const aggregates = new Set(["AccountingSupplierParty", "Party", "PartyIdentification", "PartyLegalEntity", "PartyTaxScheme", "TaxScheme", "PostalAddress", "AddressLine", "Country", "Contact", "Item", "Price", "ClassifiedTaxCategory", "LegalMonetaryTotal", "TaxExchangeRate", "TaxTotal"]);
  const children = (node: Element, name: string) => [...node.children].filter(el => el.localName === name && el.namespaceURI === ns[aggregates.has(name) ? "cac" : "cbc"]);
  const child = (node: Element, name: string) => children(node, name)[0];
  const read = (node: Element, ...path: string[]): string => {
    let current: Element | undefined = node;
    for (const name of path) current = current && child(current, name);
    return current?.textContent?.trim() || "";
  };
  const numeric = (value: string, label: string) => { const n = Number(value); if (!value || !Number.isFinite(n)) throw new Error(`The supplier invoice has an invalid ${label}.`); return n; };
  const party = child(child(root, "AccountingSupplierParty") || root, "Party");
  if (!party) throw new Error("The supplier identity is missing.");
  const taxIdentities = children(party, "PartyTaxScheme");
  const vatIdentity = taxIdentities.find(el => read(el, "TaxScheme", "ID") === "VAT");
  const tinIdentity = taxIdentities.find(el => read(el, "TaxScheme", "ID") === "TIN");
  const endpoint = child(party, "EndpointID");
  const endpointId = endpoint?.textContent?.trim() || "";
  const endpointScheme = endpoint?.getAttribute("schemeID")?.trim() || "";
  const legal = child(party, "PartyLegalEntity");
  const legalId = legal && child(legal, "CompanyID");
  const identity: EInvoiceParty = {
    endpoint_id: endpointId, endpoint_scheme: endpointScheme,
    // A VAT-group TRN does not establish the supplier's own entity TIN.
    tin: tinIdentity ? read(tinIdentity, "CompanyID") : endpointScheme === UAE_EAS_SCHEME && /^\d{10}$/.test(endpointId) ? endpointId : "",
    identifier: read(party, "PartyIdentification", "ID"),
    legal_id: legalId?.textContent?.trim() || "",
    legal_id_type: legalId?.getAttribute("schemeAgencyID")?.trim() || legalId?.getAttribute("schemeID")?.trim() || "",
    legal_authority: legalId?.getAttribute("schemeAgencyName")?.trim() || "",
    phone: read(party, "Contact", "Telephone"),
  };
  const address = child(party, "PostalAddress");
  const country = read(party, "PostalAddress", "Country", "IdentificationCode");
  const region = read(party, "PostalAddress", "CountrySubentity");
  if ([...root.children].some(el => el.localName === "AllowanceCharge" && el.namespaceURI === ns.cac)) throw new Error("This supplier invoice has document adjustments. Use the purchase editor to enter these before saving; they cannot be silently dropped.");
  const items = [...root.children].filter(el => el.localName === "InvoiceLine" && el.namespaceURI === ns.cac).map(line => {
    const net = numeric(read(line, "LineExtensionAmount"), "line amount");
    const qty = numeric(read(line, "InvoicedQuantity"), "quantity");
    const category = read(line, "Item", "ClassifiedTaxCategory", "ID");
    const rate = Number(read(line, "Item", "ClassifiedTaxCategory", "Percent"));
    if (!["S", "Z", "E", "O", "AE"].includes(category) || !Number.isFinite(rate) || (category === "S" && rate !== 5)) throw new Error("This supplier invoice uses a tax treatment that needs manual review.");
    return { description: read(line, "Item", "Description") || read(line, "Item", "Name"), qty,
      unit_price: qty > 0 ? net / qty : 0, unit: child(line, "InvoicedQuantity")?.getAttribute("unitCode") || "C62",
      tax_category: category, custom: mergeItemMeta({ calcMode: "manual", amount: net }) };
  });
  const total = numeric(read(root, "LegalMonetaryTotal", "TaxInclusiveAmount"), "total");
  if (Number(read(root, "LegalMonetaryTotal", "PrepaidAmount")) || Number(read(root, "LegalMonetaryTotal", "PayableRoundingAmount"))) throw new Error("This supplier invoice includes prepayments or rounding. Record it in the purchase editor so its payment details are preserved.");
  const tax = r2(items.filter(item => item.tax_category === "S").reduce((sum, item) => sum + item.qty * item.unit_price * .05, 0));
  const expected = r2(items.reduce((sum, item) => sum + item.qty * item.unit_price, 0) + tax);
  if (Math.abs(total - expected) > .005) throw new Error("The supplier totals do not reconcile with its lines. Review the original invoice before recording it.");
  const currency = read(root, "DocumentCurrencyCode");
  let exchangeRate: number | null = null;
  if (currency !== "AED") {
    const rates = children(root, "TaxExchangeRate");
    const taxCurrency = read(root, "TaxCurrencyCode");
    if (rates.length !== 1 || read(rates[0], "SourceCurrencyCode") !== currency || read(rates[0], "TargetCurrencyCode") !== "AED" || (taxCurrency && taxCurrency !== "AED"))
      throw new Error("This foreign-currency supplier invoice needs its original exchange rate to AED. Enter it in the purchase editor; today's rate cannot replace it.");
    exchangeRate = numeric(read(rates[0], "CalculationRate"), "AED exchange rate");
    if (exchangeRate <= 0 || Number(exchangeRate.toFixed(6)) !== exchangeRate)
      throw new Error("The supplier invoice needs a positive AED exchange rate with at most six decimal places.");
    if (![total * exchangeRate, tax * exchangeRate].every(amount => Number.isFinite(amount) && Number.isSafeInteger(Math.round(amount * 100))))
      throw new Error("The supplier's AED amounts are too large to record accurately.");
    const aedTax = children(root, "TaxTotal").map(node => child(node, "TaxAmount")).filter(node => node?.getAttribute("currencyID") === "AED");
    if (aedTax.length > 1 || (aedTax.length && Math.abs(numeric(aedTax[0]!.textContent?.trim() || "", "AED VAT total") - r2(tax * exchangeRate)) > .005))
      throw new Error("The supplier's AED VAT total does not match its exchange rate. Review the original invoice before recording it.");
  }
  return { ...base, id: undefined, status: "draft", doc_type: "purchase", number: read(root, "ID"), issue_date: read(root, "IssueDate"),
    due_date: read(root, "DueDate") || undefined, currency, fx_rate: exchangeRate, aed_exchange_rate: exchangeRate, tax_rate: 5, discount: 0,
    customer_id: undefined,
    customer_name: read(party, "PartyLegalEntity", "RegistrationName"), customer_trn: vatIdentity ? read(vatIdentity, "CompanyID") : "",
    customer_address: [read(party, "PostalAddress", "StreetName"), read(party, "PostalAddress", "AdditionalStreetName"), ...(address ? children(address, "AddressLine").map(line => read(line, "Line")) : [])].filter(Boolean).join(", "),
    customer_email: read(party, "Contact", "ElectronicMail"), buyer_city: read(party, "PostalAddress", "CityName"),
    buyer_country_code: country, buyer_country_subdivision: country === "AE" ? normalizeEmirate(region) : region,
    // Purchase documents store our company as seller and the supplier in the
    // counterparty fields, just like the purchase editor. Do not reuse either
    // source document's UUID or an unrelated recipient from the base form.
    einvoice: { seller: base.einvoice?.seller ? { ...base.einvoice.seller } : undefined, buyer: identity },
    notes: `Imported supplier invoice. Original amount including VAT: ${total}. Review before posting.`, items };
}
