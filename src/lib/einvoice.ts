// UAE Electronic Invoice (Peppol PINT-AE) — mandatory-field code lists & helpers.
//
// Ref: MoF Electronic Invoicing Guidelines v1.1 (1 June 2026), "UAE Electronic
// Invoice Mandatory Fields" v1.0 (23 Feb 2026), MD No. 243
// & 244 of 2025, and the Peppol PINT-AE specification. Values below are the
// standard code lists the FTA mandate is built on (UN/EDIFACT 1001, UN/ECE 4461,
// UN/ECE 5305, ISO 3166) plus the UAE-specific fixed values from the spec.
//
// This module is the single source of truth for those codes so the invoice
// forms and the PINT-AE 1.0.4 XML serializer stay consistent.

// --- Fixed UAE values (spec §4.1) ------------------------------------------

/** Peppol Electronic Address Scheme for a UAE TIN — fixed value (spec field 12). */
export const UAE_EAS_SCHEME = "0235";
/** ISO 3166-1 alpha-2 for the UAE (spec field 20) — default country. */
export const UAE_COUNTRY_CODE = "AE";
/** Tax scheme code — default value per spec fields 16 & 25. */
export const DEFAULT_TAX_SCHEME = "VAT";

// Constants the PINT-AE XML carries as fixed values (spec fields 7 & 8).
export const PINT_AE_SPEC_IDENTIFIER = "urn:peppol:pint:billing-1@ae-1";
export const PINT_AE_PROCESS_ID = "urn:peppol:bis:billing";

/** First ten digits of the entity's own FTA TRN (any tax type), per MoF's
 * June 2026 guidelines. Never derive it from a tax-group representative's TRN.
 * The historical helper/JSON field name remains compatible with saved drafts. */
export function tinFromCorporateTrn(trn?: string | null): string {
  const value = typeof trn === "string" ? trn.trim() : "";
  return /^\d{15}$/.test(value) ? value.slice(0, 10) : "";
}

export interface EInvoiceParty {
  /** Legacy key for the entity's own FTA TRN; it is not limited to Corporate Tax. */
  corporate_trn?: string;
  tin?: string;
  endpoint_id?: string;
  endpoint_scheme?: string;
  legal_id?: string;
  legal_id_type?: string;
  legal_authority?: string;
  identifier?: string;
}

/** Stored with the document, so identities survive offline saves and sync. */
export interface EInvoiceDetails {
  uuid?: string;
  seller?: EInvoiceParty | null;
  buyer?: EInvoiceParty | null;
  credit_reason?: string;
  payment_account_id?: string;
  payment_account_name?: string;
  beneficiary_id?: string;
  buyer_delivery_mode?: "peppol" | "export-unregistered" | "outside-uae-scope";
  delivery?: { address?: string; city?: string; region?: string; country_code?: string };
}

/** Recipient routing is an explicit choice, never inferred from an address. */
export function buyerEndpoint(details: EInvoiceDetails | undefined, country = UAE_COUNTRY_CODE) {
  const predefined = details?.buyer_delivery_mode === "export-unregistered" ? "9900000099"
    : details?.buyer_delivery_mode === "outside-uae-scope" ? "9900000098" : "";
  return { id: predefined || (typeof details?.buyer?.endpoint_id === "string" ? details.buyer.endpoint_id.trim() : "") || (country === UAE_COUNTRY_CODE ? partyTin(details?.buyer) : ""),
    scheme: predefined ? UAE_EAS_SCHEME : (typeof details?.buyer?.endpoint_scheme === "string" ? details.buyer.endpoint_scheme : "") || (country === UAE_COUNTRY_CODE ? UAE_EAS_SCHEME : "") };
}

export function partyTin(party?: EInvoiceParty | null): string {
  return (typeof party?.tin === "string" ? party.tin.trim() : "") || tinFromCorporateTrn(party?.corporate_trn);
}

export function readEInvoiceParty(value?: string): EInvoiceParty {
  try {
    const parsed: unknown = JSON.parse(value || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([key, entry]) =>
      ["corporate_trn", "tin", "endpoint_id", "endpoint_scheme", "legal_id", "legal_id_type", "legal_authority", "identifier"].includes(key) && typeof entry === "string"));
  } catch { return {}; }
}

