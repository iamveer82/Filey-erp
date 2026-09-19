import { FileySpinner as Loader2 } from "../components/FileySpinner";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, Download, FileText, Paperclip, Plus, Receipt, Trash2, X } from "lucide-react";
import { fin, type Account, type Expense } from "../lib/api";
import { PageHeader, Field, ErrorBanner } from "../components/ui";
import { useUI } from "../lib/ui";
import { CURRENCIES, errMsg, getDisplayCurrency, money, todayYmd } from "../lib/format";
import { r2 } from "../lib/money";
import { getExchangeRates } from "../lib/exchange-rates";
import { agentStorageScope } from "../lib/agentStorage";
import { isLocalMode } from "../lib/dataMode";
import { uploadUserFile, getSavedFile, fileBytes } from "../lib/files";
import { EXPENSE_CATEGORIES, EXPENSE_METHODS, expenseTotals, validateExpense, validateReceipt, type ExpenseDetails } from "../lib/expenseDetails";

const emptyDetails = (): ExpenseDetails => ({ version: 1, submission_id: crypto.randomUUID(), vendor: "", reference: "", currency: getDisplayCurrency() || "AED", fx_rate: getDisplayCurrency() === "AED" ? 1 : 0,
  items: [{ description: "", qty: 1, unit: "pcs", unit_price: 0 }], discount: 0, tax_rate: 0, payment_method: "Cash", payment_account_id: null, notes: "" });

