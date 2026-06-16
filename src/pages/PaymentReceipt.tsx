import { useEffect, useRef, useState } from "react";
import {
  Plus,
  Trash2,
  ArrowLeft,
  Download,
  Save,
  Check,
  Calendar,
  Banknote,
  Receipt,
  Maximize2,
  X,
  Upload,
  Stamp,
} from "lucide-react";
import { useLiveSync } from "../lib/realtime";
import { useUI } from "../lib/ui";
import { aed, fmtDate, numInput, money, CURRENCIES } from "../lib/format";
import { nextDocNumber } from "../lib/docNumber";
import { PageHeader, MetricCard, DataTable, Field } from "../components/ui";
import {
  loadCompanyStampSig,
  EMPTY_STAMP_SIG,
  type CompanyStampSig,
} from "../components/StampSignatureSettings";
import { ResizablePanels } from "../components/ResizablePanels";
import { StampSignatureLayer } from "../components/StampSignature";
import ColorPicker from "../components/ColorPicker";
import TemplateDesigner, {
  loadCustomTemplates,
  deleteCustomTemplate,
  syncCustomTemplates,
  type CustomTemplate,
} from "../components/TemplateDesigner";
import { downloadElementAsPdf, elementToPdfBytes } from "../lib/pdfTools";
import { autoSaveDocument } from "../lib/files";
import { tools } from "../lib/api";

const PR_TEMPLATES = [
  { id: "standard", name: "Standard" },
  { id: "formal", name: "Formal" },
  { id: "minimal", name: "Minimal" },
];

const prNumber = (existing: string[] = []) =>
  nextDocNumber({ prefix: "RCPT", existing });
const today = () => new Date().toISOString().slice(0, 10);

type PrForm = {
  number: string;
  template: string;
  accent: string;
  company_name: string;
  company_address: string;
  company_trn: string;
  payer_name: string;
  payer_address: string;
  amount: number;
  amount_words: string;
  payment_method: string;
  payment_date: string;
  for_description: string;
  ref_number: string;
  notes: string;
  font: string;
  currency: string;
  logo?: string;
  show_stamp?: boolean;
  show_signature?: boolean;
};

const METHODS = ["Cash", "Bank Transfer", "Cheque", "Card", "Online"];

function blankPr(existing: string[] = []): PrForm {
  return {
    number: prNumber(existing),
    template: "standard",
    accent: "#222222",
    company_name: "Your Company",
    company_address: "",
    company_trn: "",
    payer_name: "",
    payer_address: "",
    amount: 0,
    amount_words: "",
    payment_method: "Bank Transfer",
    payment_date: today(),
    for_description: "",
    ref_number: "",
    notes: "Received with thanks.",
    font: "'Plus Jakarta Sans', system-ui, sans-serif",
    currency: "AED",
  };
}

const PR_STORAGE_KEY = "filey_payment_receipts";
const PR_SETTING_KEY = "payment_receipts"; // Supabase (app_settings) mirror for cross-device sync
interface PrRecord {
  id: number;
  number: string;
  payer_name: string;
  amount: number;
  payment_date: string;
  created_at: string;
}
function loadPrs(): PrRecord[] {
  try {
    return JSON.parse(localStorage.getItem(PR_STORAGE_KEY) || "[]");
  } catch (e) {
    console.warn("Failed to load payment receipts", e);
    return [];
  }
}
function savePrs(r: PrRecord[]) {
  try {
    localStorage.setItem(PR_STORAGE_KEY, JSON.stringify(r));
  } catch (e) {
    console.warn("Failed to save payment receipts", e);
  }
  // Write-through so receipts follow the user across devices.
  void tools.setSetting(PR_SETTING_KEY, JSON.stringify(r)).catch(() => {});
}
/** Pull receipts saved on the user's other devices; remote wins when present. */
async function syncPrs(): Promise<PrRecord[]> {
  try {
    const settings = await tools.settings();
    const row = settings.find((s) => s.key === PR_SETTING_KEY);
    if (row?.value) {
      const remote: PrRecord[] = JSON.parse(row.value);
      localStorage.setItem(PR_STORAGE_KEY, JSON.stringify(remote));
      return remote;
    }
  } catch (e) {
    console.warn("Failed to sync payment receipts from server", e);
    /* offline / not configured — fall back to local */
  }
  return loadPrs();
}

