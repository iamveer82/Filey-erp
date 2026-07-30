import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
  Check,
  CheckCircle2,
  Send,
  Monitor,
  Smartphone,
  Minus,
  Settings,
  StickyNote,
  Stamp,
  PenTool,
  Image as ImageIcon,
  Paperclip,
  CreditCard,
  Sparkles,
  Repeat,
  Maximize2,
  FileText,
  Wallet,
  PackageSearch,
  Landmark,
  SeparatorHorizontal,
  FileCode,
} from "lucide-react";
import {
  advances,
  billing,
  crm,
  erp,
  recurrences,
  InvoiceDocSummary,
  InvoiceDocInput,
  InvoicePayment,
  CompanyProfile,
  CrmCustomer,
  Product,
  Recurrence,
} from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { useUI } from "../lib/ui";
import {
  fmtDate,
  money,
  num,
  numInput,
  CURRENCIES,
  errMsg,
  todayYmd,
  localYmd,
} from "../lib/format";
import ColorPicker from "../components/ColorPicker";
import { invoiceLineAmount, r2, applyRoundOff } from "../lib/money";
import { docLineAmount, docTotals } from "../lib/docItems";
import { DateField } from "../components/DatePicker";
import { nextDocNumber, nextFromPattern, hasCounter } from "../lib/docNumber";
import { loadInvoiceFormat } from "../lib/numberFormat";
import { sendEmail, emailShell, esc, bytesToBase64 } from "../lib/email";
import FitPreview from "../components/FitPreview";
import DocView from "../components/DocView";
import StatStrip from "../components/StatStrip";
import { downloadElementAsPdf, elementToPdfBytes } from "../lib/pdfTools";
import { autoSaveDocument } from "../lib/files";
import {
  splitItemMeta,
  mergeItemMeta,
  PB_KEY,
  CM_KEY,
  MA_KEY,
  FA_KEY,
  FB_KEY,
} from "../lib/docItems";
import ScanDocModal from "../components/ScanDocModal";
import { CustomerAdvancesPanel } from "../components/AdvanceCard";
import TemplateDesigner, {
  loadCustomTemplates,
  deleteCustomTemplate,
  syncCustomTemplates,
  type CustomTemplate,
} from "../components/TemplateDesigner";
import TemplateTilePreview from "../components/TemplateTilePreview";
import {
  StampSignatureLayer,
  StampSigAdjust,
  DraggableBlock,
  type StampSig,
} from "../components/StampSignature";
import {
  BankDetailsBlock,
  loadBankInfo,
  hasBankInfo,
  EMPTY_BANK,
  type BankInfo,
} from "../components/BankDetails";
import {
  loadCompanyStampSig,
  EMPTY_STAMP_SIG,
  type CompanyStampSig,
} from "../components/StampSignatureSettings";
import { ResizablePanels } from "../components/ResizablePanels";
import { validateEInvoice, buildInvoiceXml } from "../lib/einvoiceXml";
import {
  INVOICE_TYPE_CODES,
  PAYMENT_MEANS_CODES,
  TAX_CATEGORY_CODES,
  TRANSACTION_TYPE_FLAGS,
  EMIRATES,
  DEFAULT_INVOICE_TYPE_CODE,
  DEFAULT_PAYMENT_MEANS_CODE,
  DEFAULT_TRANSACTION_TYPE,
  DEFAULT_TAX_CATEGORY,
  UAE_COUNTRY_CODE,
  CORRECTIVE_TYPE_CODES,
  decodeTransactionType,
  encodeTransactionType,
} from "../lib/einvoice";
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
  FilterChip,
  ToggleTile,
} from "../components/ui";
import {
  RowActions,
  QuickViewModal,
  shareVia,
  type QuickViewData,
  type ShareKind,
} from "../components/RowActions";

type CustomColumn = { key: string; label: string };
type Item = {
  product_id?: number;
  description: string;
  qty: number;
  unit_price: number;
  unit: string;
  custom: Record<string, string>;
  /** Start a new page in the generated PDF/preview at this item. */
  pageBreakBefore?: boolean;
  /** How this line's amount is calculated: auto (default), manual, or formula. */
  calcMode: "auto" | "manual" | "formula";
  /** Directly-entered amount when calcMode === 'manual'. */
  amount: number;
  /** Per-line formula multiplier field when calcMode === 'formula'. */
  itemFormula: { a: string; b?: string } | null;
  /** UAE e-invoice tax category code (S/Z/E/O/AE). */
  tax_category?: string;
  /** Per-line discount % (Vyapar parity) — persisted via item custom meta. */
  discount?: number;
};

// Pages are driven only by manual breaks set by the user. Default = one A4 page.
function paginateItems(items: Item[]): Item[][] {
  const pages: Item[][] = [[]];
  items.forEach((it, i) => {
    const cur = pages[pages.length - 1];
    if (i > 0 && it.pageBreakBefore) {
      pages.push([it]);
    } else {
      cur.push(it);
    }
  });
  return pages;
}

type Form = Omit<InvoiceDocInput, "items" | "doc_type"> & {
  items: Item[];
  customColumns: CustomColumn[];
  stamp?: StampSig;
  signature?: StampSig;
  show_stamp?: boolean;
  show_signature?: boolean;
  show_logo?: boolean;
  show_bank?: boolean;
  /** Customer advance applied to this invoice (subtracted on the document). */
  advance_applied?: number | null;
  /** Optional formula: unit_price = fieldA × fieldB. */
  unit_price_formula?: { a: string; b: string } | null;
  // e-invoice: corrective-doc reference + AED rate for foreign-currency VAT.
  original_invoice_number?: string | null;
  original_invoice_date?: string | null;
  aed_exchange_rate?: number | null;
};

const TEMPLATES = [
  { id: "minimal", name: "Minimal" },
  { id: "fta", name: "UAE FTA Tax Invoice" },
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
];

const today = () => todayYmd();
const addDays = (n: number) =>
  localYmd(new Date(Date.now() + n * 86400000));

/** VAT rate that actually applies to a line: its own override, else the
 *  document rate, and zero for anything not standard-rated. The editor's
 *  per-line VAT column used the document rate flat, so a zero-rated or exempt
 *  line was shown 5% VAT that the totals correctly never charged. */
const lineTaxRate = (
  it: { tax_category?: string; tax?: number },
  docRate: number
): number => {
  if ((it.tax_category ?? DEFAULT_TAX_CATEGORY) !== "S") return 0;
  return (it.tax || 0) > 0 ? it.tax! : docRate;
};

// Payment-terms presets — picking one autofills Due Date from Invoice Date.
const PAYMENT_TERMS: { id: string; label: string; days: number }[] = [
  { id: "receipt", label: "Due on Receipt", days: 0 },
  { id: "net7", label: "Net 7", days: 7 },
  { id: "net15", label: "Net 15", days: 15 },
  { id: "net30", label: "Net 30", days: 30 },
  { id: "net60", label: "Net 60", days: 60 },
];
const addDaysTo = (iso: string, n: number) =>
  new Date(new Date(iso + "T00:00:00Z").getTime() + n * 86400000)
    .toISOString()
    .slice(0, 10);

const RESERVED_ITEM_COLUMNS = new Set([
  "description",
  "qty",
  "unit",
  "unit_price",
  "amount",
  "tax",
  "product_id",
  "id",
  PB_KEY,
  CM_KEY,
  MA_KEY,
  FA_KEY,
  FB_KEY,
]);
const DEFAULT_COLUMN_LABELS = new Set([
  "description",
  "qty",
  "unit",
  "unit price",
  "amount",
  "tax",
]);
export const sanitizeCustomColumns = (cols: CustomColumn[]): CustomColumn[] =>
  cols.filter(
    (c) =>
      !RESERVED_ITEM_COLUMNS.has(c.key) &&
      !DEFAULT_COLUMN_LABELS.has(c.label.toLowerCase().trim())
  );

export type DocMode = "sales" | "purchase";

/** Next document number: a user-defined sales-invoice format when set,
 *  otherwise the built-in PREFIX-YYYY-NNNN scheme. Purchase invoices always
 *  use the built-in PINV scheme. */
function pickInvoiceNumber(
  mode: DocMode,
  existing: string[],
  format?: string
): string {
  if (mode === "sales" && format && hasCounter(format))
    return nextFromPattern({ pattern: format, existing });
  return nextDocNumber({ prefix: mode === "purchase" ? "PINV" : "INV", existing });
}

function blankForm(
  c: CompanyProfile,
  existing: string[] = [],
  mode: DocMode = "sales",
  format?: string
): Form {
  return {
    number: pickInvoiceNumber(mode, existing, format),
    status: "draft",
    doc_title: mode === "purchase" ? "Purchase Invoice" : "Tax Invoice",
    template: c.default_template || "minimal",
    accent: c.default_accent || "#222222",
    currency: c.currency || "AED",
    seller_name: c.name,
    seller_address: c.address,
    seller_trn: c.trn,
    seller_email: c.email,
    seller_phone: c.phone,
    logo: c.logo,
    // UAE e-invoice: autofill seller identity from company settings (once).
    seller_city: c.city,
    seller_country_subdivision: c.country_subdivision,
    seller_legal_id: c.legal_id,
    seller_legal_id_type: c.legal_id_type,
    customer_name: "",
    customer_address: "",
    customer_trn: "",
    customer_email: "",
    issue_date: today(),
    due_date: undefined,
    round_off: false,
    notes: "Thank you for your business.",
    terms: "Payment due within 30 days.",
    tax_rate: c.default_tax_rate ?? 5,
    discount: 0,
    // UAE e-invoice (Peppol PINT-AE) — sensible defaults; user overrides as needed.
    invoice_type_code: DEFAULT_INVOICE_TYPE_CODE,
    transaction_type: DEFAULT_TRANSACTION_TYPE,
    payment_means_code: DEFAULT_PAYMENT_MEANS_CODE,
    buyer_country_code: UAE_COUNTRY_CODE,
    items: [
      {
        description: "",
        qty: 1,
        unit_price: 0,
        unit: "",
        custom: {},
        pageBreakBefore: false,
        calcMode: "auto",
        amount: 0,
        itemFormula: null,
        tax_category: DEFAULT_TAX_CATEGORY,
      },
    ],
    customColumns: [],
    show_stamp: false,
    show_signature: false,
    show_logo: false,
    show_bank: false,
    advance_applied: 0,
    unit_price_formula: null,
  };
}