export default function ExpenseEntry() {
  const { id } = useParams();
  const readonly = !!id;
  const navigate = useNavigate();
  const { toast, confirm } = useUI();
  const [details, setDetails] = useState(emptyDetails);
  const [category, setCategory] = useState("Office Supplies");
  const [date, setDate] = useState(todayYmd);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [expense, setExpense] = useState<Expense | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [dragging, setDragging] = useState(false);
  const busy = useRef(false);
  const scope = useRef(agentStorageScope());
  const uploaded = useRef<{ file: File; attachment: NonNullable<ExpenseDetails["receipt"]> } | null>(null);
  const checkScope = () => { if (scope.current !== agentStorageScope()) throw new Error("Workspace changed. Reopen Purchase before saving."); };
  const totals = expenseTotals(details);
  const locked = saving || loading || readonly;
  const set = <K extends keyof ExpenseDetails>(key: K, value: ExpenseDetails[K]) => { setDetails(previous => ({ ...previous, [key]: value })); setDirty(true); };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const accounts = await fin.accounts();
        const record = id ? await fin.getExpense(Number(id)) : null;
        if (cancelled) return;
        checkScope();
        setAccounts(accounts);
        if (record) {
          setExpense(record); setCategory(record.category); setDate(record.expense_date); setAccountId(record.account_id || null);
          setDetails(record.details || { ...emptyDetails(), currency: "AED", fx_rate: 1, items: [{ description: record.description || record.category, qty: 1, unit: "item", unit_price: record.amount }] });
        }
      } catch (cause) { if (!cancelled) setError(errMsg(cause)); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [id]);
  useEffect(() => {
    if (readonly || details.currency === "AED") return;
    let cancelled = false;
    void getExchangeRates().then(rates => { if (!cancelled && rates[details.currency]) setDetails(previous => previous.fx_rate > 0 ? previous : { ...previous, fx_rate: rates[details.currency] }); }).catch(() => {});
    return () => { cancelled = true; };
  }, [details.currency, readonly]);
  useEffect(() => {
    if (!receipt || !receipt.type.startsWith("image/")) { setPreview(""); return; }
    const url = URL.createObjectURL(receipt); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [receipt]);
  useEffect(() => {
    if (!dirty || readonly) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, readonly]);
  const back = async () => {
    if (saving) return;
    if (!dirty || readonly || await confirm({ title: "Discard this expense?", message: "Your unsaved details will be lost.", confirmLabel: "Discard", danger: true })) navigate("/purchase");
  };
  const attach = (files: FileList | null) => {
    if (locked || !files?.length) return;
    try {
      if (files.length !== 1) throw new Error("Choose one receipt per expense.");
      validateReceipt(files[0]); setReceipt(files[0]); uploaded.current = null; setError(""); setDirty(true);
    } catch (cause) { setError(errMsg(cause)); }
  };
  const save = async () => {
    if (busy.current || locked) return;
    busy.current = true; setSaving(true); setError("");
    try {
      checkScope();
      const amount = r2(totals.total * details.fx_rate);
      let input = { ...details, vendor: details.vendor.trim(), reference: details.reference.trim(), items: details.items.map(item => ({ ...item, description: item.description.trim(), unit: item.unit.trim() })) };
      validateExpense(category, amount, date, input);
      if (receipt) {
        const mime = validateReceipt(receipt);
        if (uploaded.current?.file !== receipt) {
          const fileId = await uploadUserFile(receipt, "expense-receipt");
          uploaded.current = { file: receipt, attachment: { id: fileId, name: receipt.name, mime, size: receipt.size } };
        }
        input = { ...input, receipt: uploaded.current.attachment };
      }
      checkScope();
      const expenseId = await fin.createExpense(category, `${input.vendor} — ${input.items.map(item => item.description).join(", ")}`.slice(0, 2000), amount, date, accountId, input);
      checkScope(); setDirty(false); toast.success("Expense saved and posted to accounting.");
      navigate(`/purchase/${expenseId}`, { replace: true });
    } catch (cause) { setError(`${errMsg(cause)}${uploaded.current ? " Your receipt is kept in My Files; retrying will reuse it." : ""}`); }
    finally { busy.current = false; setSaving(false); }
  };
  const downloadReceipt = async () => {
    if (!details.receipt || downloading) return;
    setDownloading(true);
    try {
      checkScope();
      const file = await getSavedFile(details.receipt.id);
      const bytes = await fileBytes(file);
      if (!bytes) throw new Error("Receipt contents could not be loaded.");
      checkScope();
      const { downloadFile } = await import("../lib/pdfTools");
      await downloadFile({ name: file.name, bytes });
    } catch (cause) { setError(errMsg(cause)); }
    finally { setDownloading(false); }
  };
  if (loading) return <div role="status" className="py-10 text-sm text-muted-foreground">Loading expense details…</div>;
  if (readonly && !expense) return <div className="space-y-4"><Link to="/purchase" className="btn-ghost"><ArrowLeft size={16} />Purchase</Link><ErrorBanner message={error || "Expense not found."} /></div>;

  return <div className="mx-auto max-w-[1280px]">
    <button type="button" className="btn-ghost mb-4" onClick={() => void back()} disabled={saving}><ArrowLeft size={16} />Purchase</button>
    <PageHeader title={readonly ? "Expense details" : "Log expense"} subtitle={readonly ? "Saved purchase details and supporting receipt" : "Record what you bought, how you paid and keep the receipt together"} action={readonly ? <Link to="/purchase/new" className="btn-primary"><Plus size={16} />Log expense</Link> : <><button type="button" className="btn-ghost" onClick={() => void back()} disabled={saving}>Cancel</button><button type="submit" form="expense-form" className="btn-primary" disabled={saving}>{saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}{saving ? "Saving expense…" : "Save expense"}</button></>} />
    {error && <div className="mb-5"><ErrorBanner message={error} /></div>}
    <form id="expense-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
        <fieldset disabled={locked} className="min-w-0 space-y-6" aria-busy={saving}>
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-4 text-sm font-semibold">Purchase details</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Vendor / paid to"><input aria-label="Vendor / paid to" className="input" required={!readonly} maxLength={200} value={details.vendor} onChange={event => set("vendor", event.target.value)} placeholder="Business or person you paid" /></Field>
              <Field label="Expense date"><input aria-label="Expense date" className="input" type="date" required value={date} onChange={event => { setDate(event.target.value); setDirty(true); }} /></Field>
              <Field label="Category"><select aria-label="Expense category" className="select" value={category} onChange={event => { setCategory(event.target.value); setDirty(true); }}>{[...new Set([...EXPENSE_CATEGORIES, category])].map(value => <option key={value}>{value}</option>)}</select></Field>
              <Field label="Receipt / invoice number"><input aria-label="Receipt / invoice number" className="input" maxLength={200} value={details.reference} onChange={event => set("reference", event.target.value)} placeholder="Optional reference" /></Field>
              <Field label="Currency"><select aria-label="Expense currency" className="select" value={details.currency} onChange={event => { set("currency", event.target.value); set("fx_rate", event.target.value === "AED" ? 1 : 0); }}>{CURRENCIES.map(currency => <option key={currency.code} value={currency.code}>{currency.code} — {currency.name}</option>)}</select></Field>
              {details.currency !== "AED" && <Field label={`Exchange rate · AED per 1 ${details.currency}`}><input aria-label="Exchange rate" className="input" type="number" min="0.000001" step="any" required value={details.fx_rate || ""} onChange={event => set("fx_rate", Number(event.target.value))} /><p className="mt-1 text-xs text-muted-foreground">Confirm the rate on your receipt. Saved with this expense.</p></Field>}
            </div>
          </section>
          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between gap-3 p-5"><div><h2 className="text-sm font-semibold">Items</h2><p className="mt-1 text-xs text-muted-foreground">Enter prices before tax.</p></div><span className="text-xs text-muted-foreground">{details.items.length} {details.items.length === 1 ? "item" : "items"}</span></div>
            <div className="divide-y divide-border">
              {details.items.map((item, index) => <div key={index} className="grid grid-cols-2 gap-3 px-5 py-4 sm:grid-cols-[minmax(160px,1fr)_72px_80px_100px_40px]">
                <div className="col-span-2 sm:col-span-1"><Field label="Item description"><textarea aria-label={`Item ${index + 1} description`} required maxLength={1000} rows={2} className="textarea min-h-10" value={item.description} placeholder="What did you buy?" onChange={event => set("items", details.items.map((line, i) => i === index ? { ...line, description: event.target.value } : line))} /></Field></div>
                <Field label="Qty"><input aria-label={`Item ${index + 1} quantity`} className="input" type="number" min="0.000001" step="any" required value={item.qty || ""} onChange={event => set("items", details.items.map((line, i) => i === index ? { ...line, qty: Number(event.target.value) } : line))} /></Field>
                <Field label="Unit"><input aria-label={`Item ${index + 1} unit`} className="input" list="expense-units" required maxLength={30} value={item.unit} onChange={event => set("items", details.items.map((line, i) => i === index ? { ...line, unit: event.target.value } : line))} /></Field>
                <Field label="Unit price"><input aria-label={`Item ${index + 1} unit price`} className="input" type="number" min="0" step="any" required value={item.unit_price} onChange={event => set("items", details.items.map((line, i) => i === index ? { ...line, unit_price: Number(event.target.value) } : line))} /></Field>
                {!readonly && <button type="button" aria-label={`Remove item ${index + 1}`} disabled={details.items.length === 1} className="btn-ghost h-10 w-10 !p-0 self-end sm:self-start sm:mt-6" onClick={() => set("items", details.items.filter((_, i) => i !== index))}><Trash2 size={15} /></button>}
                <p className="col-span-2 text-right text-xs tabular-nums sm:col-span-5">Line total <strong className="ml-2 font-medium">{money(r2(item.qty * item.unit_price), details.currency)}</strong></p>
              </div>)}
            </div>
            {!readonly && <div className="border-t border-border px-5 py-3"><button type="button" className="btn-ghost" disabled={details.items.length >= 100} onClick={() => set("items", [...details.items, { description: "", qty: 1, unit: "pcs", unit_price: 0 }])}><Plus size={15} />Add item</button></div>}
            <datalist id="expense-units">{["pcs", "item", "box", "pack", "kg", "litre", "hour", "day", "month", "service"].map(unit => <option key={unit} value={unit} />)}</datalist>
          </section>
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-4 text-sm font-semibold">Payment & notes</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Payment method"><select aria-label="Payment method" className="select" value={details.payment_method} onChange={event => set("payment_method", event.target.value)}>{EXPENSE_METHODS.map(value => <option key={value}>{value}</option>)}</select></Field>
              <Field label="Paid from"><select aria-label="Paid from account" className="select" value={details.payment_account_id ?? ""} onChange={event => set("payment_account_id", event.target.value ? Number(event.target.value) : null)}><option value="">Default Cash & Bank</option>{accounts.filter(account => account.account_type === "asset" && /cash|bank/i.test(account.name)).map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></Field>
              <Field label="Expense account"><select aria-label="Expense account" className="select" value={accountId ?? ""} onChange={event => { setAccountId(event.target.value ? Number(event.target.value) : null); setDirty(true); }}><option value="">Default Operating Expenses</option>{accounts.filter(account => account.account_type === "expense").map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></Field>
              <p className="self-center text-xs text-muted-foreground">Logs a paid expense, including tax. For unpaid supplier bills or recoverable input tax, use Purchase Invoices.</p>
              <div className="sm:col-span-2"><Field label="Notes"><textarea aria-label="Expense notes" className="textarea min-h-20" rows={3} maxLength={5000} value={details.notes} onChange={event => set("notes", event.target.value)} placeholder="Business purpose or extra details (optional)" /></Field></div>
            </div>
          </section>
        </fieldset>
        <aside className="min-w-0 space-y-5 xl:sticky xl:top-5">
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-4 text-sm font-semibold">Expense total</h2>
            <dl className="space-y-3 text-sm tabular-nums"><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Subtotal</dt><dd>{money(totals.subtotal, details.currency)}</dd></div></dl>
            <fieldset disabled={locked} className="my-4 grid min-w-0 grid-cols-2 gap-3"><Field label={`Discount (${details.currency})`}><input aria-label="Expense discount" className="input" type="number" min="0" step="0.01" value={details.discount} onChange={event => set("discount", Number(event.target.value))} /></Field><Field label="Tax (%)"><input aria-label="Expense tax rate" className="input" type="number" min="0" max="100" step="any" value={details.tax_rate} onChange={event => set("tax_rate", Number(event.target.value))} /></Field></fieldset>
            <dl className="space-y-3 text-sm tabular-nums"><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Tax amount</dt><dd>{money(totals.tax, details.currency)}</dd></div><div className="flex justify-between gap-3 border-t border-border pt-4 text-base font-semibold"><dt>Total paid</dt><dd>{money(totals.total, details.currency)}</dd></div></dl>
            {details.currency !== "AED" && <p className="mt-2 text-xs text-muted-foreground">{money(expense?.amount ?? r2(totals.total * details.fx_rate), "AED")} in accounting</p>}
          </section>
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Paperclip size={16} />Receipt</h2>
            {readonly ? details.receipt ? <div className="space-y-3"><FileText size={24} className="text-muted-foreground" /><p className="break-words text-sm">{details.receipt.name}</p><button type="button" className="btn-ghost w-full" disabled={downloading} onClick={() => void downloadReceipt()}>{downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}Download receipt</button></div> : <p className="text-sm text-muted-foreground">No receipt attached.</p> : receipt ? <div className="space-y-3">{preview ? <img src={preview} alt="Receipt preview" className="max-h-48 w-full rounded-[8px] object-contain" /> : <FileText size={28} className="text-muted-foreground" />}<p className="break-words text-sm font-medium">{receipt.name}</p><p className="text-xs text-muted-foreground">{(receipt.size / 1024).toFixed(1)} KB · Ready to save</p><button type="button" className="btn-ghost w-full" disabled={saving} onClick={() => { setReceipt(null); uploaded.current = null; setDirty(true); }}><X size={15} />Remove receipt</button></div> : <label className={`relative flex cursor-pointer flex-col items-center gap-2 rounded-[8px] border border-dashed p-5 text-center focus-within:ring-2 focus-within:ring-ring ${dragging ? "border-foreground bg-hover" : "border-border hover:bg-hover"}`} onDragOver={event => { event.preventDefault(); if (!saving) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); attach(event.dataTransfer.files); }}><Receipt size={26} className="text-muted-foreground" /><span className="text-sm font-medium">Attach receipt</span><span className="text-xs text-muted-foreground">Drop a file or browse<br />PDF, PNG, JPG, WebP · Up to 10 MB</span><input type="file" className="sr-only" aria-label="Attach receipt" accept="application/pdf,image/png,image/jpeg,image/webp" disabled={saving} onChange={event => { attach(event.target.files); event.target.value = ""; }} /></label>}
            {!readonly && <p className="mt-3 text-xs text-muted-foreground">{isLocalMode() ? "Saved on this device with your expense." : "Uploaded to your private My Files when you save."}</p>}
          </section>
          {!readonly && <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}{saving ? "Saving expense…" : "Save expense"}</button>}
        </aside>
      </div>
    </form>
  </div>;
}
