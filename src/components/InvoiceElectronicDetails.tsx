import type { DocViewForm } from "./DocView";
import {
  buyerEndpoint, partyTin, UAE_EAS_SCHEME, PINT_AE_SPEC_IDENTIFIER, PINT_AE_PROCESS_ID,
  PINT_AE_INVOICE_TYPE_CODES, PAYMENT_MEANS_CODES, CREDIT_REASONS, LEGAL_ID_TYPES,
  EMIRATES, normalizeEmirate, decodeTransactionType, TRANSACTION_TYPE_FLAGS,
  TAX_CATEGORY_CODES, TAX_EXEMPTION_CODES, REVERSE_CHARGE_TYPES, readEInvoiceParty, type Code, type EInvoiceParty, type EInvoiceDetails,
} from "../lib/einvoice";
import { computeTotals, unitCode } from "../lib/einvoiceXml";
import { docLineAmount } from "../lib/docItems";
import { r2 } from "../lib/money";
import { isUaeRegime } from "../lib/taxRegimes";

export interface ElectronicDetailRow { label: string; value: string; section?: boolean }
export const ELECTRONIC_DETAIL_ROWS_PER_PAGE = 39;
export const ELECTRONIC_DETAIL_ROW_HEIGHT = 22;
const label = (codes: Code[], value?: string | null) => typeof value === "string" && value ? `${value}${codes.find(entry => entry.code === value) ? ` · ${codes.find(entry => entry.code === value)!.label}` : ""}` : "";
const text = (value: unknown) => typeof value === "string" || typeof value === "number" && Number.isFinite(value) ? String(value).trim() : "";
const joined = (...values: unknown[]) => values.map(text).filter(Boolean).join(" · ");
const amount = (value: number, currency: string) => Number.isFinite(value) ? `${value.toFixed(2)} ${currency}` : "";

/** Fixed-size continuation rows avoid depending on a template's remaining
 * space. The conservative character budget also handles long unbroken IDs,
 * addresses and non-Latin text without throwing away any characters. */