export default function PaymentReceipt() {
  const { toast, confirm } = useUI();
  const [records, setRecords] = useState<PrRecord[]>([]);
  const [form, setForm] = useState<PrForm | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    syncPrs().then((r) => {
      setRecords(r);
      setLoading(false);
    });
  }, []);
  useLiveSync(() => setRecords(loadPrs()));

  const del = async (r: PrRecord) => {
    const ok = await confirm({
      title: "Delete receipt",
      message: `Delete ${r.number}?`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    const next = records.filter((x) => x.id !== r.id);
    setRecords(next);
    savePrs(next);
    toast.success("Deleted.");
  };

  if (form)
    return (
      <PrEditor
        form={form}
        setForm={setForm}
        onBack={() => {
          setForm(null);
          setRecords(loadPrs());
        }}
        onSave={() => {
          const next = loadPrs();
          const existing = next.findIndex((r) => r.number === form.number);
          const record: PrRecord = {
            id: existing >= 0 ? next[existing].id : Date.now(),
            number: form.number,
            payer_name: form.payer_name,
            amount: form.amount,
            payment_date: form.payment_date,
            created_at: new Date().toISOString(),
          };
          if (existing >= 0) next[existing] = record;
          else next.push(record);
          savePrs(next);
          toast.success("Receipt saved.");
        }}
      />
    );

  const totalReceived = records.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Payment Receipts"
        subtitle="Issue payment receipts to customers & suppliers"
        action={
          <button
            className="btn-primary"
            onClick={() => setForm(blankPr(records.map((r) => r.number)))}
          >
            <Plus size={16} /> New Receipt
          </button>
        }
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <MetricCard
          label="Receipts"
          value={String(records.length)}
          icon={<Receipt size={20} />}
        />
        <MetricCard
          label="Total Received"
          value={aed(totalReceived)}
          icon={<Banknote size={20} />}
          iconClass="bg-success/15 text-success"
        />
      </div>
      <DataTable<PrRecord>
        rows={records}
        loading={loading}
        empty="No receipts yet"
        columns={[
          {
            key: "no",
            label: "Receipt #",
            sortValue: (r) => r.number,
            render: (r) => (
              <span className="font-mono text-xs font-medium">{r.number}</span>
            ),
          },
          {
            key: "payer",
            label: "Payer",
            sortValue: (r) => r.payer_name,
            render: (r) => (
              <span className="font-medium text-ink">{r.payer_name || "—"}</span>
            ),
          },
          {
            key: "amt",
            label: "Amount",
            sortValue: (r) => r.amount,
            render: (r) => (
              <span className="font-medium text-ink tabular-nums">{aed(r.amount)}</span>
            ),
          },
          {
            key: "date",
            label: "Date",
            sortValue: (r) => r.payment_date,
            render: (r) => (
              <span className="text-brand-600">{fmtDate(r.payment_date)}</span>
            ),
          },
          {
            key: "act",
            label: "",
            render: (r) => (
              <button
                aria-label={`Delete receipt ${r.number}`}
                className="text-danger hover:bg-danger/10 rounded-lg p-1.5 cursor-pointer transition-colors duration-200"
                onClick={() => del(r)}
              >
                <Trash2 size={15} />
              </button>
            ),
          },
        ]}
      />
    </div>
  );
}

