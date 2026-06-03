import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Plus,
  Trash2,
  ArrowLeft,
  Download,
  Save,
  Building2,
  Upload,
  X,
  Pencil,
  Copy,
  Check,
  CheckCircle2,
  Send,
  Monitor,
  Smartphone,
  Minus,
  Settings,
  StickyNote,
  Paperclip,
  CreditCard,
  Sparkles,
  Repeat,
  Maximize2,
  FileText,
  Wallet,
  Clock,
} from "lucide-react";
import {
  billing,
  crm,
  recurrences,
  InvoiceDocSummary,
  InvoiceDocInput,
  InvoicePayment,
  CompanyProfile,
  CrmCustomer,
  Recurrence,
} from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { useUI } from "../lib/ui";
import { fmtDate, money, num, numInput, CURRENCIES } from "../lib/format";
import ColorPicker from "../components/ColorPicker";
import { invoiceTotals } from "../lib/money";
import { sendEmail, emailShell, esc } from "../lib/email";
import FitPreview from "../components/FitPreview";
import { downloadElementAsPdf } from "../lib/pdfTools";
import ScanDocModal from "../components/ScanDocModal";
import TemplateDesigner, { loadCustomTemplates, deleteCustomTemplate, type CustomTemplate } from "../components/TemplateDesigner";
import TemplateTilePreview from "../components/TemplateTilePreview";
import {
  PageHeader,
  MetricCard,
  DataTable,
  Badge,
  statusTone,
  Modal,
  Field,
  ShareToggle,
} from "../components/ui";

type CustomColumn = { key: string; label: string };
type Item = { description: string; qty: number; unit_price: number; unit: string; custom: Record<string, string> };
type StampSig = { data: string; x: number; y: number };
type Form = Omit<InvoiceDocInput, "items"> & { items: Item[]; customColumns: CustomColumn[]; stamp?: StampSig; signature?: StampSig };

const TEMPLATES = [
  { id: "minimal", name: "Minimal" },
  { id: "classic", name: "Classic" },
  { id: "modern", name: "Modern" },
  { id: "corporate", name: "Corporate" },
  { id: "elegant", name: "Elegant" },
  { id: "bold", name: "Bold" },
  { id: "tech", name: "Tech" },
  { id: "creative", name: "Creative" },
  { id: "receipt", name: "Receipt" },
  { id: "monogram", name: "Monogram" },
  { id: "green-gold", name: "Green Gold" },
  { id: "uae", name: "UAE Professional" },
  { id: "industrial", name: "Industrial" },
  { id: "executive", name: "Executive" },
  { id: "fresh", name: "Fresh" },
];

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (n: number) =>
  new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

function blankForm(c: CompanyProfile): Form {
  const y = new Date().getFullYear();
  return {
    number: `INV-${y}-${String(Math.floor(Math.random() * 9000) + 1000)}`,
    status: "draft",
    doc_type: "Tax Invoice",
    template: c.default_template || "minimal",
    accent: c.default_accent || "#222222",
    currency: c.currency || "AED",
    seller_name: c.name,
    seller_address: c.address,
    seller_trn: c.trn,
    seller_email: c.email,
    seller_phone: c.phone,
    logo: c.logo,
    customer_name: "",
    customer_address: "",
    customer_trn: "",
    customer_email: "",
    issue_date: today(),
    due_date: undefined,
    notes: "Thank you for your business.",
    terms: "Payment due within 30 days.",
    tax_rate: c.default_tax_rate ?? 5,
    discount: 0,
    items: [{ description: "", qty: 1, unit_price: 0, unit: "", custom: {} }],
    customColumns: [],
  };
}

const totals = (f: Form) =>
  invoiceTotals(f.items, f.discount || 0, f.tax_rate || 0);

export default function Invoicing() {
  const { toast, confirm } = useUI();
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [docs, setDocs] = useState<InvoiceDocSummary[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [payFor, setPayFor] = useState<InvoiceDocSummary | null>(null);
  const [recurs, setRecurs] = useState<Recurrence[]>([]);
  const loadDocs = () =>
    billing.listDocs().then(setDocs).catch(() => toast.error("Failed to load documents"));
  const loadRecurs = () =>
    recurrences.list().then(setRecurs).catch(() => toast.error("Failed to load recurrences"));

  const reload = () => {
    billing.getCompany().then(setCompany).catch(() => toast.error("Failed to load company profile"));
    loadDocs();
    loadRecurs();
  };
  useEffect(reload, []);
  useLiveSync(reload);

  // Generate any due recurring invoices once on load.
  useEffect(() => {
    recurrences
      .generateDue()
      .then((n) => {
        if (n > 0) {
          loadDocs();
          loadRecurs();
          toast.info(`${n} recurring invoice${n > 1 ? "s" : ""} generated`);
        }
      })
      .catch(() => toast.error("Failed to generate recurring invoices"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ⌘K "New invoice" deep-link: open a blank invoice once company loads.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get("new") === "1" && company && !form) {
      setForm(blankForm(company));
      setParams({}, { replace: true });
    }
  }, [params, company, form, setParams]);

  const newInvoice = () => {
    if (company) setForm(blankForm(company));
  };

  const editInvoice = async (id: number) => {
    try {
      const d = await billing.getDoc(id);
      setForm({
        id: d.id,
        number: d.number,
        status: d.status,
        doc_type: d.doc_type,
        template: d.template,
        accent: d.accent,
        currency: d.currency,
        seller_name: d.seller_name,
        seller_address: d.seller_address,
        seller_trn: d.seller_trn,
        seller_email: d.seller_email,
        seller_phone: d.seller_phone,
        logo: d.logo,
        customer_name: d.customer_name,
        customer_address: d.customer_address,
        customer_trn: d.customer_trn,
        customer_email: d.customer_email,
        issue_date: d.issue_date,
        due_date: d.due_date,
        notes: d.notes,
        terms: d.terms,
        tax_rate: d.tax_rate,
        discount: d.discount,
        items: d.items.map((i) => ({
          description: i.description,
          qty: i.qty,
          unit_price: i.unit_price,
          unit: i.unit || "",
          custom: i.custom || {},
        })),
        customColumns: d.custom_columns || [],
      });
    } catch (e: any) {
      toast.error(e?.message || "Failed to load invoice");
    }
  };

  const duplicateInvoice = async (id: number) => {
    try {
      const d = await billing.getDoc(id);
      const y = new Date().getFullYear();
      setForm({
        number: `INV-${y}-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        status: "draft",
        template: d.template,
        accent: d.accent,
        currency: d.currency,
        seller_name: d.seller_name,
        seller_address: d.seller_address,
        seller_trn: d.seller_trn,
        seller_email: d.seller_email,
        seller_phone: d.seller_phone,
        logo: d.logo,
        customer_name: d.customer_name,
        customer_address: d.customer_address,
        customer_trn: d.customer_trn,
        customer_email: d.customer_email,
        issue_date: today(),
        due_date: addDays(30),
        notes: d.notes,
        terms: d.terms,
        tax_rate: d.tax_rate,
        discount: d.discount,
        items: d.items.map((i) => ({
          description: i.description,
          qty: i.qty,
          unit_price: i.unit_price,
          unit: i.unit || "",
          custom: i.custom || {},
        })),
        customColumns: d.custom_columns || [],
      });
    } catch (e: any) {
      toast.error(e?.message || "Failed to duplicate invoice");
    }
  };

  const save = async () => {
    if (!form) return;
    // Validate
    if (!form.number.trim()) { toast.error("Invoice number is required"); return; }
    if (!form.items.length || form.items.every(i => !i.description.trim())) {
      toast.error("Add at least one line item with a description");
      return;
    }
    if (!form.customer_name.trim() && !(form.customer_email || "").trim()) {
      toast.error("Customer name or email is required");
      return;
    }
    // Check for duplicate invoice number
    if (docs.some(d => d.number === form.number && d.id !== (form.id || 0))) {
      toast.error(`Invoice number "${form.number}" already exists. Use a different number.`);
      return;
    }
    setSaving(true);
    try {
      // Empty date inputs must become undefined, not "" (invalid SQL date).
      const payload = {
        ...form,
        custom_columns: form.customColumns,
        items: form.items.map(it => ({
          description: it.description,
          qty: it.qty,
          unit_price: it.unit_price,
          unit: it.unit || undefined,
          custom: it.custom,
        })),
        issue_date: form.issue_date || undefined,
        due_date: form.due_date || undefined,
      };
      const id = await billing.saveDoc(payload as InvoiceDocInput);
      setForm({ ...form, id });
      await loadDocs();
    } catch (e) {
      toast.error(`Could not save: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaving(false);
    }
  };

  // Save the current invoice with a given status (finalize → "sent" so it
  // counts as issued; revert → "draft"). Done at the parent so the freshly
  // saved id is applied to the form without a stale closure.
  const setDocStatus = async (status: "draft" | "sent") => {
    if (!form) return;
    // Validate
    if (!form.number.trim()) { toast.error("Invoice number is required"); return; }
    if (!form.items.length || form.items.every(i => !i.description.trim())) {
      toast.error("Add at least one line item with a description");
      return;
    }
    if (!form.customer_name.trim() && !(form.customer_email || "").trim()) {
      toast.error("Customer name or email is required");
      return;
    }
    // Check for duplicate invoice number
    if (docs.some(d => d.number === form.number && d.id !== (form.id || 0))) {
      toast.error(`Invoice number "${form.number}" already exists. Use a different number.`);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        status,
        issue_date: form.issue_date || undefined,
        due_date: form.due_date || undefined,
      };
      const id = await billing.saveDoc(payload as InvoiceDocInput);
      setForm({ ...form, id, status });
      await loadDocs();
      toast.success(
        status === "sent"
          ? "Invoice finalized — it now counts as issued."
          : "Moved back to draft."
      );
    } catch (e) {
      toast.error(`Could not update: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaving(false);
    }
  };

  if (form) {
    return (
      <Editor
        form={form}
        setForm={setForm}
        onBack={() => {
          setForm(null);
          loadDocs();
        }}
        onSave={save}
        onFinalize={() => setDocStatus("sent")}
        onRevertDraft={() => setDocStatus("draft")}
        saving={saving}
      />
    );
  }

  const statToday = new Date().toISOString().slice(0, 10);
  const outstanding = docs.reduce((s, d) => s + (d.balance ?? 0), 0);
  const paidTotal = docs.reduce((s, d) => s + (d.paid ?? 0), 0);
  const overdueCount = docs.filter(
    (d) =>
      (d.balance ?? 0) > 0 &&
      !!d.due_date &&
      d.due_date < statToday &&
      d.status !== "paid"
  ).length;
  const statCcy = company?.currency || "AED";

  return (
    <div>
      <PageHeader
        title="Invoicing"
        subtitle="Create FTA tax invoices — pick a template, fill details, send"
        action={
          <div className="flex gap-2">
            <button
              className="btn-ghost"
              onClick={() => setCompanyOpen(true)}
            >
              <Building2 size={16} /> Company
            </button>
            <button className="btn-ghost" onClick={() => setScanOpen(true)}>
              <Sparkles size={16} /> Scan with AI
            </button>
            <button className="btn-primary" onClick={newInvoice}>
              <Plus size={16} /> New Invoice
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <MetricCard
          label="Invoices"
          value={num(docs.length)}
          icon={<FileText size={20} />}
        />
        <MetricCard
          label="Outstanding"
          value={money(outstanding, statCcy)}
          icon={<Wallet size={20} />}
          iconClass="bg-secondary-400/20 text-secondary-600"
        />
        <MetricCard
          label="Paid"
          value={money(paidTotal, statCcy)}
          icon={<CheckCircle2 size={20} />}
          iconClass="bg-success/15 text-success"
        />
        <MetricCard
          label="Overdue"
          value={num(overdueCount)}
          icon={<Clock size={20} />}
          iconClass="bg-danger/15 text-danger"
        />
      </div>

      {recurs.filter((r) => r.active).length > 0 && (
        <div className="card mb-4">
          <p className="mb-2 flex items-center gap-2 font-bold text-ink">
            <Repeat size={15} /> Recurring invoices
          </p>
          <ul className="space-y-1.5">
            {recurs
              .filter((r) => r.active)
              .map((r) => {
                const base = docs.find((d) => d.id === r.base_invoice_id);
                return (
                  <li key={r.id} className="flex items-center justify-between text-sm">
                    <span className="text-brand-600">
                      {base?.number ?? `#${r.base_invoice_id}`} · {r.interval} · next{" "}
                      {fmtDate(r.next_run)}
                    </span>
                    <button
                      className="cursor-pointer text-xs font-semibold text-brand-400 hover:text-danger"
                      onClick={async () => {
                        const ok = await confirm({
                          title: "Cancel recurring invoice",
                          message: `Cancel this recurring invoice? No more invoices will be generated.`,
                          confirmLabel: "Cancel recurrence",
                          danger: true,
                        });
                        if (!ok) return;
                        try {
                          await recurrences.cancel(r.id);
                          loadRecurs();
                        } catch (e: any) {
                          toast.error(e?.message || "Failed to cancel recurrence");
                        }
                      }}
                    >
                      Cancel
                    </button>
                  </li>
                );
              })}
          </ul>
        </div>
      )}

      <DataTable<InvoiceDocSummary>
        rows={docs}
        empty="No invoices yet — create your first one"
        rowKey={(d) => d.id}
        bulkActions={[
          {
            label: "Share",
            run: async (sel) => {
              for (const d of sel) await billing.shareDoc(d.id, true);
              loadDocs();
              toast.success(`Shared ${sel.length}.`);
            },
          },
          {
            label: "Mark sent",
            run: async (sel) => {
              for (const d of sel) await billing.setStatus(d.id, "sent");
              loadDocs();
              toast.success(`Updated ${sel.length}.`);
            },
          },
          {
            label: "Repeat monthly",
            run: async (sel) => {
              for (const d of sel) await recurrences.create(d.id, "monthly");
              loadRecurs();
              toast.success(`${sel.length} set to repeat monthly.`);
            },
          },
          {
            label: "Copy public link",
            run: async (sel) => {
              const token = await billing.publicLink(sel[0].id);
              const url = `${location.origin}${location.pathname}#/portal/${token}`;
              await navigator.clipboard.writeText(url);
              loadDocs();
              toast.success("Public invoice link copied");
            },
          },
          {
            label: "Delete",
            danger: true,
            run: async (sel) => {
              const ok = await confirm({
                title: "Delete invoices",
                message: `Delete ${sel.length} invoice(s)?`,
                confirmLabel: "Delete",
                danger: true,
              });
              if (!ok) return;
              for (const d of sel) await billing.deleteDoc(d.id);
              loadDocs();
              toast.success(`Deleted ${sel.length}.`);
            },
          },
        ]}
        columns={[
          {
            key: "no",
            label: "Invoice #",
            sortValue: (d) => d.number,
            render: (d) => (
              <span className="font-mono text-xs font-semibold">
                {d.number}
              </span>
            ),
          },
          {
            key: "cust",
            label: "Customer",
            sortValue: (d) => d.customer_name,
            render: (d) => (
              <span className="font-semibold">{d.customer_name}</span>
            ),
          },
          {
            key: "tpl",
            label: "Template",
            sortValue: (d) => d.template,
            render: (d) => (
              <span className="capitalize text-brand-500">{d.template}</span>
            ),
          },
          {
            key: "total",
            label: "Total",
            sortValue: (d) => d.total,
            render: (d) => (
              <span className="font-semibold">{money(d.total, d.currency || "AED")}</span>
            ),
          },
          {
            key: "status",
            label: "Status",
            sortValue: (d) => d.status,
            render: (d) => {
              const today = new Date().toISOString().slice(0, 10);
              const overdue =
                (d.balance ?? 0) > 0 &&
                !!d.due_date &&
                d.due_date < today &&
                d.status !== "paid";
              return (
                <div>
                  <Badge tone={overdue ? "danger" : statusTone(d.status)}>
                    {overdue ? "overdue" : d.status}
                  </Badge>
                  {(d.paid ?? 0) > 0 && (d.balance ?? 0) > 0 && (
                    <p className="text-[11px] text-brand-400 mt-0.5 tabular-nums">
                      {money(d.balance ?? 0, d.currency || "AED")} due
                    </p>
                  )}
                </div>
              );
            },
          },
          {
            key: "upd",
            label: "Updated",
            sortValue: (d) => d.updated_at,
            render: (d) => fmtDate(d.updated_at),
          },
          {
            key: "share",
            label: "Sharing",
            render: (d) => (
              <ShareToggle
                shared={d.shared}
                onToggle={async (next) => {
                  try {
                    await billing.shareDoc(d.id, next);
                    loadDocs();
                    toast.success(next ? "Shared with team." : "Set to private.");
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : String(e));
                  }
                }}
              />
            ),
          },
          {
            key: "act",
            label: "",
            render: (d) => (
              <div className="flex items-center gap-1">
                <button
                  aria-label="Payments"
                  title="Record payment"
                  className="text-brand-600 hover:bg-brand-100 rounded-lg p-1.5 cursor-pointer transition-colors duration-200"
                  onClick={() => setPayFor(d)}
                >
                  <CreditCard size={15} />
                </button>
                <button
                  aria-label="Edit"
                  className="text-brand-600 hover:bg-brand-100 rounded-lg p-1.5 cursor-pointer transition-colors duration-200"
                  onClick={() => editInvoice(d.id)}
                >
                  <Pencil size={15} />
                </button>
                <button
                  aria-label="Duplicate"
                  className="text-brand-600 hover:bg-brand-100 rounded-lg p-1.5 cursor-pointer transition-colors duration-200"
                  onClick={() => duplicateInvoice(d.id)}
                >
                  <Copy size={15} />
                </button>
                <button
                  aria-label="Delete"
                  className="text-danger hover:bg-danger/10 rounded-lg p-1.5 cursor-pointer transition-colors duration-200"
                  onClick={async () => {
                    if (!(await confirm({ title: "Delete invoice", message: `Delete ${d.number}? This cannot be undone.` }))) return;
                    await billing.deleteDoc(d.id);
                    loadDocs();
                    toast.success(`Deleted ${d.number}`);
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ),
          },
        ]}
      />

      {company && (
        <CompanyModal
          open={companyOpen}
          company={company}
          onClose={() => setCompanyOpen(false)}
          onSaved={(c) => {
            setCompany(c);
            setCompanyOpen(false);
          }}
        />
      )}

      <ScanDocModal open={scanOpen} onClose={() => setScanOpen(false)} />

      <PaymentsModal
        doc={payFor}
        onClose={() => setPayFor(null)}
        onSaved={loadDocs}
      />
    </div>
  );
}

