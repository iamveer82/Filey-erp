import type { DocViewForm, DocViewItem } from "./DocView";
import {
  CREDIT_REASONS, LEGAL_ID_TYPES, EMIRATES, normalizeEmirate,
  TAX_CATEGORY_CODES, TAX_EXEMPTION_CODES, REVERSE_CHARGE_TYPES, type Code,
} from "../lib/einvoice";
import { computeTotals } from "../lib/einvoiceXml";
import { docLineAmount } from "../lib/docItems";
import { r2 } from "../lib/money";
import { isUaeRegime } from "../lib/taxRegimes";

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const joined = (...values: unknown[]) => values.map(text).filter(Boolean).join(" · ");
const label = (codes: Code[], value: unknown) => {
  const code = text(value);
  const description = codes.find(entry => entry.code === code)?.label;
  return code ? joined(code, description) : "";
};
const money = (value: number, currency = "AED") => Number.isFinite(value) ? `${value.toFixed(2)} ${currency}` : "";
const region = (value: unknown) => {
  const code = normalizeEmirate(text(value));
  return EMIRATES.find(entry => entry.code === code)?.label || text(value);
};

export function supportsInvoiceDetails(form: DocViewForm): boolean {
  return !["quotation", "quote", "purchase_order", "receipt", "payment_receipt"].includes(text(form.doc_type).toLowerCase().replace(/\s+/g, "_"))
    && isUaeRegime(text(form.currency) || "AED", text(form.tax_country_code) || undefined);
}

/** Compact text inherits the template's colors, including dark party headers.
 * Long entered values wrap naturally; no value is clipped or shortened. */
function DetailLines({ lines, kind }: { lines: string[]; kind: "seller" | "buyer" | "additional" }) {
  const populated = lines.filter(Boolean);
  if (!populated.length) return null;
  return <div data-invoice-details={kind} style={{ fontSize: 10, lineHeight: 1.35, marginTop: 4, color: "inherit", overflowWrap: "anywhere", whiteSpace: "pre-line" }}>
    {populated.map((line, index) => <div key={index} dir="auto">{line}</div>)}
  </div>;
}

/** Only explicitly saved identity values are printed. The XML exporter may
 * derive routing identifiers, but a readable invoice must not invent them. */
export function InvoicePartyLocation({ form, party }: { form: DocViewForm; party: "seller" | "buyer" }) {
  if (!supportsInvoiceDetails(form)) return null;
  const seller = party === "seller";
  const location = Array.from(new Set([
    text(seller ? form.seller_city : form.buyer_city),
    region(seller ? form.seller_country_subdivision : form.buyer_country_subdivision),
    seller ? "" : text(form.buyer_country_code),
  ].filter(Boolean))).join(" · ");
  return location ? <div data-invoice-location={party} dir="auto" style={{ overflowWrap: "anywhere", whiteSpace: "pre-line" }}>{location}</div> : null;
}

export function InvoicePartyDetails({ form, party }: { form: DocViewForm; party: "seller" | "buyer" }) {
  if (!supportsInvoiceDetails(form)) return null;
  const seller = party === "seller";
  const details = record(form.einvoice);
  const identity = record(details[party]);
  const legalId = seller ? text(form.seller_legal_id) || text(identity.legal_id) : text(identity.legal_id);
  const legalType = seller ? text(form.seller_legal_id_type) || text(identity.legal_id_type) : text(identity.legal_id_type);
  const legal = joined(legalId, label(LEGAL_ID_TYPES, legalType));
  const endpoint = joined(text(identity.endpoint_id), text(identity.endpoint_scheme) && `Scheme ${text(identity.endpoint_scheme)}`);
  const mode = seller ? "" : text(details.buyer_delivery_mode);
  const routing = mode === "export-unregistered" ? "Unregistered export recipient"
    : mode === "outside-uae-scope" ? "Outside UAE e-invoicing scope" : mode === "peppol" ? "Peppol recipient" : "";
  return <DetailLines kind={party} lines={[
    joined(text(identity.corporate_trn) && `Own FTA TRN: ${text(identity.corporate_trn)}`, text(identity.tin) && `TIN: ${text(identity.tin)}`),
    legal && `Legal registration: ${legal}`,
    text(identity.legal_authority) && `Authority: ${text(identity.legal_authority)}`,
    endpoint && `Electronic address: ${endpoint}`,
    joined(text(identity.identifier) && `${seller ? "Seller" : "Buyer"} ID: ${text(identity.identifier)}`, routing),
  ]} />;
}

function exchangeRate(form: DocViewForm): number | null {
  const rate = form.aed_exchange_rate ?? form.fx_rate;
  return text(form.currency) && text(form.currency) !== "AED" && typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : null;
}

