import { useEffect, useRef, useState } from "react";
import {
  Download,
  Save,
  FileText,
  Plus,
  RotateCcw,
  ArrowLeft,
  Stamp,
  PenTool,
  ChevronDown,
  Minus,
} from "lucide-react";
import { MenuPopover, MenuItemRow, MenuSep } from "../components/ui-menu";
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
import {
  pickDocNumber,
  loadDocFormats,
  type DocFormats,
} from "../lib/numberFormat";
import { errMsg, fmtDate, todayYmd } from "../lib/format";
import { PageHeader, Field, DataTable, Card, SearchInput, ErrorBanner } from "../components/ui";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/Tabs";
import { Toggle } from "./settings/PreferencesPanel";
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

const today = () => todayYmd();
const DECLARATION_HEADER_SPACE = 180;

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
  use_letterhead?: boolean;
  header_space?: number;
  footer_space?: number;
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

const letterName = (letter: Pick<DeclForm, "title">) =>
  letter.title?.trim() || "DECLARATION LETTER";

function blankDecl(company?: CompanyProfile | null): DeclForm {
  return {
    title: "DECLARATION LETTER",
    header_space: DECLARATION_HEADER_SPACE,
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
  const rows = await tools.settings();
  const row = rows.find((r) => r.key === STORE_KEY);
  if (!row) return [];
  const arr: unknown = JSON.parse(row.value);
  if (!Array.isArray(arr) || !arr.every((d) => d && typeof d === "object" && typeof d.id === "string" && typeof d.body === "string")) {
    throw new Error("Saved declaration letters could not be read. Restore a valid backup before making changes.");
  }
  return arr as SavedDecl[];
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

// Saved format, loaded once on mount; empty until then, which falls back to
// the built-in DL- scheme.
let dlFormats: DocFormats = {};

/** Next letter reference: the user's format when set, else DL-0001, DL-0002… */
const nextRef = (list: SavedDecl[]) =>
  pickDocNumber(
    "declaration_letter",
    list.map((d) => d.ref || ""),
    dlFormats
  );

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
/*  List page — all created letters; "New letter" opens the editor    */
/* ================================================================== */

export default function DeclarationLetter() {
  const { toast, confirm } = useUI();
  const [docs, setDocs] = useState<SavedDecl[]>([]);
  const [editing, setEditing] = useState<SavedDecl | null>(null);
  const [search, setSearch] = useState("");
  const [quickView, setQuickView] = useState<SavedDecl | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const loadDocs = async () => {
    setLoading(true);
    setLoadError("");
    try {
      setDocs(await listDeclarations());
    } catch (e) {
      setLoadError(errMsg(e));
    } finally {
      setLoading(false);
    }
  };
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
      `${letterName(d)} ${d.ref || d.lpo_ref || ""}`.trim(),
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
      letterName(d).toLowerCase().includes(q) ||
      (d.ref || "").toLowerCase().includes(q) ||
      (d.recipient_name || "").toLowerCase().includes(q) ||
      (d.lpo_ref || "").toLowerCase().includes(q)
  );

  const month = new Date().toISOString().slice(0, 7);
  const thisMonthCount = docs.filter((d) => (d.date || "").slice(0, 7) === month).length;
  const uniqueRecipients = new Set(docs.map((d) => d.recipient_name).filter(Boolean)).size;

  return (
    <div className="">
      <PageHeader
        title="Declaration Letters"
        subtitle="VAT supply declaration letters in the standard UAE format"
        action={
          <button
            className="btn-primary"
            disabled={loading || !!loadError}
            onClick={() =>
              setEditing({
                ...blankDecl(),
                id: newId(),
                ref: nextRef(docs),
                updated_at: "",
              })
            }
          >
            <Plus size={16} /> New letter
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SearchInput
          className="w-full sm:max-w-sm"
          placeholder="Search by name, recipient or reference…"
          value={search}
          onChange={setSearch}
        />
        {!loading && !loadError && (
          <p className="text-xs text-muted-foreground">
            {docs.length} {docs.length === 1 ? "letter" : "letters"} · {thisMonthCount} this month · {uniqueRecipients} {uniqueRecipients === 1 ? "recipient" : "recipients"}
          </p>
        )}
      </div>

      {loadError && <div className="mb-4 space-y-2"><ErrorBanner message={loadError} /><button className="btn-ghost" disabled={loading} onClick={() => void loadDocs()}>Retry</button></div>}
      <DataTable<SavedDecl>
        loading={loading}
        pageSize={10}
        rows={filtered}
        empty={
          search
            ? "No letters match your search"
            : "No declaration letters yet - create your first one"
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
            label: "Letter / reference",
            sortValue: (d) => letterName(d),
            render: (d) => (
              <div className="min-w-0">
                <span className="block font-medium break-words">{letterName(d)}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{d.ref || d.lpo_ref || "No reference"}</span>
              </div>
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
                title: letterName(quickView),
                subtitle: quickView.recipient_name
                  ? `For ${quickView.recipient_name}`
                  : "VAT supply declaration in the standard UAE format",
                meta: [
                  { label: "Reference", value: quickView.ref },
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
                      Letter text
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
  const { toast, confirm } = useUI();
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [supplierList, setSupplierList] = useState<Supplier[]>([]);
  const [customerList, setCustomerList] = useState<CrmCustomer[]>([]);
  const [form, setForm] = useState<DeclForm>(() => {
    const { id: _id, updated_at: _u, ...rest } = doc;
    // Letters saved before the title field existed default to the old heading.
    return { ...rest, title: rest.title ?? "DECLARATION LETTER" };
  });
  const [lh, setLh] = useState<LetterheadInfo>(EMPTY_LETTERHEAD);
  const [useLetterhead, setUseLetterhead] = useState(doc.use_letterhead ?? false);
  const [headerSpace, setHeaderSpace] = useState(doc.header_space ?? DEFAULT_HEADER_SPACE);
  const [footerSpace, setFooterSpace] = useState(doc.footer_space ?? DEFAULT_FOOTER_SPACE);
  const [companyStampSig, setCompanyStampSig] = useState<CompanyStampSig>(EMPTY_STAMP_SIG);
  const [showStamp, setShowStamp] = useState(form.show_stamp ?? false);
  const [showSignature, setShowSignature] = useState(form.show_signature ?? false);
  const [zoom, setZoom] = useState(100);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const [isNew, setIsNew] = useState(!doc.updated_at);
  const declRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Number format first, so a letter opened straight away still numbers the
    // user's way rather than falling back to DL-0001.
    loadDocFormats()
      .then((f) => {
        dlFormats = f;
      })
      .catch(() => {});
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
        setUseLetterhead(doc.use_letterhead ?? hasLetterhead(l));
      })
      .catch(() => {});
    loadCompanyStampSig().then(setCompanyStampSig).catch(() => {});
    suppliersApi.list().then(setSupplierList).catch(() => {});
    crm.customers().then(setCustomerList).catch(() => {});
  }, [doc.use_letterhead]);

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
    setForm((f) => ({ ...f, [k]: v }));

  const sheetEl = () => {
    const el =
      (declRef.current?.closest(".invoice-print") as HTMLElement) || declRef.current;
    // The preview root carries floating stamp/signature layers as extra child
    // divs — mark it so the exporter never splits them into junk pages.
    if (el) el.dataset.pdfSingle = "true";
    return el;
  };

  const baseName = () =>
    [letterName(form), form.lpo_ref || form.ref || form.recipient_name || "letter"]
      .map((part) => part.replace(/[^\p{L}\p{M}\p{N}._-]+/gu, "_").slice(0, 60))
      .join("-")
      .replace(/\.+$/, "");

  const downloadPdf = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const el = sheetEl();
      if (!el) throw new Error("The letter preview is not ready. Please try again.");
      await downloadElementAsPdf(el, baseName());
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setDownloading(false);
    }
  };

  const handleSave = async () => {
    if (saving) return;
    const el = sheetEl();
    setSaving(true);
    try {
      // Persist the letter to the list (reopenable, cross-device)…
      const saved: SavedDecl = {
        ...form,
        id: doc.id,
        updated_at: new Date().toISOString(),
        show_stamp: showStamp,
        show_signature: showSignature,
        use_letterhead: useLetterhead,
        header_space: headerSpace,
        footer_space: footerSpace,
      };
      const list = await upsertDeclaration(saved);
      onSaved(list);
      setIsNew(false);
      // …and archive a PDF copy to My Files (best-effort).
      const base = baseName();
      try {
        if (el) await autoSaveDocument(`${base}.pdf`, "declaration", () =>
          elementToPdfBytes(el, base)
        );
        toast.success("Letter saved.");
      } catch {
        toast.error("Letter saved, but the PDF copy could not be added to My Files. You can still download it.");
      }
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  // Preview zoom changes the view, never the A4 layout used for PDF export.
  const baseWidth = 794;
  const sheetH = 1123;
  const paragraphs = resolveBody(form).split(/\n{2,}/);

  return (
    <div>
      <PageHeader
        title={letterName(form) === "DECLARATION LETTER" ? (isNew ? "New declaration letter" : "Declaration letter") : letterName(form)}
        subtitle="Add the details, review the wording, and download your letter."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-ghost" disabled={saving || downloading} onClick={onBack}>
              <ArrowLeft size={15} /> Back
            </button>
            <button className="btn-ghost" onClick={downloadPdf} disabled={downloading || saving}>
              <Download size={15} /> {downloading ? "Exporting…" : "Download PDF"}
            </button>
            <button className="btn-primary" onClick={handleSave} disabled={saving || downloading}>
              <Save size={15} /> {saving ? "Saving…" : "Save"}
            </button>
          </div>
        }
      />

      <ResizablePanels
        defaultRightWidth={400}
        minRightWidth={300}
        left={
          <Card className="!p-0 overflow-hidden">
            <fieldset disabled={saving || downloading} className="min-w-0">
              <Tabs defaultValue="details">
                <TabsList aria-label="Letter editor" className="flex w-full px-2 sm:px-4 pt-1">
                  <TabsTrigger value="details" className="min-h-11">Details</TabsTrigger>
                  <TabsTrigger value="wording" className="min-h-11">Letter text</TabsTrigger>
                  <TabsTrigger value="appearance" className="min-h-11">Appearance</TabsTrigger>
                </TabsList>

                <TabsContent value="details" className="!mt-0 divide-y divide-border">
                  <section className="p-4 sm:p-5 space-y-3" aria-labelledby="declaration-details">
                    <h2 id="declaration-details" className="text-sm font-semibold text-foreground">Letter details</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Field label="Reference">
                        <input className="input" placeholder="DL-0001" value={form.ref} onChange={(e) => set("ref", e.target.value)} />
                      </Field>
                      <Field label="Date">
                        <DateField value={form.date} onChange={(v) => set("date", v)} clearable={false} />
                      </Field>
                    </div>
                    <Field label="Letter name">
                      <input className="input" placeholder="e.g. Authorization letter" aria-describedby="declaration-name-hint" value={form.title ?? ""} onChange={(e) => set("title", e.target.value)} />
                    </Field>
                    <p id="declaration-name-hint" className="text-xs text-muted-foreground">Shown on your letter, in saved letters, and in the PDF filename.</p>
                  </section>

                  <section className="p-4 sm:p-5 space-y-3" aria-labelledby="declaration-company">
                    <h2 id="declaration-company" className="text-sm font-semibold text-foreground">Your company</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Field label="Company name">
                        <input className="input" value={form.company_name} onChange={(e) => set("company_name", e.target.value)} />
                      </Field>
                      <Field label="Company TRN">
                        <input className="input" placeholder="Tax registration number" value={form.company_trn} onChange={(e) => set("company_trn", e.target.value)} />
                      </Field>
                    </div>
                  </section>

                  <section className="p-4 sm:p-5 space-y-3" aria-labelledby="declaration-recipient">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 id="declaration-recipient" className="text-sm font-semibold text-foreground">Recipient</h2>
                      {(supplierList.length > 0 || customerList.length > 0) && (
                        <RecipientFillMenu suppliers={supplierList} customers={customerList} onPick={fillRecipient} />
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Field label="Recipient name">
                        <input className="input" placeholder="Supplier or customer name" value={form.recipient_name} onChange={(e) => set("recipient_name", e.target.value)} />
                      </Field>
                      <Field label="Recipient TRN">
                        <input className="input" placeholder="Tax registration number" value={form.recipient_trn} onChange={(e) => set("recipient_trn", e.target.value)} />
                      </Field>
                      <div className="sm:col-span-2">
                        <Field label="Recipient address">
                          <input className="input" placeholder="City, region and country" value={form.recipient_location} onChange={(e) => set("recipient_location", e.target.value)} />
                        </Field>
                      </div>
                    </div>
                  </section>

                  <section className="p-4 sm:p-5 space-y-3" aria-labelledby="declaration-order">
                    <h2 id="declaration-order" className="text-sm font-semibold text-foreground">Order details</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Field label="LPO number">
                        <input className="input" placeholder="Purchase order reference" value={form.lpo_ref} onChange={(e) => set("lpo_ref", e.target.value)} />
                      </Field>
                      <Field label="Amount (AED)">
                        <input className="input tabular-nums" inputMode="decimal" placeholder="0.00" value={form.amount} onChange={(e) => set("amount", e.target.value)} />
                      </Field>
                      <Field label="Quantity">
                        <input className="input tabular-nums" inputMode="decimal" placeholder="0" value={form.qty} onChange={(e) => set("qty", e.target.value)} />
                      </Field>
                      <Field label="Unit">
                        <input className="input" placeholder="e.g. MT" value={form.unit} onChange={(e) => set("unit", e.target.value)} />
                      </Field>
                    </div>
                  </section>
                </TabsContent>

                <TabsContent value="wording" className="!mt-0 p-4 sm:p-5 space-y-4">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">Make the wording your own</h2>
                    <p id="declaration-wording-help" className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Edit the letter below. Fields in braces fill from Details and update in the preview.
                    </p>
                  </div>
                  <Field label="Letter text">
                    <textarea
                      className="textarea text-sm leading-relaxed min-h-80"
                      aria-describedby="declaration-wording-help"
                      rows={18}
                      value={form.body}
                      onChange={(e) => set("body", e.target.value)}
                    />
                  </Field>
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer py-2 font-medium text-foreground">Available automatic fields</summary>
                    <div className="flex flex-wrap gap-2 pt-2">
                      {["company", "trn", "recipient", "recipientTrn", "lpo", "qty", "unit", "amount"].map((token) => (
                        <code key={token} className="rounded-md bg-muted px-2 py-1">{"{" + token + "}"}</code>
                      ))}
                    </div>
                  </details>
                </TabsContent>

                <TabsContent value="appearance" className="!mt-0 p-4 sm:p-5">
                  <h2 className="text-sm font-semibold text-foreground">Letter appearance</h2>
                  <p className="mt-1 text-xs text-muted-foreground">Choose which company assets appear on this letter.</p>
                  <div className="mt-4 divide-y divide-border">
                    <label className="flex items-center justify-between gap-4 py-4 cursor-pointer">
                      <span className="flex min-w-0 items-start gap-3">
                        <FileText size={17} className="mt-0.5 shrink-0 text-muted-foreground" />
                        <span>
                          <span className="block text-sm font-medium text-foreground">Use letterhead</span>
                          <span className="mt-1 block text-xs text-muted-foreground">{hasLetterhead(lh) ? "Use your company’s saved letterhead." : "Add a letterhead in Settings → Company Details."}</span>
                        </span>
                      </span>
                      <Toggle label="Use letterhead" on={useLetterhead} disabled={!hasLetterhead(lh)} onChange={setUseLetterhead} />
                    </label>
                    {useLetterhead && hasLetterhead(lh) && (
                      <div className="grid grid-cols-2 gap-3 py-4">
                        <Field label="Header space (px)">
                          <input type="number" min={0} step={10} className="input tabular-nums" value={headerSpace} onChange={(e) => setHeaderSpace(Math.max(0, Number(e.target.value) || 0))} />
                        </Field>
                        <Field label="Footer space (px)">
                          <input type="number" min={0} step={10} className="input tabular-nums" value={footerSpace} onChange={(e) => setFooterSpace(Math.max(0, Number(e.target.value) || 0))} />
                        </Field>
                      </div>
                    )}
                    <label className="flex items-center justify-between gap-4 py-4 cursor-pointer">
                      <span className="flex min-w-0 items-start gap-3">
                        <Stamp size={17} className="mt-0.5 shrink-0 text-muted-foreground" />
                        <span>
                          <span className="block text-sm font-medium text-foreground">Show stamp</span>
                          <span className="mt-1 block text-xs text-muted-foreground">{form.stamp?.data || companyStampSig.stamp?.data ? "Position your stamp directly on the preview." : "Add a stamp in Settings → Company Details."}</span>
                        </span>
                      </span>
                      <Toggle label="Show stamp" disabled={!form.stamp?.data && !companyStampSig.stamp?.data} on={showStamp} onChange={(on) => { setShowStamp(on); if (on && !form.stamp?.data && companyStampSig.stamp?.data) set("stamp", { ...companyStampSig.stamp, opacity: 100 }); }} />
                    </label>
                    <label className="flex items-center justify-between gap-4 py-4 cursor-pointer">
                      <span className="flex min-w-0 items-start gap-3">
                        <PenTool size={17} className="mt-0.5 shrink-0 text-muted-foreground" />
                        <span>
                          <span className="block text-sm font-medium text-foreground">Show signature</span>
                          <span className="mt-1 block text-xs text-muted-foreground">{form.signature?.data || companyStampSig.signature?.data ? "Position your signature directly on the preview." : "Add a signature in Settings → Company Details."}</span>
                        </span>
                      </span>
                      <Toggle label="Show signature" disabled={!form.signature?.data && !companyStampSig.signature?.data} on={showSignature} onChange={(on) => { setShowSignature(on); if (on && !form.signature?.data && companyStampSig.signature?.data) set("signature", { ...companyStampSig.signature, opacity: 100 }); }} />
                    </label>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {showStamp && (form.stamp?.data || companyStampSig.stamp?.data) && (
                      <StampSigAdjust label="Stamp" icon={<Stamp size={13} />} value={form.stamp?.data ? form.stamp : companyStampSig.stamp!} onChange={(v) => set("stamp", v)} />
                    )}
                    {showSignature && (form.signature?.data || companyStampSig.signature?.data) && (
                      <StampSigAdjust label="Signature" icon={<PenTool size={13} />} value={form.signature?.data ? form.signature : companyStampSig.signature!} onChange={(v) => set("signature", v)} />
                    )}
                  </div>
                </TabsContent>
              </Tabs>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 sm:px-5 py-3">
                <p className="text-xs text-muted-foreground">Changes are stored when you save.</p>
                <button type="button" className="btn-ghost text-xs" onClick={async () => {
                  if (await confirm({ title: "Reset this letter?", message: "This clears your unsaved edits. The saved letter stays unchanged until you save again.", confirmLabel: "Reset" })) {
                    setForm({ ...blankDecl(company), ref: form.ref });
                    setShowStamp(false);
                    setShowSignature(false);
                    setUseLetterhead(hasLetterhead(lh));
                    setHeaderSpace(DECLARATION_HEADER_SPACE);
                    setFooterSpace(DEFAULT_FOOTER_SPACE);
                  }
                }}>
                  <RotateCcw size={14} /> Reset draft
                </button>
              </div>
            </fieldset>
          </Card>
        }
        right={
          <Card className="!p-4">
            <div className="no-print mb-4 pr-12">
              <h2 className="text-sm font-semibold text-foreground">Live preview</h2>
              <p className="mt-1 text-xs text-muted-foreground">A4 portrait · 210 × 297 mm</p>
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
                    <h1 className="text-center text-[15px] font-bold underline tracking-wide mb-6 break-words">
                      {letterName(form)}
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

            <div className="no-print mt-3 flex flex-wrap items-center justify-between gap-2" role="group" aria-label="Document preview controls">
              <button type="button" className="btn-ghost text-xs" onClick={() => setZoom(100)}>Fit to panel</button>
              <div className="flex items-center gap-1">
                <button type="button" className="btn-ghost h-10 w-10 p-0" aria-label="Zoom out" disabled={zoom <= 50} onClick={() => setZoom(Math.max(50, zoom - 10))}><Minus size={16} /></button>
                <output className="w-10 text-center text-xs tabular-nums text-muted-foreground" aria-label="Preview zoom level">{zoom}%</output>
                <button type="button" className="btn-ghost h-10 w-10 p-0" aria-label="Zoom in" disabled={zoom >= 150} onClick={() => setZoom(Math.min(150, zoom + 10))}><Plus size={16} /></button>
              </div>
            </div>
          </Card>
        }
      />
    </div>
  );
}

/** Auto-fill picker for the recipient block — the shared menu primitive with
 *  Suppliers / Buyers groups instead of an optgroup <select>. Always shows the
 *  placeholder label because picking is an action, not a persisted value. */
function RecipientFillMenu({
  suppliers,
  customers,
  onPick,
}: {
  suppliers: Supplier[];
  customers: CrmCustomer[];
  onPick: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        type="button"
        ref={btnRef}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="btn-ghost text-xs"
      >
        <span className="min-w-0 flex-1 truncate text-left">
          Choose saved recipient
        </span>
        <ChevronDown size={13} className="shrink-0 text-muted-foreground" />
      </button>
      <MenuPopover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={btnRef}
        closeOnScroll
        className="max-h-72 overflow-y-auto"
      >
        {suppliers.length > 0 && (
          <>
            <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-muted-foreground">
              Suppliers
            </div>
            {suppliers.map((s) => (
              <MenuItemRow
                key={`s${s.id}`}
                label={s.name}
                onClick={() => {
                  onPick(`s:${s.id}`);
                  setOpen(false);
                }}
              />
            ))}
          </>
        )}
        {suppliers.length > 0 && customers.length > 0 && <MenuSep />}
        {customers.length > 0 && (
          <>
            <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-muted-foreground">
              Buyers (Customers)
            </div>
            {customers.map((c) => (
              <MenuItemRow
                key={`c${c.id}`}
                label={c.company || c.name}
                onClick={() => {
                  onPick(`c:${c.id}`);
                  setOpen(false);
                }}
              />
            ))}
          </>
        )}
      </MenuPopover>
    </>
  );
}