export default function Invoicing({ mode = "sales" }: { mode?: DocMode } = {}) {
  const isPurchase = mode === "purchase";
  const partyLabel = isPurchase ? "Supplier" : "Customer";
  const { toast, confirm } = useUI();
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [numFmt, setNumFmt] = useState("");
  const [docs, setDocs] = useState<InvoiceDocSummary[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [payFor, setPayFor] = useState<InvoiceDocSummary | null>(null);
  const [recurs, setRecurs] = useState<Recurrence[]>([]);
  const [search, setSearch] = useState("");
  // DEMO parity: status filter chips (All/Draft/Sent/Paid/Overdue).
  const [statusFilter, setStatusFilter] = useState<
    "all" | "draft" | "sent" | "paid" | "overdue"
  >("all");
  // DEMO parity: quick-view modal payload (+ doc id for its Edit action).
  const [quickView, setQuickView] = useState<{
    id: number;
    data: QuickViewData;
  } | null>(null);
  const [reminding, setReminding] = useState(false);
  // Free-tier invoice cap hit (client check or server trigger) → upgrade modal.
  const [capOpen, setCapOpen] = useState(false);
  const isCapError = (e: unknown) => errMsg(e).includes("Free plan limit reached");
  const loadDocs = () =>
    billing
      .listDocs(mode)
      .then(setDocs)
      .catch(() => toast.error("Failed to load documents"));
  const loadRecurs = () =>
    recurrences
      .list()
      .then(setRecurs)
      .catch(() => toast.error("Failed to load recurrences"));

  const reload = () => {
    billing
      .getCompany()
      .then(setCompany)
      .catch(() => toast.error("Failed to load company profile"));
    loadInvoiceFormat().then(setNumFmt).catch(() => {});
    loadDocs();
    loadRecurs();
  };
  useEffect(reload, []);
  useLiveSync(reload);

  // Generate any due recurring invoices once on load.
  useEffect(() => {
    recurrences
      .generateDue()
      .then((n) => {
        if (n > 0) {
          loadDocs();
          loadRecurs();
          toast.info(`${n} recurring invoice${n > 1 ? "s" : ""} generated`);
        }
      })
      .catch(() => toast.error("Failed to generate recurring invoices"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ⌘K "New invoice" deep-link: open a blank invoice once company loads.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get("new") === "1" && company && !form) {
      setForm(blankForm(company, docs.map((d) => d.number), mode, numFmt));
      setParams({}, { replace: true });
    }
  }, [params, company, form, setParams, docs, numFmt, mode]);

  const newInvoice = () => {
    if (company) setForm(blankForm(company, docs.map((d) => d.number), mode, numFmt));
  };

const editInvoice = async (id: number) => {
    try {
      const d = await billing.getDoc(id);
      setForm({
        id: d.id,
        number: d.number,
        status: d.status,
        doc_title: d.doc_title || d.doc_type,
        template: d.template,
        accent: d.accent,
        currency: d.currency,
        seller_name: d.seller_name,
        seller_address: d.seller_address,
        seller_trn: d.seller_trn,
        seller_email: d.seller_email,
        seller_phone: d.seller_phone,
        seller_city: d.seller_city,
        seller_country_subdivision: d.seller_country_subdivision,
        seller_legal_id: d.seller_legal_id,
        seller_legal_id_type: d.seller_legal_id_type,
        logo: d.logo,
        customer_name: d.customer_name,
        customer_address: d.customer_address,
        customer_trn: d.customer_trn,
        customer_email: d.customer_email,
        customer_id: d.customer_id,
        issue_date: d.issue_date,
        due_date: d.due_date,
        po_number: d.po_number,
        po_date: d.po_date,
        date_of_supply: d.date_of_supply,
        payment_terms: d.payment_terms,
        round_off: d.round_off ?? false,
        notes: d.notes,
        terms: d.terms,
        tax_rate: d.tax_rate,
        discount: d.discount,
        invoice_type_code: d.invoice_type_code || DEFAULT_INVOICE_TYPE_CODE,
        transaction_type: d.transaction_type || DEFAULT_TRANSACTION_TYPE,
        payment_means_code: d.payment_means_code || DEFAULT_PAYMENT_MEANS_CODE,
        buyer_city: d.buyer_city,
        buyer_country_subdivision: d.buyer_country_subdivision,
        buyer_country_code: d.buyer_country_code || UAE_COUNTRY_CODE,
        stamp: d.stamp
          ? {
              data: d.stamp.data,
              x: d.stamp.x ?? 75,
              y: d.stamp.y ?? 70,
              opacity: d.stamp.opacity ?? 30,
              color: d.stamp.color ?? "#cc0000",
              cropTop: d.stamp.cropTop ?? 0,
              cropRight: d.stamp.cropRight ?? 0,
              cropBottom: d.stamp.cropBottom ?? 0,
              cropLeft: d.stamp.cropLeft ?? 0,
              scale: (d.stamp as any).scale ?? 100,
            }
          : undefined,
        signature: d.signature
          ? {
              data: d.signature.data,
              x: d.signature.x ?? 75,
              y: d.signature.y ?? 85,
              opacity: d.signature.opacity ?? 35,
              color: d.signature.color ?? "#0000cc",
              cropTop: d.signature.cropTop ?? 0,
              cropRight: d.signature.cropRight ?? 0,
              cropBottom: d.signature.cropBottom ?? 0,
              cropLeft: d.signature.cropLeft ?? 0,
              scale: (d.signature as any).scale ?? 100,
            }
          : undefined,
        show_stamp: d.show_stamp ?? false,
        show_signature: d.show_signature ?? false,
        show_logo: d.show_logo ?? false,
        show_bank: (d as any).show_bank ?? false,
        advance_applied: (d as any).advance_applied ?? 0,
        fx_rate: d.fx_rate ?? null,
        items: d.items.map((i) => {
          const {
            custom,
            pageBreakBefore,
            calcMode,
            amount,
            itemFormula,
            discount,
          } = splitItemMeta(i.custom);
          return {
            description: i.description,
            qty: i.qty,
            unit_price: i.unit_price,
            unit: i.unit || "",
            custom,
            product_id: i.product_id,
            pageBreakBefore,
            calcMode: calcMode || "auto",
            amount: amount ?? 0,
            itemFormula: itemFormula || null,
            tax_category: i.tax_category || DEFAULT_TAX_CATEGORY,
            discount,
          };
        }),
        customColumns: sanitizeCustomColumns(d.custom_columns || []),
        unit_price_formula: d.unit_price_formula || null,
      });
    } catch (e: any) {
      toast.error(e?.message || "Failed to load invoice");
    }
  };

  const duplicateInvoice = async (id: number) => {
    try {
      const d = await billing.getDoc(id);
      setForm({
        number: pickInvoiceNumber(mode, docs.map((x) => x.number), numFmt),
        status: "draft",
        doc_title: d.doc_title || d.doc_type,
        template: d.template,
        accent: d.accent,
        currency: d.currency,
        seller_name: d.seller_name,
        seller_address: d.seller_address,
        seller_trn: d.seller_trn,
        seller_email: d.seller_email,
        seller_phone: d.seller_phone,
        seller_city: d.seller_city,
        seller_country_subdivision: d.seller_country_subdivision,
        seller_legal_id: d.seller_legal_id,
        seller_legal_id_type: d.seller_legal_id_type,
        logo: d.logo,
        customer_name: d.customer_name,
        customer_address: d.customer_address,
        customer_trn: d.customer_trn,
        customer_email: d.customer_email,
        customer_id: d.customer_id,
        issue_date: today(),
        due_date: addDays(30),
        po_number: d.po_number,
        payment_terms: d.payment_terms,
        notes: d.notes,
        terms: d.terms,
        tax_rate: d.tax_rate,
        discount: d.discount,
        invoice_type_code: d.invoice_type_code || DEFAULT_INVOICE_TYPE_CODE,
        transaction_type: d.transaction_type || DEFAULT_TRANSACTION_TYPE,
        payment_means_code: d.payment_means_code || DEFAULT_PAYMENT_MEANS_CODE,
        buyer_city: d.buyer_city,
        buyer_country_subdivision: d.buyer_country_subdivision,
        buyer_country_code: d.buyer_country_code || UAE_COUNTRY_CODE,
        stamp: d.stamp
          ? {
              data: d.stamp.data,
              x: d.stamp.x ?? 75,
              y: d.stamp.y ?? 70,
              opacity: d.stamp.opacity ?? 30,
              color: d.stamp.color ?? "#cc0000",
              cropTop: d.stamp.cropTop ?? 0,
              cropRight: d.stamp.cropRight ?? 0,
              cropBottom: d.stamp.cropBottom ?? 0,
              cropLeft: d.stamp.cropLeft ?? 0,
              scale: (d.stamp as any).scale ?? 100,
            }
          : undefined,
        signature: d.signature
          ? {
              data: d.signature.data,
              x: d.signature.x ?? 75,
              y: d.signature.y ?? 85,
              opacity: d.signature.opacity ?? 35,
              color: d.signature.color ?? "#0000cc",
              cropTop: d.signature.cropTop ?? 0,
              cropRight: d.signature.cropRight ?? 0,
              cropBottom: d.signature.cropBottom ?? 0,
              cropLeft: d.signature.cropLeft ?? 0,
              scale: (d.signature as any).scale ?? 100,
            }
          : undefined,
        show_stamp: d.show_stamp ?? false,
        show_signature: d.show_signature ?? false,
        show_logo: d.show_logo ?? false,
        show_bank: (d as any).show_bank ?? false,
        // Advance application is per-invoice: the copy hasn't consumed any
        // customer credit, so never carry the original's applied amount
        // (doing so silently posted ghost consumption rows to `advances`).
        advance_applied: 0,
        fx_rate: d.fx_rate ?? null,
        items: d.items.map((i) => {
          const {
            custom,
            pageBreakBefore,
            calcMode,
            amount,
            itemFormula,
            discount,
          } = splitItemMeta(i.custom);
          return {
            description: i.description,
            qty: i.qty,
            unit_price: i.unit_price,
            unit: i.unit || "",
            custom,
            product_id: i.product_id,
            pageBreakBefore,
            calcMode: calcMode || "auto",
            amount: amount ?? 0,
            itemFormula: itemFormula || null,
            tax_category: i.tax_category || DEFAULT_TAX_CATEGORY,
            discount,
          };
        }),
        customColumns: sanitizeCustomColumns(d.custom_columns || []),
        unit_price_formula: d.unit_price_formula || null,
      });
    } catch (e: any) {
      toast.error(e?.message || "Failed to duplicate invoice");
    }
  };

  const save = async () => {
    // Guard re-entry (Ctrl+S bypasses the disabled buttons): a second call
    // before the first insert returns would create a duplicate document.
    if (!form || saving) return;
    // Validate
    if (!form.number.trim()) {
      toast.error("Invoice number is required");
      return;
    }
    if (!form.items.length || form.items.every((i) => !i.description.trim())) {
      toast.error("Add at least one line item with a description");
      return;
    }
    if (!form.customer_name.trim() && !(form.customer_email || "").trim()) {
      toast.error("Customer name or email is required");
      return;
    }
    // Check for duplicate invoice number
    if (docs.some((d) => d.number === form.number && d.id !== (form.id || 0))) {
      toast.error(
        `Invoice number "${form.number}" already exists. Use a different number.`
      );
      return;
    }
    setSaving(true);
    try {
      // Empty date inputs must become undefined, not "" (invalid SQL date).
      const payload = {
        ...form,
        // Persist user-defined columns + per-item unit & custom values so they
        // survive a reload (DB columns: invoice_docs.custom_columns,
        // invoice_doc_items.unit / .custom).
        custom_columns: sanitizeCustomColumns(form.customColumns),
        items: form.items.map((it) => ({
          description: it.description,
          qty: it.qty,
          unit_price: it.unit_price,
          unit: it.unit || undefined,
          custom: mergeItemMeta(it),
          product_id: it.product_id,
          tax_category: it.tax_category || undefined,
        })),
        issue_date: form.issue_date || undefined,
        due_date: form.due_date || undefined,
      };
      // Remove Form-only camelCase alias (mapped to custom_columns above).
      delete (payload as any).customColumns;
      if (isPurchase) (payload as any).doc_type = "purchase";
      else delete (payload as any).doc_type;
      (payload as any).show_stamp = form.show_stamp ?? false;
      (payload as any).show_signature = form.show_signature ?? false;
      (payload as any).show_logo = form.show_logo ?? false;
      (payload as any).show_bank = form.show_bank ?? false;
      (payload as any).advance_applied = Number(form.advance_applied) || 0;
      const id = await billing.saveDoc(payload as InvoiceDocInput);
      // Consume the applied advance from the customer's credit ledger
      // (idempotent per invoice id; duplicates start at 0 so copies never
      // re-consume).
      if (form.customer_id)
        await advances
          .applyToInvoice(
            form.customer_id,
            form.customer_name || "",
            id,
            Number(form.advance_applied) || 0
          )
          .catch(() => {});
      setForm({ ...form, id });
      await loadDocs();
      return id;
    } catch (e) {
      if (isCapError(e)) setCapOpen(true);
      else toast.error(`Could not save: ${errMsg(e)}`);
    } finally {
      setSaving(false);
    }
  };

  // Save the current invoice with a given status (finalize → "sent" so it
  // counts as issued; revert → "draft"). Done at the parent so the freshly
  // saved id is applied to the form without a stale closure.
  const setDocStatus = async (status: "draft" | "sent") => {
    if (!form || saving) return;
    // Validate
    if (!form.number.trim()) {
      toast.error("Invoice number is required");
      return;
    }
    if (!form.items.length || form.items.every((i) => !i.description.trim())) {
      toast.error("Add at least one line item with a description");
      return;
    }
    if (!form.customer_name.trim() && !(form.customer_email || "").trim()) {
      toast.error("Customer name or email is required");
      return;
    }
    // Check for duplicate invoice number
    if (docs.some((d) => d.number === form.number && d.id !== (form.id || 0))) {
      toast.error(
        `Invoice number "${form.number}" already exists. Use a different number.`
      );
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        status,
        custom_columns: sanitizeCustomColumns(form.customColumns),
        items: form.items.map((it) => ({
          description: it.description,
          qty: it.qty,
          unit_price: it.unit_price,
          unit: it.unit || undefined,
          custom: mergeItemMeta(it),
          product_id: it.product_id,
          tax_category: it.tax_category || undefined,
        })),
        issue_date: form.issue_date || undefined,
        due_date: form.due_date || undefined,
      };
      // Remove Form-only camelCase alias (mapped to custom_columns above).
      delete (payload as any).customColumns;
      if (isPurchase) (payload as any).doc_type = "purchase";
      else delete (payload as any).doc_type;
      (payload as any).show_stamp = form.show_stamp ?? false;
      (payload as any).show_signature = form.show_signature ?? false;
      (payload as any).show_logo = form.show_logo ?? false;
      (payload as any).show_bank = form.show_bank ?? false;
      (payload as any).advance_applied = Number(form.advance_applied) || 0;
      const id = await billing.saveDoc(payload as InvoiceDocInput);
      // Consume the applied advance from the customer's credit ledger
      // (idempotent per invoice id; duplicates start at 0 so copies never
      // re-consume).
      if (form.customer_id)
        await advances
          .applyToInvoice(
            form.customer_id,
            form.customer_name || "",
            id,
            Number(form.advance_applied) || 0
          )
          .catch(() => {});
      setForm({ ...form, id, status });
      await loadDocs();
      toast.success(
        status === "sent"
          ? "Invoice finalized — posted to Orders, Accounting & Inventory."
          : "Moved back to draft."
      );
    } catch (e) {
      if (isCapError(e)) setCapOpen(true);
      else toast.error(`Could not update: ${errMsg(e)}`);
    } finally {
      setSaving(false);
    }
  };

  if (form) {
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
                  tax_rate: c.default_tax_rate ?? prev.tax_rate,
                };
              });
              setCompanyOpen(false);
            }}
          />
        )}
        <Editor
          form={form}
          setForm={setForm}
          onBack={() => {
            setForm(null);
            loadDocs();
          }}
          onSave={save}
          onFinalize={() => setDocStatus("sent")}
          onRevertDraft={() => setDocStatus("draft")}
          saving={saving}
          onEditCompany={() => setCompanyOpen(true)}
          partyLabel={partyLabel}
          docs={docs}
        />
      </>
    );
  }

  const statToday = todayYmd();
  const statCcy = company?.currency || "AED";
  // Overdue = unpaid balance past the due date — same predicate as the Status
  // column and the Overdue KPI card.
  const isOverdueDoc = (d: InvoiceDocSummary) =>
    (d.balance ?? 0) > 0 &&
    !!d.due_date &&
    d.due_date < statToday &&
    d.status !== "paid";
  // KPI strip: billed = non-draft totals; outstanding splits into pending
  // (not past due) and overdue (past due with a balance).
  const billedTotal = docs
    .filter((d) => d.status !== "draft")
    .reduce((s, d) => s + d.total, 0);
  const paidTotal = docs.reduce((s, d) => s + (d.paid ?? 0), 0);
  const overdueTotal = docs
    .filter(isOverdueDoc)
    .reduce((s, d) => s + (d.balance ?? 0), 0);
  const pendingTotal = docs
    .filter((d) => d.status !== "draft" && !isOverdueDoc(d))
    .reduce((s, d) => s + (d.balance ?? 0), 0);
  const filteredDocs = docs.filter((d) => {
    if (statusFilter === "overdue") {
      if (!isOverdueDoc(d)) return false;
    } else if (statusFilter !== "all" && d.status !== statusFilter) {
      return false;
    }
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      d.number.toLowerCase().includes(q) ||
      d.customer_name.toLowerCase().includes(q)
    );
  });

  // Totals for the current search/filter — shown on top when filtering so the
  // user sees a customer's invoiced / collected / outstanding at a glance.
  const fPaid = filteredDocs.reduce((s, d) => s + (d.paid ?? 0), 0);
  const fOutstanding = filteredDocs.reduce((s, d) => s + (d.balance ?? 0), 0);
  const fInvoiced = fPaid + fOutstanding;

  // ----- DEMO parity: quick view, per-row send/share, reminders -----

  // Fetch the full doc (cached) and show the DEMO-style quick-view modal:
  // meta grid + line items + total + notes.
  const openQuickView = async (d: InvoiceDocSummary) => {
    try {
      const doc = await billing.getDoc(d.id);
      const overdue = isOverdueDoc(d);
      const status = overdue ? "overdue" : d.status;
      const ccy = d.currency || doc.currency || "AED";
      setQuickView({
        id: d.id,
        data: {
          title: `${doc.doc_title || (isPurchase ? "Purchase Invoice" : "Invoice")} ${doc.number}`,
          subtitle: isPurchase
            ? `From ${doc.customer_name}`
            : `Issued to ${doc.customer_name}`,
          badge: (
            <Badge tone={overdue ? "danger" : statusTone(status)}>{status}</Badge>
          ),
          meta: [
            { label: partyLabel, value: doc.customer_name },
            {
              label: "Issue date",
              value: doc.issue_date ? fmtDate(doc.issue_date) : "—",
            },
            {
              label: "Due date",
              value: doc.due_date ? fmtDate(doc.due_date) : "—",
            },
            { label: "Currency", value: ccy },
            { label: "Status", value: status },
            { label: "Balance", value: money(d.balance ?? 0, ccy) },
          ],
          items: doc.items.map((i) => ({
            desc: i.description,
            qty: i.qty,
            price: i.unit_price,
          })),
          total: d.total,
          currency: ccy,
          notes: doc.notes,
        },
      });
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  // Share one invoice via WhatsApp / email / SMS, or copy its public portal
  // link (same real link as the bulk "Copy public link" action).
  const sendDoc = async (kind: ShareKind, d: InvoiceDocSummary) => {
    try {
      if (kind === "copyLink") {
        const token = await billing.publicLink(d.id);
        const url = `${location.origin}${location.pathname}#/portal/${token}`;
        await navigator.clipboard.writeText(url);
        toast.success("Public invoice link copied");
        return;
      }
      const doc = await billing.getDoc(d.id);
      // WhatsApp/SMS need a phone: look it up in CRM by id, then by name.
      let phone = "";
      try {
        const custs = await crm.customers();
        const cust =
          custs.find((c) => c.id === doc.customer_id) ??
          custs.find((c) => (c.company || c.name) === d.customer_name);
        phone = cust?.phone_e164 || cust?.phone || "";
      } catch {
        /* phone is optional */
      }
      const ccy = d.currency || doc.currency || "AED";
      const text = `Hi ${doc.customer_name || "there"},\n\n${
        isPurchase ? "Purchase invoice" : "Invoice"
      } ${doc.number} for ${money(d.total, ccy)} is available. Thank you!`;
      const subject = `${doc.doc_title || (isPurchase ? "Purchase Invoice" : "Invoice")} ${doc.number}`;
      // Email sends through Resend (server), not the OS mail client — so the
      // customer actually receives it. WhatsApp/SMS still open the user's apps.
      if (kind === "email") {
        if (!doc.customer_email) {
          toast.error("This customer has no email address on file.");
          return;
        }
        let portalUrl = "";
        try {
          const token = await billing.publicLink(d.id);
          portalUrl = `${location.origin}${location.pathname}#/portal/${token}`;
        } catch {
          /* link optional */
        }
        await sendEmail({
          to: doc.customer_email,
          subject,
          html: emailShell(
            subject,
            `<p>Dear ${esc(doc.customer_name || "customer")},</p>
             <p>Your ${esc(isPurchase ? "purchase invoice" : "invoice")} <b>${esc(
               doc.number
             )}</b> for <b>${esc(money(d.total, ccy))}</b> is ready.</p>
             ${
               portalUrl
                 ? `<p style="margin:16px 0"><a href="${portalUrl}" style="background:#FFD600;color:#0A0A0A;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:700;display:inline-block">View &amp; pay online</a></p>`
                 : ""
             }
             <p>${esc(doc.notes ?? "")}</p>`
          ),
        });
        toast.success(`Invoice emailed to ${doc.customer_email}`);
        return;
      }
      shareVia(kind, {
        phone,
        email: doc.customer_email || "",
        text,
        // shareVia uses `url` as the mail subject for email shares.
        url: subject,
      });
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  // Email a payment reminder for every overdue invoice that has a customer
  // email — same sendEmail/emailShell path as the editor's Save & Send.
  const sendReminders = async () => {
    if (reminding) return;
    const overdueDocs = docs.filter(isOverdueDoc);
    if (!overdueDocs.length) {
      toast.info("No overdue invoices right now.");
      return;
    }
    const ok = await confirm({
      title: "Send payment reminders",
      message: `Email payment reminders for ${overdueDocs.length} overdue invoice${overdueDocs.length > 1 ? "s" : ""}?`,
      confirmLabel: "Send reminders",
    });
    if (!ok) return;
    setReminding(true);
    let sent = 0;
    let skipped = 0;
    try {
      for (const d of overdueDocs) {
        try {
          const doc = await billing.getDoc(d.id);
          if (!doc.customer_email) {
            skipped++;
            continue;
          }
          let portalUrl = "";
          try {
            const token = await billing.publicLink(d.id);
            portalUrl = `${location.origin}${location.pathname}#/portal/${token}`;
          } catch {
            /* link optional */
          }
          const ccy = d.currency || doc.currency || "AED";
          await sendEmail({
            to: doc.customer_email,
            subject: `Payment reminder — Invoice ${doc.number}`,
            html: emailShell(
              `Payment reminder — ${doc.number}`,
              `<p>Dear ${esc(doc.customer_name || "customer")},</p>
               <p>This is a friendly reminder that invoice <b>${esc(doc.number)}</b> for <b>${money(
                d.balance ?? d.total,
                ccy
              )}</b> ${
                doc.due_date
                  ? `was due on <b>${esc(fmtDate(doc.due_date))}</b>`
                  : "is now overdue"
              }.</p>
               ${
                 portalUrl
                   ? `<p style="margin:16px 0"><a href="${portalUrl}" style="background:#FFD600;color:#0A0A0A;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:700;display:inline-block">View &amp; pay online</a></p>`
                   : ""
               }
               <p>If you have already paid, please ignore this message.</p>`
            ),
          });
          sent++;
        } catch {
          skipped++;
        }
      }
      if (sent)
        toast.success(
          `Sent ${sent} reminder${sent > 1 ? "s" : ""}${
            skipped ? ` — ${skipped} skipped (no email)` : ""
          }.`
        );
      else
        toast.info(
          skipped
            ? "No overdue invoices have a customer email."
            : "Nothing sent."
        );
    } finally {
      setReminding(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={isPurchase ? "Purchase Invoices" : "Invoicing"}
        subtitle={
          isPurchase
            ? "Record supplier bills — receives stock and posts to Inventory & Payables"
            : "Create, send and track invoices"
        }
        action={
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => setCompanyOpen(true)}>
              <Building2 size={16} /> Company
            </button>
            <button className="btn-ghost" onClick={() => setScanOpen(true)}>
              <Sparkles size={16} /> Scan with AI
            </button>
            {!isPurchase && (
              <button
                className="btn-ghost"
                onClick={sendReminders}
                disabled={reminding}
              >
                <Send size={16} /> {reminding ? "Sending…" : "Send reminders"}
              </button>
            )}
            {isPurchase ? (
              <button className="btn-primary" onClick={newInvoice}>
                <Plus size={16} /> New Purchase Invoice
              </button>
            ) : (
              <button
                onClick={newInvoice}
                className="h-8 px-3 rounded-md text-[13px] font-medium inline-flex items-center gap-1.5 bg-amber-400 text-neutral-900 hover:bg-amber-300 border border-amber-500/60 transition-colors"
              >
                <Plus size={16} /> New Invoice
              </button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 joined-kpis mb-4">
        <MetricCard
          label="Total billed"
          value={money(billedTotal, statCcy)}
          change={`${num(docs.filter((d) => d.status !== "draft").length)} invoices`}
          changeTone="up"
        />
        <MetricCard
          label="Paid"
          value={money(paidTotal, statCcy)}
          change="Collected"
          changeTone="up"
        />
        <MetricCard
          label="Pending"
          value={money(pendingTotal, statCcy)}
          change={pendingTotal > 0 ? "Awaiting payment" : "All settled"}
          changeTone={pendingTotal > 0 ? "warn" : "up"}
        />
        <MetricCard
          label="Overdue"
          value={money(overdueTotal, statCcy)}
          change={
            overdueTotal > 0
              ? `${num(docs.filter(isOverdueDoc).length)} past due date`
              : "None"
          }
          changeTone={overdueTotal > 0 ? "down" : "up"}
        />
      </div>

      {recurs.filter((r) => r.active).length > 0 && (
        <div className="card mb-4">
          <p className="mb-2 flex items-center gap-2 font-semibold text-sm text-ink tracking-tight">
            <div className="grid h-7 w-7 place-items-center rounded-lg bg-primary-100">
              <Repeat size={14} className="text-primary-700" />
            </div>
            Recurring invoices
          </p>
          <ul className="space-y-1.5">
            {recurs
              .filter((r) => r.active)
              .map((r) => {
                const base = docs.find((d) => d.id === r.base_invoice_id);
                return (
                  <li key={r.id} className="flex items-center justify-between text-sm">
                    <span className="text-brand-500">
                      {base?.number ?? `#${r.base_invoice_id}`} · {r.interval} · next{" "}
                      {fmtDate(r.next_run)}
                    </span>
                    <button
                      className="cursor-pointer text-xs font-medium text-brand-500 hover:text-danger transition-colors"
                      onClick={async () => {
                        const ok = await confirm({
                          title: "Cancel recurring invoice",
                          message: `Cancel this recurring invoice? No more invoices will be generated.`,
                          confirmLabel: "Cancel recurrence",
                          danger: true,
                        });
                        if (!ok) return;
                        try {
                          await recurrences.cancel(r.id);
                          loadRecurs();
                        } catch (e: any) {
                          toast.error(e?.message || "Failed to cancel recurrence");
                        }
                      }}
                    >
                      Cancel
                    </button>
                  </li>
                );
              })}
          </ul>
        </div>
      )}

      <CustomerAdvancesPanel />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search invoices by number or customer…"
          className="max-w-xs flex-1 min-w-[220px]"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip
            active={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
          >
            All
          </FilterChip>
          <FilterChip
            active={statusFilter === "draft"}
            onClick={() => setStatusFilter("draft")}
          >
            Draft
          </FilterChip>
          <FilterChip
            active={statusFilter === "sent"}
            onClick={() => setStatusFilter("sent")}
          >
            Pending
          </FilterChip>
          <FilterChip
            active={statusFilter === "paid"}
            onClick={() => setStatusFilter("paid")}
            tone="success"
          >
            Paid
          </FilterChip>
          <FilterChip
            active={statusFilter === "overdue"}
            onClick={() => setStatusFilter("overdue")}
            tone="danger"
          >
            Overdue
          </FilterChip>
        </div>
      </div>

      {search && filteredDocs.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-sm text-brand-500 tracking-tight">
            Totals for <span className="font-semibold text-ink">“{search}”</span>
          </p>
          <StatStrip
            items={[
              {
                label: "Invoices",
                value: num(filteredDocs.length),
                icon: <FileText size={16} />,
              },
              {
                label: "Invoiced",
                value: money(fInvoiced, statCcy),
                icon: <FileText size={16} />,
              },
              {
                label: "Collected",
                value: money(fPaid, statCcy),
                icon: <CheckCircle2 size={16} />,
              },
              {
                label: "Outstanding",
                value: money(fOutstanding, statCcy),
                icon: <Wallet size={16} />,
              },
            ]}
          />
        </div>
      )}

      <DataTable<InvoiceDocSummary>
        rows={filteredDocs}
        empty={
          search || statusFilter !== "all"
            ? "No invoices match your filter"
            : "No invoices yet — create your first one"
        }
        rowKey={(d) => d.id}
        bulkActions={[
          {
            label: "Share",
            run: async (sel) => {
              for (const d of sel) await billing.shareDoc(d.id, true);
              loadDocs();
              toast.success(`Shared ${sel.length}.`);
            },
          },
          {
            label: "Mark sent",
            run: async (sel) => {
              for (const d of sel) await billing.setStatus(d.id, "sent");
              loadDocs();
              toast.success(`Updated ${sel.length}.`);
            },
          },
          {
            label: "Repeat monthly",
            run: async (sel) => {
              for (const d of sel) await recurrences.create(d.id, "monthly");
              loadRecurs();
              toast.success(`${sel.length} set to repeat monthly.`);
            },
          },
          {
            label: "Copy public link",
            run: async (sel) => {
              try {
                const token = await billing.publicLink(sel[0].id);
                const url = `${location.origin}${location.pathname}#/portal/${token}`;
                await navigator.clipboard.writeText(url);
                loadDocs();
                toast.success("Public invoice link copied");
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
                title: "Delete invoices",
                message: `Delete ${sel.length} invoice(s)?`,
                confirmLabel: "Delete",
                danger: true,
              });
              if (!ok) return;
              for (const d of sel) await billing.deleteDoc(d.id);
              loadDocs();
              toast.success(`Deleted ${sel.length}.`);
            },
          },
        ]}
        columns={[
          {
            key: "no",
            label: "Invoice #",
            sortValue: (d) => d.number,
            render: (d) => (
              <span className="font-mono text-xs font-medium">{d.number}</span>
            ),
          },
          {
            key: "cust",
            label: partyLabel,
            sortValue: (d) => d.customer_name,
            render: (d) => <span className="font-medium">{d.customer_name}</span>,
          },
          {
            key: "tpl",
            label: "Template",
            sortValue: (d) => d.template,
            render: (d) => <span className="text-brand-500">{d.template}</span>,
          },
          {
            key: "total",
            label: "Total",
            sortValue: (d) => d.total,
            render: (d) => (
              <span className="font-medium">{money(d.total, d.currency || "AED")}</span>
            ),
          },
          {
            key: "status",
            label: "Status",
            sortValue: (d) => d.status,
            render: (d) => {
              const today = todayYmd();
              const overdue =
                (d.balance ?? 0) > 0 &&
                !!d.due_date &&
                d.due_date < today &&
                d.status !== "paid";
              return (
                <div>
                  <Badge tone={overdue ? "danger" : statusTone(d.status)}>
                    {overdue ? "overdue" : d.status}
                  </Badge>
                  {(d.paid ?? 0) > 0 && (d.balance ?? 0) > 0 && (
                    <p className="text-[11px] text-brand-500 mt-0.5 tabular-nums">
                      {money(d.balance ?? 0, d.currency || "AED")} due
                    </p>
                  )}
                </div>
              );
            },
          },
          {
            key: "upd",
            label: "Date",
            sortValue: (d) => d.issue_date ?? "",
            render: (d) => fmtDate(d.issue_date),
          },
          {
            key: "share",
            label: "Sharing",
            render: (d) => (
              <ShareToggle
                shared={d.shared}
                onToggle={async (next) => {
                  try {
                    await billing.shareDoc(d.id, next);
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
              <div className="flex items-center justify-end gap-1">
                <button
                  aria-label="Payments"
                  title="Record payment"
                  className="rounded-xl p-1.5 text-brand-500 hover:bg-brand-100 hover:text-ink active:scale-95 cursor-pointer transition-colors duration-200"
                  onClick={() => setPayFor(d)}
                >
                  <CreditCard size={15} />
                </button>
                <RowActions
                  onView={() => openQuickView(d)}
                  onEdit={() => editInvoice(d.id)}
                  onCopy={() => duplicateInvoice(d.id)}
                  onSend={{
                    whatsapp: () => sendDoc("whatsapp", d),
                    email: () => sendDoc("email", d),
                    sms: () => sendDoc("sms", d),
                    copyLink: () => sendDoc("copyLink", d),
                  }}
                  onDelete={async () => {
                    if (
                      !(await confirm({
                        title: "Delete invoice",
                        message: `Delete ${d.number}? This cannot be undone.`,
                      }))
                    )
                      return;
                    await billing.deleteDoc(d.id);
                    loadDocs();
                    toast.success(`Deleted ${d.number}`);
                  }}
                />
              </div>
            ),
          },
        ]}
      />

      <ScanDocModal open={scanOpen} onClose={() => setScanOpen(false)} mode={mode} />

      {/* Free-tier invoice cap — upgrade path instead of a bare error toast. */}
      <Modal
        open={capOpen}
        onClose={() => setCapOpen(false)}
        title="Free plan limit reached"
      >
        <p className="text-[13px] text-brand-500">
          You've used all 20 invoices in this calendar month on the Free plan.
          Upgrade to keep invoicing without interruption:
        </p>
        <ul className="mt-3 space-y-1.5 text-[13px] text-brand-500 list-disc pl-5">
          <li>
            <b className="text-ink">Offline</b> — one-time purchase, fully offline,
            no monthly cap.
          </li>
          <li>
            <b className="text-ink">Pro</b> — cloud sync and multi-device, no monthly
            cap.
          </li>
        </ul>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setCapOpen(false)}>
            Not now
          </button>
          <a href="#/settings?section=billing" className="btn-primary">
            View plans
          </a>
        </div>
      </Modal>

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
                tax_rate: c.default_tax_rate ?? prev.tax_rate,
              };
            });
            setCompanyOpen(false);
          }}
        />
      )}

      <PaymentsModal doc={payFor} onClose={() => setPayFor(null)} onSaved={loadDocs} />

      <QuickViewModal
        open={!!quickView}
        onClose={() => setQuickView(null)}
        onEdit={
          quickView
            ? () => {
                const id = quickView.id;
                setQuickView(null);
                editInvoice(id);
              }
            : undefined
        }
        data={quickView?.data ?? null}
      />
    </div>
  );
}

/* ---------------- Payments ---------------- */

function PaymentsModal({
  doc,
  onClose,
  onSaved,
}: {
  doc: InvoiceDocSummary | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast, confirm } = useUI();
  const [rows, setRows] = useState<InvoicePayment[]>([]);
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState("bank transfer");
  const [paidAt, setPaidAt] = useState(todayYmd());
  const [busy, setBusy] = useState(false);

  const load = () => {
    if (!doc) return;
    billing
      .payments(doc.id)
      .then(setRows)
      .catch(() => setRows([]));
  };
  useEffect(load, [doc?.id]);

  const total = doc?.total ?? 0;
  const paid = rows.reduce((s, p) => s + Number(p.amount), 0);
  const balance = Math.max(0, total - paid);

  const add = async () => {
    if (!doc || amount <= 0) return;
    setBusy(true);
    try {
      await billing.addPayment(doc.id, amount, method || null, paidAt);
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
    if (
      !(await confirm({
        title: "Remove payment",
        message: "Remove this payment record? This cannot be undone.",
      }))
    )
      return;
    try {
      await billing.removePayment(id);
      load();
      onSaved();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  if (!doc) return null;
  const ccy = doc.currency || "AED";
  return (
    <Modal open={!!doc} onClose={onClose} title={`Payments — ${doc.number}`}>
      <div className="grid grid-cols-3 joined-kpis mb-4">
        <div className="rounded-xl bg-brand-50 px-3 py-2.5">
          <p className="text-[11px] text-brand-500">Total</p>
          <p className="font-medium font-medium text-ink tabular-nums">
            {money(total, ccy)}
          </p>
        </div>
        <div className="rounded-xl bg-success/10 px-3 py-2.5">
          <p className="text-[11px] text-brand-500">Paid</p>
          <p className="font-medium font-medium text-success tabular-nums">
            {money(paid, ccy)}
          </p>
        </div>
        <div className="rounded-xl bg-primary-100 px-3 py-2.5">
          <p className="text-[11px] text-brand-500">Balance</p>
          <p className="font-medium font-medium text-ink tabular-nums">
            {money(balance, ccy)}
          </p>
        </div>
      </div>

      {rows.length > 0 && (
        <ul className="space-y-1.5 mb-4 max-h-44 overflow-y-auto">
          {rows.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between rounded-xl bg-white border border-brand-100 px-3 py-2 text-sm"
            >
              <span className="tabular-nums font-medium text-ink">
                {money(Number(p.amount), ccy)}
              </span>
              <span className="text-xs text-brand-500">
                {p.method ?? "—"} · {fmtDate(p.paid_at)}
              </span>
              <button
                aria-label="Remove payment"
                onClick={() => remove(p.id)}
                className="text-brand-400 hover:text-danger cursor-pointer transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
        <Field label="Amount">
          <input
            type="number"
            className="input"
            placeholder="0"
            value={amount || ""}
            onChange={(e) => setAmount(numInput(e.target.value))}
          />
        </Field>
        <Field label="Method">
          <select
            className="select"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            <option value="bank transfer">Bank transfer</option>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="cheque">Cheque</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <button className="btn-primary" disabled={busy || amount <= 0} onClick={add}>
          <Plus size={15} /> Add
        </button>
      </div>
      <Field label="Date">
        <div className="mt-2">
          <DateField value={paidAt} onChange={setPaidAt} clearable={false} />
        </div>
      </Field>
    </Modal>
  );
}

/* ---------------- Import from Inventory ---------------- */

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
    <Modal open={open} onClose={onClose} title="Add from Inventory">
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
            <span className="text-sm font-medium text-ink">
              {money(p.unit_price, "AED")}
            </span>
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

/* ---------------- Editor ---------------- */

function Editor({
  form,
  setForm,
  onBack,
  onSave,
  onFinalize,
  onRevertDraft,
  saving,
  onEditCompany,
  partyLabel,
  docs,
}: {
  form: Form;
  setForm: (f: Form) => void;
  onBack: () => void;
  onSave: () => Promise<number | undefined>;
  onFinalize: () => void | Promise<void>;
  onRevertDraft: () => void;
  saving: boolean;
  onEditCompany: () => void;
  partyLabel: string;
  docs: InvoiceDocSummary[];
}) {
  const { toast, confirm } = useUI();
  const invoiceRef = useRef<HTMLDivElement>(null);
  // Off-screen container that renders EVERY page stacked as real A4 sheets —
  // captured for the PDF so the export contains all items (not just the page
  // on screen) and honors manual page breaks + last-page totals.
  const exportRef = useRef<HTMLDivElement>(null);
  const [previewPage, setPreviewPage] = useState(1);
  // Group items into A4 pages, honoring per-item manual page breaks.
  const pages = paginateItems(form.items);
  useEffect(() => {
    setPreviewPage(1);
  }, [form.items.length]);

  const previewPages = pages.length;
  const curPageIdx = Math.min(previewPage, previewPages) - 1;
  const pageStartIndex = pages
    .slice(0, curPageIdx)
    .reduce((n, g) => n + g.length, 0);
  const isLastPreviewPage = curPageIdx === previewPages - 1;
  const downloadPdf = () => {
    const el = exportRef.current || invoiceRef.current;
    if (el) {
      downloadElementAsPdf(el, form.number || "invoice");
    } else window.print();
  };
  // Export the UAE e-Invoice (Peppol PINT-AE UBL) XML. Blocks on missing
  // mandatory fields; surfaces recommended-field gaps as a non-blocking note.
  const exportXml = () => {
    const v = validateEInvoice(form as never);
    if (v.errors.length) {
      toast.error(`Can't export e-Invoice XML — missing: ${v.errors.join(", ")}`);
      return;
    }
    const xml = buildInvoiceXml(form as never);
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${form.number || "invoice"}.xml`;
    a.click();
    URL.revokeObjectURL(url);
    if (v.warnings.length)
      toast.info(`XML exported. Recommended fields still empty: ${v.warnings.join(", ")}`);
    else toast.success("e-Invoice XML exported (PINT-AE).");
  };
  // Finalize, then archive the issued invoice PDF to My Files (best-effort,
  // deduped by name so re-finalizing won't pile up copies).
  const handleFinalize = async () => {
    await onFinalize();
    try {
      const el = exportRef.current || invoiceRef.current;
      if (el) {
        const base = form.number || "invoice";
        const saved = await autoSaveDocument(`${base}.pdf`, "invoice", () =>
          elementToPdfBytes(el, base)
        );
        if (saved) toast.success("Saved a copy to My Files.");
      }
    } catch {
      /* archiving is a convenience — never block finalize on it */
    }
  };
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v });

  // Per-customer outstanding (Vyapar "BAL:") — summed from issued, unpaid
  // invoices already loaded for the list. Keyed by name; docs store the same
  // customer_name applyCustomer writes, so lookup by that string.
  const custBalance = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of docs) {
      if (d.status === "draft" || d.status === "paid") continue;
      const key = (d.customer_name || "").trim().toLowerCase();
      if (key) m.set(key, (m.get(key) || 0) + (d.balance ?? 0));
    }
    return m;
  }, [docs]);
  const balFor = (name?: string | null) =>
    custBalance.get((name || "").trim().toLowerCase()) || 0;

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
    ...TEMPLATES,
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
    if (form.template === id) set("template", "minimal");
    toast.success("Template deleted.");
  };

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
          description: "",
          qty: 1,
          unit_price: 0,
          unit: "",
          custom: {},
          pageBreakBefore: false,
          calcMode: "auto",
          amount: 0,
          itemFormula: null,
        },
      ],
    });
  const removeItem = (idx: number) =>
    setForm({ ...form, items: form.items.filter((_, i) => i !== idx) });

  const setItemCustom = (idx: number, key: string, value: string) => {
    // reserved meta keys are persisted through split/merge helpers, not as custom columns
    if (key === PB_KEY || key === CM_KEY || key === MA_KEY || key === FA_KEY || key === FB_KEY)
      return;
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
    if (key === PB_KEY) {
      toast.error("That name is reserved");
      return;
    }
    if (RESERVED_ITEM_COLUMNS.has(key)) {
      toast.error(`"${label}" is a default column and cannot be added again`);
      return;
    }
    if (form.customColumns.some((c) => c.key === key)) {
      toast.error("A column with that key already exists");
      return;
    }
    if (form.customColumns.some((c) => c.label.toLowerCase() === label.toLowerCase())) {
      toast.error("A column with that name already exists");
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

  const onLogo = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => set("logo", String(reader.result));
    reader.readAsDataURL(file);
  };

  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [custModal, setCustModal] = useState(false);
  const [invOpen, setInvOpen] = useState(false);
  const [bank, setBank] = useState<BankInfo>(EMPTY_BANK);
  const [companyStampSig, setCompanyStampSig] = useState<CompanyStampSig>(EMPTY_STAMP_SIG);
  // Free-drag position for the bank-details block (% of the A4 content area).
  const [bankX, setBankX] = useState(50);
  const [bankY, setBankY] = useState(88);
  // Customer advance credit applicable to the open invoice.
  const [availAdvance, setAvailAdvance] = useState(0);
  useEffect(() => {
    loadBankInfo()
      .then(setBank)
      .catch(() => {});
    loadCompanyStampSig()
      .then(setCompanyStampSig)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!form.customer_id) {
      setAvailAdvance(0);
      return;
    }
    advances
      .creditForInvoice(form.customer_id, form.id)
      .then(setAvailAdvance)
      .catch(() => {});
  }, [form.customer_id, form.id]);
  // Append an inventory product as an invoice line item (fills description &
  // unit price); drops a leftover empty row so the first import replaces it.
  const addItemFromProduct = (p: Product) => {
    const desc = [p.name, p.description?.trim()].filter(Boolean).join(" — ");
    setForm({
      ...form,
      items: [
        ...form.items.filter((it) => it.description.trim() || it.unit_price),
        {
          description: desc,
          qty: 1,
          unit_price: p.unit_price,
          unit: "",
          custom: {},
          product_id: p.id,
          calcMode: "auto",
          amount: 0,
          itemFormula: null,
        },
      ],
    });
  };
  const loadCustomers = () =>
    crm
      .customers()
      .then(setCustomers)
      .catch(() => toast.error("Failed to load customers"));
  useEffect(() => {
    loadCustomers();
  }, []);

  const applyCustomer = (c: CrmCustomer) =>
    setForm({
      ...form,
      customer_id: c.id,
      customer_name: c.company || c.name,
      customer_address: c.address ?? "",
      customer_email: c.email ?? "",
      // Prefer the dedicated TRN field; fall back to the legacy segment hack.
      customer_trn:
        c.trn ??
        (c.segment?.startsWith("TRN:") ? c.segment.slice(4).trim() : form.customer_trn),
      // UAE e-invoice: snapshot buyer location from the CRM record.
      buyer_city: c.city ?? form.buyer_city,
      buyer_country_subdivision: c.country_subdivision ?? form.buyer_country_subdivision,
      buyer_country_code: c.country_code ?? form.buyer_country_code ?? UAE_COUNTRY_CODE,
    });

  const [viewAll, setViewAll] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [viewOpen, setViewOpen] = useState(false);
  const [viewPage, setViewPage] = useState(1);
  // Paginate for the full-screen "View" modal the same way as live preview/PDF.
  const viewPages = paginateItems(form.items);
  const viewPageCount = viewPages.length;
  const viewPageIdx = Math.min(viewPage, viewPageCount) - 1;
  const viewPageStart = viewPages
    .slice(0, viewPageIdx)
    .reduce((n, g) => n + g.length, 0);
  const isLastViewPage = viewPageIdx === viewPageCount - 1;

  // Close view modal on Escape; reset to page 1 when reopening.
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

  const [showDiscount, setShowDiscount] = useState((form.discount || 0) > 0);
  const m = (v: number) => money(v, form.currency || "AED");
  const shown = viewAll ? allTemplates : allTemplates.slice(0, 5);

  const saveAndSend = async () => {
    const savedId = await onSave();
    const effectiveId = savedId ?? form.id;
    if (!form.customer_email) {
      toast.error("Add a customer email (Invoice Details) to send this invoice.");
      return;
    }
    const t = applyRoundOff(
      docTotals(form.items, form.discount || 0, form.tax_rate || 0, form.unit_price_formula),
      !!form.round_off
    );
    let portalUrl = "";
    try {
      if (effectiveId) {
        const token = await billing.publicLink(effectiveId);
        portalUrl = `${location.origin}${location.pathname}#/portal/${token}`;
      }
    } catch {
      /* link optional */
    }
    // Attach the rendered invoice as a PDF (best-effort — never block the send
    // if PDF generation fails; the summary + portal link still go out).
    let attachments: { filename: string; content: string }[] | undefined;
    try {
      const el = exportRef.current || invoiceRef.current;
      if (el) {
        const pdf = await elementToPdfBytes(el, form.number || "invoice");
        attachments = [
          {
            filename: `${form.number || "invoice"}.pdf`,
            content: bytesToBase64(pdf.bytes),
          },
        ];
      }
    } catch {
      /* attachment optional */
    }
    try {
      await sendEmail({
        to: form.customer_email,
        subject: `Invoice ${form.number} from ${form.seller_name}`,
        attachments,
        html: emailShell(
          `Invoice ${form.number}`,
          `<p>Dear ${esc(form.customer_name || "customer")},</p>
           <p>Please find your invoice <b>${esc(form.number)}</b>.</p>
           <table style="width:100%;font-size:14px;margin:12px 0">
             <tr><td>Subtotal</td><td style="text-align:right">${m(t.subtotal)}</td></tr>
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
           ${
             portalUrl
               ? `<p style="margin:16px 0"><a href="${portalUrl}" style="background:#FFD600;color:#0A0A0A;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:700;display:inline-block">View &amp; pay online</a></p>`
               : ""
           }
           <p>${esc(form.notes ?? "")}</p>`
        ),
      });
      toast.success(`Invoice emailed to ${form.customer_email}`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        onSave();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        saveAndSend();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "p") {
        e.preventDefault();
        downloadPdf();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div>
      {/* header bar */}
      <div className="no-print flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <button
            className="rounded-xl p-2.5 text-brand-500 hover:bg-brand-50 transition-colors cursor-pointer mt-0.5"
            onClick={onBack}
            aria-label="Back"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-[22px] font-semibold text-foreground tracking-tight">Create Invoice</h1>
            <p className="text-sm text-brand-500 mt-0.5">
              Create and send professional invoices to your customers
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
          <button
            className="btn-ghost"
            onClick={downloadPdf}
            title="Download PDF (Ctrl+P)"
          >
            <Download size={15} /> PDF
          </button>
          {partyLabel !== "Supplier" && (
            <button
              className="btn-ghost"
              onClick={exportXml}
              title="Export UAE e-Invoice XML (Peppol PINT-AE)"
            >
              <FileCode size={15} /> XML
            </button>
          )}
          <button
            className="btn-ghost"
            onClick={onSave}
            disabled={saving}
            title="Save without sending (Ctrl+S)"
          >
            <Save size={15} /> {saving ? "Saving…" : "Save"}
          </button>
          <button
            className="btn-ghost"
            onClick={onEditCompany}
            title="Edit company details"
          >
            <Building2 size={15} /> Company
          </button>
          {form.status === "draft" ? (
            <button
              className="btn-primary"
              onClick={handleFinalize}
              disabled={saving}
              title="Finalize — posts to Orders & Accounting, updates inventory for linked products, and shows in reports & the dashboard"
            >
              <CheckCircle2 size={15} /> Mark as done
            </button>
          ) : (
            <button
              className="btn-ghost"
              onClick={onRevertDraft}
              disabled={saving}
              title="Move this invoice back to draft"
            >
              <Pencil size={15} /> Move to draft
            </button>
          )}
          <button
            className="btn-primary"
            onClick={saveAndSend}
            disabled={saving}
            title="Save and email the invoice to the customer (Ctrl+Enter)"
          >
            <Send size={15} /> Send
          </button>
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

      <InventoryImportModal
        open={invOpen}
        onClose={() => setInvOpen(false)}
        onPick={(p) => {
          addItemFromProduct(p);
          toast.success(`Added ${p.name}`);
        }}
      />

            <ResizablePanels
        left={
          <div className="no-print space-y-4">
            
          {/* 1 · Choose template */}
          <Step
            n={1}
            title="Choose Template"
            subtitle="Select a template for your invoice"
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
                const ct = isCustom ? customTemplates.find((c) => c.id === tpl.id) : null;
                const isFile = ct?.type === "file";
                return (
                  <button
                      key={tpl.id}
                      onClick={() => set("template", tpl.id)}
                      className={`group relative shrink-0 w-32 rounded-xl border-2 p-2 text-left transition-all cursor-pointer ${
                        active
                          ? "border-primary-400 bg-primary-50 "
                          : "border-brand-100 bg-white hover:border-primary-300"
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
                          className="absolute top-1.5 left-1.5 z-20 grid h-5 w-5 place-items-center rounded-full bg-white/90 text-brand-400 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100 cursor-pointer shadow-sm border border-brand-100"
                        >
                          <Trash2 size={11} />
                        </span>
                      )}
                      <TemplateTilePreview
                        templateId={tpl.id}
                        customTemplates={customTemplates}
                      />
                      <p className="text-xs font-medium text-ink mt-2 flex items-center gap-1">
                        {tpl.name}
                        {isFile ? (
                          <span className="text-[9px] px-1 py-0.5 rounded-lg bg-amber-100 text-amber-700 font-medium flex items-center gap-0.5">
                            <Upload size={8} /> Uploaded
                          </span>
                        ) : isCustom ? (
                          <span className="text-[9px] px-1 py-0.5 rounded-lg bg-primary-100 text-primary-700 font-medium">
                            Custom
                          </span>
                        ) : null}
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
                <Field label={partyLabel}>
                  <div className="flex gap-2">
                    <select
                      className="select"
                      value=""
                      onChange={(e) => {
                        const c = customers.find((x) => String(x.id) === e.target.value);
                        if (c) applyCustomer(c);
                      }}
                    >
                      <option value="">
                        {customers.length
                          ? "Select saved customer…"
                          : "No saved customers yet"}
                      </option>
                      {customers.map((c) => {
                        const bal = balFor(c.company || c.name);
                        return (
                          <option key={c.id} value={c.id}>
                            {c.company || c.name}
                            {bal > 0 ? ` — BAL ${Math.round(bal).toLocaleString()}` : ""}
                          </option>
                        );
                      })}
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
                <Field label={`${partyLabel} / Company Name`}>
                  <input
                    className="input"
                    placeholder="Acme Corporation LLC"
                    value={form.customer_name}
                    onChange={(e) => set("customer_name", e.target.value)}
                  />
                  {balFor(form.customer_name) > 0 &&
                    (() => {
                      const bal = balFor(form.customer_name);
                      const limit = customers.find((c) => c.id === form.customer_id)
                        ?.credit_limit;
                      const over = limit != null && limit > 0 && bal > limit;
                      return (
                        <p className={`text-xs mt-1 ${over ? "text-danger" : "text-brand-500"}`}>
                          Outstanding: {money(bal, "AED")}
                          {over && ` — over credit limit (${money(limit!, "AED")})`}
                        </p>
                      );
                    })()}
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
                {form.customer_id != null &&
                  (availAdvance > 0 || (Number(form.advance_applied) || 0) > 0) && (
                    <Field label="Apply customer advance">
                      <div className="flex items-center gap-2">
                        <input
                          className="input"
                          type="number"
                          min={0}
                          max={availAdvance}
                          step="0.01"
                          placeholder="0.00"
                          value={form.advance_applied || ""}
                          onChange={(e) => {
                            const v = Math.max(
                              0,
                              Math.min(availAdvance, parseFloat(e.target.value) || 0)
                            );
                            set("advance_applied", v);
                          }}
                        />
                        <button
                          type="button"
                          className="btn-ghost text-xs whitespace-nowrap"
                          onClick={() => set("advance_applied", availAdvance)}
                          disabled={availAdvance <= 0}
                        >
                          Use {money(availAdvance, form.currency || "AED")}
                        </button>
                        {(Number(form.advance_applied) || 0) > 0 && (
                          <button
                            type="button"
                            className="btn-ghost text-xs"
                            onClick={() => set("advance_applied", 0)}
                          >
                            Clear
                          </button>
                        )}
                      </div>
                      <p className="text-[11px] text-brand-400 mt-1">
                        {money(availAdvance, form.currency || "AED")} advance available —
                        subtracted from the invoice total.
                      </p>
                    </Field>
                  )}
                <Field label={`${partyLabel} Email / TRN`}>
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
                <Field label={`${partyLabel} City / Emirate / Country`}>
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      className="input"
                      placeholder="City"
                      value={form.buyer_city ?? ""}
                      onChange={(e) => set("buyer_city", e.target.value)}
                    />
                    <select
                      className="input"
                      value={form.buyer_country_subdivision ?? ""}
                      onChange={(e) => set("buyer_country_subdivision", e.target.value)}
                    >
                      <option value="">Emirate…</option>
                      {EMIRATES.map((em) => (
                        <option key={em.code} value={em.code}>
                          {em.label}
                        </option>
                      ))}
                    </select>
                    <input
                      className="input"
                      placeholder="AE"
                      value={form.buyer_country_code ?? ""}
                      onChange={(e) =>
                        set("buyer_country_code", e.target.value.toUpperCase())
                      }
                    />
                  </div>
                </Field>
              </div>
              <div className="space-y-3">
                <Field label="Document Title">
                  <input
                    className="input"
                    placeholder="INVOICE"
                    value={form.doc_title || ""}
                    list="doc-title-suggestions"
                    onChange={(e) => set("doc_title", e.target.value)}
                  />
                  <datalist id="doc-title-suggestions">
                    <option value="Tax Invoice" />
                    <option value="Proforma Invoice" />
                    <option value="Commercial Invoice" />
                    <option value="Invoice" />
                    <option value="Quotation" />
                    <option value="Receipt" />
                    <option value="Credit Note" />
                    <option value="Debit Note" />
                    <option value="Delivery Note" />
                    <option value="Purchase Order" />
                    <option value="Statement" />
                  </datalist>
                </Field>
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
                  <DateField
                    value={form.issue_date ?? ""}
                    onChange={(v) => set("issue_date", v)}
                    clearable={false}
                  />
                </Field>
                <Field label="Payment Terms">
                  <select
                    className="select"
                    value={form.payment_terms || ""}
                    onChange={(e) => {
                      const id = e.target.value;
                      const days = PAYMENT_TERMS.find((t) => t.id === id)?.days;
                      setForm({
                        ...form,
                        payment_terms: id || undefined,
                        due_date:
                          days == null || !form.issue_date
                            ? form.due_date
                            : addDaysTo(form.issue_date, days),
                      });
                    }}
                  >
                    <option value="">Custom / none</option>
                    {PAYMENT_TERMS.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Due Date (optional)">
                  <DateField
                    value={form.due_date ?? ""}
                    onChange={(v) => set("due_date", v)}
                  />
                </Field>
                <Field label="Date of Supply (optional)">
                  <DateField
                    value={form.date_of_supply ?? ""}
                    onChange={(v) => set("date_of_supply", v)}
                  />
                </Field>
                <Field label="PO Number (optional)">
                  <input
                    className="input"
                    placeholder="e.g. PO-2024-001"
                    value={form.po_number || ""}
                    onChange={(e) => set("po_number", e.target.value)}
                  />
                </Field>
                <Field label="PO Date (optional)">
                  <DateField
                    value={form.po_date ?? ""}
                    onChange={(v) => set("po_date", v)}
                  />
                </Field>
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
                <Field label="Invoice Type Code (e-invoice)">
                  <select
                    className="select"
                    value={form.invoice_type_code || DEFAULT_INVOICE_TYPE_CODE}
                    onChange={(e) => set("invoice_type_code", e.target.value)}
                  >
                    {INVOICE_TYPE_CODES.map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.code} — {t.label}
                      </option>
                    ))}
                  </select>
                </Field>
                {CORRECTIVE_TYPE_CODES.includes(
                  form.invoice_type_code || DEFAULT_INVOICE_TYPE_CODE
                ) && (
                  <>
                    <Field label="Original Invoice No. (credit/debit note)">
                      <input
                        className="input"
                        placeholder="e.g. INV-2026-001"
                        value={form.original_invoice_number || ""}
                        onChange={(e) => set("original_invoice_number", e.target.value)}
                      />
                    </Field>
                    <Field label="Original Invoice Date">
                      <input
                        type="date"
                        className="input"
                        value={form.original_invoice_date || ""}
                        onChange={(e) => set("original_invoice_date", e.target.value)}
                      />
                    </Field>
                  </>
                )}
                {(form.currency || "AED") !== "AED" && (
                  <Field label="Exchange Rate to AED (e-invoice)">
                    <input
                      type="number"
                      step="0.0001"
                      min="0"
                      className="input"
                      placeholder={`1 ${form.currency || "AED"} = ? AED`}
                      value={form.aed_exchange_rate ?? ""}
                      onChange={(e) =>
                        set(
                          "aed_exchange_rate",
                          e.target.value === "" ? null : Number(e.target.value)
                        )
                      }
                    />
                  </Field>
                )}
                <Field label="Payment Means (e-invoice)">
                  <select
                    className="select"
                    value={form.payment_means_code || DEFAULT_PAYMENT_MEANS_CODE}
                    onChange={(e) => set("payment_means_code", e.target.value)}
                  >
                    {PAYMENT_MEANS_CODES.map((p) => (
                      <option key={p.code} value={p.code}>
                        {p.code} — {p.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Transaction Type (e-invoice)">
                  <div className="grid grid-cols-2 gap-1.5">
                    {TRANSACTION_TYPE_FLAGS.map((f) => (
                      <label
                        key={f.key}
                        className="flex items-center gap-1.5 text-xs text-brand-600"
                      >
                        <input
                          type="checkbox"
                          checked={decodeTransactionType(form.transaction_type)[f.key]}
                          onChange={(e) => {
                            const flags = decodeTransactionType(form.transaction_type);
                            flags[f.key] = e.target.checked;
                            set("transaction_type", encodeTransactionType(flags));
                          }}
                        />
                        {f.label}
                      </label>
                    ))}
                  </div>
                </Field>
                <Field label="Tax Category — set all lines">
                  {/* Bulk-set every line's category (the common single-rate case).
                      Mixed-rate invoices override per line in the items table. */}
                  <select
                    className="select"
                    value={form.items[0]?.tax_category || DEFAULT_TAX_CATEGORY}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        items: form.items.map((it) => ({
                          ...it,
                          tax_category: e.target.value,
                        })),
                      })
                    }
                  >
                    {TAX_CATEGORY_CODES.map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.code} — {t.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <p className="col-span-full text-[11px] text-brand-400">
                  The PDF is the human-readable copy your customer sees. Under the
                  FTA e-invoicing mandate (MD 243/2025), the legal invoice is the
                  PINT-AE XML exchanged via your accredited service provider —
                  export it with the XML button in the toolbar above.
                </p>
              </div>
            </div>
          </Step>

          {/* 3 · Items */}
          <Step n={3} title="Items">
            <div className="rounded-xl border border-brand-200 p-3 mb-3">
              <div className="flex items-center justify-between gap-2 text-xs font-semibold text-brand-500 mb-2">
                Multiply field with unit price
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
                      <option key={c.key} value={c.key}>{c.label}</option>
                    ))}
                  </select>
                  <span className="text-brand-400">× unit price</span>
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
                    <th className="py-2 px-2 w-24 text-right">Qty</th>
                    <th className="py-2 px-2 w-24 text-right">Unit</th>
                    <th className="py-2 px-2 w-28 text-right">Calc</th>
                    {(form.tax_rate || 0) > 0 && (
                      <th className="py-2 px-2 w-16 text-right" title="Tax category">
                        Tax
                      </th>
                    )}
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
                            const toIdx = idx;
                            if (fromIdx >= 0) {
                              const next = [...form.customColumns];
                              const [moved] = next.splice(fromIdx, 1);
                              next.splice(toIdx, 0, moved);
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
                    <th className="py-2 px-2 w-32 text-right">Unit Price</th>
                    <th className="py-2 px-2 w-20 text-right" title="Per-line discount %">
                      Disc %
                    </th>
                    {(form.tax_rate || 0) > 0 && (
                      <th className="py-2 px-2 w-24 text-right">VAT</th>
                    )}
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
                          <span className="ml-1 text-[10px] text-primary-700 font-medium">↳ new page</span>
                        )}
                      </td>
                      <td className="py-2 px-2">
                        <input
                          className="input"
                          placeholder="Item description"
                          value={it.description}
                          onChange={(e) => setItem(i, { description: e.target.value })}
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="number"
                          className="input text-right !px-2"
                          value={it.qty || ""}
                          placeholder="0"
                          onChange={(e) => {
                            const qty = numInput(e.target.value);
                            if (it.calcMode === "manual") {
                              setItem(i, {
                                qty,
                                unit_price: qty ? r2(it.amount / qty) : it.amount,
                              });
                            } else {
                              setItem(i, { qty });
                            }
                          }}
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
                      <td className="py-2 px-2">
                        <select
                          className="input text-right !px-2 !py-1 text-xs"
                          value={
                            it.calcMode === "manual"
                              ? "manual"
                              : it.calcMode === "formula" && it.itemFormula?.a
                                ? it.itemFormula.a === "qty"
                                  ? "qty"
                                  : `formula:${it.itemFormula.a}`
                                : "auto"
                          }
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === "auto") {
                              setItem(i, { calcMode: "auto", itemFormula: null });
                            } else if (v === "manual") {
                              const amount = invoiceLineAmount(it, form.unit_price_formula);
                              setItem(i, {
                                calcMode: "manual",
                                amount,
                                unit_price: it.qty ? r2(amount / it.qty) : amount,
                                itemFormula: null,
                              });
                            } else if (v === "qty") {
                              setItem(i, {
                                calcMode: "formula",
                                itemFormula: { a: "qty", b: "unit_price" },
                              });
                            } else if (v.startsWith("formula:")) {
                              const field = v.slice("formula:".length);
                              setItem(i, {
                                calcMode: "formula",
                                itemFormula: { a: field, b: "unit_price" },
                              });
                            }
                          }}
                        >
                          <option value="auto">Auto</option>
                          <option value="manual">Manual</option>
                          <option value="qty">Formula: Qty</option>
                          {form.customColumns.map((c) => (
                            <option key={c.key} value={`formula:${c.key}`}>
                              Formula: {c.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      {(form.tax_rate || 0) > 0 && (
                        <td className="py-2 px-2">
                          <select
                            className="input text-right !px-2 !py-1 text-xs"
                            value={it.tax_category || DEFAULT_TAX_CATEGORY}
                            title="UAE e-invoice tax category"
                            onChange={(e) =>
                              setItem(i, { tax_category: e.target.value })
                            }
                          >
                            {TAX_CATEGORY_CODES.map((t) => (
                              <option key={t.code} value={t.code} title={t.label}>
                                {t.code}
                              </option>
                            ))}
                          </select>
                        </td>
                      )}
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
                            it.calcMode !== "manual" &&
                            form.unit_price_formula?.a &&
                            form.unit_price_formula?.b
                              ? "bg-brand-50/50"
                              : ""
                          } ${it.calcMode === "manual" ? "opacity-60 cursor-not-allowed" : ""}`}
                          placeholder="0"
                          disabled={it.calcMode === "manual"}
                          value={it.unit_price || ""}
                          onChange={(e) =>
                            setItem(i, { unit_price: numInput(e.target.value) })
                          }
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          className="input text-right !px-2"
                          placeholder="0"
                          value={it.discount || ""}
                          onChange={(e) =>
                            setItem(i, {
                              discount: Math.min(100, Math.max(0, numInput(e.target.value))),
                            })
                          }
                        />
                      </td>
                      {(form.tax_rate || 0) > 0 && (
                        <td className="py-2 px-2 text-right text-brand-500">
                          {m(
                            (docLineAmount(it, form.unit_price_formula) *
                              lineTaxRate(it, form.tax_rate || 0)) /
                              100
                          )}
                          <span className="block text-[10px] text-brand-400">
                            {lineTaxRate(it, form.tax_rate || 0)}%
                          </span>
                        </td>
                      )}
                      <td className="py-2 px-2 text-right font-medium text-ink">
                        {it.calcMode === "manual" ? (
                          <input
                            type="number"
                            className="input text-right !px-2"
                            placeholder="0"
                            value={it.amount || ""}
                            onChange={(e) => {
                              const amount = numInput(e.target.value);
                              setItem(i, {
                                amount,
                                unit_price: it.qty ? r2(amount / it.qty) : amount,
                              });
                            }}
                          />
                        ) : (
                          m(docLineAmount(it, form.unit_price_formula))
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
            {/* Custom column management */}
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
                        const toIdx = idx;
                        if (fromIdx >= 0) {
                          const next = [...form.customColumns];
                          const [moved] = next.splice(fromIdx, 1);
                          next.splice(toIdx, 0, moved);
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
              <button className="btn-ghost text-xs" onClick={() => setInvOpen(true)}>
                <PackageSearch size={13} /> Import from Inventory
              </button>
              <button className="btn-ghost text-xs" onClick={addCustomColumn}>
                <Plus size={12} /> Add Field
              </button>
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
              <button
                className="btn-ghost"
                onClick={() => {
                  if (showDiscount) set("discount", 0);
                  setShowDiscount((v) => !v);
                }}
              >
                {showDiscount ? <Minus size={14} /> : <Plus size={14} />}
                {showDiscount ? "Remove Discount" : "Add Discount"}
              </button>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={!!form.round_off}
                onChange={(e) => set("round_off", e.target.checked)}
              />
              Round off total to whole {form.currency || "AED"}
            </label>
            {showDiscount && (
              <div className="mt-3 max-w-xs">
                <Field label="Discount (amount)">
                  <input
                    type="number"
                    className="input"
                    placeholder="0"
                    value={form.discount || ""}
                    onChange={(e) => set("discount", numInput(e.target.value))}
                  />
                </Field>
              </div>
            )}
          </Step>

          {/* 4 · Branding & finalize */}
          <Step
            n={4}
            title="Branding & finalize"
            subtitle="Logo, bank details, stamp and signature on the printed invoice"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ToggleTile
                icon={ImageIcon}
                label="Logo"
                desc={
                  form.logo
                    ? "Show your logo in the invoice header"
                    : "Upload a logo in Company settings first"
                }
                active={!!form.show_logo}
                onToggle={() => {
                  if (form.logo) setForm({ ...form, show_logo: !form.show_logo });
                }}
              />
              <ToggleTile
                icon={Landmark}
                label="Bank details"
                desc={
                  hasBankInfo(bank)
                    ? "Show payment bank details"
                    : "Add bank details in Settings first"
                }
                active={!!form.show_bank}
                onToggle={() => {
                  if (hasBankInfo(bank)) setForm({ ...form, show_bank: !form.show_bank });
                }}
              />
              <ToggleTile
                icon={Stamp}
                label="Company stamp"
                desc={
                  companyStampSig.stamp?.data
                    ? "Show official stamp — adjust below"
                    : "Upload a stamp in Settings first"
                }
                active={!!form.show_stamp}
                onToggle={() => {
                  if (!companyStampSig.stamp?.data) return;
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
                extra={
                  form.show_stamp &&
                  (form.stamp?.data || companyStampSig.stamp?.data) && (
                    <div className="mt-2">
                      <StampSigAdjust
                        label="Stamp"
                        icon={<Stamp size={13} />}
                        value={form.stamp?.data ? form.stamp : companyStampSig.stamp!}
                        onChange={(v) => setForm({ ...form, stamp: v })}
                      />
                    </div>
                  )
                }
              />
              <ToggleTile
                icon={PenTool}
                label="Signature"
                desc={
                  companyStampSig.signature?.data
                    ? "Show signature block — adjust below"
                    : "Upload a signature in Settings first"
                }
                active={!!form.show_signature}
                onToggle={() => {
                  if (!companyStampSig.signature?.data) return;
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
                extra={
                  form.show_signature &&
                  (form.signature?.data || companyStampSig.signature?.data) && (
                    <div className="mt-2">
                      <StampSigAdjust
                        label="Signature"
                        icon={<PenTool size={13} />}
                        value={
                          form.signature?.data ? form.signature : companyStampSig.signature!
                        }
                        onChange={(v) => setForm({ ...form, signature: v })}
                      />
                    </div>
                  )
                }
              />
            </div>
          </Step>

          {/* 5 · Additional settings */}
          <Step n={5} title="Additional Settings">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-xl border border-border p-4">
                <div className="flex items-center gap-2 text-ink font-semibold text-sm">
                  <Settings size={15} /> Invoice Settings
                </div>
                <div className="mt-3 space-y-2">
                  <div>
                    <p className="text-xs font-semibold text-brand-500 mb-1.5">Apply VAT</p>
                    <div className="flex rounded-xl bg-brand-50 p-0.5">
                      {(
                        [
                          ["Yes", true],
                          ["No", false],
                        ] as const
                      ).map(([lbl, on]) => {
                        const active = (form.tax_rate || 0) > 0 === on;
                        return (
                          <button
                            key={lbl}
                            type="button"
                            onClick={() =>
                              set(
                                "tax_rate",
                                on ? (form.tax_rate > 0 ? form.tax_rate : 5) : 0
                              )
                            }
                            className={`flex-1 rounded-lg px-2.5 py-1 text-xs font-semibold cursor-pointer transition-colors ${
                              active
                                ? "bg-background text-foreground shadow-sm"
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
                    <input
                      type="number"
                      className="input"
                      placeholder="VAT rate %"
                      value={form.tax_rate}
                      onChange={(e) => set("tax_rate", numInput(e.target.value))}
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
                  <div className="flex items-center justify-between gap-2 text-xs font-semibold text-brand-500 border border-brand-200 rounded-xl px-3 py-2">
                    <span className="text-brand-500">Page breaks are manual only</span>
                    <span className="text-[10px] text-brand-400">Use the row action in the items table</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs font-semibold text-brand-500 border border-brand-200 rounded-xl px-3 py-2">
                    Accent color
                    <ColorPicker
                      value={form.accent}
                      onChange={(hex) => set("accent", hex)}
                    />
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-border p-4">
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
                        onChange={(e) => onLogo(e.target.files?.[0])}
                      />
                    </label>
                  )}
                  <p className="text-[11px] text-brand-500 mt-2">
                    Tip: set this once in Settings → Company Details to auto-fill every
                    invoice.
                  </p>
                </div>
              </div>

            </div>
          </Step>
          </div>
        }
        right={
          <div className="sticky top-4 space-y-4">
            
          {/* Template Designer — shown above preview when creating */}
          {designing && (
            <TemplateDesigner
              onSave={(tpl) => {
                setCustomTemplates((prev) => [...prev, tpl]);
                // Select the new template immediately
                set("template", tpl.id);
                setDesigning(false);
              }}
              onClose={() => setDesigning(false)}
            />
          )}

          {/* Live Preview — always visible */}
          <div className="card !p-4">
            <div className="no-print flex items-center justify-between mb-3">
              <div>
                <p className="font-semibold text-ink flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-ink text-white grid place-items-center text-xs font-semibold">
                    4
                  </span>
                  Preview
                </p>
                <p className="text-xs text-brand-500 mt-0.5 ml-8">
                  This is how your invoice will look
                </p>
              </div>
            </div>

            <FitPreview baseWidth={device === "desktop" ? 794 : 420} zoom={zoom} padding={0}>
              {/* ponytail: data-no-i18n + dir=ltr — invoice preview stays English
                  (text + layout) regardless of app language; PDF export clones
                  this subtree so the exemption carries into the captured pages. */}
              <div ref={invoiceRef} data-no-i18n dir="ltr">
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
                  {/* Inner content area mirrors the export sheet (same padding +
                      size) so draggable overlays land at the same spot in the PDF. */}
                  <div
                    style={{
                      position: "relative",
                      width: "100%",
                      minHeight: device === "desktop" ? 1027 : 498,
                    }}
                  >
                  {/* Stamp & Signature — draggable, watermark-style overlay.
                      Per-document copy (form.stamp/signature) seeded from the
                      company asset; falls back to the company asset itself. */}
                  <StampSignatureLayer
                    stamp={
                      form.show_stamp
                        ? form.stamp?.data
                          ? form.stamp
                          : (companyStampSig ?? EMPTY_STAMP_SIG).stamp
                        : undefined
                    }
                    signature={
                      form.show_signature
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
                  <DocView
                    form={form}
                    pageItems={pages[curPageIdx] ?? []}
                    itemStartIndex={pageStartIndex}
                    showTotals={isLastPreviewPage}
                    showFooter={isLastPreviewPage}
                  />
                  {form.show_bank && (
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
            </FitPreview>

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
                <button className="btn-ghost text-xs" onClick={onSave} disabled={saving}>
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

      {/* Off-screen full render: every page stacked as a real A4 sheet.
          Always mounted so PDF export works even when the preview panel is collapsed. */}
      {(() => {
        const exportPages = paginateItems(form.items);
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
                              : (companyStampSig ?? EMPTY_STAMP_SIG).stamp
                            : undefined
                        }
                        signature={
                          form.show_signature
                            ? form.signature?.data
                              ? form.signature
                              : (companyStampSig ?? EMPTY_STAMP_SIG).signature
                            : undefined
                        }
                        onStampMove={() => {}}
                        onSignatureMove={() => {}}
                      />
                    )}
                    <DocView
                      form={form}
                      pageItems={group}
                      itemStartIndex={startIdx}
                      showTotals={isLast}
                      showFooter={isLast}
                    />
                    {isLast && form.show_bank && (
                      <DraggableBlock x={bankX} y={bankY} onMove={() => {}}>
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

      {viewOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 p-4"
          onClick={() => setViewOpen(false)}
        >
          <div
            className="flex max-h-[95vh] w-full max-w-7xl flex-col rounded-xl bg-card border border-border outline-none shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-brand-100 px-6 py-4">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-ink">
                  {form.number || "Invoice preview"}
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
                  data-no-i18n
                  dir="ltr"
                  className="paper-texture rounded-xl border border-brand-200 p-8 shadow-sm dark:bg-white min-h-[1123px]"
                >
                  <div style={{ position: "relative", minHeight: 1059 }}>
                    <StampSignatureLayer
                      stamp={
                        form.show_stamp
                          ? form.stamp?.data
                            ? form.stamp
                            : (companyStampSig ?? EMPTY_STAMP_SIG).stamp
                          : undefined
                      }
                      signature={
                        form.show_signature
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
                    <DocView
                      form={form}
                      pageItems={viewPages[viewPageIdx] ?? []}
                      itemStartIndex={viewPageStart}
                      showTotals={isLastViewPage}
                      showFooter={isLastViewPage}
                    />
                    {form.show_bank && isLastViewPage && (
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
  const { toast } = useUI();
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
        UAE FTA tax invoices require the customer's legal name, address and 15-digit TRN
        for B2B supplies.
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
          <p className="text-xs text-danger">TRN must be exactly 15 digits.</p>
        )}
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn-primary"
          disabled={saving || (!f.company.trim() && !f.name.trim()) || !trnValid}
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
              // createCustomer returns the new row id. Use it for the FK
              // instead of fabricating an { id: 0 } record (which persisted a
              // wrong customer_id on the invoice until the user re-picked).
              const id = await crm.createCustomer(
                payload as Omit<CrmCustomer, "id" | "created_at">
              );
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
  const { toast } = useUI();
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
              onChange={(e) => setC({ ...c, default_template: e.target.value })}
            >
              {[
                ...TEMPLATES,
                ...loadCustomTemplates().map((t) => ({ id: t.id, name: t.name })),
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
        </div>
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
            try {
              await billing.saveCompany(c);
              // Re-fetch so we apply exactly what the server persisted
              // (server defaults, RLS-trimmed columns, etc.) to the
              // invoice page and not just the locally-edited copy.
              let fresh: CompanyProfile;
              try {
                fresh = await billing.getCompany();
              } catch {
                fresh = c; // server unreachable — use what we saved
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
