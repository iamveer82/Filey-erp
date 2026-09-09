import { Field } from "./ui";
import { SelectMenu } from "./ui-menu";
import type { CompanyProfile } from "../lib/api";
import { COUNTRY_OPTIONS, taxRegimeFor } from "../lib/taxRegimes";

/** Shared by document company dialogs and the full settings page. */
export default function CountryTaxFields({
  company: c,
  onChange,
}: {
  company: CompanyProfile;
  onChange: (c: CompanyProfile) => void;
}) {
  const regime = taxRegimeFor(c.currency, c.country_code);
  return (
    <div className="space-y-3">
      <Field label="Business country">
        <SelectMenu
          value={c.country_code || ""}
          onChange={(country_code) =>
            onChange({
              ...c,
              country_code,
              country_subdivision: "",
              tax_type:
                c.tax_type === "None"
                  ? "None"
                  : taxRegimeFor(c.currency, country_code).taxLabel,
            })
          }
          options={[
            { value: "", label: "Not set — legacy currency defaults" },
            ...COUNTRY_OPTIONS,
          ]}
        />
      </Field>
      <p className="text-xs text-brand-500">
        {c.country_code
          ? `${regime.country} · ${regime.taxLabel}.`
          : "Select the country where this business is registered."}{" "}
        New documents keep their tax country when you change currency. Existing documents
        stay unchanged.
      </p>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field label="Default tax rate (%)">
            <input
              aria-label="Default tax rate (%)"
              type="number"
              min="0"
              max="100"
              step="0.01"
              className="input"
              value={c.default_tax_rate ?? ""}
              onChange={(e) =>
                onChange({
                  ...c,
                  default_tax_rate:
                    e.target.value === "" ? undefined : Number(e.target.value),
                  tax_type:
                    Number(e.target.value) > 0 && c.tax_type === "None"
                      ? regime.taxLabel
                      : c.tax_type,
                })
              }
            />
          </Field>
        </div>
        {c.country_code && regime.defaultRate != null && (
          <button
            type="button"
            className="btn-ghost shrink-0"
            onClick={() =>
              onChange({
                ...c,
                default_tax_rate: regime.defaultRate,
                tax_type: regime.taxLabel,
              })
            }
          >
            Use {regime.defaultRate}%
          </button>
        )}
      </div>
      <p className="text-xs text-brand-500">
        Use 0 if no tax is charged. Suggested rates need review for your goods, services
        and customer. Cross-border treatment is entered per document.
      </p>
    </div>
  );
}
