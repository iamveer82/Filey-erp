import { useMemo } from "react";
import { CheckCircle2, AlertCircle, Download } from "lucide-react";
import { Field, Modal } from "./ui";
import { SelectMenu } from "./ui-menu";
import EInvoicePartyFields from "./EInvoicePartyFields";
import { CREDIT_REASONS, decodeTransactionType, isCreditNote, buyerEndpoint, type EInvoiceDetails } from "../lib/einvoice";
import { computeTotals, eInvoiceIssues, type EInvoiceDoc, type EInvoiceIssue } from "../lib/einvoiceXml";
import { money } from "../lib/format";

export default function EInvoiceReview({ open, doc, busy, onClose, onChange, onFix, onExport }: {
  open: boolean; doc: EInvoiceDoc; busy: boolean; onClose: () => void;
  onChange: (details: EInvoiceDetails) => void;
  onFix: (issue: EInvoiceIssue) => void;
  onExport: () => void;
}) {
  const issues = useMemo(() => eInvoiceIssues(doc), [doc]);
  const totals = issues.some(issue => issue.section === "items") ? null : computeTotals(doc);
  const details = doc.einvoice || {};
  const flags = decodeTransactionType(doc.transaction_type);
  const endpoint = buyerEndpoint(details, doc.buyer_country_code || "AE");
  return <Modal open={open} onClose={() => { if (!busy) onClose(); }} title="Check e-invoice" size="lg">
    <div className="space-y-5">
      <div className="flex items-start gap-3" role="status">
        {issues.length ? <AlertCircle size={20} className="text-warning" /> : <CheckCircle2 size={20} className="text-success" />}
        <div><p className="font-medium">{issues.length ? `${issues.length} ${issues.length === 1 ? "detail needs" : "details need"} attention` : "Invoice details complete"}</p>
          <p className="text-sm text-muted-foreground mt-1">Check required fields and export XML for free. Network submission needs an accredited provider connection and its final validation.</p></div>
      </div>
      <fieldset disabled={busy} className="space-y-5">
        {doc.payment_means_code === "30" && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="space-y-1"><span className="label">Bank account / IBAN</span><input className="input" value={details.payment_account_id || ""}
            onChange={event => onChange({ ...details, payment_account_id: event.target.value })} /></label>
          <label className="space-y-1"><span className="label">Account name</span><input className="input" value={details.payment_account_name || ""}
            onChange={event => onChange({ ...details, payment_account_name: event.target.value })} /></label>
        </div>}
        <section aria-label="Seller electronic identity" className="border-t border-border pt-4">
          <div className="flex items-center justify-between gap-3 mb-3"><h3 className="font-medium">Your business · {doc.seller_name || "Seller"}</h3>
            <button className="btn-ghost" onClick={() => onFix({ field: "seller_name", label: "Company", section: "details" })}>Company details</button></div>
          <EInvoicePartyFields value={details.seller} includeLegal={false} onChange={seller => onChange({ ...details, seller })} />
        </section>
        <section aria-label="Buyer electronic identity" className="border-t border-border pt-4">
          <div className="flex items-center justify-between gap-3 mb-3"><h3 className="font-medium">Customer · {doc.customer_name || "Buyer"}</h3>
            <button className="btn-ghost" onClick={() => onFix({ field: "customer_name", label: "Customer", section: "details" })}>Billing details</button></div>
          <label className="block space-y-1 mb-3"><span className="label">Customer e-invoice delivery</span>
            <SelectMenu ariaLabel="Customer e-invoice delivery" value={details.buyer_delivery_mode || "peppol"}
              onChange={mode => onChange({ ...details, buyer_delivery_mode: mode as EInvoiceDetails["buyer_delivery_mode"] })}
              options={[{ value: "peppol", label: "Registered electronic address" },
                { value: "export-unregistered", label: "Export customer without a UAE electronic address" },
                { value: "outside-uae-scope", label: "Customer outside the UAE e-invoicing scope" }]} />
          </label>
          {details.buyer_delivery_mode && details.buyer_delivery_mode !== "peppol" && <p className="mb-3 text-xs text-muted-foreground">Selected delivery uses {endpoint.scheme}:{endpoint.id}. Enter the customer's actual identifier below.</p>}
          <EInvoicePartyFields value={details.buyer} includeIdentifier onChange={buyer => onChange({ ...details, buyer })} />
        </section>
        {flags.freeZone && <Field label="Free-zone beneficiary identifier" hint="Identify the beneficiary of this free-zone transaction.">
          <input className="input" value={details.beneficiary_id || ""}
            onChange={event => onChange({ ...details, beneficiary_id: event.target.value })} />
        </Field>}
        {flags.exports && <section aria-label="Export delivery address" className="border-t border-border pt-4">
          <h3 className="font-medium mb-3">Export delivery address</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {([["address", "Delivery address"], ["city", "Delivery city"], ["region", "Delivery region"], ["country_code", "Delivery country code"]] as const).map(([key, label]) =>
              <label key={key} className="space-y-1"><span className="label">{label}</span>
                <input className="input" value={details.delivery?.[key] || ""} maxLength={key === "country_code" ? 2 : undefined}
                  placeholder={key === "country_code" ? "Two-letter country code, e.g. IN" : undefined}
                  onChange={event => onChange({ ...details, delivery: { ...details.delivery, [key]: key === "country_code" ? event.target.value.toUpperCase() : event.target.value } })} />
              </label>)}
          </div>
        </section>}
        {isCreditNote(doc.invoice_type_code) && <label className="block space-y-2"><span className="label">Reason for credit note</span>
          <SelectMenu ariaLabel="Reason for credit note" value={details.credit_reason || ""}
            onChange={credit_reason => onChange({ ...details, credit_reason })}
            options={[{ value: "", label: "Choose a reason" }, ...CREDIT_REASONS.map(reason => ({ value: reason.code, label: reason.label }))]} />
        </label>}
      </fieldset>
      {issues.length > 0 && <ul className="divide-y divide-border border-y border-border">
        {issues.map((issue, index) => <li key={`${issue.field}-${index}`} className="py-2 flex items-center justify-between gap-3 text-sm">
          <span>{issue.label}</span>{issue.section !== "einvoice" && <button className="btn-ghost shrink-0" disabled={busy} onClick={() => onFix(issue)}>Edit</button>}
        </li>)}
      </ul>}
      {totals && <dl className="space-y-2 text-sm tabular-nums">
        {[["Net amount", totals.taxExclusive], ["VAT", totals.taxTotal], ["Advance applied", totals.prepaid], ["Rounding", totals.rounding], ["Amount due", totals.payable]].map(([label, amount]) =>
          <div key={label} className="flex justify-between gap-4"><dt>{label}</dt><dd className="font-medium">{money(Number(amount), doc.currency || "AED")}</dd></div>)}
      </dl>}
      <div className="flex flex-wrap justify-end gap-2">
        <button className="btn-ghost" disabled={busy} onClick={onClose}>Back to invoice</button>
        <button className="btn-primary" disabled={busy || issues.length > 0} onClick={onExport}><Download size={16} />{busy ? "Saving…" : "Save & export XML"}</button>
      </div>
      <p className="text-xs text-muted-foreground">Exporting a file does not submit it to Peppol or confirm tax reporting.</p>
    </div>
  </Modal>;
}
