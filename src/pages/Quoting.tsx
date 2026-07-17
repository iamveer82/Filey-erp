import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
  Send,
  Monitor,
  Smartphone,
  Minus,
  Settings,
  StickyNote,
  Stamp,
  PenTool,
  Paperclip,
  Landmark,
  SeparatorHorizontal,
  Maximize2,
  FileText,
  PackageSearch,
} from "lucide-react";
import {
  billing,
  crm,
  erp,
  quotes,
  QuotationSummary,
  QuotationInput,
  QuotationItem,
  CompanyProfile,
  CrmCustomer,
  Product,
} from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { useUI } from "../lib/ui";
import { fmtDate, money, num, numInput, CURRENCIES, errMsg } from "../lib/format";
import { nextDocNumber } from "../lib/docNumber";
import { sendEmail, emailShell, esc } from "../lib/email";
import FitPreview from "../components/FitPreview";
import { downloadElementAsPdf, elementToPdfBytes } from "../lib/pdfTools";
import { autoSaveDocument } from "../lib/files";
import ColorPicker from "../components/ColorPicker";
import {
  docLineAmount,
  docTotals,
  paginateItems,
  splitPageBreak,
  mergePageBreak,
  PB_KEY,
  sanitizeCustomColumns,
  RESERVED_ITEM_COLUMNS,
  DEFAULT_COLUMN_LABELS,
  type DocItem,
} from "../lib/docItems";
import {
  PageHeader,
  MetricCard,
  DataTable,
  Badge,
  statusTone,
  Modal,
  Field,
  ShareToggle,
  SearchInput,
} from "../components/ui";
import { DateField } from "../components/DatePicker";
import DocView, { type DocViewItem } from "../components/DocView";
import DocTemplateGallery from "../components/DocTemplateGallery";
import { ResizablePanels } from "../components/ResizablePanels";
import {
  StampSignatureLayer,
  StampSigAdjust,
  DraggableBlock,
  type StampSig,
} from "../components/StampSignature";
import {
  BankDetailsBlock,
  loadBankInfo,
  EMPTY_BANK,
  type BankInfo,
} from "../components/BankDetails";
import {
  loadCompanyStampSig,
  EMPTY_STAMP_SIG,
  type CompanyStampSig,
} from "../components/StampSignatureSettings";
import TemplateDesigner, { syncCustomTemplates } from "../components/TemplateDesigner";

type CustomColumn = { key: string; label: string };

type Item = QuotationItem & { pageBreakBefore?: boolean };

type Form = Omit<QuotationInput, "items" | "custom_columns" | "doc_type"> & {
  items: Item[];
  customColumns: CustomColumn[];
  stamp?: StampSig;
  signature?: StampSig;
  show_stamp?: boolean;
  show_signature?: boolean;
  unit_price_formula?: { a: string; b: string } | null;
};

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (n: number) =>
  new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

function blankForm(c: CompanyProfile, existing: string[] = []): Form {
  return {
    number: nextDocNumber({ prefix: "QT", existing }),
    status: "draft",
    doc_title: "Quotation",
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
    quote_date: today(),
    valid_until: addDays(30),
    sales_person: "",
    notes: "",
    terms:
      "1. This quotation is valid until the date mentioned above.\n2. Prices are subject to applicable taxes.\n3. Payment terms as agreed.",
    discount: 0,
    tax_rate: 0,
    items: [
      {
        product: "",
        sku: "",
        qty: 1,
        rate: 0,
        discount: 0,
        tax: 0,
        unit: "",
        custom: {},
        pageBreakBefore: false,
      },
    ],
    customColumns: [],
    show_stamp: false,
    show_signature: false,
    unit_price_formula: null,
  };
}

const asDocItem = (it: Item): DocItem => ({
  description: it.product,
  unit_price: it.rate,
  qty: it.qty,
  unit: it.unit,
  custom: it.custom,
  discount: it.discount,
  tax: it.tax,
  pageBreakBefore: it.pageBreakBefore,
});

const totals = (f: Form) =>
  docTotals(f.items.map(asDocItem), f.discount || 0, f.tax_rate || 0, f.unit_price_formula);