export const CREDIT_REASONS: Code[] = [
  { code: "DL8.61.1.A", label: "Supply cancelled" },
  { code: "DL8.61.1.B", label: "Nature of supply changed" },
  { code: "DL8.61.1.C", label: "Agreed price changed" },
  { code: "DL8.61.1.D", label: "Goods or services returned" },
  { code: "DL8.61.1.E", label: "Tax charged in error" },
  { code: "VD", label: "Volume discount" },
];

// --- Code lists -------------------------------------------------------------

export type Code = { code: string; label: string };

/** Invoice type code — UN/EDIFACT 1001 subset used by Peppol (spec field 3). */
export const INVOICE_TYPE_CODES: Code[] = [
  { code: "380", label: "Tax invoice" },
  { code: "381", label: "Credit note" },
  { code: "383", label: "Debit note" },
  { code: "386", label: "Prepayment invoice" },
];
export const DEFAULT_INVOICE_TYPE_CODE = "380";
export const PINT_AE_INVOICE_TYPE_CODES: Code[] = [
  { code: "380", label: "Tax invoice" },
  { code: "480", label: "Commercial invoice (out of scope of VAT)" },
  { code: "381", label: "Tax credit note" },
  { code: "81", label: "Commercial credit note" },
];
export { isCreditNote } from "./money";
export const isCommercialInvoice = (type?: string | null) => type === "480" || type === "81";

/** Payment means type code — UN/ECE 4461 subset (spec field 9). */
export const PAYMENT_MEANS_CODES: Code[] = [
  { code: "10", label: "In cash" },
  { code: "30", label: "Credit transfer" },
  { code: "42", label: "Payment to bank account" },
  { code: "48", label: "Bank card" },
  { code: "49", label: "Direct debit" },
  { code: "54", label: "Credit card" },
  { code: "57", label: "Standing agreement" },
  { code: "1", label: "Instrument not defined" },
];
export const DEFAULT_PAYMENT_MEANS_CODE = "30";

/** Tax category code — UN/ECE 5305 as applied to UAE VAT (spec fields 37 & 46). */
export const TAX_CATEGORY_CODES: Code[] = [
  { code: "S", label: "Standard rate (5%)" },
  { code: "Z", label: "Zero-rated (0%)" },
  { code: "E", label: "Exempt" },
  { code: "O", label: "Out of scope" },
  { code: "AE", label: "Reverse charge" },
];
export const DEFAULT_TAX_CATEGORY = "S";

/** Human-readable explanations complement the mandatory UAE exemption codes. */
export const TAX_EXEMPTION_REASONS: Record<string, string> = {
  Z: "Zero-rated supply",
  E: "Exempt supply",
  O: "Outside scope of VAT",
  AE: "Reverse charge — VAT to be accounted for by the recipient",
};

/** PINT-AE 1.0.4 Aligned-TaxExemptionCodes and GoodsType codelists. */
export const TAX_EXEMPTION_CODES: Code[] = [
  { code: "DL8.46.1", label: "Certain financial services" },
  { code: "DL8.46.2", label: "Residential units (lease or sale)" },
  { code: "DL8.46.3", label: "Bare land" },
  { code: "DL8.46.4", label: "Local passenger transport" },
];
export const REVERSE_CHARGE_TYPES: Code[] = [
  { code: "DL8.48.8.2", label: "Electronic devices" },
  { code: "DL8.48.8.1", label: "Gold and diamonds" },
  { code: "DL8.48.3.1", label: "Crude or refined oil" },
  { code: "DL8.48.3.2", label: "Natural gas" },
  { code: "DL8.48.3.3", label: "Pure hydrocarbons" },
];

/** Invoice-type codes that reference a prior invoice (need BillingReference). */
export const CORRECTIVE_TYPE_CODES = ["381", "81", "383"];

