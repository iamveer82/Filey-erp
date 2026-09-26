/** Tax jurisdiction is independent of the document and display currencies.
 * Currency fallback is ONLY for legacy records without a country snapshot.
 * Presets are starting points, not automatic product/transaction classification.
 * Sources and coverage: docs/international-business.md. Reviewed 2026-09-06. */
export interface TaxRegime {
  id: string;
  country: string;
  currency: string;
  taxLabel: string;
  trnLabel: string;
  defaultRate?: number;
  rates: number[];
  authority: string;
}
const GENERIC: TaxRegime = {
  id: "generic",
  country: "International",
  currency: "*",
  taxLabel: "Tax",
  trnLabel: "Tax ID",
  rates: [],
  authority: "",
};
export const EU_COUNTRIES =
  "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE".split(
    " "
  );
const EU_STANDARD: Record<string, number> = {
  AT: 20,
  BE: 21,
  BG: 20,
  HR: 25,
  CY: 19,
  CZ: 21,
  DK: 25,
  EE: 24,
  FI: 25.5,
  FR: 20,
  DE: 19,
  GR: 24,
  HU: 27,
  IE: 23,
  IT: 22,
  LV: 21,
  LT: 21,
  LU: 17,
  MT: 18,
  NL: 21,
  PL: 23,
  PT: 23,
  RO: 21,
  SK: 23,
  SI: 22,
  ES: 21,
  SE: 25,
};
const REGIMES: Record<string, TaxRegime> = {
  AE: {
    id: "uae-vat",
    country: "United Arab Emirates",
    currency: "AED",
    taxLabel: "VAT",
    trnLabel: "TRN",
    defaultRate: 5,
    rates: [0, 5],
    authority: "UAE Federal Tax Authority",
  },
  IN: {
    id: "in-gst",
    country: "India",
    currency: "INR",
    taxLabel: "GST",
    trnLabel: "GSTIN",
    defaultRate: 18,
    rates: [0, 5, 18, 40],
    authority: "GST Council",
  },
  SA: {
    id: "ksa-vat",
    country: "Saudi Arabia",
    currency: "SAR",
    taxLabel: "VAT",
    trnLabel: "VAT No.",
    defaultRate: 15,
    rates: [0, 15],
    authority: "ZATCA",
  },
};
const names = new Intl.DisplayNames(["en"], { type: "region" });
export const COUNTRY_OPTIONS = [
  "AE",
  "IN",
  ...EU_COUNTRIES,
  "SA",
  "GB",
  "US",
  "CA",
  "AU",
  "NZ",
  "SG",
  "BH",
  "OM",
  "QA",
  "KW",
  "CH",
  "ZA",
  "JP",
]
  .map((code) => ({ value: code, label: names.of(code) || code }))
  .sort((a, b) => a.label.localeCompare(b.label));
const supported = new Set(COUNTRY_OPTIONS.map((c) => c.value));
const LEGACY_COUNTRY: Record<string, string> = { AED: "AE", INR: "IN", SAR: "SA" };
export function taxRegimeFor(
  currency?: string | null,
  countryCode?: string | null
): TaxRegime {
  const code =
    countryCode?.trim().toUpperCase() ||
    LEGACY_COUNTRY[(currency || "").trim().toUpperCase()] ||
    "";
  if (REGIMES[code]) return REGIMES[code];
  if (EU_COUNTRIES.includes(code))
    return {
      ...GENERIC,
      id: `eu-vat-${code.toLowerCase()}`,
      country: names.of(code) || code,
      taxLabel: "VAT",
      trnLabel: "VAT ID",
      defaultRate: EU_STANDARD[code],
      rates: [0, EU_STANDARD[code]],
      authority: "National VAT authority",
    };
  return {
    ...GENERIC,
    country: supported.has(code) ? names.of(code) || code : GENERIC.country,
  };
}
export function isUaeRegime(
  currency?: string | null,
  countryCode?: string | null
): boolean {
  return taxRegimeFor(currency, countryCode).id === "uae-vat";
}
export function defaultTaxRate(
  currency: string | null | undefined,
  companyDefault: number | null | undefined,
  countryCode?: string | null
): number {
  // A configured zero is intentional (e.g. an unregistered business).
  return companyDefault ?? taxRegimeFor(currency, countryCode).defaultRate ?? 0;
}
export function validateCountry(code?: string | null, template?: string | null): void {
  if (code != null && code !== "" && !supported.has(code))
    throw new Error("Select a supported business country.");
  if (code && code !== "AE" && template && /(^|-)uae($|-)/.test(template)) throw new Error("Choose a general document template for this tax country. UAE templates contain UAE-specific legal text.");
}
/** Format check only; registration/validity must be checked with the authority. */
export function taxIdError(value?: string | null, country?: string | null): string {
  const id = value?.trim() || "";
  if (!id) return "";
  if (country === "AE" && !/^\d{15}$/.test(id)) return "TRN must be exactly 15 digits.";
  if (country === "IN" && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[A-Z0-9]$/.test(id))
    return "GSTIN must be 15 characters in the Indian GSTIN format.";
  if (id.length > 40 || !/^[A-Za-z0-9 ./-]+$/.test(id))
    return "Enter a tax ID using letters, numbers, spaces, dots, slashes or hyphens (up to 40 characters).";
  return "";
}
