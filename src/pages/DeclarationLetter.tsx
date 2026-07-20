import { useEffect, useRef, useState } from "react";
import {
  Download,
  Save,
  FileText,
  Monitor,
  Smartphone,
  Minus,
  Plus,
  RotateCcw,
  ArrowLeft,
  Stamp,
  PenTool,
} from "lucide-react";
import {
  billing,
  tools,
  suppliers as suppliersApi,
  crm,
  type CompanyProfile,
  type Supplier,
  type CrmCustomer,
} from "../lib/api";
import { useUI } from "../lib/ui";
import { errMsg, fmtDate } from "../lib/format";
import { PageHeader, Field, MetricCard, DataTable, Card, SearchInput } from "../components/ui";
import {
  RowActions,
  QuickViewModal,
  shareVia,
  type ShareKind,
} from "../components/RowActions";
import { DateField } from "../components/DatePicker";
import FitPreview from "../components/FitPreview";
import { downloadElementAsPdf, elementToPdfBytes } from "../lib/pdfTools";
import { autoSaveDocument } from "../lib/files";
import {
  StampSignatureLayer,
  StampSigAdjust,
  type StampSig,
} from "../components/StampSignature";
import {
  loadCompanyStampSig,
  EMPTY_STAMP_SIG,
  type CompanyStampSig,
} from "../components/StampSignatureSettings";
import { ResizablePanels } from "../components/ResizablePanels";
import {
  LetterheadFrame,
  loadLetterhead,
  hasLetterhead,
  EMPTY_LETTERHEAD,
  DEFAULT_HEADER_SPACE,
  DEFAULT_FOOTER_SPACE,
  type LetterheadInfo,
} from "../components/Letterhead";

/* ------------------------------------------------------------------ */
/*  Standard UAE VAT declaration letter                                */
/*  Mirrors the FTA hydrocarbon-supply declaration format: a tax       */
/*  registrant confirms intent to resell oil/gas so the supplier does  */
/*  not charge VAT (Federal Decree-Law No. 8 of 2017, Art. 48).        */
/* ------------------------------------------------------------------ */

const today = () => new Date().toISOString().slice(0, 10);

/** Default body. Tokens in {curly braces} are filled from the form fields at
 *  render time, so the standard wording stays intact while the figures update
 *  live. Users can edit the wording freely; tokens they keep still resolve. */
const DEFAULT_BODY = `This is with reference to Chapter Four Article (48) Clauses (3) & (4) of the Federal Decree - Law No. (8) of 2017 on Value Added Tax, we {company} hereby confirm that we are a Tax Registrant in the United Arab Emirates with Tax Registration Number {trn} LPO.No: {lpo} (QUANTITY OF {qty} {unit} AMOUNTING TO A SUM OF AED {amount})

We confirm that any crude or refined oil, unprocessed or processed natural gas, or any hydrocarbons supplied by you to us; our intention is to resell these crude or refined oil, unprocessed or processed natural gas, or any hydrocarbons or use these goods to produce or distribute any form of energy. You shall not charge VAT on the invoices raised on us in respect of such supplies.

We also confirm that we shall be responsible to the Federal Tax Authority of United Arab Emirates for calculating the Due Tax and shall be responsible for all applicable Tax obligations in respect of such supplies.

A copy of the Certificate of Registration for Value Added Tax in the United Arab Emirates is enclosed herewith for your perusal.`;

type DeclForm = {
  title?: string;
  ref: string;
  show_stamp?: boolean;
  show_signature?: boolean;
  /** Per-letter stamp/signature copy (position, opacity, crop) seeded from the company asset. */
  stamp?: StampSig;
  signature?: StampSig;
  date: string;
  company_name: string;
  company_trn: string;
  recipient_name: string;
  recipient_location: string;
  recipient_trn: string;
  lpo_ref: string;
  qty: string;
  unit: string;
  amount: string;
  body: string;
};

