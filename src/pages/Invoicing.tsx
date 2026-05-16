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
} from "lucide-react";
import {
  billing,
  InvoiceDocSummary,
  InvoiceDocInput,
  CompanyProfile,
} from "../lib/api";
import { fmtDate } from "../lib/format";
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
    accent: c.default_accent || "#0A0A0A",
    currency: "AED",
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
    due_date: addDays(30),
    notes: "Thank you for your business.",
    terms: "Payment due within 30 days.",
    tax_rate: 5,
    discount: 0,
    items: [{ description: "", qty: 1, unit_price: 0 }],
  };
}

function totals(f: Form) {
  const subtotal = f.items.reduce(
    (s, i) => s + (i.qty || 0) * (i.unit_price || 0),
    0
  );
  const afterDiscount = Math.max(0, subtotal - (f.discount || 0));
  const tax = afterDiscount * ((f.tax_rate || 0) / 100);
  return { subtotal, tax, total: afterDiscount + tax };
}

export default function Invoicing() {
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [docs, setDocs] = useState<InvoiceDocSummary[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadDocs = () =>
    billing.listDocs().then(setDocs).catch(console.error);

  useEffect(() => {
    billing.getCompany().then(setCompany).catch(console.error);
    loadDocs();
  }, []);

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
      const id = await billing.saveDoc(form as InvoiceDocInput);
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
        title="Quoting"
        subtitle="Build, theme & download professional invoices as PDF"
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

  return (
    <div>
      <div className="no-print flex items-center justify-between mb-5 gap-3 flex-wrap">
        <button className="btn-ghost" onClick={onBack}>
          <ArrowLeft size={16} /> Back
        </button>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            className="input !w-auto"
            value={form.template}
            onChange={(e) => set("template", e.target.value)}
          >
            {TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} template
              </option>
            ))}
          </select>
          <select
            className="input !w-auto"
            value={form.status}
            onChange={(e) => set("status", e.target.value)}
          >
            {["draft", "issued", "paid", "cancelled"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm font-semibold text-brand-600 border border-brand-200 rounded-xl px-3 py-2 cursor-pointer">
            Accent
            <input
              type="color"
              value={form.accent}
              onChange={(e) => set("accent", e.target.value)}
              className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent p-0"
            />
          </label>
          <button
            className="btn-ghost"
            onClick={onSave}
            disabled={saving}
          >
            <Save size={16} /> {saving ? "Saving…" : "Save"}
          </button>
          <button className="btn-cta" onClick={() => window.print()}>
            <Download size={16} /> Download PDF
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-6">
        {/* form */}
        <div className="no-print space-y-4 overflow-y-auto pr-1">
          <Section title="Invoice">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Invoice #">
                <input
                  className="input"
                  value={form.number}
                  onChange={(e) => set("number", e.target.value)}
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
              <Field label="Issue Date">
                <input
                  type="date"
                  className="input"
                  value={form.issue_date ?? ""}
                  onChange={(e) => set("issue_date", e.target.value)}
                />
              </Field>
              <Field label="Due Date">
                <input
                  type="date"
                  className="input"
                  value={form.due_date ?? ""}
                  onChange={(e) => set("due_date", e.target.value)}
                />
              </Field>
            </div>
          </Section>

          <Section title="Logo">
            {form.logo ? (
              <div className="flex items-center gap-3">
                <img
                  src={form.logo}
                  alt="logo"
                  className="h-14 w-14 object-contain border border-brand-200 rounded-lg bg-white"
                />
                <button
                  className="btn-ghost"
                  onClick={() => set("logo", undefined)}
                >
                  <X size={14} /> Remove
                </button>
              </div>
            ) : (
              <label className="btn-ghost w-fit">
                <Upload size={14} /> Upload logo
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => onLogo(e.target.files?.[0])}
                />
              </label>
            )}
          </Section>

          <Section title="From (Seller)">
            <div className="space-y-3">
              <input
                className="input"
                placeholder="Company name"
                value={form.seller_name}
                onChange={(e) => set("seller_name", e.target.value)}
              />
              <input
                className="input"
                placeholder="Address"
                value={form.seller_address ?? ""}
                onChange={(e) => set("seller_address", e.target.value)}
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  className="input"
                  placeholder="TRN"
                  value={form.seller_trn ?? ""}
                  onChange={(e) => set("seller_trn", e.target.value)}
                />
                <input
                  className="input"
                  placeholder="Phone"
                  value={form.seller_phone ?? ""}
                  onChange={(e) => set("seller_phone", e.target.value)}
                />
              </div>
              <input
                className="input"
                placeholder="Email"
                value={form.seller_email ?? ""}
                onChange={(e) => set("seller_email", e.target.value)}
              />
            </div>
          </Section>

          <Section title="Bill To (Customer)">
            <div className="space-y-3">
              <input
                className="input"
                placeholder="Customer name"
                value={form.customer_name}
                onChange={(e) => set("customer_name", e.target.value)}
              />
              <input
                className="input"
                placeholder="Address"
                value={form.customer_address ?? ""}
                onChange={(e) => set("customer_address", e.target.value)}
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  className="input"
                  placeholder="TRN"
                  value={form.customer_trn ?? ""}
                  onChange={(e) => set("customer_trn", e.target.value)}
                />
                <input
                  className="input"
                  placeholder="Email"
                  value={form.customer_email ?? ""}
                  onChange={(e) => set("customer_email", e.target.value)}
                />
              </div>
            </div>
          </Section>

          <Section title="Line Items">
            <div className="space-y-2">
              {form.items.map((it, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <input
                    className="input flex-1"
                    placeholder="Description"
                    value={it.description}
                    onChange={(e) =>
                      setItem(i, { description: e.target.value })
                    }
                  />
                  <input
                    type="number"
                    className="input w-16"
                    title="Qty"
                    value={it.qty}
                    onChange={(e) =>
                      setItem(i, { qty: +e.target.value })
                    }
                  />
                  <input
                    type="number"
                    className="input w-24"
                    title="Unit price"
                    value={it.unit_price}
                    onChange={(e) =>
                      setItem(i, { unit_price: +e.target.value })
                    }
                  />
                  <button
                    aria-label="Remove line"
                    className="text-danger hover:bg-danger/10 rounded-lg p-2 cursor-pointer transition-colors duration-200"
                    onClick={() => removeItem(i)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              <button className="btn-ghost" onClick={addItem}>
                <Plus size={14} /> Add line
              </button>
            </div>
          </Section>

          <Section title="Totals & Notes">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tax rate (%)">
                <input
                  type="number"
                  className="input"
                  value={form.tax_rate}
                  onChange={(e) => set("tax_rate", +e.target.value)}
                />
              </Field>
              <Field label="Discount (amount)">
                <input
                  type="number"
                  className="input"
                  value={form.discount}
                  onChange={(e) => set("discount", +e.target.value)}
                />
              </Field>
            </div>
            <Field label="Notes">
              <textarea
                className="input"
                rows={2}
                value={form.notes ?? ""}
                onChange={(e) => set("notes", e.target.value)}
              />
            </Field>
            <Field label="Terms">
              <textarea
                className="input"
                rows={2}
                value={form.terms ?? ""}
                onChange={(e) => set("terms", e.target.value)}
              />
            </Field>
          </Section>
        </div>

        {/* live preview */}
        <div className="bg-brand-100 rounded-2xl p-6 overflow-auto">
          <div className="invoice-print mx-auto bg-white shadow-bento w-[760px] min-h-[1040px] p-12">
            <InvoiceView form={form} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bento-card">
      <p className="text-xs font-bold uppercase tracking-wider text-brand-400 mb-3">
        {title}
      </p>
      {children}
    </div>
  );
}

/* ---------------- Invoice templates ---------------- */

function InvoiceView({ form }: { form: Form }) {
  const t = totals(form);
  const ccy = form.currency || "AED";
  const m = (v: number) => money(v, ccy);
  const a = form.accent || "#0A0A0A";

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
      <Row k={`Tax (${form.tax_rate}%)`} v={m(t.tax)} />
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
            <Logo size={44} />
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
      <Logo size={size} />
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
            <Logo size={48} />
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
              TAX INVOICE
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
          <Logo size={52} />
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
            <Logo size={50} />
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
            <Logo size={40} />
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
              className="input"
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
