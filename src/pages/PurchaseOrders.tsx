import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Trash2,
  PackageCheck,
  ClipboardList,
  Wallet,
  Truck,
  Download,
  ArrowLeft,
  Save,
  Upload,
  Check,
  Maximize2,
  FileText,
  Printer,
  Building2,
  Stamp,
} from "lucide-react";
import {
  pos,
  suppliers as suppliersApi,
  type PoSummary,
  type PoInput,
  type Supplier,
} from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { useUI } from "../lib/ui";
import { downloadCsv } from "../lib/csv";
import { aed, fmtDate, num, numInput, errMsg } from "../lib/format";
import {
  PageHeader,
  MetricCard,
  DataTable,
  Badge,
  statusTone,
  Modal,
  Field,
  ErrorBanner,
} from "../components/ui";
import TemplateDesigner, {
  loadCustomTemplates,
  deleteCustomTemplate,
  type CustomTemplate,
} from "../components/TemplateDesigner";
import { downloadElementAsPdf } from "../lib/pdfTools";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const LPO_TEMPLATES = [
  { id: "uae-standard", name: "UAE Standard" },
  { id: "uae-minimal", name: "UAE Minimal" },
  { id: "corporate", name: "Corporate" },
  { id: "modern", name: "Modern" },
  { id: "classic", name: "Classic" },
  { id: "simple", name: "Simple" },
];

const today = () => new Date().toISOString().slice(0, 10);

type LpoItem = { description: string; qty: number; unit_price: number };

type LpoForm = {
  id?: number;
  number: string;
  status: string;
  template: string;
  accent: string;
  supplier_name: string;
  supplier_address: string;
  supplier_trn: string;
  supplier_email: string;
  supplier_phone: string;
  company_name: string;
  company_address: string;
  company_trn: string;
  company_email: string;
  company_phone: string;
  company_logo: string;
  company_stamp: string;
  company_signature: string;
  order_date: string;
  expected_date: string;
  notes: string;
  terms: string;
  items: LpoItem[];
};

function blankLpo(company?: { name: string; address?: string; trn?: string; email?: string; phone?: string; logo?: string }): LpoForm {
  const y = new Date().getFullYear();
  return {
    number: `LPO-${y}-${String(Math.floor(Math.random() * 9000) + 1000)}`,
    status: "draft",
    template: "uae-standard",
    accent: "#222222",
    supplier_name: "",
    supplier_address: "",
    supplier_trn: "",
    supplier_email: "",
    supplier_phone: "",
    company_name: company?.name || "Your Company",
    company_address: company?.address || "",
    company_trn: company?.trn || "",
    company_email: company?.email || "",
    company_phone: company?.phone || "",
    company_logo: company?.logo || "",
    company_stamp: loadSavedStamp(),
    company_signature: loadSavedSignature(),
    order_date: today(),
    expected_date: "",
    notes: "Thank you for your business.",
    terms: "1. Payment due within 30 days of invoice.\n2. Goods remain property of seller until paid in full.\n3. All prices are in AED unless otherwise stated.\n4. Delivery within 7-14 working days.",
    items: [{ description: "", qty: 1, unit_price: 0 }],
  };
}

const STAMP_KEY = "filey_lpo_stamp";
const SIGNATURE_KEY = "filey_lpo_signature";

