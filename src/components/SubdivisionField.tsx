import { SelectMenu } from "./ui-menu";
import { EMIRATES } from "../lib/einvoice";
import { GST_STATE_OPTIONS, gstState } from "../lib/gst";
import { subdivisionLabel } from "../lib/companyCountry";

/** An emirate or an Indian state from a list (GST needs the exact state), anything else typed. */
export default function SubdivisionField({ country, value, onChange, ariaLabel, placeholder }: {
  country?: string | null;
  value?: string | null;
  onChange: (value: string) => void;
  ariaLabel?: string;
  placeholder?: string;
}) {
  const label = ariaLabel ?? subdivisionLabel(country);
  const code = (country ?? "").toUpperCase();
  if (code === "AE") return <SelectMenu ariaLabel={label} value={value ?? ""} onChange={onChange}
    options={[{ value: "", label: placeholder ?? "Select…" }, ...EMIRATES.map((em) => ({ value: em.code, label: em.label }))]} />;
  // A state typed before the list existed ("maharashtra") still shows as its state.
  if (code === "IN") return <SelectMenu ariaLabel={label} value={gstState(value)?.name ?? value ?? ""} onChange={onChange}
    searchPlaceholder="Type a state…" options={[{ value: "", label: placeholder ?? "Select…" }, ...GST_STATE_OPTIONS]} />;
  return <input aria-label={label} className="input" placeholder={placeholder} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
}
