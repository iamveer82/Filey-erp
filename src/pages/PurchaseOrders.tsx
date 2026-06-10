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
  Building2,
  Stamp,
  LayoutTemplate,
  CreditCard,
  Pencil,
  Minus,
  Monitor,
  Smartphone,
} from "lucide-react";
import {
  pos,
  suppliers as suppliersApi,
  billing,
  type PoSummary,
  type PoInput,
  type PoPayment,
  type Supplier,
  type CompanyProfile,
} from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { useUI } from "../lib/ui";
import { downloadCsv } from "../lib/csv";
import { aed, fmtDate, num, numInput, errMsg } from "../lib/format";
import {
  invoiceTotals,
} from "../lib/money";
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
import {
  LetterheadFrame,
  loadLetterhead,
  hasLetterhead,
  EMPTY_LETTERHEAD,
  DEFAULT_HEADER_SPACE,
  DEFAULT_FOOTER_SPACE,
  type LetterheadInfo,
} from "../components/Letterhead";
import FitPreview from "../components/FitPreview";
import { downloadElementAsPdf, elementToPdfBytes } from "../lib/pdfTools";
import { autoSaveDocument } from "../lib/files";

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

type LpoItem = {
  description: string;
  qty: number;
  unit: string;
  unit_price: number;
};

type LpoForm = {
  id?: number;
  number: string;
  status: string;
  template: string;
  accent: string;
  supplier_id?: number;
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
  company_stamp: string;
  company_signature: string;
  order_date: string;
  expected_date: string;
  tax_rate: number;
  notes: string;
  terms: string;
  items: LpoItem[];
};

