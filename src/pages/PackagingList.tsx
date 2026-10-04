import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, ChevronLeft, ChevronRight, Copy, Download, Eye, Mail, MessageCircle, Package, Plus, Save, Trash2 } from "lucide-react";
import { billing, crm, type CompanyProfile, type CrmCustomer, type InvoiceDocSummary } from "../lib/api";
import { AGENT_STORAGE_EVENT, agentStorageScope, requireAgentStorageScope } from "../lib/agentStorage";
import { errMsg, fmtDate } from "../lib/format";
import { loadDocFormats, type DocFormats } from "../lib/numberFormat";
import { allocateDocumentNumber } from "../lib/documentNumbers";
import { useLiveSync } from "../lib/realtime";
import { useUI } from "../lib/ui";
import { bytesToBase64, emailShell, esc, sendEmail } from "../lib/email";
import { autoSaveDocument, safeName } from "../lib/files";
import { downloadFile } from "../lib/pdfTools";
import { reactToPdfBytes } from "../lib/reactPdf";
import { blankPackagingForm, deletePackagingList, loadPackagingLists, packagingTotals, savePackagingList, validatePackagingForm, type PackagingForm, type PackagingItem, type PackagingRecord, type PackagingStatus } from "../lib/packagingLists";
import { Badge, Card, DataTable, ErrorBanner, Field, FilterChip, Modal, PageHeader, SearchInput } from "../components/ui";
import { DateField } from "../components/DatePicker";
import { SelectMenu } from "../components/ui-menu";
import { RowActions } from "../components/RowActions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/Tabs";
import { ResizablePanels } from "../components/ResizablePanels";
import FitPreview from "../components/FitPreview";
import DocumentMessageDialog, { type DocumentMessageProps } from "../components/DocumentMessageDialog";
import { EMPTY_STAMP_SIG, loadCompanyStampSig, type CompanyStampSig } from "../components/StampSignatureSettings";
import { StampSigAdjust } from "../components/StampSignature";
import PackagingListDocument, { PACKAGING_TEMPLATES, usePackagingPages } from "../components/PackagingListDocument";

const STATUSES: { value: PackagingStatus; label: string; tone: "neutral" | "info" | "success" | "danger" }[] = [
  { value: "draft", label: "Draft", tone: "neutral" },
  { value: "issued", label: "Issued", tone: "info" },
  { value: "dispatched", label: "Dispatched", tone: "success" },
  { value: "cancelled", label: "Cancelled", tone: "danger" },
];
const fileName = (form: PackagingForm) => safeName(form.number || "packaging-list").replace(/\.+$/, "").slice(0, 100) || "packaging-list";
const amount = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 3 });

