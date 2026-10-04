import { useId } from "react";
import { Field } from "./ui";
import type { CustomerOpeningBalance } from "../lib/customerOpeningBalance";

export default function CustomerOpeningBalanceFields({
  value,
  onChange,
  error,
}: {
  value: CustomerOpeningBalance;
  onChange: (value: CustomerOpeningBalance) => void;
  error?: string | null;
}) {
  const id = useId();
  return (
    <fieldset className="min-w-0" aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}>
      <legend className="text-sm font-medium text-foreground">Opening balance (AED)</legend>
      <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">Amount carried in from before Filey. Enter one side only.</p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Debit / Payable">
          <input
            className="input border-danger focus:border-danger focus:ring-danger/20"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            maxLength={24}
            placeholder="0.00"
            value={value.payable}
            aria-invalid={!!error}
            aria-describedby={`${id}-payable-hint${error ? ` ${id}-error` : ""}`}
            onChange={event => onChange({ ...value, payable: event.target.value })}
          />
          <p id={`${id}-payable-hint`} className="mt-1 text-xs text-muted-foreground">Money to pay out. You owe the customer.</p>
        </Field>
        <Field label="Credit / Receivable">
          <input
            className="input border-success focus:border-success focus:ring-success/20"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            maxLength={24}
            placeholder="0.00"
            value={value.receivable}
            aria-invalid={!!error}
            aria-describedby={`${id}-receivable-hint${error ? ` ${id}-error` : ""}`}
            onChange={event => onChange({ ...value, receivable: event.target.value })}
          />
          <p id={`${id}-receivable-hint`} className="mt-1 text-xs text-muted-foreground">Money to receive. The customer owes you.</p>
        </Field>
      </div>
      {error && <p id={`${id}-error`} role="alert" className="mt-2 text-xs font-medium text-danger">{error}</p>}
    </fieldset>
  );
}
