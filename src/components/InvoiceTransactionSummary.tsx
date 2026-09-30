import { decodeTransactionType, TRANSACTION_TYPE_FLAGS } from "../lib/einvoice";
import { isUaeRegime } from "../lib/taxRegimes";
import type { DocViewForm } from "./DocView";

/** Customer-readable counterpart of the transaction flags carried in XML. */
export default function InvoiceTransactionSummary({ form }: { form: DocViewForm }) {
  if (!isUaeRegime(form.currency || "AED", form.tax_country_code)) return null;
  const flags = decodeTransactionType(form.transaction_type);
  const selected = TRANSACTION_TYPE_FLAGS.filter(flag => flags[flag.key]);
  if (!selected.length) return null;

  return (
    <div data-invoice-transactions className="text-[10px] leading-relaxed text-neutral-600 break-words">
      <span className="font-semibold text-neutral-800">Transaction details: </span>
      {selected.map(flag => flag.label).join(" · ")}
    </div>
  );
}