export function InvoiceLineDetails({ form, item, omitTaxAmounts = false, hideTax = false }: { form: DocViewForm; item: DocViewItem; omitTaxAmounts?: boolean; hideTax?: boolean }) {
  if (!supportsInvoiceDetails(form)) return null;
  const custom = record(item.custom);
  const category = text(item.tax_category) || "S";
  const rate = category === "S" ? item.tax || form.tax_rate || 0 : 0;
  const taxDetail = category !== "S" || omitTaxAmounts && item.tax != null && item.tax !== form.tax_rate
    ? `VAT: ${joined(category === "S" ? "S · Standard rate" : label(TAX_CATEGORY_CODES, category), Number.isFinite(rate) ? `${rate}%` : "")}` : "";
  const aedRate = exchangeRate(form);
  const net = r2(docLineAmount(item, form.unit_price_formula));
  const tax = r2(net * rate / 100);
  const currency = text(form.currency) || "AED";
  const lineTax = aedRate ? money(r2(tax * aedRate)) : "";
  const itemType = text(custom.einvoice_item_type);
  const itemTypeLabel = itemType === "G" ? "Goods" : itemType === "S" ? "Services" : itemType === "B" ? "Goods and services" : itemType;
  const fields = [
    !hideTax && taxDetail,
    !hideTax && !omitTaxAmounts && Number.isFinite(tax) && Number.isFinite(rate) ? `VAT ${rate}%: ${money(tax, currency)}` : "",
    !hideTax && !omitTaxAmounts && Number.isFinite(net + tax) ? `Incl. VAT: ${money(r2(net + tax), currency)}` : "",
    itemType && `Type: ${itemTypeLabel}`,
    text(custom.einvoice_hs_code) && `HS: ${text(custom.einvoice_hs_code)}`,
    text(custom.einvoice_service_code) && `Service code: ${text(custom.einvoice_service_code)}`,
    !hideTax && text(custom.einvoice_exemption_code) && `VAT exemption: ${label(TAX_EXEMPTION_CODES, custom.einvoice_exemption_code)}`,
    !hideTax && text(custom.einvoice_nature) && `Reverse charge: ${label(REVERSE_CHARGE_TYPES, custom.einvoice_nature)}`,
    text(custom.einvoice_gtin) && `GTIN: ${text(custom.einvoice_gtin)}`,
    !hideTax && lineTax && `VAT in AED: ${lineTax}`,
  ].filter(Boolean);
  return fields.length ? <div data-invoice-details="line" dir="auto" style={{ fontSize: 10, lineHeight: 1.35, marginTop: 3, fontWeight: 400, color: "inherit", overflowWrap: "anywhere", whiteSpace: "pre-line" }}>{fields.join(" · ")}</div> : null;
}

type AdditionalField = "supplyDate" | "purchaseOrder" | "originalInvoice" | "paymentAccount" | "exchangeRate";
export function InvoiceAdditionalDetails({ form, omit = [], hideTax = false }: { form: DocViewForm; omit?: readonly AdditionalField[]; hideTax?: boolean }) {
  if (!supportsInvoiceDetails(form)) return null;
  const details = record(form.einvoice);
  const delivery = record(details.delivery);
  const supply = !omit.includes("supplyDate") && text(form.date_of_supply);
  const purchase = !omit.includes("purchaseOrder") && joined(form.po_number, form.po_date);
  const original = !omit.includes("originalInvoice") && joined(form.original_invoice_number, form.original_invoice_date);
  const account = !omit.includes("paymentAccount") && joined(details.payment_account_id, details.payment_account_name);
  const destination = joined(delivery.address, delivery.city, delivery.region, delivery.country_code);
  const aedRate = exchangeRate(form);
  const tax = aedRate ? money(r2(computeTotals({ ...form, number: text(form.number) }).taxTotal * aedRate)) : "";
  return <DetailLines kind="additional" lines={[
    joined(supply && `Supply date: ${supply}`, purchase && `Purchase order: ${purchase}`),
    joined(original && `Original invoice: ${original}`, text(details.credit_reason) && `Credit reason: ${label(CREDIT_REASONS, details.credit_reason)}`),
    destination && `Delivery: ${destination}`,
    text(details.beneficiary_id) && `Beneficiary TRN / TIN: ${text(details.beneficiary_id)}`,
    account ? `Payment account: ${account}` : "",
    joined(aedRate && !omit.includes("exchangeRate") ? `1 ${text(form.currency)} = ${aedRate} AED` : "", !hideTax && tax && `VAT total in AED: ${tax}`),
    text(details.uuid) && `Preparation UUID: ${text(details.uuid)}`,
  ]} />;
}
