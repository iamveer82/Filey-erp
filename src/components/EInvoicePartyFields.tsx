import { useId } from "react";
import { Field } from "./ui";
import { SelectMenu } from "./ui-menu";
import { LEGAL_ID_TYPES, partyTin, type EInvoiceParty } from "../lib/einvoice";

export default function EInvoicePartyFields({ value, onChange, includeLegal = true, includeIdentifier = false }: {
  value?: EInvoiceParty | null;
  onChange: (value: EInvoiceParty) => void;
  includeLegal?: boolean;
  includeIdentifier?: boolean;
}) {
  const id = useId();
  const party = value ?? {};
  const set = (key: keyof EInvoiceParty, text: string) => onChange({ ...party, [key]: text });
  const input = (key: keyof EInvoiceParty, label: string, placeholder?: string) => (
    <Field label={label} key={key}>
      <input id={`${id}-${key}`} className="input" aria-label={label}
        value={party[key] || ""} placeholder={placeholder}
        onChange={event => set(key, event.target.value)} />
    </Field>
  );
  return <div className="space-y-3">
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {input("corporate_trn", "Corporate Tax TRN", "15 digits, if registered")}
      {input("tin", "Electronic invoicing TIN", partyTin(party) || "10 digits, separate from VAT TRN")}
      {input("endpoint_id", "Electronic invoicing address", partyTin(party) || "Provided during registration")}
      {input("endpoint_scheme", "Address scheme", "0235 for UAE TIN")}
      {includeIdentifier && input("identifier", "Buyer identifier", "Customer's business or person identifier")}
      {includeLegal && input("legal_id", "Legal registration number")}
      {includeLegal && <Field label="Registration type"><SelectMenu ariaLabel="Registration type"
        value={party.legal_id_type || ""} onChange={text => set("legal_id_type", text)}
        options={[{ value: "", label: "Choose a type" }, ...LEGAL_ID_TYPES.map(type => ({ value: type.code, label: type.label }))]} /></Field>}
      {input("legal_authority", "Issuing authority / passport country", "Actual licence authority, or country code for a passport")}
    </div>
    <p className="text-xs text-muted-foreground">Use the electronic address registered with your e-invoicing provider. A VAT TRN is kept separately.</p>
  </div>;
}
