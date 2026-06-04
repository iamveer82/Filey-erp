import { useEffect, useRef, useState } from "react";
import {
  Plus,
  Trash2,
  ArrowLeft,
  Download,
  Save,
  Check,
  Truck,
  Calendar,
  Boxes,
  Users,
  Maximize2,
  X,
} from "lucide-react";
import { useLiveSync } from "../lib/realtime";
import { useUI } from "../lib/ui";
import { fmtDate, numInput } from "../lib/format";
import {
  PageHeader,
  MetricCard,
  DataTable,
  Badge,
  statusTone,
  Field,
} from "../components/ui";
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

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const DC_TEMPLATES = [
  { id: "standard", name: "Standard" },
  { id: "uae-delivery", name: "UAE Delivery" },
  { id: "minimal", name: "Minimal" },
  { id: "corporate", name: "Corporate" },
];

const dcNumber = () =>
  `DC-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
const today = () => new Date().toISOString().slice(0, 10);

type DcItem = { description: string; qty: number };
type DcForm = {
  number: string;
  template: string;
  accent: string;
  dc_type: "delivery" | "goods_received" | "return";
  company_name: string;
  company_address: string;
  company_trn: string;
  party_name: string;
  party_address: string;
  party_trn: string;
  ref_number: string;
  issue_date: string;
  vehicle_number: string;
  driver_name: string;
  notes: string;
  font: string;
  items: DcItem[];
};

const DC_TYPES = [
  { id: "delivery", label: "Delivery Challan" },
  { id: "goods_received", label: "Goods Received Note" },
  { id: "return", label: "Return Challan" },
];

function blankDc(): DcForm {
  return {
    number: dcNumber(),
    template: "standard",
    accent: "#222222",
    dc_type: "delivery",
    company_name: "Your Company",
    company_address: "",
    company_trn: "",
    party_name: "",
    party_address: "",
    party_trn: "",
    ref_number: "",
    issue_date: today(),
    vehicle_number: "",
    driver_name: "",
    notes: "",
    font: "'Plus Jakarta Sans', system-ui, sans-serif",
    items: [{ description: "", qty: 1 }],
  };
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

// DC records: localStorage cache mirrored to Supabase (app_settings) for cross-device sync.
const DC_STORAGE_KEY = "filey_delivery_challans";
const DC_SETTING_KEY = "delivery_challans";

interface DcRecord {
  id: number;
  number: string;
  dc_type: string;
  party_name: string;
  issue_date: string;
  item_count: number;
  created_at: string;
}

function loadDcs(): DcRecord[] {
  try { return JSON.parse(localStorage.getItem(DC_STORAGE_KEY) || "[]"); } catch { return []; }
}
function saveDcs(records: DcRecord[]) {
  try { localStorage.setItem(DC_STORAGE_KEY, JSON.stringify(records)); } catch {}
  // Write-through so challans follow the user across devices.
  void tools.setSetting(DC_SETTING_KEY, JSON.stringify(records)).catch(() => {});
}
/** Pull challans saved on the user's other devices; remote wins when present. */
async function syncDcs(): Promise<DcRecord[]> {
  try {
    const settings = await tools.settings();
    const row = settings.find((s) => s.key === DC_SETTING_KEY);
    if (row?.value) {
      const remote: DcRecord[] = JSON.parse(row.value);
      localStorage.setItem(DC_STORAGE_KEY, JSON.stringify(remote));
      return remote;
    }
  } catch { /* offline / not configured — fall back to local */ }
  return loadDcs();
}

export default function DeliveryChallan() {
  const { toast, confirm } = useUI();
  const [records, setRecords] = useState<DcRecord[]>([]);
  const [form, setForm] = useState<DcForm | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { syncDcs().then((r) => { setRecords(r); setLoading(false); }); }, []);
  useLiveSync(() => setRecords(loadDcs()));

  const del = async (r: DcRecord) => {
    const ok = await confirm({ title: "Delete challan", message: `Delete ${r.number}?`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    const next = records.filter((x) => x.id !== r.id);
    setRecords(next);
    saveDcs(next);
    toast.success("Deleted.");
  };

  if (form) {
    return (
      <DcEditor
        form={form}
        setForm={setForm}
        onBack={() => { setForm(null); setRecords(loadDcs()); }}
        onSave={() => {
          const next = loadDcs();
          const existing = next.findIndex((r) => r.number === form.number);
          const record: DcRecord = {
            id: existing >= 0 ? next[existing].id : Date.now(),
            number: form.number,
            dc_type: form.dc_type,
            party_name: form.party_name,
            issue_date: form.issue_date,
            item_count: form.items.filter((i) => i.description.trim()).length,
            created_at: new Date().toISOString(),
          };
          if (existing >= 0) next[existing] = record;
          else next.push(record);
          saveDcs(next);
          toast.success("Challan saved.");
        }}
      />
    );
  }

  const typeLabel = (t: string) => DC_TYPES.find((x) => x.id === t)?.label || t;
  const totalItems = records.reduce((s, r) => s + r.item_count, 0);
  const parties = new Set(records.map((r) => r.party_name).filter(Boolean)).size;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Delivery"
        subtitle="Track delivery orders, goods received notes & returns"
        action={
          <button className="btn-primary" onClick={() => setForm(blankDc())}>
            <Plus size={16} /> New Challan
          </button>
        }
      />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <MetricCard label="Challans" value={String(records.length)} icon={<Truck size={20} />} />
        <MetricCard label="Items Shipped" value={String(totalItems)} icon={<Boxes size={20} />} iconClass="bg-secondary/20 text-ink" />
        <MetricCard label="Parties" value={String(parties)} icon={<Users size={20} />} iconClass="bg-info/15 text-info" />
      </div>
      <DataTable<DcRecord>
        rows={records}
        loading={loading}
        empty="No delivery challans yet — create your first one"
        columns={[
          { key: "no", label: "Challan #", sortValue: (r) => r.number, render: (r) => <span className="font-mono text-xs font-semibold">{r.number}</span> },
          { key: "type", label: "Type", sortValue: (r) => r.dc_type, render: (r) => <Badge tone={statusTone(r.dc_type)}>{typeLabel(r.dc_type)}</Badge> },
          { key: "party", label: "Party", sortValue: (r) => r.party_name, render: (r) => <span className="font-semibold text-ink">{r.party_name || "—"}</span> },
          { key: "items", label: "Items", sortValue: (r) => r.item_count, render: (r) => <span className="tabular-nums text-brand-600">{r.item_count}</span> },
          { key: "date", label: "Date", sortValue: (r) => r.issue_date, render: (r) => <span className="text-brand-600">{fmtDate(r.issue_date)}</span> },
          {
            key: "act", label: "",
            render: (r) => (
              <button aria-label={`Delete challan ${r.number}`} className="text-danger hover:bg-danger/10 rounded-lg p-1.5 cursor-pointer transition-colors duration-200" onClick={() => del(r)}>
                <Trash2 size={15} />
              </button>
            ),
          },
        ]}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Editor                                                             */
/* ------------------------------------------------------------------ */

function DcEditor({
  form, setForm, onBack, onSave,
}: { form: DcForm; setForm: (f: DcForm) => void; onBack: () => void; onSave: () => void }) {
  const { toast, confirm } = useUI();
  const dcRef = useRef<HTMLDivElement>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const downloadPdf = () => {
    if (dcRef.current) {
      const sheet = dcRef.current.closest('.invoice-print') as HTMLElement;
      downloadElementAsPdf(sheet || dcRef.current, form.number || "challan");
    } else window.print();
  };
  // Save the record, then archive the challan PDF to My Files (deduped, best-effort).
  const handleSave = async () => {
    const el = (dcRef.current?.closest(".invoice-print") as HTMLElement) || dcRef.current;
    onSave();
    if (!el) return;
    try {
      const base = form.number || "challan";
      const saved = await autoSaveDocument(`${base}.pdf`, "challan", () => elementToPdfBytes(el, base));
      if (saved) toast.success("Saved a copy to My Files.");
    } catch { /* archiving is a convenience — never block save */ }
  };
  const set = <K extends keyof DcForm>(k: K, v: DcForm[K]) => setForm({ ...form, [k]: v });
  const [designing, setDesigning] = useState(false);
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>(loadCustomTemplates);
  // Pull templates saved on the user's other devices (Supabase-backed).
  useEffect(() => {
    syncCustomTemplates().then(setCustomTemplates).catch(() => {});
  }, []);
  const allTemplates = [...DC_TEMPLATES, ...customTemplates.map((t) => ({ id: t.id, name: t.name }))];
  const applyTemplate = (id: string) => {
    const ct = customTemplates.find((c) => c.id === id);
    setForm({ ...form, template: id, ...(ct ? { accent: ct.accent, font: ct.font } : {}) });
  };
  const removeTpl = async (id: string, name: string) => {
    if (!(await confirm({ title: "Delete template", message: `Delete custom template "${name}"? This cannot be undone.`, confirmLabel: "Delete", danger: true }))) return;
    setCustomTemplates(deleteCustomTemplate(id));
    if (form.template === id) set("template", "standard");
    toast.success("Template deleted.");
  };
  useEffect(() => {
    if (!viewOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setViewOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewOpen]);

  const setItem = (idx: number, patch: Partial<DcItem>) => {
    const items = form.items.map((it, i) => i === idx ? { ...it, ...patch } : it);
    setForm({ ...form, items });
  };
  const addItem = () => setForm({ ...form, items: [...form.items, { description: "", qty: 1 }] });
  const removeItem = (idx: number) => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) });

  const [viewAll, setViewAll] = useState(false);
  const shown = viewAll ? allTemplates : allTemplates.slice(0, 5);
  const typeLabel = DC_TYPES.find((t) => t.id === form.dc_type)?.label || "Delivery Challan";

  return (
    <div>
      <div className="no-print flex items-start justify-between mb-6 gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <button className="rounded-xl p-2 text-brand-500 hover:bg-brand-100 transition-colors cursor-pointer mt-0.5" onClick={onBack} aria-label="Back">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-[28px] leading-9 font-bold text-ink">{typeLabel}</h1>
            <p className="text-sm text-brand-500 mt-0.5">Create delivery challans, goods received notes & returns</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn-ghost" onClick={() => setViewOpen(true)}><Maximize2 size={15} /> View</button>
          <button className="btn-ghost" onClick={downloadPdf}><Download size={15} /> PDF</button>
          <button className="btn-ghost" onClick={handleSave}><Save size={15} /> Save</button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_minmax(340px,400px)] gap-5 items-start">
        <div className="no-print space-y-4">
          {/* Template */}
          <Step n={1} title="Choose Template" action={
            <div className="flex items-center gap-2">
              <button className="btn-ghost text-xs" onClick={() => setViewAll((v) => !v)}>{viewAll ? "Show less" : "View all"}</button>
              <button className="btn-ghost text-xs flex items-center gap-1" onClick={() => setDesigning(true)}><Plus size={13} /> Custom</button>
            </div>
          }>
            <div className={viewAll ? "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3" : "flex gap-3 overflow-x-auto pb-1"}>
              {shown.map((tpl) => {
                const active = form.template === tpl.id;
                const ct = customTemplates.find((c) => c.id === tpl.id);
                const swatch = ct?.accent ?? "#222222";
                return (
                  <button key={tpl.id} onClick={() => applyTemplate(tpl.id)}
                    className={`group relative shrink-0 w-28 rounded-xl border-2 p-2 text-left transition-all cursor-pointer ${active ? "border-primary-400 bg-primary-50" : "border-brand-200 bg-white hover:border-primary-300"}`}>
                    {active && <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-primary-400 text-ink grid place-items-center z-10"><Check size={11} strokeWidth={3} /></span>}
                    {ct && <span role="button" tabIndex={0} aria-label={`Delete template ${tpl.name}`} onClick={(e) => { e.stopPropagation(); removeTpl(tpl.id, tpl.name); }} className="absolute top-1.5 left-1.5 z-20 grid h-5 w-5 place-items-center rounded-full bg-white/90 text-brand-400 opacity-0 shadow-sm transition-opacity hover:text-danger group-hover:opacity-100 cursor-pointer"><Trash2 size={11} /></span>}
                    <div className="w-full h-14 rounded-lg flex items-center justify-center text-[9px] font-semibold capitalize" style={{ background: `${swatch}14`, color: swatch, borderTop: `3px solid ${swatch}` }}>{tpl.name}</div>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-3 mt-3 pt-3 border-t border-brand-100">
              <span className="text-xs font-semibold text-brand-500">Accent</span>
              <ColorPicker value={form.accent} onChange={(hex) => set("accent", hex)} />
              <span className="text-xs font-semibold text-brand-500 ml-2">Font</span>
              <select className="select h-8 text-xs flex-1" value={form.font} onChange={(e) => set("font", e.target.value)}>
                <option value="'Plus Jakarta Sans', system-ui, sans-serif">Sans</option>
                <option value="'Lora', Georgia, serif">Serif</option>
                <option value="'IBM Plex Mono', monospace">Mono</option>
              </select>
            </div>
          </Step>

          {/* Details */}
          <Step n={2} title="Challan Details">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <Field label="Challan Type">
                  <select className="select" value={form.dc_type} onChange={(e) => set("dc_type", e.target.value as any)}>
                    {DC_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                </Field>
                <Field label="Party Name">
                  <input className="input" placeholder="Customer / Supplier name" value={form.party_name} onChange={(e) => set("party_name", e.target.value)} />
                </Field>
                <Field label="Party Address">
                  <textarea className="textarea" rows={2} value={form.party_address} onChange={(e) => set("party_address", e.target.value)} />
                </Field>
              </div>
              <div className="space-y-3">
                <Field label="Challan Number">
                  <input className="input" value={form.number} onChange={(e) => set("number", e.target.value)} />
                </Field>
                <Field label="Date">
                  <input type="date" className="input" value={form.issue_date} onChange={(e) => set("issue_date", e.target.value)} />
                </Field>
                <Field label="Reference #">
                  <input className="input" placeholder="Invoice / PO number" value={form.ref_number} onChange={(e) => set("ref_number", e.target.value)} />
                </Field>
                <Field label="Vehicle Number">
                  <input className="input" placeholder="Optional" value={form.vehicle_number} onChange={(e) => set("vehicle_number", e.target.value)} />
                </Field>
                <Field label="Driver Name">
                  <input className="input" placeholder="Optional" value={form.driver_name} onChange={(e) => set("driver_name", e.target.value)} />
                </Field>
              </div>
            </div>
          </Step>

          {/* Items */}
          <Step n={3} title="Items">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold text-brand-400">
                    <th className="py-2 pr-2 w-6">#</th>
                    <th className="py-2 px-2">Description</th>
                    <th className="py-2 px-2 w-24 text-right">Qty</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {form.items.map((it, i) => (
                    <tr key={i} className="border-t border-brand-100">
                      <td className="py-2 pr-2 text-brand-400">{i + 1}</td>
                      <td className="py-2 px-2"><input className="input" placeholder="Item description" value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} /></td>
                      <td className="py-2 px-2"><input type="number" className="input tabular-nums text-right" value={it.qty || ""} onChange={(e) => setItem(i, { qty: numInput(e.target.value) })} /></td>
                      <td className="py-2 px-2">{form.items.length > 1 && <button aria-label="Remove" className="text-danger hover:bg-danger/10 rounded-lg p-1 cursor-pointer" onClick={() => removeItem(i)}><Trash2 size={14} /></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3"><button className="btn-ghost text-xs" onClick={addItem}><Plus size={14} /> Add item</button></div>
          </Step>

          {/* Notes */}
          <Step n={4} title="Notes">
            <Field label="Notes / Remarks">
              <textarea className="textarea" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
            </Field>
          </Step>
        </div>

        {/* Preview */}
        <div className="sticky top-4">
          {designing && (
            <div className="mb-4">
              <TemplateDesigner onSave={() => { setDesigning(false); setCustomTemplates(loadCustomTemplates()); }} onClose={() => { setDesigning(false); setCustomTemplates(loadCustomTemplates()); }} />
            </div>
          )}
          <DcPreview form={form} dcRef={dcRef} />
        </div>
      </div>

      {viewOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-ink/50 backdrop-blur-sm p-4" onClick={() => setViewOpen(false)}>
          <div className="my-4 w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">{form.number}</h2>
              <div className="flex items-center gap-2">
                <button className="btn-ghost h-9 text-xs" onClick={downloadPdf}><Download size={14} /> PDF</button>
                <button onClick={() => setViewOpen(false)} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 text-white hover:bg-white/20 cursor-pointer"><X size={18} /></button>
              </div>
            </div>
            <DcPreview form={form} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Preview                                                            */
/* ------------------------------------------------------------------ */

function DcPreview({ form, dcRef }: { form: DcForm; dcRef?: React.RefObject<HTMLDivElement | null> }) {
  const clean = (s: string) => s || "—";
  const totalQty = form.items.reduce((s, i) => s + i.qty, 0);
  const typeLabel = DC_TYPES.find((t) => t.id === form.dc_type)?.label || "Delivery Challan";
  const a = form.accent || "#222222";

  return (
    <div ref={dcRef} className="bg-white shadow-card rounded-2xl overflow-hidden print:shadow-none print:rounded-none" style={{ borderTop: `4px solid ${a}`, fontFamily: form.font || undefined }}>
      <div className="p-8 min-h-[700px]">
        {/* Header */}
        <div className="flex items-start justify-between pb-6 mb-6" style={{ borderBottom: `2px solid ${a}22` }}>
          <div>
            <h1 className="text-[26px] font-extrabold tracking-tight" style={{ color: a }}>{typeLabel}</h1>
            <p className="text-sm text-brand-400 mt-1">#{form.number}</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-bold text-[15px]" style={{ color: a }}>{clean(form.company_name)}</p>
            <p className="text-brand-500">{clean(form.company_address)}</p>
            <p className="text-brand-500 mt-1 flex items-center gap-2 justify-end">
              <Calendar size={13} /> {form.issue_date}
            </p>
          </div>
        </div>

        {/* Party */}
        <div className="mb-6 p-5 rounded-xl" style={{ backgroundColor: `${a}0A` }}>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-brand-400 uppercase mb-1">To / Party</p>
              <p className="font-bold text-[17px]">{clean(form.party_name)}</p>
              <p className="text-sm text-brand-500">{clean(form.party_address)}</p>
            </div>
            <div className="text-right">
              {form.ref_number && <p className="text-sm text-brand-500">Ref: {form.ref_number}</p>}
              {form.vehicle_number && <p className="text-sm text-brand-500 flex items-center gap-1 justify-end"><Truck size={13} /> {form.vehicle_number}</p>}
              {form.driver_name && <p className="text-sm text-brand-500 flex items-center gap-1 justify-end"><Users size={13} /> {form.driver_name}</p>}
            </div>
          </div>
        </div>

        {/* Items */}
        <table className="w-full text-sm mb-6">
          <thead>
            <tr className="text-left text-xs font-semibold uppercase tracking-wider" style={{ color: a }}>
              <th className="pb-3 pr-2 w-6">#</th>
              <th className="pb-3 px-2">Description</th>
              <th className="pb-3 px-2 w-24 text-right">Qty</th>
            </tr>
          </thead>
          <tbody>
            {form.items.filter(i => i.description.trim()).map((it, i) => (
              <tr key={i} className="border-t border-brand-100">
                <td className="py-3 pr-2 text-brand-400">{i + 1}</td>
                <td className="py-3 px-2 font-medium">{it.description}</td>
                <td className="py-3 px-2 text-right font-semibold tabular-nums">{it.qty}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="flex justify-end mb-6 pt-4" style={{ borderTop: "2px solid #EAE4D6" }}>
          <div className="text-right">
            <p className="text-[28px] font-extrabold tabular-nums" style={{ color: a }}>{totalQty}</p>
            <p className="text-xs text-brand-400 font-semibold uppercase">Total Quantity</p>
          </div>
        </div>

        {/* Notes */}
        {form.notes && (
          <div className="mb-6 p-4 rounded-xl" style={{ backgroundColor: `${a}0A` }}>
            <p className="text-sm text-brand-600">{form.notes}</p>
          </div>
        )}

        {/* Signatures */}
        <div className="grid grid-cols-3 gap-6 mt-12 pt-6" style={{ borderTop: "2px solid #EAE4D6" }}>
          <div className="text-center">
            <p className="text-xs font-semibold text-brand-400 mb-8">Prepared By</p>
            <div style={{ borderTop: `1px solid ${a}22` }} className="pt-1"><p className="text-[10px] text-brand-400">Signature</p></div>
          </div>
          <div className="text-center">
            <p className="text-xs font-semibold text-brand-400 mb-8">Received By</p>
            <div style={{ borderTop: `1px solid ${a}22` }} className="pt-1"><p className="text-[10px] text-brand-400">Signature & Stamp</p></div>
          </div>
          <div className="text-center">
            <p className="text-xs font-semibold text-brand-400 mb-8">Authorized By</p>
            <div style={{ borderTop: `1px solid ${a}22` }} className="pt-1"><p className="text-[10px] text-brand-400">Signature</p></div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function Step({ n, title, action, children }: { n: number; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-full bg-primary-400 text-ink font-bold text-sm grid place-items-center">{n}</span>
          <h3 className="font-bold text-ink">{title}</h3>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
