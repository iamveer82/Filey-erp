import { decodeTransactionType, TRANSACTION_TYPE_FLAGS, PINT_AE_INVOICE_TYPE_CODES, INVOICE_TYPE_CODES, PAYMENT_MEANS_CODES } from "../lib/einvoice";
import { supportsInvoiceDetails } from "./InvoiceElectronicDetails";
import type { DocViewForm } from "./DocView";

/** Customer-readable counterpart of the transaction flags carried in XML. */
export default function InvoiceTransactionSummary({ form }: { form: DocViewForm }) {
  if (!supportsInvoiceDetails(form)) return null;
  const invoiceCode = typeof form.invoice_type_code === "string" ? form.invoice_type_code.trim() : "";
  const paymentCode = typeof form.payment_means_code === "string" ? form.payment_means_code.trim() : "";
  const transactionCode = typeof form.transaction_type === "string" && /^[01]{8}$/.test(form.transaction_type.trim())
    ? form.transaction_type.trim() : "";
  const flags = decodeTransactionType(transactionCode || undefined);
  const selected = TRANSACTION_TYPE_FLAGS.filter(flag => flags[flag.key]);
  const invoiceLabel = [...PINT_AE_INVOICE_TYPE_CODES, ...INVOICE_TYPE_CODES].find(code => code.code === invoiceCode)?.label;
  const paymentLabel = PAYMENT_MEANS_CODES.find(code => code.code === paymentCode)?.label;
  const codes = [
    invoiceCode && `Invoice type: ${invoiceCode}${invoiceLabel ? ` (${invoiceLabel})` : ""}`,
    paymentCode && `Payment: ${paymentCode}${paymentLabel ? ` (${paymentLabel})` : ""}`,
    transactionCode && `Transaction type: ${transactionCode}`,
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
