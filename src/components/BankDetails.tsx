import { tools } from "../lib/api";
import { bankFieldsFor, type BankFieldKey } from "../lib/bankFields";

/* Company bank account details — entered once in Settings → Company Details and
 * optionally printed on any document via a Yes/No toggle (like VAT).
 *
 * Stored as a single JSON app-setting (`company_bank`) rather than dedicated
 * company_profile columns, so it syncs across devices with no DB migration.
 *
 * Which identifiers apply depends on the country: an Indian bank has an IFSC and
 * no IBAN, an Emirates NBD branch has an IBAN. See lib/bankFields.ts. Adding a
 * field here needs no migration either — older records simply have no value for
 * it, and a hidden field keeps whatever was already saved. */

export interface BankInfo {
  bank_name: string;
  branch: string;
  account_name: string;
  account_number: string;
  /** IBAN — Europe, UK, UAE, Gulf, Saudi. */
  iban: string;
  /** IFSC — India. */
  ifsc: string;
  /** ABA / transit / BSB / NZ bank code. */
  routing_code: string;
  swift: string;
}

export const EMPTY_BANK: BankInfo = {
  bank_name: "",
  branch: "",
  account_name: "",
  account_number: "",
  iban: "",
  ifsc: "",
  routing_code: "",
  swift: "",
};

const SETTING_KEY = "company_bank";

/** Every field, unfiltered — for callers that must not hide saved values. */
export const BANK_FIELDS = bankFieldsFor(null);

/** The fields to collect/print for a business country. */
export const bankFields = bankFieldsFor;

export const hasBankInfo = (b?: BankInfo | null): boolean =>
  !!b && Object.values(b).some((v) => (v ?? "").toString().trim());

/** Load saved bank details (empty record if none / not configured). */
export async function loadBankInfo(): Promise<BankInfo> {
  try {
    const rows = await tools.settings();
    const row = rows.find((r) => r.key === SETTING_KEY);
    if (!row?.value) return { ...EMPTY_BANK };
    return { ...EMPTY_BANK, ...(JSON.parse(row.value) as Partial<BankInfo>) };
  } catch (e) {
    console.warn("Failed to parse company bank details", e);
    return { ...EMPTY_BANK };
  }
}

export async function saveBankInfo(b: BankInfo): Promise<void> {
  await tools.setSetting(SETTING_KEY, JSON.stringify(b));
}

/** The bank block rendered on a generated document (neutral, print-safe).
 *  Pass the business country so an Indian customer is never shown an IBAN line
 *  they do not have, and so a UAE one still is. Omit it and every saved field
 *  is printed — never hide what a customer already recorded. */
export function BankDetailsBlock({
  bank,
  accent,
  countryCode,
  className = "",
}: {
  bank: BankInfo;
  accent?: string;
  countryCode?: string | null;
  className?: string;
}) {
  if (!hasBankInfo(bank)) return null;
  const rows = bankFieldsFor(countryCode).filter(
    (f) => (bank[f.key as BankFieldKey] ?? "").trim()
  );
  return (
    <div
      className={`mt-6 pt-3 border-t border-neutral-200 text-neutral-900 ${className}`}
    >
      <p
        className="text-xs font-medium mb-1.5"
        style={accent ? { color: accent } : undefined}
      >
        Bank Details
      </p>
      <div className="grid grid-cols-2 gap-x-8 gap-y-0.5 text-[11px] text-neutral-600">
        {rows.map((f) => (
          <div key={f.key} className="flex justify-between gap-3">
            <span className="text-neutral-400">{f.label}</span>
            <span className="font-medium text-neutral-800 text-right">
              {bank[f.key as BankFieldKey]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
