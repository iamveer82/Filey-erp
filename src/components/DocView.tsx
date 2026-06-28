import { fmtDate, money } from "../lib/format";
import { docTotals, docLineAmount } from "../lib/docItems";
import type { CalcMode } from "../lib/money";
import { loadCustomTemplates } from "./TemplateDesigner";
import { resolveTemplateId } from "./DocTemplates";
import {
  INVOICE_TYPE_CODES,
  PAYMENT_MEANS_CODES,
  TAX_CATEGORY_CODES,
  TRANSACTION_TYPE_FLAGS,
  EMIRATES,
  LEGAL_ID_TYPES,
  decodeTransactionType,
  tinFromTrn,
  type Code,
} from "../lib/einvoice";

/** Map a code to its human label (falls back to the raw code). */
const codeLabel = (list: Code[], code?: string | null): string =>
  !code ? "" : list.find((c) => c.code === code)?.label || code;

export interface DocViewItem {
  description: string;
  qty: number;
  unit_price: number;
  unit?: string;
  custom?: Record<string, string> | null;
  /** Per-line discount percentage (quotation-style). */
  discount?: number;
  /** Per-line tax percentage (quotation-style). */
  tax?: number;
  calcMode?: CalcMode;
  amount?: number;
  itemFormula?: { a: string; b?: string } | null;
  /** UAE e-invoice tax category code (S/Z/E/O/AE). */
  tax_category?: string | null;
}

export interface DocViewCustomColumn {
  key: string;
  label: string;
}

export interface DocViewForm {
  template?: string | null;
  accent?: string | null;
  currency?: string | null;
  doc_title?: string | null;
  number?: string | null;
  logo?: string | null;
  /** When false, hide the logo on this document. Undefined = show (other doc
   *  types that don't expose a logo toggle). */
  show_logo?: boolean;
  seller_name?: string | null;
  seller_address?: string | null;
  seller_trn?: string | null;
  seller_email?: string | null;
  seller_phone?: string | null;
  seller_city?: string | null;
  seller_country_subdivision?: string | null;
  seller_legal_id?: string | null;
  seller_legal_id_type?: string | null;
  customer_name?: string | null;
  customer_address?: string | null;
  customer_trn?: string | null;
  customer_email?: string | null;
  buyer_city?: string | null;
  buyer_country_subdivision?: string | null;
  buyer_country_code?: string | null;
  // Per-document UAE e-invoice codes (rendered as readable labels in the FTA template).
  invoice_type_code?: string | null;
  transaction_type?: string | null;
  payment_means_code?: string | null;
  issue_date?: string | null;
  due_date?: string | null;
  po_number?: string | null;
  tax_rate?: number | null;
  discount?: number | null;
  notes?: string | null;
  terms?: string | null;
  items: DocViewItem[];
  customColumns?: DocViewCustomColumn[];
  unit_price_formula?: { a: string; b: string } | null;
  /** Customer advance applied to this document — shown as a deduction with a
   *  resulting "Balance due" line under the total. */
  advance_applied?: number | null;
}

export interface DocViewLabels {
  docTitle?: string;
  partyLabel?: string;
  issuedLabel?: string;
  dueLabel?: string;
  totalLabel?: string;
}

interface DocViewProps {
  form: DocViewForm;
  pageItems?: DocViewItem[];
  itemStartIndex?: number;
  showTotals?: boolean;
  showFooter?: boolean;
  labels?: DocViewLabels;
}