function PrEditor({
  form,
  setForm,
  onBack,
  onSave,
}: {
  form: PrForm;
  setForm: (f: PrForm) => void;
  onBack: () => void;
  onSave: () => void;
}) {
  const { toast, confirm } = useUI();
  const prRef = useRef<HTMLDivElement>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [showStamp, setShowStamp] = useState(form.show_stamp ?? false);
  const [showSignature, setShowSignature] = useState(form.show_signature ?? false);
  const [companyStampSig, setCompanyStampSig] = useState<CompanyStampSig>(EMPTY_STAMP_SIG);

  useEffect(() => {
    loadCompanyStampSig()
      .then(setCompanyStampSig)
      .catch((e) => console.warn("Failed to load company stamp/signature", e));
  }, []);
  const downloadPdf = () => {
    if (prRef.current) {
      const sheet = prRef.current.closest(".invoice-print") as HTMLElement;
      downloadElementAsPdf(sheet || prRef.current, form.number || "receipt");
    } else window.print();
  };
  // Save the record, then archive the receipt PDF to My Files (deduped, best-effort).
  const handleSave = async () => {
    const el = (prRef.current?.closest(".invoice-print") as HTMLElement) || prRef.current;
    onSave();
    if (!el) return;
    try {
      const base = form.number || "receipt";
      const saved = await autoSaveDocument(`${base}.pdf`, "receipt", () =>
        elementToPdfBytes(el, base)
      );
      if (saved) toast.success("Saved a copy to My Files.");
    } catch (e) {
      console.warn("Failed to archive payment receipt PDF", e);
      /* archiving is a convenience — never block save */
    }
  };
  const set = <K extends keyof PrForm>(k: K, v: PrForm[K]) =>
    setForm({ ...form, [k]: v });
  const onLogo = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => set("logo", String(reader.result));
    reader.readAsDataURL(file);
  };
  const [designing, setDesigning] = useState(false);
  const [customTemplates, setCustomTemplates] =
    useState<CustomTemplate[]>(loadCustomTemplates);
  // Pull templates saved on the user's other devices (Supabase-backed).
  useEffect(() => {
    syncCustomTemplates()
      .then(setCustomTemplates)
      .catch(() => {});
  }, []);
  const allTemplates = [
    ...PR_TEMPLATES,
    ...customTemplates.map((t) => ({ id: t.id, name: t.name })),
  ];
  const [viewAll, setViewAll] = useState(false);
  const shown = viewAll ? allTemplates : allTemplates.slice(0, 4);
  const applyTemplate = (id: string) => {
    const ct = customTemplates.find((c) => c.id === id);
    setForm({
      ...form,
      template: id,
      ...(ct ? { accent: ct.accent, font: ct.font } : {}),
    });
  };
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
    if (form.template === id) set("template", "standard");
    toast.success("Template deleted.");
  };
  useEffect(() => {
    if (!viewOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewOpen]);

  const numberToWords = (n: number): string => {
    if (n === 0) return "Zero";
    const ones = [
      "",
      "One",
      "Two",
      "Three",
      "Four",
      "Five",
      "Six",
      "Seven",
      "Eight",
      "Nine",
      "Ten",
      "Eleven",
      "Twelve",
      "Thirteen",
      "Fourteen",
      "Fifteen",
      "Sixteen",
      "Seventeen",
      "Eighteen",
      "Nineteen",
    ];
    const tens = [
      "",
      "",
      "Twenty",
      "Thirty",
      "Forty",
      "Fifty",
      "Sixty",
      "Seventy",
      "Eighty",
      "Ninety",
    ];
    const convert = (num: number): string => {
      if (num < 20) return ones[num];
      if (num < 100)
        return tens[Math.floor(num / 10)] + (num % 10 ? " " + ones[num % 10] : "");
      if (num < 1000)
        return (
          ones[Math.floor(num / 100)] +
          " Hundred" +
          (num % 100 ? " and " + convert(num % 100) : "")
        );
      if (num < 100000)
        return (
          convert(Math.floor(num / 1000)) +
          " Thousand" +
          (num % 1000 ? " " + convert(num % 1000) : "")
        );
      return (
        convert(Math.floor(num / 100000)) +
        " Lakh" +
        (num % 100000 ? " " + convert(num % 100000) : "")
      );
    };
    return convert(Math.floor(n)) + " Only";
  };

  return (
    <div>
      <div className="no-print flex items-start justify-between mb-6 gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <button
            className="rounded-lg p-2 text-brand-500 hover:bg-brand-100 transition-colors cursor-pointer mt-0.5"
            onClick={onBack}
            aria-label="Back"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-[28px] leading-9 font-medium text-ink">
              Payment Receipt
            </h1>
            <p className="text-sm text-brand-500 mt-0.5">
              Issue professional payment receipts
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
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

            <ResizablePanels
        left={
          <div className="no-print space-y-4">
            
          <Step
            n={1}
            title="Template"
            action={
              <div className="flex gap-2">
                <button
                  className="btn-ghost text-xs"
                  onClick={() => setViewAll((v) => !v)}
                >
                  {viewAll ? "Less" : "All"}
                </button>
                <button
                  className="btn-ghost text-xs flex items-center gap-1"
                  onClick={() => setDesigning(true)}
                >
                  <Plus size={13} /> Custom
                </button>
              </div>
            }
          >
            <div
              className={
                viewAll
                  ? "grid grid-cols-2 sm:grid-cols-3 gap-3"
                  : "flex gap-3 overflow-x-auto pb-1"
              }
            >
              {shown.map((tpl) => {
                const active = form.template === tpl.id;
                const ct = customTemplates.find((c) => c.id === tpl.id);
                const swatch = ct?.accent ?? "#222222";
                return (
                  <button
                    key={tpl.id}
                    onClick={() => applyTemplate(tpl.id)}
                    className={`group relative shrink-0 w-28 rounded-xl border-2 p-2 text-left transition-all cursor-pointer ${active ? "border-primary-400 bg-primary-50" : "border-brand-200 bg-white hover:border-primary-300"}`}
                  >
                    {active && (
                      <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-primary-400 text-ink grid place-items-center z-10">
                        <Check size={11} strokeWidth={3} />
                      </span>
                    )}
                    {ct && (
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`Delete template ${tpl.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeTpl(tpl.id, tpl.name);
                        }}
                        className="absolute top-1.5 left-1.5 z-20 grid h-5 w-5 place-items-center rounded-full bg-white/90 text-brand-400 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100 cursor-pointer"
                      >
                        <Trash2 size={11} />
                      </span>
                    )}
                    <div
                      className="w-full h-14 rounded-lg flex items-center justify-center text-[9px] font-medium"
                      style={{
                        background: `${swatch}14`,
                        color: swatch,
                        borderTop: `3px solid ${swatch}`,
                      }}
                    >
                      {tpl.name}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-3 mt-3 pt-3 border-t border-brand-100">
              <span className="text-xs font-medium text-brand-500">Accent</span>
              <ColorPicker value={form.accent} onChange={(hex) => set("accent", hex)} />
              <span className="text-xs font-medium text-brand-500 ml-2">Font</span>
              <select
                className="select h-8 text-xs flex-1"
                value={form.font}
                onChange={(e) => set("font", e.target.value)}
              >
                <option value="'Plus Jakarta Sans', system-ui, sans-serif">Sans</option>
                <option value="'Lora', Georgia, serif">Serif</option>
                <option value="'IBM Plex Mono', monospace">Mono</option>
              </select>
            </div>
          </Step>
          <Step n={2} title="Receipt Details">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <Field label="Receipt Number">
                  <input
                    className="input"
                    value={form.number}
                    onChange={(e) => set("number", e.target.value)}
                  />
                </Field>
                <Field label="Payer Name">
                  <input
                    className="input"
                    placeholder="Customer / Company name"
                    value={form.payer_name}
                    onChange={(e) => set("payer_name", e.target.value)}
                  />
                </Field>
                <Field label="Payer Address">
                  <textarea
                    className="textarea"
                    rows={2}
                    value={form.payer_address}
                    onChange={(e) => set("payer_address", e.target.value)}
                  />
                </Field>
              </div>
              <div className="space-y-3">
                <Field label="Payment Date">
                  <input
                    type="date"
                    className="input"
                    value={form.payment_date}
                    onChange={(e) => set("payment_date", e.target.value)}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={`Amount (${form.currency})`}>
                    <input
                      type="number"
                      className="input text-lg font-medium"
                      value={form.amount || ""}
                      onChange={(e) => {
                        const v = numInput(e.target.value);
                        set("amount", v);
                        set("amount_words", numberToWords(v));
                      }}
                    />
                  </Field>
                  <Field label="Currency">
                    <select
                      className="select"
                      value={form.currency}
                      onChange={(e) => set("currency", e.target.value)}
                    >
                      {CURRENCIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Payment Method">
                  <select
                    className="select"
                    value={form.payment_method}
                    onChange={(e) => set("payment_method", e.target.value)}
                  >
                    {METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
            <div className="mt-3 space-y-3">
              <Field label="For / Description">
                <input
                  className="input"
                  placeholder="Payment for invoice #, services, etc."
                  value={form.for_description}
                  onChange={(e) => set("for_description", e.target.value)}
                />
              </Field>
              <Field label="Reference Number">
                <input
                  className="input"
                  placeholder="Invoice #, PO #"
                  value={form.ref_number}
                  onChange={(e) => set("ref_number", e.target.value)}
                />
              </Field>
            </div>
          </Step>
          <Step n={3} title="Company Info">
            <div className="mb-3">
              {form.logo ? (
                <div className="flex items-center gap-2">
                  <img
                    src={form.logo}
                    alt="logo"
                    className="h-12 w-12 object-contain rounded-lg border border-brand-200 bg-white"
                  />
                  <button
                    className="btn-ghost text-xs"
                    onClick={() => set("logo", undefined)}
                  >
                    <X size={13} /> Remove logo
                  </button>
                </div>
              ) : (
                <label className="btn-ghost text-xs cursor-pointer w-fit">
                  <Upload size={13} /> Upload logo
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => onLogo(e.target.files?.[0])}
                  />
                </label>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Company Name">
                <input
                  className="input"
                  value={form.company_name}
                  onChange={(e) => set("company_name", e.target.value)}
                />
              </Field>
              <Field label="TRN">
                <input
                  className="input"
                  value={form.company_trn}
                  onChange={(e) => set("company_trn", e.target.value)}
                />
              </Field>
              <div>
                <Field label="Address">
                  <textarea
                    className="textarea"
                    rows={2}
                    value={form.company_address}
                    onChange={(e) => set("company_address", e.target.value)}
                  />
                </Field>
              </div>
            </div>
          </Step>
          <Step n={4} title="Notes">
            <Field label="Notes">
              <textarea
                className="textarea"
                rows={2}
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
              />
            </Field>
          </Step>
          <Step n={5} title="Stamp & Signature">
            <div className="rounded-3xl border border-brand-200 p-4 dark:border-[#2C2C2E]">
              <div className="flex items-center gap-2 text-ink font-medium text-sm mb-3">
                <Stamp size={15} /> Company Stamp & Signature
              </div>
              <p className="text-xs text-brand-500 mb-3">Images are managed in Settings → Company Details.</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const v = !showStamp;
                    setShowStamp(v);
                    set("show_stamp", v);
                  }}
                  className={`btn-ghost text-xs ${showStamp ? "!bg-brand-50 !text-ink" : ""}`}
                  disabled={!companyStampSig.stamp?.data}
                >
                  Stamp: {showStamp ? "On" : "Off"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const v = !showSignature;
                    setShowSignature(v);
                    set("show_signature", v);
                  }}
                  className={`btn-ghost text-xs ${showSignature ? "!bg-brand-50 !text-ink" : ""}`}
                  disabled={!companyStampSig.signature?.data}
                >
                  Signature: {showSignature ? "On" : "Off"}
                </button>
              </div>
            </div>
          </Step>
        
          </div>
        }
        right={
          <div className="sticky top-4 space-y-4">
            
          {designing && (
            <div className="mb-4">
              <TemplateDesigner
                onSave={() => {
                  setDesigning(false);
                  setCustomTemplates(loadCustomTemplates());
                }}
                onClose={() => {
                  setDesigning(false);
                  setCustomTemplates(loadCustomTemplates());
                }}
              />
            </div>
          )}
          <PrPreview form={form} prRef={prRef} companyStampSig={companyStampSig} />
        
          </div>
        }
      />

      {viewOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-ink/50 p-4"
          onClick={() => setViewOpen(false)}
        >
          <div className="my-4 w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-medium text-white">{form.number}</h2>
              <div className="flex items-center gap-2">
                <button className="btn-ghost h-9 text-xs" onClick={downloadPdf}>
                  <Download size={14} /> PDF
                </button>
                <button
                  onClick={() => setViewOpen(false)}
                  aria-label="Close"
                  className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 text-white hover:bg-white/20 cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <PrPreview form={form} companyStampSig={companyStampSig} />
          </div>
        </div>
      )}
    </div>
  );
}

function PrPreview({
  form,
  prRef,
  companyStampSig,
}: {
  form: PrForm;
  prRef?: React.RefObject<HTMLDivElement | null>;
  companyStampSig?: CompanyStampSig;
}) {
  const clean = (s: string) => s || "—";
  const a = form.accent || "#222222";
  return (
    <div
      ref={prRef}
      className="bg-white shadow-card rounded-2xl overflow-hidden print:shadow-none print:rounded-none relative"
      style={{ borderTop: `4px solid ${a}`, fontFamily: form.font || undefined }}
    >
      <StampSignatureLayer
        stamp={form.show_stamp && companyStampSig?.stamp?.data ? companyStampSig.stamp : undefined}
        signature={form.show_signature && companyStampSig?.signature?.data ? companyStampSig.signature : undefined}
        onStampMove={() => {}}
        onSignatureMove={() => {}}
      />
      <div className="p-8 min-h-[500px]">
        <div
          className="text-center mb-8 pb-6"
          style={{ borderBottom: `2px solid ${a}22` }}
        >
          {form.logo && (
            <img src={form.logo} alt="" className="h-12 mx-auto mb-3 object-contain" />
          )}
          <h1 className="text-[28px] font-extrabold tracking-tight" style={{ color: a }}>
            PAYMENT RECEIPT
          </h1>
          <p className="font-mono text-lg font-bold mt-2">{form.number}</p>
        </div>
        <div className="grid grid-cols-2 gap-6 mb-6">
          <div>
            <p className="text-xs font-semibold text-brand-400 uppercase mb-1">
              Received From
            </p>
            <p className="font-bold text-lg">{clean(form.payer_name)}</p>
            <p className="text-sm text-brand-500">{clean(form.payer_address)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold text-brand-400 uppercase mb-1">
              Date & Method
            </p>
            <p className="text-sm flex items-center justify-end gap-2">
              <Calendar size={13} /> {form.payment_date}
            </p>
            <p className="text-sm flex items-center justify-end gap-2">
              <Banknote size={13} /> {form.payment_method}
            </p>
          </div>
        </div>
        <div
          className="text-center mb-6 p-6 rounded-2xl"
          style={{ backgroundColor: `${a}0A`, border: `2px solid ${a}22` }}
        >
          <p className="text-[40px] font-extrabold tabular-nums" style={{ color: a }}>
            {money(form.amount, form.currency || "AED")}
          </p>
          {form.amount_words && (
            <p className="text-sm text-brand-500 mt-1 italic">{form.amount_words}</p>
          )}
        </div>
        {form.for_description && (
          <div className="mb-4">
            <p className="font-semibold text-sm">For:</p>
            <p className="text-brand-600">{form.for_description}</p>
          </div>
        )}
        {form.ref_number && (
          <div className="mb-4">
            <p className="text-sm text-brand-500">Reference: {form.ref_number}</p>
          </div>
        )}
        <div className="mt-8 pt-6" style={{ borderTop: `2px solid #EAE4D6` }}>
          <div className="grid grid-cols-2 gap-8">
            <div>
              <p className="text-xs font-semibold text-brand-400 mb-4">Received By</p>
              <div style={{ borderTop: `1px solid ${a}22` }} className="pt-2">
                <p className="text-[10px] text-brand-400">Signature</p>
              </div>
            </div>
            <div className="text-right">
              <p className="font-bold text-[15px]" style={{ color: a }}>
                {clean(form.company_name)}
              </p>
              <p className="text-sm text-brand-500">{clean(form.company_address)}</p>
            </div>
          </div>
        </div>
        {form.notes && (
          <p className="text-sm text-brand-500 text-center mt-4 italic">{form.notes}</p>
        )}
      </div>
    </div>
  );
}

function Step({
  n,
  title,
  action,
  children,
}: {
  n: number;
  title: string;
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
          <h3 className="font-bold text-ink">{title}</h3>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