function loadSavedStamp(): string {
  try { return localStorage.getItem(STAMP_KEY) || ""; } catch { return ""; }
}
function saveStamp(data: string) {
  try { localStorage.setItem(STAMP_KEY, data); } catch {}
}
function loadSavedSignature(): string {
  try { return localStorage.getItem(SIGNATURE_KEY) || ""; } catch { return ""; }
}
function saveSignature(data: string) {
  try { localStorage.setItem(SIGNATURE_KEY, data); } catch {}
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function PurchaseOrders() {
  const { toast, confirm } = useUI();
  const [rows, setRows] = useState<PoSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lpoForm, setLpoForm] = useState<LpoForm | null>(null);

  const load = () => {
    return pos
      .list()
      .then(setRows)
      .catch((e) =>
        setError(
          `Could not load purchase orders: ${
            e instanceof Error ? e.message : e
          }`
        )
      )
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, []);
  useLiveSync(load);

  const stats = useMemo(() => {
    const open = rows.filter((r) => r.status !== "received").length;
    const received = rows.filter((r) => r.status === "received").length;
    const value = rows.reduce((s, r) => s + r.total, 0);
    return { total: rows.length, open, received, value };
  }, [rows]);

  const receive = async (r: PoSummary) => {
    const ok = await confirm({
      title: "Receive stock",
      message: `Receive all items on ${r.po_number} into inventory? This increases product stock.`,
      confirmLabel: "Receive",
    });
    if (!ok) return;
    try {
      await pos.receive(r.id);
      load();
      toast.success("Stock received.");
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const del = async (r: PoSummary) => {
    const ok = await confirm({
      title: "Delete purchase order",
      message: `Delete ${r.po_number}?`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await pos.remove(r.id);
      load();
    } catch (e: any) {
      toast.error(e?.message || "Failed to delete purchase order");
    }
  };

  /* Show LPO Editor if form is active */
  if (lpoForm) {
    return (
      <LPOEditor
        form={lpoForm}
        setForm={setLpoForm}
        onBack={() => {
          setLpoForm(null);
          load();
        }}
        onSave={async () => {
          await saveLpo(lpoForm, setLpoForm, toast);
          load();
        }}
      />
    );
  }

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Purchase Orders"
        subtitle="Create local purchase orders with custom templates — print or email to suppliers"
        action={
          <div className="flex gap-2">
            <button
              className="btn-ghost"
              onClick={() =>
                downloadCsv(
                  "purchase-orders",
                  rows as unknown as Record<string, unknown>[],
                  [
                    { key: "po_number", label: "PO #" },
                    { key: "supplier_name", label: "Supplier" },
                    { key: "status", label: "Status" },
                    { key: "total", label: "Total" },
                    { key: "order_date", label: "Order date" },
                    { key: "expected_date", label: "Expected" },
                  ]
                )
              }
            >
              <Download size={15} /> Export
            </button>
            <button
              className="btn-primary"
              onClick={() => setLpoForm(blankLpo())}
            >
              <Plus size={16} /> New LPO
            </button>
          </div>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <MetricCard
          label="Purchase Orders"
          value={num(stats.total)}
          icon={<ClipboardList size={20} />}
        />
        <MetricCard
          label="Open"
          value={num(stats.open)}
          icon={<Truck size={20} />}
          iconClass="bg-secondary-400/20 text-secondary-600"
        />
        <MetricCard
          label="Received"
          value={num(stats.received)}
          icon={<PackageCheck size={20} />}
          iconClass="bg-success/15 text-success"
        />
        <MetricCard
          label="Total Value"
          value={aed(stats.value)}
          icon={<Wallet size={20} />}
          iconClass="bg-info/15 text-info"
        />
      </div>

      <DataTable<PoSummary>
        rows={rows}
        loading={loading}
        empty="No purchase orders yet — create your first LPO"
        columns={[
          {
            key: "no",
            label: "LPO #",
            sortValue: (r) => r.po_number,
            render: (r) => (
              <span className="font-mono text-xs font-semibold">
                {r.po_number}
              </span>
            ),
          },
          {
            key: "sup",
            label: "Supplier",
            sortValue: (r) => r.supplier_name,
            render: (r) => (
              <span className="font-semibold text-ink">
                {r.supplier_name}
              </span>
            ),
          },
          {
            key: "total",
            label: "Total",
            sortValue: (r) => r.total,
            render: (r) => aed(r.total),
          },
          {
            key: "status",
            label: "Status",
            sortValue: (r) => r.status,
            render: (r) => (
              <Badge tone={statusTone(r.status)}>{r.status}</Badge>
            ),
          },
          {
            key: "exp",
            label: "Expected",
            sortValue: (r) => r.expected_date ?? "",
            render: (r) => (r.expected_date ? fmtDate(r.expected_date) : "—"),
          },
          {
            key: "act",
            label: "",
            render: (r) => (
              <div className="flex items-center gap-1">
                {r.status !== "received" && (
                  <button
                    aria-label="Receive stock"
                    title="Receive into inventory"
                    className="text-success hover:bg-success/10 rounded-lg p-1.5 cursor-pointer"
                    onClick={() => receive(r)}
                  >
                    <PackageCheck size={15} />
                  </button>
                )}
                <button
                  aria-label="View / Print LPO"
                  title="View LPO"
                  className="text-brand-600 hover:bg-brand-100 dark:hover:bg-white/10 rounded-lg p-1.5 cursor-pointer"
                  onClick={async () => {
                    try {
                      const po = await pos.get(r.id);
                      if (!po) return;
                      setLpoForm({
                        id: po.id,
                        number: po.po_number || "",
                        status: po.status || "draft",
                        template: "uae-standard",
                        accent: "#222222",
                        supplier_name: (po as any).supplier_name || "",
                        supplier_address: "",
                        supplier_trn: "",
                        supplier_email: "",
                        supplier_phone: "",
                        company_name: "Your Company",
                        company_address: "",
                        company_trn: "",
                        company_email: "",
                        company_phone: "",
                        company_logo: "",
                        company_stamp: loadSavedStamp(),
                        company_signature: loadSavedSignature(),
                        order_date: po.order_date || today(),
                        expected_date: po.expected_date || "",
                        notes: po.notes || "",
                        terms: "",
                        items: po.items.map((i: any) => ({
                          description: i.description || "",
                          qty: i.quantity || 1,
                          unit_price: i.unit_cost || 0,
                        })),
                      });
                    } catch (e: any) {
                      toast.error(e?.message || "Failed to load PO");
                    }
                  }}
                >
                  <Printer size={15} />
                </button>
                <button
                  aria-label="Delete"
                  className="text-danger hover:bg-danger/10 rounded-lg p-1.5 cursor-pointer"
                  onClick={() => del(r)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Save helper                                                        */
/* ------------------------------------------------------------------ */

async function saveLpo(
  form: LpoForm,
  setForm: (f: LpoForm) => void,
  toast: ReturnType<typeof useUI>["toast"]
) {
  const total = form.items.reduce((s, i) => s + i.qty * i.unit_price, 0);
  try {
    const input: PoInput = {
      id: form.id,
      po_number: form.number,
      supplier_id: undefined,
      status: (form.status as "draft" | "sent" | "received") || "draft",
      total,
      order_date: form.order_date,
      expected_date: form.expected_date || undefined,
      notes: form.notes || undefined,
      items: form.items
        .filter((i) => i.description.trim())
        .map((i) => ({
          description: i.description,
          quantity: i.qty,
          unit_cost: i.unit_price,
        })),
    };
    const id = await pos.save(input);
    setForm({ ...form, id, status: "draft" });
    toast.success("Purchase order saved.");
  } catch (e) {
    toast.error(errMsg(e));
  }
}

/* ------------------------------------------------------------------ */
/*  LPO Editor                                                         */
/* ------------------------------------------------------------------ */

function LPOEditor({
  form,
  setForm,
  onBack,
  onSave,
}: {
  form: LpoForm;
  setForm: (f: LpoForm) => void;
  onBack: () => void;
  onSave: () => void;
}) {
  const { toast, confirm } = useUI();
  const lpoRef = useRef<HTMLDivElement>(null);
  const downloadPdf = () => {
    if (lpoRef.current) {
      const sheet = lpoRef.current.closest('.invoice-print') as HTMLElement;
      downloadElementAsPdf(sheet || lpoRef.current, form.number || "lpo");
    } else window.print();
  };
  const set = <K extends keyof LpoForm>(k: K, v: LpoForm[K]) =>
    setForm({ ...form, [k]: v });

  const [designing, setDesigning] = useState(false);
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>(
    loadCustomTemplates
  );
  const allTemplates = [
    ...LPO_TEMPLATES,
    ...customTemplates.map((t) => ({ id: t.id, name: t.name })),
  ];
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
    if (form.template === id) set("template", "uae-standard");
    toast.success("Template deleted.");
  };

  const setItem = (idx: number, patch: Partial<LpoItem>) => {
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

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierModal, setSupplierModal] = useState(false);
  useEffect(() => {
    suppliersApi
      .list()
      .then(setSuppliers)
      .catch(() => toast.error("Failed to load suppliers"));
  }, []);

  const applySupplier = (s: Supplier) =>
    setForm({
      ...form,
      supplier_name: s.name,
      supplier_address: s.address ?? "",
      supplier_email: s.email ?? "",
      supplier_phone: s.phone ?? "",
      supplier_trn: (s as any).trn ?? form.supplier_trn,
    });

  const [viewAll, setViewAll] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const viewPreviewRef = useRef<HTMLDivElement>(null);
  const [pageCount, setPageCount] = useState(1);

  useEffect(() => {
    if (!viewOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewOpen]);

  useEffect(() => {
    if (!viewOpen || !viewPreviewRef.current) {
      setPageCount(1);
      return;
    }
    const el = viewPreviewRef.current;
    const measure = () => {
      const contentHeight = el.scrollHeight;
      const pageHeight = 1027;
      setPageCount(Math.max(1, Math.ceil(contentHeight / pageHeight)));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [viewOpen, form.items.length, form.template]);

  const [showLetter, setShowLetter] = useState(false);
  const shown = viewAll ? allTemplates : allTemplates.slice(0, 5);
  const total = form.items.reduce((s, i) => s + i.qty * i.unit_price, 0);

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
              Local Purchase Order
            </h1>
            <p className="text-sm text-brand-500 mt-0.5">
              Create professional LPOs for UAE suppliers with custom templates
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone={statusTone(form.status)}>{form.status}</Badge>
          {!form.id && (
            <span className="text-xs font-semibold text-brand-400">
              Unsaved
            </span>
          )}
          <button
            className="btn-ghost"
            onClick={() => setShowLetter(!showLetter)}
          >
            <FileText size={15} /> {showLetter ? "Hide Letter" : "Letter"}
          </button>
          <button className="btn-ghost" onClick={() => setViewOpen(true)}>
            <Maximize2 size={15} /> View
          </button>
          <button className="btn-ghost" onClick={downloadPdf}>
            <Download size={15} /> PDF
          </button>
          <button className="btn-ghost" onClick={onSave}>
            <Save size={15} /> Save
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_minmax(340px,440px)] gap-5 items-start">
        {/* ---------- left: builder ---------- */}
        <div className="no-print space-y-4">
          {/* 1 · Choose template */}
          <Step
            n={1}
            title="Choose Template"
            subtitle="Select a template for your purchase order"
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
                const ct = isCustom
                  ? customTemplates.find((c) => c.id === tpl.id)
                  : null;
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
                    <LpoTilePreview templateId={tpl.id} />
                    <p className="text-xs font-semibold text-ink mt-2 capitalize flex items-center gap-1">
                      {tpl.name}
                      {isFile ? (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 font-medium flex items-center gap-0.5">
                          <Upload size={8} /> Uploaded
                        </span>
                      ) : isCustom ? (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-primary-100 text-primary-700 font-medium">
                          Custom
                        </span>
                      ) : null}
                    </p>
                  </button>
                );
              })}
            </div>
          </Step>

          {/* 2 · LPO Details */}
          <Step n={2} title="LPO Details">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <Field label="Supplier">
                  <div className="flex gap-2">
                    <select
                      className="select"
                      value=""
                      onChange={(e) => {
                        const s = suppliers.find(
                          (x) => String(x.id) === e.target.value
                        );
                        if (s) applySupplier(s);
                      }}
                    >
                      <option value="">
                        {suppliers.length
                          ? "Select saved supplier…"
                          : "No saved suppliers yet"}
                      </option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn-ghost shrink-0"
                      onClick={() => setSupplierModal(true)}
                      title="Add supplier"
                    >
                      <Plus size={15} />
                    </button>
                  </div>
                </Field>
                <Field label="Supplier Name">
                  <input
                    className="input"
                    placeholder="Dune Lubricants LLC"
                    value={form.supplier_name}
                    onChange={(e) => set("supplier_name", e.target.value)}
                  />
                </Field>
                <Field label="Supplier Address">
                  <textarea
                    className="textarea"
                    rows={3}
                    placeholder="Dubai, UAE"
                    value={form.supplier_address}
                    onChange={(e) => set("supplier_address", e.target.value)}
                  />
                </Field>
                <Field label="Supplier TRN">
                  <input
                    className="input"
                    placeholder="TRN"
                    value={form.supplier_trn}
                    onChange={(e) => set("supplier_trn", e.target.value)}
                  />
                </Field>
              </div>
              <div className="space-y-3">
                <Field label="LPO Number">
                  <input
                    className="input"
                    value={form.number}
                    onChange={(e) => set("number", e.target.value)}
                  />
                </Field>
                <Field label="Order Date">
                  <input
                    type="date"
                    className="input"
                    value={form.order_date}
                    onChange={(e) => set("order_date", e.target.value)}
                  />
                </Field>
                <Field label="Expected Delivery">
                  <input
                    type="date"
                    className="input"
                    value={form.expected_date}
                    onChange={(e) => set("expected_date", e.target.value)}
                  />
                </Field>
                <Field label="Your Company">
                  <input
                    className="input"
                    placeholder="Your Company Name"
                    value={form.company_name}
                    onChange={(e) => set("company_name", e.target.value)}
                  />
                </Field>
                <Field label="Company TRN">
                  <input
                    className="input"
                    placeholder="TRN"
                    value={form.company_trn}
                    onChange={(e) => set("company_trn", e.target.value)}
                  />
                </Field>
                <Field label="Company Stamp">
                  <StampUpload
                    value={form.company_stamp}
                    onChange={(data) => { set("company_stamp", data); saveStamp(data); }}
                    label="Upload Stamp"
                  />
                </Field>
                <Field label="Authorized Signature">
                  <SignatureUpload
                    value={form.company_signature}
                    onChange={(data) => { set("company_signature", data); saveSignature(data); }}
                    label="Upload Signature"
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
                    <th className="py-2 px-2 w-24 text-right">Qty</th>
                    <th className="py-2 px-2 w-32 text-right">Unit Price</th>
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
                          className="input tabular-nums text-right"
                          value={it.qty || ""}
                          onChange={(e) =>
                            setItem(i, { qty: numInput(e.target.value) })
                          }
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="number"
                          className="input tabular-nums text-right"
                          value={it.unit_price || ""}
                          onChange={(e) =>
                            setItem(i, {
                              unit_price: numInput(e.target.value),
                            })
                          }
                        />
                      </td>
                      <td className="py-2 px-2 text-right font-semibold tabular-nums">
                        {aed(it.qty * it.unit_price)}
                      </td>
                      <td className="py-2 px-2">
                        {form.items.length > 1 && (
                          <button
                            aria-label="Remove line"
                            className="text-danger hover:bg-danger/10 rounded-lg p-1 cursor-pointer"
                            onClick={() => removeItem(i)}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between mt-3">
              <button className="btn-ghost text-xs" onClick={addItem}>
                <Plus size={14} /> Add item
              </button>
              <div className="text-right">
                <span className="text-xs text-brand-400 mr-2">Total</span>
                <span className="font-display text-lg font-bold text-ink tabular-nums">
                  {aed(total)}
                </span>
              </div>
            </div>
          </Step>

          {/* 4 · Notes & Terms */}
          <Step n={4} title="Notes & Terms">
            <div className="space-y-3">
              <Field label="Notes">
                <textarea
                  className="textarea"
                  rows={2}
                  value={form.notes}
                  onChange={(e) => set("notes", e.target.value)}
                />
              </Field>
              <Field label="Terms & Conditions">
                <textarea
                  className="textarea"
                  rows={4}
                  value={form.terms}
                  onChange={(e) => set("terms", e.target.value)}
                />
              </Field>
            </div>
          </Step>
        </div>

        {/* ---------- right: live preview ---------- */}
        <div className="sticky top-4">
          {/* Template designer ABOVE preview */}
          {designing && (
            <div className="mb-4">
              <TemplateDesigner
                onSave={(t: CustomTemplate) => {
                  setDesigning(false);
                  setCustomTemplates(loadCustomTemplates());
                  set("template", t.id);
                }}
                onClose={() => {
                  setDesigning(false);
                  setCustomTemplates(loadCustomTemplates());
                }}
              />
            </div>
          )}

          <LPOView form={form} lpoRef={lpoRef} />
        </div>
      </div>

      {/* Supplier Modal */}
      {supplierModal && (
        <SupplierQuickAdd
          open={supplierModal}
          onClose={() => setSupplierModal(false)}
          onSaved={(s) => {
            applySupplier(s);
            setSupplierModal(false);
            suppliersApi.list().then(setSuppliers).catch(() => {});
          }}
        />
      )}

      {/* Letter generator */}
      {showLetter && (
        <LpoLetter
          form={form}
          onClose={() => setShowLetter(false)}
        />
      )}

      {/* Full-screen view modal */}
      {viewOpen && (
        <Modal
          open
          onClose={() => setViewOpen(false)}
          title="LPO Preview"
          size="full"
        >
          <div
            ref={viewPreviewRef}
            className="bg-white rounded-xl overflow-y-auto"
            style={{
              maxHeight: "85vh",
              background: `repeating-linear-gradient(
                white 0px,
                white ${(pageCount - 1) * 1027 + 30}px,
                #e5e7eb ${(pageCount - 1) * 1027 + 30}px,
                #e5e7eb ${(pageCount - 1) * 1027 + 32}px
              )`,
            }}
          >
            <LPOView form={form} />
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  LPO View — renders the LPO with chosen template                   */
/* ------------------------------------------------------------------ */

function LPOView({
  form,
  lpoRef,
}: {
  form: LpoForm;
  lpoRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const customTemplates = loadCustomTemplates();
  const ct = customTemplates.find((c) => c.id === form.template);
  const isFileTemplate = ct?.type === "file";

  const total = form.items.reduce((s, i) => s + i.qty * i.unit_price, 0);
  const clean = (s: string) => s || "—";

  if (isFileTemplate && ct) {
    return (
      <div ref={lpoRef} className="relative bg-white shadow-card rounded-2xl overflow-hidden print:shadow-none print:rounded-none">
        {/* Background image */}
        {ct && (ct as any).imageData && (
          <img
            src={(ct as any).imageData}
            alt="Template background"
            className="absolute inset-0 w-full h-full object-cover opacity-[0.92]"
          />
        )}
        <div
          className="relative p-8 min-h-[1123px] flex flex-col gap-6"
          style={{ width: ct.paperSize === "Letter" ? "816px" : "794px" }}
        >
          {/* If positions defined, render frosted glass boxes */}
          {ct.positions && Object.keys(ct.positions).length > 0 ? (
            <FrostedOverlayLpo form={form} template={ct} />
          ) : (
            /* Default overlay positions */
            <div className="flex flex-col gap-5 mt-24">
              <div className="bg-white/88 backdrop-blur-sm rounded-xl p-6 shadow-sm">
                <h1 className="text-2xl font-bold text-ink">LOCAL PURCHASE ORDER</h1>
                <div className="grid grid-cols-2 gap-4 mt-3 text-sm">
                  <div>
                    <p className="font-semibold">{clean(form.company_name)}</p>
                    <p className="text-brand-500">{clean(form.company_address)}</p>
                    <p className="text-brand-500">TRN: {clean(form.company_trn)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono font-bold text-lg">{form.number}</p>
                    <p className="text-brand-500">Date: {form.order_date}</p>
                    {form.expected_date && (
                      <p className="text-brand-500">Expected: {form.expected_date}</p>
                    )}
                  </div>
                </div>
              </div>
              <div className="bg-white/88 backdrop-blur-sm rounded-xl p-6 shadow-sm">
                <p className="font-semibold text-sm text-brand-400 mb-1">SUPPLIER</p>
                <p className="font-semibold">{clean(form.supplier_name)}</p>
                <p className="text-brand-500 text-sm">{clean(form.supplier_address)}</p>
                {form.supplier_trn && (
                  <p className="text-brand-500 text-sm">TRN: {form.supplier_trn}</p>
                )}
              </div>
              <div className="bg-white/88 backdrop-blur-sm rounded-xl p-6 shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-brand-200 text-left text-xs font-semibold text-brand-400">
                      <th className="pb-2 pr-2 w-6">#</th>
                      <th className="pb-2 px-2">Description</th>
                      <th className="pb-2 px-2 w-20 text-right">Qty</th>
                      <th className="pb-2 px-2 w-28 text-right">Unit Price</th>
                      <th className="pb-2 px-2 w-28 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.items
                      .filter((i) => i.description.trim())
                      .map((it, i) => (
                        <tr key={i} className="border-b border-brand-100/50">
                          <td className="py-2 pr-2 text-brand-400">{i + 1}</td>
                          <td className="py-2 px-2">{it.description}</td>
                          <td className="py-2 px-2 text-right tabular-nums">
                            {it.qty}
                          </td>
                          <td className="py-2 px-2 text-right tabular-nums">
                            {aed(it.unit_price)}
                          </td>
                          <td className="py-2 px-2 text-right font-semibold tabular-nums">
                            {aed(it.qty * it.unit_price)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                <div className="flex justify-end mt-3">
                  <div className="text-right">
                    <p className="text-2xl font-bold text-ink tabular-nums">
                      {aed(total)}
                    </p>
                    <p className="text-xs text-brand-400">Total Amount (AED)</p>
                  </div>
                </div>
              </div>
              {form.terms && (
                <div className="bg-white/88 backdrop-blur-sm rounded-xl p-6 shadow-sm">
                  <p className="font-semibold text-sm text-brand-400 mb-2">TERMS & CONDITIONS</p>
                  <p className="text-sm text-brand-600 whitespace-pre-line">
                    {form.terms}
                  </p>
                </div>
              )}
              {form.notes && (
                <div className="bg-white/88 backdrop-blur-sm rounded-xl p-6 shadow-sm">
                  <p className="text-sm text-brand-500">{form.notes}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-6 mt-8">
                <div className="bg-white/88 backdrop-blur-sm rounded-xl p-6 shadow-sm text-center">
                  <p className="text-sm font-semibold text-ink mb-4">For Supplier</p>
                  <div className="border-t border-brand-200 pt-3">
                    <p className="text-xs text-brand-400">Authorized Signature</p>
                  </div>
                </div>
                <div className="bg-white/88 backdrop-blur-sm rounded-xl p-6 shadow-sm text-center">
                  <p className="text-sm font-semibold text-ink mb-4">Company Stamp & Signature</p>
                  {form.company_stamp ? (
                    <img src={form.company_stamp} alt="Company stamp" className="h-20 mx-auto object-contain mb-2" />
                  ) : (
                    <Stamp size={24} className="inline-block mb-2" />
                  )}
                  {form.company_signature && (
                    <img src={form.company_signature} alt="Signature" className="h-12 mx-auto object-contain mb-2 opacity-80" />
                  )}
                  <div className="border-t border-brand-200 pt-3">
                    <p className="text-xs text-brand-400">Company Stamp & Signature</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  /* Pre-defined templates */
  const tplId = form.template;
  const styles = getTemplateStyle(tplId, form.accent);

  return (
    <div
      ref={lpoRef}
      className="bg-white shadow-card rounded-2xl overflow-hidden print:shadow-none print:rounded-none"
      style={styles.wrapper}
    >
      <div className="p-8 min-h-[1123px]" style={styles.container}>
        {/* Header */}
        <div
          className="flex items-start justify-between pb-6 mb-6"
          style={{ borderBottom: styles.headerBorder || "2px solid #EAE4D6" }}
        >
          <div>
            {form.company_logo && (
              <img
                src={form.company_logo}
                alt="Logo"
                className="h-12 mb-3 object-contain"
              />
            )}
            <h1 style={styles.title} className="text-[28px] font-extrabold tracking-tight">
              LOCAL PURCHASE ORDER
            </h1>
            <p className="text-sm text-brand-400 mt-1">
              LPO #{form.number}
            </p>
          </div>
          <div className="text-right text-sm">
            <p className="font-bold text-[15px]" style={{ color: styles.accentColor }}>
              {clean(form.company_name)}
            </p>
            <p className="text-brand-500 mt-0.5">{clean(form.company_address)}</p>
            {form.company_trn && (
              <p className="text-brand-500">TRN: {form.company_trn}</p>
            )}
            <p className="text-brand-500 mt-1">Date: {form.order_date}</p>
            {form.expected_date && (
              <p className="text-brand-500">
                Expected: {form.expected_date}
              </p>
            )}
          </div>
        </div>

        {/* Supplier */}
        <div className="mb-6 p-5 rounded-xl" style={{ backgroundColor: styles.supplierBg || "#F7F2E6" }}>
          <p className="text-xs font-semibold text-brand-400 uppercase tracking-wider mb-2">
            Supplier / Vendor
          </p>
          <p className="font-bold text-[17px] text-ink">
            {clean(form.supplier_name)}
          </p>
          <p className="text-sm text-brand-500 mt-0.5">
            {clean(form.supplier_address)}
          </p>
          {form.supplier_trn && (
            <p className="text-sm text-brand-500">TRN: {form.supplier_trn}</p>
          )}
        </div>

        {/* Items table */}
        <div className="mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr
                className="text-left text-xs font-semibold uppercase tracking-wider"
                style={{ color: styles.accentColor || "#6B6B6B" }}
              >
                <th className="pb-3 pr-2 w-6">#</th>
                <th className="pb-3 px-2">Description</th>
                <th className="pb-3 px-2 w-20 text-right">Qty</th>
                <th className="pb-3 px-2 w-28 text-right">Unit Price</th>
                <th className="pb-3 px-2 w-28 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {form.items
                .filter((i) => i.description.trim())
                .map((it, i) => (
                  <tr
                    key={i}
                    className="border-t border-brand-100"
                    style={{ borderColor: styles.borderColor || "#EAE4D6" }}
                  >
                    <td className="py-3 pr-2 text-brand-400">{i + 1}</td>
                    <td className="py-3 px-2 font-medium">{it.description}</td>
                    <td className="py-3 px-2 text-right tabular-nums">
                      {it.qty}
                    </td>
                    <td className="py-3 px-2 text-right tabular-nums">
                      {aed(it.unit_price)}
                    </td>
                    <td className="py-3 px-2 text-right font-semibold tabular-nums">
                      {aed(it.qty * it.unit_price)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>

          {/* Total */}
          <div
            className="flex justify-end mt-4 pt-4"
            style={{ borderTop: "2px solid #EAE4D6" }}
          >
            <div className="text-right">
              <p
                className="text-[32px] font-extrabold tracking-tight tabular-nums"
                style={{ color: styles.accentColor || "#222222" }}
              >
                {aed(total)}
              </p>
              <p className="text-xs text-brand-400 font-semibold uppercase tracking-wider">
                Total Amount (AED)
              </p>
            </div>
          </div>
        </div>

        {/* Terms */}
        {form.terms && (
          <div className="mb-6">
            <p className="text-xs font-semibold text-brand-400 uppercase tracking-wider mb-2">
              Terms & Conditions
            </p>
            <p className="text-sm text-brand-600 whitespace-pre-line leading-relaxed">
              {form.terms}
            </p>
          </div>
        )}

        {/* Notes */}
        {form.notes && (
          <div className="mb-6 p-4 rounded-xl" style={{ backgroundColor: styles.supplierBg || "#F7F2E6" }}>
            <p className="text-sm text-brand-600 italic">{form.notes}</p>
          </div>
        )}

        {/* Signatures */}
        <div className="grid grid-cols-2 gap-8 mt-12 pt-6" style={{ borderTop: "2px solid #EAE4D6" }}>
          <div className="text-center">
            <p className="text-sm font-semibold text-ink mb-4">For Supplier</p>
            <div style={{ borderTop: `1px solid ${styles.borderColor || "#EAE4D6"}` }} className="pt-3">
              <p className="text-xs text-brand-400">Authorized Signature & Date</p>
            </div>
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-ink mb-4">Company Stamp & Signature</p>
            {form.company_stamp ? (
              <img src={form.company_stamp} alt="Company stamp" className="h-24 mx-auto object-contain mb-2" />
            ) : (
              <Building2 size={28} className="mx-auto mb-2" style={{ color: styles.accentColor || "#6B6B6B" }} />
            )}
            {form.company_signature && (
              <img src={form.company_signature} alt="Authorized signature" className="h-14 mx-auto object-contain mb-2 opacity-80" />
            )}
            <div style={{ borderTop: `1px solid ${styles.borderColor || "#EAE4D6"}` }} className="pt-3">
              <p className="text-xs text-brand-400">Authorized Signature</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Frosted Overlay LPO (file template with positioned boxes)          */
/* ------------------------------------------------------------------ */

function FrostedOverlayLpo({
  form,
  template,
}: {
  form: LpoForm;
  template: CustomTemplate;
}) {
  const total = form.items.reduce((s, i) => s + i.qty * i.unit_price, 0);
  const clean = (s: string) => s || "—";
  const pos = template.positions || {};

  const boxStyle = (key: string): React.CSSProperties => {
    const p = pos[key];
    if (!p) return { display: "none" };
    return {
      position: "absolute",
      left: `${p.x}%`,
      top: `${p.y}%`,
      width: `${(p as any).w || 45}%`,
      background: "rgba(255,255,255,0.88)",
      backdropFilter: "blur(6px)",
      borderRadius: "16px",
      padding: "20px",
      boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    };
  };

  return (
    <>
      <div style={boxStyle("company_info")}>
        <p className="font-bold text-lg">{clean(form.company_name)}</p>
        <p className="text-sm text-brand-500">{clean(form.company_address)}</p>
        <p className="text-sm text-brand-500">TRN: {clean(form.company_trn)}</p>
      </div>
      <div style={boxStyle("lpo_header")}>
        <h1 className="text-xl font-extrabold">LOCAL PURCHASE ORDER</h1>
        <p className="font-mono text-lg font-bold mt-1">{form.number}</p>
        <p className="text-sm text-brand-500">Date: {form.order_date}</p>
        {form.expected_date && (
          <p className="text-sm text-brand-500">Expected: {form.expected_date}</p>
        )}
      </div>
      <div style={boxStyle("supplier_info")}>
        <p className="text-xs font-semibold text-brand-400 uppercase mb-1">Supplier</p>
        <p className="font-bold">{clean(form.supplier_name)}</p>
        <p className="text-sm text-brand-500">{clean(form.supplier_address)}</p>
        {form.supplier_trn && <p className="text-sm text-brand-500">TRN: {form.supplier_trn}</p>}
      </div>
      <div style={boxStyle("items_table")}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-brand-200 text-xs font-semibold text-brand-400">
              <th className="pb-1 text-left">Description</th>
              <th className="pb-1 text-right w-12">Qty</th>
              <th className="pb-1 text-right w-20">Price</th>
              <th className="pb-1 text-right w-20">Amount</th>
            </tr>
          </thead>
          <tbody>
            {form.items.filter(i => i.description.trim()).map((it, i) => (
              <tr key={i} className="border-b border-brand-100/50">
                <td className="py-1.5">{it.description}</td>
                <td className="py-1.5 text-right">{it.qty}</td>
                <td className="py-1.5 text-right">{aed(it.unit_price)}</td>
                <td className="py-1.5 text-right font-semibold">{aed(it.qty * it.unit_price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-right mt-2 font-bold text-lg tabular-nums">{aed(total)}</div>
      </div>
      <div style={boxStyle("totals")}>
        <p className="text-2xl font-extrabold tabular-nums">{aed(total)}</p>
        <p className="text-xs text-brand-400">Total Amount (AED)</p>
      </div>
      <div style={boxStyle("notes_terms")}>
        {form.terms && (
          <div className="mb-2">
            <p className="text-xs font-semibold text-brand-400 uppercase">Terms</p>
            <p className="text-sm text-brand-600 whitespace-pre-line">{form.terms}</p>
          </div>
        )}
        {form.notes && <p className="text-sm text-brand-500 italic">{form.notes}</p>}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Template Styles                                                    */
/* ------------------------------------------------------------------ */

function getTemplateStyle(
  tplId: string,
  accent: string
): any {
  const a = accent || "#222222";
  switch (tplId) {
    case "uae-standard":
      return {
        wrapper: { borderTop: `4px solid ${a}` },
        container: {},
        title: { color: a },
        accentColor: a,
        headerBorder: `2px solid ${a}22`,
        supplierBg: `${a}0A`,
        borderColor: `${a}22`,
      };
    case "uae-minimal":
      return {
        wrapper: {},
        container: { maxWidth: "700px", margin: "0 auto" },
        title: { color: a, fontSize: "22px", fontWeight: 600 },
        accentColor: a,
        headerBorder: `1px solid #EAE4D6`,
        supplierBg: "#FAFAFA",
        borderColor: "#EAE4D6",
      };
    case "corporate":
      return {
        wrapper: { borderLeft: `6px solid ${a}` },
        container: {},
        title: { color: a, textTransform: "uppercase", letterSpacing: "2px", fontSize: "20px" },
        accentColor: a,
        headerBorder: `3px solid ${a}`,
        supplierBg: "#F7F7F7",
        borderColor: "#DDD",
      };
    case "modern":
      return {
        wrapper: {},
        container: {},
        title: { color: "#FFFFFF", background: a, padding: "12px 20px", borderRadius: "8px", display: "inline-block" },
        accentColor: a,
        headerBorder: "none",
        supplierBg: `${a}0D`,
        borderColor: `${a}20`,
      };
    case "classic":
      return {
        wrapper: {},
        container: { fontFamily: "Georgia, serif" },
        title: { color: a, fontFamily: "Georgia, serif" },
        accentColor: a,
        headerBorder: `1px double ${a}`,
        supplierBg: "transparent",
        borderColor: "#CCC",
      };
    case "simple":
      return {
        wrapper: {},
        container: {},
        title: { color: a, fontSize: "18px", fontWeight: 600 },
        accentColor: a,
        headerBorder: "1px solid #EAE4D6",
        supplierBg: "transparent",
        borderColor: "#EAE4D6",
      };
    default:
      return {
        wrapper: {},
        container: {},
        title: { color: a },
        accentColor: a,
        headerBorder: "2px solid #EAE4D6",
        supplierBg: "#F7F2E6",
        borderColor: "#EAE4D6",
      };
  }
}

/* ------------------------------------------------------------------ */
/*  LPO Tile Preview (mini SVG)                                        */
/* ------------------------------------------------------------------ */

function LpoTilePreview({ templateId }: { templateId: string }) {
  const color = templateId.startsWith("custom-") ? "#FFD600" : "#222222";
  return (
    <svg
      viewBox="0 0 120 80"
      className="w-full h-auto rounded-lg"
      style={{ background: "#FFFFFF" }}
    >
      {/* Top bar */}
      <rect x="4" y="6" width="112" height="4" rx="2" fill={color} opacity="0.8" />
      {/* Title line */}
      <rect x="4" y="14" width="60" height="3" rx="1.5" fill={color} />
      {/* Company lines */}
      <rect x="4" y="22" width="40" height="2" rx="1" fill="#6B6B6B" opacity="0.6" />
      <rect x="4" y="28" width="30" height="2" rx="1" fill="#6B6B6B" opacity="0.4" />
      {/* LPO number */}
      <rect x="70" y="22" width="46" height="6" rx="1" fill={color} opacity="0.15" />
      {/* Supplier box */}
      <rect x="4" y="36" width="112" height="18" rx="3" fill={color} opacity="0.08" />
      <rect x="10" y="40" width="35" height="2" rx="1" fill={color} opacity="0.4" />
      <rect x="10" y="46" width="50" height="2" rx="1" fill="#6B6B6B" opacity="0.3" />
      {/* Items table */}
      <rect x="4" y="58" width="112" height="2" rx="1" fill="#EAE4D6" />
      <rect x="4" y="63" width="112" height="2" rx="1" fill="#EAE4D6" />
      <rect x="4" y="68" width="112" height="2" rx="1" fill="#EAE4D6" />
      {/* Total */}
      <rect x="80" y="74" width="36" height="4" rx="2" fill={color} opacity="0.2" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  LPO Letter Generator                                               */
/* ------------------------------------------------------------------ */

function LpoLetter({
  form,
  onClose,
}: {
  form: LpoForm;
  onClose: () => void;
}) {
  const letterRef = useRef<HTMLDivElement>(null);
  const downloadLetter = () => {
    if (letterRef.current) {
      const sheet = letterRef.current.closest('.invoice-print') as HTMLElement;
      downloadElementAsPdf(sheet || letterRef.current, `LPO-Letter-${form.number}`);
    }
  };

  const dateStr = form.order_date
    ? new Date(form.order_date).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : new Date().toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });

  const total = form.items.reduce((s, i) => s + i.qty * i.unit_price, 0);

  return (
    <Modal open onClose={onClose} title="Purchase Order Letter" size="3xl">
      <div className="flex justify-end mb-4 no-print">
        <button className="btn-ghost" onClick={downloadLetter}>
          <Download size={15} /> Download Letter
        </button>
      </div>

      <div
        ref={letterRef}
        className="bg-white p-12 rounded-xl shadow-card print:shadow-none print:rounded-none"
        style={{ fontFamily: "Georgia, serif", lineHeight: 1.8, minHeight: "1123px" }}
      >
        {/* Letterhead */}
        <div className="text-center mb-8 pb-6" style={{ borderBottom: "2px solid #222" }}>
          <h1 className="text-2xl font-bold tracking-wide uppercase" style={{ fontFamily: "Georgia, serif" }}>
            {form.company_name || "Your Company"}
          </h1>
          <p className="text-sm text-brand-500 mt-1">
            {form.company_address || "Dubai, UAE"}
            {form.company_trn && ` | TRN: ${form.company_trn}`}
          </p>
        </div>

        <p className="text-right text-sm mb-6">{dateStr}</p>

        <p className="mb-4">
          <strong>To:</strong><br />
          {form.supplier_name || "[Supplier Name]"}<br />
          {form.supplier_address || "[Supplier Address]"}
          {form.supplier_trn && <><br />TRN: {form.supplier_trn}</>}
        </p>

        <p className="mb-4">
          <strong>Subject: Local Purchase Order — {form.number}</strong>
        </p>

        <p className="mb-4">
          Dear Sir/Madam,
        </p>

        <p className="mb-4">
          We are pleased to issue this Local Purchase Order for the supply of the
          following items as per the terms and conditions outlined below.
        </p>

        {/* Items table in letter */}
        <table className="w-full mb-6" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #222", borderTop: "1px solid #222" }}>
              <th className="py-2 text-left text-sm" style={{ width: "8%" }}>#</th>
              <th className="py-2 text-left text-sm">Description</th>
              <th className="py-2 text-right text-sm" style={{ width: "12%" }}>Qty</th>
              <th className="py-2 text-right text-sm" style={{ width: "20%" }}>Unit Price (AED)</th>
              <th className="py-2 text-right text-sm" style={{ width: "20%" }}>Amount (AED)</th>
            </tr>
          </thead>
          <tbody>
            {form.items
              .filter((i) => i.description.trim())
              .map((it, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #DDD" }}>
                  <td className="py-2 text-sm">{i + 1}</td>
                  <td className="py-2 text-sm">{it.description}</td>
                  <td className="py-2 text-right text-sm">{it.qty}</td>
                  <td className="py-2 text-right text-sm">{aed(it.unit_price)}</td>
                  <td className="py-2 text-right text-sm font-bold">{aed(it.qty * it.unit_price)}</td>
                </tr>
              ))}
            <tr style={{ borderTop: "2px solid #222" }}>
              <td colSpan={4} className="py-3 text-right font-bold">TOTAL (AED):</td>
              <td className="py-3 text-right font-bold text-lg">{aed(total)}</td>
            </tr>
          </tbody>
        </table>

        {form.terms && (
          <div className="mb-6">
            <p className="font-bold text-sm mb-2">Terms & Conditions:</p>
            <p className="text-sm whitespace-pre-line" style={{ lineHeight: 1.6 }}>
              {form.terms}
            </p>
          </div>
        )}

        <p className="mb-4">
          Please confirm acceptance of this order by signing and returning a copy of this letter.
        </p>

        {form.expected_date && (
          <p className="mb-4">
            <strong>Expected Delivery Date:</strong> {new Date(form.expected_date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
          </p>
        )}

        {form.notes && (
          <p className="mb-4 italic text-brand-600">{form.notes}</p>
        )}

        <p className="mb-2">Yours faithfully,</p>
        <p className="mb-1 font-bold">{form.company_name || "Your Company"}</p>

        <div className="mt-12 grid grid-cols-2 gap-8">
          <div>
            <div style={{ borderTop: "1px solid #222" }} className="pt-2">
              <p className="text-xs text-brand-400">Authorized Signature</p>
              <p className="text-xs text-brand-400">Name: _________________</p>
              <p className="text-xs text-brand-400">Date: _________________</p>
            </div>
          </div>
          <div>
            {form.company_stamp && (
              <img src={form.company_stamp} alt="Company stamp" className="h-20 mx-auto object-contain mb-2" />
            )}
            {form.company_signature && (
              <img src={form.company_signature} alt="Authorized signature" className="h-14 mx-auto object-contain mb-2 opacity-80" />
            )}
            <div style={{ borderTop: "1px solid #222" }} className="pt-2">
              <p className="text-xs text-brand-400">Company Stamp</p>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  Helper Components                                                  */
/* ------------------------------------------------------------------ */

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
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-full bg-primary-400 text-ink font-bold text-sm grid place-items-center">
            {n}
          </span>
          <div>
            <h3 className="font-bold text-ink">{title}</h3>
            {subtitle && (
              <p className="text-xs text-brand-400">{subtitle}</p>
            )}
          </div>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function SupplierQuickAdd({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (s: Supplier) => void;
}) {
  const { toast } = useUI();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [trn, setTrn] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) {
      toast.error("Supplier name is required");
      return;
    }
    setBusy(true);
    try {
      const id = await suppliersApi.create({
        name: name.trim(),
        address: address.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      toast.success("Supplier added.");
      onSaved({
        id,
        name: name.trim(),
        address: address.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        created_at: new Date().toISOString(),
      } as Supplier);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Quick Add Supplier" size="md">
      <div className="space-y-3">
        <Field label="Supplier Name *">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Company name" />
        </Field>
        <Field label="Address">
          <textarea className="textarea" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Dubai, UAE" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email">
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Phone">
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
        <Field label="TRN">
          <input className="input" value={trn} onChange={(e) => setTrn(e.target.value)} placeholder="Tax Registration Number" />
        </Field>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy || !name.trim()} onClick={save}>
          {busy ? "Saving…" : "Add Supplier"}
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  Stamp / Signature Upload Components                                */
/* ------------------------------------------------------------------ */

function StampUpload({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (data: string) => void;
  label: string;
}) {
  const stampRef = useRef<HTMLInputElement>(null);
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result));
    reader.readAsDataURL(file);
  };
  return (
    <div>
      <input
        ref={stampRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />
      {value ? (
        <div className="relative inline-block group">
          <img
            src={value}
            alt="Company stamp"
            className="h-20 object-contain rounded-lg border border-brand-200 p-1 bg-white cursor-pointer hover:border-primary-400 transition-colors"
            onClick={() => stampRef.current?.click()}
          />
          <button
            aria-label="Remove stamp"
            className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-danger text-white text-xs grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            onClick={(e) => { e.stopPropagation(); onChange(""); saveStamp(""); }}
          >
            ×
          </button>
        </div>
      ) : (
        <button
          className="btn-ghost text-xs flex items-center gap-2 border-2 border-dashed border-brand-200 rounded-xl p-4 w-full justify-center hover:border-primary-400 transition-colors cursor-pointer"
          onClick={() => stampRef.current?.click()}
        >
          <Upload size={14} /> {label}
        </button>
      )}
    </div>
  );
}

function SignatureUpload({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (data: string) => void;
  label: string;
}) {
  const sigRef = useRef<HTMLInputElement>(null);
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result));
    reader.readAsDataURL(file);
  };
  return (
    <div>
      <input
        ref={sigRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />
      {value ? (
        <div className="relative inline-block group">
          <img
            src={value}
            alt="Authorized signature"
            className="h-14 object-contain rounded-lg border border-brand-200 p-1 bg-white cursor-pointer hover:border-primary-400 transition-colors"
            onClick={() => sigRef.current?.click()}
          />
          <button
            aria-label="Remove signature"
            className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-danger text-white text-xs grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            onClick={(e) => { e.stopPropagation(); onChange(""); saveSignature(""); }}
          >
            ×
          </button>
        </div>
      ) : (
        <button
          className="btn-ghost text-xs flex items-center gap-2 border-2 border-dashed border-brand-200 rounded-xl p-4 w-full justify-center hover:border-primary-400 transition-colors cursor-pointer"
          onClick={() => sigRef.current?.click()}
        >
          <Upload size={14} /> {label}
        </button>
      )}
    </div>
  );
}