export default function DocView({
  form,
  pageItems,
  itemStartIndex = 0,
  showTotals = true,
  showFooter = true,
  labels,
}: DocViewProps) {
  const t = docTotals(
    form.items,
    form.discount || 0,
    form.tax_rate || 0,
    form.unit_price_formula
  );
  const ccy = form.currency || "AED";
  const m = (v: number) => money(v, ccy);
  const itemsToRender = pageItems ?? form.items;

  const baseLayout = resolveTemplateId(form.template);
  const customTemplate = form.template?.startsWith("custom-")
    ? loadCustomTemplates().find((ct) => ct.id === form.template)
    : null;
  const templateId = customTemplate?.type === "file" ? "file" : baseLayout;

  const resolvedAccent = customTemplate?.accent || form.accent || "#222222";
  const a = resolvedAccent;

  const docTitle = labels?.docTitle || form.doc_title || "INVOICE";
  const partyLabel = labels?.partyLabel || "Bill To";
  const issuedLabel = labels?.issuedLabel || "Issued";
  const dueLabel = labels?.dueLabel || "Due";
  const totalLabel = labels?.totalLabel || "Total";

  const Items = ({ headerBg, bordered }: { headerBg?: string; bordered?: boolean }) => (
    <table className="w-full text-sm border-collapse mt-2">
      <thead>
        <tr
          style={{ background: headerBg, color: headerBg ? "#fff" : a }}
          className={bordered ? "" : "border-b-2"}
        >
          <th className="text-right py-2 px-2 font-semibold w-8">SL</th>
          <th className="text-left py-2 px-2 font-semibold">Description</th>
          <th className="text-right py-2 px-2 font-semibold w-14">Qty</th>
          <th className="text-right py-2 px-2 font-semibold w-14">Unit</th>
          {(form.customColumns || []).map((col) => (
            <th key={col.key} className="text-right py-2 px-2 font-semibold text-[10px]">
              {col.label}
            </th>
          ))}
          <th className="text-right py-2 px-2 font-semibold w-24">Unit Price</th>
          <th className="text-right py-2 px-2 font-semibold w-28">Amount</th>
        </tr>
      </thead>
      <tbody>
        {itemsToRender.map((it, i) => (
          <tr key={i} className="border-b border-neutral-200" style={bordered ? { borderColor: "#000" } : undefined}>
            <td className="py-2 px-2 text-right text-neutral-500 tabular-nums">{itemStartIndex + i + 1}</td>
            <td className="py-2 px-2">{it.description || "—"}</td>
            <td className="py-2 px-2 text-right">{it.qty}</td>
            <td className="py-2 px-2 text-right text-neutral-500">{it.unit || "—"}</td>
            {(form.customColumns || []).map((col) => (
              <td key={col.key} className="py-2 px-2 text-right text-[10px] text-neutral-500">
                {it.custom?.[col.key] || "—"}
              </td>
            ))}
            <td className="py-2 px-2 text-right">{m(it.unit_price)}</td>
            <td className="py-2 px-2 text-right">{m(docLineAmount(it, form.unit_price_formula))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const Totals = () =>
    showTotals ? (
      <div className="ml-auto w-72 mt-6 text-sm">
        <Row k="Subtotal" v={m(t.subtotal)} />
        {(t.discount || 0) > 0 && <Row k="Discount" v={`- ${m(t.discount)}`} />}
        {(form.tax_rate || 0) > 0 && <Row k={`VAT (${form.tax_rate}%)`} v={m(t.tax)} />}
        <div
          className="flex justify-between py-2 mt-1 font-bold text-base border-t-2"
          style={{ borderColor: a, color: a }}
        >
          <span>{totalLabel}</span>
          <span>{m(t.total)}</span>
        </div>
        {(Number(form.advance_applied) || 0) > 0 && (
          <>
            <Row k="Advance applied" v={`- ${m(Number(form.advance_applied))}`} />
            <div
              className="flex justify-between py-1.5 font-semibold border-t"
              style={{ borderColor: a }}
            >
              <span>Balance due</span>
              <span>{m(Math.max(0, t.total - (Number(form.advance_applied) || 0)))}</span>
            </div>
          </>
        )}
      </div>
    ) : null;

  const Footer = () =>
    showFooter && (form.notes || form.terms) ? (
      <div className="mt-10 pt-4 border-t border-neutral-200 text-xs text-neutral-500 space-y-1">
        {form.notes && <p>{form.notes}</p>}
        {form.terms && <p className="text-neutral-400">{form.terms}</p>}
      </div>
    ) : null;

  // Logo is hidden when the doc explicitly turns it off (show_logo === false).
  // Other doc types leave show_logo undefined, so their logo still shows.
  const logoSrc = form.show_logo === false ? null : (form.logo ?? null);

  const Logo = ({ size = 56 }: { size?: number }) =>
    logoSrc ? (
      <img src={logoSrc} alt="logo" style={{ height: size }} className="object-contain" />
    ) : null;

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
        <p className="text-xs text-neutral-500 whitespace-pre-line">{form.seller_address}</p>
        {form.seller_trn && <p className="text-xs text-neutral-500">TRN: {form.seller_trn}</p>}
        <SellerContact />
      </div>
      <div>
        <p className="text-xs uppercase tracking-wider text-neutral-400">{partyLabel}</p>
        <p className="font-semibold mt-1">{form.customer_name}</p>
        <p className="text-xs text-neutral-500 whitespace-pre-line">{form.customer_address}</p>
        {form.customer_trn && <p className="text-xs text-neutral-500">TRN: {form.customer_trn}</p>}
      </div>
    </div>
  );

  const Meta = () => (
    <div className="flex justify-between text-xs text-neutral-500 mt-4">
      <p className="font-medium">{form.number}</p>
      <p>
        {issuedLabel} {fmtDate(form.issue_date)} · {dueLabel} {fmtDate(form.due_date)}
      </p>
    </div>
  );

  const Initial = ({ size = 48 }: { size?: number }) =>
    logoSrc ? (
      <Logo size={size * 2} />
    ) : (
      <div
        className="grid place-items-center rounded-full font-bold text-white"
        style={{ width: size, height: size, background: a }}
      >
        {(form.seller_name || "C").trim().charAt(0).toUpperCase()}
      </div>
    );

  // ---- File-based custom template ----
  if (templateId === "file" && customTemplate?.fileData) {
    const pw = customTemplate.paperSize === "Letter" ? 816 : 794;
    const ph = customTemplate.paperSize === "Letter" ? 1056 : 1122;
    const pos = customTemplate.positions || {};
    const ac = customTemplate.accent || a;

    const Section = ({ k, children }: { k: string; children: React.ReactNode }) => {
      const p = pos[k];
      if (!p) return null;
      return (
        <div className="absolute" style={{ left: `${p.x}%`, top: `${p.y}%` }}>
          {children}
        </div>
      );
    };

    return (
      <div
        className="relative text-neutral-900 overflow-hidden"
        style={{ width: pw, minHeight: ph, background: "#fff" }}
      >
        <img
          src={customTemplate.fileData}
          alt="Template background"
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ objectFit: "cover", opacity: 0.92 }}
        />
        <Section k="seller">
          {logoSrc && <img src={logoSrc} alt="logo" style={{ height: 40 }} className="object-contain mb-1.5" />}
          <p className="font-bold text-sm text-neutral-900">{form.seller_name}</p>
          <p className="text-[10px] text-neutral-600 whitespace-pre-line leading-tight">{form.seller_address}</p>
          {form.seller_trn && <p className="text-[9px] text-neutral-500 mt-0.5">TRN: {form.seller_trn}</p>}
        </Section>
        <Section k="header">
          <p className="text-2xl font-extrabold tracking-tight" style={{ color: ac }}>{docTitle}</p>
          <p className="text-xs font-medium text-neutral-800 mt-0.5">{form.number}</p>
          <p className="text-[10px] text-neutral-500 mt-0.5">{fmtDate(form.issue_date)}</p>
          {form.due_date && <p className="text-[10px] text-neutral-500">{dueLabel}: {fmtDate(form.due_date)}</p>}
        </Section>
        <Section k="customer">
          <p className="text-[9px] uppercase tracking-wider text-neutral-500 mb-0.5">{partyLabel}</p>
          <p className="font-semibold text-xs text-neutral-900">{form.customer_name}</p>
          <p className="text-[10px] text-neutral-600 whitespace-pre-line leading-tight">{form.customer_address}</p>
          {form.customer_trn && <p className="text-[9px] text-neutral-500 mt-0.5">TRN: {form.customer_trn}</p>}
        </Section>
        {pos.items && (
          <div
            className="absolute overflow-auto"
            style={{ left: `${pos.items.x}%`, top: `${pos.items.y}%`, maxWidth: "90%" }}
          >
            <Items headerBg={ac} />
          </div>
        )}
        {pos.totals && (
          <div className="absolute" style={{ left: `${pos.totals.x}%`, top: `${pos.totals.y}%` }}>
            <Totals />
          </div>
        )}
        <Section k="footer">
          {form.notes && <p className="text-[10px] text-neutral-600">{form.notes}</p>}
          {form.terms && <p className="text-[9px] text-neutral-400 mt-0.5">{form.terms}</p>}
        </Section>
        <div className="absolute bottom-2 right-2 z-20">
          <span className="text-[8px] text-neutral-400 bg-white/60 px-1.5 py-0.5 rounded-full">{customTemplate.name}</span>
        </div>
      </div>
    );
  }

  // ---- MINIMAL ----
  if (templateId === "minimal") {
    return (
      <div className="text-neutral-900">
        <div className="flex justify-between items-start">
          <div>
            <Logo />
            <p className="font-bold text-lg mt-3">{form.seller_name}</p>
            <p className="text-xs text-neutral-500 whitespace-pre-line">{form.seller_address}</p>
            {form.seller_trn && <p className="text-xs text-neutral-500">TRN: {form.seller_trn}</p>}
          </div>
          <div className="text-right">
            <p className="text-3xl font-extrabold tracking-tight" style={{ color: a }}>{docTitle}</p>
            <p className="text-sm font-medium mt-1">{form.number}</p>
          </div>
        </div>
        <div className="flex justify-between mt-10 text-sm">
          <div>
            <p className="text-xs uppercase tracking-wider text-neutral-400">{partyLabel}</p>
            <p className="font-semibold mt-1">{form.customer_name}</p>
            <p className="text-xs text-neutral-500 whitespace-pre-line">{form.customer_address}</p>
            {form.customer_trn && <p className="text-xs text-neutral-500">TRN: {form.customer_trn}</p>}
          </div>
          <div className="text-right text-xs text-neutral-500">
            <p>{issuedLabel}: {fmtDate(form.issue_date)}</p>
            <p>{dueLabel}: {fmtDate(form.due_date)}</p>
          </div>
        </div>
        <Items />
        <Totals />
        <Footer />
      </div>
    );
  }

  // ---- CLASSIC ----
  if (templateId === "classic") {
    return (
      <div className="text-neutral-900">
        <div
          className="flex justify-between items-center px-6 py-5 -mx-12 -mt-12 mb-8"
          style={{ background: a, color: "#fff" }}
        >
          <div className="flex items-center gap-3">
            <Logo size={88} />
            <p className="font-bold text-xl">{form.seller_name}</p>
          </div>
          <p className="text-2xl font-extrabold tracking-widest">{docTitle}</p>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="border border-neutral-300 p-4">
            <p className="text-xs uppercase tracking-wider text-neutral-400 mb-1">From</p>
            <p className="font-semibold">{form.seller_name}</p>
            <p className="text-xs text-neutral-500 whitespace-pre-line">{form.seller_address}</p>
            {form.seller_trn && <p className="text-xs text-neutral-500">TRN: {form.seller_trn}</p>}
            {form.seller_email && <p className="text-xs text-neutral-500">{form.seller_email}</p>}
          </div>
          <div className="border border-neutral-300 p-4">
            <p className="text-xs uppercase tracking-wider text-neutral-400 mb-1">{partyLabel}</p>
            <p className="font-semibold">{form.customer_name}</p>
            <p className="text-xs text-neutral-500 whitespace-pre-line">{form.customer_address}</p>
            {form.customer_trn && <p className="text-xs text-neutral-500">TRN: {form.customer_trn}</p>}
          </div>
        </div>
        <div className="flex justify-between text-xs text-neutral-500 mt-4">
          <p className="font-medium">{form.number}</p>
          <p>
            {issuedLabel} {fmtDate(form.issue_date)} · {dueLabel} {fmtDate(form.due_date)}
          </p>
        </div>
        <Items headerBg={a} bordered />
        <Totals />
        <Footer />
      </div>
    );
  }

  // ---- CORPORATE ----
  if (templateId === "corporate") {
    return (
      <div className="text-neutral-900">
        <div
          className="flex justify-between items-start border-b-4 pb-5"
          style={{ borderColor: a }}
        >
          <div className="flex items-center gap-3">
            <Logo size={96} />
            <div>
              <p className="font-bold text-xl">{form.seller_name}</p>
              <p className="text-xs text-neutral-500 whitespace-pre-line">{form.seller_address}</p>
              <SellerContact />
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold tracking-wide" style={{ color: a }}>{docTitle.toUpperCase()}</p>
            <p className="text-sm font-medium mt-1">{form.number}</p>
            {form.seller_trn && <p className="text-xs text-neutral-500 mt-1">TRN {form.seller_trn}</p>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm mt-6">
          <div className="bg-neutral-50 p-4 rounded">
            <p className="text-xs uppercase tracking-wider text-neutral-400 mb-1">{partyLabel}</p>
            <p className="font-semibold">{form.customer_name}</p>
            <p className="text-xs text-neutral-500 whitespace-pre-line">{form.customer_address}</p>
            {form.customer_trn && <p className="text-xs text-neutral-500">TRN: {form.customer_trn}</p>}
          </div>
          <div className="bg-neutral-50 p-4 rounded text-right">
            <p className="text-xs text-neutral-500">{issuedLabel} {fmtDate(form.issue_date)}</p>
            <p className="text-xs text-neutral-500">{dueLabel} {fmtDate(form.due_date)}</p>
          </div>
        </div>
        <Items headerBg={a} />
        <Totals />
        <Footer />
      </div>
    );
  }

  // ---- ELEGANT ----
  if (templateId === "elegant") {
    return (
      <div className="text-neutral-800 font-serif">
        <div className="text-center">
          <Logo size={104} />
          <p className="text-3xl tracking-[0.3em] mt-4" style={{ color: a }}>{docTitle}</p>
          <div className="mx-auto w-16 h-px my-3" style={{ background: a }} />
          <p className="text-xs tracking-widest text-neutral-500">{form.number} · {fmtDate(form.issue_date)}</p>
        </div>
        <div className="flex justify-between mt-10 text-sm">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-neutral-400">From</p>
            <p className="font-semibold mt-1">{form.seller_name}</p>
            <p className="text-xs text-neutral-500 whitespace-pre-line">{form.seller_address}</p>
            <SellerContact />
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-widest text-neutral-400">Billed To</p>
            <p className="font-semibold mt-1">{form.customer_name}</p>
            <p className="text-xs text-neutral-500 whitespace-pre-line">{form.customer_address}</p>
          </div>
        </div>
        <Items />
        <Totals />
        <Footer />
      </div>
    );
  }

  // ---- BOLD ----
  if (templateId === "bold") {
    return (
      <div className="text-neutral-900">
        <div
          className="-mx-12 -mt-12 px-12 pt-12 pb-10 mb-8"
          style={{ background: a, color: "#fff" }}
        >
          <div className="flex justify-between items-start">
            <Logo size={100} />
            <p className="text-5xl font-extrabold tracking-tight">{docTitle}</p>
          </div>
          <div className="flex justify-between items-end mt-8">
            <div>
              <p className="text-lg font-bold">{form.seller_name}</p>
              <p className="text-xs opacity-80 whitespace-pre-line">{form.seller_address}</p>
            </div>
            <div className="text-right text-sm">
              <p className="font-medium">{form.number}</p>
              <p className="opacity-80">{dueLabel} {fmtDate(form.due_date)}</p>
            </div>
          </div>
        </div>
        <div className="text-sm">
          <p className="text-xs uppercase tracking-wider text-neutral-400">{partyLabel}</p>
          <p className="font-semibold mt-1">{form.customer_name}</p>
          <p className="text-xs text-neutral-500 whitespace-pre-line">{form.customer_address}</p>
        </div>
        <Items headerBg={a} />
        <Totals />
        <Footer />
      </div>
    );
  }

  // ---- TECH ----
  if (templateId === "tech") {
    return (
      <div className="text-neutral-900 font-medium">
        <div className="flex justify-between items-start">
          <div>
            <Logo size={80} />
            <p className="text-sm font-bold mt-2">{form.seller_name}</p>
            <p className="text-[11px] text-neutral-500 whitespace-pre-line">{form.seller_address}</p>
            <SellerContact cls="text-neutral-500" />
          </div>
          <div
            className="px-4 py-3 rounded-lg text-right"
            style={{ background: `${a}15`, border: `1px solid ${a}` }}
          >
            <p className="text-lg font-bold" style={{ color: a }}>{docTitle.toLowerCase()}</p>
            <p className="text-xs">{form.number}</p>
            <p className="text-[11px] text-neutral-500">{fmtDate(form.issue_date)} → {fmtDate(form.due_date)}</p>
          </div>
        </div>
        <div className="mt-8 text-xs">
          <span className="text-neutral-400">{"// bill_to"}</span>
          <p className="font-bold text-sm mt-1">{form.customer_name}</p>
          <p className="text-neutral-500 whitespace-pre-line">{form.customer_address}</p>
        </div>
        <Items headerBg={a} />
        <Totals />
        <Footer />
      </div>
    );
  }

  // ---- CREATIVE ----
  if (templateId === "creative") {
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
          <p className="text-4xl font-extrabold italic" style={{ color: a }}>{docTitle}</p>
        </div>
        <div
          className="relative mt-8 rounded-2xl p-5 text-sm"
          style={{ background: `${a}12` }}
        >
          <div className="flex justify-between">
            <div>
              <p className="text-xs uppercase tracking-wider text-neutral-500">{partyLabel}</p>
              <p className="font-semibold mt-1">{form.customer_name}</p>
              <p className="text-xs text-neutral-500 whitespace-pre-line">{form.customer_address}</p>
            </div>
            <div className="text-right text-xs text-neutral-500">
              <p className="font-medium">{form.number}</p>
              <p>{issuedLabel} {fmtDate(form.issue_date)}</p>
              <p>{dueLabel} {fmtDate(form.due_date)}</p>
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
  if (templateId === "receipt") {
    return (
      <div className="text-neutral-900 max-w-sm mx-auto text-center">
        <Initial size={44} />
        <p className="font-bold text-lg mt-2">{form.seller_name}</p>
        <p className="text-[11px] text-neutral-500 whitespace-pre-line">{form.seller_address}</p>
        <SellerContact />
        <div className="border-t-2 border-dashed border-neutral-300 my-4" />
        <div className="flex justify-between text-xs">
          <span className="text-neutral-500">{docTitle}</span>
          <span className="font-medium">{form.number}</span>
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
  if (templateId === "monogram") {
    return (
      <div className="text-neutral-900">
        <div className="flex flex-col items-center">
          <Initial size={64} />
          <p className="font-bold text-xl mt-3">{form.seller_name}</p>
          <p className="text-xs text-neutral-500 whitespace-pre-line text-center">{form.seller_address}</p>
          <SellerContact />
        </div>
        <div
          className="mt-6 py-2 text-center text-sm font-semibold tracking-[0.25em]"
          style={{ borderTop: `1px solid ${a}`, borderBottom: `1px solid ${a}`, color: a }}
        >
          {docTitle} {form.number}
        </div>
        <Parties />
        <Meta />
        <Items />
        <Totals />
        <Footer />
      </div>
    );
  }

  // ---- GREEN GOLD ----
  if (templateId === "green-gold") {
    return (
      <div className="text-neutral-900" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
        <div
          className="-mx-12 -mt-12 mb-0"
          style={{
            background: "linear-gradient(135deg, #1B5E20 0%, #2E7D32 40%, #388E3C 100%)",
            height: 6,
          }}
        />
        <div
          className="flex justify-between items-start mt-8 pb-6"
          style={{ borderBottom: "3px solid #D4A017" }}
        >
          <div className="flex items-center gap-4">
            <Logo size={64} />
            <div>
              <p className="font-extrabold text-xl tracking-tight" style={{ color: "#1B5E20" }}>{form.seller_name}</p>
              <p className="text-xs text-neutral-500 whitespace-pre-line leading-relaxed">{form.seller_address}</p>
              {form.seller_trn && <p className="text-[11px] text-neutral-400 mt-0.5">TRN: {form.seller_trn}</p>}
            </div>
          </div>
          <div className="text-right">
            <p className="text-4xl font-black tracking-tighter" style={{ color: "#D4A017" }}>{docTitle}</p>
            <p className="text-sm font-medium text-neutral-600 mt-1">{form.number}</p>
            <div className="mt-3 pt-3" style={{ borderTop: "1px solid #E8D5A3" }}>
              <p className="text-[11px] text-neutral-500">{fmtDate(form.issue_date)}</p>
              <p className="text-[11px] text-neutral-400">{dueLabel}: {fmtDate(form.due_date)}</p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-8 mt-6">
          <div
            className="rounded-lg p-4"
            style={{ background: "#F1F8E9", border: "1px solid #C8E6C9" }}
          >
            <p
              className="text-[10px] uppercase tracking-[0.2em] font-semibold mb-2"
              style={{ color: "#1B5E20" }}
            >
              {partyLabel}
            </p>
            <p className="font-bold text-sm">{form.customer_name}</p>
            <p className="text-xs text-neutral-600 whitespace-pre-line leading-relaxed mt-1">{form.customer_address}</p>
            {form.customer_trn && <p className="text-[10px] text-neutral-400 mt-1">TRN: {form.customer_trn}</p>}
          </div>
          <div
            className="rounded-lg p-4"
            style={{ background: "#FFF8E1", border: "1px solid #FFE082" }}
          >
            <div className="flex justify-between text-xs text-neutral-600">
              <span>{issuedLabel} Date</span>
              <span className="font-medium">{fmtDate(form.issue_date)}</span>
            </div>
            <div className="flex justify-between text-xs text-neutral-600 mt-2">
              <span>{dueLabel} Date</span>
              <span className="font-medium">{fmtDate(form.due_date)}</span>
            </div>
            <div className="flex justify-between text-xs text-neutral-600 mt-2">
              <span>Reference</span>
              <span className="font-medium">{form.number}</span>
            </div>
            {form.po_number && (
              <div className="flex justify-between text-xs text-neutral-600 mt-2">
                <span>PO Number</span>
                <span className="font-medium">{form.po_number}</span>
              </div>
            )}
          </div>
        </div>
        <Items headerBg="#1B5E20" />
        <Totals />
        <Footer />
        <div
          className="-mx-12 mt-8"
          style={{
            background: "linear-gradient(135deg, #1B5E20 0%, #2E7D32 40%, #388E3C 100%)",
            height: 3,
          }}
        />
        <p className="text-center text-[10px] text-neutral-400 mt-3">Thank you for your business</p>
      </div>
    );
  }

  // ---- UAE PROFESSIONAL ----
  if (templateId === "uae") {
    return (
      <div className="text-neutral-900" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
        <div className="-mx-12 -mt-12 mb-8 flex" style={{ height: 4 }}>
          <div style={{ flex: 1, background: "#00732E" }} />
          <div style={{ flex: 1, background: "#FFFFFF", borderLeft: "1px solid #ddd", borderRight: "1px solid #ddd" }} />
          <div style={{ flex: 1, background: "#000000" }} />
          <div style={{ width: 8, background: "#CE1126" }} />
        </div>
        <div className="flex justify-between items-start">
          <div>
            <Logo size={56} />
            <p className="font-bold text-lg mt-2">{form.seller_name}</p>
            <p className="text-[11px] text-neutral-500 whitespace-pre-line">{form.seller_address}</p>
            <SellerContact />
          </div>
          <div className="text-right">
            <div className="inline-block px-6 py-3 rounded-sm" style={{ background: "#1a1a1a" }}>
              <p className="text-white text-2xl font-bold tracking-widest">{docTitle}</p>
            </div>
            <p className="text-sm font-medium mt-3">{form.number}</p>
            <p className="text-xs text-neutral-500 mt-1">{fmtDate(form.issue_date)}</p>
          </div>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-6">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-neutral-400 font-semibold">{partyLabel}</p>
            <p className="font-bold mt-2">{form.customer_name}</p>
            <p className="text-xs text-neutral-600 whitespace-pre-line">{form.customer_address}</p>
            {form.customer_trn && <p className="text-[10px] text-neutral-400 mt-1">TRN: {form.customer_trn}</p>}
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1.5 px-3 rounded" style={{ background: "#f5f5f5" }}>
              <span className="text-neutral-500">Date</span>
              <span className="font-medium">{fmtDate(form.issue_date)}</span>
            </div>
            <div className="flex justify-between py-1.5 px-3 rounded" style={{ background: "#f5f5f5" }}>
              <span className="text-neutral-500">{dueLabel}</span>
              <span className="font-medium">{fmtDate(form.due_date)}</span>
            </div>
            <div className="flex justify-between py-1.5 px-3 rounded" style={{ background: "#f5f5f5" }}>
              <span className="text-neutral-500">Reference</span>
              <span className="font-medium">{form.number}</span>
            </div>
          </div>
        </div>
        <Items headerBg="#1a1a1a" />
        <Totals />
        <Footer />
      </div>
    );
  }

  // ---- UAE FTA TAX INVOICE (Peppol PINT-AE field-complete) ----
  if (templateId === "fta") {
    const invType =
      codeLabel(INVOICE_TYPE_CODES, form.invoice_type_code) || "Tax invoice";
    const payMeans = codeLabel(PAYMENT_MEANS_CODES, form.payment_means_code);
    const sellerEmirate = codeLabel(EMIRATES, form.seller_country_subdivision);
    const buyerEmirate = codeLabel(EMIRATES, form.buyer_country_subdivision);
    const sellerLegalType = codeLabel(LEGAL_ID_TYPES, form.seller_legal_id_type);
    const sellerTin = tinFromTrn(form.seller_trn);
    const buyerTin = tinFromTrn(form.customer_trn);
    const txFlags = decodeTransactionType(form.transaction_type);
    const activeTx = TRANSACTION_TYPE_FLAGS.filter((f) => txFlags[f.key]);

    // Category-aware tax math: VAT only on standard-rated lines, document
    // discount allocated pro-rata by line net so the breakdown reconciles with
    // the total. ponytail: refine if per-line VAT rates are ever introduced.
    const lineNets = form.items.map((it) => ({
      cat: it.tax_category || "S",
      net: docLineAmount(it, form.unit_price_formula),
    }));
    const grossNet = lineNets.reduce((s, l) => s + l.net, 0);
    const discount = t.discount || 0;
    const netAfterDisc = grossNet - discount;
    const byCat: Record<string, number> = {};
    for (const l of lineNets) byCat[l.cat] = (byCat[l.cat] || 0) + l.net;
    const breakdown = Object.entries(byCat).map(([cat, net]) => {
      const taxable = grossNet > 0 ? netAfterDisc * (net / grossNet) : 0;
      const rate = cat === "S" ? form.tax_rate || 0 : 0;
      return { cat, taxable, rate, tax: (taxable * rate) / 100 };
    });
    const vat = breakdown.reduce((s, b) => s + b.tax, 0);
    const grandTotal = netAfterDisc + vat;

    return (
      <div
        className="text-neutral-900"
        style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}
      >
        {/* Header */}
        <div
          className="flex justify-between items-start border-b-2 pb-4"
          style={{ borderColor: a }}
        >
          <div className="flex items-start gap-3">
            <Logo size={52} />
            <div>
              <p className="font-bold text-lg leading-tight">{form.seller_name}</p>
              {form.seller_address && (
                <p className="text-[11px] text-neutral-600 whitespace-pre-line">
                  {form.seller_address}
                </p>
              )}
              {(form.seller_city || sellerEmirate) && (
                <p className="text-[11px] text-neutral-600">
                  {[form.seller_city, sellerEmirate].filter(Boolean).join(", ")}
                </p>
              )}
              <p className="text-[11px] text-neutral-600">United Arab Emirates</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold tracking-wide" style={{ color: a }}>
              TAX INVOICE
            </p>
            <p className="text-[11px] text-neutral-500 mt-1">{invType}</p>
            <p className="text-sm font-semibold mt-2">{form.number}</p>
          </div>
        </div>

        {/* Seller / Buyer identity */}
        <div className="grid grid-cols-2 gap-6 mt-5 text-[11px]">
          <div className="rounded-lg p-3" style={{ background: "#f6f7f9" }}>
            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-neutral-400 mb-1.5">
              Seller
            </p>
            <p className="font-semibold text-[12px]">{form.seller_name}</p>
            {form.seller_trn && <p className="text-neutral-600">TRN: {form.seller_trn}</p>}
            {sellerTin && <p className="text-neutral-500">TIN: {sellerTin}</p>}
            {form.seller_legal_id && (
              <p className="text-neutral-500">
                {sellerLegalType || "Reg. No"}: {form.seller_legal_id}
              </p>
            )}
            <SellerContact cls="text-neutral-500" />
          </div>
          <div className="rounded-lg p-3" style={{ background: "#f6f7f9" }}>
            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-neutral-400 mb-1.5">
              {partyLabel}
            </p>
            <p className="font-semibold text-[12px]">{form.customer_name}</p>
            {form.customer_address && (
              <p className="text-neutral-600 whitespace-pre-line">
                {form.customer_address}
              </p>
            )}
            {(form.buyer_city || buyerEmirate || form.buyer_country_code) && (
              <p className="text-neutral-500">
                {[form.buyer_city, buyerEmirate, form.buyer_country_code]
                  .filter(Boolean)
                  .join(", ")}
              </p>
            )}
            {form.customer_trn && <p className="text-neutral-600">TRN: {form.customer_trn}</p>}
            {buyerTin && <p className="text-neutral-500">TIN: {buyerTin}</p>}
          </div>
        </div>

        {/* Invoice meta */}
        <div className="grid grid-cols-4 gap-2 mt-4 text-[11px]">
          {(
            [
              ["Invoice Date", fmtDate(form.issue_date)],
              [dueLabel, fmtDate(form.due_date)],
              ["Currency", form.currency || "AED"],
              ["Payment", payMeans || "—"],
            ] as [string, string][]
          ).map(([k, v]) => (
            <div
              key={k}
              className="rounded border px-2.5 py-1.5"
              style={{ borderColor: "#e5e7eb" }}
            >
              <p className="text-[8.5px] uppercase tracking-wider text-neutral-400">{k}</p>
              <p className="font-medium">{v}</p>
            </div>
          ))}
        </div>
        {form.po_number && (
          <p className="text-[10px] text-neutral-500 mt-1.5">
            PO Reference: {form.po_number}
          </p>
        )}
        {activeTx.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {activeTx.map((f) => (
              <span
                key={f.key}
                className="text-[9px] px-2 py-0.5 rounded-full"
                style={{ background: a, color: "#fff" }}
              >
                {f.label}
              </span>
            ))}
          </div>
        )}

        {/* Items */}
        <table className="w-full text-[12px] border-collapse mt-4">
          <thead>
            <tr style={{ background: a, color: "#fff" }}>
              <th className="text-right py-2 px-2 font-semibold w-8">#</th>
              <th className="text-left py-2 px-2 font-semibold">Description</th>
              <th className="text-right py-2 px-2 font-semibold w-12">Qty</th>
              <th className="text-right py-2 px-2 font-semibold w-12">Unit</th>
              <th className="text-right py-2 px-2 font-semibold w-24">Unit Price</th>
              <th className="text-center py-2 px-2 font-semibold w-12">Tax</th>
              <th className="text-right py-2 px-2 font-semibold w-28">Amount</th>
            </tr>
          </thead>
          <tbody>
            {itemsToRender.map((it, i) => (
              <tr key={i} className="border-b border-neutral-200">
                <td className="py-1.5 px-2 text-right text-neutral-500 tabular-nums">
                  {itemStartIndex + i + 1}
                </td>
                <td className="py-1.5 px-2">{it.description || "—"}</td>
                <td className="py-1.5 px-2 text-right">{it.qty}</td>
                <td className="py-1.5 px-2 text-right text-neutral-500">{it.unit || "—"}</td>
                <td className="py-1.5 px-2 text-right">{m(it.unit_price)}</td>
                <td className="py-1.5 px-2 text-center text-neutral-500">
                  {it.tax_category || "S"}
                </td>
                <td className="py-1.5 px-2 text-right">
                  {m(docLineAmount(it, form.unit_price_formula))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {showTotals && (
          <div className="flex justify-between gap-6 mt-6">
            <div className="text-[11px]">
              <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-neutral-400 mb-1.5">
                VAT Breakdown
              </p>
              <table className="border-collapse">
                <thead>
                  <tr className="text-neutral-400">
                    <th className="text-left pr-4 font-medium">Category</th>
                    <th className="text-right pr-4 font-medium">Taxable</th>
                    <th className="text-right pr-4 font-medium">Rate</th>
                    <th className="text-right font-medium">VAT</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.map((b) => (
                    <tr key={b.cat}>
                      <td className="pr-4">
                        {b.cat} · {codeLabel(TAX_CATEGORY_CODES, b.cat)}
                      </td>
                      <td className="text-right pr-4 tabular-nums">{m(b.taxable)}</td>
                      <td className="text-right pr-4 tabular-nums">{b.rate}%</td>
                      <td className="text-right tabular-nums">{m(b.tax)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="w-64 text-sm">
              <div className="flex justify-between py-1">
                <span className="text-neutral-500">Subtotal</span>
                <span>{m(grossNet)}</span>
              </div>
              {discount > 0 && (
                <div className="flex justify-between py-1">
                  <span className="text-neutral-500">Discount</span>
                  <span>- {m(discount)}</span>
                </div>
              )}
              <div className="flex justify-between py-1">
                <span className="text-neutral-500">VAT</span>
                <span>{m(vat)}</span>
              </div>
              <div
                className="flex justify-between py-2 mt-1 font-bold text-base border-t-2"
                style={{ borderColor: a, color: a }}
              >
                <span>Total ({form.currency || "AED"})</span>
                <span>{m(grandTotal)}</span>
              </div>
              {(Number(form.advance_applied) || 0) > 0 && (
                <>
                  <div className="flex justify-between py-1">
                    <span className="text-neutral-500">Advance applied</span>
                    <span>- {m(Number(form.advance_applied))}</span>
                  </div>
                  <div
                    className="flex justify-between py-1.5 font-semibold border-t"
                    style={{ borderColor: a }}
                  >
                    <span>Balance due</span>
                    <span>{m(Math.max(0, grandTotal - (Number(form.advance_applied) || 0)))}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        <Footer />
      </div>
    );
  }

  // ---- INDUSTRIAL ----
  if (templateId === "industrial") {
    return (
      <div
        className="text-neutral-900"
        style={{ fontFamily: "'IBM Plex Mono', 'Plus Jakarta Sans', monospace" }}
      >
        <div
          className="-mx-12 -mt-12 mb-8 flex items-center"
          style={{ background: "#2C3E50", height: 48 }}
        >
          <div className="flex gap-2 px-4">
            <div className="rounded-full" style={{ width: 10, height: 10, background: "#E74C3C" }} />
            <div className="rounded-full" style={{ width: 10, height: 10, background: "#F39C12" }} />
            <div className="rounded-full" style={{ width: 10, height: 10, background: "#2ECC71" }} />
          </div>
          <p className="text-white font-bold tracking-[0.3em] text-sm uppercase mx-auto">{docTitle}</p>
        </div>
        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2">
            <div className="flex items-start gap-3">
              <Logo size={48} />
              <div>
                <p className="font-extrabold text-lg tracking-tight" style={{ color: "#2C3E50" }}>{form.seller_name}</p>
                <p className="text-[10px] text-neutral-500 whitespace-pre-line uppercase tracking-wide">{form.seller_address}</p>
                {form.seller_trn && <p className="text-[9px] text-neutral-400 mt-0.5">TRN: {form.seller_trn}</p>}
              </div>
            </div>
            <div
              className="mt-6 p-4 rounded"
              style={{ background: "#ECF0F1", borderLeft: "4px solid #E74C3C" }}
            >
              <p className="text-[9px] uppercase tracking-[0.3em] font-bold text-neutral-500 mb-1">{partyLabel}</p>
              <p className="font-bold">{form.customer_name}</p>
              <p className="text-xs text-neutral-600 whitespace-pre-line">{form.customer_address}</p>
              {form.customer_trn && <p className="text-[10px] text-neutral-400">TRN: {form.customer_trn}</p>}
            </div>
          </div>
          <div className="text-right">
            <div className="p-4 rounded" style={{ background: "#2C3E50", color: "#fff" }}>
              <p className="text-xs uppercase tracking-widest opacity-70">Document</p>
              <p className="text-2xl font-black tracking-tighter mt-1">{docTitle}</p>
              <div className="mt-3 pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.2)" }}>
                <p className="text-xs font-medium">{form.number}</p>
                <p className="text-[10px] opacity-70 mt-1">{fmtDate(form.issue_date)}</p>
                <p className="text-[10px] opacity-70">{dueLabel}: {fmtDate(form.due_date)}</p>
              </div>
            </div>
          </div>
        </div>
        <Items headerBg="#2C3E50" bordered />
        <Totals />
        <Footer />
        <div className="mt-8 pt-4 text-center" style={{ borderTop: "2px solid #2C3E50" }}>
          <p className="text-[9px] text-neutral-400 uppercase tracking-[0.3em]">{form.terms || "Thank you for your business"}</p>
        </div>
      </div>
    );
  }

  // ---- EXECUTIVE ----
  if (templateId === "executive") {
    return (
      <div
        className="text-neutral-900"
        style={{ fontFamily: "'Lora', 'Plus Jakarta Sans', Georgia, serif" }}
      >
        <div
          className="-mx-12 -mt-12 mb-10 px-12 py-10"
          style={{
            background: "linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 50%, #16213e 100%)",
            color: "#fff",
          }}
        >
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-4">
              <Logo size={72} />
              <div>
                <p
                  className="text-xl font-bold tracking-tight"
                  style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                >
                  {form.seller_name}
                </p>
                <p className="text-xs opacity-60 whitespace-pre-line mt-1 leading-relaxed">{form.seller_address}</p>
              </div>
            </div>
            <div className="text-right">
              <p
                className="text-sm uppercase tracking-[0.5em] opacity-50"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              >
                {docTitle}
              </p>
              <p className="text-4xl font-light mt-1 tracking-tight" style={{ color: "#C9A84C" }}>{form.number}</p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-10">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div style={{ width: 24, height: 1, background: "#C9A84C" }} />
              <p className="text-[10px] uppercase tracking-[0.3em] text-neutral-400 font-semibold">{partyLabel}</p>
            </div>
            <p className="font-bold text-base" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{form.customer_name}</p>
            <p className="text-xs text-neutral-600 whitespace-pre-line mt-1 leading-relaxed">{form.customer_address}</p>
            {form.customer_trn && <p className="text-[10px] text-neutral-400 mt-1">TRN: {form.customer_trn}</p>}
          </div>
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div style={{ width: 24, height: 1, background: "#C9A84C" }} />
              <p className="text-[10px] uppercase tracking-[0.3em] text-neutral-400 font-semibold">Details</p>
            </div>
            <div className="space-y-3 text-sm" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              <div className="flex justify-between">
                <span className="text-neutral-400">{issuedLabel}</span>
                <span className="font-medium">{fmtDate(form.issue_date)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-400">{dueLabel}</span>
                <span className="font-medium">{fmtDate(form.due_date)}</span>
              </div>
              {form.po_number && (
                <div className="flex justify-between">
                  <span className="text-neutral-400">PO #</span>
                  <span className="font-medium text-xs">{form.po_number}</span>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="mt-8 pt-6" style={{ borderTop: "1px solid #e5e5e5" }}>
          <Items headerBg="#0a0a0a" />
        </div>
        <Totals />
        <Footer />
        <div className="mt-10 pt-6 text-center" style={{ borderTop: "2px solid #C9A84C" }}>
          <p
            className="text-[10px] text-neutral-400 tracking-widest uppercase"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            {form.terms || "Net 30"}
          </p>
        </div>
      </div>
    );
  }

  // ---- FRESH ----
  if (templateId === "fresh") {
    return (
      <div className="text-neutral-900" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
        <div
          className="-mx-12 -mt-12 mb-0"
          style={{
            background: "linear-gradient(90deg, #667EEA 0%, #764BA2 50%, #F093FB 100%)",
            height: 5,
          }}
        />
        <div className="flex justify-between items-start mt-8">
          <div>
            <Logo size={52} />
            <p className="font-extrabold text-xl mt-3" style={{ color: "#4C51BF" }}>
              {form.seller_name}
              <span className="text-neutral-400 font-normal text-sm ml-2">{docTitle}</span>
            </p>
            <SellerContact cls="text-neutral-400 text-[11px]" />
          </div>
          <div className="text-right">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full" style={{ background: "#EBF4FF" }}>
              <div className="w-2 h-2 rounded-full" style={{ background: "#667EEA" }} />
              <span className="text-xs font-bold tracking-wider" style={{ color: "#4C51BF" }}>#{form.number}</span>
            </div>
            <div className="mt-3 text-xs text-neutral-500">
              <p>{issuedLabel}: {fmtDate(form.issue_date)}</p>
              <p>{dueLabel}: {fmtDate(form.due_date)}</p>
            </div>
          </div>
        </div>
        <div
          className="grid grid-cols-5 gap-0 mt-8 rounded-2xl overflow-hidden"
          style={{ border: "1px solid #E8E8F0" }}
        >
          <div className="col-span-3 p-5" style={{ background: "#FAFBFF" }}>
            <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-neutral-400 mb-2">{partyLabel}</p>
            <p className="font-bold text-base">{form.customer_name}</p>
            <p className="text-xs text-neutral-600 whitespace-pre-line mt-1">{form.customer_address}</p>
            {form.customer_trn && <p className="text-[10px] text-neutral-400 mt-1">TRN: {form.customer_trn}</p>}
          </div>
          <div className="col-span-2 p-5" style={{ background: "#4C51BF", color: "#fff" }}>
            <p className="text-[10px] uppercase tracking-wider opacity-60">{totalLabel}</p>
            <p className="text-3xl font-black mt-2 tracking-tight">{m(t.total)}</p>
            <div className="mt-3 pt-3 space-y-1 text-xs" style={{ borderTop: "1px solid rgba(255,255,255,0.2)" }}>
              <div className="flex justify-between">
                <span className="opacity-60">Subtotal</span>
                <span>{m(t.subtotal)}</span>
              </div>
              {(form.tax_rate || 0) > 0 && (
                <div className="flex justify-between">
                  <span className="opacity-60">VAT ({form.tax_rate}%)</span>
                  <span>{m(t.tax)}</span>
                </div>
              )}
            </div>
          </div>
        </div>
        <Items headerBg="#F7F8FC" />
        <Totals />
        <Footer />
        <div className="mt-8 text-center">
          <p className="text-[11px] text-neutral-400">
            Questions? Contact{" "}
            <span className="font-medium text-neutral-600">{form.seller_email || form.seller_name}</span>
          </p>
        </div>
      </div>
    );
  }

  // ---- MODERN (default) ----
  return (
    <div className="text-neutral-900">
      <div className="flex justify-between items-end">
        <div>
          <p className="text-5xl font-extrabold tracking-tight" style={{ color: a }}>{docTitle}</p>
          <p className="text-sm font-medium text-neutral-500 mt-2">{form.number}</p>
        </div>
        <div className="text-right">
          <Logo />
          <p className="font-bold mt-2">{form.seller_name}</p>
        </div>
      </div>
      <div className="h-1 w-full my-6" style={{ background: a }} />
      <div className="grid grid-cols-2 gap-8 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wider text-neutral-400">From</p>
          <p className="font-semibold mt-1">{form.seller_name}</p>
          <p className="text-xs text-neutral-500 whitespace-pre-line">{form.seller_address}</p>
          {form.seller_trn && <p className="text-xs text-neutral-500">TRN: {form.seller_trn}</p>}
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-neutral-400">{partyLabel}</p>
          <p className="font-semibold mt-1">{form.customer_name}</p>
          <p className="text-xs text-neutral-500 whitespace-pre-line">{form.customer_address}</p>
          <p className="text-xs text-neutral-500 mt-2">
            {issuedLabel} {fmtDate(form.issue_date)} · {dueLabel} {fmtDate(form.due_date)}
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
