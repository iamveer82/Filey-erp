import { COUNTRY_OPTIONS } from "../lib/taxRegimes";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { dealQuoteContext, linkDealQuotation } from "../lib/crmSales";
import { agentStorageScope, requireAgentStorageScope } from "../lib/agentStorage";
import {
  Plus,
  Trash2,
  ArrowLeft,
  Download,
  Save,
  Building2,
  Upload,
  X,
  Copy,
  Send,
  Settings,
  StickyNote,
  Stamp,
  PenTool,
  Paperclip,
  Landmark,
  SeparatorHorizontal,
  Maximize2,
  FileText,
  FileSignature,
  PackageSearch,
  CheckCircle2,
  Pencil,
} from "lucide-react";
import {
  billing,
  crm,
  erp,
  quotes,
  QuotationSummary,
  QuotationDoc,
  QuotationInput,
  QuotationItem,
  CompanyProfile,
  CrmCustomer,
  Product,
} from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { useUI } from "../lib/ui";
import { SelectMenu } from "../components/ui-menu";
import {
  aed,
  fmtDate,
  money,
  num,
  numInput,
  CURRENCIES,
  errMsg,
  todayYmd,
  localYmd,
  getDisplayCurrency,
} from "../lib/format";
import { getExchangeRates, docAmountInAed } from "../lib/exchange-rates";
import { defaultTaxRate, taxRegimeFor } from "../lib/taxRegimes";
import {
  pickDocNumber,
  loadDocFormats,
  type DocFormats,
} from "../lib/numberFormat";
import {
  sendEmail,
  emailShell,
  esc,
  sendShareEmail,
  bytesToBase64,
} from "../lib/email";
import FitPreview from "../components/FitPreview";
import DocumentPreviewControls from "../components/DocumentPreviewControls";
import { downloadElementAsPdf, elementToPdfBytes } from "../lib/pdfTools";
import { autoSaveDocument } from "../lib/files";
import ColorPicker from "../components/ColorPicker";
import CompanyModal from "../components/CompanyModal";
import { r2, applyRoundOff, type CalcMode } from "../lib/money";
import { startingTemplate } from "../components/DocPresetBar";
import {
  docLineAmount,
  storedLineAmount,
  docTotals,
  paginateItems,
  splitItemMeta,
  mergeItemMeta,
  PB_KEY,
  sanitizeCustomColumns,
  RESERVED_ITEM_COLUMNS,
  DEFAULT_COLUMN_LABELS,
  type DocItem,
} from "../lib/docItems";
import {
  PageHeader,
  ErrorBanner,
  MetricCard,
  DataTable,
  Badge,
  statusTone,
  Modal,
  Field,
  ShareToggle,
  SearchInput,
  FilterChip,
} from "../components/ui";
import { DateField } from "../components/DatePicker";
import {
  RowActions,
  QuickViewModal,
  shareVia,
  type ShareKind,
} from "../components/RowActions";
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
import TemplateDesigner from "../components/TemplateDesigner";
import { offerUpgrade, isPlanLimitError } from "../lib/license";

type CustomColumn = { key: string; label: string };

/* A quotation line carries the same per-line calculation tools an invoice line
 * has. QuotationItem has no columns for them, so — exactly as invoices do —
 * they ride in the item's `custom` jsonb and are unpacked here. Without this
 * the editor could only ever compute qty × rate: a line set to a manual amount
 * or a formula silently reverted, and the quote totalled to the wrong number. */
type Item = QuotationItem & {
  pageBreakBefore?: boolean;
  calcMode?: CalcMode;
  /** Directly-entered amount when calcMode === "manual". */
  amount?: number;
  /** Per-line formula, overriding the doc-level one. */
  itemFormula?: { a: string; b?: string } | null;
};

type Form = Omit<QuotationInput, "items" | "custom_columns" | "doc_type"> & {
  items: Item[];
  customColumns: CustomColumn[];
  stamp?: StampSig;
  signature?: StampSig;
  show_stamp?: boolean;
  show_signature?: boolean;
  unit_price_formula?: { a: string; b: string } | null;
};

const today = () => todayYmd();
const addDays = (n: number) =>
  localYmd(new Date(Date.now() + n * 86400000));

/** The next quotation number: the user's saved format when they have set one,
 *  otherwise the built-in QT- scheme. Mirrors pickInvoiceNumber in Invoicing so
 *  neither document type makes the user retype a number. */
function pickQuoteNumber(existing: string[], formats?: DocFormats): string {
  return pickDocNumber("quote", existing, formats);
}