export default function Quoting() {
  const { toast, confirm } = useUI();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [docs, setDocs] = useState<QuotationSummary[]>([]);
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);

  const [companyOpen, setCompanyOpen] = useState(false);
  const [custModal, setCustModal] = useState(false);
  const [invModal, setInvModal] = useState(false);

  const loadDocs = () =>
    quotes
      .listDocs()
      .then(setDocs)
      .catch(() => toast.error("Failed to load quotations"));
  const loadCustomers = () =>
    crm
      .customers()
      .then(setCustomers)
      .catch(() => toast.error("Failed to load customers"));

  const reload = () => {
    billing
      .getCompany()
      .then(setCompany)
      .catch(() => toast.error("Failed to load company profile"));
    loadDocs();
    loadCustomers();
  };

  useEffect(reload, []);
  useLiveSync(reload);

  // Deep-link: ?new=1 opens a blank quotation once company loads.
  useEffect(() => {
    if (params.get("new") === "1" && company && !form) {
      setForm(blankForm(company, docs.map((d) => d.number)));
      setParams({}, { replace: true });
    }
  }, [params, company, form, setParams, docs]);

  const newQuote = () => {
    if (company) setForm(blankForm(company, docs.map((d) => d.number)));
  };

  const editQuote = async (id: number) => {
    try {
      const d = await quotes.getDoc(id);
      setForm({
        ...d,
        id: d.id,
        number: d.number,
        status: d.status,
        doc_title: d.doc_title || "Quotation",
        template: d.template,
        accent: d.accent,
        currency: d.currency,
        seller_name: d.seller_name,
        seller_address: d.seller_address,
        seller_trn: d.seller_trn,
        seller_email: d.seller_email,
        seller_phone: d.seller_phone,
        logo: d.logo,
        customer_id: d.customer_id,
        customer_name: d.customer_name,
        customer_address: d.customer_address,
        customer_trn: d.customer_trn,
        customer_email: d.customer_email,
        quote_date: d.quote_date,
        valid_until: d.valid_until,
        sales_person: d.sales_person,
        notes: d.notes,
        terms: d.terms,
        discount: d.discount ?? 0,
        tax_rate: d.tax_rate ?? 0,
        items: d.items.map((i) => {
          const { custom, pageBreakBefore } = splitPageBreak(i.custom);
          return { ...i, custom, pageBreakBefore };
        }),
        customColumns: sanitizeCustomColumns(d.custom_columns || []),
        show_stamp: d.show_stamp ?? false,
        show_signature: d.show_signature ?? false,
        unit_price_formula: d.unit_price_formula || null,
      });
    } catch (e: any) {
      toast.error(e?.message || "Failed to load quotation");
    }
  };

  const duplicateQuote = async (id?: number) => {
    try {
      const newBase = {
        number: nextDocNumber({ prefix: "QT", existing: docs.map((x) => x.number) }),
        status: "draft" as const,
        quote_date: today(),
        valid_until: addDays(30),
      };
      if (id) {
        const d = await quotes.getDoc(id);
        setForm({
          ...d,
          ...newBase,
          id: undefined,
          items: d.items.map((i) => {
            const { custom, pageBreakBefore } = splitPageBreak(i.custom);
            return { ...i, custom, pageBreakBefore };
          }),
          customColumns: sanitizeCustomColumns(d.custom_columns || []),
          show_stamp: d.show_stamp ?? false,
          show_signature: d.show_signature ?? false,
          unit_price_formula: d.unit_price_formula || null,
        });
      } else if (form) {
        setForm({
          ...form,
          ...newBase,
          id: undefined,
          stamp: form.stamp,
          signature: form.signature,
        });
      }
      toast.success("Duplicated into a new draft quotation.");
    } catch (e: any) {
      toast.error(e?.message || "Failed to duplicate quotation");
    }
  };

  const commit = async (targetStatus?: string) => {
    if (!form) return;
    if (!form.number.trim()) {
      toast.error("Quotation number is required");
      return;
    }
    if (!form.items.length || form.items.every((i) => !i.product.trim())) {
      toast.error("Add at least one line item with a description");
      return;
    }
    if (!form.customer_name.trim()) {
      toast.error("Customer name is required");
      return;
    }
    if (docs.some((d) => d.number === form.number && d.id !== (form.id || 0))) {
      toast.error(`Quotation number "${form.number}" already exists.`);
      return;
    }

    setSaving(true);
    try {
      const payload: any = {
        ...form,
        status: targetStatus ?? form.status,
        custom_columns: sanitizeCustomColumns(form.customColumns),
        items: form.items.map((it) => ({
          product: it.product,
          sku: it.sku,
          product_id: it.product_id,
          qty: it.qty,
          rate: it.rate,
          discount: it.discount,
          tax: it.tax,
          unit: it.unit,
          custom: mergePageBreak(it as unknown as DocItem),
        })),
        quote_date: form.quote_date || undefined,
        valid_until: form.valid_until || undefined,
      };
      delete payload.customColumns;
      delete payload.doc_type;
      payload.show_stamp = form.show_stamp ?? false;
      payload.show_signature = form.show_signature ?? false;
      payload.discount = form.discount || 0;
      payload.tax_rate = form.tax_rate || 0;

      const id = await quotes.saveDoc(payload as QuotationInput);
      const next = { ...form, id, status: targetStatus ?? form.status };
      setForm(next);
      await loadDocs();

      // Auto-archive the quotation PDF to My Files (best-effort, deduped).
      try {
        const el = exportRef.current || quoteRef.current;
        if (el) {
          const base = form.number || "quotation";
          const saved = await autoSaveDocument(`${base}.pdf`, "quotation", () =>
            elementToPdfBytes(el, base)
          );
          if (saved) toast.success("Saved a copy to My Files.");
        }
      } catch {
        /* archiving is a convenience — never block save */
      }

      toast.success(targetStatus ? `Quotation marked as ${targetStatus}.` : "Quotation saved.");
      return id;
    } catch (e) {
      toast.error(`Could not save: ${errMsg(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const quoteRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  const filteredDocs = search
    ? docs.filter(
        (d) =>
          d.number.toLowerCase().includes(search.toLowerCase()) ||
          d.customer_name.toLowerCase().includes(search.toLowerCase())
      )
    : docs;

  const statCcy = company?.currency || "AED";
  const totalValue = docs.reduce((s, d) => s + (d.total || 0), 0);
  const sentCount = docs.filter((d) => d.status === "sent").length;
  const acceptedCount = docs.filter((d) => d.status === "accepted").length;

  // Editor-only state/effects, hoisted to the component top level so these
  // hooks run unconditionally on every render (React rules-of-hooks) instead of
  // inside `if (form)`, which changed the hook count when the editor opened and
  // could crash it. The editor JSX below reads this state from here.
  const [showBank, setShowBank] = useState(false);
  const [bank, setBank] = useState<BankInfo>(EMPTY_BANK);
  const [companyStampSig, setCompanyStampSig] = useState<CompanyStampSig>(EMPTY_STAMP_SIG);
  const [bankX, setBankX] = useState(50);
  const [bankY, setBankY] = useState(93);
  const [zoom, setZoom] = useState(100);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [viewOpen, setViewOpen] = useState(false);
  const [viewPage, setViewPage] = useState(1);
  const [previewPage, setPreviewPage] = useState(1);
  const [designing, setDesigning] = useState(false);
  const [tplNonce, setTplNonce] = useState(0);
  const [viewAll, setViewAll] = useState(false);

  useEffect(() => {
    loadBankInfo().then(setBank).catch(() => {});
    loadCompanyStampSig().then(setCompanyStampSig).catch(() => {});
    loadCustomers();
  }, []);

  useEffect(() => {
    setPreviewPage(1);
  }, [form?.items.length]);

  useEffect(() => {
    if (viewOpen) setViewPage(1);
  }, [viewOpen]);

  useEffect(() => {
    if (!viewOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewOpen]);

  const downloadPdf = () => {
    const el = exportRef.current || quoteRef.current;
    if (el) downloadElementAsPdf(el, form?.number || "quotation");
    else window.print();
  };

  // Editor keyboard shortcuts (no-op unless a quote is open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!form) return;
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        commit();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "p") {
        e.preventDefault();
        downloadPdf();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (form) {
    const m = (v: number) => money(v, form.currency || "AED");
    const set = <K extends keyof Form>(k: K, v: Form[K]) =>
      setForm({ ...form, [k]: v });
    const setItem = (idx: number, patch: Partial<Item>) => {
      const items = form.items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
      setForm({ ...form, items });
    };
    const addItem = () =>
      setForm({
        ...form,
        items: [
          ...form.items,
          {
            product: "",
            sku: "",
            qty: 1,
            rate: 0,
            discount: 0,
            tax: 0,
            unit: "",
            custom: {},
            pageBreakBefore: false,
          },
        ],
      });
    const removeItem = (idx: number) =>
      setForm({ ...form, items: form.items.filter((_, i) => i !== idx) });
    const setItemCustom = (idx: number, key: string, value: string) => {
      if (key === PB_KEY) return;
      const items = form.items.map((it, i) =>
        i === idx ? { ...it, custom: { ...it.custom, [key]: value } } : it
      );
      setForm({ ...form, items });
    };

    const addCustomColumn = () => {
      const label = window.prompt("Column name:")?.trim();
      if (!label) return;
      const key =
        label
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_|_$/g, "") || `col_${Date.now()}`;
      if (key === PB_KEY || RESERVED_ITEM_COLUMNS.has(key)) {
        toast.error("That name is reserved or already a default column.");
        return;
      }
      if (
        DEFAULT_COLUMN_LABELS.has(label.toLowerCase()) ||
        form.customColumns.some((c) => c.key === key || c.label.toLowerCase() === label.toLowerCase())
      ) {
        toast.error("A column with that name or key already exists.");
        return;
      }
      setForm({ ...form, customColumns: [...form.customColumns, { key, label }] });
    };

    const removeCustomColumn = (key: string) => {
      setForm({
        ...form,
        customColumns: form.customColumns.filter((c) => c.key !== key),
        items: form.items.map((it) => {
          const c = { ...it.custom };
          delete c[key];
          return { ...it, custom: c };
        }),
      });
    };

    const applyCustomer = (c: CrmCustomer) =>
      setForm({
        ...form,
        customer_id: c.id,
        customer_name: c.company || c.name || "",
        customer_address: c.address ?? "",
        customer_email: c.email ?? "",
        customer_trn:
          c.trn ?? (c.segment?.startsWith("TRN:") ? c.segment.slice(4).trim() : form.customer_trn),
      });

    const addItemFromProduct = (p: Product) => {
      const desc = [p.name, p.description?.trim()].filter(Boolean).join(" — ");
      setForm({
        ...form,
        items: [
          ...form.items.filter((it) => it.product.trim() || it.rate),
          {
            product: desc,
            sku: p.sku,
            qty: 1,
            rate: p.unit_price,
            discount: 0,
            tax: 0,
            unit: p.unit || "",
            custom: {},
            product_id: p.id,
          },
        ],
      });
    };

    const pages = paginateItems(form.items as unknown as DocItem[]);
    const previewPages = pages.length;
    const curPageIdx = Math.min(previewPage, previewPages) - 1;
    const pageStartIndex = pages
      .slice(0, curPageIdx)
      .reduce((n, g) => n + g.length, 0);
    const isLastPreviewPage = curPageIdx === previewPages - 1;

    const viewPages = paginateItems(form.items as unknown as DocItem[]);
    const viewPageCount = viewPages.length;
    const viewPageIdx = Math.min(viewPage, viewPageCount) - 1;
    const viewPageStart = viewPages
      .slice(0, viewPageIdx)
      .reduce((n, g) => n + g.length, 0);
    const isLastViewPage = viewPageIdx === viewPageCount - 1;

    const emailQuote = async () => {
      if (!form.customer_email) {
        toast.error("Add a customer email to send this quotation.");
        return;
      }
      const t = totals(form);
      let portalUrl = "";
      try {
        if (form.id) {
          const token = await quotes.publicLink(form.id);
          portalUrl = `${location.origin}${location.pathname}#/portal/${token}`;
        }
      } catch {
        /* link optional */
      }
      try {
        await sendEmail({
          to: form.customer_email,
          subject: `Quotation ${form.number} from ${form.seller_name}`,
          html: emailShell(
            `Quotation ${form.number}`,
            `<p>Dear ${esc(form.customer_name || "customer")},</p>
             <p>Please find your quotation <b>${esc(form.number)}</b>, valid until ${esc(
               form.valid_until || ""
             )}.</p>
             <table style="width:100%;font-size:14px;margin:12px 0">
               <tr><td>Subtotal</td><td style="text-align:right">${m(t.subtotal)}</td></tr>
               ${
                 t.discount
                   ? `<tr><td>Discount</td><td style="text-align:right">-${m(t.discount)}</td></tr>`
                   : ""
               }
               ${
                 t.tax
                   ? `<tr><td>Tax</td><td style="text-align:right">${m(t.tax)}</td></tr>`
                   : ""
               }
               <tr><td><b>Total</b></td><td style="text-align:right"><b>${m(t.total)}</b></td></tr>
             </table>
             ${
               portalUrl
                 ? `<p style="margin:16px 0"><a href="${portalUrl}" style="background:#FFD600;color:#0A0A0A;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:700;display:inline-block">View online</a></p>`
                 : ""
             }
             <p>${esc(form.notes ?? "")}</p>
             <p>${esc(form.terms ?? "")}</p>`
          ),
        });
        toast.success(`Quotation emailed to ${form.customer_email}`);
      } catch (e) {
        toast.error(errMsg(e));
      }
    };

    const copyPublicLink = async () => {
      if (!form.id) {
        toast.error("Save the quotation before copying a public link.");
        return;
      }
      try {
        const token = await quotes.publicLink(form.id);
        const url = `${location.origin}${location.pathname}#/portal/${token}`;
        await navigator.clipboard.writeText(url);
        toast.success("Public quotation link copied");
      } catch (e) {
        toast.error(errMsg(e));
      }
    };

    const toggleShared = async () => {
      if (!form.id) {
        toast.error("Save the quotation before sharing.");
        return;
      }
      try {
        await quotes.shareDoc(form.id, !form.shared);
        setForm({ ...form, shared: !form.shared });
        loadDocs();
        toast.success(form.shared ? "Set to private." : "Shared with team.");
      } catch (e) {
        toast.error(errMsg(e));
      }
    };

    const convertToInvoice = async () => {
      if (!form.id) {
        toast.error("Save the quotation before converting to an invoice.");
        return;
      }
      setConverting(true);
      try {
        await quotes.convertToInvoice(form.id);
        toast.success("Invoice created from quotation.");
        navigate("/invoicing");
      } catch (e) {
        toast.error(`Could not convert: ${errMsg(e)}`);
      } finally {
        setConverting(false);
      }
    };

    const docViewForm = {
      ...form,
      items: form.items.map(
        (it): DocViewItem => ({
          description: it.product,
          qty: it.qty,
          unit_price: it.rate,
          unit: it.unit,
          custom: it.custom,
          discount: it.discount,
          tax: it.tax,
        })
      ),
      issue_date: form.quote_date,
      due_date: form.valid_until,
      customColumns: form.customColumns,
    };

    return (
      <>
        {company && (
          <CompanyModal
            open={companyOpen}
            company={company}
            onClose={() => setCompanyOpen(false)}
            onSaved={(c) => {
              setCompany(c);
              setForm((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  seller_name: c.name,
                  seller_address: c.address ?? prev.seller_address,
                  seller_trn: c.trn ?? prev.seller_trn,
                  seller_email: c.email ?? prev.seller_email,
                  seller_phone: c.phone ?? prev.seller_phone,
                  logo: c.logo ?? prev.logo,
                };
              });
              setCompanyOpen(false);
            }}
          />
        )}

        <CustomerModal
          open={custModal}
          onClose={() => setCustModal(false)}
          onSaved={(c) => {
            applyCustomer(c);
            setCustModal(false);
            loadCustomers();
          }}
        />

        <InventoryImportModal
          open={invModal}
          onClose={() => setInvModal(false)}
          onPick={(p) => {
            addItemFromProduct(p);
            toast.success(`Added ${p.name}`);
          }}
        />

        <div>
          {/* Toolbar */}
          <div className="no-print flex items-start justify-between mb-6 gap-4 flex-wrap">
            <div className="flex items-start gap-3">
              <button
                className="rounded-xl p-2.5 text-brand-500 hover:bg-brand-50 transition-colors cursor-pointer mt-0.5"
                onClick={() => {
                  setForm(null);
                  loadDocs();
                }}
                aria-label="Back"
              >
                <ArrowLeft size={18} />
              </button>
              <div>
                <h1 className="text-[22px] font-semibold text-foreground tracking-tight">Create Quotation</h1>
                <p className="text-sm text-brand-500 mt-0.5">
                  Build quotations with per-line discount/tax and convert them to invoices
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge tone={statusTone(form.status)}>{form.status}</Badge>
              {!form.id && (
                <span className="text-xs font-medium text-brand-400">Unsaved</span>
              )}
              <button className="btn-ghost" onClick={() => setViewOpen(true)}>
                <Maximize2 size={15} /> View
              </button>
              <button className="btn-ghost" onClick={downloadPdf} title="Download PDF (Ctrl+P)">
                <Download size={15} /> PDF
              </button>
              <button
                className="btn-ghost"
                onClick={() => commit()}
                disabled={saving}
                title="Save (Ctrl+S)"
              >
                <Save size={15} /> {saving ? "Saving…" : "Save"}
              </button>
              <button
                className="btn-ghost"
                onClick={() => duplicateQuote()}
                title="Duplicate into a new draft"
              >
                <Copy size={15} /> Duplicate
              </button>
              <select
                className="select h-9 text-xs"
                value={form.status}
                onChange={(e) => commit(e.target.value)}
                disabled={saving}
                title="Mark Sent / Accepted / Cancelled"
              >
                <option value="draft">Mark as Draft</option>
                <option value="sent">Mark as Sent</option>
                <option value="accepted">Mark as Accepted</option>
                <option value="cancelled">Mark as Cancelled</option>
              </select>
              <button
                className="btn-ghost"
                onClick={emailQuote}
                disabled={!form.customer_email}
                title="Email quotation"
              >
                <Send size={15} /> Email
              </button>
              <button
                className="btn-ghost"
                onClick={copyPublicLink}
                disabled={!form.id}
                title="Copy public link"
              >
                <Copy size={15} /> Link
              </button>
              <ShareToggle shared={!!form.shared} onToggle={toggleShared} />
              <button
                className="btn-primary"
                onClick={convertToInvoice}
                disabled={!form.id || converting}
                title="Convert to invoice"
              >
                <FileText size={15} /> {converting ? "Converting…" : "Convert"}
              </button>
            </div>
          </div>

          <ResizablePanels
            left={
              <div className="no-print space-y-4">
                {/* 1 · Template */}
                <Step
                  n={1}
                  title="Choose Template"
                  subtitle="Select a template for your quotation"
                  action={
                    <button
                      className="btn-ghost text-xs flex items-center gap-1"
                      onClick={() => setDesigning(true)}
                    >
                      <Plus size={13} /> Create Template
                    </button>
                  }
                >
                  <DocTemplateGallery
                    key={tplNonce}
                    value={form.template}
                    onChange={(id) => set("template", id)}
                    onDesign={() => setDesigning(true)}
                    viewAll={viewAll}
                    onViewAllToggle={setViewAll}
                  />
                </Step>

                {/* 2 · Quote details */}
                <Step
                  n={2}
                  title="Quotation Details"
                  subtitle="Customer, dates and reference information"
                  action={
                    <button className="btn-ghost text-xs" onClick={() => setCompanyOpen(true)}>
                      <Building2 size={13} /> Company defaults
                    </button>
                  }
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-3">
                      <Field label="Customer">
                        <div className="flex gap-2">
                          <select
                            className="select"
                            value={form.customer_id ?? ""}
                            onChange={(e) => {
                              const c = customers.find((x) => String(x.id) === e.target.value);
                              if (c) applyCustomer(c);
                            }}
                          >
                            <option value="">
                              {customers.length ? "Select saved customer…" : "No saved customers"}
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
                          onChange={(e) => set("customer_address", e.target.value)}
                        />
                      </Field>
                      <Field label="Customer Email / TRN">
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            className="input"
                            placeholder="Email"
                            value={form.customer_email ?? ""}
                            onChange={(e) => set("customer_email", e.target.value)}
                          />
                          <input
                            className="input"
                            placeholder="TRN"
                            value={form.customer_trn ?? ""}
                            onChange={(e) => set("customer_trn", e.target.value)}
                          />
                        </div>
                      </Field>
                    </div>
                    <div className="space-y-3">
                      <Field label="Document Title">
                        <input
                          className="input"
                          placeholder="Quotation"
                          value={form.doc_title || ""}
                          list="quote-title-suggestions"
                          onChange={(e) => set("doc_title", e.target.value)}
                        />
                        <datalist id="quote-title-suggestions">
                          <option value="Quotation" />
                          <option value="Proforma Invoice" />
                          <option value="Estimate" />
                          <option value="Proposal" />
                        </datalist>
                      </Field>
                      <Field label="Quotation Number">
                        <input
                          className="input"
                          value={form.number}
                          onChange={(e) => set("number", e.target.value)}
                        />
                      </Field>
                      <Field label="Quote Date">
                        <DateField
                          value={form.quote_date ?? ""}
                          onChange={(v) => set("quote_date", v)}
                          clearable={false}
                        />
                      </Field>
                      <Field label="Valid Until">
                        <DateField
                          value={form.valid_until ?? ""}
                          onChange={(v) => set("valid_until", v)}
                        />
                      </Field>
                      <div className="grid grid-cols-2 gap-3">
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
                        <Field label="Sales Person">
                          <input
                            className="input"
                            placeholder="Name"
                            value={form.sales_person ?? ""}
                            onChange={(e) => set("sales_person", e.target.value)}
                          />
                        </Field>
                      </div>
                    </div>
                  </div>
                </Step>

                {/* 3 · Items */}
                <Step
                  n={3}
                  title="Items"
                  subtitle="Products, services, per-line discount and tax"
                  action={
                    <div className="flex items-center gap-2 flex-wrap">
                      <button className="btn-ghost text-xs" onClick={() => setInvModal(true)}>
                        <PackageSearch size={13} /> Import from Inventory
                      </button>
                      <button className="btn-ghost text-xs" onClick={addCustomColumn}>
                        <Plus size={12} /> Add Field
                      </button>
                    </div>
                  }
                >
                  {/* Optional formula toggle */}
                  <div className="rounded-xl border border-brand-200 p-3 mb-3">
                    <div className="flex items-center justify-between gap-2 text-xs font-semibold text-brand-500 mb-2">
                      Multiply a custom field with rate
                      <button
                        type="button"
                        onClick={() =>
                          set(
                            "unit_price_formula",
                            form.unit_price_formula ? null : { a: "", b: "unit_price" }
                          )
                        }
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          form.unit_price_formula ? "bg-primary-400" : "bg-brand-200"
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                            form.unit_price_formula ? "translate-x-4" : "translate-x-1"
                          }`}
                        />
                      </button>
                    </div>
                    {form.unit_price_formula && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <select
                          className="input text-xs py-1.5 h-8"
                          value={form.unit_price_formula.a || ""}
                          onChange={(e) =>
                            set("unit_price_formula", {
                              a: e.target.value,
                              b: "unit_price",
                            })
                          }
                        >
                          <option value="">Select field</option>
                          <option value="qty">Qty</option>
                          {form.customColumns.map((c) => (
                            <option key={c.key} value={c.key}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                        <span className="text-brand-400">× rate</span>
                        <span className="text-[10px] text-brand-400">→ Amount</span>
                      </div>
                    )}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs font-semibold text-brand-500">
                          <th className="py-2 pr-2 w-6">#</th>
                          <th className="py-2 px-2">Description</th>
                          <th className="py-2 px-2 w-20 text-right">Qty</th>
                          <th className="py-2 px-2 w-20 text-right">Unit</th>
                          {form.customColumns.map((col, idx) => (
                            <th
                              key={col.key}
                              className="py-2 px-2 text-right group relative cursor-grab active:cursor-grabbing"
                              draggable
                              onDragStart={(e) => {
                                e.dataTransfer.setData("text/plain", col.key);
                                e.dataTransfer.effectAllowed = "move";
                              }}
                              onDragOver={(e) => {
                                e.preventDefault();
                                e.dataTransfer.dropEffect = "move";
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                const fromKey = e.dataTransfer.getData("text/plain");
                                if (fromKey && fromKey !== col.key) {
                                  const fromIdx = form.customColumns.findIndex(
                                    (c) => c.key === fromKey
                                  );
                                  if (fromIdx >= 0) {
                                    const next = [...form.customColumns];
                                    const [moved] = next.splice(fromIdx, 1);
                                    next.splice(idx, 0, moved);
                                    setForm({ ...form, customColumns: next });
                                  }
                                }
                              }}
                            >
                              <span className="text-[10px]">{col.label}</span>
                              <button
                                className="ml-1 opacity-0 group-hover:opacity-100 text-brand-400 hover:text-danger inline cursor-pointer transition-colors"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeCustomColumn(col.key);
                                }}
                                title="Remove column"
                              >
                                ×
                              </button>
                            </th>
                          ))}
                          <th className="py-2 px-2 w-28 text-right">Rate</th>
                          <th className="py-2 px-2 w-20 text-right">Disc %</th>
                          <th className="py-2 px-2 w-20 text-right">Tax %</th>
                          <th className="py-2 px-2 w-28 text-right">Amount</th>
                          <th className="w-8" />
                        </tr>
                      </thead>
                      <tbody>
                        {form.items.map((it, i) => (
                          <tr key={i} className="border-t border-brand-100">
                            <td className="py-2 pr-2 text-brand-500">
                              {i + 1}
                              {it.pageBreakBefore && i > 0 && (
                                <span className="ml-1 text-[10px] text-primary-700 font-medium">
                                  ↳ new page
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-2">
                              <input
                                className="input"
                                placeholder="Item description"
                                value={it.product}
                                onChange={(e) => setItem(i, { product: e.target.value })}
                              />
                            </td>
                            <td className="py-2 px-2">
                              <input
                                type="number"
                                className="input text-right !px-2"
                                value={it.qty || ""}
                                placeholder="0"
                                onChange={(e) => setItem(i, { qty: numInput(e.target.value) })}
                              />
                            </td>
                            <td className="py-2 px-2">
                              <input
                                className="input text-right !px-2"
                                placeholder="pcs"
                                value={it.unit || ""}
                                list="unit-suggestions"
                                onChange={(e) => setItem(i, { unit: e.target.value })}
                              />
                            </td>
                            {form.customColumns.map((col) => (
                              <td key={col.key} className="py-2 px-2">
                                <input
                                  className="input text-right !px-2 !py-1 text-xs"
                                  placeholder={col.label}
                                  value={it.custom?.[col.key] || ""}
                                  onChange={(e) => setItemCustom(i, col.key, e.target.value)}
                                />
                              </td>
                            ))}
                            <td className="py-2 px-2">
                              <input
                                type="number"
                                className={`input text-right !px-2 ${
                                  form.unit_price_formula?.a && form.unit_price_formula?.b
                                    ? "bg-brand-50/50"
                                    : ""
                                }`}
                                placeholder="0"
                                value={it.rate || ""}
                                onChange={(e) => setItem(i, { rate: numInput(e.target.value) })}
                              />
                            </td>
                            <td className="py-2 px-2">
                              <input
                                type="number"
                                className="input text-right !px-2"
                                placeholder="0"
                                value={it.discount || ""}
                                onChange={(e) =>
                                  setItem(i, { discount: numInput(e.target.value) })
                                }
                              />
                            </td>
                            <td className="py-2 px-2">
                              <input
                                type="number"
                                className="input text-right !px-2"
                                placeholder="0"
                                value={it.tax || ""}
                                onChange={(e) => setItem(i, { tax: numInput(e.target.value) })}
                              />
                            </td>
                            <td className="py-2 px-2 text-right font-medium text-ink">
                              {m(docLineAmount(asDocItem(it), form.unit_price_formula))}
                            </td>
                            <td className="py-2">
                              <div className="flex items-center gap-0.5">
                                <button
                                  type="button"
                                  aria-label={
                                    it.pageBreakBefore
                                      ? "Remove page break before this item"
                                      : "Start a new page at this item"
                                  }
                                  title={
                                    i === 0
                                      ? "First item always starts page 1"
                                      : it.pageBreakBefore
                                        ? "Starts a new page here (click to remove)"
                                        : "Insert page break before this item"
                                  }
                                  disabled={i === 0}
                                  className={`rounded-lg p-1.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                                    it.pageBreakBefore
                                      ? "text-primary-700 bg-primary-100"
                                      : "text-brand-400 hover:text-ink hover:bg-brand-50 cursor-pointer"
                                  }`}
                                  onClick={() =>
                                    setItem(i, { pageBreakBefore: !it.pageBreakBefore })
                                  }
                                >
                                  <SeparatorHorizontal size={14} />
                                </button>
                                <button
                                  aria-label="Remove line"
                                  className="text-brand-500 hover:text-danger hover:bg-danger/10 rounded-lg p-1.5 cursor-pointer transition-colors"
                                  onClick={() => removeItem(i)}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {form.customColumns.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-2 text-xs text-brand-500">
                      <span className="mr-1">Custom fields (drag to reorder):</span>
                      {form.customColumns.map((col, idx) => (
                        <span
                          key={col.key}
                          className="inline-flex items-center gap-0.5 bg-brand-50 border border-brand-200 rounded-lg px-2 py-1 cursor-grab active:cursor-grabbing select-none transition-colors hover:bg-brand-100"
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData("text/plain", col.key);
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            const fromKey = e.dataTransfer.getData("text/plain");
                            if (fromKey && fromKey !== col.key) {
                              const fromIdx = form.customColumns.findIndex(
                                (c) => c.key === fromKey
                              );
                              if (fromIdx >= 0) {
                                const next = [...form.customColumns];
                                const [moved] = next.splice(fromIdx, 1);
                                next.splice(idx, 0, moved);
                                setForm({ ...form, customColumns: next });
                              }
                            }
                          }}
                        >
                          <span className="font-medium text-xs text-ink">{col.label}</span>
                          <button
                            className="text-brand-400 hover:text-danger ml-0.5 cursor-pointer transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeCustomColumn(col.key);
                            }}
                            title="Remove"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 mt-3">
                    <button className="btn-primary" onClick={addItem}>
                      <Plus size={14} /> Add Item
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowBank((v) => !v)}
                      className={`btn-ghost text-xs ${showBank ? "!bg-brand-50 !text-ink" : ""}`}
                      title="Show saved bank details"
                    >
                      <Landmark size={13} /> Bank details: {showBank ? "On" : "Off"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const on = !form.show_stamp;
                        setForm({
                          ...form,
                          show_stamp: on,
                          stamp:
                            on && !form.stamp?.data && companyStampSig.stamp?.data
                              ? { ...companyStampSig.stamp }
                              : form.stamp,
                        });
                      }}
                      className={`btn-ghost text-xs ${form.show_stamp ? "!bg-brand-50 !text-ink" : ""}`}
                      title="Show company stamp"
                      disabled={!companyStampSig.stamp?.data}
                    >
                      <Stamp size={13} /> Stamp: {form.show_stamp ? "On" : "Off"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const on = !form.show_signature;
                        setForm({
                          ...form,
                          show_signature: on,
                          signature:
                            on && !form.signature?.data && companyStampSig.signature?.data
                              ? { ...companyStampSig.signature }
                              : form.signature,
                        });
                      }}
                      className={`btn-ghost text-xs ${form.show_signature ? "!bg-brand-50 !text-ink" : ""}`}
                      title="Show company signature"
                      disabled={!companyStampSig.signature?.data}
                    >
                      <PenTool size={13} /> Signature: {form.show_signature ? "On" : "Off"}
                    </button>
                  </div>

                  {(form.show_stamp || form.show_signature) &&
                    (companyStampSig.stamp?.data || companyStampSig.signature?.data) && (
                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
                        {form.show_stamp && (form.stamp?.data || companyStampSig.stamp?.data) && (
                          <StampSigAdjust
                            label="Stamp"
                            icon={<Stamp size={13} />}
                            value={form.stamp?.data ? form.stamp : companyStampSig.stamp!}
                            onChange={(v) => setForm({ ...form, stamp: v })}
                          />
                        )}
                        {form.show_signature &&
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
                </Step>

                {/* 4 · Settings */}
                <Step n={4} title="Additional Settings" subtitle="Notes, terms, logo and accent">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="rounded-xl border border-border p-4">
                      <div className="flex items-center gap-2 text-ink font-semibold text-sm">
                        <Settings size={15} /> Quotation Settings
                      </div>
                      <div className="mt-3 space-y-2">
                        <div className="flex items-center justify-between gap-2 text-xs font-semibold text-brand-500 border border-brand-200 rounded-xl px-3 py-2">
                          <span>Accent color</span>
                          <ColorPicker value={form.accent} onChange={(hex) => set("accent", hex)} />
                        </div>
                        <div className="flex items-center justify-between gap-2 text-xs font-semibold text-brand-500 border border-brand-200 rounded-xl px-3 py-2">
                          <span>Page breaks are manual only</span>
                          <span className="text-[10px] text-brand-400">Use the row action</span>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-xl border border-border p-4">
                      <div className="flex items-center gap-2 text-ink font-semibold text-sm">
                        <StickyNote size={15} /> Notes & Terms
                      </div>
                      <textarea
                        className="textarea mt-3"
                        rows={3}
                        placeholder="Notes shown on the quotation"
                        value={form.notes ?? ""}
                        onChange={(e) => set("notes", e.target.value)}
                      />
                      <textarea
                        className="textarea mt-2"
                        rows={2}
                        placeholder="Terms and conditions"
                        value={form.terms ?? ""}
                        onChange={(e) => set("terms", e.target.value)}
                      />
                    </div>
                    <div className="rounded-xl border border-border p-4">
                      <div className="flex items-center gap-2 text-ink font-semibold text-sm">
                        <Paperclip size={15} /> Logo / Attachment
                      </div>
                      <div className="mt-3">
                        {form.logo ? (
                          <div className="flex items-center gap-2">
                            <img
                              src={form.logo}
                              alt="logo"
                              className="h-12 w-12 object-contain border border-brand-200 rounded-xl bg-white"
                            />
                            <button
                              className="btn-ghost text-xs"
                              onClick={() => set("logo", null as any)}
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
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (!f) return;
                                const r = new FileReader();
                                r.onload = () => set("logo", String(r.result));
                                r.readAsDataURL(f);
                              }}
                            />
                          </label>
                        )}
                        <p className="text-[11px] text-brand-500 mt-2">
                          Tip: set this once in Settings → Company Details to auto-fill every
                          document.
                        </p>
                      </div>
                    </div>
                  </div>
                </Step>
              </div>
            }
            right={
              <div className="sticky top-4 space-y-4">
                {designing && (
                  <TemplateDesigner
                    onSave={(tpl) => {
                      setForm({ ...form, template: tpl.id });
                      syncCustomTemplates().catch(() => {});
                      setTplNonce((n) => n + 1);
                      setDesigning(false);
                    }}
                    onClose={() => setDesigning(false)}
                  />
                )}

                <div className="card !p-4">
                  <div className="no-print flex items-center justify-between mb-3">
                    <div>
                      <p className="font-semibold text-ink flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-ink text-white grid place-items-center text-xs font-semibold">
                          5
                        </span>
                        Preview
                      </p>
                      <p className="text-xs text-brand-500 mt-0.5 ml-8">
                        This is how your quotation will look
                      </p>
                    </div>
                  </div>

                  <FitPreview baseWidth={device === "desktop" ? 794 : 420} zoom={zoom} padding={0}>
                    <div ref={quoteRef}>
                      <div style={{ position: "relative", minHeight: device === "desktop" ? 1027 : 498 }}>
                        <StampSignatureLayer
                          stamp={
                            form.show_stamp
                              ? form.stamp?.data
                                ? form.stamp
                                : companyStampSig.stamp
                              : undefined
                          }
                          signature={
                            form.show_signature
                              ? form.signature?.data
                                ? form.signature
                                : companyStampSig.signature
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
                        <DocView
                          form={docViewForm}
                          pageItems={pages[curPageIdx]?.map(
                            (it): DocViewItem => ({
                              description: it.description,
                              qty: it.qty,
                              unit_price: it.unit_price,
                              unit: it.unit,
                              custom: it.custom,
                              discount: it.discount,
                              tax: it.tax,
                            })
                          )}
                          itemStartIndex={pageStartIndex}
                          showTotals={isLastPreviewPage}
                          showFooter={isLastPreviewPage}
                          labels={{
                            docTitle: form.doc_title || "QUOTATION",
                            partyLabel: "Quote To",
                            issuedLabel: "Quote Date",
                            dueLabel: "Valid Until",
                            totalLabel: `Total (${form.currency})`,
                          }}
                        />
                        {showBank && (
                          <DraggableBlock
                            x={bankX}
                            y={bankY}
                            onMove={(x, y) => {
                              setBankX(x);
                              setBankY(y);
                            }}
                          >
                            <BankDetailsBlock bank={bank} accent={form.accent} />
                          </DraggableBlock>
                        )}
                      </div>
                    </div>
                  </FitPreview>

                  {/* Off-screen full-page export (all pages) */}
                  {(() => {
                    const exportPages = paginateItems(form.items as unknown as DocItem[]);
                    return (
                      <div
                        ref={exportRef}
                        aria-hidden
                        className="fixed left-[-99999px] top-0 pointer-events-none"
                        style={{ width: 794, background: "#fff" }}
                      >
                        {exportPages.map((group, gi) => {
                          const startIdx = exportPages
                            .slice(0, gi)
                            .reduce((n, g) => n + g.length, 0);
                          const isLast = gi === exportPages.length - 1;
                          return (
                            <div
                              key={gi}
                              className="invoice-print"
                              style={{
                                width: 794,
                                height: 1123,
                                background: "#fff",
                                position: "relative",
                                overflow: "hidden",
                                padding: 48,
                                boxSizing: "border-box",
                              }}
                            >
                              <div
                                style={{
                                  position: "relative",
                                  width: "100%",
                                  minHeight: 1027,
                                  background: "#fff",
                                }}
                              >
                                {isLast && (
                                  <StampSignatureLayer
                                    stamp={
                                      form.show_stamp
                                        ? form.stamp?.data
                                          ? form.stamp
                                          : companyStampSig.stamp
                                        : undefined
                                    }
                                    signature={
                                      form.show_signature
                                        ? form.signature?.data
                                          ? form.signature
                                          : companyStampSig.signature
                                        : undefined
                                    }
                                    onStampMove={() => {}}
                                    onSignatureMove={() => {}}
                                  />
                                )}
                                <DocView
                                  form={docViewForm}
                                  pageItems={group.map(
                                    (it): DocViewItem => ({
                                      description: it.description,
                                      qty: it.qty,
                                      unit_price: it.unit_price,
                                      unit: it.unit,
                                      custom: it.custom,
                                      discount: it.discount,
                                      tax: it.tax,
                                    })
                                  )}
                                  itemStartIndex={startIdx}
                                  showTotals={isLast}
                                  showFooter={isLast}
                                  labels={{
                                    docTitle: form.doc_title || "QUOTATION",
                                    partyLabel: "Quote To",
                                    issuedLabel: "Quote Date",
                                    dueLabel: "Valid Until",
                                    totalLabel: `Total (${form.currency})`,
                                  }}
                                />
                                {showBank && isLast && (
                                  <DraggableBlock
                                    x={bankX}
                                    y={bankY}
                                    onMove={() => {}}
                                  >
                                    <BankDetailsBlock bank={bank} accent={form.accent} />
                                  </DraggableBlock>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {previewPages > 1 && (
                    <div className="no-print flex items-center justify-center gap-2 mt-2">
                      <button
                        className="btn-ghost h-8 px-3 text-xs disabled:opacity-40"
                        disabled={previewPage <= 1}
                        onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                      >
                        Back
                      </button>
                      <span className="text-xs text-brand-500 font-medium">
                        Page {previewPage} / {previewPages}
                      </span>
                      <button
                        className="btn-ghost h-8 px-3 text-xs disabled:opacity-40"
                        disabled={previewPage >= previewPages}
                        onClick={() => setPreviewPage((p) => Math.min(previewPages, p + 1))}
                      >
                        Next
                      </button>
                    </div>
                  )}

                  <div className="no-print flex items-center justify-between mt-3 gap-2 flex-wrap">
                    <div className="flex items-center gap-1 rounded-xl bg-brand-50 p-1">
                      <button
                        className={`rounded-lg p-1.5 cursor-pointer transition-colors ${
                          device === "desktop"
                            ? "bg-primary-100 text-primary-700"
                            : "text-brand-500 hover:text-ink"
                        }`}
                        onClick={() => setDevice("desktop")}
                        aria-label="Desktop preview"
                      >
                        <Monitor size={15} />
                      </button>
                      <button
                        className={`rounded-lg p-1.5 cursor-pointer transition-colors ${
                          device === "mobile"
                            ? "bg-primary-100 text-primary-700"
                            : "text-brand-500 hover:text-ink"
                        }`}
                        onClick={() => setDevice("mobile")}
                        aria-label="Mobile preview"
                      >
                        <Smartphone size={15} />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        className="rounded-lg border border-brand-200 p-1.5 text-brand-500 cursor-pointer hover:bg-brand-50 transition-colors"
                        onClick={() => setZoom((z) => Math.max(50, z - 10))}
                        aria-label="Zoom out"
                      >
                        <Minus size={14} />
                      </button>
                      <span className="text-xs font-semibold text-brand-500 w-10 text-center">
                        {zoom}%
                      </span>
                      <button
                        className="rounded-lg border border-brand-200 p-1.5 text-brand-500 cursor-pointer hover:bg-brand-50 transition-colors"
                        onClick={() => setZoom((z) => Math.min(150, z + 10))}
                        aria-label="Zoom in"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        className="btn-ghost text-xs"
                        onClick={() => commit()}
                        disabled={saving}
                      >
                        <Save size={14} /> Save
                      </button>
                      <button className="btn-primary text-xs" onClick={downloadPdf}>
                        <Download size={14} /> PDF
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            }
          />

          {viewOpen && (
            <div
              className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 p-4"
              onClick={() => setViewOpen(false)}
            >
              <div
                className="flex max-h-[95vh] w-full max-w-7xl flex-col rounded-xl bg-card border border-border shadow-lg outline-none"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b border-brand-100 px-6 py-4">
                  <div className="flex items-center gap-3">
                    <h2 className="text-lg font-semibold text-ink">
                      {form.number || "Quotation preview"}
                    </h2>
                    <span className="text-xs font-semibold text-brand-500 bg-brand-50 dark:bg-white/10 dark:text-brand-500 px-2.5 py-1 rounded-full">
                      Page {viewPage} of {viewPageCount}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {viewPageCount > 1 && (
                      <div className="flex items-center gap-1">
                        <button
                          className="btn-ghost h-8 px-2 text-xs disabled:opacity-40"
                          disabled={viewPage <= 1}
                          onClick={() => setViewPage((p) => Math.max(1, p - 1))}
                        >
                          Prev
                        </button>
                        <span className="text-xs text-brand-500 font-medium w-16 text-center">
                          {viewPage} / {viewPageCount}
                        </span>
                        <button
                          className="btn-ghost h-8 px-2 text-xs disabled:opacity-40"
                          disabled={viewPage >= viewPageCount}
                          onClick={() => setViewPage((p) => Math.min(viewPageCount, p + 1))}
                        >
                          Next
                        </button>
                      </div>
                    )}
                    <button className="btn-ghost h-9 text-xs" onClick={downloadPdf}>
                      <Download size={14} /> PDF
                    </button>
                    <button
                      onClick={() => setViewOpen(false)}
                      className="grid h-9 w-9 place-items-center rounded-xl text-brand-500 hover:bg-brand-50 hover:text-ink cursor-pointer transition-colors"
                      aria-label="Close"
                    >
                      <X size={18} />
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-auto p-6">
                  <div className="mx-auto max-w-5xl">
                    <div
                      className="paper-texture rounded-xl border border-brand-200 p-8 shadow-sm dark:bg-white min-h-[1123px]"
                    >
                      <div style={{ position: "relative", minHeight: 1059 }}>
                        <StampSignatureLayer
                          stamp={
                            form.show_stamp
                              ? form.stamp?.data
                                ? form.stamp
                                : companyStampSig.stamp
                              : undefined
                          }
                          signature={
                            form.show_signature
                              ? form.signature?.data
                                ? form.signature
                                : companyStampSig.signature
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
                        <DocView
                          form={docViewForm}
                          pageItems={viewPages[viewPageIdx]?.map(
                            (it): DocViewItem => ({
                              description: it.description,
                              qty: it.qty,
                              unit_price: it.unit_price,
                              unit: it.unit,
                              custom: it.custom,
                              discount: it.discount,
                              tax: it.tax,
                            })
                          )}
                          itemStartIndex={viewPageStart}
                          showTotals={isLastViewPage}
                          showFooter={isLastViewPage}
                          labels={{
                            docTitle: form.doc_title || "QUOTATION",
                            partyLabel: "Quote To",
                            issuedLabel: "Quote Date",
                            dueLabel: "Valid Until",
                            totalLabel: `Total (${form.currency})`,
                          }}
                        />
                        {showBank && isLastViewPage && (
                          <DraggableBlock
                            x={bankX}
                            y={bankY}
                            onMove={(x, y) => {
                              setBankX(x);
                              setBankY(y);
                            }}
                          >
                            <BankDetailsBlock bank={bank} accent={form.accent} />
                          </DraggableBlock>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <div>
      <PageHeader
        title="Quoting"
        subtitle="Create quotations, send them to customers and convert wins to invoices"
        action={
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => setCompanyOpen(true)}>
              <Building2 size={16} /> Company
            </button>
            <button className="btn-primary" onClick={newQuote}>
              <Plus size={16} /> New Quote
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 joined-kpis mb-4">
        <MetricCard
          label="Quotes"
          value={num(docs.length)}
          icon={<FileText size={20} />}
        />
        <MetricCard
          label="Total Value"
          value={money(totalValue, statCcy)}
          icon={<Check size={20} />}
          iconClass="bg-primary-100 text-ink"
        />
        <MetricCard
          label="Sent"
          value={num(sentCount)}
          icon={<Send size={20} />}
          iconClass="bg-info/15 text-info"
        />
        <MetricCard
          label="Accepted"
          value={num(acceptedCount)}
          icon={<Check size={20} />}
          iconClass="bg-success/15 text-success"
        />
      </div>

      <div className="mb-4">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search quotes by number or customer…"
          className="max-w-xs"
        />
      </div>

      <DataTable<QuotationSummary>
        rows={filteredDocs}
        empty={
          search ? "No quotes match your search" : "No quotes yet — create your first one"
        }
        rowKey={(d) => d.id}
        onRowClick={(d) => editQuote(d.id)}
        bulkActions={[
          {
            label: "Share",
            run: async (sel) => {
              for (const d of sel) await quotes.shareDoc(d.id, true);
              loadDocs();
              toast.success(`Shared ${sel.length}.`);
            },
          },
          {
            label: "Mark sent",
            run: async (sel) => {
              for (const d of sel) await quotes.setStatus(d.id, "sent");
              loadDocs();
              toast.success(`Updated ${sel.length}.`);
            },
          },
          {
            label: "Mark accepted",
            run: async (sel) => {
              for (const d of sel) await quotes.setStatus(d.id, "accepted");
              loadDocs();
              toast.success(`Updated ${sel.length}.`);
            },
          },
          {
            label: "Copy public link",
            run: async (sel) => {
              try {
                const token = await quotes.publicLink(sel[0].id);
                const url = `${location.origin}${location.pathname}#/portal/${token}`;
                await navigator.clipboard.writeText(url);
                loadDocs();
                toast.success("Public quotation link copied");
              } catch (e) {
                toast.error(errMsg(e));
              }
            },
          },
          {
            label: "Delete",
            danger: true,
            run: async (sel) => {
              const ok = await confirm({
                title: "Delete quotations",
                message: `Delete ${sel.length} quotation(s)?`,
                danger: true,
              });
              if (!ok) return;
              for (const d of sel) await quotes.deleteDoc(d.id);
              loadDocs();
              toast.success(`Deleted ${sel.length}.`);
            },
          },
        ]}
        columns={[
          {
            key: "no",
            label: "Quote #",
            sortValue: (d) => d.number,
            render: (d) => (
              <span className="font-mono text-xs font-medium">{d.number}</span>
            ),
          },
          {
            key: "cust",
            label: "Customer",
            sortValue: (d) => d.customer_name,
            render: (d) => <span className="font-medium">{d.customer_name}</span>,
          },
          {
            key: "quote_date",
            label: "Quote Date",
            sortValue: (d) => d.quote_date || "",
            render: (d) => fmtDate(d.quote_date),
          },
          {
            key: "valid_until",
            label: "Valid Until",
            sortValue: (d) => d.valid_until || "",
            render: (d) => fmtDate(d.valid_until),
          },
          {
            key: "total",
            label: "Total",
            sortValue: (d) => d.total,
            render: (d) => (
              <span className="font-medium">{money(d.total, statCcy)}</span>
            ),
          },
          {
            key: "status",
            label: "Status",
            sortValue: (d) => d.status,
            render: (d) => <Badge tone={statusTone(d.status)}>{d.status}</Badge>,
          },
          {
            key: "share",
            label: "Sharing",
            render: (d) => (
              <ShareToggle
                shared={d.shared}
                onToggle={async (next) => {
                  try {
                    await quotes.shareDoc(d.id, next);
                    loadDocs();
                    toast.success(next ? "Shared with team." : "Set to private.");
                  } catch (e) {
                    toast.error(errMsg(e));
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
                  aria-label="Edit"
                  className="text-brand-500 hover:text-primary-700 hover:bg-brand-50 rounded-lg p-1.5 cursor-pointer transition-colors"
                  onClick={() => editQuote(d.id)}
                >
                  <Pencil size={15} />
                </button>
                <button
                  aria-label="Duplicate"
                  className="text-brand-500 hover:text-primary-700 hover:bg-brand-50 rounded-lg p-1.5 cursor-pointer transition-colors"
                  onClick={() => duplicateQuote(d.id)}
                >
                  <Copy size={15} />
                </button>
                <button
                  aria-label="Copy public link"
                  className="text-brand-500 hover:text-primary-700 hover:bg-brand-50 rounded-lg p-1.5 cursor-pointer transition-colors"
                  onClick={async () => {
                    try {
                      const token = await quotes.publicLink(d.id);
                      const url = `${location.origin}${location.pathname}#/portal/${token}`;
                      await navigator.clipboard.writeText(url);
                      loadDocs();
                      toast.success("Public link copied");
                    } catch (e) {
                      toast.error(errMsg(e));
                    }
                  }}
                >
                  <Send size={15} />
                </button>
                <button
                  aria-label="Convert to invoice"
                  className="text-brand-500 hover:text-primary-700 hover:bg-brand-50 rounded-lg p-1.5 cursor-pointer transition-colors"
                  onClick={async () => {
                    try {
                      await quotes.convertToInvoice(d.id);
                      toast.success("Invoice created from quotation.");
                      navigate("/invoicing");
                    } catch (e) {
                      toast.error(`Could not convert: ${errMsg(e)}`);
                    }
                  }}
                >
                  <FileText size={15} />
                </button>
                <button
                  aria-label="Delete"
                  className="text-brand-500 hover:text-danger hover:bg-danger/10 rounded-lg p-1.5 cursor-pointer transition-colors"
                  onClick={async () => {
                    if (
                      !(await confirm({
                        title: "Delete quotation",
                        message: `Delete ${d.number}? This cannot be undone.`,
                        danger: true,
                      }))
                    )
                      return;
                    await quotes.deleteDoc(d.id);
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
    <div className="rounded-xl border border-border bg-card">
      <div className="px-5 py-4 border-b border-border flex items-center gap-3 flex-wrap">
        <span className="w-7 h-7 rounded-full bg-foreground text-background grid place-items-center text-[13px] font-semibold shrink-0">
          {n}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-foreground leading-tight">{title}</p>
          {subtitle && <p className="text-[12.5px] text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

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
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({
    company: "",
    name: "",
    address: "",
    email: "",
    phone: "",
    trn: "",
  });
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
  return (
    <Modal open={open} onClose={onClose} title="Add Customer">
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
          <Field label="TRN">
            <input
              className="input"
              value={f.trn}
              onChange={(e) => setF({ ...f, trn: e.target.value })}
            />
          </Field>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn-primary"
          disabled={saving || (!f.company.trim() && !f.name.trim())}
          onClick={async () => {
            setSaving(true);
            const trn = f.trn.replace(/\s/g, "");
            const payload = {
              name: f.name || f.company,
              company: f.company || undefined,
              email: f.email || undefined,
              phone: f.phone || undefined,
              address: f.address || undefined,
              trn: trn || undefined,
            };
            try {
              const id = await crm.createCustomer(payload as Omit<CrmCustomer, "id" | "created_at">);
              onSaved({ id, created_at: "", ...payload } as CrmCustomer);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Failed to create customer");
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Saving…" : "Save Customer"}
        </button>
      </div>
    </Modal>
  );
}

function InventoryImportModal({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (p: Product) => void;
}) {
  const { toast } = useUI();
  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ] = useState("");
  useEffect(() => {
    if (open)
      erp
        .products()
        .then(setProducts)
        .catch(() => toast.error("Failed to load products"));
  }, [open]);
  const filtered = products.filter(
    (p) =>
      p.name.toLowerCase().includes(q.toLowerCase()) ||
      p.sku.toLowerCase().includes(q.toLowerCase())
  );
  return (
    <Modal open={open} onClose={onClose} title="Import from Inventory">
      <SearchInput
        value={q}
        onChange={setQ}
        placeholder="Search products or SKU…"
        className="mb-3"
      />
      <div className="max-h-72 overflow-y-auto space-y-1">
        {filtered.map((p) => (
          <button
            key={p.id}
            onClick={() => onPick(p)}
            className="w-full flex items-center justify-between rounded-xl px-3 py-2.5 hover:bg-brand-50 dark:hover:bg-white/5 cursor-pointer text-left transition-colors"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink truncate">{p.name}</p>
              <p className="text-[11px] text-brand-500 font-medium">
                {p.sku}
                {p.quantity === 0 ? " · out of stock" : ` · ${p.quantity} in stock`}
              </p>
            </div>
            <span className="text-sm font-medium text-ink">{money(p.unit_price, "AED")}</span>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="text-sm text-brand-500 text-center py-6">
            No products found. Add them in Inventory first.
          </p>
        )}
      </div>
      <div className="flex justify-end mt-4">
        <button className="btn-ghost" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

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
        <Field label="Default Template">
          <select
            className="select"
            value={c.default_template}
            onChange={(e) => setC({ ...c, default_template: e.target.value })}
          >
            {[
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
            ].map((t) => (
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
            onChange={(e) => setC({ ...c, default_accent: e.target.value })}
          />
        </Field>
        <Field label="Logo">
          <div className="flex items-center gap-3">
            {c.logo && (
              <img
                src={c.logo}
                alt="logo"
                className="h-12 w-12 object-contain border border-brand-200 rounded-xl"
              />
            )}
            <button className="btn-ghost" onClick={() => fileRef.current?.click()}>
              <Upload size={14} /> {c.logo ? "Replace" : "Upload"}
            </button>
            {c.logo && (
              <button className="btn-ghost" onClick={() => setC({ ...c, logo: undefined })}>
                <X size={14} /> Remove
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const r = new FileReader();
                r.onload = () => setC({ ...c, logo: String(r.result) });
                r.readAsDataURL(f);
              }}
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
              let fresh: CompanyProfile;
              try {
                fresh = await billing.getCompany();
              } catch {
                fresh = c;
              }
              onSaved(fresh);
              toast.success("Company details saved.");
            } catch (e) {
              toast.error(`Could not save company details: ${errMsg(e)}`);
            }
          }}
        >
          Save Company
        </button>
      </div>
    </Modal>
  );
}