/** Seller/Buyer legal-registration identifier type — spec fields 14 & 25. */
export const LEGAL_ID_TYPES: Code[] = [
  { code: "TL", label: "Commercial / Trade license" },
  { code: "EID", label: "Emirates ID" },
  { code: "PAS", label: "Passport" },
  { code: "CD", label: "Cabinet Decision" },
];

/** Country subdivision — emirate codes (spec fields 19 & 28).
 *  PINT-AE uses 3-letter codes for cbc:CountrySubentity (enforced by Schematron
 *  ibr-143/144-ae), NOT ISO 3166-2 "AE-xx". See docs/pint-ae. */
export const EMIRATES: Code[] = [
  { code: "AUH", label: "Abu Dhabi" },
  { code: "DXB", label: "Dubai" },
  { code: "SHJ", label: "Sharjah" },
  { code: "AJM", label: "Ajman" },
  { code: "UAQ", label: "Umm Al Quwain" },
  { code: "RAK", label: "Ras Al Khaimah" },
  { code: "FUJ", label: "Fujairah" },
];

/** Map a legacy ISO 3166-2 "AE-xx" emirate to the PINT-AE 3-letter code.
 *  Passes any other value through unchanged. Belt-and-suspenders for rows saved
 *  before the code-list switch (esp. local SQLite, which the SQL migration can't
 *  reach). See supabase/2026-06-25-emirate-code-remap.sql. */
const EMIRATE_LEGACY: Record<string, string> = {
  "AE-AZ": "AUH",
  "AE-DU": "DXB",
  "AE-SH": "SHJ",
  "AE-AJ": "AJM",
  "AE-UQ": "UAQ",
  "AE-RK": "RAK",
  "AE-FU": "FUJ",
};
export const normalizeEmirate = (c?: string | null): string =>
  (c && EMIRATE_LEGACY[c.toUpperCase()]) || c || "";

// --- Invoice transaction type code: 8-flag bitstring (spec field 5) ---------
// Fixed order per spec §4.1. Each flag is "1" (applicable) / "0" (not).
export const TRANSACTION_TYPE_FLAGS: { key: string; label: string }[] = [
  { key: "freeZone", label: "Free Trade zone" },
  { key: "deemedSupply", label: "Deemed Supply" },
  { key: "marginScheme", label: "Margin Scheme" },
  { key: "summaryInvoice", label: "Summary Invoice" },
  { key: "continuousSupply", label: "Continuous Supply" },
  { key: "disclosedAgent", label: "Disclosed Agent Billing" },
  { key: "ecommerce", label: "Supply through e-commerce" },
  { key: "exports", label: "Exports" },
];
export const DEFAULT_TRANSACTION_TYPE = "00000000";

/** Decode the 8-char bitstring into a { flagKey: boolean } map. */
export function decodeTransactionType(s?: string | null): Record<string, boolean> {
  const bits = (s ?? DEFAULT_TRANSACTION_TYPE).padEnd(8, "0");
  const out: Record<string, boolean> = {};
  TRANSACTION_TYPE_FLAGS.forEach((f, i) => (out[f.key] = bits[i] === "1"));
  return out;
}

/** Encode a { flagKey: boolean } map back into the 8-char bitstring. */
export function encodeTransactionType(flags: Record<string, boolean>): string {
  return TRANSACTION_TYPE_FLAGS.map((f) => (flags[f.key] ? "1" : "0")).join("");
}

// ponytail: tiny self-check — round-trip + ordering. Run with
//   npx tsx src/lib/einvoice.ts   (or import in a test). Throws if logic breaks.
if (typeof process !== "undefined" && process.env.EINVOICE_SELFTEST) {
  const flags = decodeTransactionType("10000001");
  console.assert(flags.freeZone === true && flags.exports === true, "decode ends");
  console.assert(
    flags.deemedSupply === false && flags.ecommerce === false,
    "decode middle"
  );
  console.assert(
    encodeTransactionType(flags) === "10000001",
    "encode round-trips"
  );
  console.assert(tinFromCorporateTrn("100123456700003") === "1001234567", "corporate TIN = first 10");
  console.assert(encodeTransactionType({}) === DEFAULT_TRANSACTION_TYPE, "empty = zeros");
  console.log("einvoice self-check passed");
}
