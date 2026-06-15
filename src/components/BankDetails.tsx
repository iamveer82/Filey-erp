import { tools } from "../lib/api";

/* Company bank account details — entered once in Settings → Company Details and
 * optionally printed on any document via a Yes/No toggle (like VAT).
 *
 * Stored as a single JSON app-setting (`company_bank`) rather than dedicated
 * company_profile columns, so it syncs across devices with no DB migration. */

export interface BankInfo {
  bank_name: string;
  branch: string;
  account_name: string;
  account_number: string;
  iban: string;
  swift: string;
}

export const EMPTY_BANK: BankInfo = {
  bank_name: "",
  branch: "",
  account_name: "",
  account_number: "",
  iban: "",
  swift: "",
};

const SETTING_KEY = "company_bank";

export const BANK_FIELDS: { key: keyof BankInfo; label: string; placeholder?: string }[] =
  [
    { key: "bank_name", label: "Bank Name", placeholder: "Emirates NBD" },
    { key: "branch", label: "Branch Name", placeholder: "Business Bay" },
    { key: "account_name", label: "Account Name", placeholder: "Your Company L.L.C" },
    { key: "account_number", label: "Account Number", placeholder: "01234567890" },
    { key: "iban", label: "IBAN", placeholder: "AE00 0000 0000 0000 0000 000" },
    { key: "swift", label: "SWIFT / BIC", placeholder: "EBILAEAD" },
  ];

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

/** The bank block rendered on a generated document (neutral, print-safe). */
export function BankDetailsBlock({
  bank,
  accent,
  className = "",
}: {
  bank: BankInfo;
  accent?: string;
  className?: string;
}) {
  if (!hasBankInfo(bank)) return null;
  const rows = BANK_FIELDS.filter((f) => (bank[f.key] ?? "").trim());
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
            <span className="font-medium text-neutral-800 text-right">{bank[f.key]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
