import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import ImportCsvModal, { type ImportField } from "./ImportCsvModal";
import { Field, Modal } from "./ui";
import { DateField } from "./DatePicker";
import { billing, getCacheScope, type InvoiceDocInput } from "../lib/api";
import { groupInvoiceRows, invoiceImportIssues, readSupplierInvoice } from "../lib/invoiceImport";
import { downloadCsv } from "../lib/csv";
import { errMsg } from "../lib/format";
import { assertWorkspaceCurrent, effectiveDataMode } from "../lib/dataMode";
import { TAX_CATEGORY_CODES } from "../lib/einvoice";
import { SelectMenu } from "./ui-menu";

const fields: ImportField[] = [
  { key: "number", label: "Invoice number", required: true },
  { key: "customer_name", label: "Customer / supplier", required: true },
  { key: "issue_date", label: "Invoice date", required: true },
  { key: "description", label: "Item description", required: true },
  { key: "qty", label: "Quantity", required: true },
  { key: "unit_price", label: "Unit price", required: true },
  { key: "unit", label: "Unit" }, { key: "currency", label: "Currency" },
  { key: "tax_category", label: "Tax category" },
  { key: "customer_trn", label: "VAT TRN" },
  { key: "customer_address", label: "Billing address" },
  { key: "due_date", label: "Due date" },
];

