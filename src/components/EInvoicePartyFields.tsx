import { useId } from "react";
import { Field } from "./ui";
import { SelectMenu } from "./ui-menu";
import { LEGAL_ID_TYPES, partyTin, type EInvoiceParty } from "../lib/einvoice";

export default function EInvoicePartyFields({ value, onChange, includeLegal = true, includeIdentifier = false, idPrefix, errors = {} }: {
  value?: EInvoiceParty | null;
  onChange: (value: EInvoiceParty) => void;
  includeLegal?: boolean;
  includeIdentifier?: boolean;
  idPrefix?: string;
  errors?: Partial<Record<keyof EInvoiceParty, string>>;
}) {
  const id = useId();
  const party = value ?? {};
  const set = (key: keyof EInvoiceParty, text: string) => onChange({ ...party, [key]: text });
  const input = (key: keyof EInvoiceParty, label: string, placeholder?: string) => (
    <Field label={label} key={key} error={errors[key]}>
      <input id={`${idPrefix || id}-${key}`} className="input" aria-label={label}
        value={party[key] || ""} placeholder={placeholder}
        onChange={event => set(key, event.target.value)} />
    </Field>
  );
  return <div className="space-y-3">
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {input("corporate_trn", "Own FTA-issued TRN", "15 digits, if registered")}
      {input("tin", "Electronic invoicing TIN", partyTin(party) || "10 digits")}
      {input("endpoint_id", "Electronic invoicing address", partyTin(party) || "Provided during registration")}
      {input("endpoint_scheme", "Address scheme", "0235 for UAE TIN")}
      {includeIdentifier && input("identifier", "Buyer identifier", "Customer's business or person identifier")}
      {includeLegal && input("legal_id", "Legal registration number")}
      {includeLegal && <Field label="Registration type" error={errors.legal_id_type}><SelectMenu id={`${idPrefix || id}-legal_id_type`} ariaLabel="Registration type"
        value={party.legal_id_type || ""} onChange={text => set("legal_id_type", text)}
        options={[{ value: "", label: "Choose a type" }, ...LEGAL_ID_TYPES.map(type => ({ value: type.code, label: type.label }))]} /></Field>}
      {input("legal_authority", "Issuing authority / passport country", "Actual licence authority, or country code for a passport")}
    </div>
    <p className="text-xs text-muted-foreground">A UAE TIN is the first 10 digits of your own entity’s FTA-issued TRN. Use your registered electronic address; do not use a tax group representative’s TRN. The VAT tax identifier is recorded separately.</p>
  </div>;
}