/** A persisted declaration letter — the form plus list metadata. */
interface SavedDecl extends DeclForm {
  id: string;
  updated_at: string;
}

function blankDecl(company?: CompanyProfile | null): DeclForm {
  return {
    title: "DECLARATION LETTER",
    ref: "",
    date: today(),
    company_name: company?.name || "Your Company",
    company_trn: company?.trn || "",
    recipient_name: "",
    recipient_location: "",
    recipient_trn: "",
    lpo_ref: "",
    qty: "",
    unit: "MT",
    amount: "",
    body: DEFAULT_BODY,
  };
}

/* ----------------------------- store ----------------------------- */
/* Declaration letters have no dedicated table — they're low-volume and
 * simple, so we persist the list as a single JSON app-setting (same
 * cross-device pattern as bank details / letterhead, no DB migration). */

const STORE_KEY = "declaration_letters";

async function listDeclarations(): Promise<SavedDecl[]> {
  try {
    const rows = await tools.settings();
    const row = rows.find((r) => r.key === STORE_KEY);
    if (!row?.value) return [];
    const arr = JSON.parse(row.value);
    return Array.isArray(arr) ? (arr as SavedDecl[]) : [];
  } catch (e) {
    console.warn("Failed to load declaration letters", e);
    return [];
  }
}

async function upsertDeclaration(doc: SavedDecl): Promise<SavedDecl[]> {
  const list = await listDeclarations();
  const next = [doc, ...list.filter((d) => d.id !== doc.id)];
  await tools.setSetting(STORE_KEY, JSON.stringify(next));
  return next;
}

async function removeDeclarations(ids: Set<string>): Promise<SavedDecl[]> {
  const list = await listDeclarations();
  const next = list.filter((d) => !ids.has(d.id));
  await tools.setSetting(STORE_KEY, JSON.stringify(next));
  return next;
}

const newId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : String(Date.now());

/** Next sequential letter reference: DL-0001, DL-0002, … (DEMO parity). */
const nextRef = (list: SavedDecl[]) => {
  const nums = list.map((d) => {
    const m = /DL-(\d+)/.exec(d.ref || "");
    return m ? Number(m[1]) : 0;
  });
  return `DL-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, "0")}`;
};

const fmtAmount = (v: string) => {
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) && n ? n.toLocaleString("en-AE") : v || "—";
};

const fmtLongDate = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
};

/** Substitute {tokens} in the body with current field values. */
function resolveBody(form: DeclForm): string {
  const map: Record<string, string> = {
    company: form.company_name || "—",
    trn: form.company_trn || "—",
    lpo: form.lpo_ref || "—",
    qty: form.qty || "—",
    unit: form.unit || "",
    amount: fmtAmount(form.amount),
    recipient: form.recipient_name || "—",
    recipientTrn: form.recipient_trn || "—",
  };
  return form.body.replace(/\{(\w+)\}/g, (_, k: string) =>
    k in map ? map[k] : `{${k}}`
  );
}

/* ================================================================== */
/*  List page — all created letters; "New Letter" opens the editor    */
/* ================================================================== */