export default function InvoiceImportModal({ base, onClose, onSaved }: {
  base: InvoiceDocInput; onClose: () => void; onSaved: () => void;
}) {
  const [mapping, setMapping] = useState(false);
  const [drafts, setDrafts] = useState<InvoiceDocInput[] | null>(null);
  const [existing, setExisting] = useState(new Set<string>());
  const [saved, setSaved] = useState(new Set<number>());
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const scope = useRef({ mode: effectiveDataMode(), account: getCacheScope() });
  const checkScope = () => {
    assertWorkspaceCurrent();
    if (scope.current.mode !== effectiveDataMode() || scope.current.account !== getCacheScope())
      throw new Error("Your workspace changed. Reopen the import in the correct workspace.");
  };
  const purchase = base.doc_type === "purchase";
  const stage = async (docs: InvoiceDocInput[]) => {
    const current = await billing.listDocs(purchase ? "purchase" : "sales");
    checkScope();
    setExisting(new Set(current.map(doc => doc.number.toLowerCase())));
    setDrafts(docs); setMapping(false); setSaved(new Set()); setError("");
  };
  const change = (index: number, patch: Partial<InvoiceDocInput>) => setDrafts(current => current!.map((doc, i) => i === index ? { ...doc, ...patch } : doc));
  const issues = (doc: InvoiceDocInput, index: number) => {
    const messages = invoiceImportIssues(doc, existing);
    if (drafts?.some((other, i) => i !== index && other.number.trim().toLowerCase() === doc.number.trim().toLowerCase())) messages.push("Use a different number for each invoice in this import.");
    return messages;
  };
  const pending = drafts?.filter((_, index) => !saved.has(index)) || [];
  const save = async () => {
    if (lock.current || !drafts) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const current = await billing.listDocs(purchase ? "purchase" : "sales");
      checkScope();
      const numbers = new Set(current.map(doc => doc.number.toLowerCase()));
      setExisting(numbers);
      for (const [index, doc] of drafts.entries()) {
        if (saved.has(index)) continue;
        checkScope();
        const problems = invoiceImportIssues(doc, numbers);
        if (problems.length) throw new Error(`${doc.number || "Invoice"}: ${problems[0]}`);
        await billing.saveDoc({ ...doc, id: undefined, status: "draft" });
        numbers.add(doc.number.toLowerCase());
        setSaved(prev => new Set(prev).add(index));
      }
      onSaved();
    } catch (cause) { setError(errMsg(cause)); onSaved(); }
    finally { lock.current = false; setBusy(false); }
  };
  if (mapping) return <ImportCsvModal open title="Map invoice columns" fields={fields} spreadsheets reviewBeforeImport
    onClose={() => setMapping(false)} onImport={async rows => stage(groupInvoiceRows(rows, base))} />;
  return <Modal open onClose={() => { if (!lock.current) onClose(); }} title={purchase ? "Review supplier invoices" : "Import invoices"} size="lg">
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Import as drafts, review the details, then post each invoice when ready. Existing records are never replaced.</p>
      {!drafts && <div className="flex flex-wrap gap-2">
        <button className="btn-primary" disabled={busy} onClick={() => setMapping(true)}><Upload size={16} /> Excel or CSV</button>
        <button className="btn-ghost" disabled={busy} onClick={() => void downloadCsv("filey-invoice-template.csv", [{ number: "INV-SAMPLE-001", customer_name: "Example Trading", issue_date: "2026-09-29", description: "Consulting", qty: 1, unit_price: 100, unit: "HUR", currency: base.currency, tax_category: "S", customer_trn: "", customer_address: "", due_date: "" }]).catch(cause => setError(errMsg(cause)))}><Download size={16} /> Download template</button>
        {purchase && <label className="btn-ghost"><Upload size={16} /> Supplier XML<input aria-label="Supplier invoice XML" type="file" accept=".xml,application/xml,text/xml" className="hidden" disabled={busy} onChange={async event => {
          const file = event.target.files?.[0]; event.target.value = "";
          if (!file || lock.current) return;
          lock.current = true; setBusy(true); setError("");
          try { if (file.size > 5 * 1024 * 1024) throw new Error("Choose a file smaller than 5 MB."); await stage([readSupplierInvoice(await file.text(), base)]); }
          catch (cause) { setError(errMsg(cause)); }
          finally { lock.current = false; setBusy(false); }
        }} /></label>}
      </div>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {drafts && <div className="divide-y divide-border">
        {drafts.map((doc, index) => <details key={index} open={drafts.length === 1 || undefined} className="py-3">
          <summary className="cursor-pointer text-sm font-medium">{doc.number || `Invoice ${index + 1}`} · {doc.customer_name || "Name missing"} · {saved.has(index) ? "Draft saved" : `${doc.items.length} items`}</summary>
          {!saved.has(index) && <fieldset disabled={busy} className="space-y-3 pt-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Invoice number"><input className="input" value={doc.number} onChange={event => change(index, { number: event.target.value })} /></Field>
              <Field label={purchase ? "Supplier" : "Customer"}><input className="input" value={doc.customer_name} onChange={event => change(index, { customer_name: event.target.value })} /></Field>
              <Field label="Invoice date"><DateField value={doc.issue_date || ""} onChange={issue_date => change(index, { issue_date })} /></Field>
              <Field label="Due date"><DateField value={doc.due_date || ""} onChange={due_date => change(index, { due_date })} /></Field>
              <Field label="Currency"><input className="input" value={doc.currency} onChange={event => change(index, { currency: event.target.value.toUpperCase() })} /></Field>
            </div>
            {doc.items.map((item, line) => <div key={line} className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <label className="col-span-2"><span className="label">Item {line + 1}</span><input className="input" value={item.description} onChange={event => change(index, { items: doc.items.map((it, i) => i === line ? { ...it, description: event.target.value } : it) })} /></label>
              {(["qty", "unit_price"] as const).map(key => <label key={key}><span className="label">{key === "qty" ? "Quantity" : "Unit price"}</span><input className="input" type="number" min="0" step="any" value={Number.isFinite(item[key]) ? item[key] : ""} onChange={event => change(index, { items: doc.items.map((it, i) => i === line ? { ...it, [key]: event.target.value === "" ? NaN : Number(event.target.value), custom: undefined } : it) })} /></label>)}
              <label><span className="label">Unit</span><input className="input" value={item.unit || ""} onChange={event => change(index, { items: doc.items.map((it, i) => i === line ? { ...it, unit: event.target.value } : it) })} /></label>
              <Field label="Tax category"><SelectMenu ariaLabel={`Item ${line + 1} tax category`} value={item.tax_category || "S"} onChange={tax_category => change(index, { items: doc.items.map((it, i) => i === line ? { ...it, tax_category } : it) })} options={TAX_CATEGORY_CODES.map(category => ({ value: category.code, label: category.label }))} /></Field>
            </div>)}
          </fieldset>}
          {!saved.has(index) && issues(doc, index).map(message => <p key={message} className="text-xs text-danger mt-2">{message}</p>)}
        </details>)}
      </div>}
      <div className="flex flex-wrap justify-end gap-2">
        <button className="btn-ghost" disabled={busy} onClick={onClose}>{saved.size ? "Done" : "Cancel"}</button>
        {drafts && <button className="btn-primary" onClick={() => void save()} disabled={busy || !pending.length || drafts.some((doc, index) => !saved.has(index) && issues(doc, index).length > 0)}>{busy ? "Saving drafts…" : `Save ${pending.length} drafts`}</button>}
      </div>
      {saved.size > 0 && <p role="status" className="text-sm text-success">{saved.size} drafts saved. Review them in {purchase ? "Purchase Invoices" : "Invoicing"} before posting.</p>}
    </div>
  </Modal>;
}