export default function PackagingList() {
  const { toast, confirm } = useUI();
  const [records, setRecords] = useState<PackagingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [stampSig, setStampSig] = useState<CompanyStampSig>(EMPTY_STAMP_SIG);
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [invoices, setInvoices] = useState<InvoiceDocSummary[]>([]);
  const [lookupError, setLookupError] = useState("");
  const [lookupsLoading, setLookupsLoading] = useState(true);
  const [creationLoading, setCreationLoading] = useState(true);
  const lookupRequest = useRef(0);
  const [formats, setFormats] = useState<DocFormats>({});
  const [form, setForm] = useState<PackagingForm | null>(null);
  const [editing, setEditing] = useState<PackagingRecord | null>(null);
  const baseline = useRef("");
  const editorScope = useRef<string | null>(null);
  const workspaceScope = useRef(agentStorageScope());
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [preview, setPreview] = useState<PackagingForm | null>(null);
  const [messageDialog, setMessageDialog] = useState<DocumentMessageProps | null>(null);

  const refresh = useCallback(async () => {
    const scope = agentStorageScope();
    try { const rows = await loadPackagingLists(); if (scope === agentStorageScope()) { setRecords(rows); setLoadError(""); } }
    catch (error) { if (scope === agentStorageScope()) setLoadError(errMsg(error)); }
    finally { if (scope === agentStorageScope()) setLoading(false); }
  }, []);
  const loadLookups = useCallback(async () => {
    const scope = agentStorageScope();
    const request = ++lookupRequest.current;
    setLookupsLoading(true);
    setCreationLoading(true);
    const optional = Promise.allSettled([loadCompanyStampSig(), crm.customers(), billing.listDocs("sales")]);
    const essentials = await Promise.allSettled([billing.getCompany(), loadDocFormats()]);
    if (scope !== agentStorageScope() || request !== lookupRequest.current) return;
    const [profile, numbers] = essentials;
    if (profile.status === "fulfilled") setCompany(profile.value);
    if (numbers.status === "fulfilled") setFormats(numbers.value);
    setCreationLoading(false);
    if (essentials.some((result) => result.status === "rejected")) setLookupError("Some saved company or number settings could not be loaded. You can enter details manually.");
    const results = await optional;
    if (scope !== agentStorageScope() || request !== lookupRequest.current) return;
    const [marks, parties, docs] = results;
    if (marks.status === "fulfilled") setStampSig(marks.value);
    if (parties.status === "fulfilled") setCustomers(parties.value);
    if (docs.status === "fulfilled") setInvoices(docs.value);
    setLookupError([...essentials, ...results].some((result) => result.status === "rejected") ? "Some saved company, customer or invoice details could not be loaded. You can enter details manually." : "");
    setLookupsLoading(false);
  }, []);
  useEffect(() => { void refresh(); void loadLookups(); }, [refresh, loadLookups]);
  useLiveSync(() => { void refresh(); }, ["app_settings"]);
  useEffect(() => {
    const changed = () => {
      const current = agentStorageScope();
      if (current === workspaceScope.current) return;
      workspaceScope.current = current;
      setForm(null); setEditing(null); setPreview(null); setMessageDialog(null);
      setRecords([]); setCustomers([]); setInvoices([]); setCompany(null); setStampSig(EMPTY_STAMP_SIG); setFormats({});
      setLoading(true); void refresh(); void loadLookups();
    };
    window.addEventListener(AGENT_STORAGE_EVENT, changed);
    window.addEventListener("filey:workspace-changed", changed);
    window.addEventListener("storage", changed);
    return () => { window.removeEventListener(AGENT_STORAGE_EVENT, changed); window.removeEventListener("filey:workspace-changed", changed); window.removeEventListener("storage", changed); };
  }, [refresh, loadLookups]);

  const dirty = !!form && JSON.stringify(form) !== baseline.current;
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const openEditor = (next: PackagingForm, record: PackagingRecord | null = null) => {
    editorScope.current = agentStorageScope();
    baseline.current = JSON.stringify(next);
    setEditing(record); setForm(next);
  };
  const create = () => run(async () => {
    const scope = agentStorageScope();
    const next = blankPackagingForm(await allocateDocumentNumber("packaging_list", records.map((record) => record.form.number), formats));
    requireAgentStorageScope(scope ?? "signed-out");
    openEditor({ ...next, template: PACKAGING_TEMPLATES[0].id, company_name: company?.name || "", company_address: company?.address || "", company_trn: company?.trn || "", company_phone: company?.phone || "", company_email: company?.email || "", company_logo: company?.logo || "" });
  });
  const duplicate = (record: PackagingRecord) => run(async () => {
    const scope = agentStorageScope();
    const blank = blankPackagingForm(await allocateDocumentNumber("packaging_list", records.map((row) => row.form.number), formats));
    requireAgentStorageScope(scope ?? "signed-out");
    openEditor({ ...record.form, number: blank.number, issue_date: blank.issue_date, status: "draft", items: record.form.items.map((item) => ({ ...item, id: crypto.randomUUID() })) });
  });
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await action(); }
    catch (error) { toast.error(errMsg(error)); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const save = async (): Promise<PackagingRecord> => {
    if (!form) throw new Error("Open a packaging list first.");
    const scope = editorScope.current;
    requireAgentStorageScope(scope ?? "signed-out");
    validatePackagingForm(form);
    const saved = await savePackagingList(form, editing?.id, editing?.revision, editing?.updated_at);
    requireAgentStorageScope(scope ?? "signed-out");
    baseline.current = JSON.stringify(saved.form);
    setEditing(saved); setForm(saved.form);
    await refresh();
    requireAgentStorageScope(scope ?? "signed-out");
    toast.success("Packaging list saved.");
    const snapshotName = `${fileName(saved.form)}-v${saved.revision}-${safeName(saved.updated_at)}.pdf`;
    void autoSaveDocument(snapshotName, "packing-list", async () => ({ ...await pdf(saved.form), name: snapshotName }));
    return saved;
  };
  const back = async () => {
    if (dirty && !(await confirm({ title: "Discard changes?", message: "Your packaging list has unsaved changes.", confirmLabel: "Discard changes", danger: true }))) return;
    setForm(null); setEditing(null); void refresh();
  };
  const pdf = (document: PackagingForm) => reactToPdfBytes(<PackagingListDocument form={document} companyStampSig={stampSig} />, fileName(document));
  const download = (document: PackagingForm) => run(async () => { const scope = agentStorageScope(); validatePackagingForm(document); const rendered = await pdf(document); requireAgentStorageScope(scope ?? "signed-out"); await downloadFile(rendered); });
  const remove = async (record: PackagingRecord) => {
    const scope = agentStorageScope();
    if (!(await confirm({ title: "Delete packaging list", message: `Delete ${record.form.number}?`, confirmLabel: "Delete", danger: true }))) return;
    await run(async () => { requireAgentStorageScope(scope ?? "signed-out"); await deletePackagingList(record.id, record.revision, record.updated_at); await refresh(); toast.success("Packaging list deleted."); });
  };
  const share = async (kind: "whatsapp" | "sms" | "email", record: PackagingRecord) => {
    const document = record.form;
    const title = `Packaging List ${document.number}`;
    const totals = packagingTotals(document.items);
    const text = `Hi ${document.recipient_name || "there"},\n\n${title} dated ${fmtDate(document.issue_date)} is ready.${document.show_packages && document.items.some((item) => item.package_count != null) ? ` Packages: ${amount(totals.packages)}.` : ""}`;
    if (kind === "email") {
      if (!document.recipient_email.trim()) throw new Error("Add a recipient email before sharing.");
      const scope = agentStorageScope();
      const rendered = await pdf(document);
      requireAgentStorageScope(scope ?? "signed-out");
      await sendEmail({ to: document.recipient_email, subject: title, html: emailShell(title, `<p>${esc(text).replace(/\n/g, "<br>")}</p>`), attachments: [{ filename: rendered.name, content: bytesToBase64(rendered.bytes) }] });
      toast.success(`Packaging list emailed to ${document.recipient_email}.`);
    } else {
      setMessageDialog({ documentKey: `packaging-list:${record.id}`, documentVersion: `${record.revision}:${record.updated_at}`, title, phone: document.recipient_phone, message: text, channel: kind,
        loadPdf: async () => { const rendered = await pdf(document); return new File([rendered.bytes.slice().buffer], rendered.name, { type: "application/pdf" }); } });
    }
  };
  const shareEditor = (kind: "whatsapp" | "email") => run(async () => { const saved = await save(); await share(kind, saved); });
  const query = search.trim().toLowerCase();
  const filtered = records.filter((record) => (status === "all" || record.form.status === status) && `${record.form.number} ${record.form.recipient_name} ${record.form.invoice_reference} ${record.form.order_reference}`.toLowerCase().includes(query));

  return <>
    {messageDialog && <DocumentMessageDialog {...messageDialog} onClose={() => setMessageDialog(null)} />}
    {form ? <PackagingEditor form={form} setForm={setForm} customers={customers} invoices={invoices} companyStampSig={stampSig} busy={busy} lookupError={lookupError} lookupsLoading={lookupsLoading} onRetryLookups={() => { void loadLookups(); }} onBack={() => { void back(); }} onSave={() => { void run(async () => { await save(); }); }} onDownload={() => { void download(form); }} onPreview={() => setPreview(form)} onShare={shareEditor} /> : <>
      <PageHeader title="Packaging List" subtitle="Prepare shipment contents, packages and weights" action={<button type="button" className="btn-primary" disabled={loading || creationLoading || !!loadError || busy} onClick={create}><Plus size={16} /> New packaging list</button>} />
      {creationLoading && <p role="status" className="mb-4 text-sm text-muted-foreground">Loading company and document settings…</p>}
      {loadError && <div className="mb-4 space-y-2"><ErrorBanner message={loadError} /><button type="button" className="btn-ghost" onClick={() => { setLoading(true); void refresh(); }}>Retry</button></div>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search number, recipient or reference…" className="min-w-0 w-full sm:max-w-sm" />
        <div className="flex flex-wrap gap-1.5" aria-label="Packaging list status filters"><FilterChip active={status === "all"} onClick={() => setStatus("all")}>All</FilterChip>{STATUSES.map((option) => <FilterChip key={option.value} active={status === option.value} onClick={() => setStatus(option.value)}>{option.label}</FilterChip>)}</div>
      </div>
      <DataTable<PackagingRecord> rows={filtered} loading={loading} pageSize={10} empty={query || status !== "all" ? "No packaging lists match your filters." : "No packaging lists yet. Create a list for your next shipment."} onRowClick={(record) => setPreview(record.form)} columns={[
        { key: "number", label: "Number", summary: true, sortValue: (record) => record.form.number, render: (record) => <span className="font-mono text-xs font-medium">{record.form.number}</span> },
        { key: "recipient", label: "Recipient", summary: true, sortValue: (record) => record.form.recipient_name, render: (record) => record.form.recipient_name },
        { key: "date", label: "Date", sortValue: (record) => record.form.issue_date, render: (record) => fmtDate(record.form.issue_date) },
        { key: "reference", label: "Invoice reference", render: (record) => record.form.invoice_reference || "—" },
        { key: "packages", label: "Packages", render: (record) => record.form.show_packages && record.form.items.some((item) => item.package_count != null) ? amount(packagingTotals(record.form.items).packages) : "—" },
        { key: "weight", label: "Gross weight", render: (record) => record.form.show_gross_weight && record.form.items.some((item) => item.gross_weight != null) ? `${amount(packagingTotals(record.form.items).gross)} ${record.form.weight_unit}` : "—" },
        { key: "status", label: "Status", summary: true, render: (record) => { const option = STATUSES.find((item) => item.value === record.form.status)!; return <Badge tone={option.tone}>{option.label}</Badge>; } },
        { key: "actions", label: "Actions", actions: true, render: (record) => <div className={`flex items-center justify-end gap-1 ${busy ? "pointer-events-none opacity-50" : ""}`}><RowActions onView={() => setPreview(record.form)} onEdit={() => openEditor(structuredClone(record.form), record)} onCopy={() => duplicate(record)} onDelete={() => { void remove(record); }} onSend={{ whatsapp: () => { void run(() => share("whatsapp", record)); }, email: () => { void run(() => share("email", record)); }, sms: () => { void run(() => share("sms", record)); } }} /><button type="button" className="btn-ghost h-9 w-9 p-0" aria-label={`Download ${record.form.number} PDF`} disabled={busy} onClick={(event) => { event.stopPropagation(); void download(record.form); }}><Download size={14} /></button></div> },
      ]} />
    </>}
    <Modal open={!!preview} onClose={() => setPreview(null)} title={preview ? `Packaging List ${preview.number}` : "Packaging list preview"} size="document">
      {preview && <div className="mx-auto max-w-[900px]"><div className="mb-4 flex justify-end"><button type="button" className="btn-ghost" disabled={busy} onClick={() => { void download(preview); }}><Download size={15} /> Download PDF</button></div><PackagingPreview key={preview.number} form={preview} companyStampSig={stampSig} /></div>}
    </Modal>
  </>;
}

function PackagingPreview({ form, companyStampSig, onChange }: { form: PackagingForm; companyStampSig: CompanyStampSig; onChange?: (form: PackagingForm) => void }) {
  const [page, setPage] = useState(0);
  const count = usePackagingPages(form).length;
  const current = Math.min(page, Math.max(0, count - 1));
  return <div className="min-w-0">
    <FitPreview baseWidth={794} zoom={100} padding={0} zoomable><PackagingListDocument form={form} companyStampSig={companyStampSig} onChange={onChange} pageIndex={current} /></FitPreview>
    <div className="mt-3 flex items-center justify-between gap-3" role="group" aria-label="Preview pages">
      <button type="button" className="btn-ghost h-10 w-10 p-0" disabled={current === 0} aria-label="Previous preview page" onClick={() => setPage(current - 1)}><ChevronLeft size={16} /></button>
      <output aria-live="polite" className="text-xs text-muted-foreground">Page {current + 1} of {count}</output>
      <button type="button" className="btn-ghost h-10 w-10 p-0" disabled={current + 1 >= count} aria-label="Next preview page" onClick={() => setPage(current + 1)}><ChevronRight size={16} /></button>
    </div>
  </div>;
}

function PackagingEditor({ form, setForm, customers, invoices, companyStampSig, busy, lookupError, lookupsLoading, onRetryLookups, onBack, onSave, onDownload, onPreview, onShare }: {
  form: PackagingForm; setForm: (form: PackagingForm) => void; customers: CrmCustomer[]; invoices: InvoiceDocSummary[]; companyStampSig: CompanyStampSig; busy: boolean; lookupError: string; lookupsLoading: boolean; onRetryLookups: () => void; onBack: () => void; onSave: () => void; onDownload: () => void; onPreview: () => void; onShare: (kind: "whatsapp" | "email") => void;
}) {
  const [browseTemplates, setBrowseTemplates] = useState(false);
  const [templatePreview, setTemplatePreview] = useState<string | null>(null);
  const set = <K extends keyof PackagingForm>(key: K, value: PackagingForm[K]) => setForm({ ...form, [key]: value });
  const setItem = (id: string, patch: Partial<PackagingItem>) => set("items", form.items.map((item) => item.id === id ? { ...item, ...patch } : item));
  const duplicateItem = (index: number) => {
    if (form.items.length >= 500) return;
    const items = [...form.items];
    items.splice(index + 1, 0, { ...items[index], id: crypto.randomUUID() });
    set("items", items);
  };
  const moveItem = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= form.items.length) return;
    const items = [...form.items];
    [items[index], items[target]] = [items[target], items[index]];
    set("items", items);
  };
  const totals = packagingTotals(form.items);
  const stamp = form.stamp?.data ? form.stamp : companyStampSig.stamp;
  const signature = form.signature?.data ? form.signature : companyStampSig.signature;
  const textField = (key: keyof PackagingForm, label: string, type = "text") => <Field label={label} required={key === "number" || key === "recipient_name"}><input className="input w-full" type={type} maxLength={key.endsWith("email") ? 254 : key.endsWith("phone") ? 40 : key.endsWith("name") ? 160 : key === "company_trn" ? 60 : key === "number" ? 100 : 120} value={String(form[key] ?? "")} onChange={(event) => setForm({ ...form, [key]: event.target.value, ...(key === "invoice_reference" ? { invoice_id: null } : {}) })} /></Field>;
  const check = (key: "show_logo" | "show_packages" | "show_net_weight" | "show_gross_weight" | "show_stamp" | "show_signature", label: string, disabled = false) => <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-4 w-4 accent-foreground" checked={form[key]} disabled={disabled || busy} onChange={(event) => setForm({ ...form, [key]: event.target.checked,
    ...(key === "show_stamp" && event.target.checked && stamp ? { stamp: { ...stamp, opacity: 100 } } : {}), ...(key === "show_signature" && event.target.checked && signature ? { signature: { ...signature, opacity: 100 } } : {}) })} />{label}</label>;

  return <>
    <PageHeader title={form.number || "New packaging list"} subtitle="Add the shipment details and review every page before sharing." action={<div className="flex flex-wrap gap-2">
      <button type="button" className="btn-ghost" onClick={onBack} disabled={busy}><ArrowLeft size={15} /> Back</button>
      <button type="button" className="btn-ghost" onClick={onPreview} disabled={busy}><Eye size={15} /> Preview</button>
      <button type="button" className="btn-ghost" onClick={onDownload} disabled={busy}><Download size={15} /> PDF</button>
      <button type="button" className="btn-ghost" onClick={() => onShare("whatsapp")} disabled={busy}><MessageCircle size={15} /> Share</button>
      <button type="button" className="btn-ghost" onClick={() => onShare("email")} disabled={busy}><Mail size={15} /> Email</button>
      <button type="button" className="btn-primary" onClick={onSave} disabled={busy}><Save size={15} /> {busy ? "Working…" : "Save"}</button>
    </div>} />
    <ResizablePanels defaultRightWidth={400} minRightWidth={280} left={<Card className="!p-0 overflow-hidden">
      <fieldset disabled={busy} className="min-w-0">
        <Tabs defaultValue="details"><TabsList className="flex w-full px-2 sm:px-4" aria-label="Packaging list editor"><TabsTrigger value="details">Details</TabsTrigger><TabsTrigger value="items">Items</TabsTrigger><TabsTrigger value="appearance">Appearance</TabsTrigger></TabsList>
          <div className="p-4 sm:p-5">
            {lookupsLoading && <p role="status" className="mb-4 text-sm text-muted-foreground">Loading saved details… You can enter shipment details manually.</p>}
            {lookupError && <div role="alert" className="mb-4 text-sm text-muted-foreground">{lookupError}<button type="button" className="btn-ghost mt-2" disabled={lookupsLoading} onClick={onRetryLookups}>Retry saved details</button></div>}
            <TabsContent value="details" className="mt-0 space-y-6">
              <section className="space-y-3"><h2 className="text-sm font-semibold">Document details</h2><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {textField("number", "Packaging list number")}
                <Field label="Date" required><DateField value={form.issue_date} onChange={(value) => set("issue_date", value)} /></Field>
                <Field label="Status"><SelectMenu value={form.status} onChange={(value) => set("status", value as PackagingStatus)} options={STATUSES} ariaLabel="Packaging list status" /></Field>
                {textField("prepared_by", "Prepared by")}
              </div></section>
              <section className="space-y-3"><h2 className="text-sm font-semibold">Recipient</h2>
                <Field label="Fill from a saved customer" hint="You can also enter recipient details directly."><SelectMenu value="" disabled={lookupsLoading || busy} onChange={(value) => { const customer = customers.find((entry) => String(entry.id) === value); if (customer) setForm({ ...form, customer_id: customer.id, recipient_name: customer.company || customer.name, recipient_address: [customer.address, customer.city].filter(Boolean).join(", "), recipient_email: customer.email || "", recipient_phone: customer.phone_e164 || customer.phone || "" }); }} options={[{ value: "", label: "Choose a saved customer…" }, ...customers.map((customer) => ({ value: String(customer.id), label: customer.company || customer.name }))]} ariaLabel="Choose a saved recipient" searchPlaceholder="Search customers…" /></Field>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{textField("recipient_name", "Recipient name")}{textField("recipient_phone", "Phone", "tel")}{textField("recipient_email", "Email", "email")}</div>
                <Field label="Recipient address"><textarea className="input min-h-20 w-full resize-y" maxLength={400} value={form.recipient_address} onChange={(event) => set("recipient_address", event.target.value)} /></Field>
                <Field label="Ship-to address" hint="Leave blank to use the recipient address."><textarea className="input min-h-20 w-full resize-y" maxLength={400} value={form.shipping_address} onChange={(event) => set("shipping_address", event.target.value)} /></Field>
              </section>
              <section className="space-y-3"><h2 className="text-sm font-semibold">Shipment & references</h2>
                <Field label="Link an invoice (optional)" hint="A reference only. Edit the reference below to use your own."><SelectMenu value={form.invoice_id == null ? "" : String(form.invoice_id)} disabled={lookupsLoading || busy} onChange={(value) => { if (!value) { set("invoice_id", null); return; } const invoice = invoices.find((entry) => String(entry.id) === value); if (invoice) setForm({ ...form, invoice_id: invoice.id, invoice_reference: invoice.number }); }} options={[{ value: "", label: "No linked invoice" }, ...(form.invoice_id != null && !invoices.some((invoice) => invoice.id === form.invoice_id) ? [{ value: String(form.invoice_id), label: form.invoice_reference || "Saved invoice reference" }] : []), ...invoices.map((invoice) => ({ value: String(invoice.id), label: `${invoice.number} · ${invoice.customer_name}` }))]} ariaLabel="Optional invoice reference" searchPlaceholder="Search invoices…" /></Field>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {textField("invoice_reference", "Invoice reference (optional)")}{textField("order_reference", "Order / LPO reference")}
                  <Field label="Dispatch date"><DateField value={form.dispatch_date} onChange={(value) => set("dispatch_date", value)} /></Field>
                  {textField("carrier", "Carrier")}{textField("tracking_number", "Tracking / shipment number")}
                </div>
              </section>
              <section className="space-y-3"><h2 className="text-sm font-semibold">Sender</h2><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{textField("company_name", "Company name")}{textField("company_trn", "Company registration / tax number")}{textField("company_email", "Company email", "email")}{textField("company_phone", "Company phone", "tel")}</div><Field label="Company address"><textarea className="input min-h-20 w-full resize-y" maxLength={400} value={form.company_address} onChange={(event) => set("company_address", event.target.value)} /></Field></section>
              <Field label="Notes"><textarea className="input min-h-28 w-full resize-y" maxLength={10000} value={form.notes} onChange={(event) => set("notes", event.target.value)} /></Field>
            </TabsContent>
            <TabsContent value="items" className="mt-0 space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-sm font-semibold">Shipment contents</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Weights are per quantity unit. Line weight = quantity × weight per unit. Package count is the total for that line.</p></div><div className="w-28"><Field label="Weight unit"><SelectMenu value={form.weight_unit} onChange={(value) => set("weight_unit", value as "kg" | "lb")} options={[{ value: "kg", label: "kg" }, { value: "lb", label: "lb" }]} ariaLabel="Weight unit" /></Field></div></div>
              <div className="space-y-3">{form.items.map((item, index) => <section key={item.id} className="min-w-0 rounded-xl border border-border p-3 sm:p-4" aria-label={`Item ${index + 1}`}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="text-xs font-medium text-muted-foreground">Item {index + 1}</h3><div className="flex items-center gap-1" role="group" aria-label={`Item ${index + 1} actions`}>
                  <button type="button" className="btn-ghost h-11 w-11 p-0" aria-label={`Move item ${index + 1} up`} title="Move up" disabled={index === 0} onClick={() => moveItem(index, -1)}><ArrowUp size={15} /></button>
                  <button type="button" className="btn-ghost h-11 w-11 p-0" aria-label={`Move item ${index + 1} down`} title="Move down" disabled={index === form.items.length - 1} onClick={() => moveItem(index, 1)}><ArrowDown size={15} /></button>
                  <button type="button" className="btn-ghost h-11 w-11 p-0" aria-label={`Duplicate item ${index + 1}`} title="Duplicate item" disabled={form.items.length >= 500} onClick={() => duplicateItem(index)}><Copy size={15} /></button>
                  <button type="button" className="btn-ghost h-11 w-11 p-0 hover:text-danger" aria-label={`Remove item ${index + 1}`} title="Remove item" disabled={form.items.length === 1} onClick={() => set("items", form.items.filter((entry) => entry.id !== item.id))}><Trash2 size={15} /></button>
                </div></div>
                <Field label="Description" required><textarea className="input min-h-20 w-full resize-y" maxLength={2000} value={item.description} onChange={(event) => setItem(item.id, { description: event.target.value })} /></Field>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Field label="Quantity"><input className="input w-full" type="number" min="0" step="any" value={item.qty} onChange={(event) => setItem(item.id, { qty: event.target.value === "" ? 0 : Number(event.target.value) })} /></Field>
                  <Field label="Unit"><input className="input w-full" maxLength={20} value={item.unit} placeholder="pcs, cartons…" onChange={(event) => setItem(item.id, { unit: event.target.value })} /></Field>
                  <Field label="Package type"><input className="input w-full" maxLength={60} value={item.package_type} placeholder="Box, pallet…" onChange={(event) => setItem(item.id, { package_type: event.target.value })} /></Field>
                  {(["package_count", "net_weight", "gross_weight"] as const).map((key) => <Field key={key} label={key === "package_count" ? "Packages" : `${key === "net_weight" ? "Net" : "Gross"} / unit (${form.weight_unit})`}><input className="input w-full" type="number" min="0" step={key === "package_count" ? "1" : "any"} value={item[key] ?? ""} placeholder="Optional" onChange={(event) => setItem(item.id, { [key]: event.target.value === "" ? null : Number(event.target.value) })} /></Field>)}
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>Net: {item.net_weight == null ? "—" : amount(item.qty * item.net_weight)} {form.weight_unit}</span><span>Gross: {item.gross_weight == null ? "—" : amount(item.qty * item.gross_weight)} {form.weight_unit}</span></div>
              </section>)}</div>
              <button type="button" className="btn-ghost min-h-11" disabled={form.items.length >= 500} onClick={() => set("items", [...form.items, { id: crypto.randomUUID(), description: "", qty: 1, unit: "pcs", package_type: "", package_count: null, net_weight: null, gross_weight: null }])}><Plus size={15} /> Add item</button>
              <section aria-label="Shipment totals" className="space-y-2 border-t border-border pt-4 text-sm"><p className="flex items-center gap-2 font-medium"><Package size={16} /> Shipment totals</p><div className="flex flex-wrap gap-x-5 gap-y-2 text-muted-foreground">{Object.entries(totals.quantities).map(([unit, quantity]) => <span key={unit}>{amount(quantity)} {unit || "units"}</span>)}<span>{form.items.some((item) => item.package_count != null) ? amount(totals.packages) : "—"} packages</span><span>Net {form.items.some((item) => item.net_weight != null) ? amount(totals.net) : "—"} {form.weight_unit}</span><span>Gross {form.items.some((item) => item.gross_weight != null) ? amount(totals.gross) : "—"} {form.weight_unit}</span></div>{(["package_count", "net_weight", "gross_weight"] as const).some((key) => form.items.some((item) => item[key] != null) && form.items.some((item) => item[key] == null)) && <p className="text-xs text-muted-foreground">Totals include entered values. Some items have no package count or weight.</p>}</section>
            </TabsContent>
            <TabsContent value="appearance" className="mt-0 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">Document template</h2><p className="mt-1 text-xs text-muted-foreground">{PACKAGING_TEMPLATES.find((template) => template.id === form.template)?.name || "Selected template"}</p></div><button type="button" className="btn-ghost" onClick={() => setBrowseTemplates(true)}>Browse templates</button></div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Field label="Accent colour"><input type="color" className="input h-11 w-full" value={form.accent} onChange={(event) => set("accent", event.target.value)} /></Field><Field label="Typeface"><SelectMenu value={form.font} onChange={(value) => set("font", value)} options={[{ value: "'Plus Jakarta Sans', system-ui, sans-serif", label: "Sans serif" }, { value: "'Lora', Georgia, serif", label: "Serif" }, { value: "'IBM Plex Mono', monospace", label: "Monospace" }]} ariaLabel="Document typeface" /></Field></div>
              <section><h2 className="mb-2 text-sm font-semibold">Visible information</h2><div className="grid grid-cols-1 sm:grid-cols-2">{check("show_logo", "Company logo", !form.company_logo)}{check("show_packages", "Packages")}{check("show_net_weight", "Net weights")}{check("show_gross_weight", "Gross weights")}</div></section>
              <section className="space-y-4 border-t border-border pt-4"><h2 className="text-sm font-semibold">Stamp & signature</h2><p className="text-xs text-muted-foreground">Use your company assets from Settings → Company Details. Drag enabled marks on the last preview page.</p>
                {check("show_stamp", stamp?.data ? "Show stamp" : "Show stamp (add one in Settings)", !stamp?.data)}
                {form.show_stamp && stamp && <StampSigAdjust label="Stamp" value={stamp} onChange={(value) => set("stamp", value)} />}
                {check("show_signature", signature?.data ? "Show signature" : "Show signature (add one in Settings)", !signature?.data)}
                {form.show_signature && signature && <StampSigAdjust label="Signature" value={signature} onChange={(value) => set("signature", value)} />}
              </section>
            </TabsContent>
          </div>
        </Tabs>
      </fieldset>
    </Card>} right={<PackagingPreview form={form} companyStampSig={companyStampSig} onChange={busy ? undefined : setForm} />} />
    <Modal open={browseTemplates} onClose={() => setBrowseTemplates(false)} title="Choose a packaging list template" size="3xl">
      <p className="mb-5 text-sm text-muted-foreground">Each layout shows your shipment details. Preview a template before choosing it.</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">{PACKAGING_TEMPLATES.map((template) => <div key={template.id} className={`min-w-0 overflow-hidden rounded-xl border bg-card ${form.template === template.id ? "border-foreground ring-1 ring-foreground" : "border-border"}`}>
        <button type="button" className="block w-full p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" aria-label={`Use ${template.name} template`} aria-pressed={form.template === template.id} onClick={() => { set("template", template.id); setBrowseTemplates(false); }}><div className="pointer-events-none relative mx-auto h-[190px] w-[134px] overflow-hidden bg-white text-neutral-900" aria-hidden="true"><div style={{ width: 794, transform: "scale(0.1688)", transformOrigin: "top left" }}><PackagingListDocument form={{ ...form, template: template.id, show_stamp: false, show_signature: false }} pageIndex={0} /></div></div><span className="mt-3 block text-sm font-medium">{template.name}</span></button>
        <button type="button" className="btn-ghost w-full border-t border-border text-xs" onClick={() => setTemplatePreview(template.id)}><Eye size={14} /> Preview template</button>
      </div>)}</div>
    </Modal>
    <Modal open={!!templatePreview} onClose={() => setTemplatePreview(null)} title={PACKAGING_TEMPLATES.find((template) => template.id === templatePreview)?.name || "Template preview"} size="document">
      {templatePreview && <div className="mx-auto max-w-[850px]"><div className="mb-4 flex justify-end"><button type="button" className="btn-primary" onClick={() => { set("template", templatePreview); setTemplatePreview(null); setBrowseTemplates(false); }}>Use this template</button></div><PackagingPreview form={{ ...form, template: templatePreview }} companyStampSig={companyStampSig} /></div>}
    </Modal>
  </>;
}
