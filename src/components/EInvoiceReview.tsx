import { useId, useMemo, useState } from "react";
import { CheckCircle2, AlertCircle, Download, ArrowRight } from "lucide-react";
import { Badge, Field, Modal } from "./ui";
import { SelectMenu } from "./ui-menu";
import { DateField } from "./DatePicker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs";
import EInvoicePartyFields from "./EInvoicePartyFields";
import { CREDIT_REASONS, decodeTransactionType, encodeTransactionType, isCreditNote, buyerEndpoint,
  PINT_AE_INVOICE_TYPE_CODES, PAYMENT_MEANS_CODES, EMIRATES, TRANSACTION_TYPE_FLAGS,
  type EInvoiceDetails, type EInvoiceParty } from "../lib/einvoice";
import { computeTotals, eInvoiceIssues, unitCode, type EInvoiceDoc, type EInvoiceIssue } from "../lib/einvoiceXml";
import { money } from "../lib/format";

const GROUPS = [
  { id: "invoice", title: "Invoice", description: "Document number, dates, currency and transaction scenario." },
  { id: "seller", title: "Seller", description: "Your business address, tax identity and legal registration." },
  { id: "buyer", title: "Buyer", description: "Customer billing details and electronic delivery identity." },
  { id: "items", title: "Items", description: "Descriptions, quantities, units, prices and classifications." },
  { id: "tax", title: "Tax & Payment", description: "VAT categories, totals, exchange rate and payment details." },
] as const;
type GroupId = typeof GROUPS[number]["id"];

function issueGroup(issue: EInvoiceIssue): GroupId {
  if (/^(seller_|einvoice\.seller)/.test(issue.field)) return "seller";
  if (/^(customer_|buyer_|einvoice\.buyer)/.test(issue.field)) return "buyer";
  if (/^(payment_|due_date$|tax_rate$|discount$|advance_applied$|aed_exchange_rate$|einvoice\.payment_)/.test(issue.field) ||
    /^items\.\d+\.(tax|tax_category|discount|custom\.einvoice_(exemption_code|nature))/.test(issue.field)) return "tax";
  if (issue.section === "items") return "items";
  return "invoice";
}