export default function DeclarationLetter() {
  const { toast, confirm } = useUI();
  const [docs, setDocs] = useState<SavedDecl[]>([]);
  const [editing, setEditing] = useState<SavedDecl | null>(null);
  const [search, setSearch] = useState("");
  const [quickView, setQuickView] = useState<SavedDecl | null>(null);

  const loadDocs = () =>
    listDeclarations()
      .then(setDocs)
      .catch(() => {});
  useEffect(() => {
    loadDocs();
  }, []);

  // ---- List-row actions (DEMO parity) ----
  const duplicateRow = async (d: SavedDecl) => {
    const copy: SavedDecl = {
      ...d,
      id: newId(),
      ref: nextRef(docs),
      updated_at: new Date().toISOString(),
    };
    try {
      const list = await upsertDeclaration(copy);
      setDocs(list);
      toast.success(`Duplicated as ${copy.ref}.`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const deleteRow = async (d: SavedDecl) => {
    if (
      !(await confirm({
        title: "Delete letter",
        message: `Delete ${d.ref || d.lpo_ref || "this letter"}? This cannot be undone.`,
        confirmLabel: "Delete",
        danger: true,
      }))
    )
      return;
    try {
      const list = await removeDeclarations(new Set([d.id]));
      setDocs(list);
      toast.success("Deleted.");
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  /** Letters have no public link or recipient contact on the record, so the
   *  send menu shares a text summary of the letter (DEMO parity). */
  const shareRow = (kind: ShareKind, d: SavedDecl) => {
    const text = [
      `Declaration Letter ${d.ref || d.lpo_ref || ""}`.trim(),
      `Recipient: ${d.recipient_name || "—"}`,
      `LPO: ${d.lpo_ref || "—"}`,
      `Amount: AED ${fmtAmount(d.amount)}`,
      d.date ? `Date: ${fmtLongDate(d.date)}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    shareVia(kind, { text });
  };

  if (editing) {
    return (
      <DeclarationEditor
        key={editing.id}
        doc={editing}
        onBack={() => {
          setEditing(null);
          loadDocs();
        }}
        onSaved={(list) => setDocs(list)}
      />
    );
  }

  const q = search.toLowerCase();
  const filtered = docs.filter(
    (d) =>
      (d.ref || "").toLowerCase().includes(q) ||
      (d.recipient_name || "").toLowerCase().includes(q) ||
      (d.lpo_ref || "").toLowerCase().includes(q)
  );

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Declaration Letters"
        subtitle="VAT supply declaration letters in the standard UAE format"
        action={
          <button
            className="btn-primary"
            onClick={() =>
              setEditing({
                ...blankDecl(),
                id: newId(),
                ref: nextRef(docs),
                updated_at: "",
              })
            }
          >
            <Plus size={16} /> New Letter
          </button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 joined-kpis mb-4">
        <MetricCard
          label="Letters"
          value={String(docs.length)}
          icon={<FileText size={20} />}
        />
      </div>

      <div className="mb-4">
        <SearchInput
          className="max-w-md"
          placeholder="Search by recipient, LPO or reference…"
          value={search}
          onChange={setSearch}
        />
      </div>

      <DataTable<SavedDecl>
        rows={filtered}
        empty={
          search
            ? "No letters match your search"
            : "No declaration letters yet — create your first one"
        }
        rowKey={(d) => d.id}
        onRowClick={(d) => setEditing(d)}
        bulkActions={[
          {
            label: "Delete",
            danger: true,
            run: async (sel) => {
              const ok = await confirm({
                title: "Delete letters",
                message: `Delete ${sel.length} declaration letter(s)? This cannot be undone.`,
                confirmLabel: "Delete",
                danger: true,
              });
              if (!ok) return;
              const list = await removeDeclarations(new Set(sel.map((d) => d.id)));
              setDocs(list);
              toast.success(`Deleted ${sel.length}.`);
            },
          },
        ]}
        columns={[
          {
            key: "ref",
            label: "Reference",
            sortValue: (d) => d.ref || d.lpo_ref,
            render: (d) => (
              <span className="font-medium">{d.ref || d.lpo_ref || "Untitled"}</span>
            ),
          },
          {
            key: "recipient",
            label: "Recipient",
            sortValue: (d) => d.recipient_name,
            render: (d) => <span>{d.recipient_name || "—"}</span>,
          },
          {
            key: "lpo",
            label: "LPO #",
            sortValue: (d) => d.lpo_ref,
            render: (d) => <span className="font-mono text-xs">{d.lpo_ref || "—"}</span>,
          },
          {
            key: "amount",
            label: "Amount",
            sortValue: (d) => Number(String(d.amount).replace(/,/g, "")) || 0,
            render: (d) => (
              <span className="tabular-nums">AED {fmtAmount(d.amount)}</span>
            ),
          },
          {
            key: "date",
            label: "Date",
            sortValue: (d) => d.date,
            render: (d) => fmtLongDate(d.date),
          },
          {
            key: "upd",
            label: "Updated",
            sortValue: (d) => d.updated_at,
            render: (d) => (d.updated_at ? fmtDate(d.updated_at) : "—"),
          },
          {
            key: "act",
            label: "Actions",
            render: (d) => (
              <RowActions
                onView={() => setQuickView(d)}
                onEdit={() => setEditing(d)}
                onCopy={() => duplicateRow(d)}
                onDelete={() => deleteRow(d)}
                onSend={{
                  whatsapp: () => shareRow("whatsapp", d),
                  email: () => shareRow("email", d),
                  sms: () => shareRow("sms", d),
                }}
              />
            ),
          },
        ]}
      />

      <QuickViewModal
        open={!!quickView}
        onClose={() => setQuickView(null)}
        onEdit={
          quickView
            ? () => {
                const d = quickView;
                setQuickView(null);
                setEditing(d);
              }
            : undefined
        }
        data={
          quickView
            ? {
                title:
                  quickView.ref || quickView.lpo_ref || "Declaration Letter",
                subtitle: quickView.recipient_name
                  ? `For ${quickView.recipient_name}`
                  : "VAT supply declaration in the standard UAE format",
                meta: [
                  { label: "Recipient", value: quickView.recipient_name },
                  { label: "Recipient TRN", value: quickView.recipient_trn },
                  { label: "LPO #", value: quickView.lpo_ref },
                  {
                    label: "Quantity",
                    value: quickView.qty
                      ? `${quickView.qty} ${quickView.unit || ""}`.trim()
                      : "",
                  },
                  { label: "Date", value: fmtLongDate(quickView.date) },
                  {
                    label: "Last updated",
                    value: quickView.updated_at
                      ? fmtDate(quickView.updated_at)
                      : "",
                  },
                ],
                total:
                  Number(String(quickView.amount).replace(/,/g, "")) ||
                  undefined,
                currency: "AED",
                footer: (
                  <div className="mt-4 rounded-lg border border-border p-3 bg-hover/20">
                    <div className="text-[11.5px] font-medium text-muted-foreground mb-1">
                      Declaration text
                    </div>
                    <div className="text-[13px] text-foreground whitespace-pre-wrap">
                      {resolveBody(quickView)}
                    </div>
                  </div>
                ),
              }
            : null
        }
      />
    </div>
  );
}

/* ================================================================== */
/*  Editor — create / edit a single declaration letter                */
/* ================================================================== */

function DeclarationEditor({
  doc,
  onBack,
  onSaved,
}: {
  doc: SavedDecl;
  onBack: () => void;
  onSaved: (list: SavedDecl[]) => void;
}) {
  const { toast } = useUI();
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [supplierList, setSupplierList] = useState<Supplier[]>([]);
  const [customerList, setCustomerList] = useState<CrmCustomer[]>([]);
  const [form, setForm] = useState<DeclForm>(() => {
    const { id: _id, updated_at: _u, ...rest } = doc;
    // Letters saved before the title field existed default to the old heading.
    return { ...rest, title: rest.title ?? "DECLARATION LETTER" };
  });
  const [lh, setLh] = useState<LetterheadInfo>(EMPTY_LETTERHEAD);
  const [useLetterhead, setUseLetterhead] = useState(false);
  const [headerSpace, setHeaderSpace] = useState(DEFAULT_HEADER_SPACE);
  const [footerSpace, setFooterSpace] = useState(DEFAULT_FOOTER_SPACE);
  const [companyStampSig, setCompanyStampSig] = useState<CompanyStampSig>(EMPTY_STAMP_SIG);
  const [showStamp, setShowStamp] = useState(form.show_stamp ?? false);
  const [showSignature, setShowSignature] = useState(form.show_signature ?? false);
  const [zoom, setZoom] = useState(100);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [saving, setSaving] = useState(false);

  const isNew = !doc.updated_at;
  const declRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    billing
      .getCompany()
      .then((c) => {
        setCompany(c);
        setForm((f) => ({
          ...f,
          company_name: f.company_name === "Your Company" ? c.name : f.company_name,
          company_trn: f.company_trn || c.trn || "",
        }));
      })
      .catch(() => {});
    loadLetterhead()
      .then((l) => {
        setLh(l);
        setUseLetterhead(hasLetterhead(l));
      })
      .catch(() => {});
    loadCompanyStampSig().then(setCompanyStampSig).catch(() => {});
    suppliersApi.list().then(setSupplierList).catch(() => {});
    crm.customers().then(setCustomerList).catch(() => {});
  }, []);

  /** Fill recipient fields from a saved supplier ("s:<id>") or customer ("c:<id>"). */
  const fillRecipient = (key: string) => {
    if (key.startsWith("s:")) {
      const s = supplierList.find((x) => String(x.id) === key.slice(2));
      if (s)
        setForm((f) => ({
          ...f,
          recipient_name: s.name,
          recipient_location: s.address || "",
          recipient_trn: s.tax_id || "",
        }));
    } else if (key.startsWith("c:")) {
      const c = customerList.find((x) => String(x.id) === key.slice(2));
      if (c)
        setForm((f) => ({
          ...f,
          recipient_name: c.company || c.name,
          recipient_location: [c.address, c.city].filter(Boolean).join(", "),
          recipient_trn: c.trn || "",
        }));
    }
  };

  const set = <K extends keyof DeclForm>(k: K, v: DeclForm[K]) =>
    setForm({ ...form, [k]: v });

  const sheetEl = () =>
    (declRef.current?.closest(".invoice-print") as HTMLElement) || declRef.current;

  const baseName = () =>
    `Declaration-${(form.lpo_ref || form.ref || form.recipient_name || "letter")
      .replace(/[^\w.-]+/g, "_")
      .slice(0, 40)}`;

  const downloadPdf = () => {
    const el = sheetEl();
    if (el) downloadElementAsPdf(el, baseName());
    else window.print();
  };

  const handleSave = async () => {
    const el = sheetEl();
    if (!el) return;
    setSaving(true);
    try {
      // Persist the letter to the list (reopenable, cross-device)…
      const saved: SavedDecl = {
        ...form,
        id: doc.id,
        updated_at: new Date().toISOString(),
        show_stamp: showStamp,
        show_signature: showSignature,
      };
      const list = await upsertDeclaration(saved);
      onSaved(list);
      // …and archive a PDF copy to My Files (best-effort).
      const base = baseName();
      await autoSaveDocument(`${base}.pdf`, "declaration", () =>
        elementToPdfBytes(el, base)
      );
      toast.success("Saved.");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const baseWidth = device === "desktop" ? 794 : 420;
  const sheetH = Math.round(baseWidth * 1.4142);
  const paragraphs = resolveBody(form).split(/\n{2,}/);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={isNew ? "New Declaration Letter" : "Edit Declaration Letter"}
        subtitle="VAT supply declaration in the standard UAE format — print or email to your supplier"
        action={
          <div className="flex items-center gap-2">
            <button className="btn-ghost" onClick={onBack}>
              <ArrowLeft size={15} /> Back
            </button>
            <button className="btn-ghost" onClick={() => setForm(blankDecl(company))}>
              <RotateCcw size={15} /> Reset
            </button>
            <button className="btn-ghost" onClick={downloadPdf}>
              <Download size={15} /> PDF
            </button>
            <button className="btn-primary" onClick={handleSave} disabled={saving}>
              <Save size={15} /> {saving ? "Saving…" : "Save"}
            </button>
          </div>
        }
      />

            <ResizablePanels
        left={
          <div className="no-print space-y-4">
            
          {/* Parties */}
          <Card>
            <div className="mb-4">
              <Field label="Letter Title">
                <input
                  className="input"
                  placeholder="DECLARATION LETTER"
                  value={form.title ?? ""}
                  onChange={(e) => set("title", e.target.value)}
                />
              </Field>
            </div>

            <p className="font-medium text-ink mb-3">Your Company</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Company Name">
                <input
                  className="input"
                  value={form.company_name}
                  onChange={(e) => set("company_name", e.target.value)}
                />
              </Field>
              <Field label="Company TRN">
                <input
                  className="input"
                  placeholder="100000000000003"
                  value={form.company_trn}
                  onChange={(e) => set("company_trn", e.target.value)}
                />
              </Field>
            </div>

            <p className="font-medium text-ink mb-3 mt-5">Recipient (Supplier)</p>
            {(supplierList.length > 0 || customerList.length > 0) && (
              <div className="mb-3">
                <Field label="Fill from saved supplier / buyer">
                  <select
                    className="input"
                    value=""
                    onChange={(e) => fillRecipient(e.target.value)}
                  >
                    <option value="">Select to auto-fill…</option>
                    {supplierList.length > 0 && (
                      <optgroup label="Suppliers">
                        {supplierList.map((s) => (
                          <option key={`s${s.id}`} value={`s:${s.id}`}>
                            {s.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {customerList.length > 0 && (
                      <optgroup label="Buyers (Customers)">
                        {customerList.map((c) => (
                          <option key={`c${c.id}`} value={`c:${c.id}`}>
                            {c.company || c.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </Field>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Name">
                <input
                  className="input"
                  placeholder="Dune Lubricants & Oil IND LLC"
                  value={form.recipient_name}
                  onChange={(e) => set("recipient_name", e.target.value)}
                />
              </Field>
              <Field label="Location">
                <input
                  className="input"
                  placeholder="Sharjah - UAE"
                  value={form.recipient_location}
                  onChange={(e) => set("recipient_location", e.target.value)}
                />
              </Field>
              <Field label="Recipient TRN">
                <input
                  className="input"
                  placeholder="105444251000003"
                  value={form.recipient_trn}
                  onChange={(e) => set("recipient_trn", e.target.value)}
                />
              </Field>
              <Field label="Date">
                <DateField
                  value={form.date}
                  onChange={(v) => set("date", v)}
                  clearable={false}
                />
              </Field>
            </div>
          </Card>

          {/* Reference / figures */}
          <Card>
            <p className="font-medium text-ink mb-3">Order Reference</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Reference">
                <input
                  className="input"
                  placeholder="DL-0001"
                  value={form.ref}
                  onChange={(e) => set("ref", e.target.value)}
                />
              </Field>
              <Field label="LPO Number">
                <input
                  className="input"
                  placeholder="BF/DL/100/10/26"
                  value={form.lpo_ref}
                  onChange={(e) => set("lpo_ref", e.target.value)}
                />
              </Field>
              <Field label="Amount (AED)">
                <input
                  className="input tabular-nums"
                  placeholder="715650"
                  value={form.amount}
                  onChange={(e) => set("amount", e.target.value)}
                />
              </Field>
              <Field label="Quantity">
                <input
                  className="input tabular-nums"
                  placeholder="200"
                  value={form.qty}
                  onChange={(e) => set("qty", e.target.value)}
                />
              </Field>
              <Field label="Unit">
                <input
                  className="input"
                  placeholder="MT"
                  value={form.unit}
                  onChange={(e) => set("unit", e.target.value)}
                />
              </Field>
            </div>
          </Card>

          {/* Body */}
          <Card>
            <p className="font-medium text-ink mb-1">Declaration Text</p>
            <p className="text-xs text-brand-400 mb-3">
              Tokens like <code className="font-medium">{"{company}"}</code>,{" "}
              <code className="font-medium">{"{trn}"}</code>,{" "}
              <code className="font-medium">{"{lpo}"}</code>,{" "}
              <code className="font-medium">{"{qty}"}</code>,{" "}
              <code className="font-medium">{"{amount}"}</code> auto-fill from the fields
              above.
            </p>
            <textarea
              className="textarea font-mono text-xs leading-relaxed"
              rows={12}
              value={form.body}
              onChange={(e) => set("body", e.target.value)}
            />
          </Card>

          {/* Branding */}
          <Card>
            <p className="font-medium text-ink mb-3">Branding</p>
            <label className="flex items-center justify-between py-1.5 mb-3 cursor-pointer">
              <span className="text-sm text-ink flex items-center gap-2">
                <FileText size={15} /> Use letterhead
                {!hasLetterhead(lh) && (
                  <span className="text-[11px] text-brand-400">
                    (set one in Settings → Company Details)
                  </span>
                )}
              </span>
              <button
                type="button"
                disabled={!hasLetterhead(lh)}
                onClick={() => setUseLetterhead((v) => !v)}
                className={`w-9 h-5 rounded-full relative transition-colors ${
                  useLetterhead ? "bg-primary-400" : "bg-brand-200"
                } ${!hasLetterhead(lh) ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                    useLetterhead ? "left-4" : "left-0.5"
                  }`}
                />
              </button>
            </label>
            {useLetterhead && hasLetterhead(lh) && (
              <div className="grid grid-cols-2 gap-3 mb-4">
                <Field label="Header space (px)">
                  <input
                    type="number"
                    min={0}
                    step={10}
                    className="input tabular-nums"
                    value={headerSpace}
                    onChange={(e) =>
                      setHeaderSpace(Math.max(0, Number(e.target.value) || 0))
                    }
                  />
                </Field>
                <Field label="Footer space (px)">
                  <input
                    type="number"
                    min={0}
                    step={10}
                    className="input tabular-nums"
                    value={footerSpace}
                    onChange={(e) =>
                      setFooterSpace(Math.max(0, Number(e.target.value) || 0))
                    }
                  />
                </Field>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Card className="!p-3">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm font-medium text-ink">Show stamp</span>
                  <input
                    type="checkbox"
                    className="toggle"
                    checked={showStamp}
                    onChange={(e) => setShowStamp(e.target.checked)}
                  />
                </label>
              </Card>
              <Card className="!p-3">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm font-medium text-ink">Show signature</span>
                  <input
                    type="checkbox"
                    className="toggle"
                    checked={showSignature}
                    onChange={(e) => setShowSignature(e.target.checked)}
                  />
                </label>
              </Card>
            </div>
            {(showStamp || showSignature) &&
              (companyStampSig.stamp?.data || companyStampSig.signature?.data) && (
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {showStamp && (form.stamp?.data || companyStampSig.stamp?.data) && (
                    <StampSigAdjust
                      label="Stamp"
                      icon={<Stamp size={13} />}
                      value={form.stamp?.data ? form.stamp : companyStampSig.stamp!}
                      onChange={(v) => setForm({ ...form, stamp: v })}
                    />
                  )}
                  {showSignature &&
                    (form.signature?.data || companyStampSig.signature?.data) && (
                      <StampSigAdjust
                        label="Signature"
                        icon={<PenTool size={13} />}
                        value={
                          form.signature?.data ? form.signature : companyStampSig.signature!
                        }
                        onChange={(v) => setForm({ ...form, signature: v })}
                      />
                    )}
                </div>
              )}
          </Card>
          </div>
        }
        right={
          <div className="sticky top-4 space-y-4">
            
          <Card className="!p-4">
            <div className="no-print flex items-start justify-between mb-3">
              <div>
                <p className="font-medium text-ink">Preview</p>
                <p className="text-xs text-brand-400">
                  This is how your declaration letter will look
                </p>
              </div>
            </div>

            <FitPreview baseWidth={baseWidth} zoom={zoom} padding={0}>
              {/* ponytail: keep declaration preview + PDF English regardless of app lang */}
              <div ref={declRef} data-no-i18n dir="ltr" className="relative">
                <StampSignatureLayer
                  stamp={
                    showStamp
                      ? form.stamp?.data
                        ? form.stamp
                        : (companyStampSig ?? EMPTY_STAMP_SIG).stamp
                      : undefined
                  }
                  signature={
                    showSignature
                      ? form.signature?.data
                        ? form.signature
                        : (companyStampSig ?? EMPTY_STAMP_SIG).signature
                      : undefined
                  }
                  onStampMove={(x, y) => {
                    const base = form.stamp?.data ? form.stamp : companyStampSig.stamp;
                    if (base) setForm({ ...form, stamp: { ...base, x, y } });
                  }}
                  onSignatureMove={(x, y) => {
                    const base = form.signature?.data
                      ? form.signature
                      : companyStampSig.signature;
                    if (base) setForm({ ...form, signature: { ...base, x, y } });
                  }}
                />
                <LetterheadFrame
                  letterhead={lh}
                  enabled={useLetterhead}
                  minHeight={sheetH}
                  headerSpace={headerSpace}
                  footerSpace={footerSpace}
                >
                  <div
                    className="text-neutral-900"
                    style={{
                      fontFamily: "Georgia, 'Times New Roman', serif",
                      lineHeight: 1.7,
                    }}
                  >
                    <h1 className="text-center text-[15px] font-bold underline tracking-wide mb-6">
                      {form.title?.trim() || "DECLARATION LETTER"}
                    </h1>

                    <p className="text-right text-sm font-bold mb-6">
                      {fmtLongDate(form.date)}
                    </p>

                    <div className="text-sm font-bold mb-6 space-y-0.5">
                      <p>{form.recipient_name || "[Recipient Name]"}</p>
                      {form.recipient_location && <p>{form.recipient_location}</p>}
                      {form.recipient_trn && <p>TRN:- {form.recipient_trn}</p>}
                    </div>

                    <p className="text-center text-sm font-bold underline mb-4">
                      Confirmation
                    </p>

                    <div className="text-[13px] text-justify space-y-3">
                      {paragraphs.map((para, i) => (
                        <p key={i}>{para}</p>
                      ))}
                    </div>

                    <div className="mt-8 text-sm">
                      <p>Thanks &amp; Regards</p>
                      <p className="font-bold">{form.company_name}</p>
                    </div>

                    {/* stamp/signature drop zone */}
                    <div className="mt-16 pt-2 border-t border-neutral-300 max-w-[280px]">
                      <p className="text-sm font-bold">
                        Authorized Signatory and company stamp
                      </p>
                    </div>
                  </div>
                </LetterheadFrame>
              </div>
            </FitPreview>

            {/* preview controls */}
            <div className="no-print flex items-center justify-between mt-3 gap-2 flex-wrap">
              <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
                <button
                  className={`rounded p-1.5 cursor-pointer transition-colors ${
                    device === "desktop"
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-hover"
                  }`}
                  onClick={() => setDevice("desktop")}
                  aria-label="Desktop preview"
                >
                  <Monitor size={15} />
                </button>
                <button
                  className={`rounded p-1.5 cursor-pointer transition-colors ${
                    device === "mobile"
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-hover"
                  }`}
                  onClick={() => setDevice("mobile")}
                  aria-label="Mobile preview"
                >
                  <Smartphone size={15} />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-md border border-border p-1.5 text-muted-foreground cursor-pointer hover:bg-hover"
                  onClick={() => setZoom((z) => Math.max(50, z - 10))}
                  aria-label="Zoom out"
                >
                  <Minus size={14} />
                </button>
                <span className="text-xs font-semibold text-brand-500 w-10 text-center">
                  {zoom}%
                </span>
                <button
                  className="rounded-md border border-border p-1.5 text-muted-foreground cursor-pointer hover:bg-hover"
                  onClick={() => setZoom((z) => Math.min(150, z + 10))}
                  aria-label="Zoom in"
                >
                  <Plus size={14} />
                </button>
              </div>
          </div>
          </Card>
          </div>
        }
      />
    </div>
  );
}
