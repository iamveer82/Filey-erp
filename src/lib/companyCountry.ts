import { EU_COUNTRIES, taxRegimeFor } from "./taxRegimes";
import type { CompanyProfile } from "./api";

export function companyCountry(company: Pick<CompanyProfile, "country_code" | "currency">): string {
  return company.country_code?.trim().toUpperCase() ||
    ({ AED: "AE", INR: "IN", SAR: "SA" }[company.currency || ""] ?? "");
}

export function companyPhoneHint(country: string): string {
  return ({ IN: "+91 98765 43210", AE: "+971 50 123 4567", SA: "+966 50 123 4567",
    GB: "+44 7700 900123", US: "+1 202 555 0123", CA: "+1 416 555 0123",
    AU: "+61 412 345 678", DE: "+49 151 23456789", FR: "+33 6 12 34 56 78" })[country]
    || `+${CALLING_CODES[country] || "country code"} phone number`;
}

const CALLING_CODES: Record<string, string> = {
  AT: "43", BE: "32", BG: "359", HR: "385", CY: "357", CZ: "420", DK: "45",
  EE: "372", FI: "358", GR: "30", HU: "36", IE: "353", IT: "39", LV: "371",
  LT: "370", LU: "352", MT: "356", NL: "31", PL: "48", PT: "351", RO: "40",
  SK: "421", SI: "386", ES: "34", SE: "46", NZ: "64", SG: "65", BH: "973",
  OM: "968", QA: "974", KW: "965", CH: "41", ZA: "27", JP: "81",
};

/** Country defaults; documents can still be issued in another currency. */
export function companyCountryCurrency(country: string): string | undefined {
  const currency: Record<string, string> = {
    AE: "AED", IN: "INR", SA: "SAR", GB: "GBP", US: "USD", CA: "CAD",
    AU: "AUD", NZ: "NZD", SG: "SGD", BH: "BHD", OM: "OMR", QA: "QAR",
    KW: "KWD", CH: "CHF", ZA: "ZAR", JP: "JPY", CZ: "CZK", DK: "DKK",
    HU: "HUF", PL: "PLN", RO: "RON", SE: "SEK",
  };
  // Bulgaria joined the euro area in January 2026; remaining EU countries use EUR.
  return currency[country] || (EU_COUNTRIES.includes(country) ? "EUR" : undefined);
}

export function changeCompanyCountry(c: CompanyProfile, country_code: string): CompanyProfile {
  const after = taxRegimeFor(c.currency, country_code);
  return {
    ...c, country_code, country_subdivision: "",
    currency: companyCountryCurrency(country_code) || c.currency,
    // Only the company's future default changes, never existing document values.
    // Saved identifiers and explicit tax choices survive switching countries.
    tax_type: c.tax_type === "None" ? "None" : after.taxLabel,
  };
}
