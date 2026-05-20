import { useEffect, useRef, useState } from "react";
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
  Eye,
  MoreHorizontal,
  Send,
  Monitor,
  Smartphone,
  Minus,
  Settings,
  StickyNote,
  Paperclip,
} from "lucide-react";
import {
  billing,
  crm,
  InvoiceDocSummary,
  InvoiceDocInput,
  CompanyProfile,
  CrmCustomer,
} from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { fmtDate } from "../lib/format";
import { invoiceTotals } from "../lib/money";
import { sendEmail, emailShell, hasDesktop } from "../lib/email";
import FitPreview from "../components/FitPreview";
import {
  PageHeader,
  DataTable,
  Badge,
  statusTone,
  Modal,
  Field,
} from "../components/ui";

type Item = { description: string; qty: number; unit_price: number };
type Form = Omit<InvoiceDocInput, "items"> & { items: Item[] };

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
];

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (n: number) =>
  new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

function money(v: number, ccy: string) {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: ccy,
      maximumFractionDigits: 2,
    }).format(v || 0);
  } catch {
    return `${ccy} ${(v || 0).toFixed(2)}`;
  }
}

function blankForm(c: CompanyProfile): Form {
  const y = new Date().getFullYear();
  return {
    number: `INV-${y}-${String(Math.floor(Math.random() * 9000) + 1000)}`,
    status: "draft",
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
    items: [{ description: "", qty: 1, unit_price: 0 }],
  };
}

const totals = (f: Form) =>
  invoiceTotals(f.items, f.discount || 0, f.tax_rate || 0);

