// Bank identifiers are not universal. An IBAN is meaningless to an Indian bank
// and an IFSC is meaningless to Emirates NBD, so the fields a business is asked
// for — and the ones printed on its documents — follow the country it trades in.
//
// This is a *presentation* layer only. Saved values are never dropped when the
// country changes, so switching India <-> UAE and back keeps whatever was typed.
// Every record stays readable; a field is hidden, not deleted.
//
// Sources: SWIFT/ISO 13616 (IBAN), RBI/IFSCA (IFSC), ABA (US routing),
// Canadian ACH (transit/institution), NZ IRD (bank code). Format checks only —
// whether an account is real or active must be confirmed with the bank.

import { EU_COUNTRIES } from "./taxRegimes";

export type BankFieldKey =
  | "bank_name"
  | "branch"
  | "account_name"
  | "account_number"
  | "iban"
  | "ifsc"
  | "routing_code"
  | "swift";

export interface BankFieldSpec {
  key: BankFieldKey;
  label: string;
  placeholder?: string;
  /** Longer identifiers get their own line on a printed document. */
  wide?: boolean;
  /** Returns an error message, or "" when the value is acceptable. */
  validate?: (value: string) => string;
}

/** Countries whose domestic transfers settle on an IBAN. */
const IBAN_COUNTRIES = new Set<string>([
  "AE", "GB", "CH", "SA", "BH", "OM", "QA", "KW", ...EU_COUNTRIES,
]);

/** Countries with a domestic sort code and no IBAN. */
const ROUTING: Record<string, { key: BankFieldKey; label: string; placeholder: string; validate: (v: string) => string }> = {
  US: {
    key: "routing_code",
    label: "Routing Number (ABA)",
    placeholder: "021000021",
    validate: (v) =>
      /^\d{9}$/.test(v.replace(/\s/g, ""))
        ? ""
        : "A US routing number is 9 digits.",
  },
  CA: {
    key: "routing_code",
    label: "Transit / Institution Number",
    placeholder: "00012-345",
    validate: () => "",
  },
  AU: {
    key: "routing_code",
    label: "BSB",
    placeholder: "062000",
    validate: (v) => (/^\d{6}$/.test(v.replace(/\s/g, "")) ? "" : "An Australian BSB is 6 digits."),
  },
  NZ: {
    key: "routing_code",
    label: "Bank Code",
    placeholder: "01-012-000",
    validate: () => "",
  },
};

/** IBAN lengths are capped at 34; a cheap structural check catches typos
 *  without rejecting a valid account number we cannot verify offline. */
const ibanError = (value: string) => {
  const v = value.replace(/\s/g, "").toUpperCase();
  if (!v) return "";
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v))
    return "An IBAN starts with a country code and check digits, then the account number.";
  return "";
};

const ifscError = (value: string) => {
  const v = value.replace(/\s/g, "").toUpperCase();
  if (!v) return "";
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v)
    ? ""
    : "An IFSC is 11 characters: 4 letters, a 0, then 6 letters or digits (for example HDFC0001234).";
};

const swiftError = (value: string) => {
  const v = value.replace(/\s/g, "").toUpperCase();
  if (!v) return "";
  return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(v)
    ? ""
    : "A SWIFT/BIC is 8 or 11 characters (for example HDFCINBBXXX).";
};

const norm = (code?: string | null) => (code ?? "").trim().toUpperCase();

/**
 * The bank fields to collect and print for a business country.
 *
 * Pass no country to get the full union — used where the country is unknown, so
 * nothing a user already saved can be hidden from them.
 */
export function bankFieldsFor(countryCode?: string | null): BankFieldSpec[] {
  const code = norm(countryCode);

  const core: BankFieldSpec[] = [
    { key: "bank_name", label: "Bank Name", placeholder: "Emirates NBD" },
    { key: "branch", label: "Branch Name", placeholder: "Business Bay" },
    { key: "account_name", label: "Account Name", placeholder: "Your Company L.L.C" },
    { key: "account_number", label: "Account Number", placeholder: "01234567890" },
  ];

  const identifier = (): BankFieldSpec[] => {
    // India settles on IFSC. Asking for an IBAN here is the exact confusion
    // this table exists to remove.
    if (code === "IN")
      return [
        { key: "ifsc", label: "IFSC Code", placeholder: "HDFC0001234", wide: true, validate: ifscError },
        { key: "swift", label: "SWIFT / BIC", placeholder: "HDFCINBBXXX", validate: swiftError },
      ];
    const routing = ROUTING[code];
    if (routing)
      return [
        { key: routing.key, label: routing.label, placeholder: routing.placeholder, wide: true, validate: routing.validate },
        { key: "swift", label: "SWIFT / BIC", placeholder: "CHASUS33", validate: swiftError },
      ];
    if (IBAN_COUNTRIES.has(code))
      return [
        { key: "iban", label: "IBAN", placeholder: "AE00 0000 0000 0000 0000 000", wide: true, validate: ibanError },
        { key: "swift", label: "SWIFT / BIC", placeholder: "EBILAEAD", validate: swiftError },
      ];
    // Singapore, Japan, South Africa and anything unlisted: a SWIFT code is
    // the only identifier that is reliably meaningful.
    return [{ key: "swift", label: "SWIFT / BIC", placeholder: "CHASUS33", validate: swiftError }];
  };

  // Unknown country: show every field so nothing saved is ever hidden.
  if (!code) return [...core, ...ALL_IDENTIFIERS];

  return [...core, ...identifier()];
}

/** Every identifier, for callers that must not filter by country. */
const ALL_IDENTIFIERS: BankFieldSpec[] = [
  { key: "iban", label: "IBAN", placeholder: "AE00 0000 0000 0000 0000 000", wide: true, validate: ibanError },
  { key: "ifsc", label: "IFSC Code", placeholder: "HDFC0001234", wide: true, validate: ifscError },
  { key: "routing_code", label: "Routing / Sort Code", placeholder: "", wide: true, validate: () => "" },
  { key: "swift", label: "SWIFT / BIC", placeholder: "EBILAEAD", validate: swiftError },
];

/** Validates one saved value. Unknown keys and empty values pass. */
export function bankFieldError(
  key: BankFieldKey,
  value: string,
  countryCode?: string | null
): string {
  const spec = bankFieldsFor(countryCode).find((f) => f.key === key);
  return spec?.validate ? spec.validate(value) : "";
}
