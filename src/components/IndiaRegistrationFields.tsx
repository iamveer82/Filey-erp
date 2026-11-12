import { FormField } from "./ui";
import { SelectMenu } from "./ui-menu";
import { tools } from "../lib/api";

const KEY = "company_registration_in";
const fields = [
  { key: "pan", label: "PAN", placeholder: "ABCDE1234F", pattern: /^[A-Z]{5}\d{4}[A-Z]$/, hint: "Business PAN · 10 characters" },
  { key: "cin", label: "CIN / LLPIN", placeholder: "U12345MH2020PTC123456", pattern: /^(?:[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}|[A-Z]{3}-\d{4})$/, hint: "For an incorporated company or LLP, if applicable" },
  { key: "udyam", label: "Udyam registration", placeholder: "UDYAM-MH-01-1234567", pattern: /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/, hint: "Optional MSME registration" },
  { key: "aadhaar_last4", label: "Aadhaar reference (last 4 digits)", placeholder: "1234", pattern: /^\d{4}$/, hint: "Optional personal reference only. Never enter the full Aadhaar number; this is not printed on invoices." },
] as const;
/** GST scheme: "regular" (default) or "composition" (Bill of Supply, tax paid on turnover). */
const schemeKeys = ["gst_scheme", "composition_rate"] as const;
export type IndiaRegistration = Partial<Record<typeof fields[number]["key"] | typeof schemeKeys[number], string>>;
const COMPOSITION_RATES = [
  { value: "1", label: "1% - manufacturers and traders" },
  { value: "5", label: "5% - restaurants" },
  { value: "6", label: "6% - service providers" },
];

export function registrationError(value: IndiaRegistration): string {
  const invalid = fields.find(f => value[f.key]?.trim() && !f.pattern.test(value[f.key]!.trim()));
  return invalid ? `Check the format of ${invalid.label}.` : "";
}

// Use the existing synced company settings, like bank details; no new table or migration.
export async function loadIndiaRegistration(): Promise<IndiaRegistration> {
  const row = (await tools.settings()).find(r => r.key === KEY);
  if (!row?.value) return {};
  const parsed = JSON.parse(row.value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Could not read Indian registration details.");
  return Object.fromEntries([...fields.map(f => f.key), ...schemeKeys].map(k => [k, typeof parsed[k] === "string" ? parsed[k] : ""]));
}

export async function saveIndiaRegistration(value: IndiaRegistration): Promise<void> {
  const error = registrationError(value);
  if (error) throw new Error(error);
  await tools.setSetting(KEY, JSON.stringify(Object.fromEntries([...fields.map(f => f.key), ...schemeKeys].map(k => [k, value[k]?.trim() || ""]))));
}

export default function IndiaRegistrationFields({value, onChange}: {
  value: IndiaRegistration | null | undefined; onChange: (next: IndiaRegistration) => void;
}) {
  if (value === undefined) return <p role="status" className="text-sm text-muted-foreground">Loading Indian registration details…</p>;
  if (!value) return <p role="status" className="text-sm text-muted-foreground">Indian registration details are unavailable. Reopen company settings to retry.</p>;
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    {fields.map(f => <FormField key={f.key} label={f.label} hint={f.hint}
      error={value[f.key] && !f.pattern.test(value[f.key]!) ? `Check the ${f.label} format.` : undefined}>
      <input className="input" value={value[f.key] || ""} placeholder={f.placeholder}
        autoCapitalize="characters" autoComplete="off" spellCheck={false}
        inputMode={f.key === "aadhaar_last4" ? "numeric" : "text"}
        onChange={e => onChange({...value, [f.key]: e.target.value.toUpperCase().trim()})} />
    </FormField>)}
    <FormField label="GST scheme" hint="Composition dealers issue a Bill of Supply and charge no GST on it">
      <SelectMenu ariaLabel="GST scheme" value={value.gst_scheme === "composition" ? "composition" : "regular"}
        onChange={v => onChange({...value, gst_scheme: v, composition_rate: v === "composition" ? value.composition_rate || "1" : ""})}
        options={[{ value: "regular", label: "Regular" }, { value: "composition", label: "Composition scheme" }]} />
    </FormField>
    {value.gst_scheme === "composition" && <FormField label="Composition rate" hint="Tax paid each quarter on CMP-08">
      <SelectMenu ariaLabel="Composition rate" value={value.composition_rate || "1"} onChange={v => onChange({...value, composition_rate: v})} options={COMPOSITION_RATES} />
    </FormField>}
  </div>;
}