export default function Invoicing() {
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [docs, setDocs] = useState<InvoiceDocSummary[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadDocs = () =>
    billing.listDocs().then(setDocs).catch(console.error);

  const reload = () => {
    billing.getCompany().then(setCompany).catch(console.error);
    loadDocs();
  };
  useEffect(reload, []);
  useLiveSync(reload);

  const newInvoice = () => {
    if (company) setForm(blankForm(company));
  };

  const editInvoice = async (id: number) => {
    const d = await billing.getDoc(id);
    setForm({
      id: d.id,
      number: d.number,
      status: d.status,
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
      })),
    });
  };

  const duplicateInvoice = async (id: number) => {
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
      })),
    });
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      // Empty date inputs must become undefined, not "" (invalid SQL date).
      const payload = {
        ...form,
        issue_date: form.issue_date || undefined,
        due_date: form.due_date || undefined,
      };
      const id = await billing.saveDoc(payload as InvoiceDocInput);
      setForm({ ...form, id });
      await loadDocs();
    } catch (e) {
      alert(`Could not save: ${e}`);
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
        saving={saving}
      />
    );
  }

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
            <button className="btn-cta" onClick={newInvoice}>
              <Plus size={16} /> New Invoice
            </button>
          </div>
        }
      />

      <DataTable<InvoiceDocSummary>
        rows={docs}
        empty="No invoices yet — create your first one"
        columns={[
          {
            key: "no",
            label: "Invoice #",
            render: (d) => (
              <span className="font-mono text-xs font-semibold">
                {d.number}
              </span>
            ),
          },
          {
            key: "cust",
            label: "Customer",
            render: (d) => (
              <span className="font-semibold">{d.customer_name}</span>
            ),
          },
          {
            key: "tpl",
            label: "Template",
            render: (d) => (
              <span className="capitalize text-brand-500">{d.template}</span>
            ),
          },
          {
            key: "total",
            label: "Total",
            render: (d) => (
              <span className="font-semibold">{money(d.total, "AED")}</span>
            ),
          },
          {
            key: "status",
            label: "Status",
            render: (d) => (
              <Badge tone={statusTone(d.status)}>{d.status}</Badge>
            ),
          },
          {
            key: "upd",
            label: "Updated",
            render: (d) => fmtDate(d.updated_at),
          },
          {
            key: "act",
            label: "",
            render: (d) => (
              <div className="flex items-center gap-1">
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
                    await billing.deleteDoc(d.id);
                    loadDocs();
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
    </div>
  );
}

/* ---------------- Editor ---------------- */

function Editor({
  form,
  setForm,
  onBack,
  onSave,
  saving,
}: {
  form: Form;
  setForm: (f: Form) => void;
  onBack: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  const set = <K extends keyof Form>(k: K, v: Form[K]) =>
    setForm({ ...form, [k]: v });

  const setItem = (idx: number, patch: Partial<Item>) => {
    const items = form.items.map((it, i) =>
      i === idx ? { ...it, ...patch } : it
    );
    setForm({ ...form, items });
  };
  const addItem = () =>
    setForm({
      ...form,
      items: [...form.items, { description: "", qty: 1, unit_price: 0 }],
    });
  const removeItem = (idx: number) =>
    setForm({ ...form, items: form.items.filter((_, i) => i !== idx) });

  const onLogo = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => set("logo", String(reader.result));
    reader.readAsDataURL(file);
  };

  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [custModal, setCustModal] = useState(false);
  const loadCustomers = () =>
    crm.customers().then(setCustomers).catch(() => {});
  useEffect(() => {
    loadCustomers();
  }, []);

  const applyCustomer = (c: CrmCustomer) =>
    setForm({
      ...form,
      customer_name: c.company || c.name,
      customer_address: c.address ?? "",
      customer_email: c.email ?? "",
      customer_trn: c.segment?.startsWith("TRN:")
        ? c.segment.slice(4).trim()
        : form.customer_trn,
    });

  const [viewAll, setViewAll] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [showDiscount, setShowDiscount] = useState((form.discount || 0) > 0);
  const m = (v: number) => money(v, form.currency || "AED");
  const shown = viewAll ? TEMPLATES : TEMPLATES.slice(0, 5);

  const saveAndSend = async () => {
    await onSave();
    if (!form.customer_email) {
      alert("Add a customer email (Invoice Details) to send this invoice.");
      return;
    }
    const t = invoiceTotals(form.items, form.discount || 0, form.tax_rate || 0);
    try {
      await sendEmail({
        to: form.customer_email,
        subject: `Invoice ${form.number} from ${form.seller_name}`,
        html: emailShell(
          `Invoice ${form.number}`,
          `<p>Dear ${form.customer_name || "customer"},</p>
           <p>Please find your invoice <b>${form.number}</b>.</p>
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
           <p>${form.notes ?? ""}</p>`
        ),
      });
      alert(`Invoice emailed to ${form.customer_email}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
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
            <h1 className="text-[26px] leading-8 font-bold text-ink">
              Create Invoice
            </h1>
            <p className="text-sm text-brand-500 mt-0.5">
              Create and send professional invoices to your customers
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {form.id ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-success">
              <CheckCircle2 size={15} /> Saved
            </span>
          ) : (
            <span className="text-sm font-semibold text-brand-400">
              Unsaved
            </span>
          )}
          <button
            className="btn-ghost"
            onClick={() => window.print()}
          >
            <Eye size={15} /> Preview
          </button>
          <button
            className="btn-ghost"
            onClick={onSave}
            disabled={saving}
            title="Save draft"
          >
            <MoreHorizontal size={15} /> More
          </button>
          {hasDesktop ? (
            <button
              className="btn-primary"
              onClick={saveAndSend}
              disabled={saving}
            >
              <Send size={15} /> {saving ? "Saving…" : "Save & Send"}
            </button>
          ) : (
            <button
              className="btn-primary"
              onClick={onSave}
              disabled={saving}
              title="Emailing is available in the Filey desktop app"
            >
              <Save size={15} /> {saving ? "Saving…" : "Save"}
            </button>
          )}
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
              <button
                className="btn-ghost text-xs"
                onClick={() => setViewAll((v) => !v)}
              >
                {viewAll ? "Show less" : "View all templates"}
              </button>
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
                return (
                  <button
                    key={tpl.id}
                    onClick={() => set("template", tpl.id)}
                    className={`relative shrink-0 w-32 rounded-xl border-2 p-2 text-left transition-all cursor-pointer ${
                      active
                        ? "border-primary-400 bg-primary-50 shadow-glow"
                        : "border-brand-200 bg-white hover:border-primary-300"
                    }`}
                  >
                    {active && (
                      <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-primary-400 text-ink grid place-items-center">
                        <Check size={11} strokeWidth={3} />
                      </span>
                    )}
                    <div className="h-24 rounded-md bg-brand-50 border border-brand-100 p-2 overflow-hidden">
                      <div className="h-1.5 w-10 rounded bg-brand-300" />
                      <div className="mt-1 h-1 w-16 rounded bg-brand-200" />
                      <div className="mt-3 space-y-1">
                        <div className="h-1 w-full rounded bg-brand-200" />
                        <div className="h-1 w-full rounded bg-brand-200" />
                        <div className="h-1 w-2/3 rounded bg-brand-200" />
                      </div>
                      <div className="mt-2 ml-auto h-1.5 w-10 rounded bg-primary-300" />
                    </div>
                    <p className="text-xs font-semibold text-ink mt-2 capitalize">
                      {tpl.name}
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
                <Field label="Currency">
                  <input
                    className="input"
                    value={form.currency}
                    onChange={(e) =>
                      set("currency", e.target.value.toUpperCase())
                    }
                  />
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
                    <th className="py-2 px-2 w-16 text-right">Qty</th>
                    <th className="py-2 px-2 w-28 text-right">Unit</th>
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
                          className="input text-right"
                          value={it.qty}
                          onChange={(e) =>
                            setItem(i, { qty: +e.target.value })
                          }
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="number"
                          className="input text-right"
                          placeholder="0"
                          value={it.unit_price || ""}
                          onChange={(e) =>
                            setItem(i, { unit_price: +e.target.value })
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
            <div className="flex flex-wrap gap-2 mt-3">
              <button className="btn-primary" onClick={addItem}>
                <Plus size={14} /> Add Item
              </button>
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
                    onChange={(e) => set("discount", +e.target.value)}
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
                      onChange={(e) => set("tax_rate", +e.target.value)}
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
                  <label className="flex items-center justify-between text-xs font-semibold text-brand-600 border border-brand-200 rounded-xl px-3 py-2 cursor-pointer">
                    Accent color
                    <input
                      type="color"
                      value={form.accent}
                      onChange={(e) => set("accent", e.target.value)}
                      className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent p-0"
                    />
                  </label>
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
            </div>
          </Step>
        </div>

        {/* ---------- right: live preview ---------- */}
        <div className="xl:sticky xl:top-2">
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
              <button
                className="btn-ghost text-xs"
                onClick={() => setViewAll(true)}
              >
                Change Template
              </button>
            </div>

            <FitPreview
              baseWidth={device === "desktop" ? 794 : 420}
              zoom={zoom}
            >
              <InvoiceView form={form} />
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
                  onClick={() => window.print()}
                >
                  <Download size={14} /> PDF
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
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
              console.error(e);
            } finally {
              setSaving(false);
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
  const a = form.accent || "#222222";

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
          <th className="text-right py-2 px-2 font-semibold w-16">Qty</th>
          <th className="text-right py-2 px-2 font-semibold w-28">
            Unit
          </th>
          <th className="text-right py-2 px-2 font-semibold w-32">
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

  // ---- MINIMAL ----
  if (form.template === "minimal") {
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
              INVOICE
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
  if (form.template === "classic") {
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
          <p className="text-2xl font-extrabold tracking-widest">INVOICE</p>
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
  if (form.template === "corporate") {
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
              {(form.tax_rate || 0) > 0 ? "TAX INVOICE" : "INVOICE"}
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
  if (form.template === "elegant") {
    return (
      <div className="text-neutral-800 font-serif">
        <div className="text-center">
          <Logo size={104} />
          <p className="text-3xl tracking-[0.3em] mt-4" style={{ color: a }}>
            INVOICE
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
  if (form.template === "bold") {
    return (
      <div className="text-neutral-900">
        <div
          className="-mx-12 -mt-12 px-12 pt-12 pb-10 mb-8"
          style={{ background: a, color: "#fff" }}
        >
          <div className="flex justify-between items-start">
            <Logo size={100} />
            <p className="text-5xl font-extrabold tracking-tight">INVOICE</p>
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
  if (form.template === "tech") {
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
  if (form.template === "creative") {
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
  if (form.template === "receipt") {
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
          <span className="text-neutral-500">Invoice</span>
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
  if (form.template === "monogram") {
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
          INVOICE {form.number}
        </div>
        <Parties />
        <Meta />
        <Items />
        <Totals />
        <Footer />
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
            Invoice
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
              {TEMPLATES.map((t) => (
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
            await billing.saveCompany(c);
            onSaved(c);
          }}
        >
          Save Company
        </button>
      </div>
    </Modal>
  );
}