function blankLpo(c: CompanyProfile): LpoForm {
  const y = new Date().getFullYear();
  return {
    number: `LPO-${y}-${String(Math.floor(Math.random() * 9000) + 1000)}`,
    status: "draft",
    template: c.default_template || "uae-standard",
    accent: c.default_accent || "#222222",
    supplier_id: undefined,
    supplier_name: "",
    supplier_address: "",
    supplier_trn: "",
    supplier_email: "",
    supplier_phone: "",
    company_name: c.name,
    company_address: c.address || "",
    company_trn: c.trn || "",
    company_email: c.email || "",
    company_phone: c.phone || "",
    company_stamp: loadSavedStamp(),
    company_signature: loadSavedSignature(),
    order_date: today(),
    expected_date: "",
    tax_rate: c.default_tax_rate ?? 5,
    notes: "Thank you for your business.",
    terms: "1. Payment due within 30 days of invoice.\n2. Goods remain property of seller until paid in full.\n3. All prices are in AED unless otherwise stated.\n4. Delivery within 7-14 working days.",
    items: [{ description: "", qty: 1, unit: "MT", unit_price: 0 }],
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
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [payFor, setPayFor] = useState<PoSummary | null>(null);

  useEffect(() => {
    billing.getCompany().then(setCompany).catch(() => {});
  }, []);

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

  const editPo = async (poId: number) => {
    try {
      const [po, supps] = await Promise.all([
        pos.get(poId),
        suppliersApi.list(),
      ]);
      if (!po) return;
      const supplier = supps.find((s) => s.id === po.supplier_id);
      setLpoForm({
        id: po.id,
        number: po.po_number || "",
        status: po.status || "draft",
        template: "uae-standard",
        accent: "#222222",
        supplier_id: po.supplier_id,
        supplier_name: supplier?.name || "",
        supplier_address: supplier?.address || "",
        supplier_trn: (supplier as any)?.trn || "",
        supplier_email: supplier?.email || "",
        supplier_phone: supplier?.phone || "",
        company_name: company?.name || "",
        company_address: company?.address || "",
        company_trn: company?.trn || "",
        company_email: company?.email || "",
        company_phone: company?.phone || "",
        company_stamp: loadSavedStamp(),
        company_signature: loadSavedSignature(),
        order_date: po.order_date || today(),
        expected_date: po.expected_date || "",
        tax_rate: (po as any).tax_rate ?? (company?.default_tax_rate ?? 5),
        notes: po.notes || "",
        terms: "",
        items: po.items.map((i: any) => ({
          description: i.description || "",
          qty: i.quantity || 1,
          unit: (i as any).unit || "MT",
          unit_price: i.unit_cost || 0,
        })),
      });
    } catch (e: any) {
      toast.error(e?.message || "Failed to load PO");
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
              disabled={!company}
              onClick={() => company && setLpoForm(blankLpo(company))}
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
                <button
                  aria-label="Record payment"
                  title="Record payment"
                  className="text-brand-600 hover:bg-brand-100 rounded-lg p-1.5 cursor-pointer"
                  onClick={() => setPayFor(r)}
                >
                  <CreditCard size={15} />
                </button>
                <button
                  aria-label="Edit"
                  title="Edit PO"
                  className="text-brand-600 hover:bg-brand-100 rounded-lg p-1.5 cursor-pointer"
                  onClick={() => editPo(r.id)}
                >
                  <Pencil size={15} />
                </button>
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

      {payFor && (
        <PoPaymentsModal
          po={payFor}
          onClose={() => setPayFor(null)}
          onSaved={load}
        />
      )}
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
      supplier_id: form.supplier_id || undefined,
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
          unit: i.unit || undefined,
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
  // Save the LPO, then archive its PDF to My Files (deduped, best-effort).
  const handleSave = async () => {
    const el = (lpoRef.current?.closest(".invoice-print") as HTMLElement) || lpoRef.current;
    onSave();
    if (!el) return;
    try {
      const base = form.number || "lpo";
      const saved = await autoSaveDocument(`${base}.pdf`, "lpo", () => elementToPdfBytes(el, base));
      if (saved) toast.success("Saved a copy to My Files.");
    } catch { /* archiving is a convenience — never block save */ }
  };
  const set = <K extends keyof LpoForm>(k: K, v: LpoForm[K]) =>
    setForm({ ...form, [k]: v });

  const [designing, setDesigning] = useState(false);
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>(
    loadCustomTemplates
  );
  const [letterhead, setLetterhead] = useState<LetterheadInfo>(EMPTY_LETTERHEAD);
  const [useLetterhead, setUseLetterhead] = useState(false);
  const [headerSpace, setHeaderSpace] = useState(DEFAULT_HEADER_SPACE);
  const [footerSpace, setFooterSpace] = useState(DEFAULT_FOOTER_SPACE);
  useEffect(() => {
    loadLetterhead()
      .then((l) => {
        setLetterhead(l);
        setUseLetterhead(hasLetterhead(l));
      })
      .catch(() => {});
  }, []);
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
      items: [...form.items, { description: "", qty: 1, unit: "MT", unit_price: 0 }],
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
      supplier_id: s.id,
      supplier_name: s.name,
      supplier_address: s.address ?? "",
      supplier_email: s.email ?? "",
      supplier_phone: s.phone ?? "",
      supplier_trn: s.tax_id ?? form.supplier_trn,
    });

  const [viewAll, setViewAll] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const baseWidth = device === "desktop" ? 794 : 420;

  useEffect(() => {
    if (!viewOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewOpen]);

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
            className={`btn-ghost ${
              useLetterhead ? "!bg-primary-100 !text-primary-700" : ""
            }`}
            disabled={!hasLetterhead(letterhead)}
            title={
              hasLetterhead(letterhead)
                ? "Print the body over your A4 letterhead background"
                : "Set a letterhead in Settings → Company Details"
            }
            onClick={() => setUseLetterhead((v) => !v)}
          >
            <LayoutTemplate size={15} /> Letterhead{" "}
            {hasLetterhead(letterhead) ? (useLetterhead ? "On" : "Off") : ""}
          </button>
          {useLetterhead && hasLetterhead(letterhead) && (
            <div className="flex items-center gap-1.5 rounded-xl border border-brand-200 bg-white px-2 py-1">
              <label className="flex items-center gap-1 text-[11px] font-semibold text-brand-500">
                Header
                <input
                  type="number"
                  min={0}
                  step={10}
                  value={headerSpace}
                  onChange={(e) =>
                    setHeaderSpace(Math.max(0, Number(e.target.value) || 0))
                  }
                  className="w-14 rounded-md border border-brand-200 px-1.5 py-0.5 text-xs tabular-nums text-ink"
                  title="Top space (px) so the body clears your letterhead header"
                />
              </label>
              <label className="flex items-center gap-1 text-[11px] font-semibold text-brand-500">
                Footer
                <input
                  type="number"
                  min={0}
                  step={10}
                  value={footerSpace}
                  onChange={(e) =>
                    setFooterSpace(Math.max(0, Number(e.target.value) || 0))
                  }
                  className="w-14 rounded-md border border-brand-200 px-1.5 py-0.5 text-xs tabular-nums text-ink"
                  title="Bottom space (px) so the body clears your letterhead footer"
                />
              </label>
            </div>
          )}
          <button className="btn-ghost" onClick={() => setViewOpen(true)}>
            <Maximize2 size={15} /> View
          </button>
          <button className="btn-ghost" onClick={downloadPdf}>
            <Download size={15} /> PDF
          </button>
          <button className="btn-ghost" onClick={handleSave}>
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
                      value={form.supplier_id ? String(form.supplier_id) : ""}
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
                    <th className="py-2 px-2">Item Name</th>
                    <th className="py-2 px-2 w-20 text-right">Qty</th>
                    <th className="py-2 px-2 w-16 text-right">Unit</th>
                    <th className="py-2 px-2 w-28 text-right">Cost Price</th>
                    <th className="py-2 px-2 w-28 text-right">Total</th>
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
                          placeholder="Item name"
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
                          className="input text-right"
                          placeholder="MT"
                          value={it.unit}
                          onChange={(e) =>
                            setItem(i, { unit: e.target.value })
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

          {/* VAT Toggle */}
          <div className="card p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-bold text-ink text-sm">Apply VAT</p>
                <p className="text-xs text-brand-400">
                  Add VAT to LPO total
                </p>
              </div>
              <div className="flex rounded-lg bg-brand-100 p-0.5">
                {(["Yes", "No"] as const).map((lbl) => {
                  const on = lbl === "Yes";
                  const active = (form.tax_rate || 0) > 0 === on;
                  return (
                    <button
                      key={lbl}
                      type="button"
                      onClick={() =>
                        set("tax_rate", on ? (form.tax_rate > 0 ? form.tax_rate : 5) : 0)
                      }
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer transition-colors ${
                        active
                          ? "bg-white text-ink shadow-bento"
                          : "text-brand-500 hover:text-ink"
                      }`}
                    >
                      {lbl}
                    </button>
                  );
                })}
              </div>
            </div>
            {(form.tax_rate || 0) > 0 && (
              <div className="mt-3 max-w-[160px]">
                <Field label="VAT Rate %">
                  <input
                    type="number"
                    className="input"
                    placeholder="5"
                    value={form.tax_rate}
                    onChange={(e) => set("tax_rate", numInput(e.target.value))}
                  />
                </Field>
              </div>
            )}
          </div>

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
        <div className="xl:sticky xl:top-2 space-y-3">
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

          <div className="card !p-4">
            <div className="no-print flex items-start justify-between mb-3">
              <div>
                <p className="font-bold text-ink">Preview</p>
                <p className="text-xs text-brand-400">
                  This is how your LPO will look
                </p>
              </div>
            </div>

            <FitPreview baseWidth={baseWidth} zoom={zoom} padding={0}>
              <div ref={lpoRef} className="relative">
                <LPOView
                  form={form}
                  letterhead={letterhead}
                  useLetterhead={useLetterhead}
                  headerSpace={headerSpace}
                  footerSpace={footerSpace}
                />
              </div>
            </FitPreview>

            {/* preview controls */}
            <div className="no-print flex items-center justify-between mt-3 gap-2 flex-wrap">
              <div className="flex items-center gap-1 rounded-xl bg-brand-50 p-1">
                <button
                  className={`rounded-lg p-1.5 cursor-pointer ${
                    device === "desktop" ? "bg-primary-100 text-primary-700" : "text-brand-400"
                  }`}
                  onClick={() => setDevice("desktop")}
                  aria-label="Desktop preview"
                >
                  <Monitor size={15} />
                </button>
                <button
                  className={`rounded-lg p-1.5 cursor-pointer ${
                    device === "mobile" ? "bg-primary-100 text-primary-700" : "text-brand-400"
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
                  onClick={() => setZoom((z) => Math.max(40, z - 10))}
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
            </div>
          </div>
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

      {/* Full-screen view modal */}
      {viewOpen && (
        <Modal
          open
          onClose={() => setViewOpen(false)}
          title="LPO Preview"
          size="full"
        >
          <div
            className="bg-white rounded-xl overflow-y-auto"
            style={{ maxHeight: "85vh" }}
          >
            <LPOView
              form={form}
              letterhead={letterhead}
              useLetterhead={useLetterhead}
              headerSpace={headerSpace}
              footerSpace={footerSpace}
            />
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
  letterhead,
  useLetterhead = false,
  headerSpace = DEFAULT_HEADER_SPACE,
  footerSpace = DEFAULT_FOOTER_SPACE,
}: {
  form: LpoForm;
  lpoRef?: React.RefObject<HTMLDivElement | null>;
  letterhead?: LetterheadInfo;
  useLetterhead?: boolean;
  headerSpace?: number;
  footerSpace?: number;
}) {
  const customTemplates = loadCustomTemplates();
  const ct = customTemplates.find((c) => c.id === form.template);
  const isFileTemplate = ct?.type === "file";

  const total = form.items.reduce((s, i) => s + i.qty * i.unit_price, 0);
  const totals = invoiceTotals(form.items, 0, form.tax_rate || 0);
  const clean = (s: string) => s || "—";

  if (isFileTemplate && ct) {
    return (
      <div ref={lpoRef} className="relative bg-white shadow-card rounded-2xl overflow-hidden print:shadow-none print:rounded-none">
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
          {ct.positions && Object.keys(ct.positions).length > 0 ? (
            <FrostedOverlayLpo form={form} template={ct} />
          ) : (
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
                      <th className="pb-2 px-2">Item</th>
                      <th className="pb-2 px-2 w-16 text-right">Qty</th>
                      <th className="pb-2 px-2 w-14 text-right">Unit</th>
                      <th className="pb-2 px-2 w-24 text-right">Cost</th>
                      <th className="pb-2 px-2 w-24 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.items
                      .filter((i) => i.description.trim())
                      .map((it, i) => (
                        <tr key={i} className="border-b border-brand-100/50">
                          <td className="py-2 pr-2 text-brand-400">{i + 1}</td>
                          <td className="py-2 px-2">{it.description}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{it.qty}</td>
                          <td className="py-2 px-2 text-right">{it.unit || "—"}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{aed(it.unit_price)}</td>
                          <td className="py-2 px-2 text-right font-semibold tabular-nums">{aed(it.qty * it.unit_price)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                <div className="flex justify-end mt-3">
                  <div className="text-right">
                    <p className="text-2xl font-bold text-ink tabular-nums">{aed(total)}</p>
                    <p className="text-xs text-brand-400">Total Amount (AED)</p>
                  </div>
                </div>
              </div>
              {form.terms && (
                <div className="bg-white/88 backdrop-blur-sm rounded-xl p-6 shadow-sm">
                  <p className="font-semibold text-sm text-brand-400 mb-2">TERMS & CONDITIONS</p>
                  <p className="text-sm text-brand-600 whitespace-pre-line">{form.terms}</p>
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
      <LetterheadFrame
        letterhead={letterhead}
        enabled={useLetterhead}
        minHeight={1123}
        headerSpace={headerSpace}
        footerSpace={footerSpace}
        bodyPadding={32}
      >
      <div style={styles.container}>
        {/* Header — no logo, letterhead provides branding */}
        <div
          className="flex items-start justify-between pb-6 mb-6"
          style={{ borderBottom: styles.headerBorder || "2px solid #EAE4D6" }}
        >
          <div>
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
                <th className="pb-3 px-2">Item</th>
                <th className="pb-3 px-2 w-16 text-right">Qty</th>
                <th className="pb-3 px-2 w-14 text-right">Unit</th>
                <th className="pb-3 px-2 w-24 text-right">Cost</th>
                <th className="pb-3 px-2 w-24 text-right">Total</th>
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
                    <td className="py-3 px-2 text-right tabular-nums">{it.qty}</td>
                    <td className="py-3 px-2 text-right">{it.unit || "—"}</td>
                    <td className="py-3 px-2 text-right tabular-nums">{aed(it.unit_price)}</td>
                    <td className="py-3 px-2 text-right font-semibold tabular-nums">{aed(it.qty * it.unit_price)}</td>
                  </tr>
                ))}
            </tbody>
          </table>

          {/* Total */}
          <div
            className="flex justify-end mt-4 pt-4"
            style={{ borderTop: "2px solid #EAE4D6" }}
          >
            <div className="text-right space-y-1 min-w-[200px]">
              <div className="flex justify-between text-sm">
                <span className="text-brand-400">Subtotal</span>
                <span className="font-semibold tabular-nums">{aed(totals.subtotal)}</span>
              </div>
              {(form.tax_rate || 0) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-brand-400">VAT ({form.tax_rate}%)</span>
                  <span className="font-semibold tabular-nums">{aed(totals.tax)}</span>
                </div>
              )}
              <div className="flex justify-between pt-2" style={{ borderTop: "2px solid #EAE4D6" }}>
                <span className="text-xs font-semibold uppercase tracking-wider text-brand-400">Total</span>
                <p
                  className="text-[28px] font-extrabold tracking-tight tabular-nums"
                  style={{ color: styles.accentColor || "#222222" }}
                >
                  {aed(totals.total)}
                </p>
              </div>
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
      </LetterheadFrame>
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
  const totals = invoiceTotals(form.items, 0, form.tax_rate || 0);
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
              <th className="pb-1 text-left">Item</th>
              <th className="pb-1 text-right w-10">Qty</th>
              <th className="pb-1 text-right w-10">Unit</th>
              <th className="pb-1 text-right w-16">Cost</th>
              <th className="pb-1 text-right w-16">Total</th>
            </tr>
          </thead>
          <tbody>
            {form.items.filter(i => i.description.trim()).map((it, i) => (
              <tr key={i} className="border-b border-brand-100/50">
                <td className="py-1.5">{it.description}</td>
                <td className="py-1.5 text-right">{it.qty}</td>
                <td className="py-1.5 text-right">{it.unit || "—"}</td>
                <td className="py-1.5 text-right">{aed(it.unit_price)}</td>
                <td className="py-1.5 text-right font-semibold">{aed(it.qty * it.unit_price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-right mt-2 space-y-1">
          <div className="text-sm"><span className="text-brand-400">Subtotal</span> <span className="font-semibold tabular-nums ml-2">{aed(totals.subtotal)}</span></div>
          {(form.tax_rate || 0) > 0 && (
            <div className="text-sm"><span className="text-brand-400">VAT ({form.tax_rate}%)</span> <span className="font-semibold tabular-nums ml-2">{aed(totals.tax)}</span></div>
          )}
          <div className="font-bold text-lg tabular-nums">{aed(totals.total)}</div>
        </div>
      </div>
      <div style={boxStyle("totals")}>
        <p className="text-2xl font-extrabold tabular-nums">{aed(totals.total)}</p>
        <p className="text-xs text-brand-400">Total Amount (AED)</p>
        {(form.tax_rate || 0) > 0 && (
          <p className="text-[10px] text-brand-400 mt-0.5">incl. {form.tax_rate}% VAT</p>
        )}
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
      <rect x="4" y="6" width="112" height="4" rx="2" fill={color} opacity="0.8" />
      <rect x="4" y="14" width="60" height="3" rx="1.5" fill={color} />
      <rect x="4" y="22" width="40" height="2" rx="1" fill="#6B6B6B" opacity="0.6" />
      <rect x="4" y="28" width="30" height="2" rx="1" fill="#6B6B6B" opacity="0.4" />
      <rect x="70" y="22" width="46" height="6" rx="1" fill={color} opacity="0.15" />
      <rect x="4" y="36" width="112" height="18" rx="3" fill={color} opacity="0.08" />
      <rect x="10" y="40" width="35" height="2" rx="1" fill={color} opacity="0.4" />
      <rect x="10" y="46" width="50" height="2" rx="1" fill="#6B6B6B" opacity="0.3" />
      <rect x="4" y="58" width="112" height="2" rx="1" fill="#EAE4D6" />
      <rect x="4" y="63" width="112" height="2" rx="1" fill="#EAE4D6" />
      <rect x="4" y="68" width="112" height="2" rx="1" fill="#EAE4D6" />
      <rect x="80" y="74" width="36" height="4" rx="2" fill={color} opacity="0.2" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  PO Payments Modal                                                  */
/* ------------------------------------------------------------------ */

function PoPaymentsModal({
  po,
  onClose,
  onSaved,
}: {
  po: PoSummary;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast, confirm } = useUI();
  const [rows, setRows] = useState<PoPayment[]>([]);
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState("bank transfer");
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  const load = () => {
    pos.payments(po.id).then(setRows).catch(() => setRows([]));
  };
  useEffect(load, [po.id]);

  const total = po.total;
  const paid = rows.reduce((s, p) => s + Number(p.amount), 0);
  const balance = Math.max(0, total - paid);

  const add = async () => {
    if (amount <= 0) return;
    setBusy(true);
    try {
      await pos.addPayment(po.id, amount, method || null, paidAt);
      setAmount(0);
      load();
      onSaved();
      toast.success("Payment recorded.");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    if (!(await confirm({ title: "Remove payment", message: "Remove this payment record? This cannot be undone." }))) return;
    try {
      await pos.removePayment(id);
      load();
      onSaved();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal open onClose={onClose} title={`Payments — ${po.po_number}`}>
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="rounded-xl bg-brand-50 px-3 py-2.5">
          <p className="text-[10px] uppercase text-brand-400">Total</p>
          <p className="font-bold text-sm tabular-nums">{aed(total)}</p>
        </div>
        <div className="rounded-xl bg-success/10 px-3 py-2.5">
          <p className="text-[10px] uppercase text-success/70">Paid</p>
          <p className="font-bold text-sm text-success tabular-nums">{aed(paid)}</p>
        </div>
        <div className={`rounded-xl px-3 py-2.5 ${balance > 0 ? "bg-danger/10" : "bg-success/10"}`}>
          <p className="text-[10px] uppercase text-brand-400">Balance</p>
          <p className={`font-bold text-sm tabular-nums ${balance > 0 ? "text-danger" : "text-success"}`}>{aed(balance)}</p>
        </div>
      </div>

      {/* New payment form */}
      <div className="flex items-end gap-2 mb-4 p-3 bg-brand-50 rounded-xl">
        <div className="flex-1">
          <label className="text-[10px] font-semibold text-brand-400 block mb-1">Amount (AED)</label>
          <input
            type="number"
            min={0}
            className="input tabular-nums"
            value={amount || ""}
            onChange={(e) => setAmount(Number(e.target.value) || 0)}
          />
        </div>
        <div className="w-32">
          <label className="text-[10px] font-semibold text-brand-400 block mb-1">Method</label>
          <select className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option>bank transfer</option>
            <option>cash</option>
            <option>cheque</option>
            <option>online</option>
          </select>
        </div>
        <div className="w-32">
          <label className="text-[10px] font-semibold text-brand-400 block mb-1">Date</label>
          <input type="date" className="input" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        </div>
        <button className="btn-primary shrink-0" disabled={busy || amount <= 0} onClick={add}>
          {busy ? "…" : "Add"}
        </button>
      </div>

      {/* Payment list */}
      {rows.length === 0 ? (
        <p className="text-center text-sm text-brand-400 py-4">No payments recorded yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs font-semibold text-brand-400 border-b border-brand-100">
              <th className="py-2 text-left">Date</th>
              <th className="py-2 text-right">Amount</th>
              <th className="py-2 text-left">Method</th>
              <th className="py-2 w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-b border-brand-50">
                <td className="py-2">{fmtDate(p.paid_at)}</td>
                <td className="py-2 text-right font-semibold tabular-nums">{aed(p.amount)}</td>
                <td className="py-2 capitalize">{p.method || "—"}</td>
                <td className="py-2">
                  <button
                    aria-label="Remove payment"
                    className="text-danger hover:bg-danger/10 rounded p-1 cursor-pointer"
                    onClick={() => remove(p.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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
        tax_id: trn.trim() || undefined,
      });
      toast.success("Supplier added.");
      onSaved({
        id,
        name: name.trim(),
        address: address.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        tax_id: trn.trim() || null,
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
