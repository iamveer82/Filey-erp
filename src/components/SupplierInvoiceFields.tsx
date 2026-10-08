import { EMIRATES } from "../lib/einvoice";
import { COUNTRY_OPTIONS } from "../lib/taxRegimes";
import { subdivisionLabel } from "../lib/companyCountry";
import { supplierInvoiceDetails } from "../lib/supplierInvoiceDetails";
import EInvoicePartyFields from "./EInvoicePartyFields";
import { Field } from "./ui";
import { SelectMenu } from "./ui-menu";

export default function SupplierInvoiceFields({ value, onChange }: {
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
}) {
  const details = supplierInvoiceDetails(value);
  return <div className="space-y-3">
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Field label="City"><input className="input" value={value.city || ""}
        onChange={event => onChange({ ...value, city: event.target.value })} /></Field>
      <Field label={subdivisionLabel(details.country_code)}>
        {details.country_code === "AE" ? <SelectMenu ariaLabel={subdivisionLabel(details.country_code)}
          value={details.country_subdivision} onChange={country_subdivision => onChange({ ...value, country_subdivision })}
          options={[{ value: "", label: "Select…" }, ...EMIRATES.map(entry => ({ value: entry.code, label: entry.label }))]} />
          : <input className="input" value={value.country_subdivision || ""}
            onChange={event => onChange({ ...value, country_subdivision: event.target.value })} />}
      </Field>
      <Field label="Country"><SelectMenu ariaLabel="Country" value={details.country_code}
        onChange={country_code => onChange({ ...value, country_code, country_subdivision: "" })}
        options={[{ value: "", label: "Select country" }, ...COUNTRY_OPTIONS]} /></Field>
    </div>
    <details className="border-t border-border pt-3">
      <summary className="cursor-pointer font-medium mb-3">Electronic invoicing identity · optional</summary>
      <p className="text-xs text-muted-foreground mb-3">Save these details for reuse on invoices, or leave them blank and enter them on the document.</p>
      <EInvoicePartyFields value={details.identity}
        onChange={identity => onChange({ ...value, einvoice_identity: JSON.stringify(identity) })} />
    </details>
  </div>;
}