export default function EInvoiceReview<T extends EInvoiceDoc>({ open, doc, busy, onClose, onCloseAutoFocus, onChange, onDocumentChange, onFix, onExport, bankAccount, embedded = false }: {
  open: boolean; doc: T; busy: boolean; onClose: () => void;
  onChange: (details: EInvoiceDetails) => void;
  onDocumentChange?: (doc: T) => void;
  onCloseAutoFocus?: (event: Event) => void;
  onFix: (issue: EInvoiceIssue) => void;
  onExport: () => void;
  bankAccount?: { id: string; name?: string };
  embedded?: boolean;
}) {
  const id = useId();
  const issues = useMemo(() => eInvoiceIssues(doc), [doc]);
  const [group, setGroup] = useState<GroupId>("invoice");
  const totals = issues.some(issue => issue.section === "items") ? null : computeTotals(doc);
  const details = doc.einvoice || {};
  const flags = decodeTransactionType(doc.transaction_type);
  const endpoint = buyerEndpoint(details, doc.buyer_country_code || "AE");
  const fieldId = (field: string) => `${id}-${field.replace(/\./g, "-")}`;
  const error = (field: string) => issues.find(issue => issue.field === field)?.label;
  const set = (key: keyof EInvoiceDoc, value: string | number) => onDocumentChange?.({ ...doc, [key]: value });
  const text = (key: keyof EInvoiceDoc, label: string, required = false, hint?: string, multiline = false) => (
    <Field label={label} required={required && !embedded} error={error(key)} hint={hint}>
      {multiline ? <textarea id={fieldId(key)} className="textarea" rows={2} value={String(doc[key] || "")}
        disabled={!onDocumentChange} onChange={event => set(key, event.target.value)} />
        : <input id={fieldId(key)} className="input" value={String(doc[key] || "")} disabled={!onDocumentChange}
          onChange={event => set(key, key.endsWith("country_code") ? event.target.value.toUpperCase() : event.target.value)} />}
    </Field>
  );
  const date = (key: "issue_date" | "due_date" | "date_of_supply" | "original_invoice_date", label: string, required = false) => (
    <Field label={label} required={required && !embedded} error={error(key)}><DateField id={fieldId(key)} value={doc[key] || ""}
      disabled={!onDocumentChange} onChange={value => set(key, value)} /></Field>
  );
  const identityErrors = (role: "seller" | "buyer") => Object.fromEntries(issues
    .filter(issue => issue.field.startsWith(`einvoice.${role}.`))
    .map(issue => [issue.field.slice(`einvoice.${role}.`.length), issue.label])) as Partial<Record<keyof EInvoiceParty, string>>;
  const fix = (issue: EInvoiceIssue) => {
    const alias = issue.field === "seller_legal_id" ? "einvoice.seller.legal_id" : issue.field === "seller_legal_id_type" ? "einvoice.seller.legal_id_type" : issue.field;
    const target = document.getElementById(fieldId(alias));
    if (target) { target.scrollIntoView?.({ block: "center" }); target.focus({ preventScroll: true }); }
    else onFix(issue);
  };
  const selectedIssues = issues.filter(issue => issueGroup(issue) === group);
  const isCredit = isCreditNote(doc.invoice_type_code);
  const content = (
    <div data-einvoice-review className="space-y-5">
      {embedded && <p className="text-sm text-muted-foreground">Optional for drafts. Use your saved company and customer details or enter values manually. You can save without completing these fields; the checks below apply when preparing XML.</p>}
      <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-4" role="status">
        {issues.length ? <AlertCircle size={22} className="mt-0.5 shrink-0 text-warning" /> : <CheckCircle2 size={22} className="mt-0.5 shrink-0 text-success" />}
        <div className="min-w-0"><p className="font-semibold">{issues.length ? embedded ? `${issues.length} ${issues.length === 1 ? "detail" : "details"} to review before XML export` : `${issues.length} ${issues.length === 1 ? "detail needs" : "details need"} attention` : "Ready for XML preparation"}</p>
          <p className="mt-1 text-sm text-muted-foreground">Filey checks required details and supported PINT-AE rules. Your accredited service provider (ASP) must validate and transmit the structured invoice.</p></div>
      </div>
      <Tabs value={group} onValueChange={value => setGroup(value as GroupId)}>
        <TabsList aria-label="E-invoice review groups" className="grid w-full grid-cols-2 gap-2 border-0 sm:grid-cols-5">
          {GROUPS.map(item => {
            const count = issues.filter(issue => issueGroup(issue) === item.id).length;
            return <TabsTrigger key={item.id} value={item.id} disabled={busy}
              className="min-h-20 flex-col items-start rounded-lg border border-border px-3 text-left data-[state=active]:bg-muted data-[state=active]:after:hidden">
              <span>{item.title}</span><Badge tone={count ? "warn" : "success"}>{count ? `${count} to review` : "Checks passed"}</Badge>
            </TabsTrigger>;
          })}
        </TabsList>
        {GROUPS.map(item => <TabsContent key={item.id} value={item.id}>
          <section aria-label={`${item.title} review`} className="space-y-4">
            <div><h3 className="text-base font-semibold">{item.title}</h3><p className="mt-1 text-sm text-muted-foreground">{item.description}</p></div>
            {selectedIssues.length > 0 && <ul aria-label={`${item.title} issues`} className="divide-y divide-border rounded-lg border border-border">
              {selectedIssues.map((issue, index) => <li key={`${issue.field}-${index}`} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                <span className="pt-2">{issue.label}</span><button type="button" className="btn-ghost min-h-11 shrink-0" disabled={busy}
                  aria-label={`Edit: ${issue.label}`} onClick={() => fix(issue)}>Edit <ArrowRight size={14} /></button>
              </li>)}
            </ul>}
            <fieldset disabled={busy} className="space-y-4">
              {item.id === "invoice" && <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {text("number", "Invoice number", true)}{date("issue_date", "Invoice date", true)}
                  <Field label="Invoice type" required={!embedded} error={error("invoice_type_code")}><SelectMenu id={fieldId("invoice_type_code")} ariaLabel="Invoice type"
                    disabled={!onDocumentChange} value={doc.invoice_type_code || "380"} onChange={value => set("invoice_type_code", value)}
                    options={PINT_AE_INVOICE_TYPE_CODES.map(code => ({ value: code.code, label: `${code.code} · ${code.label}` }))} /></Field>
                  {text("currency", "Currency code", true, "Three-letter ISO currency code, such as AED.")}
                  {date("date_of_supply", "Date of supply (if different)")}
                  {isCredit && <>{text("original_invoice_number", "Original invoice number", details.credit_reason !== "VD")}{date("original_invoice_date", "Original invoice date (optional)")}
                    <Field label="Reason for credit note" required={!embedded} error={error("einvoice.credit_reason")}><SelectMenu id={fieldId("einvoice.credit_reason")} ariaLabel="Reason for credit note"
                      value={details.credit_reason || ""} onChange={credit_reason => onChange({ ...details, credit_reason })}
                      options={[{ value: "", label: "Choose a reason" }, ...CREDIT_REASONS.map(reason => ({ value: reason.code, label: reason.label }))]} /></Field></>}
                </div>
                <div><p className="label">Transaction scenario</p><div id={fieldId("transaction_type")} tabIndex={-1} className="flex flex-wrap gap-2">
                  {TRANSACTION_TYPE_FLAGS.filter(flag => ["freeZone", "exports"].includes(flag.key)).map(flag => <button key={flag.key} type="button"
                    className="btn-outline min-h-11" disabled={!onDocumentChange} aria-pressed={flags[flag.key]}
                    onClick={() => set("transaction_type", encodeTransactionType({ ...flags, [flag.key]: !flags[flag.key] }))}>{flag.label}</button>)}
                  <button type="button" className="btn-ghost min-h-11" onClick={() => onFix({ field: "transaction_type", label: "Transaction scenario", section: "details" })}>Other scenarios</button>
                </div><p className="mt-2 text-xs text-muted-foreground">Select only the scenarios that apply. Additional scenarios require your provider’s workflow.</p></div>
                {flags.freeZone && <Field label="Free-zone beneficiary identifier" required={!embedded} error={error("einvoice.beneficiary_id")} hint="Actual beneficiary TRN or TIN for this transaction.">
                  <input id={fieldId("einvoice.beneficiary_id")} className="input" value={details.beneficiary_id || ""} onChange={event => onChange({ ...details, beneficiary_id: event.target.value })} />
                </Field>}
                {flags.exports && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {([["address", "Delivery address"], ["city", "Delivery city"], ["region", "Delivery region"], ["country_code", "Delivery country code"]] as const).map(([key, label]) =>
                    <Field key={key} label={label} required={!embedded} error={error(`einvoice.delivery.${key}`)}><input id={fieldId(`einvoice.delivery.${key}`)} className="input" value={details.delivery?.[key] || ""}
                      maxLength={key === "country_code" ? 2 : undefined} placeholder={key === "country_code" ? "Two-letter country code, e.g. IN" : undefined}
                      onChange={event => onChange({ ...details, delivery: { ...details.delivery, [key]: key === "country_code" ? event.target.value.toUpperCase() : event.target.value } })} /></Field>)}
                </div>}
              </>}
              {(item.id === "seller" || item.id === "buyer") && <>
                <p className="text-xs text-muted-foreground">Edits apply to this invoice. Your saved business and customer profiles keep their existing details.</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {text(item.id === "seller" ? "seller_name" : "customer_name", `${item.title} name`, true)}
                  {text(item.id === "seller" ? "seller_address" : "customer_address", `${item.title} street address`, true, undefined, true)}
                  {text(item.id === "seller" ? "seller_city" : "buyer_city", `${item.title} city`, true)}
                  {item.id === "buyer" && text("buyer_country_code", "Buyer country code", true, "Two-letter ISO country code, such as AE.")}
                  {item.id === "seller" || (doc.buyer_country_code || "AE") === "AE" ? <Field label={`${item.title} emirate`} required={!embedded} error={error(item.id === "seller" ? "seller_country_subdivision" : "buyer_country_subdivision")}>
                    <SelectMenu id={fieldId(item.id === "seller" ? "seller_country_subdivision" : "buyer_country_subdivision")} ariaLabel={`${item.title} emirate`} disabled={!onDocumentChange}
                      value={(item.id === "seller" ? doc.seller_country_subdivision : doc.buyer_country_subdivision) || ""}
                      onChange={value => set(item.id === "seller" ? "seller_country_subdivision" : "buyer_country_subdivision", value)}
                      options={[{ value: "", label: "Choose an emirate" }, ...EMIRATES.map(em => ({ value: em.code, label: em.label }))]} /></Field>
                    : text("buyer_country_subdivision", "Buyer region", true)}
                  {text(item.id === "seller" ? "seller_trn" : "customer_trn", `${item.title} VAT TRN`, false,
                    item.id === "seller" ? "Required for a VAT tax invoice; use a commercial invoice where applicable." : "Required if VAT registered; required for domestic reverse charge.")}
                </div>
                {item.id === "buyer" && <Field label="Customer e-invoice delivery" required={!embedded} error={error("einvoice.buyer_delivery_mode")}>
                  <SelectMenu id={fieldId("einvoice.buyer_delivery_mode")} ariaLabel="Customer e-invoice delivery" value={details.buyer_delivery_mode || "peppol"}
                    onChange={mode => onChange({ ...details, buyer_delivery_mode: mode as EInvoiceDetails["buyer_delivery_mode"] })}
                    options={[{ value: "peppol", label: "Registered electronic address" }, { value: "export-unregistered", label: "Export buyer without a Peppol identifier" },
                      { value: "outside-uae-scope", label: "Buyer not onboarded / outside UAE scope" }]} />
                  {details.buyer_delivery_mode && details.buyer_delivery_mode !== "peppol" && <p className="mt-2 text-xs text-muted-foreground">This explicit delivery choice uses {endpoint.scheme}:{endpoint.id}. Enter the buyer’s actual business or person identifier below.</p>}
                </Field>}
                <EInvoicePartyFields idPrefix={fieldId(`einvoice.${item.id}`)} errors={{ ...identityErrors(item.id), ...(item.id === "seller" ? {
                  legal_id: error("seller_legal_id") || error("einvoice.seller.legal_id"), legal_id_type: error("seller_legal_id_type") || error("einvoice.seller.legal_id_type") } : {}) }}
                  value={item.id === "seller" ? { ...details.seller, legal_id: doc.seller_legal_id || details.seller?.legal_id, legal_id_type: doc.seller_legal_id_type || details.seller?.legal_id_type } : details.buyer}
                  includeIdentifier={item.id === "buyer"}
                  onChange={party => item.id === "seller" && onDocumentChange ? onDocumentChange({ ...doc, seller_legal_id: party.legal_id, seller_legal_id_type: party.legal_id_type,
                    einvoice: { ...details, seller: party } }) : onChange({ ...details, [item.id]: party })} />
              </>}
              {item.id === "items" && <>
                <p className="text-sm text-muted-foreground">{doc.items.length} {doc.items.length === 1 ? "line" : "lines"}. Each line needs a description, a positive quantity, a recognised unit and a valid price. Goods and service classifications are checked when supplied.</p>
                <div className="divide-y divide-border rounded-lg border border-border">{doc.items.map((line, index) => <div key={index} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <div className="min-w-0"><p className="truncate font-medium">{index + 1}. {line.description || "Missing description"}</p><p className="mt-1 text-xs text-muted-foreground">{line.qty} {line.unit || `piece (${unitCode(line.unit)})`} · {money(line.unit_price, doc.currency || "AED")}</p></div>
                  <button type="button" className="btn-ghost min-h-11 shrink-0" onClick={() => onFix({ field: `items.${index}.description`, label: `Line ${index + 1}`, section: "items" })}>Edit line</button>
                </div>)}</div>
                {!doc.items.length && <button type="button" className="btn-outline min-h-11" onClick={() => onFix({ field: "items", label: "Add an item", section: "items" })}>Add an item</button>}
              </>}
              {item.id === "tax" && <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Payment method" required={!isCredit && !embedded} error={error("payment_means_code")}><SelectMenu id={fieldId("payment_means_code")} ariaLabel="Payment method" disabled={!onDocumentChange}
                    value={doc.payment_means_code || ""} onChange={value => set("payment_means_code", value)} options={[{ value: "", label: isCredit ? "Not specified (optional for credit notes)" : "Choose a payment method" },
                      ...PAYMENT_MEANS_CODES.map(code => ({ value: code.code, label: `${code.code} · ${code.label}` }))]} /></Field>
                  {date("due_date", "Payment due date", !isCredit && (totals?.payable || 0) > 0)}
                  {(doc.currency || "AED") !== "AED" && <Field label="Exchange rate to AED" required={!embedded} error={error("aed_exchange_rate")} hint={`1 ${doc.currency} equals this amount in AED.`}>
                    <input id={fieldId("aed_exchange_rate")} type="number" step="0.000001" min="0" className="input" value={doc.aed_exchange_rate ?? doc.fx_rate ?? ""}
                      disabled={!onDocumentChange} onChange={event => set("aed_exchange_rate", event.target.value === "" ? 0 : Number(event.target.value))} /></Field>}
                  {doc.payment_means_code === "30" && <><Field label="Bank account / IBAN" required={!embedded} error={error("einvoice.payment_account_id")}>
                    <input id={fieldId("einvoice.payment_account_id")} className="input" value={details.payment_account_id || ""} onChange={event => onChange({ ...details, payment_account_id: event.target.value })} /></Field>
                    <Field label="Account name"><input id={fieldId("einvoice.payment_account_name")} className="input" value={details.payment_account_name || ""} onChange={event => onChange({ ...details, payment_account_name: event.target.value })} /></Field>
                    {bankAccount && <button type="button" className="btn-ghost min-h-11 justify-self-start" onClick={() => onChange({ ...details, payment_account_id: bankAccount.id, payment_account_name: bankAccount.name })}>Use saved bank account</button>}</>}
                  {error("advance_applied") && <Field label="Advance applied" error={error("advance_applied")}>
                    <button id={fieldId("advance_applied")} type="button" className="btn-outline min-h-11 justify-self-start" disabled={!onDocumentChange}
                      onClick={() => set("advance_applied", 0)}>Clear invalid advance</button>
                  </Field>}
                </div>
                {totals ? <div className="rounded-lg border border-border p-4"><dl className="space-y-2 text-sm tabular-nums">
                  {[["Net amount", totals.taxExclusive], ["VAT", totals.taxTotal], ["Advance applied", totals.prepaid], ["Rounding", totals.rounding], ["Amount due", totals.payable]].map(([label, amount]) =>
                    <div key={label} className="flex justify-between gap-4"><dt>{label}</dt><dd className="font-medium">{money(Number(amount), doc.currency || "AED")}</dd></div>)}
                </dl><dl aria-label="VAT breakdown" className="mt-4 space-y-2 border-t border-border pt-3 text-xs tabular-nums">
                  {totals.rows.map(row => <div key={row.category} className="flex flex-wrap justify-between gap-2"><dt>{row.category} · {row.rate}% · {money(row.taxable, doc.currency || "AED")} taxable</dt><dd>{money(row.tax, doc.currency || "AED")} VAT</dd></div>)}
                </dl><p className="mt-3 text-xs text-muted-foreground">Totals and the VAT breakdown are calculated from the invoice lines and discounts.</p></div>
                  : <p className="text-sm text-muted-foreground">Resolve line errors to review calculated totals.</p>}
                <button type="button" className="btn-ghost min-h-11" onClick={() => onFix({ field: "tax_rate", label: "Line VAT categories and discounts", section: "items" })}>Edit line tax & discounts <ArrowRight size={14} /></button>
              </>}
            </fieldset>
          </section>
        </TabsContent>)}
      </Tabs>
      <div className="border-t border-border pt-4">
        <p className="text-xs text-muted-foreground">Filey generates line identifiers, calculated totals and the PINT-AE specification metadata. A document UUID is assigned when you save. This check is not FTA approval, schema certification or confirmation of reporting.</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-ghost min-h-11" disabled={busy} onClick={onClose}>{embedded ? "Back to details" : "Back to invoice"}</button>
          <button type="button" className="btn-primary min-h-11" disabled={busy || issues.length > 0} onClick={onExport}><Download size={16} />{busy ? "Saving…" : "Save & export XML"}</button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Exporting XML does not send it to the buyer or report it to the FTA. Submit through your ASP.</p>
        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">References:
          <a className="underline underline-offset-2 hover:text-foreground" href="https://mof.gov.ae/wp-content/uploads/2026/02/UAE-Electronic-Invoice-mandatory-fields_V-1.0-23Feb2026.pdf" target="_blank" rel="noopener noreferrer">MoF mandatory fields</a>
          <a className="underline underline-offset-2 hover:text-foreground" href="https://mof.gov.ae/wp-content/uploads/2026/06/UAE-Electronic-Invoicing-Guidelines_V-1.1-01June2026.pdf" target="_blank" rel="noopener noreferrer">MoF guidance</a>
          <a className="underline underline-offset-2 hover:text-foreground" href="https://docs.peppol.eu/poac/ae/pint-ae/" target="_blank" rel="noopener noreferrer">PINT-AE 1.0.4</a>
        </p>
      </div>
    </div>
  );
  return embedded ? <section aria-label="E-invoice details">{content}</section>
    : <Modal open={open} onClose={() => { if (!busy) onClose(); }} onCloseAutoFocus={onCloseAutoFocus} title="Check E-invoice" size="2xl">{content}</Modal>;
}
