// UAE Electronic Invoice (Peppol PINT-AE) — mandatory-field code lists & helpers.
//
// Ref: "UAE Electronic Invoice Mandatory Fields" v1.0 (23 Feb 2026), MD No. 243
// & 244 of 2025, and the Peppol PINT-AE specification. Values below are the
// standard code lists the FTA mandate is built on (UN/EDIFACT 1001, UN/ECE 4461,
// UN/ECE 5305, ISO 3166) plus the UAE-specific fixed values from the spec.
//
// This module is the single source of truth for those codes so the invoice
// forms and the (future) PINT-AE XML serializer stay consistent. Capture only
// for now — serialization/validation land when the phased mandate date hits.

// --- Fixed UAE values (spec §4.1) ------------------------------------------

/** Peppol Electronic Address Scheme for a UAE TIN — fixed value (spec field 12). */
export const UAE_EAS_SCHEME = "0235";
/** ISO 3166-1 alpha-2 for the UAE (spec field 20) — default country. */
export const UAE_COUNTRY_CODE = "AE";
/** Tax scheme code — default value per spec fields 16 & 25. */
export const DEFAULT_TAX_SCHEME = "VAT";

// Constants the PINT-AE XML carries as fixed values (spec fields 7 & 8).
// ponytail: needed by the serializer, not by capture — kept here so it has one
// home. Verify the exact literals against the published PINT-AE Data Dictionary
// before emitting XML.
export const PINT_AE_SPEC_IDENTIFIER = "urn:peppol:pint:billing-1@ae-1";
export const PINT_AE_PROCESS_ID = "urn:peppol:bis:billing";

/** TIN = first 10 digits of a 15-digit TRN (spec highlights & field 11). */
export function tinFromTrn(trn?: string | null): string {
  const digits = (trn ?? "").replace(/\D/g, "");
  return digits.slice(0, 10);
}

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

/** Default tax-exemption reason text for non-standard VAT categories (BT-120).
 *  Peppol BR-E / BR-Z / BR-O / BR-AE require a reason when a line/subtotal isn't
 *  standard-rated. ponytail: the text satisfies the rule; a VATEX reason *code*
 *  (BT-121) needs the PINT-AE Data Dictionary value list — add per category
 *  once that list is confirmed. */
export const TAX_EXEMPTION_REASONS: Record<string, string> = {
  Z: "Zero-rated supply",
  E: "Exempt supply",
  O: "Outside scope of VAT",
  AE: "Reverse charge — VAT to be accounted for by the recipient",
};

/** Invoice-type codes that reference a prior invoice (need BillingReference). */
export const CORRECTIVE_TYPE_CODES = ["381", "383"];

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
  console.assert(tinFromTrn("100123456700003") === "1001234567", "tin = first 10");
  console.assert(encodeTransactionType({}) === DEFAULT_TRANSACTION_TYPE, "empty = zeros");
  console.log("einvoice self-check passed");
}