/* ---------------- Payments ---------------- */

function PaymentsModal({
  doc,
  onClose,
  onSaved,
}: {
  doc: InvoiceDocSummary | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast, confirm } = useUI();
  const [rows, setRows] = useState<InvoicePayment[]>([]);
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState("bank transfer");
  const [paidAt, setPaidAt] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [busy, setBusy] = useState(false);

  const load = () => {
    if (!doc) return;
    billing.payments(doc.id).then(setRows).catch(() => setRows([]));
  };
  useEffect(load, [doc?.id]);

  const total = doc?.total ?? 0;
  const paid = rows.reduce((s, p) => s + Number(p.amount), 0);
  const balance = Math.max(0, total - paid);

  const add = async () => {
    if (!doc || amount <= 0) return;
    setBusy(true);
    try {
      await billing.addPayment(doc.id, amount, method || null, paidAt);
      setAmount(0);
      load();
      onSaved();
      toast.success("Payment recorded.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    if (!(await confirm({ title: "Remove payment", message: "Remove this payment record? This cannot be undone." }))) return;
    try {
      await billing.removePayment(id);
      load();
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  if (!doc) return null;
  const ccy = doc.currency || "AED";
  return (
    <Modal open={!!doc} onClose={onClose} title={`Payments — ${doc.number}`}>
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="rounded-xl bg-brand-50 px-3 py-2.5">
          <p className="text-[11px] text-brand-400">Total</p>
          <p className="font-display font-bold text-ink tabular-nums">
            {money(total, ccy)}
          </p>
        </div>
        <div className="rounded-xl bg-success/10 px-3 py-2.5">
          <p className="text-[11px] text-brand-400">Paid</p>
          <p className="font-display font-bold text-success tabular-nums">
            {money(paid, ccy)}
          </p>
        </div>
        <div className="rounded-xl bg-primary-100 px-3 py-2.5">
          <p className="text-[11px] text-brand-400">Balance</p>
          <p className="font-display font-bold text-primary-700 tabular-nums">
            {money(balance, ccy)}
          </p>
        </div>
      </div>

      {rows.length > 0 && (
        <ul className="space-y-1.5 mb-4 max-h-44 overflow-y-auto">
          {rows.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between rounded-lg bg-white border border-brand-100 px-3 py-2 text-sm"
            >
              <span className="tabular-nums font-semibold text-ink">
                {money(Number(p.amount), ccy)}
              </span>
              <span className="text-brand-400 text-xs">
                {p.method ?? "—"} · {fmtDate(p.paid_at)}
              </span>
              <button
                aria-label="Remove payment"
                onClick={() => remove(p.id)}
                className="text-brand-300 hover:text-danger cursor-pointer"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
        <Field label="Amount">
          <input
            type="number"
            className="input"
            placeholder="0"
            value={amount || ""}
            onChange={(e) => setAmount(numInput(e.target.value))}
          />
        </Field>
        <Field label="Method">
          <select
            className="select"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            <option value="bank transfer">Bank transfer</option>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="cheque">Cheque</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <button
          className="btn-primary"
          disabled={busy || amount <= 0}
          onClick={add}
        >
          <Plus size={15} /> Add
        </button>
      </div>
      <Field label="Date">
        <input
          type="date"
          className="input mt-2"
          value={paidAt}
          onChange={(e) => setPaidAt(e.target.value)}
        />
      </Field>
    </Modal>
  );
}

/* ---------------- Editor ---------------- */

function Editor({
  form,
  setForm,
  onBack,
  onSave,
  onFinalize,
  onRevertDraft,
  saving,
}: {
  form: Form;
  setForm: (f: Form) => void;
  onBack: () => void;
  onSave: () => void;
  onFinalize: () => void;
  onRevertDraft: () => void;
  saving: boolean;
}) {
  const { toast, confirm } = useUI();
  const invoiceRef = useRef<HTMLDivElement>(null);
  const downloadPdf = () => {
    if (invoiceRef.current) {
      // Capture the full A4 sheet (with padding), not just the inner div
      const sheet = invoiceRef.current.closest('.invoice-print') as HTMLElement;
      downloadElementAsPdf(sheet || invoiceRef.current, form.number || "invoice");
    } else window.print();
  };
  const set = <K extends keyof Form>(k: K, v: Form[K]) =>
    setForm({ ...form, [k]: v });

  const [designing, setDesigning] = useState(false);
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>(loadCustomTemplates);
  const allTemplates = [...TEMPLATES, ...customTemplates.map((t) => ({ id: t.id, name: t.name }))];
  const removeTpl = async (id: string, name: string) => {
    if (
      !(await confirm({
        title: "Delete template",
        message: `Delete custom template "${name}"? This cannot be undone.`,
        confirmLabel: "Delete",
        danger: true,
      }))
    )
      return;
    setCustomTemplates(deleteCustomTemplate(id));
    if (form.template === id) set("template", "minimal");
    toast.success("Template deleted.");
  };

  const setItem = (idx: number, patch: Partial<Item>) => {
    const items = form.items.map((it, i) =>
      i === idx ? { ...it, ...patch } : it
    );
    setForm({ ...form, items });
  };
  const addItem = () =>
    setForm({
      ...form,
      items: [...form.items, { description: "", qty: 1, unit_price: 0, unit: "", custom: {} }],
    });
  const removeItem = (idx: number) =>
    setForm({ ...form, items: form.items.filter((_, i) => i !== idx) });

  const setItemCustom = (idx: number, key: string, value: string) => {
    const items = form.items.map((it, i) =>
      i === idx ? { ...it, custom: { ...it.custom, [key]: value } } : it
    );
    setForm({ ...form, items });
  };

  const addCustomColumn = () => {
    const label = window.prompt("Column name:")?.trim();
    if (!label) return;
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `col_${Date.now()}`;
    if (form.customColumns.some(c => c.key === key)) return;
    setForm({ ...form, customColumns: [...form.customColumns, { key, label }] });
  };

  const removeCustomColumn = (key: string) => {
    setForm({
      ...form,
      customColumns: form.customColumns.filter(c => c.key !== key),
      items: form.items.map(it => {
        const c = { ...it.custom };
        delete c[key];
        return { ...it, custom: c };
      }),
    });
  };

  const onLogo = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => set("logo", String(reader.result));
    reader.readAsDataURL(file);
  };

  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [custModal, setCustModal] = useState(false);
  const loadCustomers = () =>
    crm.customers().then(setCustomers).catch(() => toast.error("Failed to load customers"));
  useEffect(() => {
    loadCustomers();
  }, []);

  const applyCustomer = (c: CrmCustomer) =>
    setForm({
      ...form,
      customer_name: c.company || c.name,
      customer_address: c.address ?? "",
      customer_email: c.email ?? "",
      // Prefer the dedicated TRN field; fall back to the legacy segment hack.
      customer_trn:
        c.trn ??
        (c.segment?.startsWith("TRN:")
          ? c.segment.slice(4).trim()
          : form.customer_trn),
    });

  const [viewAll, setViewAll] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [viewOpen, setViewOpen] = useState(false);
  const viewPreviewRef = useRef<HTMLDivElement>(null);
  const [pageCount, setPageCount] = useState(1);

  // Close view modal on Escape
  useEffect(() => {
    if (!viewOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setViewOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewOpen]);

  // Calculate page count for the full-screen preview
  useEffect(() => {
    if (!viewOpen || !viewPreviewRef.current) { setPageCount(1); return; }
    const el = viewPreviewRef.current;
    const measure = () => {
      const contentHeight = el.scrollHeight;
      const pageHeight = 1027; // A4 at 96dpi minus padding
      setPageCount(Math.max(1, Math.ceil(contentHeight / pageHeight)));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [viewOpen, form.items.length, form.template]);

  const [showDiscount, setShowDiscount] = useState((form.discount || 0) > 0);
  const m = (v: number) => money(v, form.currency || "AED");
  const shown = viewAll ? allTemplates : allTemplates.slice(0, 5);

  const saveAndSend = async () => {
    await onSave();
    if (!form.customer_email) {
      toast.error("Add a customer email (Invoice Details) to send this invoice.");
      return;
    }
    const t = invoiceTotals(form.items, form.discount || 0, form.tax_rate || 0);
    let portalUrl = "";
    try {
      if (form.id) {
        const token = await billing.publicLink(form.id);
        portalUrl = `${location.origin}${location.pathname}#/portal/${token}`;
      }
    } catch {
      /* link optional */
    }
    try {
      await sendEmail({
        to: form.customer_email,
        subject: `Invoice ${form.number} from ${form.seller_name}`,
        html: emailShell(
          `Invoice ${form.number}`,
          `<p>Dear ${esc(form.customer_name || "customer")},</p>
           <p>Please find your invoice <b>${esc(form.number)}</b>.</p>
           <table style="width:100%;font-size:14px;margin:12px 0">
             <tr><td>Subtotal</td><td style="text-align:right">${m(
               t.subtotal
             )}</td></tr>
             ${
               t.discount
                 ? `<tr><td>Discount</td><td style="text-align:right">-${m(
                     t.discount
                   )}</td></tr>`
                 : ""
             }
             ${
               (form.tax_rate || 0) > 0
                 ? `<tr><td>VAT (${form.tax_rate}%)</td><td style="text-align:right">${m(
                     t.tax
                   )}</td></tr>`
                 : ""
             }
             <tr><td><b>Total</b></td><td style="text-align:right"><b>${m(
               t.total
             )}</b></td></tr>
           </table>
           ${
             portalUrl
               ? `<p style="margin:16px 0"><a href="${portalUrl}" style="background:#FFD600;color:#0A0A0A;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:700;display:inline-block">View &amp; pay online</a></p>`
               : ""
           }
           <p>${esc(form.notes ?? "")}</p>`
        ),
      });
      toast.success(`Invoice emailed to ${form.customer_email}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div>
      {/* header bar */}
      <div className="no-print flex items-start justify-between mb-6 gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <button
            className="rounded-xl p-2 text-brand-500 hover:bg-brand-100 transition-colors cursor-pointer mt-0.5"
            onClick={onBack}
            aria-label="Back"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-[28px] leading-9 font-bold text-ink">
              Create Invoice
            </h1>
            <p className="text-sm text-brand-500 mt-0.5">
              Create and send professional invoices to your customers
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone={statusTone(form.status)}>{form.status}</Badge>
          {!form.id && (
            <span className="text-xs font-semibold text-brand-400">Unsaved</span>
          )}
          <button
            className="btn-ghost"
            onClick={() => setViewOpen(true)}
          >
            <Maximize2 size={15} /> View
          </button>
          <button
            className="btn-ghost"
            onClick={downloadPdf}
          >
            <Download size={15} /> PDF
          </button>
          <button
            className="btn-ghost"
            onClick={onSave}
            disabled={saving}
            title="Save without sending"
          >
            <Save size={15} /> {saving ? "Saving…" : "Save"}
          </button>
          {form.status === "draft" ? (
            <button
              className="btn-primary !bg-success !text-white"
              onClick={onFinalize}
              disabled={saving}
              title="Finalize — counts as issued and shows in reports & the dashboard"
            >
              <CheckCircle2 size={15} /> Mark as done
            </button>
          ) : (
            <button
              className="btn-ghost"
              onClick={onRevertDraft}
              disabled={saving}
              title="Move this invoice back to draft"
            >
              <Pencil size={15} /> Move to draft
            </button>
          )}
          <button
            className="btn-primary"
            onClick={saveAndSend}
            disabled={saving}
            title="Save and email the invoice to the customer"
          >
            <Send size={15} /> Send
          </button>
        </div>
      </div>

      <CustomerModal
        open={custModal}
        onClose={() => setCustModal(false)}
        onSaved={(c) => {
          applyCustomer(c);
          setCustModal(false);
          loadCustomers();
        }}
      />

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_minmax(340px,440px)] gap-5 items-start">
        {/* ---------- left: builder ---------- */}
        <div className="no-print space-y-4">
          {/* 1 · Choose template */}
          <Step
            n={1}
            title="Choose Template"
            subtitle="Select a template for your invoice"
            action={
              <div className="flex items-center gap-2">
                <button
                  className="btn-ghost text-xs"
                  onClick={() => setViewAll((v) => !v)}
                >
                  {viewAll ? "Show less" : "View all templates"}
                </button>
                <button
                  className="btn-ghost text-xs flex items-center gap-1"
                  onClick={() => setDesigning(true)}
                >
                  <Plus size={13} /> Create Template
                </button>
              </div>
            }
          >
            <div
              className={
                viewAll
                  ? "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3"
                  : "flex gap-3 overflow-x-auto pb-1"
              }
            >
              {shown.map((tpl) => {
                const active = form.template === tpl.id;
                const isCustom = tpl.id.startsWith("custom-");
                const ct = isCustom ? customTemplates.find((c) => c.id === tpl.id) : null;
                const isFile = ct?.type === "file";
                return (
                  <button
                    key={tpl.id}
                    onClick={() => set("template", tpl.id)}
                    className={`group relative shrink-0 w-32 rounded-xl border-2 p-2 text-left transition-all cursor-pointer ${
                      active
                        ? "border-primary-400 bg-primary-50 shadow-glow"
                        : "border-brand-200 bg-white hover:border-primary-300"
                    }`}
                  >
                    {active && (
                      <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-primary-400 text-ink grid place-items-center z-10">
                        <Check size={11} strokeWidth={3} />
                      </span>
                    )}
                    {isCustom && (
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`Delete template ${tpl.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeTpl(tpl.id, tpl.name);
                        }}
                        className="absolute top-1.5 left-1.5 z-20 grid h-5 w-5 place-items-center rounded-full bg-white/90 text-brand-400 opacity-0 shadow-sm transition-opacity hover:text-danger group-hover:opacity-100 cursor-pointer"
                      >
                        <Trash2 size={11} />
                      </span>
                    )}
                    <TemplateTilePreview templateId={tpl.id} customTemplates={customTemplates} />
                    <p className="text-xs font-semibold text-ink mt-2 capitalize flex items-center gap-1">
                      {tpl.name}
                      {isFile ? (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 font-medium flex items-center gap-0.5">
                          <Upload size={8} /> Uploaded
                        </span>
                      ) : isCustom ? (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-primary-100 text-primary-700 font-medium">Custom</span>
                      ) : null}
                    </p>
                  </button>
                );
              })}
            </div>
          </Step>

          {/* 2 · Invoice details */}
          <Step n={2} title="Invoice Details">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <Field label="Customer">
                  <div className="flex gap-2">
                    <select
                      className="select"
                      value=""
                      onChange={(e) => {
                        const c = customers.find(
                          (x) => String(x.id) === e.target.value
                        );
                        if (c) applyCustomer(c);
                      }}
                    >
                      <option value="">
                        {customers.length
                          ? "Select saved customer…"
                          : "No saved customers yet"}
                      </option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.company || c.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn-ghost shrink-0"
                      onClick={() => setCustModal(true)}
                      title="Add customer"
                    >
                      <Plus size={15} />
                    </button>
                  </div>
                </Field>
                <Field label="Customer / Company Name">
                  <input
                    className="input"
                    placeholder="Acme Corporation LLC"
                    value={form.customer_name}
                    onChange={(e) => set("customer_name", e.target.value)}
                  />
                </Field>
                <Field label="Billing Address">
                  <textarea
                    className="textarea"
                    rows={4}
                    placeholder="Street, City, Country"
                    value={form.customer_address ?? ""}
                    onChange={(e) =>
                      set("customer_address", e.target.value)
                    }
                  />
                </Field>
                <Field label="Customer Email / TRN">
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      className="input"
                      placeholder="Email"
                      value={form.customer_email ?? ""}
                      onChange={(e) =>
                        set("customer_email", e.target.value)
                      }
                    />
                    <input
                      className="input"
                      placeholder="TRN"
                      value={form.customer_trn ?? ""}
                      onChange={(e) =>
                        set("customer_trn", e.target.value)
                      }
                    />
                  </div>
                </Field>
              </div>
              <div className="space-y-3">
                <Field label="Document Title">
                  <input
                    className="input"
                    placeholder="INVOICE"
                    value={form.doc_title || ""}
                    list="doc-title-suggestions"
                    onChange={(e) => set("doc_title", e.target.value)}
                  />
                  <datalist id="doc-title-suggestions">
                    <option value="Tax Invoice" />
                    <option value="Proforma Invoice" />
                    <option value="Commercial Invoice" />
                    <option value="Invoice" />
                    <option value="Quotation" />
                    <option value="Receipt" />
                    <option value="Credit Note" />
                    <option value="Debit Note" />
                    <option value="Delivery Note" />
                    <option value="Purchase Order" />
                    <option value="Statement" />
                  </datalist>
                </Field>
                <Field label="Invoice Number">
                  <div className="flex gap-2">
                    <input
                      className="input"
                      value={form.number}
                      onChange={(e) => set("number", e.target.value)}
                    />
                    <span
                      className="grid place-items-center rounded-xl border border-brand-200 px-2.5 text-brand-400"
                      title="Numbering"
                    >
                      <Settings size={15} />
                    </span>
                  </div>
                </Field>
                <Field label="Invoice Date">
                  <input
                    type="date"
                    className="input"
                    value={form.issue_date ?? ""}
                    onChange={(e) => set("issue_date", e.target.value)}
                  />
                </Field>
                <Field label="Due Date (optional)">
                  <input
                    type="date"
                    className="input"
                    value={form.due_date ?? ""}
                    onChange={(e) => set("due_date", e.target.value)}
                  />
                </Field>
                <Field label="Document type">
                  <input
                    className="input"
                    list="filey-doc-types"
                    value={form.doc_type ?? ""}
                    onChange={(e) => set("doc_type", e.target.value)}
                    placeholder="Tax Invoice"
                  />
                  <datalist id="filey-doc-types">
                    {[
                      "Tax Invoice",
                      "Proforma Invoice",
                      "Commercial Invoice",
                      "Purchase Order",
                      "Quotation",
                      "Credit Note",
                      "Debit Note",
                      "Receipt",
                      "Delivery Note",
                    ].map((o) => (
                      <option key={o} value={o} />
                    ))}
                  </datalist>
                </Field>
                <Field label="Currency">
                  <select
                    className="select"
                    value={form.currency || "AED"}
                    onChange={(e) => set("currency", e.target.value)}
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} — {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
          </Step>

          {/* 3 · Items */}
          <Step n={3} title="Items">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold text-brand-400">
                    <th className="py-2 pr-2 w-6">#</th>
                    <th className="py-2 px-2">Description</th>
                    <th className="py-2 px-2 w-24 text-right">Qty</th>
                    <th className="py-2 px-2 w-24 text-right">Unit</th>
                    {form.customColumns.map((col, idx) => (
                      <th
                        key={col.key}
                        className="py-2 px-2 text-right group relative cursor-grab active:cursor-grabbing"
                        draggable
                        onDragStart={(e) => { e.dataTransfer.setData("text/plain", col.key); e.dataTransfer.effectAllowed = "move"; }}
                        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const fromKey = e.dataTransfer.getData("text/plain");
                          if (fromKey && fromKey !== col.key) {
                            const fromIdx = form.customColumns.findIndex(c => c.key === fromKey);
                            const toIdx = idx;
                            if (fromIdx >= 0) {
                              const next = [...form.customColumns];
                              const [moved] = next.splice(fromIdx, 1);
                              next.splice(toIdx, 0, moved);
                              setForm({ ...form, customColumns: next });
                            }
                          }
                        }}
                      >
                        <span className="text-[10px]">{col.label}</span>
                        <button
                          className="ml-1 opacity-0 group-hover:opacity-100 text-brand-300 hover:text-danger inline cursor-pointer"
                          onClick={(e) => { e.stopPropagation(); removeCustomColumn(col.key); }}
                          title="Remove column"
                        >×</button>
                      </th>
                    ))}
                    <th className="py-2 px-2 w-32 text-right">Unit Price</th>
                    {(form.tax_rate || 0) > 0 && (
                      <th className="py-2 px-2 w-16 text-right">Tax</th>
                    )}
                    <th className="py-2 px-2 w-28 text-right">Amount</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {form.items.map((it, i) => (
                    <tr key={i} className="border-t border-brand-100">
                      <td className="py-2 pr-2 text-brand-400">{i + 1}</td>
                      <td className="py-2 px-2">
                        <input
                          className="input"
                          placeholder="Item description"
                          value={it.description}
                          onChange={(e) =>
                            setItem(i, { description: e.target.value })
                          }
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="number"
                          className="input text-right !px-2"
                          value={it.qty || ""}
                          placeholder="0"
                          onChange={(e) =>
                            setItem(i, { qty: numInput(e.target.value) })
                          }
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          className="input text-right !px-2"
                          placeholder="pcs"
                          value={it.unit || ""}
                          list="unit-suggestions"
                          onChange={(e) =>
                            setItem(i, { unit: e.target.value })
                          }
                        />
                      </td>
                      {form.customColumns.map((col) => (
                        <td key={col.key} className="py-2 px-2">
                          <input
                            className="input text-right !px-2 !py-1 text-xs"
                            placeholder={col.label}
                            value={it.custom?.[col.key] || ""}
                            onChange={(e) =>
                              setItemCustom(i, col.key, e.target.value)
                            }
                          />
                        </td>
                      ))}
                      <td className="py-2 px-2">
                        <input
                          type="number"
                          className="input text-right !px-2"
                          placeholder="0"
                          value={it.unit_price || ""}
                          onChange={(e) =>
                            setItem(i, { unit_price: numInput(e.target.value) })
                          }
                        />
                      </td>
                      {(form.tax_rate || 0) > 0 && (
                        <td className="py-2 px-2 text-right text-brand-500">
                          {form.tax_rate}%
                        </td>
                      )}
                      <td className="py-2 px-2 text-right font-semibold text-ink">
                        {m((it.qty || 0) * (it.unit_price || 0))}
                      </td>
                      <td className="py-2">
                        <button
                          aria-label="Remove line"
                          className="text-danger hover:bg-danger/10 rounded-lg p-1.5 cursor-pointer transition-colors"
                          onClick={() => removeItem(i)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Custom column management */}
            {form.customColumns.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 mt-2 text-xs text-brand-400">
                <span className="mr-1">Custom fields (drag to reorder):</span>
                {form.customColumns.map((col, idx) => (
                  <span
                    key={col.key}
                    className="inline-flex items-center gap-0.5 bg-brand-50 border border-brand-200 rounded px-1.5 py-0.5 cursor-grab active:cursor-grabbing select-none"
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData("text/plain", col.key); e.dataTransfer.effectAllowed = "move"; }}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const fromKey = e.dataTransfer.getData("text/plain");
                      if (fromKey && fromKey !== col.key) {
                        const fromIdx = form.customColumns.findIndex(c => c.key === fromKey);
                        const toIdx = idx;
                        if (fromIdx >= 0) {
                          const next = [...form.customColumns];
                          const [moved] = next.splice(fromIdx, 1);
                          next.splice(toIdx, 0, moved);
                          setForm({ ...form, customColumns: next });
                        }
                      }
                    }}
                  >
                    <span className="font-medium">{col.label}</span>
                    <button className="text-brand-300 hover:text-danger ml-0.5 cursor-pointer" onClick={(e) => { e.stopPropagation(); removeCustomColumn(col.key); }} title="Remove">×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2 mt-3">
              <button className="btn-primary" onClick={addItem}>
                <Plus size={14} /> Add Item
              </button>
              <button className="btn-ghost text-xs" onClick={addCustomColumn}>
                <Plus size={12} /> Add Field
              </button>
              <datalist id="unit-suggestions">
                <option value="pcs" />
                <option value="L" />
                <option value="mL" />
                <option value="kg" />
                <option value="g" />
                <option value="MT" />
                <option value="ton" />
                <option value="m" />
                <option value="cm" />
                <option value="ft" />
                <option value="sqm" />
                <option value="sqft" />
                <option value="hrs" />
                <option value="days" />
                <option value="set" />
                <option value="box" />
                <option value="carton" />
                <option value="drum" />
                <option value="barrel" />
                <option value="pack" />
                <option value="roll" />
                <option value="pair" />
                <option value="dozen" />
              </datalist>
              <button
                className="btn-ghost"
                onClick={() => setShowDiscount((v) => !v)}
              >
                <Plus size={14} /> Add Discount
              </button>
            </div>
            {showDiscount && (
              <div className="mt-3 max-w-xs">
                <Field label="Discount (amount)">
                  <input
                    type="number"
                    className="input"
                    placeholder="0"
                    value={form.discount || ""}
                    onChange={(e) => set("discount", numInput(e.target.value))}
                  />
                </Field>
              </div>
            )}
          </Step>

          {/* 5 · Additional settings */}
          <Step n={5} title="Additional Settings">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-xl border border-brand-200 p-4">
                <div className="flex items-center gap-2 text-ink font-semibold text-sm">
                  <Settings size={15} /> Invoice Settings
                </div>
                <div className="mt-3 space-y-2">
                  <div>
                    <p className="text-xs font-semibold text-brand-600 mb-1.5">
                      Apply VAT
                    </p>
                    <div className="flex rounded-lg bg-brand-100 p-0.5">
                      {([["Yes", true], ["No", false]] as const).map(
                        ([lbl, on]) => {
                          const active = (form.tax_rate || 0) > 0 === on;
                          return (
                            <button
                              key={lbl}
                              type="button"
                              onClick={() =>
                                set(
                                  "tax_rate",
                                  on
                                    ? form.tax_rate > 0
                                      ? form.tax_rate
                                      : 5
                                    : 0
                                )
                              }
                              className={`flex-1 rounded-md px-2.5 py-1 text-xs font-semibold cursor-pointer transition-colors ${
                                active
                                  ? "bg-white text-ink shadow-bento"
                                  : "text-brand-500 hover:text-ink"
                              }`}
                            >
                              {lbl}
                            </button>
                          );
                        }
                      )}
                    </div>
                  </div>
                  {(form.tax_rate || 0) > 0 && (
                    <input
                      type="number"
                      className="input"
                      placeholder="VAT rate %"
                      value={form.tax_rate}
                      onChange={(e) => set("tax_rate", numInput(e.target.value))}
                    />
                  )}
                  <select
                    className="select"
                    value={form.status}
                    onChange={(e) => set("status", e.target.value)}
                  >
                    {["draft", "issued", "paid", "cancelled"].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center justify-between gap-2 text-xs font-semibold text-brand-600 border border-brand-200 rounded-xl px-3 py-2">
                    Accent color
                    <ColorPicker
                      value={form.accent}
                      onChange={(hex) => set("accent", hex)}
                    />
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-brand-200 p-4">
                <div className="flex items-center gap-2 text-ink font-semibold text-sm">
                  <StickyNote size={15} /> Notes
                </div>
                <textarea
                  className="textarea mt-3"
                  rows={3}
                  placeholder="Add notes for this invoice"
                  value={form.notes ?? ""}
                  onChange={(e) => set("notes", e.target.value)}
                />
                <textarea
                  className="textarea mt-2"
                  rows={2}
                  placeholder="Payment terms"
                  value={form.terms ?? ""}
                  onChange={(e) => set("terms", e.target.value)}
                />
              </div>
              <div className="rounded-xl border border-brand-200 p-4">
                <div className="flex items-center gap-2 text-ink font-semibold text-sm">
                  <Paperclip size={15} /> Logo / Attachment
                </div>
                <div className="mt-3">
                  {form.logo ? (
                    <div className="flex items-center gap-2">
                      <img
                        src={form.logo}
                        alt="logo"
                        className="h-12 w-12 object-contain border border-brand-200 rounded-lg bg-white"
                      />
                      <button
                        className="btn-ghost text-xs"
                        onClick={() => set("logo", undefined)}
                      >
                        <X size={13} /> Remove
                      </button>
                    </div>
                  ) : (
                    <label className="btn-ghost w-full justify-center cursor-pointer">
                      <Upload size={14} /> Upload logo
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => onLogo(e.target.files?.[0])}
                      />
                    </label>
                  )}
                  <p className="text-[11px] text-brand-400 mt-2">
                    Tip: set this once in Settings → Company Details to
                    auto-fill every invoice.
                  </p>
                </div>
              </div>
              <div className="rounded-xl border border-brand-200 p-4">
                <div className="flex items-center gap-2 text-ink font-semibold text-sm">
                  <StickyNote size={15} /> Stamp & Signature
                </div>
                <div className="mt-3 space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-brand-600 mb-1">Stamp</p>
                    {form.stamp?.data ? (
                      <div className="flex items-center gap-2">
                        <img src={form.stamp.data} alt="stamp" className="h-14 object-contain border border-brand-200 rounded bg-white" />
                        <button className="btn-ghost text-xs text-danger" onClick={() => setForm({ ...form, stamp: undefined })}>
                          <X size={12} /> Remove
                        </button>
                      </div>
                    ) : (
                      <label className="btn-ghost w-full justify-center cursor-pointer text-xs">
                        <Upload size={12} /> Upload Stamp
                        <input type="file" accept="image/*" className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            const r = new FileReader();
                            r.onload = () => setForm({ ...form, stamp: { data: String(r.result), x: 75, y: 70 } });
                            r.readAsDataURL(f);
                          }}
                        />
                      </label>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-brand-600 mb-1">Signature</p>
                    {form.signature?.data ? (
                      <div className="flex items-center gap-2">
                        <img src={form.signature.data} alt="signature" className="h-10 object-contain border border-brand-200 rounded bg-white" />
                        <button className="btn-ghost text-xs text-danger" onClick={() => setForm({ ...form, signature: undefined })}>
                          <X size={12} /> Remove
                        </button>
                      </div>
                    ) : (
                      <label className="btn-ghost w-full justify-center cursor-pointer text-xs">
                        <Upload size={12} /> Upload Signature
                        <input type="file" accept="image/*" className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            const r = new FileReader();
                            r.onload = () => setForm({ ...form, signature: { data: String(r.result), x: 75, y: 85 } });
                            r.readAsDataURL(f);
                          }}
                        />
                      </label>
                    )}
                  </div>
                  <p className="text-[10px] text-brand-400">Drag stamp/signature on the preview to position.</p>
                </div>
              </div>
            </div>
          </Step>
        </div>

        {/* ---------- right: sticky panel (preview + template designer) ---------- */}
        <div className="xl:sticky xl:top-2 space-y-3">
          {/* Template Designer — shown above preview when creating */}
          {designing && (
            <TemplateDesigner
              onSave={(tpl) => {
                setCustomTemplates((prev) => [...prev, tpl]);
                // Select the new template immediately
                set("template", tpl.id);
                setDesigning(false);
              }}
              onClose={() => setDesigning(false)}
            />
          )}

          {/* Live Preview — always visible */}
          <div className="card !p-4">
            <div className="no-print flex items-center justify-between mb-3">
              <div>
                <p className="font-bold text-ink flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-ink text-white grid place-items-center text-xs font-bold">
                    4
                  </span>
                  Preview
                </p>
                <p className="text-xs text-brand-400 mt-0.5 ml-8">
                  This is how your invoice will look
                </p>
              </div>
            </div>

            <FitPreview
              baseWidth={device === "desktop" ? 794 : 420}
              zoom={zoom}
            >
              <div ref={invoiceRef}>
                <div style={{ position: "relative" }}>
                  {/* Stamp & Signature — behind text, watermark-style */}
                  {form.stamp?.data && (
                    <img
                      src={form.stamp.data}
                      alt="Stamp"
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData("type", "stamp"); }}
                      onDragEnd={(e) => {
                        const rect = (e.target as HTMLElement).parentElement!.getBoundingClientRect();
                        const x = ((e.clientX - rect.left) / rect.width) * 100;
                        const y = ((e.clientY - rect.top) / rect.height) * 100;
                        setForm({ ...form, stamp: { ...form.stamp!, x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) } });
                      }}
                      style={{
                        position: "absolute",
                        left: `${form.stamp.x}%`,
                        top: `${form.stamp.y}%`,
                        transform: "translate(-50%, -50%)",
                        maxHeight: 100,
                        maxWidth: 200,
                        opacity: 0.3,
                        mixBlendMode: "multiply",
                        cursor: "grab",
                        zIndex: 0,
                      }}
                    />
                  )}
                  {form.signature?.data && (
                    <img
                      src={form.signature.data}
                      alt="Signature"
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData("type", "signature"); }}
                      onDragEnd={(e) => {
                        const rect = (e.target as HTMLElement).parentElement!.getBoundingClientRect();
                        const x = ((e.clientX - rect.left) / rect.width) * 100;
                        const y = ((e.clientY - rect.top) / rect.height) * 100;
                        setForm({ ...form, signature: { ...form.signature!, x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) } });
                      }}
                      style={{
                        position: "absolute",
                        left: `${form.signature.x}%`,
                        top: `${form.signature.y}%`,
                        transform: "translate(-50%, -50%)",
                        maxHeight: 60,
                        maxWidth: 250,
                        opacity: 0.35,
                        mixBlendMode: "multiply",
                        cursor: "grab",
                        zIndex: 0,
                      }}
                    />
                  )}
                  <InvoiceView form={form} />
                </div>
              </div>
            </FitPreview>

            <div className="no-print flex items-center justify-between mt-3 gap-2 flex-wrap">
              <div className="flex items-center gap-1 rounded-xl bg-brand-50 p-1">
                <button
                  className={`rounded-lg p-1.5 cursor-pointer ${
                    device === "desktop"
                      ? "bg-primary-100 text-primary-700"
                      : "text-brand-400"
                  }`}
                  onClick={() => setDevice("desktop")}
                  aria-label="Desktop preview"
                >
                  <Monitor size={15} />
                </button>
                <button
                  className={`rounded-lg p-1.5 cursor-pointer ${
                    device === "mobile"
                      ? "bg-primary-100 text-primary-700"
                      : "text-brand-400"
                  }`}
                  onClick={() => setDevice("mobile")}
                  aria-label="Mobile preview"
                >
                  <Smartphone size={15} />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-lg border border-brand-200 p-1.5 text-brand-500 cursor-pointer hover:bg-brand-50"
                  onClick={() => setZoom((z) => Math.max(50, z - 10))}
                  aria-label="Zoom out"
                >
                  <Minus size={14} />
                </button>
                <span className="text-xs font-semibold text-brand-600 w-10 text-center">
                  {zoom}%
                </span>
                <button
                  className="rounded-lg border border-brand-200 p-1.5 text-brand-500 cursor-pointer hover:bg-brand-50"
                  onClick={() => setZoom((z) => Math.min(150, z + 10))}
                  aria-label="Zoom in"
                >
                  <Plus size={14} />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="btn-ghost text-xs"
                  onClick={onSave}
                  disabled={saving}
                >
                  <Save size={14} /> Save
                </button>
                <button
                  className="btn-primary text-xs"
                  onClick={downloadPdf}
                >
                  <Download size={14} /> PDF
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {viewOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 backdrop-blur-sm p-4" onClick={() => setViewOpen(false)}>
          <div className="flex max-h-[95vh] w-full max-w-7xl flex-col rounded-2xl bg-white dark:bg-[#24262C] shadow-bento-hover outline-none" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-brand-100 dark:border-[#2A2C33] px-6 py-4">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-bold text-ink">
                  {form.number || "Invoice preview"}
                </h2>
                <span className="text-xs font-semibold text-brand-400 bg-brand-50 dark:bg-white/10 dark:text-brand-500 px-2 py-0.5 rounded-full">
                  Page 1 of {pageCount}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="btn-ghost h-9 text-xs"
                  onClick={downloadPdf}
                >
                  <Download size={14} /> PDF
                </button>
                <button
                  onClick={() => setViewOpen(false)}
                  className="grid h-9 w-9 place-items-center rounded-xl text-brand-500 hover:bg-brand-100 hover:text-ink cursor-pointer"
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-6">
              <div className="mx-auto max-w-5xl">
                <div className="paper-texture rounded-xl border border-brand-200 p-8 shadow-sm dark:border-[#3A3D45] dark:bg-white" ref={viewPreviewRef}>
                  <div style={{ position: "relative" }}>
                    {form.stamp?.data && (
                      <img src={form.stamp.data} alt="Stamp" draggable
                        onDragEnd={(e) => {
                          const rect = (e.target as HTMLElement).parentElement!.getBoundingClientRect();
                          const x = ((e.clientX - rect.left) / rect.width) * 100;
                          const y = ((e.clientY - rect.top) / rect.height) * 100;
                          setForm({ ...form, stamp: { ...form.stamp!, x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) } });
                        }}
                        style={{ position: "absolute", left: `${form.stamp.x}%`, top: `${form.stamp.y}%`, transform: "translate(-50%,-50%)", maxHeight: 100, maxWidth: 200, opacity: 0.3, mixBlendMode: "multiply", cursor: "grab", zIndex: 0 }}
                      />
                    )}
                    {form.signature?.data && (
                      <img src={form.signature.data} alt="Signature" draggable
                        onDragEnd={(e) => {
                          const rect = (e.target as HTMLElement).parentElement!.getBoundingClientRect();
                          const x = ((e.clientX - rect.left) / rect.width) * 100;
                          const y = ((e.clientY - rect.top) / rect.height) * 100;
                          setForm({ ...form, signature: { ...form.signature!, x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) } });
                        }}
                        style={{ position: "absolute", left: `${form.signature.x}%`, top: `${form.signature.y}%`, transform: "translate(-50%,-50%)", maxHeight: 60, maxWidth: 250, opacity: 0.35, mixBlendMode: "multiply", cursor: "grab", zIndex: 0 }}
                      />
                    )}
                    <InvoiceView form={form} />
                  </div>
                </div>
                {pageCount > 1 && (
                  <p className="text-center text-xs text-brand-400 mt-3 font-medium">
                    Page 1 of {pageCount} — scroll to see all pages
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Step({
  n,
  title,
  subtitle,
  action,
  children,
}: {
  n: number;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="card">
      <div className="flex items-start justify-between mb-4 gap-3">
        <div className="flex items-center gap-2.5">
          <span className="w-7 h-7 rounded-full bg-ink text-white grid place-items-center text-xs font-bold shrink-0">
            {n}
          </span>
          <div>
            <p className="font-bold text-ink leading-tight">{title}</p>
            {subtitle && (
              <p className="text-xs text-brand-400 mt-0.5">{subtitle}</p>
            )}
          </div>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

/* ---------------- Customer modal (UAE FTA) ---------------- */

function CustomerModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (c: CrmCustomer) => void;
}) {
  const { toast } = useUI();
  const [f, setF] = useState({
    company: "",
    name: "",
    address: "",
    email: "",
    phone: "",
    trn: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open)
      setF({
        company: "",
        name: "",
        address: "",
        email: "",
        phone: "",
        trn: "",
      });
  }, [open]);

  const trnValid = !f.trn || /^\d{15}$/.test(f.trn.replace(/\s/g, ""));

  return (
    <Modal open={open} onClose={onClose} title="Add Customer">
      <p className="text-xs text-brand-500 -mt-2 mb-4">
        UAE FTA tax invoices require the customer's legal name, address and
        15-digit TRN for B2B supplies.
      </p>
      <div className="space-y-3">
        <Field label="Company / Legal Name">
          <input
            className="input"
            placeholder="Acme Corporation LLC"
            value={f.company}
            onChange={(e) => setF({ ...f, company: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Contact Name">
            <input
              className="input"
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
          </Field>
          <Field label="Phone">
            <input
              className="input"
              value={f.phone}
              onChange={(e) => setF({ ...f, phone: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Billing Address">
          <textarea
            className="textarea"
            rows={2}
            value={f.address}
            onChange={(e) => setF({ ...f, address: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email">
            <input
              className="input"
              value={f.email}
              onChange={(e) => setF({ ...f, email: e.target.value })}
            />
          </Field>
          <Field label="TRN (15 digits)">
            <input
              className="input"
              placeholder="100000000000003"
              value={f.trn}
              onChange={(e) => setF({ ...f, trn: e.target.value })}
            />
          </Field>
        </div>
        {!trnValid && (
          <p className="text-xs text-danger">
            TRN must be exactly 15 digits.
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn-primary"
          disabled={
            saving || (!f.company.trim() && !f.name.trim()) || !trnValid
          }
          onClick={async () => {
            setSaving(true);
            const trn = f.trn.replace(/\s/g, "");
            const payload = {
              name: f.name || f.company,
              company: f.company || undefined,
              email: f.email || undefined,
              phone: f.phone || undefined,
              address: f.address || undefined,
              segment: trn ? `TRN:${trn}` : undefined,
            };
            try {
              await crm.createCustomer(
                payload as Omit<CrmCustomer, "id" | "created_at">
              );
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Failed to create customer");
              setSaving(false);
              return;
            }
            onSaved({
              id: 0,
              created_at: "",
              ...payload,
            } as CrmCustomer);
          }}
        >
          {saving ? "Saving…" : "Save Customer"}
        </button>
      </div>
    </Modal>
  );
}

/* ---------------- Invoice templates ---------------- */

function InvoiceView({ form }: { form: Form }) {
  const t = totals(form);
  const ccy = form.currency || "AED";
  const m = (v: number) => money(v, ccy);

  // Resolve custom templates to their base layout for rendering
  const templateId = form.template?.startsWith("custom-")
    ? (loadCustomTemplates().find((ct) => ct.id === form.template)?.layout || "modern")
    : form.template;

  // Override accent color for custom templates
  const resolvedAccent = form.template?.startsWith("custom-")
    ? loadCustomTemplates().find((ct) => ct.id === form.template)?.accent || (form.accent || "#222222")
    : (form.accent || "#222222");
  const a = resolvedAccent;

  const Items = ({
    headerBg,
    bordered,
  }: {
    headerBg?: string;
    bordered?: boolean;
  }) => (
    <table className="w-full text-sm border-collapse mt-2">
      <thead>
        <tr
          style={{ background: headerBg, color: headerBg ? "#fff" : a }}
          className={bordered ? "" : "border-b-2"}
        >
          <th className="text-left py-2 px-2 font-semibold">Description</th>
          <th className="text-right py-2 px-2 font-semibold w-14">Qty</th>
          <th className="text-right py-2 px-2 font-semibold w-14">Unit</th>
          {form.customColumns.map((col) => (
            <th key={col.key} className="text-right py-2 px-2 font-semibold text-[10px]">{col.label}</th>
          ))}
          <th className="text-right py-2 px-2 font-semibold w-24">
            Unit Price
          </th>
          <th className="text-right py-2 px-2 font-semibold w-28">
            Amount
          </th>
        </tr>
      </thead>
      <tbody>
        {form.items.map((it, i) => (
          <tr
            key={i}
            className="border-b border-neutral-200"
            style={bordered ? { borderColor: "#000" } : undefined}
          >
            <td className="py-2 px-2">{it.description || "—"}</td>
            <td className="py-2 px-2 text-right">{it.qty}</td>
            <td className="py-2 px-2 text-right text-neutral-500">{it.unit || "—"}</td>
            {form.customColumns.map((col) => (
              <td key={col.key} className="py-2 px-2 text-right text-[10px] text-neutral-500">{it.custom?.[col.key] || "—"}</td>
            ))}
            <td className="py-2 px-2 text-right">{m(it.unit_price)}</td>
            <td className="py-2 px-2 text-right">
              {m((it.qty || 0) * (it.unit_price || 0))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const Totals = () => (
    <div className="ml-auto w-72 mt-6 text-sm">
      <Row k="Subtotal" v={m(t.subtotal)} />
      {form.discount > 0 && <Row k="Discount" v={`- ${m(form.discount)}`} />}
      {(form.tax_rate || 0) > 0 && (
        <Row k={`VAT (${form.tax_rate}%)`} v={m(t.tax)} />
      )}
      <div
        className="flex justify-between py-2 mt-1 font-bold text-base border-t-2"
        style={{ borderColor: a, color: a }}
      >
        <span>Total</span>
        <span>{m(t.total)}</span>
      </div>
    </div>
  );

  const Footer = () =>
    form.notes || form.terms ? (
      <div className="mt-10 pt-4 border-t border-neutral-200 text-xs text-neutral-500 space-y-1">
        {form.notes && <p>{form.notes}</p>}
        {form.terms && <p className="text-neutral-400">{form.terms}</p>}
      </div>
    ) : null;

  const Logo = ({ size = 56 }: { size?: number }) =>
    form.logo ? (
      <img
        src={form.logo}
        alt="logo"
        style={{ height: size }}
        className="object-contain"
      />
    ) : null;

  // --- File-based (uploaded image/PDF) template ---
  const customTemplate = form.template?.startsWith("custom-")
    ? loadCustomTemplates().find((ct) => ct.id === form.template)
    : null;

  if (customTemplate?.type === "file" && customTemplate.fileData) {
    const pw = customTemplate.paperSize === "Letter" ? 816 : 794;
    const ph = customTemplate.paperSize === "Letter" ? 1056 : 1122;
    const pos = customTemplate.positions || {};
    const ac = customTemplate.accent || a;

    // Helper: position a section using %-based coords
    const Section = ({ k, children }: { k: string; children: React.ReactNode }) => {
      const p = pos[k];
      if (!p) return null;
      return (
        <div
          className="absolute"
          style={{ left: `${p.x}%`, top: `${p.y}%` }}
        >
          {children}
        </div>
      );
    };

    return (
      <div
        className="relative text-neutral-900 overflow-hidden"
        style={{ width: pw, minHeight: ph, background: "#fff" }}
      >
        {/* Background image */}
        <img
          src={customTemplate.fileData}
          alt="Template background"
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ objectFit: "cover", opacity: 0.92 }}
        />

        {/* Seller — Company Info */}
        <Section k="seller">
          {form.logo && <img src={form.logo} alt="logo" style={{ height: 40 }} className="object-contain mb-1.5" />}
          <p className="font-bold text-sm text-neutral-900">{form.seller_name}</p>
          <p className="text-[10px] text-neutral-600 whitespace-pre-line leading-tight">{form.seller_address}</p>
          {form.seller_trn && <p className="text-[9px] text-neutral-500 mt-0.5">TRN: {form.seller_trn}</p>}
        </Section>

        {/* Header — Invoice title + number + dates */}
        <Section k="header">
          <p className="text-2xl font-extrabold tracking-tight" style={{ color: ac }}>{form.doc_title || "INVOICE"}</p>
          <p className="text-xs font-mono text-neutral-800 mt-0.5">{form.number}</p>
          <p className="text-[10px] text-neutral-500 mt-0.5">{fmtDate(form.issue_date)}</p>
          {form.due_date && <p className="text-[10px] text-neutral-500">Due: {fmtDate(form.due_date)}</p>}
        </Section>

        {/* Customer — Bill To */}
        <Section k="customer">
          <p className="text-[9px] uppercase tracking-wider text-neutral-500 mb-0.5">Bill To</p>
          <p className="font-semibold text-xs text-neutral-900">{form.customer_name}</p>
          <p className="text-[10px] text-neutral-600 whitespace-pre-line leading-tight">{form.customer_address}</p>
          {form.customer_trn && <p className="text-[9px] text-neutral-500 mt-0.5">TRN: {form.customer_trn}</p>}
        </Section>

        {/* Items table */}
        {pos.items && (
          <div
            className="absolute overflow-auto"
            style={{ left: `${pos.items.x}%`, top: `${pos.items.y}%`, maxWidth: "90%" }}
          >
            <Items headerBg={ac} />
          </div>
        )}

        {/* Totals */}
        {pos.totals && (
          <div
            className="absolute"
            style={{ left: `${pos.totals.x}%`, top: `${pos.totals.y}%` }}
          >
            <Totals />
          </div>
        )}

        {/* Footer — Notes/Terms */}
        <Section k="footer">
          {form.notes && <p className="text-[10px] text-neutral-600">{form.notes}</p>}
          {form.terms && <p className="text-[9px] text-neutral-400 mt-0.5">{form.terms}</p>}
        </Section>

        {/* Badge */}
        <div className="absolute bottom-2 right-2 z-20">
          <span className="text-[8px] text-neutral-400 bg-white/60 px-1.5 py-0.5 rounded-full">
            {customTemplate.name}
          </span>
        </div>
      </div>
    );
  }

  // ---- MINIMAL ----
  if (templateId === "minimal") {
    return (
      <div className="text-neutral-900">
        <div className="flex justify-between items-start">
          <div>
            <Logo />
            <p className="font-bold text-lg mt-3">{form.seller_name}</p>
            <p className="text-xs text-neutral-500 whitespace-pre-line">
              {form.seller_address}
            </p>
            {form.seller_trn && (
              <p className="text-xs text-neutral-500">
                TRN: {form.seller_trn}
              </p>
            )}
          </div>
          <div className="text-right">
            <p
              className="text-3xl font-extrabold tracking-tight"
              style={{ color: a }}
            >
              {form.doc_title || "INVOICE"}
            </p>
            <p className="text-sm font-mono mt-1">{form.number}</p>
          </div>
        </div>

        <div className="flex justify-between mt-10 text-sm">
          <div>
            <p className="text-xs uppercase tracking-wider text-neutral-400">
              Bill To
            </p>
            <p className="font-semibold mt-1">{form.customer_name}</p>
            <p className="text-xs text-neutral-500 whitespace-pre-line">
              {form.customer_address}
            </p>
            {form.customer_trn && (
              <p className="text-xs text-neutral-500">
                TRN: {form.customer_trn}
              </p>
            )}
          </div>
          <div className="text-right text-xs text-neutral-500">
            <p>Issued: {fmtDate(form.issue_date)}</p>
            <p>Due: {fmtDate(form.due_date)}</p>
          </div>
        </div>

        <Items />
        <Totals />
        <Footer />
      </div>
    );
  }

  // ---- CLASSIC ----
  if (templateId === "classic") {
    return (
      <div className="text-neutral-900">
        <div
          className="flex justify-between items-center px-6 py-5 -mx-12 -mt-12 mb-8"
          style={{ background: a, color: "#fff" }}
        >
          <div className="flex items-center gap-3">
            <Logo size={88} />
            <p className="font-bold text-xl">{form.seller_name}</p>
          </div>
          <p className="text-2xl font-extrabold tracking-widest">{form.doc_title || "INVOICE"}</p>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="border border-neutral-300 p-4">
            <p className="text-xs uppercase tracking-wider text-neutral-400 mb-1">
              From
            </p>
            <p className="font-semibold">{form.seller_name}</p>
            <p className="text-xs text-neutral-500 whitespace-pre-line">
              {form.seller_address}
            </p>
            {form.seller_trn && (
              <p className="text-xs text-neutral-500">
                TRN: {form.seller_trn}
              </p>
            )}
            {form.seller_email && (
              <p className="text-xs text-neutral-500">
                {form.seller_email}
              </p>
            )}
          </div>
          <div className="border border-neutral-300 p-4">
            <p className="text-xs uppercase tracking-wider text-neutral-400 mb-1">
              Bill To
            </p>
            <p className="font-semibold">{form.customer_name}</p>
            <p className="text-xs text-neutral-500 whitespace-pre-line">
              {form.customer_address}
            </p>
            {form.customer_trn && (
              <p className="text-xs text-neutral-500">
                TRN: {form.customer_trn}
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-between text-xs text-neutral-500 mt-4">
          <p className="font-mono">{form.number}</p>
          <p>
            Issued {fmtDate(form.issue_date)} · Due{" "}
            {fmtDate(form.due_date)}
          </p>
        </div>

        <Items headerBg={a} bordered />
        <Totals />
        <Footer />
      </div>
    );
  }

  const SellerContact = ({ cls = "text-neutral-500" }: { cls?: string }) => (
    <>
      {form.seller_email && <p className={`text-xs ${cls}`}>{form.seller_email}</p>}
      {form.seller_phone && <p className={`text-xs ${cls}`}>{form.seller_phone}</p>}
    </>
  );

  const Parties = () => (
    <div className="grid grid-cols-2 gap-8 text-sm mt-8">
      <div>
        <p className="text-xs uppercase tracking-wider text-neutral-400">From</p>
        <p className="font-semibold mt-1">{form.seller_name}</p>
        <p className="text-xs text-neutral-500 whitespace-pre-line">
          {form.seller_address}
        </p>
        {form.seller_trn && (
          <p className="text-xs text-neutral-500">TRN: {form.seller_trn}</p>
        )}
        <SellerContact />
      </div>
      <div>
        <p className="text-xs uppercase tracking-wider text-neutral-400">
          Bill To
        </p>
        <p className="font-semibold mt-1">{form.customer_name}</p>
        <p className="text-xs text-neutral-500 whitespace-pre-line">
          {form.customer_address}
        </p>
        {form.customer_trn && (
          <p className="text-xs text-neutral-500">TRN: {form.customer_trn}</p>
        )}
      </div>
    </div>
  );

  const Meta = () => (
    <div className="flex justify-between text-xs text-neutral-500 mt-4">
      <p className="font-mono">{form.number}</p>
      <p>
        Issued {fmtDate(form.issue_date)} · Due {fmtDate(form.due_date)}
      </p>
    </div>
  );

  const Initial = ({ size = 48 }: { size?: number }) =>
    form.logo ? (
      <Logo size={size * 2} />
    ) : (
      <div
        className="grid place-items-center rounded-full font-bold text-white"
        style={{ width: size, height: size, background: a }}
      >
        {(form.seller_name || "C").trim().charAt(0).toUpperCase()}
      </div>
    );

  // ---- CORPORATE ----
  if (templateId === "corporate") {
    return (
      <div className="text-neutral-900">
        <div className="flex justify-between items-start border-b-4 pb-5" style={{ borderColor: a }}>
          <div className="flex items-center gap-3">
            <Logo size={96} />
            <div>
              <p className="font-bold text-xl">{form.seller_name}</p>
              <p className="text-xs text-neutral-500 whitespace-pre-line">
                {form.seller_address}
              </p>
              <SellerContact />
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold tracking-wide" style={{ color: a }}>
              {(form.doc_type || ((form.tax_rate || 0) > 0 ? "Tax Invoice" : "Invoice")).toUpperCase()}
            </p>
            <p className="text-sm font-mono mt-1">{form.number}</p>
            {form.seller_trn && (
              <p className="text-xs text-neutral-500 mt-1">
                TRN {form.seller_trn}
              </p>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm mt-6">
          <div className="bg-neutral-50 p-4 rounded">
            <p className="text-xs uppercase tracking-wider text-neutral-400 mb-1">
              Bill To
            </p>
            <p className="font-semibold">{form.customer_name}</p>
            <p className="text-xs text-neutral-500 whitespace-pre-line">
              {form.customer_address}
            </p>
            {form.customer_trn && (
              <p className="text-xs text-neutral-500">TRN: {form.customer_trn}</p>
            )}
          </div>
          <div className="bg-neutral-50 p-4 rounded text-right">
            <p className="text-xs text-neutral-500">
              Issued {fmtDate(form.issue_date)}
            </p>
            <p className="text-xs text-neutral-500">
              Due {fmtDate(form.due_date)}
            </p>
          </div>
        </div>
        <Items headerBg={a} />
        <Totals />
        <Footer />
      </div>
    );
  }

  // ---- ELEGANT ----
  if (templateId === "elegant") {
    return (
      <div className="text-neutral-800 font-serif">
        <div className="text-center">
          <Logo size={104} />
          <p className="text-3xl tracking-[0.3em] mt-4" style={{ color: a }}>
            {form.doc_title || "INVOICE"}
          </p>
          <div className="mx-auto w-16 h-px my-3" style={{ background: a }} />
          <p className="text-xs tracking-widest text-neutral-500">
            {form.number} · {fmtDate(form.issue_date)}
          </p>
        </div>
        <div className="flex justify-between mt-10 text-sm">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-neutral-400">
              From
            </p>
            <p className="font-semibold mt-1">{form.seller_name}</p>
            <p className="text-xs text-neutral-500 whitespace-pre-line">
              {form.seller_address}
            </p>
            <SellerContact />
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-widest text-neutral-400">
              Billed To
            </p>
            <p className="font-semibold mt-1">{form.customer_name}</p>
            <p className="text-xs text-neutral-500 whitespace-pre-line">
              {form.customer_address}
            </p>
          </div>
        </div>
        <Items />
        <Totals />
        <Footer />
      </div>
    );
  }

  // ---- BOLD ----
  if (templateId === "bold") {
    return (
      <div className="text-neutral-900">
        <div
          className="-mx-12 -mt-12 px-12 pt-12 pb-10 mb-8"
          style={{ background: a, color: "#fff" }}
        >
          <div className="flex justify-between items-start">
            <Logo size={100} />
            <p className="text-5xl font-extrabold tracking-tight">{form.doc_title || "INVOICE"}</p>
          </div>
          <div className="flex justify-between items-end mt-8">
            <div>
              <p className="text-lg font-bold">{form.seller_name}</p>
              <p className="text-xs opacity-80 whitespace-pre-line">
                {form.seller_address}
              </p>
            </div>
            <div className="text-right text-sm">
              <p className="font-mono">{form.number}</p>
              <p className="opacity-80">Due {fmtDate(form.due_date)}</p>
            </div>
          </div>
        </div>
        <div className="text-sm">
          <p className="text-xs uppercase tracking-wider text-neutral-400">
            Bill To
          </p>
          <p className="font-semibold mt-1">{form.customer_name}</p>
          <p className="text-xs text-neutral-500 whitespace-pre-line">
            {form.customer_address}
          </p>
        </div>
        <Items headerBg={a} />
        <Totals />
        <Footer />
      </div>
    );
  }

  // ---- TECH ----
  if (templateId === "tech") {
    return (
      <div className="text-neutral-900 font-mono">
        <div className="flex justify-between items-start">
          <div>
            <Logo size={80} />
            <p className="text-sm font-bold mt-2">{form.seller_name}</p>
            <p className="text-[11px] text-neutral-500 whitespace-pre-line">
              {form.seller_address}
            </p>
            <SellerContact cls="text-neutral-500" />
          </div>
          <div
            className="px-4 py-3 rounded-lg text-right"
            style={{ background: `${a}15`, border: `1px solid ${a}` }}
          >
            <p className="text-lg font-bold" style={{ color: a }}>
              ./invoice
            </p>
            <p className="text-xs">{form.number}</p>
            <p className="text-[11px] text-neutral-500">
              {fmtDate(form.issue_date)} → {fmtDate(form.due_date)}
            </p>
          </div>
        </div>
        <div className="mt-8 text-xs">
          <span className="text-neutral-400">{"// bill_to"}</span>
          <p className="font-bold text-sm mt-1">{form.customer_name}</p>
          <p className="text-neutral-500 whitespace-pre-line">
            {form.customer_address}
          </p>
        </div>
        <Items headerBg={a} />
        <Totals />
        <Footer />
      </div>
    );
  }

  // ---- CREATIVE ----
  if (templateId === "creative") {
    return (
      <div className="text-neutral-900 relative overflow-hidden">
        <div
          className="absolute -top-16 -right-16 w-48 h-48 rounded-full opacity-20"
          style={{ background: a }}
        />
        <div className="relative flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Initial size={52} />
            <div>
              <p className="font-bold text-lg">{form.seller_name}</p>
              <SellerContact />
            </div>
          </div>
          <p
            className="text-4xl font-extrabold italic"
            style={{ color: a }}
          >
            Invoice
          </p>
        </div>
        <div
          className="relative mt-8 rounded-2xl p-5 text-sm"
          style={{ background: `${a}12` }}
        >
          <div className="flex justify-between">
            <div>
              <p className="text-xs uppercase tracking-wider text-neutral-500">
                Billed To
              </p>
              <p className="font-semibold mt-1">{form.customer_name}</p>
              <p className="text-xs text-neutral-500 whitespace-pre-line">
                {form.customer_address}
              </p>
            </div>
            <div className="text-right text-xs text-neutral-500">
              <p className="font-mono">{form.number}</p>
              <p>Issued {fmtDate(form.issue_date)}</p>
              <p>Due {fmtDate(form.due_date)}</p>
            </div>
          </div>
        </div>
        <Items />
        <Totals />
        <Footer />
      </div>
    );
  }

  // ---- RECEIPT ----
  if (templateId === "receipt") {
    return (
      <div className="text-neutral-900 max-w-sm mx-auto text-center">
        <Initial size={44} />
        <p className="font-bold text-lg mt-2">{form.seller_name}</p>
        <p className="text-[11px] text-neutral-500 whitespace-pre-line">
          {form.seller_address}
        </p>
        <SellerContact />
        <div className="border-t-2 border-dashed border-neutral-300 my-4" />
        <div className="flex justify-between text-xs">
          <span className="text-neutral-500">{form.doc_title || "Invoice"}</span>
          <span className="font-mono">{form.number}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-neutral-500">Date</span>
          <span>{fmtDate(form.issue_date)}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-neutral-500">Customer</span>
          <span className="font-semibold">{form.customer_name}</span>
        </div>
        <div className="border-t-2 border-dashed border-neutral-300 my-4" />
        <div className="text-left">
          <Items />
        </div>
        <div className="border-t-2 border-dashed border-neutral-300 my-4" />
        <Totals />
        <Footer />
      </div>
    );
  }

  // ---- MONOGRAM ----
  if (templateId === "monogram") {
    return (
      <div className="text-neutral-900">
        <div className="flex flex-col items-center">
          <Initial size={64} />
          <p className="font-bold text-xl mt-3">{form.seller_name}</p>
          <p className="text-xs text-neutral-500 whitespace-pre-line text-center">
            {form.seller_address}
          </p>
          <SellerContact />
        </div>
        <div
          className="mt-6 py-2 text-center text-sm font-semibold tracking-[0.25em]"
          style={{ borderTop: `1px solid ${a}`, borderBottom: `1px solid ${a}`, color: a }}
        >
          {form.doc_title || "INVOICE"} {form.number}
        </div>
        <Parties />
        <Meta />
        <Items />
        <Totals />
        <Footer />
      </div>
    );
  }

  // ---- GREEN GOLD (UAE Manufacturing) ----
  if (templateId === "green-gold") {
    return (
      <div className="text-neutral-900" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
        {/* Top gold band */}
        <div className="-mx-12 -mt-12 mb-0" style={{ background: "linear-gradient(135deg, #1B5E20 0%, #2E7D32 40%, #388E3C 100%)", height: 6 }} />
        
        {/* Header with logo */}
        <div className="flex justify-between items-start mt-8 pb-6" style={{ borderBottom: `3px solid #D4A017` }}>
          <div className="flex items-center gap-4">
            <Logo size={64} />
            <div>
              <p className="font-extrabold text-xl tracking-tight" style={{ color: "#1B5E20" }}>{form.seller_name}</p>
              <p className="text-xs text-neutral-500 whitespace-pre-line leading-relaxed">{form.seller_address}</p>
              {form.seller_trn && <p className="text-[11px] text-neutral-400 mt-0.5">TRN: {form.seller_trn}</p>}
            </div>
          </div>
          <div className="text-right">
            <p className="text-4xl font-black tracking-tighter" style={{ color: "#D4A017" }}>{form.doc_title || "INVOICE"}</p>
            <p className="text-sm font-mono text-neutral-600 mt-1">{form.number}</p>
            <div className="mt-3 pt-3" style={{ borderTop: "1px solid #E8D5A3" }}>
              <p className="text-[11px] text-neutral-500">{fmtDate(form.issue_date)}</p>
              <p className="text-[11px] text-neutral-400">Due: {fmtDate(form.due_date)}</p>
            </div>
          </div>
        </div>

        {/* Bill To + Company Info */}
        <div className="grid grid-cols-2 gap-8 mt-6">
          <div className="rounded-lg p-4" style={{ background: "#F1F8E9", border: "1px solid #C8E6C9" }}>
            <p className="text-[10px] uppercase tracking-[0.2em] font-semibold mb-2" style={{ color: "#1B5E20" }}>Bill To</p>
            <p className="font-bold text-sm">{form.customer_name}</p>
            <p className="text-xs text-neutral-600 whitespace-pre-line leading-relaxed mt-1">{form.customer_address}</p>
            {form.customer_trn && <p className="text-[10px] text-neutral-400 mt-1">TRN: {form.customer_trn}</p>}
          </div>
          <div className="rounded-lg p-4" style={{ background: "#FFF8E1", border: "1px solid #FFE082" }}>
            <div className="flex justify-between text-xs text-neutral-600">
              <span>Invoice Date</span><span className="font-medium">{fmtDate(form.issue_date)}</span>
            </div>
            <div className="flex justify-between text-xs text-neutral-600 mt-2">
              <span>Due Date</span><span className="font-medium">{fmtDate(form.due_date)}</span>
            </div>
            <div className="flex justify-between text-xs text-neutral-600 mt-2">
              <span>Reference</span><span className="font-mono font-medium">{form.number}</span>
            </div>
            {form.po_number && (
              <div className="flex justify-between text-xs text-neutral-600 mt-2">
                <span>PO Number</span><span className="font-medium">{form.po_number}</span>
              </div>
            )}
          </div>
        </div>

        <Items headerBg="#1B5E20" />
        <Totals />
        <Footer />
        
        {/* Bottom gold band */}
        <div className="-mx-12 mt-8" style={{ background: "linear-gradient(135deg, #1B5E20 0%, #2E7D32 40%, #388E3C 100%)", height: 3 }} />
        <p className="text-center text-[10px] text-neutral-400 mt-3">Thank you for your business</p>
      </div>
    );
  }

  // ---- UAE PROFESSIONAL ----
  if (templateId === "uae") {
    return (
      <div className="text-neutral-900" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
        {/* UAE flag-inspired accent bar */}
        <div className="-mx-12 -mt-12 mb-8 flex" style={{ height: 4 }}>
          <div style={{ flex: 1, background: "#00732E" }} />
          <div style={{ flex: 1, background: "#FFFFFF", borderLeft: "1px solid #ddd", borderRight: "1px solid #ddd" }} />
          <div style={{ flex: 1, background: "#000000" }} />
          <div style={{ width: 8, background: "#CE1126" }} />
        </div>

        <div className="flex justify-between items-start">
          <div>
            <Logo size={56} />
            <p className="font-bold text-lg mt-2">{form.seller_name}</p>
            <p className="text-[11px] text-neutral-500 whitespace-pre-line">{form.seller_address}</p>
            <SellerContact />
          </div>
          <div className="text-right">
            <div className="inline-block px-6 py-3 rounded-sm" style={{ background: "#1a1a1a" }}>
              <p className="text-white text-2xl font-bold tracking-widest">{form.doc_title || "INVOICE"}</p>
            </div>
            <p className="text-sm font-mono mt-3">{form.number}</p>
            <p className="text-xs text-neutral-500 mt-1">{fmtDate(form.issue_date)}</p>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-6">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-neutral-400 font-semibold">Bill To</p>
            <p className="font-bold mt-2">{form.customer_name}</p>
            <p className="text-xs text-neutral-600 whitespace-pre-line">{form.customer_address}</p>
            {form.customer_trn && <p className="text-[10px] text-neutral-400 mt-1">TRN: {form.customer_trn}</p>}
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1.5 px-3 rounded" style={{ background: "#f5f5f5" }}>
              <span className="text-neutral-500">Date</span>
              <span className="font-medium">{fmtDate(form.issue_date)}</span>
            </div>
            <div className="flex justify-between py-1.5 px-3 rounded" style={{ background: "#f5f5f5" }}>
              <span className="text-neutral-500">Due</span>
              <span className="font-medium">{fmtDate(form.due_date)}</span>
            </div>
            <div className="flex justify-between py-1.5 px-3 rounded" style={{ background: "#f5f5f5" }}>
              <span className="text-neutral-500">Reference</span>
              <span className="font-mono font-medium">{form.number}</span>
            </div>
          </div>
        </div>

        <Items headerBg="#1a1a1a" />
        <Totals />
        <Footer />
      </div>
    );
  }

  // ---- INDUSTRIAL ----
  if (templateId === "industrial") {
    return (
      <div className="text-neutral-900" style={{ fontFamily: "'IBM Plex Mono', 'Plus Jakarta Sans', monospace" }}>
        {/* Industrial top bar with rivet-style circles */}
        <div className="-mx-12 -mt-12 mb-8 flex items-center" style={{ background: "#2C3E50", height: 48 }}>
          <div className="flex gap-2 px-4">
            <div className="rounded-full" style={{ width: 10, height: 10, background: "#E74C3C" }} />
            <div className="rounded-full" style={{ width: 10, height: 10, background: "#F39C12" }} />
            <div className="rounded-full" style={{ width: 10, height: 10, background: "#2ECC71" }} />
          </div>
          <p className="text-white font-bold tracking-[0.3em] text-sm uppercase mx-auto">Industrial Invoice</p>
        </div>

        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2">
            <div className="flex items-start gap-3">
              <Logo size={48} />
              <div>
                <p className="font-extrabold text-lg tracking-tight" style={{ color: "#2C3E50" }}>{form.seller_name}</p>
                <p className="text-[10px] text-neutral-500 whitespace-pre-line uppercase tracking-wide">{form.seller_address}</p>
                {form.seller_trn && <p className="text-[9px] text-neutral-400 mt-0.5">TRN: {form.seller_trn}</p>}
              </div>
            </div>
            <div className="mt-6 p-4 rounded" style={{ background: "#ECF0F1", borderLeft: "4px solid #E74C3C" }}>
              <p className="text-[9px] uppercase tracking-[0.3em] font-bold text-neutral-500 mb-1">Bill To</p>
              <p className="font-bold">{form.customer_name}</p>
              <p className="text-xs text-neutral-600 whitespace-pre-line">{form.customer_address}</p>
              {form.customer_trn && <p className="text-[10px] text-neutral-400">TRN: {form.customer_trn}</p>}
            </div>
          </div>
          <div className="text-right">
            <div className="p-4 rounded" style={{ background: "#2C3E50", color: "#fff" }}>
              <p className="text-xs uppercase tracking-widest opacity-70">Document</p>
              <p className="text-2xl font-black tracking-tighter mt-1">{form.doc_title || "INVOICE"}</p>
              <div className="mt-3 pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.2)" }}>
                <p className="text-xs font-mono">{form.number}</p>
                <p className="text-[10px] opacity-70 mt-1">{fmtDate(form.issue_date)}</p>
                <p className="text-[10px] opacity-70">Due: {fmtDate(form.due_date)}</p>
              </div>
            </div>
          </div>
        </div>

        <Items headerBg="#2C3E50" bordered />
        <Totals />
        <Footer />
        
        <div className="mt-8 pt-4 text-center" style={{ borderTop: "2px solid #2C3E50" }}>
          <p className="text-[9px] text-neutral-400 uppercase tracking-[0.3em]">Industrial Grade Products</p>
        </div>
      </div>
    );
  }

  // ---- EXECUTIVE ----
  if (templateId === "executive") {
    return (
      <div className="text-neutral-900" style={{ fontFamily: "'Lora', 'Plus Jakarta Sans', Georgia, serif" }}>
        {/* Premium dark header */}
        <div className="-mx-12 -mt-12 mb-10 px-12 py-10" style={{ background: "linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 50%, #16213e 100%)", color: "#fff" }}>
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-4">
              <Logo size={72} />
              <div>
                <p className="text-xl font-bold tracking-tight" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{form.seller_name}</p>
                <p className="text-xs opacity-60 whitespace-pre-line mt-1 leading-relaxed">{form.seller_address}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm uppercase tracking-[0.5em] opacity-50" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{form.doc_title || "Invoice"}</p>
              <p className="text-4xl font-light mt-1 tracking-tight" style={{ color: "#C9A84C" }}>{form.number}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-10">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div style={{ width: 24, height: 1, background: "#C9A84C" }} />
              <p className="text-[10px] uppercase tracking-[0.3em] text-neutral-400 font-semibold">Bill To</p>
            </div>
            <p className="font-bold text-base" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{form.customer_name}</p>
            <p className="text-xs text-neutral-600 whitespace-pre-line mt-1 leading-relaxed">{form.customer_address}</p>
            {form.customer_trn && <p className="text-[10px] text-neutral-400 mt-1">TRN: {form.customer_trn}</p>}
          </div>
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div style={{ width: 24, height: 1, background: "#C9A84C" }} />
              <p className="text-[10px] uppercase tracking-[0.3em] text-neutral-400 font-semibold">Details</p>
            </div>
            <div className="space-y-3 text-sm" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              <div className="flex justify-between">
                <span className="text-neutral-400">Issued</span>
                <span className="font-medium">{fmtDate(form.issue_date)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-400">Due</span>
                <span className="font-medium">{fmtDate(form.due_date)}</span>
              </div>
              {form.po_number && (
                <div className="flex justify-between">
                  <span className="text-neutral-400">PO #</span>
                  <span className="font-mono font-medium text-xs">{form.po_number}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-8 pt-6" style={{ borderTop: "1px solid #e5e5e5" }}>
          <Items headerBg="#0a0a0a" />
        </div>
        <Totals />
        <Footer />
        
        <div className="mt-10 pt-6 text-center" style={{ borderTop: `2px solid #C9A84C` }}>
          <p className="text-[10px] text-neutral-400 tracking-widest uppercase" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            Payment Terms: {form.terms || "Net 30"}
          </p>
        </div>
      </div>
    );
  }

  // ---- FRESH ----
  if (templateId === "fresh") {
    return (
      <div className="text-neutral-900" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
        {/* Playful top accent */}
        <div className="-mx-12 -mt-12 mb-0" style={{ background: "linear-gradient(90deg, #667EEA 0%, #764BA2 50%, #F093FB 100%)", height: 5 }} />

        <div className="flex justify-between items-start mt-8">
          <div>
            <Logo size={52} />
            <p className="font-extrabold text-xl mt-3" style={{ color: "#4C51BF" }}>
              {form.seller_name}
              <span className="text-neutral-400 font-normal text-sm ml-2">{form.doc_title || "Invoice"}</span>
            </p>
            <SellerContact cls="text-neutral-400 text-[11px]" />
          </div>
          <div className="text-right">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full" style={{ background: "#EBF4FF" }}>
              <div className="w-2 h-2 rounded-full" style={{ background: "#667EEA" }} />
              <span className="text-xs font-bold tracking-wider" style={{ color: "#4C51BF" }}>#{form.number}</span>
            </div>
            <div className="mt-3 text-xs text-neutral-500">
              <p>Issued: {fmtDate(form.issue_date)}</p>
              <p>Due: {fmtDate(form.due_date)}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-5 gap-0 mt-8 rounded-2xl overflow-hidden" style={{ border: "1px solid #E8E8F0" }}>
          <div className="col-span-3 p-5" style={{ background: "#FAFBFF" }}>
            <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-neutral-400 mb-2">Bill To</p>
            <p className="font-bold text-base">{form.customer_name}</p>
            <p className="text-xs text-neutral-600 whitespace-pre-line mt-1">{form.customer_address}</p>
            {form.customer_trn && <p className="text-[10px] text-neutral-400 mt-1">TRN: {form.customer_trn}</p>}
          </div>
          <div className="col-span-2 p-5" style={{ background: "#4C51BF", color: "#fff" }}>
            <p className="text-[10px] uppercase tracking-wider opacity-60">Amount Due</p>
            <p className="text-3xl font-black mt-2 tracking-tight">{m(t.total)}</p>
            <div className="mt-3 pt-3 space-y-1 text-xs" style={{ borderTop: "1px solid rgba(255,255,255,0.2)" }}>
              <div className="flex justify-between"><span className="opacity-60">Subtotal</span><span>{m(t.subtotal)}</span></div>
              {(form.tax_rate || 0) > 0 && (
                <div className="flex justify-between"><span className="opacity-60">VAT ({form.tax_rate}%)</span><span>{m(t.tax)}</span></div>
              )}
            </div>
          </div>
        </div>

        <Items headerBg="#F7F8FC" />
        <Totals />
        <Footer />
        
        <div className="mt-8 text-center">
          <p className="text-[11px] text-neutral-400">
            Questions? Contact <span className="font-medium text-neutral-600">{form.seller_email || form.seller_name}</span>
          </p>
        </div>
      </div>
    );
  }

  // ---- MODERN ----
  return (
    <div className="text-neutral-900">
      <div className="flex justify-between items-end">
        <div>
          <p
            className="text-5xl font-extrabold tracking-tight"
            style={{ color: a }}
          >
            {form.doc_title || "Invoice"}
          </p>
          <p className="text-sm font-mono text-neutral-500 mt-2">
            {form.number}
          </p>
        </div>
        <div className="text-right">
          <Logo />
          <p className="font-bold mt-2">{form.seller_name}</p>
        </div>
      </div>

      <div
        className="h-1 w-full my-6"
        style={{ background: a }}
      />

      <div className="grid grid-cols-2 gap-8 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wider text-neutral-400">
            From
          </p>
          <p className="font-semibold mt-1">{form.seller_name}</p>
          <p className="text-xs text-neutral-500 whitespace-pre-line">
            {form.seller_address}
          </p>
          {form.seller_trn && (
            <p className="text-xs text-neutral-500">
              TRN: {form.seller_trn}
            </p>
          )}
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-neutral-400">
            Bill To
          </p>
          <p className="font-semibold mt-1">{form.customer_name}</p>
          <p className="text-xs text-neutral-500 whitespace-pre-line">
            {form.customer_address}
          </p>
          <p className="text-xs text-neutral-500 mt-2">
            Issued {fmtDate(form.issue_date)} · Due{" "}
            {fmtDate(form.due_date)}
          </p>
        </div>
      </div>

      <Items />
      <Totals />
      <Footer />
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between py-1 text-neutral-600">
      <span>{k}</span>
      <span>{v}</span>
    </div>
  );
}

/* ---------------- Company modal ---------------- */

function CompanyModal({
  open,
  company,
  onClose,
  onSaved,
}: {
  open: boolean;
  company: CompanyProfile;
  onClose: () => void;
  onSaved: (c: CompanyProfile) => void;
}) {
  const { toast } = useUI();
  const [c, setC] = useState<CompanyProfile>(company);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setC(company);
  }, [open, company]);

  const onLogo = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setC({ ...c, logo: String(reader.result) });
    reader.readAsDataURL(file);
  };

  return (
    <Modal open={open} onClose={onClose} title="Company Profile">
      <div className="space-y-3">
        <Field label="Company Name">
          <input
            className="input"
            value={c.name}
            onChange={(e) => setC({ ...c, name: e.target.value })}
          />
        </Field>
        <Field label="Address">
          <input
            className="input"
            value={c.address ?? ""}
            onChange={(e) => setC({ ...c, address: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="TRN">
            <input
              className="input"
              value={c.trn ?? ""}
              onChange={(e) => setC({ ...c, trn: e.target.value })}
            />
          </Field>
          <Field label="Phone">
            <input
              className="input"
              value={c.phone ?? ""}
              onChange={(e) => setC({ ...c, phone: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Email">
          <input
            className="input"
            value={c.email ?? ""}
            onChange={(e) => setC({ ...c, email: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Default Template">
            <select
              className="select"
              value={c.default_template}
              onChange={(e) =>
                setC({ ...c, default_template: e.target.value })
              }
            >
              {[...TEMPLATES, ...loadCustomTemplates().map((t) => ({ id: t.id, name: t.name }))].map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Default Accent">
            <input
              type="color"
              className="input h-[38px] p-1"
              value={c.default_accent}
              onChange={(e) =>
                setC({ ...c, default_accent: e.target.value })
              }
            />
          </Field>
        </div>
        <Field label="Logo">
          <div className="flex items-center gap-3">
            {c.logo && (
              <img
                src={c.logo}
                alt="logo"
                className="h-12 w-12 object-contain border border-brand-200 rounded-lg"
              />
            )}
            <button
              className="btn-ghost"
              onClick={() => fileRef.current?.click()}
            >
              <Upload size={14} /> {c.logo ? "Replace" : "Upload"}
            </button>
            {c.logo && (
              <button
                className="btn-ghost"
                onClick={() => setC({ ...c, logo: undefined })}
              >
                <X size={14} /> Remove
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => onLogo(e.target.files?.[0])}
            />
          </div>
        </Field>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn-primary"
          onClick={async () => {
            try {
              await billing.saveCompany(c);
              // Re-fetch so we apply exactly what the server persisted
              // (server defaults, RLS-trimmed columns, etc.) to the
              // invoice page and not just the locally-edited copy.
              let fresh: CompanyProfile;
              try {
                fresh = await billing.getCompany();
              } catch {
                fresh = c; // server unreachable — use what we saved
              }
              onSaved(fresh);
              toast.success("Company details saved.");
            } catch (e) {
              const msg =
                e instanceof Error
                  ? e.message
                  : e && typeof e === "object"
                  ? (e as any).message ??
                    (e as any).details ??
                    (e as any).hint ??
                    JSON.stringify(e)
                  : String(e);
              toast.error(`Could not save company details: ${msg}`);
            }
          }}
        >
          Save Company
        </button>
      </div>
    </Modal>
  );
}