function blankForm(
  c: CompanyProfile,
  existing: string[] = [],
  formats?: DocFormats
): Form {
  // Same rule as invoicing: new quotes adopt the active display currency and
  // company country controls tax independently.
  const currency = getDisplayCurrency() || c.currency || "AED";
  return {
    number: pickQuoteNumber(existing, formats),
    status: "draft",
    doc_title: "Quotation",
    template: c.default_template || "minimal",
    accent: c.default_accent || "#222222",
    currency,
    seller_name: c.name,
    tax_country_code: c.country_code,
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
    tax_rate: c.tax_type === "None" ? 0 : defaultTaxRate(c.currency, c.default_tax_rate, c.country_code),
    round_off: false,
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

/* Exported for test: these two mappings are where the quotation bug lived, and
 * a mapping that silently drops a field cannot be caught by rendering the page
 * — the editor never displays the figures they feed. They are unit-tested in
 * src/pages/__tests__/quoting-mappings.test.ts. */
export const asDocItem = (it: Item): DocItem => ({
  description: it.product,
  product_id: it.product_id,
  unit_price: it.rate,
  qty: it.qty,
  unit: it.unit,
  custom: it.custom,
  discount: it.discount,
  tax: it.tax,
  pageBreakBefore: it.pageBreakBefore,
  // These three are what docLineAmount() consults before falling back to
  // qty × unit_price. Dropping them here was the whole bug.
  calcMode: it.calcMode,
  amount: it.amount,
  itemFormula: it.itemFormula,
});

/** One quotation item as the document renderer wants it. Shared by the live
 *  preview, the PDF pages and the print view, which each used to build this
 *  object separately — and so each dropped the calc fields independently. */
export const asDocViewItem = (it: {
  description?: string;
  product?: string;
  qty: number;
  unit_price?: number;
  rate?: number;
  unit?: string;
  custom?: Record<string, string> | null;
  discount?: number;
  tax?: number;
  calcMode?: CalcMode;
  amount?: number;
  itemFormula?: { a: string; b?: string } | null;
}): DocViewItem => ({
  description: it.description ?? it.product ?? "",
  qty: it.qty,
  unit_price: it.unit_price ?? it.rate ?? 0,
  unit: it.unit,
  custom: it.custom,
  discount: it.discount,
  tax: it.tax,
  calcMode: it.calcMode,
  amount: it.amount,
  itemFormula: it.itemFormula,
});

const totals = (f: Form) =>
  // applyRoundOff, like invoices: this is the single place a quote's total is
  // computed, so the editor, the preview, the PDF and the emailed copy cannot
  // disagree about the figure.
  applyRoundOff(
    docTotals(f.items.map(asDocItem), f.discount || 0, f.tax_rate || 0, f.unit_price_formula),
    !!f.round_off
  );

export default function Quoting() {
  const { toast, confirm } = useUI();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [company, setCompany] = useState<CompanyProfile | null>(null);
  // Fallback only — a quote saved since the FX freeze carries its own rate.
  const [fxRates, setFxRates] = useState<Record<string, number>>({});
  useEffect(() => {
    void getExchangeRates()
      .then(setFxRates)
      .catch(() => setFxRates({}));
  }, []);
  const [docs, setDocs] = useState<QuotationSummary[]>([]);
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [search, setSearch] = useState("");
  // The saved quotation number format (Settings → Company Details). Loaded once
  // so a new quote numbers itself instead of asking the user to type one.
  const [quoteFmt, setQuoteFmt] = useState<DocFormats>({});
  useEffect(() => {
    loadDocFormats()
      .then(setQuoteFmt)
      .catch(() => {});
  }, []);
  const [statusFilter, setStatusFilter] = useState<
    "all" | "draft" | "sent" | "accepted"
  >("all");
  const [saving, setSaving] = useState(false);
  const commitInFlight = useRef(false);
  const [sourceDeal, setSourceDeal] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [converting, setConverting] = useState(false);
  const [quickView, setQuickView] = useState<{
    d: QuotationSummary;
    doc: QuotationDoc | null;
  } | null>(null);

  const [companyOpen, setCompanyOpen] = useState(false);
  const [custModal, setCustModal] = useState(false);
  const [invModal, setInvModal] = useState(false);

  const [docsLoading, setDocsLoading] = useState(true);
  const [docsError, setDocsError] = useState(false);
  const loadDocs = () => {
    setDocsLoading(true);
    return quotes
      .listDocs()
      .then((rows) => { setDocs(rows); setDocsError(false); })
      .catch(() => { setDocsError(true); toast.error("Failed to load quotations"); })
      .finally(() => setDocsLoading(false));
  };
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

  // Deal/customer links prepare a reviewable draft; opening them writes nothing.
  useEffect(() => {
    if (params.get("new") !== "1" || !company || form || docsLoading) return;
    let active = true;
    const scope = agentStorageScope();
    void (async () => {
      const dealId = params.has("deal") ? Number(params.get("deal")) : null;
      const context = dealId !== null ? await dealQuoteContext(dealId) : null;
      if (context?.deal.quotation_id) { if (active) setParams({ open: String(context.deal.quotation_id) }, { replace: true }); return; }
      const customerId = Number(params.get("customer"));
      const customer = context?.customer || (customerId ? (await crm.customers()).find(c => c.id === customerId) : null);
      if (params.has("customer") && !customer) throw new Error("This company is unavailable. Reopen it from CRM.");
      requireAgentStorageScope(scope ?? "signed-out");
      if (!active) return;
      const draft = blankForm(company, docs.map(d => d.number), quoteFmt);
      if (customer) Object.assign(draft, { customer_id: customer.id, customer_name: customer.company || customer.name, customer_address: customer.address, customer_trn: customer.trn, customer_email: customer.email });
      if (context) { draft.sales_person = context.deal.owner || ""; draft.items[0].product = context.deal.title; }
      setSourceDeal(context?.deal.id ?? null); setForm(draft); setParams({}, { replace: true });
    })().catch(e => { if (active) { toast.error(errMsg(e)); setParams({}, { replace: true }); } });
    return () => { active = false; };
  }, [params, company, form, setParams, docsLoading, docs, quoteFmt, toast]);

  const newQuote = async () => {
    if (!company) return;
    setSourceDeal(null);
    const f = blankForm(company, docs.map((d) => d.number), quoteFmt);
    // The section's preset wins over the profile-wide default template.
    f.template = await startingTemplate("quote", company.default_template, f.template);
    setForm(f);
  };

  const editQuote = useCallback(async (id: number) => {
    try {
      const scope = agentStorageScope();
      const d = await quotes.getDoc(id);
      requireAgentStorageScope(scope ?? "signed-out");
      setSourceDeal(null);
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
        tax_country_code: d.tax_country_code,
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
        round_off: d.round_off ?? false,
        items: d.items.map((i) => {
          // splitItemMeta, not splitPageBreak: a saved quote's calc mode,
          // manual amount and per-line formula live in the same jsonb and were
          // being thrown away on load. discount/tax stay on their real columns.
          const { custom, pageBreakBefore, calcMode, amount, itemFormula } =
            splitItemMeta(i.custom);
          return {
            ...i,
            custom,
            pageBreakBefore,
            calcMode: calcMode || "auto",
            amount,
            itemFormula,
          };
        }),
        customColumns: sanitizeCustomColumns(d.custom_columns || []),
        show_stamp: d.show_stamp ?? false,
        show_signature: d.show_signature ?? false,
        unit_price_formula: d.unit_price_formula || null,
      });
    } catch (e: any) {
      toast.error(e?.message || "Failed to load quotation");
    }
  }, [toast]);

  useEffect(() => {
    if (!params.has("open") || !company) return;
    const id = Number(params.get("open"));
    setParams({}, { replace: true });
    if (Number.isSafeInteger(id) && id > 0) void editQuote(id);
    else toast.error("Choose an existing quotation.");
  }, [params, company, editQuote, setParams, toast]);

  const duplicateQuote = async (id?: number) => {
    setSourceDeal(null);
    try {
      const newBase = {
        number: pickQuoteNumber(docs.map((x) => x.number), quoteFmt),
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
            const { custom, pageBreakBefore, calcMode, amount, itemFormula } =
              splitItemMeta(i.custom);
            return {
              ...i,
              custom,
              pageBreakBefore,
              calcMode: calcMode || "auto",
              amount,
              itemFormula,
            };
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
    if (!form || commitInFlight.current) return;
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

    commitInFlight.current = true;
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
          // discount/tax are deliberately omitted: quotations keep them in real
          // columns, and letting mergeItemMeta also write them into `custom`
          // would store the same percentage twice, in two places free to drift.
          custom: mergeItemMeta({
            custom: it.custom,
            pageBreakBefore: it.pageBreakBefore,
            calcMode: it.calcMode,
            amount: it.amount,
            itemFormula: it.itemFormula,
          }),
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
      payload.round_off = !!form.round_off;

      const id = await quotes.saveDoc(payload as QuotationInput);
      const next = { ...form, id, status: targetStatus ?? form.status };
      setForm(next);
      if (sourceDeal) {
        try { await linkDealQuotation(sourceDeal, id); }
        catch (e) { toast.error(`Quotation saved. CRM link needs attention: ${errMsg(e)} Save again to retry the link.`); await loadDocs(); return; }
      }
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
      commitInFlight.current = false;
      setSaving(false);
    }
  };

  const quoteRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  // Search and status filter, matching how the invoice list narrows: a quote
  // list is mostly "what have I sent that nobody has answered", which searching
  // by number cannot answer.
  const filteredDocs = docs.filter((d) => {
    if (statusFilter !== "all" && (d.status || "draft") !== statusFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      d.number.toLowerCase().includes(q) || d.customer_name.toLowerCase().includes(q)
    );
  });

  const statCcy = company?.currency || "AED";
  // One KPI, one currency: each quote is converted at its own frozen rate
  // before it joins the total.
  const totalValue = docs.reduce(
    (s, d) => s + docAmountInAed(d.total || 0, d.currency, d.fx_rate, fxRates),
    0
  );
  const sentCount = docs.filter((d) => d.status === "sent").length;
  const acceptedCount = docs.filter((d) => d.status === "accepted").length;
  const draftCount = docs.filter((d) => (d.status || "draft") === "draft").length;

  // ---- List-row actions (DEMO parity) ----
  const openQuickView = (d: QuotationSummary) => {
    setQuickView({ d, doc: null });
    quotes
      .getDoc(d.id)
      .then((doc) =>
        setQuickView((qv) => (qv && qv.d.id === d.id ? { d, doc } : qv))
      )
      .catch(() => toast.error("Failed to load quotation details"));
  };

  const findCustomer = (name: string) =>
    customers.find((c) => (c.company || c.name) === name);

  const shareQuote = async (kind: ShareKind, d: QuotationSummary) => {
    const cust = findCustomer(d.customer_name);
    let url = `${location.origin}${location.pathname}#/quoting`;
    try {
      const token = await quotes.publicLink(d.id);
      url = `${location.origin}${location.pathname}#/portal/${token}`;
    } catch {
      /* fall back to the app link */
    }
    const text = `Hi ${d.customer_name || "there"},\n\nQuote ${d.number} for ${money(
      d.total || 0,
      statCcy
    )} is ready. Please review: ${url}`;
    if (kind === "email") {
      try {
        await sendShareEmail(cust?.email || "", `Quotation ${d.number}`, text);
        toast.success(`Quotation emailed to ${cust?.email}`);
      } catch (e) {
        toast.error(errMsg(e));
      }
      return;
    }
    shareVia(kind, {
      phone: cust?.phone || "",
      email: cust?.email || "",
      text,
      url,
    });
    if (kind === "copyLink") toast.success("Public quotation link copied");
  };

  const convertRow = async (d: QuotationSummary) => {
    try {
      const id = await quotes.convertToInvoice(d.id);
      toast.success("Invoice created from quotation.");
      navigate(`/invoicing?open=${id}`);
    } catch (e) {
      if (isPlanLimitError(e)) offerUpgrade();
      else toast.error(`Could not convert: ${errMsg(e)}`);
    }
  };

  const deleteRow = async (d: QuotationSummary) => {
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
  };

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

  const downloadPdf = async () => {
    const el = exportRef.current || quoteRef.current;
    try {
      if (el) await downloadElementAsPdf(el, form?.number || "quotation");
      else window.print();
    } catch (error) {
      toast.error(`Could not export quotation: ${errMsg(error)}`);
    }
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
      setForm({ ...form, [k]: v, ...(k === "currency" && v !== form.currency ? { fx_rate: null } : {}) });
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
      const desc = [p.name, p.description?.trim()].filter(Boolean).join(" - ");
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

    const pages = paginateItems(form.items.map(asDocItem));
    const previewPages = pages.length;
    const curPageIdx = Math.min(previewPage, previewPages) - 1;
    const pageStartIndex = pages
      .slice(0, curPageIdx)
      .reduce((n, g) => n + g.length, 0);
    const isLastPreviewPage = curPageIdx === previewPages - 1;

    const viewPages = paginateItems(form.items.map(asDocItem));
    const viewPageCount = viewPages.length;
    const viewPageIdx = Math.min(viewPage, viewPageCount) - 1;
    const viewPageStart = viewPages
      .slice(0, viewPageIdx)
      .reduce((n, g) => n + g.length, 0);
    const isLastViewPage = viewPageIdx === viewPageCount - 1;

    const emailQuote = async () => {
      if (saving || sending || converting) return;
      if (!form.customer_email) {
        toast.error("Add a customer email to send this quotation.");
        return;
      }
      setSending(true);
      try {
        const savedId = await commit();
        if (!savedId) return;
        const t = totals(form);
        let portalUrl = "";
        try {
          const token = await quotes.publicLink(savedId);
          portalUrl = `${location.origin}${location.pathname}#/portal/${token}`;
        } catch {
          /* link optional */
        }
        // Sending a quotation includes its PDF; report export failures before
        // dispatch so the recipient cannot receive an incomplete document.
        let attachments: { filename: string; content: string }[] | undefined;
        try {
          const el = exportRef.current || quoteRef.current;
          if (!el) throw new Error("Quotation preview is not ready.");
          if (el) {
            const pdf = await elementToPdfBytes(el, form.number || "quotation");
            attachments = [
              {
                filename: `${form.number || "quotation"}.pdf`,
                content: bytesToBase64(pdf.bytes),
              },
            ];
          }
        } catch (error) {
          throw new Error(`Could not create the quotation PDF: ${errMsg(error)}. The email was not sent.`);
        }
        try {
          await sendEmail({
            to: form.customer_email,
            subject: `Quotation ${form.number} from ${form.seller_name}`,
            attachments,
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
      } catch (e) {
        toast.error(errMsg(e));
      } finally {
        setSending(false);
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
        const id = await quotes.convertToInvoice(form.id);
        toast.success("Invoice created from quotation.");
        navigate(`/invoicing?open=${id}`);
      } catch (e) {
        if (isPlanLimitError(e)) offerUpgrade();
        else toast.error(`Could not convert: ${errMsg(e)}`);
      } finally {
        setConverting(false);
      }
    };

    const docViewForm = {
      ...form,
      items: form.items.map(asDocViewItem),
      issue_date: form.quote_date,
      due_date: form.valid_until,
      customColumns: form.customColumns,
    };

    return (
      <fieldset disabled={saving || sending || converting} aria-busy={saving || sending || converting} className="m-0 min-w-0 border-0 p-0">
        {company && (
          <CompanyModal
            open={companyOpen}
            docType="quote"
            company={company}
            onClose={() => setCompanyOpen(false)}
            onSaved={(c) => {
              setCompany(c);
              setForm((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  seller_name: c.name,
    tax_country_code: c.country_code,
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
          <PageHeader
            title={form.id ? "Edit Quotation" : "New Quotation"}
            subtitle={sourceDeal ? `Prepared from CRM deal #${sourceDeal}. Review the items and prices before saving.` : "Build quotations with per-line discount/tax and convert them to invoices"}
            action={<div className="no-print flex items-center gap-2 flex-wrap">
              <button
                className="btn-ghost shrink-0"
                onClick={() => {
                  setForm(null);
                  loadDocs();
                }}
                aria-label="Back"
              >
                <ArrowLeft size={15} /> Back
              </button>
              <Badge tone={statusTone(form.status)}>{form.status}</Badge>
              {!form.id && (
                <span className="text-xs font-medium text-brand-400">Unsaved</span>
              )}
              <button className="btn-ghost" onClick={() => setViewOpen(true)}>
                <Maximize2 size={15} /> Preview
              </button>
              <button className="btn-ghost" onClick={downloadPdf} title="Download PDF (Ctrl+P)">
                <Download size={15} /> PDF
              </button>
              <button
                className="btn-primary"
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
              <button
                className="btn-ghost"
                onClick={() => setCompanyOpen(true)}
                title="Edit company details"
              >
                <Building2 size={15} /> Company
              </button>
              {/* Status changes remain separate from the primary Save action. */}
              {form.status === "draft" ? (
                <button
                  className="btn-ghost"
                  onClick={() => commit("sent")}
                  disabled={saving}
                  title="Mark this quotation as sent to the customer"
                >
                  <CheckCircle2 size={15} /> Mark as sent
                </button>
              ) : form.status === "sent" ? (
                <button
                  className="btn-ghost"
                  onClick={() => commit("accepted")}
                  disabled={saving}
                  title="The customer accepted this quotation"
                >
                  <CheckCircle2 size={15} /> Mark as accepted
                </button>
              ) : (
                <button
                  className="btn-ghost"
                  onClick={() => commit("draft")}
                  disabled={saving}
                  title="Move this quotation back to draft"
                >
                  <Pencil size={15} /> Move to draft
                </button>
              )}
              <button
                className="btn-ghost"
                onClick={emailQuote}
                disabled={saving || sending || converting || !form.customer_email}
                title="Save and email the quotation to the customer"
              >
                <Send size={15} /> {sending ? "Sending…" : "Send"}
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
                className="btn-ghost"
                onClick={convertToInvoice}
                disabled={!form.id || converting}
                title="Convert to invoice"
              >
                <FileText size={15} /> {converting ? "Converting…" : "Convert"}
              </button>
            </div>}
          />

          <ResizablePanels
            left={
              <div className="no-print space-y-4">
                {/* 1 · Template */}
                <Step
                  n={1}
                  title="Choose Template"
                  subtitle="Select a template for your quotation"
                  action={
                    <div className="flex flex-wrap items-center gap-2">
                    <button className="btn-ghost text-xs" onClick={() => setViewAll((value) => !value)}>
                      {viewAll ? "Show less" : "View all templates"}
                    </button>
                    <button
                      className="btn-ghost text-xs flex items-center gap-1"
                      onClick={() => setDesigning(true)}
                    >
                      <Plus size={13} /> Create template
                    </button>
                    </div>
                  }
                >
                  <DocTemplateGallery
                                      hideHeader
                                      key={tplNonce}
                                      value={form.template}
                                      onChange={(id) => set("template", id)}
                                      onDesign={() => setDesigning(true)}
                                      docType="quote"
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
                          <SelectMenu
                            value={form.customer_id != null ? String(form.customer_id) : ""}
                            onChange={(v) => {
                              const c = customers.find((x) => String(x.id) === v);
                              if (c) applyCustomer(c);
                            }}
                            options={[
                              {
                                value: "",
                                label: customers.length
                                  ? "Select saved customer…"
                                  : "No saved customers",
                              },
                              ...customers.map((c) => ({
                                value: String(c.id),
                                label: c.company || c.name,
                              })),
                            ]}
                          />
                          <button
                            type="button"
                            className="btn-ghost shrink-0"
                          onClick={() => setCustModal(true)}
                          title="Add customer"
                          aria-label="Add customer"
                          >
                            <Plus size={15} />
                          </button>
                        </div>
                      </Field>
                      <Field label="Customer / Company Name">
                        <input aria-label="Customer name"
                          className="input"
                          placeholder="Gulf Line Trading LLC"
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
                          <input aria-label="Customer email"
                            className="input"
                            placeholder="Email"
                            value={form.customer_email ?? ""}
                            onChange={(e) => set("customer_email", e.target.value)}
                          />
                          <input aria-label="Customer tax registration number"
                            className="input"
                            placeholder={taxRegimeFor(form.currency, form.tax_country_code).trnLabel}
                            value={form.customer_trn ?? ""}
                            onChange={(e) => set("customer_trn", e.target.value)}
                          />
                        </div>
                      </Field>
                    </div>
                    <div className="space-y-3">
                      <Field label="Document Title">
                        <input aria-label="Document title"
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
                        <input aria-label="Quotation number"
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
                        <Field label="Tax country">
                  <SelectMenu value={form.tax_country_code || ""} onChange={v => setForm({ ...form, tax_country_code: v || undefined, template:v && v !== "AE" && /(^|-)uae($|-)/.test(form.template || "") ? "minimal" : form.template })}
                    options={[{ value:"", label:"Legacy currency defaults" }, ...COUNTRY_OPTIONS]} />
                </Field>
                <Field label="Currency">
                          <SelectMenu
                            value={form.currency || "AED"}
                            onChange={(v) => set("currency", v)}
                            options={CURRENCIES.map((c) => ({
                              value: c.code,
                              label: `${c.code} - ${c.name}`,
                            }))}
                          />
                        </Field>
                        <Field label="Sales Person">
                          <input aria-label="Salesperson"
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
                        <Plus size={12} /> Add field
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
                        role="switch"
                        aria-label="Multiply custom field with rate"
                        aria-checked={!!form.unit_price_formula}
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
                        <SelectMenu
                          size="sm"
                          className="w-auto"
                          value={form.unit_price_formula.a || ""}
                          onChange={(v) =>
                            set("unit_price_formula", {
                              a: v,
                              b: "unit_price",
                            })
                          }
                          options={[
                            { value: "", label: "Select field" },
                            { value: "qty", label: "Qty" },
                            ...form.customColumns.map((c) => ({
                              value: c.key,
                              label: c.label,
                            })),
                          ]}
                        />
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
                          <th className="py-2 px-2 w-24 text-right">Calc</th>
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
                                aria-label={`Remove ${col.label} column`}
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
                              <input aria-label={"Description for line " + (i + 1)}
                                className="input"
                                placeholder="Item description"
                                value={it.product}
                                onChange={(e) => setItem(i, { product: e.target.value })}
                              />
                            </td>
                            <td className="py-2 px-2">
                              <input aria-label={"Quantity for line " + (i + 1)}
                                type="number"
                                className="input text-right !px-2"
                                value={it.qty || ""}
                                placeholder="0"
                                onChange={(e) => {
                                  const qty = numInput(e.target.value);
                                  // On a manual line the amount is what the user
                                  // typed; changing qty re-derives the rate so
                                  // the printed line still reads consistently.
                                  if (it.calcMode === "manual") {
                                    setItem(i, {
                                      qty,
                                      rate: qty ? r2((it.amount || 0) / qty) : it.amount || 0,
                                    });
                                  } else {
                                    setItem(i, { qty });
                                  }
                                }}
                              />
                            </td>
                            <td className="py-2 px-2">
                              <input aria-label={"Unit for line " + (i + 1)}
                                className="input text-right !px-2"
                                placeholder="pcs"
                                value={it.unit || ""}
                                list="unit-suggestions"
                                onChange={(e) => setItem(i, { unit: e.target.value })}
                              />
                            </td>
                            <td className="py-2 px-2">
                              <SelectMenu
                                size="sm"
                                className="w-auto"
                                ariaLabel="How this line is calculated"
                                value={
                                  it.calcMode === "manual"
                                    ? "manual"
                                    : it.calcMode === "formula" && it.itemFormula?.a
                                      ? it.itemFormula.a === "qty"
                                        ? "qty"
                                        : `formula:${it.itemFormula.a}`
                                      : "auto"
                                }
                                onChange={(v) => {
                                  if (v === "auto") {
                                    setItem(i, { calcMode: "auto", itemFormula: null });
                                  } else if (v === "manual") {
                                    // Seed the manual amount with what the line
                                    // shows now, so switching mode never changes
                                    // the total on its own.
                                    const amount = docLineAmount(
                                      asDocItem(it),
                                      form.unit_price_formula
                                    );
                                    setItem(i, {
                                      calcMode: "manual",
                                      amount,
                                      rate: it.qty ? r2(amount / it.qty) : amount,
                                      itemFormula: null,
                                    });
                                  } else if (v === "qty") {
                                    setItem(i, {
                                      calcMode: "formula",
                                      itemFormula: { a: "qty", b: "unit_price" },
                                    });
                                  } else if (v.startsWith("formula:")) {
                                    setItem(i, {
                                      calcMode: "formula",
                                      itemFormula: {
                                        a: v.slice("formula:".length),
                                        b: "unit_price",
                                      },
                                    });
                                  }
                                }}
                                options={[
                                  { value: "auto", label: "Auto" },
                                  { value: "manual", label: "Manual" },
                                  { value: "qty", label: "Formula: Qty" },
                                  ...form.customColumns.map((c) => ({
                                    value: `formula:${c.key}`,
                                    label: `Formula: ${c.label}`,
                                  })),
                                ]}
                              />
                            </td>
                            {form.customColumns.map((col) => (
                              <td key={col.key} className="py-2 px-2">
                                <input aria-label={col.label + " for line " + (i + 1)}
                                  className="input text-right !px-2 !py-1 text-xs"
                                  placeholder={col.label}
                                  value={it.custom?.[col.key] || ""}
                                  onChange={(e) => setItemCustom(i, col.key, e.target.value)}
                                />
                              </td>
                            ))}
                            <td className="py-2 px-2">
                              <input aria-label={"Unit price for line " + (i + 1)}
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
                              <input aria-label={"Discount percent for line " + (i + 1)}
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
                              <input aria-label={"Tax percent for line " + (i + 1)}
                                type="number"
                                className="input text-right !px-2"
                                placeholder="0"
                                value={it.tax || ""}
                                onChange={(e) => setItem(i, { tax: numInput(e.target.value) })}
                              />
                            </td>
                            <td className="py-2 px-2 text-right font-medium text-ink">
                              {it.calcMode === "manual" ? (
                                <input aria-label={"Line amount for line " + (i + 1)}
                                  type="number"
                                  className="input text-right !px-2"
                                  placeholder="0"
                                  value={it.amount || ""}
                                  onChange={(e) => {
                                    const amount = numInput(e.target.value);
                                    setItem(i, {
                                      amount,
                                      rate: it.qty ? r2(amount / it.qty) : amount,
                                    });
                                  }}
                                />
                              ) : (
                                m(docLineAmount(asDocItem(it), form.unit_price_formula))
                              )}
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
                                  className={`btn-ghost h-10 w-10 p-0 disabled:opacity-30 ${
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
                                  className="btn-ghost h-10 w-10 p-0 hover:text-danger hover:bg-danger/10"
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
                            aria-label={`Remove ${col.label} field`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Document-level settings, matching the invoice editor: VAT
                      is a yes/no first and a rate second, because "do I charge
                      VAT on this" is the question a user actually has. */}
                  <div className="mt-4 max-w-xs">
                    <p className="text-xs font-semibold text-brand-500 mb-1.5">Apply VAT</p>
                    <div className="flex rounded-xl bg-brand-50 p-0.5">
                      {(
                        [
                          ["Yes", true],
                          ["No", false],
                        ] as const
                      ).map(([lbl, on]) => {
                        const active = ((form.tax_rate || 0) > 0) === on;
                        return (
                          <button
                            key={lbl}
                            type="button"
                            aria-pressed={active}
                            onClick={() =>
                              setForm({
                                ...form,
                                tax_rate: on
                                  ? (form.tax_rate || 0) > 0
                                    ? form.tax_rate
                                    : 5
                                  : 0,
                              })
                            }
                            className={`btn-ghost flex-1 ${
                              active
                                ? "bg-background text-foreground"
                                : "text-brand-500 hover:text-ink"
                            }`}
                          >
                            {lbl}
                          </button>
                        );
                      })}
                    </div>
                    {(form.tax_rate || 0) > 0 && (
                      <input aria-label="Document tax rate percent"
                        type="number"
                        className="input mt-2"
                        placeholder={`${taxRegimeFor(form.currency, form.tax_country_code).taxLabel} rate %`}
                        value={form.tax_rate}
                        onChange={(e) =>
                          setForm({ ...form, tax_rate: numInput(e.target.value) })
                        }
                      />
                    )}
                  </div>

                  {/* Same switch invoices carry, so a quote and the invoice it
                      becomes agree on the figure the customer signs off. */}
                  <label className="mt-3 flex items-center gap-2 text-sm text-ink cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!form.round_off}
                      onChange={(e) => setForm({ ...form, round_off: e.target.checked })}
                    />
                    Round off total to whole {form.currency || "AED"}
                  </label>

                  <div className="flex flex-wrap gap-2 mt-3">
                    <button className="btn-primary" onClick={addItem}>
                      <Plus size={14} /> Add item
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
                      setTplNonce((n) => n + 1);
                      setDesigning(false);
                    }}
                    onClose={() => setDesigning(false)}
                  />
                )}

                <div className="card !p-4">
                  <div className="no-print flex items-center justify-between mb-3">
                    <div>
                      {/* Not a numbered step, same as the invoice editor: this
                          panel sits alongside the whole form and stays live. */}
                      <p className="font-semibold text-ink">Preview</p>
                      <p className="text-xs text-brand-500 mt-0.5">
                        This is how your quotation will look
                      </p>
                    </div>
                  </div>

                  <FitPreview baseWidth={device === "desktop" ? 794 : 420} zoom={zoom} padding={0}>
                    {/* ponytail: keep quote preview + PDF English regardless of app lang */}
                    <div ref={quoteRef} data-no-i18n dir="ltr">
                      {/* Pinned to the A4 sheet the way the invoice preview is.
                          Without an explicit width the page had none of its own
                          and collapsed to whatever the panel gave it, so the
                          document read as cut off at both edges; the height was
                          short of A4 too (1027 against 1123 at 96dpi). */}
                      <div
                        style={{
                          width: device === "desktop" ? 794 : 420,
                          minHeight: device === "desktop" ? 1123 : 594,
                          position: "relative",
                          padding: device === "desktop" ? 48 : 25,
                          boxSizing: "border-box",
                          background: "#fff",
                        }}
                      >
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
                            asDocViewItem
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
                    const exportPages = paginateItems(form.items.map(asDocItem));
                    return (
                      <div
                        ref={exportRef}
                        aria-hidden
                        data-no-i18n
                        dir="ltr"
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
                                    asDocViewItem
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
                        className="btn-ghost disabled:opacity-40"
                        disabled={previewPage <= 1}
                        onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                      >
                        Back
                      </button>
                      <span className="text-xs text-brand-500 font-medium">
                        Page {previewPage} / {previewPages}
                      </span>
                      <button
                        className="btn-ghost disabled:opacity-40"
                        disabled={previewPage >= previewPages}
                        onClick={() => setPreviewPage((p) => Math.min(previewPages, p + 1))}
                      >
                        Next
                      </button>
                    </div>
                  )}

                  <DocumentPreviewControls device={device} onDeviceChange={setDevice} zoom={zoom} onZoomChange={setZoom}>
                    <button className="btn-primary" onClick={() => commit()} disabled={saving}>
                      <Save size={14} /> {saving ? "Saving…" : "Save"}
                    </button>
                    <button className="btn-ghost" onClick={downloadPdf}>
                      <Download size={14} /> PDF
                    </button>
                  </DocumentPreviewControls>
                </div>
              </div>
            }
          />

          {/* Portaled out of <main>'s scrolling subtree - WebView2 half-paints
              a `fixed` overlay that stays inside it. */}
          {viewOpen && <Modal open onClose={() => setViewOpen(false)} title={form.number || "Quotation preview"} size="full">
            <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
              {viewPageCount > 1 && <div className="flex flex-wrap items-center gap-2">
              <button className="btn-ghost" disabled={viewPage <= 1} onClick={() => setViewPage(p => Math.max(1, p - 1))} aria-label="Back to previous preview page">Back</button>
              <span className="text-xs text-muted-foreground tabular-nums">Page {viewPage} of {viewPageCount}</span>
              <button className="btn-ghost" disabled={viewPage >= viewPageCount} onClick={() => setViewPage(p => Math.min(viewPageCount, p + 1))} aria-label="Next preview page">Next</button>
            </div>}
              <button className="btn-ghost ml-auto" onClick={downloadPdf}><Download size={15} /> PDF</button>
            </div>
            <div className="min-w-0 overflow-auto">
                  <div className="mx-auto max-w-5xl">
                    <div
                      className="paper-texture rounded-xl border border-brand-200 p-8 shadow-sm dark:bg-white min-h-[1123px]"
                      data-no-i18n
                      dir="ltr"
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
                            asDocViewItem
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
          </Modal>}
        </div>
      </fieldset>
    );
  }

  return (
    <div>
      <PageHeader
        title="Quoting"
        subtitle="Draft, send and convert quotes into invoices"
        action={
          <div className="flex gap-2">
            <button className="btn-primary" onClick={newQuote}>
              <Plus size={16} /> New quote
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 joined-kpis mb-4">
        <MetricCard
          label="Quotes"
          value={num(docs.length)}
          change={
            draftCount > 0 ? `${num(draftCount)} in draft` : "None waiting"
          }
          changeTone={draftCount > 0 ? "warn" : "up"}
        />
        <MetricCard
          label="Total Value"
          value={aed(totalValue)}
          change="Quoted across all customers"
          changeTone="up"
        />
        <MetricCard
          label="Sent"
          value={num(sentCount)}
          change={sentCount > 0 ? "With customers" : "None"}
          changeTone="up"
        />
        <MetricCard
          label="Accepted"
          value={num(acceptedCount)}
          change={acceptedCount > 0 ? "Converted to invoices" : "None yet"}
          changeTone={acceptedCount > 0 ? "up" : "warn"}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search quote or customer…"
          className="max-w-xs"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip
            active={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
            count={docs.length}
          >
            All
          </FilterChip>
          <FilterChip
            active={statusFilter === "draft"}
            onClick={() => setStatusFilter("draft")}
            count={docs.filter((d) => (d.status || "draft") === "draft").length}
          >
            Draft
          </FilterChip>
          <FilterChip
            active={statusFilter === "sent"}
            onClick={() => setStatusFilter("sent")}
            count={sentCount}
          >
            Sent
          </FilterChip>
          <FilterChip
            active={statusFilter === "accepted"}
            onClick={() => setStatusFilter("accepted")}
            tone="success"
            count={acceptedCount}
          >
            Accepted
          </FilterChip>
        </div>
      </div>

      {docsError && (
        <div className="mb-4">
          <ErrorBanner message="Could not refresh quotations. Displayed records may be incomplete." />
          <button className="btn-ghost mt-2" disabled={docsLoading} onClick={() => void loadDocs()}>
            {docsLoading ? "Retrying…" : "Retry"}
          </button>
        </div>
      )}
      <DataTable<QuotationSummary>
        pageSize={10}
        rows={filteredDocs}
        loading={docsLoading}
        empty={
          docsError
            ? "Quotations could not be loaded"
            : search ? "No quotes match your search" : "No quotes yet - create your first one"
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
              await quotes.deleteDocs(sel.map((d) => d.id));
              loadDocs();
              toast.success(`Deleted ${sel.length}.`);
            },
          },
        ]}
        columns={[
          {
            key: "no",
            label: "Quote",
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
            label: "Amount",
            sortValue: (d) => d.total,
            render: (d) => (
              <span className="font-medium">{money(d.total, d.currency || statCcy)}</span>
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
            label: "Actions",
            render: (d) => (
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    convertRow(d);
                  }}
                    className="btn-ghost"
                  title="Convert to invoice"
                >
                  <FileSignature size={13} /> Convert
                </button>
                <RowActions
                  onView={() => openQuickView(d)}
                  onEdit={() => editQuote(d.id)}
                  onCopy={() => duplicateQuote(d.id)}
                  onDelete={() => deleteRow(d)}
                  onSend={{
                    whatsapp: () => shareQuote("whatsapp", d),
                    email: () => shareQuote("email", d),
                    sms: () => shareQuote("sms", d),
                    copyLink: () => shareQuote("copyLink", d),
                  }}
                />
              </div>
            ),
          },
        ]}
      />

      {company && (
        <CompanyModal
          open={companyOpen}
            docType="quote"
          company={company}
          onClose={() => setCompanyOpen(false)}
          onSaved={(c) => {
            setCompany(c);
            setCompanyOpen(false);
          }}
        />
      )}

      <QuickViewModal
        open={!!quickView}
        onClose={() => setQuickView(null)}
        onEdit={
          quickView
            ? () => {
                const id = quickView.d.id;
                setQuickView(null);
                editQuote(id);
              }
            : undefined
        }
        data={
          quickView
            ? {
                title: `Quote ${quickView.d.number}`,
                subtitle: `For ${quickView.d.customer_name}`,
                badge: (
                  <Badge tone={statusTone(quickView.doc?.status || quickView.d.status)}>
                    {quickView.doc?.status || quickView.d.status}
                  </Badge>
                ),
                meta: [
                  { label: "Customer", value: quickView.d.customer_name },
                  { label: "Quote date", value: fmtDate(quickView.d.quote_date) },
                  { label: "Valid until", value: fmtDate(quickView.d.valid_until) },
                  { label: "Currency", value: quickView.doc?.currency || statCcy },
                  ...(quickView.doc?.sales_person
                    ? [{ label: "Sales person", value: quickView.doc.sales_person }]
                    : []),
                ],
                items: quickView.doc?.items
                  .filter((i) => i.product.trim())
                  .map((i) => ({
                    desc: i.product,
                    qty: i.qty,
                    price: i.rate,
                    amount: storedLineAmount(
                      {
                        qty: i.qty,
                        unit_price: i.rate,
                        custom: i.custom,
                        discount: i.discount,
                        tax: i.tax,
                      },
                      quickView.doc?.unit_price_formula
                    ),
                  })),
                total: quickView.d.total,
                currency: quickView.doc?.currency || statCcy,
                notes: quickView.doc?.notes || undefined,
              }
            : null
        }
      />
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
          <input aria-label="Company name"
            className="input"
            placeholder="Gulf Line Trading LLC"
            value={f.company}
            onChange={(e) => setF({ ...f, company: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Contact Name">
            <input aria-label="Contact name"
              className="input"
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
          </Field>
          <Field label="Phone">
            <input aria-label="Phone number"
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
            <input aria-label="Email address"
              className="input"
              value={f.email}
              onChange={(e) => setF({ ...f, email: e.target.value })}
            />
          </Field>
          <Field label="Tax registration ID">
            <input aria-label="Tax registration number"
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