function wrapValue(value: string): string[] {
  const result: string[] = [];
  let line = "", width = 0;
  const size = (character: string) => character === "\n" ? 0 : character === "\t" ? 40
    : character.codePointAt(0)! > 255 ? 12 : /[MWmw@#%&]/.test(character) ? 10 : /[ilI.,:;'!| ]/.test(character) ? 3.5 : /[A-Z]/.test(character) ? 8 : 6.5;
  for (const token of value.match(/\S+[^\S\n]*\n?|[^\S\n]+|\n/gu) || []) {
    const tokenWidth = Array.from(token).reduce((sum, character) => sum + size(character), 0);
    if (line && width + tokenWidth > 470) { result.push(line); line = ""; width = 0; }
    for (const character of Array.from(token)) {
      const weight = size(character);
      if (width + weight > 470 && line) { result.push(line); line = ""; width = 0; }
      line += character;
      width += weight;
      if (character === "\n") { result.push(line); line = ""; width = 0; }
    }
  }
  if (line) result.push(line);
  return result;
}

/** Human-readable projection of the same saved fields and calculations used
 * by PINT-AE XML. This is a document supplement, not a submission certificate. */
export function invoiceElectronicDetailPages(form: DocViewForm): ElectronicDetailRow[][] {
  // Saved invoices also use display types such as "Tax Invoice" and "sales".
  // Exclude actual other documents, not those established invoice variants.
  if (["quotation", "quote", "purchase_order", "receipt", "payment_receipt"].includes(text(form.doc_type).toLowerCase().replace(/\s+/g, "_")) || !isUaeRegime(form.currency || "AED", form.tax_country_code)) return [];
  const rows: ElectronicDetailRow[] = [];
  const add = (name: string, value: unknown) => {
    const valueText = text(value);
    if (!valueText) return;
    wrapValue(valueText).forEach((part, index) => rows.push({ label: index ? "" : name, value: part }));
  };
  const section = (name: string) => rows.push({ label: name, value: "", section: true });
  // Public share data and old imports can predate today's JSON shape. Only
  // known strings may become official identifiers or reach string helpers.
  const raw = form.einvoice;
  const details: EInvoiceDetails = {
    ...Object.fromEntries(["uuid", "credit_reason", "payment_account_id", "payment_account_name", "beneficiary_id", "buyer_delivery_mode"].flatMap(key => {
      const value = raw?.[key as keyof EInvoiceDetails];
      return typeof value === "string" ? [[key, value]] : [];
    })),
    seller: readEInvoiceParty(JSON.stringify(raw?.seller)), buyer: readEInvoiceParty(JSON.stringify(raw?.buyer)),
    delivery: Object.fromEntries(Object.entries(raw?.delivery && typeof raw.delivery === "object" ? raw.delivery : {}).filter(([, value]) => typeof value === "string")),
  };
  const hasIdentity = [details.seller, details.buyer].some(party => Object.values(party || {}).some(value => !!text(value)));
  const hasLineDetails = (item: DocViewForm["items"][number]) => !!item.tax_category && item.tax_category !== "S"
    || item.tax != null && item.tax !== form.tax_rate
    || Object.entries(item.custom || {}).some(([key, value]) => key.startsWith("einvoice_") && !!text(value));
  const hasExtraFields = hasIdentity || [details.credit_reason, details.payment_account_id, details.payment_account_name, details.beneficiary_id, details.buyer_delivery_mode,
    ...Object.values(details.delivery || {}), form.date_of_supply, form.po_number, form.po_date, form.original_invoice_number, form.original_invoice_date,
    form.seller_city, form.seller_country_subdivision, form.seller_legal_id, form.seller_legal_id_type, form.buyer_city, form.buyer_country_subdivision,
    form.buyer_country_code && form.buyer_country_code !== "AE" ? form.buyer_country_code : "",
    form.currency && form.currency !== "AED" ? form.aed_exchange_rate ?? form.fx_rate : ""].some(value => !!text(value))
    || !!form.invoice_type_code && form.invoice_type_code !== "380"
    || /1/.test(form.transaction_type || "") || form.items.some(hasLineDetails);
  if (!hasExtraFields) return [];
  const ccy = form.currency || "AED";
  const aedRate = form.aed_exchange_rate ?? form.fx_rate;
  const foreign = ccy !== "AED" && typeof aedRate === "number" && Number.isFinite(aedRate) && aedRate > 0;
  const flags = decodeTransactionType(form.transaction_type);
  section("Invoice references");
  add("Invoice number", form.number);
  add("Invoice type / currency", joined(label(PINT_AE_INVOICE_TYPE_CODES, form.invoice_type_code), ccy));
  add("Issue / supply / due date", joined(form.issue_date, form.date_of_supply && `Supply: ${form.date_of_supply}`, form.due_date && `Due: ${form.due_date}`));
  add("Purchase order", joined(form.po_number, form.po_date));
  add("Original invoice", joined(form.original_invoice_number, form.original_invoice_date));
  add("Credit note reason", label(CREDIT_REASONS, details?.credit_reason));
  if (/1/.test(form.transaction_type || "")) add("Transaction type", joined(form.transaction_type, ...TRANSACTION_TYPE_FLAGS.filter(flag => flags[flag.key]).map(flag => flag.label)));
  if (hasIdentity) {
    add("UUID", details.uuid);
    add("Specification identifier", PINT_AE_SPEC_IDENTIFIER);
    add("Business process", PINT_AE_PROCESS_ID);
  }

  const party = (kind: "Seller" | "Buyer", identity?: EInvoiceParty | null) => {
    const seller = kind === "Seller";
    const hasParty = [...Object.values(identity || {}), ...(seller
      ? [form.seller_name, form.seller_address, form.seller_city, form.seller_country_subdivision, form.seller_trn, form.seller_legal_id, form.seller_email, form.seller_phone]
      : [form.customer_name, form.customer_address, form.buyer_city, form.buyer_country_subdivision, form.buyer_country_code, form.customer_trn, form.customer_email])].some(value => !!text(value));
    if (!hasParty) return;
    section(kind);
    add("Legal name", seller ? form.seller_name : form.customer_name);
    add("Street address", seller ? form.seller_address : form.customer_address);
    add("City / region / country", joined(seller ? form.seller_city : form.buyer_city,
      label(EMIRATES, normalizeEmirate(seller ? form.seller_country_subdivision : form.buyer_country_subdivision)),
      seller ? "AE" : form.buyer_country_code));
    add("VAT registration", (seller ? form.seller_trn : form.customer_trn) ? joined(seller ? form.seller_trn : form.customer_trn, "Scheme: VAT") : "");
    add("Entity tax identity", joined(identity?.corporate_trn && `Own FTA TRN: ${identity.corporate_trn}`, partyTin(identity) && `TIN: ${partyTin(identity)}`));
    add("Party identifier", identity?.identifier);
    const endpoint = seller
      ? { id: identity?.endpoint_id?.trim() || partyTin(identity), scheme: identity?.endpoint_scheme || UAE_EAS_SCHEME }
      : buyerEndpoint(details, form.buyer_country_code || "AE");
    if (endpoint.id) add("Electronic address", joined(endpoint.id, `Scheme: ${endpoint.scheme}`));
    add("Legal registration", joined((seller ? form.seller_legal_id : "") || identity?.legal_id,
      label(LEGAL_ID_TYPES, (seller ? form.seller_legal_id_type : "") || identity?.legal_id_type)));
    add("Registration authority", identity?.legal_authority);
    add("Email", seller ? form.seller_email : form.customer_email);
    if (seller) add("Phone", form.seller_phone);
  };
  party("Seller", details?.seller);
  party("Buyer", details?.buyer);
  add("Recipient routing", details?.buyer_delivery_mode === "export-unregistered" ? "Unregistered export recipient"
    : details?.buyer_delivery_mode === "outside-uae-scope" ? "Outside UAE e-invoicing scope"
      : details?.buyer_delivery_mode === "peppol" ? "Peppol recipient" : "");
  if (details.beneficiary_id || Object.values(details.delivery || {}).some(Boolean)) {
    section("Delivery and beneficiary");
    add("Beneficiary TRN / TIN", details?.beneficiary_id);
    add("Delivery street", details?.delivery?.address);
    add("Delivery city / region", joined(details?.delivery?.city, details?.delivery?.region));
    add("Delivery country", details?.delivery?.country_code);
  }
  section("Payment and tax totals");
  add("Payment means", label(PAYMENT_MEANS_CODES, form.payment_means_code));
  add("Bank account / IBAN", details?.payment_account_id);
  add("Account name", details?.payment_account_name);
  add("Payment terms", form.terms);
  if (foreign) add("AED exchange rate", `1 ${ccy} = ${aedRate} AED`);
  const totals = computeTotals({ ...form, number: form.number || "" });
  if (hasIdentity) {
    add("Line net / discount", joined(`Net: ${amount(totals.lineExtension, ccy)}`, `Discount: ${amount(totals.discount, ccy)}`));
    add("Total excluding VAT", amount(totals.taxExclusive, ccy));
    add("VAT total", amount(totals.taxTotal, ccy));
    if (foreign) add("VAT total in AED", amount(r2(totals.taxTotal * aedRate), "AED"));
    add("Total including VAT", amount(totals.taxInclusive, ccy));
    if (foreign) add("Total including VAT in AED", amount(r2(totals.taxInclusive * aedRate), "AED"));
    add("Advance / rounding", joined(`Advance: ${amount(totals.prepaid, ccy)}`, `Rounding: ${amount(totals.rounding, ccy)}`));
    add("Amount due", amount(totals.payable, ccy));
    for (const row of totals.rows) {
      add("VAT breakdown", joined(label(TAX_CATEGORY_CODES, row.category), `${row.rate}%`,
        `Taxable: ${amount(row.taxable, ccy)}`, `VAT: ${amount(row.tax, ccy)}`));
    }
  }

  form.items.forEach((item, index) => {
    const custom = item.custom;
    if (!hasIdentity && !hasLineDetails(item)) return;
    section(`Line ${index + 1}`);
    add("Item name / description", item.description);
    add("Quantity / unit / price", joined(item.qty, item.unit, unitCode(item.unit), Number.isFinite(item.unit_price) ? `Entered price: ${item.unit_price} ${ccy}` : ""));
    const formula = item.calcMode === "manual" ? null : item.calcMode === "formula" && item.itemFormula?.a ? item.itemFormula : form.unit_price_formula;
    if (formula?.a && formula.a !== "qty") add("Calculation basis", joined(form.customColumns?.find(column => column.key === formula.a)?.label || formula.a, custom?.[formula.a], `× ${item.unit_price} ${ccy}`));
    const net = r2(docLineAmount(item, form.unit_price_formula));
    const category = item.tax_category || "S";
    const rate = category === "S" ? item.tax || form.tax_rate || 0 : 0;
    const tax = r2(net * rate / 100);
    if (hasIdentity && Number.isFinite(net) && item.qty > 0) add("XML unit price", `Gross / net: ${(net / item.qty).toFixed(6)} ${ccy} · Base: 1 ${unitCode(item.unit) || item.unit || "unit"} · Price discount: 0`);
    add("Line amounts", joined(`Net: ${amount(net, ccy)}`, `VAT: ${amount(tax, ccy)}`, `Incl. VAT: ${amount(r2(net + tax), ccy)}`));
    if (foreign) add("Line including VAT in AED", amount(r2((net + tax) * aedRate), "AED"));
    if (foreign) add("Line VAT in AED", amount(r2(tax * aedRate), "AED"));
    add("Tax category / rate", joined(label(TAX_CATEGORY_CODES, category), `${rate}%`, "VAT"));
    if (item.discount) add("Line discount", `${item.discount}%`);
    add("Item type", custom?.einvoice_item_type && ({ G: "G · Goods", S: "S · Services", B: "B · Goods and services" }[custom.einvoice_item_type] || custom.einvoice_item_type));
    add("HS classification", custom?.einvoice_hs_code);
    add("Service accounting code", custom?.einvoice_service_code);
    add("VAT exemption reason", label(TAX_EXEMPTION_CODES, custom?.einvoice_exemption_code));
    add("Reverse-charge nature", label(REVERSE_CHARGE_TYPES, custom?.einvoice_nature));
    add("GTIN", custom?.einvoice_gtin);
  });
  // Optional fields never leave empty section headings in a partially filled invoice.
  const populatedRows = rows.filter((row, index) => !row.section || !!rows[index + 1] && !rows[index + 1].section);
  const pages: ElectronicDetailRow[][] = [];
  for (let i = 0; i < populatedRows.length;) {
    let end = Math.min(populatedRows.length, i + ELECTRONIC_DETAIL_ROWS_PER_PAGE);
    if (populatedRows[end - 1]?.section && end < populatedRows.length) end--;
    pages.push(populatedRows.slice(i, end));
    i = end;
  }
  return pages;
}

export function InvoiceElectronicDetailsPage({ rows, pageNumber, pageCount, invoiceNumber }: {
  rows: ElectronicDetailRow[]; pageNumber: number; pageCount: number; invoiceNumber?: string | null;
}) {
  return <section data-einvoice-details style={{ color: "#171717", fontFamily: "Arial, sans-serif", width: 698 }}>
    <header style={{ height: 86, borderBottom: "1px solid #d4d4d4", boxSizing: "border-box" }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>Electronic invoice details</h2>
      <p style={{ fontSize: 10, lineHeight: "15px", color: "#525252", margin: 0 }}>Readable supporting details. Electronic submission uses the structured XML through your accredited provider.</p>
    </header>
    <dl style={{ margin: "12px 0", padding: 0 }}>
      {rows.map((row, index) => <div key={index} data-einvoice-detail-row style={{
        height: ELECTRONIC_DETAIL_ROW_HEIGHT, boxSizing: "border-box", display: "grid", gridTemplateColumns: "190px 1fr", gap: 12,
        fontSize: 10, lineHeight: "14px", padding: "4px 0", borderBottom: row.section ? "1px solid #d4d4d4" : undefined,
      }}>
        <dt style={{ margin: 0, fontWeight: row.section ? 700 : 400, color: row.section ? "#171717" : "#525252" }}>{row.label}</dt>
        <dd dir="auto" style={{ margin: 0, whiteSpace: "pre", tabSize: 4 }}>{row.value.replace(/\n$/, "")}</dd>
      </div>)}
    </dl>
    <footer style={{ fontSize: 10, color: "#737373", paddingTop: 8, display: "flex", justifyContent: "space-between", gap: 16 }}>
      <span>Electronic details · {pageNumber} / {pageCount}</span>
      <span style={{ maxWidth: 470, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{text(invoiceNumber)}</span>
    </footer>
  </section>;
}
