import { decodeTransactionType, TRANSACTION_TYPE_FLAGS, PINT_AE_INVOICE_TYPE_CODES, INVOICE_TYPE_CODES, PAYMENT_MEANS_CODES } from "../lib/einvoice";
import { isUaeRegime } from "../lib/taxRegimes";
import type { DocViewForm } from "./DocView";

/** Customer-readable counterpart of the transaction flags carried in XML. */
export default function InvoiceTransactionSummary({ form }: { form: DocViewForm }) {
  if (!isUaeRegime(form.currency || "AED", form.tax_country_code)) return null;
  const flags = decodeTransactionType(form.transaction_type);
  const selected = TRANSACTION_TYPE_FLAGS.filter(flag => flags[flag.key]);
  const invoiceLabel = [...PINT_AE_INVOICE_TYPE_CODES, ...INVOICE_TYPE_CODES].find(code => code.code === form.invoice_type_code)?.label;
  const paymentLabel = PAYMENT_MEANS_CODES.find(code => code.code === form.payment_means_code)?.label;
  const codes = [
    form.invoice_type_code && `Invoice type: ${form.invoice_type_code}${invoiceLabel ? ` (${invoiceLabel})` : ""}`,
    form.payment_means_code && `Payment: ${form.payment_means_code}${paymentLabel ? ` (${paymentLabel})` : ""}`,
  ].filter(Boolean);
  if (!selected.length && !codes.length) return null;

  return (
    <>
      {selected.length > 0 && <div data-invoice-transactions className="text-[10px] leading-relaxed text-neutral-600 break-words">
        <span className="font-semibold text-neutral-800">Transaction details: </span>
        {selected.map(flag => flag.label).join(" · ")}
      </div>}
      {codes.length > 0 && <div data-invoice-payment className="text-[10px] leading-relaxed text-neutral-600 break-words">{codes.join(" · ")}</div>}
    </>
  );
}
