/**
 * UAE reference-pack document templates (17 ids, "uae-*") — ported from the
 * standalone "Invoice Templates.html" pack (clean A4 layout: dochead with
 * seller block + accent title + Arabic subtitle + meta table, .box panels,
 * dark-accent items table, right-aligned 320px totals, dashed amount-in-words
 * box, two signature boxes, small legal note). One parameterized renderer
 * driven by the UAE_PACK config table below. Registered in DocTemplates.ts
 * and delegated to from DocView.tsx (templateId.startsWith("uae-")).
 *
 * White print surface — not the app's dark theme. Accent comes from
 * form.accent (the pack's --acc), defaulting to the pack's #1b3a5b.
 */
import { fmtDate, money } from "../lib/format";
import { amountInWords } from "../lib/words";
import { docTotals, docLineAmount } from "../lib/docItems";
import { ENFORCE_LICENSING, currentTier } from "../lib/license";
import { applyRoundOff } from "../lib/money";
import {
  EMIRATES,
  TAX_CATEGORY_CODES,
  normalizeEmirate,
  tinFromTrn,
  type Code,
} from "../lib/einvoice";
import type { DocViewForm, DocViewItem, DocViewLabels } from "./DocView";

/** Map a code to its human label (falls back to the raw code) — DocView pattern. */
const codeLabel = (list: Code[], code?: string | null): string =>
  !code ? "" : list.find((c) => c.code === code)?.label || code;

/** DocViewForm plus the e-invoice extras the Invoicing form carries at runtime.
 *  All optional, so a plain DocViewForm stays assignable. */
export interface UaePackForm extends DocViewForm {
  original_invoice_number?: string | null;
  original_invoice_date?: string | null;
  /** FX rate frozen at save: AED per 1 unit of `currency` (e-invoice field). */
  aed_exchange_rate?: number | null;
}

type UaePackTable = "invoice" | "credit" | "voucher";
type UaePackBox2 = "payment" | "originalRef" | "reason" | "plan" | "none";

/** Items-table column layouts. Where the data model lacks a pack field (work
 *  section, room nights, previously certified…), that info folds into the
 *  description column and the standard taxable/VAT columns are kept. */
type UaePackColumns =
  | "default" // # | Description | Qty | Unit | Unit Price | Taxable | VAT % | VAT | Total
  | "works" // construction: Work Section | Qty | Rate | Taxable | VAT % | VAT | Total
  | "folio" // hotel: Description | Taxable | VAT % | VAT | Total
  | "inclusive" // salon: Service | Qty | Price incl. VAT (VAT-inclusive display)
  | "timesheet" // Resource / Description | Hours | Rate/hr | Taxable | VAT @ x% | Total
  | "margin" // margin scheme: Description | Total (no VAT columns)
  | "commercial"; // non-VAT issuer: Description | Qty | Unit Price | Amount

type ColKey =
  | "idx"
  | "desc"
  | "qty"
  | "unit"
  | "price"
  | "priceIncl"
  | "taxable"
  | "vatpct"
  | "vat"
  | "total";

const COLUMN_SETS: Record<UaePackColumns, ColKey[]> = {
  default: ["idx", "desc", "qty", "unit", "price", "taxable", "vatpct", "vat", "total"],
  works: ["idx", "desc", "qty", "price", "taxable", "vatpct", "vat", "total"],
  folio: ["idx", "desc", "taxable", "vatpct", "vat", "total"],
  inclusive: ["idx", "desc", "qty", "priceIncl"],
  timesheet: ["idx", "desc", "qty", "price", "taxable", "vat", "total"],
  margin: ["idx", "desc", "total"],
  commercial: ["idx", "desc", "qty", "price", "taxable"],
};

const colAlign = (k: ColKey): string =>
  k === "desc" ? "text-left" : k === "vatpct" ? "text-center" : "text-right";

interface UaePackConfig {
  titleEn: string;
  titleAr: string;
  table: UaePackTable;
  box2: UaePackBox2;
  note: string;
  numberLabel: string;
  dateLabel: string;
  /** Due/validity meta-row label (row renders only when a date is set). */
  dueLabel?: string;
  /** Grand-total row label (defaults to "Total Payable"). */
  totalLabel?: string;
  /** credit = reduction rows; debit = normal totals with a Debit grand row. */
  creditMode?: "credit" | "debit";
  voucherMode?: "receipt" | "payment";
  /** Voucher definition-row variant (petty cash rows instead of receipt rows). */
  voucherRows?: "petty";
  /** Items-table column variant (default = FTA 9-column grid). */
  columns?: UaePackColumns;
  /** Render the AED-conversion box for foreign-currency documents. */
  fxBox?: boolean;
  sig?: [string, string];
}

const UAE_PACK: Record<string, UaePackConfig> = {
  "uae-full": {
    titleEn: "TAX INVOICE",
    titleAr: "فاتورة ضريبية",
    table: "invoice",
    box2: "payment",
    note: "Full Tax Invoice per Art. 59, Cabinet Decision 52/2017 (as amended).",
    numberLabel: "Invoice No.",
    dateLabel: "Date of Issue",
    dueLabel: "Payment Due",
  },
  "uae-simplified": {
    titleEn: "TAX INVOICE",
    titleAr: "فاتورة ضريبية مبسطة",
    table: "invoice",
    box2: "none",
    note: "Simplified Tax Invoice per Art. 59(2): permitted where the recipient is not VAT-registered or consideration ≤ AED 10,000.",
    numberLabel: "Invoice No.",
    dateLabel: "Date of Issue",
  },
  "uae-reverse": {
    titleEn: "TAX INVOICE",
    titleAr: "فاتورة ضريبية — احتساب عكسي",
    table: "invoice",
    box2: "reason",
    note: "Reverse charge: the recipient is liable to account for the tax (Art. 48), plus the standard Art. 59 fields.",
    numberLabel: "Invoice No.",
    dateLabel: "Date of Issue",
    dueLabel: "Payment Due",
  },
  "uae-foreign": {
    titleEn: "TAX INVOICE",
    titleAr: "فاتورة ضريبية — عملة أجنبية",
    table: "invoice",
    box2: "none",
    fxBox: true,
    note: "When issued in a currency other than AED, the tax amount must also be stated in AED (Central Bank exchange rate at the date of supply).",
    numberLabel: "Invoice No.",
    dateLabel: "Date of Issue",
    dueLabel: "Payment Due",
  },
  "uae-export": {
    titleEn: "TAX INVOICE",
    titleAr: "فاتورة ضريبية — صادرات",
    table: "invoice",
    box2: "none",
    note: "Zero-rated export (0% VAT): requires exit of goods within 90 days and retention of customs/commercial export evidence.",
    numberLabel: "Invoice No.",
    dateLabel: "Date of Issue",
    dueLabel: "Payment Due",
  },
  "uae-mixed": {
    titleEn: "TAX INVOICE",
    titleAr: "فاتورة ضريبية — توريدات مختلطة",
    table: "invoice",
    box2: "none",
    note: "Mixed supply: per-rate tax breakdown mirrors the PINT-AE tax subtotals in the e-invoice XML.",
    numberLabel: "Invoice No.",
    dateLabel: "Date of Issue",
    dueLabel: "Payment Due",
  },
  "uae-recurring": {
    titleEn: "TAX INVOICE",
    titleAr: "فاتورة ضريبية دورية",
    table: "invoice",
    box2: "plan",
    note: "Continuous supply: date of supply follows Art. 26 (earlier of invoice or payment date, at least once per 12 months).",
    numberLabel: "Invoice No.",
    dateLabel: "Date of Issue",
    dueLabel: "Payment Due",
  },
  "uae-freelancer": {
    titleEn: "TAX INVOICE",
    titleAr: "فاتورة ضريبية — خدمات مهنية",
    table: "invoice",
    box2: "payment",
    note: "VAT registration is mandatory above AED 375,000/year of taxable supplies (voluntary from AED 187,500).",
    numberLabel: "Invoice No.",
    dateLabel: "Date of Issue",
    dueLabel: "Payment Due",
  },
  "uae-credit-note": {
    titleEn: "TAX CREDIT NOTE",
    titleAr: "إشعار دائن ضريبي",
    table: "credit",
    creditMode: "credit",
    box2: "originalRef",
    note: "Tax Credit Note per Art. 70, Federal Decree-Law No. 8 of 2017 and Art. 60 Exec. Reg.: references the original tax invoice with the value of the reduction and its VAT.",
    numberLabel: "Credit Note No.",
    dateLabel: "Date of Issue",
    totalLabel: "Total Credit",
  },
  "uae-debit-note": {
    titleEn: "TAX DEBIT NOTE",
    titleAr: "إشعار مدين ضريبي",
    table: "credit",
    creditMode: "debit",
    box2: "originalRef",
    note: "Tax Debit Note: documents an increase in consideration after the original tax invoice, with the additional taxable amount and VAT.",
    numberLabel: "Debit Note No.",
    dateLabel: "Date of Issue",
    totalLabel: "Total Debit",
  },
  "uae-quotation": {
    titleEn: "QUOTATION",
    titleAr: "عرض سعر",
    table: "invoice",
    box2: "none",
    note: "Quotation: creates no VAT liability; VAT is shown for transparency of the final payable amount.",
    numberLabel: "Quotation No.",
    dateLabel: "Date",
    dueLabel: "Valid Until",
    totalLabel: "Quoted Total",
  },
  "uae-proforma": {
    titleEn: "PROFORMA INVOICE",
    titleAr: "فاتورة مبدئية",
    table: "invoice",
    box2: "payment",
    note: "A proforma is not a tax invoice and cannot be used for input VAT recovery.",
    numberLabel: "Proforma No.",
    dateLabel: "Date",
    dueLabel: "Valid Until",
    totalLabel: "Estimated Total",
  },
  "uae-estimate": {
    titleEn: "ESTIMATE",
    titleAr: "تقدير تكلفة",
    table: "invoice",
    box2: "none",
    note: "Estimate: convert to a Full or Simplified Tax Invoice upon completion of the work.",
    numberLabel: "Estimate No.",
    dateLabel: "Date",
    dueLabel: "Valid Until",
    totalLabel: "Estimated Total",
  },
  "uae-purchase-order": {
    titleEn: "PURCHASE ORDER",
    titleAr: "أمر شراء",
    table: "invoice",
    box2: "none",
    note: "The supplier's tax invoice referencing this PO will arrive via your ASP as structured XML — the PO number aids automated 3-way matching.",
    numberLabel: "PO No.",
    dateLabel: "Date",
    dueLabel: "Delivery By",
    totalLabel: "PO Total",
  },
  "uae-order-confirmation": {
    titleEn: "SALES ORDER CONFIRMATION",
    titleAr: "تأكيد طلب بيع",
    table: "invoice",
    box2: "none",
    note: "Pre-supply document — no VAT due until the date of supply (Art. 25).",
    numberLabel: "SO No.",
    dateLabel: "Date",
    dueLabel: "Est. Delivery",
    totalLabel: "Order Total",
  },
  "uae-receipt-voucher": {
    titleEn: "RECEIPT VOUCHER",
    titleAr: "سند قبض",
    table: "voucher",
    voucherMode: "receipt",
    box2: "none",
    note: "Keep voucher sequence unbroken; attach cheque copy / transfer advice. Retain 5 years per Tax Procedures Law.",
    numberLabel: "Voucher No.",
    dateLabel: "Date",
    sig: ["Received By (Cashier / Accountant)", "Payer's Signature"],
  },
  "uae-payment-voucher": {
    titleEn: "PAYMENT VOUCHER",
    titleAr: "سند صرف",
    table: "voucher",
    voucherMode: "payment",
    box2: "none",
    note: "Attach the supplier's tax invoice — input VAT recovery requires a valid tax invoice, not this voucher.",
    numberLabel: "Voucher No.",
    dateLabel: "Date",
    sig: ["Prepared By", "Received By (Payee Signature)"],
  },
  // ---- Wave 2: industry & special-case documents (A9–A28, D3–D4) ----
  "uae-construction": {
    titleEn: "TAX INVOICE",
    titleAr: "فاتورة ضريبية — مستخلص أعمال",
    table: "invoice",
    box2: "none",
    columns: "works",
    note: "VAT on retention becomes due when the retention is invoiced/certified (date of supply, Art. 25–26).",
    numberLabel: "Invoice No.",
    dateLabel: "Date of Issue",
    dueLabel: "Payment Due",
  },
  "uae-rental": {
    titleEn: "TAX INVOICE",
    titleAr: "فاتورة ضريبية — إيجار",
    table: "invoice",
    box2: "none",
    note: "Commercial rent is standard-rated (5%); residential rent is exempt. Continuous supply — date of supply per Art. 26.",
    numberLabel: "Invoice No.",
    dateLabel: "Date of Issue",
    dueLabel: "Payment Due",
  },
  "uae-restaurant": {
    titleEn: "TAX INVOICE",
    titleAr: "فاتورة ضريبية — مطعم",
    table: "invoice",
    box2: "none",
    note: "Where consideration ≤ AED 10,000 this may be issued as a simplified tax invoice.",
    numberLabel: "Invoice No.",
    dateLabel: "Date of Issue",
    dueLabel: "Payment Due",
  },
  "uae-medical": {
    titleEn: "TAX INVOICE",
    titleAr: "فاتورة ضريبية — خدمات طبية",
    table: "invoice",
    box2: "none",
    note: "Zero-rated ≠ exempt: the clinic still issues tax invoices and recovers input VAT.",
    numberLabel: "Invoice No.",
    dateLabel: "Date of Issue",
    dueLabel: "Payment Due",
  },
  "uae-education": {
    titleEn: "TAX INVOICE",
    titleAr: "فاتورة ضريبية — رسوم دراسية",
    table: "invoice",
    box2: "none",
    note: "Tuition of qualifying institutions is zero-rated (Art. 45(13)); extras are standard-rated.",
    numberLabel: "Invoice No.",
    dateLabel: "Date of Issue",
    dueLabel: "Payment Due",
  },
  "uae-logistics": {
    titleEn: "TAX INVOICE",
    titleAr: "فاتورة ضريبية — شحن ولوجستيات",
    table: "invoice",
    box2: "none",
    note: "Export flag (position 8) applies in the e-invoice transaction type code where relevant.",
    numberLabel: "Invoice No.",
    dateLabel: "Date of Issue",
    dueLabel: "Payment Due",
  },
  "uae-ecommerce": {
    titleEn: "TAX INVOICE",
    titleAr: "فاتورة ضريبية — تجارة إلكترونية",
    table: "invoice",
    box2: "none",
    note: "E-commerce supplies set flag position 7 of the invoice transaction type code.",
    numberLabel: "Invoice No.",
    dateLabel: "Date of Issue",
    dueLabel: "Payment Due",
  },
  "uae-hotel": {
    titleEn: "TAX INVOICE",
    titleAr: "فاتورة ضريبية — فندق",
    table: "invoice",
    box2: "none",
    columns: "folio",
    note: "Accommodation and F&B are standard-rated; Tourism Dirham is a government levy outside the scope of VAT.",
    numberLabel: "Folio No.",
    dateLabel: "Date",
  },
  "uae-salon": {
    titleEn: "TAX INVOICE",
    titleAr: "فاتورة ضريبية — صالون",
    table: "invoice",
    box2: "none",
    columns: "inclusive",
    note: "Personal care services are standard-rated; VAT-inclusive display is typical for B2C pricing.",
    numberLabel: "Invoice No.",
    dateLabel: "Date",
  },
  "uae-garage": {
    titleEn: "TAX INVOICE",
    titleAr: "فاتورة ضريبية — صيانة مركبات",
    table: "invoice",
    box2: "none",
    note: "Warranty repairs at no consideration may constitute deemed supplies.",
    numberLabel: "Invoice No.",
    dateLabel: "Date of Issue",
    dueLabel: "Payment Due",
  },
  "uae-realestate": {
    titleEn: "TAX INVOICE",
    titleAr: "فاتورة ضريبية — عمولة وساطة عقارية",
    table: "invoice",
    box2: "none",
    note: "Brokerage commission is standard-rated at 5% even where the underlying property supply is exempt or zero-rated.",
    numberLabel: "Invoice No.",
    dateLabel: "Date of Issue",
    dueLabel: "Payment Due",
  },
  "uae-amc": {
    titleEn: "TAX INVOICE",
    titleAr: "فاتورة ضريبية — عقد صيانة سنوي",
    table: "invoice",
    box2: "none",
    note: "Continuous supply — sets flag position 5 of the e-invoice transaction type code; date of supply per Art. 26.",
    numberLabel: "Invoice No.",
    dateLabel: "Date of Issue",
    dueLabel: "Payment Due",
  },
  "uae-event": {
    titleEn: "TAX INVOICE",
    titleAr: "فاتورة ضريبية — تنظيم فعاليات",
    table: "invoice",
    box2: "none",
    note: "VAT on advances is due on receipt (Art. 25–26).",
    numberLabel: "Invoice No.",
    dateLabel: "Date of Issue",
    dueLabel: "Payment Due",
  },
  "uae-timesheet": {
    titleEn: "TAX INVOICE",
    titleAr: "فاتورة ضريبية — خدمات تقنية",
    table: "invoice",
    box2: "none",
    columns: "timesheet",
    note: "Attach the client-approved timesheet as supporting evidence for the hours billed.",
    numberLabel: "Invoice No.",
    dateLabel: "Date of Issue",
    dueLabel: "Payment Due",
  },
  "uae-margin": {
    titleEn: "TAX INVOICE",
    titleAr: "فاتورة ضريبية — نظام هامش الربح",
    table: "invoice",
    box2: "none",
    columns: "margin",
    note: "Margin scheme (Art. 43): VAT is accounted for on the profit margin, not shown on the invoice. Sets flag position 3.",
    numberLabel: "Invoice No.",
    dateLabel: "Date of Issue",
  },
  "uae-summary": {
    titleEn: "SUMMARY TAX INVOICE",
    titleAr: "فاتورة ضريبية مجمعة",
    table: "invoice",
    box2: "none",
    note: "Summary invoice: multiple supplies to the same customer within a calendar month. Sets flag position 4.",
    numberLabel: "Invoice No.",
    dateLabel: "Date of Issue",
    dueLabel: "Payment Due",
  },
  "uae-agent": {
    titleEn: "TAX INVOICE",
    titleAr: "فاتورة ضريبية — وكيل معلن",
    table: "invoice",
    box2: "none",
    note: "Disclosed agent billing: both principal and agent TRNs shown. Sets flag position 6.",
    numberLabel: "Invoice No.",
    dateLabel: "Date of Issue",
    dueLabel: "Payment Due",
    sig: ["For the Agent", "Received By"],
  },
  "uae-designated": {
    titleEn: "INVOICE",
    titleAr: "فاتورة — منطقة محددة",
    table: "invoice",
    box2: "none",
    note: "Free Trade Zone supplies set flag position 1 of the e-invoice transaction type code; services in designated zones follow normal mainland rules.",
    numberLabel: "Invoice No.",
    dateLabel: "Date of Issue",
    dueLabel: "Payment Due",
  },
  "uae-deemed": {
    titleEn: "TAX INVOICE",
    titleAr: "فاتورة ضريبية — توريد اعتباري",
    table: "invoice",
    box2: "none",
    note: "Deemed supply (self-supplies, gifts, private use — Art. 11–12). Sets flag position 2.",
    numberLabel: "Invoice No.",
    dateLabel: "Date of Issue",
  },
  "uae-commercial": {
    titleEn: "INVOICE",
    titleAr: "فاتورة",
    table: "invoice",
    box2: "none",
    columns: "commercial",
    note: "Commercial e-invoice (non-VAT-registered issuer): 49 mandatory fields, TIN as participant identifier — see the MoF rules.",
    numberLabel: "Invoice No.",
    dateLabel: "Date of Issue",
    dueLabel: "Payment Due",
  },
  "uae-petty-cash": {
    titleEn: "PETTY CASH VOUCHER",
    titleAr: "سند مصروفات نثرية",
    table: "voucher",
    voucherMode: "payment",
    voucherRows: "petty",
    box2: "none",
    note: "Input VAT on petty cash is recoverable only against retained simplified tax invoices.",
    numberLabel: "Voucher No.",
    dateLabel: "Date",
    sig: ["Claimed By", "Approved By"],
  },
  "uae-advance-receipt": {
    titleEn: "ADVANCE PAYMENT RECEIPT",
    titleAr: "إيصال دفعة مقدمة",
    table: "voucher",
    voucherMode: "receipt",
    box2: "none",
    note: "Advances trigger VAT on receipt: issue a tax invoice for the advance within 14 days of the date of supply.",
    numberLabel: "Receipt No.",
    dateLabel: "Date Received",
    sig: ["Received By (Authorised Signatory)", "Payer's Signature"],
  },
};

export default function UaePackDoc({
  form,
  pageItems,
  itemStartIndex = 0,
  showTotals = true,
  showFooter = true,
  labels,
}: {
  form: UaePackForm;
  pageItems?: DocViewItem[];
  itemStartIndex?: number;
  showTotals?: boolean;
  showFooter?: boolean;
  labels?: DocViewLabels;
}) {
  const cfg = UAE_PACK[(form.template || "").toLowerCase()] ?? UAE_PACK["uae-full"];
  const acc = form.accent || "#1b3a5b"; // the pack's --acc
  const ccy = form.currency || "AED";
  const m = (v: number) => money(v, ccy);
  const itemsToRender = pageItems ?? form.items;
  const logoSrc = form.show_logo === false ? null : (form.logo ?? null);

  // Category-aware tax math, mirroring the DocView "fta" branch: VAT only on
  // standard-rated lines, document discount allocated pro-rata by line net.
  const t = applyRoundOff(
    docTotals(form.items, form.discount || 0, form.tax_rate || 0, form.unit_price_formula),
    !!form.round_off
  );
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
  // Margin/commercial variants never show or add VAT on the document.
  const noVat = cfg.columns === "margin" || cfg.columns === "commercial";
  const vatInTotal = noVat ? 0 : vat;
  const grandTotal = form.round_off
    ? Math.round(netAfterDisc + vatInTotal)
    : netAfterDisc + vatInTotal;
  const roundOffAmt = grandTotal - (netAfterDisc + vatInTotal);

  // Per-line VAT: rate applies to standard ('S'/unset) lines only.
  const lineRate = (it: DocViewItem) =>
    !it.tax_category || it.tax_category === "S" ? form.tax_rate || 0 : 0;

  const sellerEmirate = codeLabel(EMIRATES, normalizeEmirate(form.seller_country_subdivision));
  const buyerEmirate = codeLabel(EMIRATES, normalizeEmirate(form.buyer_country_subdivision));
  const sellerTin = tinFromTrn(form.seller_trn);
  const buyerTin = tinFromTrn(form.customer_trn);
  const fxRate = form.aed_exchange_rate ?? form.fx_rate ?? 0;
  const advance = Number(form.advance_applied) || 0;
  const partyLabel = labels?.partyLabel || (cfg.table === "credit" ? "Issued To" : "Bill To");
  const grandLabel = labels?.totalLabel || cfg.totalLabel || "Total Payable";
  // Free-tier branding line — volume+branding are the only free limits.
  const freeWatermark = ENFORCE_LICENSING && currentTier() === "free";

  // Notes consumed by a dedicated slot (reason/plan box, voucher "Being
  // payment of") are not repeated in the footer.
  const notesInSlot = cfg.box2 === "reason" || cfg.box2 === "plan" || cfg.table === "voucher";

  const meta: [string, React.ReactNode][] = [
    [cfg.numberLabel, form.number || "—"],
    [labels?.issuedLabel || cfg.dateLabel, fmtDate(form.issue_date)],
  ];
  if (form.date_of_supply) meta.push(["Date of Supply", fmtDate(form.date_of_supply)]);
  if (cfg.dueLabel && form.due_date)
    meta.push([labels?.dueLabel || cfg.dueLabel, fmtDate(form.due_date)]);
  if (form.po_number) meta.push(["PO Reference", form.po_number]);
  if (cfg.table === "voucher") meta.push([`Amount (${ccy})`, <b>{m(grandTotal)}</b>]);
  if (ccy !== "AED") meta.push(["Currency", ccy]);
  if (ccy !== "AED" && fxRate > 0)
    meta.push(["Exchange Rate", `1 ${ccy} = ${fxRate} AED`]);

  const BoxTitle = ({ children }: { children: React.ReactNode }) => (
    <p className="text-[10.5px] uppercase tracking-[0.7px] font-semibold text-[#5a7189] mb-1.5">
      {children}
    </p>
  );
  const boxCls = "border border-[#d6dee7] rounded px-3.5 py-2.5 text-[13px]";

  const billToBox = (
    <div className={boxCls}>
      <BoxTitle>{partyLabel}</BoxTitle>
      <p className="font-semibold">{form.customer_name}</p>
      {form.customer_address && (
        <p className="text-neutral-600 whitespace-pre-line">{form.customer_address}</p>
      )}
      {(form.buyer_city || buyerEmirate || form.buyer_country_code) && (
        <p className="text-neutral-500">
          {[form.buyer_city, buyerEmirate, form.buyer_country_code].filter(Boolean).join(", ")}
        </p>
      )}
      {form.customer_trn && <p className="text-neutral-600">TRN: {form.customer_trn}</p>}
      {buyerTin && <p className="text-neutral-500">TIN: {buyerTin}</p>}
    </div>
  );

  // Second box next to Bill To, driven by cfg.box2. "payment" would carry
  // bank details, but the form does not expose them (bank info is overlaid
  // outside DocView in Invoicing) — so it renders nothing.
  const box2 = (() => {
    if (cfg.box2 === "originalRef" && form.original_invoice_number) {
      return (
        <div className={boxCls}>
          <BoxTitle>Original Invoice</BoxTitle>
          <p className="font-semibold">{form.original_invoice_number}</p>
          {form.original_invoice_date && (
            <p className="text-neutral-500">Dated: {fmtDate(form.original_invoice_date)}</p>
          )}
        </div>
      );
    }
    if ((cfg.box2 === "reason" || cfg.box2 === "plan") && form.notes) {
      return (
        <div className={boxCls}>
          <BoxTitle>{cfg.box2 === "plan" ? "Plan" : "Reason"}</BoxTitle>
          <p className="whitespace-pre-line">{form.notes}</p>
        </div>
      );
    }
    if (cfg.fxBox && ccy !== "AED" && fxRate > 0) {
      return (
        <div className={boxCls}>
          <BoxTitle>VAT in AED</BoxTitle>
          <p>
            VAT stated in AED at the frozen rate 1 {ccy} = {fxRate} AED (Central Bank rate
            at date of supply).
          </p>
        </div>
      );
    }
    return null;
  })();

  const isCredit = cfg.table === "credit";
  const isDebit = isCredit && cfg.creditMode === "debit";
  const lastColLabel = isCredit ? `${isDebit ? "Debit" : "Credit"} (${ccy})` : `Total (${ccy})`;

  // Column-variant header labels (overrides per cfg.columns).
  const cols = COLUMN_SETS[cfg.columns || "default"];
  const colLabelOverrides: Partial<Record<ColKey, string>> = (() => {
    switch (cfg.columns) {
      case "works":
        return {
          desc: "Work Section",
          price: "Rate",
          taxable: "Taxable Amt",
          vat: `VAT (${ccy})`,
          total: `Total (${ccy})`,
        };
      case "folio":
        return { taxable: "Taxable Amt", vat: `VAT (${ccy})`, total: `Total (${ccy})` };
      case "inclusive":
        return { desc: "Service", priceIncl: `Price incl. VAT (${ccy})` };
      case "timesheet":
        return {
          desc: "Resource / Description",
          qty: "Hours",
          price: "Rate/hr",
          taxable: "Taxable Amt",
          vat: `VAT @ ${form.tax_rate || 0}%`,
          total: `Total (${ccy})`,
        };
      case "margin":
        return { total: `Total (${ccy})` };
      case "commercial":
        return { taxable: `Amount (${ccy})` };
      default:
        return {};
    }
  })();
  const colLabel = (k: ColKey): string =>
    colLabelOverrides[k] ??
    (
      {
        idx: "#",
        desc: "Description",
        qty: "Qty",
        unit: "Unit",
        price: "Unit Price",
        priceIncl: "Unit Price",
        taxable: "Taxable",
        vatpct: "VAT %",
        vat: "VAT",
        total: lastColLabel,
      } as Record<ColKey, string>
    )[k];
  const tdClass = (k: ColKey): string =>
    `border border-[#d6dee7] py-1.5 px-2 align-top ${colAlign(k)}${
      k === "idx" || k === "unit" || k === "vatpct" ? " text-neutral-500" : ""
    }${k === "desc" ? "" : " whitespace-nowrap tabular-nums"}`;
  const colValue = (
    k: ColKey,
    it: DocViewItem,
    i: number,
    taxable: number,
    rate: number,
    lineVat: number
  ): React.ReactNode => {
    switch (k) {
      case "idx":
        return itemStartIndex + i + 1;
      case "desc":
        return it.description || "—";
      case "qty":
        return it.qty;
      case "unit":
        return it.unit || "—";
      case "price":
        return m(it.unit_price);
      case "priceIncl":
        return m(it.unit_price * (1 + rate / 100));
      case "taxable":
        return m(taxable);
      case "vatpct":
        return `${rate}%`;
      case "vat":
        return m(lineVat);
      case "total":
        return m(noVat ? taxable : taxable + lineVat);
    }
  };

  const itemsTable = (
    <table className="w-full border-collapse text-[12.8px] mt-3 mb-2">
      <thead>
        <tr style={{ background: acc, color: "#fff" }}>
          {cols.map((k) => (
            <th
              key={k}
              className={`py-1.5 px-2 font-semibold text-[11.5px] whitespace-nowrap ${colAlign(k)}${
                k === "idx" ? " w-8" : ""
              }`}
            >
              {colLabel(k)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {itemsToRender.map((it, i) => {
          const taxable = docLineAmount(it, form.unit_price_formula);
          const rate = lineRate(it);
          const lineVat = (taxable * rate) / 100;
          return (
            <tr key={i}>
              {cols.map((k) => (
                <td key={k} className={tdClass(k)}>
                  {colValue(k, it, i, taxable, rate, lineVat)}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  const voucherRows: [string, string][] =
    cfg.voucherRows === "petty"
      ? [
          ["Paid to", form.customer_name || "—"],
          [
            "For (particulars)",
            form.notes ||
              itemsToRender
                .map((it) => it.description)
                .filter(Boolean)
                .join("; ") ||
              "—",
          ],
          ["Amount (in words)", amountInWords(grandTotal, ccy)],
        ]
      : [
          [
            cfg.voucherMode === "payment" ? "Paid to" : "Received with thanks from",
            form.customer_name || "—",
          ],
          ["The sum of (in words)", amountInWords(grandTotal, ccy)],
        ];
  const paidBy = [form.payment_method, form.ref_number ? `Ref: ${form.ref_number}` : ""]
    .filter(Boolean)
    .join(" · ");
  if (cfg.voucherRows !== "petty") {
    if (paidBy) voucherRows.push(["By", paidBy]);
    voucherRows.push([
      "Being payment of",
      form.notes ||
        (form.original_invoice_number
          ? `Tax Invoice ${form.original_invoice_number}${
              form.original_invoice_date ? ` dated ${fmtDate(form.original_invoice_date)}` : ""
            }`
          : "—"),
    ]);
  }

  const voucherTable = (
    <table className="w-full border-collapse text-[12.8px] mt-3 mb-2">
      <tbody>
        {voucherRows.map(([k, v]) => (
          <tr key={k}>
            <td className="border border-[#d6dee7] py-1.5 px-2 align-top font-semibold w-[32%]">
              {k}
            </td>
            <td className="border border-[#d6dee7] py-1.5 px-2 align-top">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const TotRow = ({ k, v }: { k: string; v: string }) => (
    <tr>
      <td className="py-[5px] px-2.5 border-b border-[#e3e9f0]">{k}</td>
      <td className="py-[5px] px-2.5 border-b border-[#e3e9f0] text-right whitespace-nowrap tabular-nums">
        {v}
      </td>
    </tr>
  );

  const totalsBlock = showTotals && cfg.table !== "voucher" && (
    <>
      <div className="flex justify-between gap-6 mt-6">
        {!noVat && (
          <div className="text-[11px]">
            <BoxTitle>VAT Breakdown</BoxTitle>
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
        )}
        <table className="border-collapse text-[13px] self-start ml-auto" style={{ width: 320 }}>
          <tbody>
            {isCredit && !isDebit ? (
              <>
                <TotRow k="Reduction in Taxable Amount" v={m(netAfterDisc)} />
                {breakdown.map((b) => (
                  <TotRow
                    key={b.cat}
                    k={`Reduction in VAT @ ${b.rate}%${
                      breakdown.length > 1 || b.cat !== "S" ? ` · ${b.cat}` : ""
                    }`}
                    v={m(b.tax)}
                  />
                ))}
              </>
            ) : cfg.columns === "margin" ? null : (
              <>
                <TotRow k={noVat ? "Subtotal" : "Subtotal (excl. VAT)"} v={m(grossNet)} />
                {discount > 0 && <TotRow k="Total Discount" v={`- ${m(discount)}`} />}
                {discount > 0 && <TotRow k="Total Taxable Amount" v={m(netAfterDisc)} />}
                {!noVat &&
                  breakdown.map((b) => (
                    <TotRow
                      key={b.cat}
                      k={`VAT @ ${b.rate}%${
                        breakdown.length > 1 || b.cat !== "S" ? ` · ${b.cat}` : ""
                      }`}
                      v={m(b.tax)}
                    />
                  ))}
              </>
            )}
            {Math.abs(roundOffAmt) >= 0.005 && (
              <TotRow
                k="Round off"
                v={`${roundOffAmt > 0 ? "+" : ""}${m(roundOffAmt)}`}
              />
            )}
            <tr style={{ background: acc, color: "#fff" }}>
              <td className="py-[5px] px-2.5 font-bold">
                {grandLabel} ({ccy})
              </td>
              <td className="py-[5px] px-2.5 font-bold text-right whitespace-nowrap tabular-nums">
                {m(grandTotal)}
              </td>
            </tr>
            {cfg.table === "invoice" && advance > 0 && (
              <>
                <TotRow k="Advance applied" v={`- ${m(advance)}`} />
                <TotRow k="Balance due" v={m(Math.max(0, grandTotal - advance))} />
              </>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[12.5px] italic my-2.5 border border-dashed border-[#c3cfdb] rounded py-1.5 px-3 text-[#334c63]">
        Amount in words: {amountInWords(grandTotal, ccy)}
      </p>
    </>
  );

  const sigLabels = cfg.sig || ["Authorised Signatory & Stamp", "Received By"];

  return (
    <div
      className="text-[#1c2733]"
      style={{ fontFamily: "'Segoe UI', Arial, sans-serif", background: "#fff" }}
    >
      {/* dochead: seller block left, title + Arabic subtitle + meta right */}
      <div
        className="flex justify-between gap-6 pb-3.5 mb-4 border-b-[3px]"
        style={{ borderColor: acc }}
      >
        <div className="flex gap-3.5 text-[13px]">
          {logoSrc && (
            <img src={logoSrc} alt="logo" className="object-contain" style={{ height: 70 }} />
          )}
          <div>
            <p className="font-bold">{form.seller_name}</p>
            {form.seller_address && (
              <p className="whitespace-pre-line">{form.seller_address}</p>
            )}
            {(form.seller_city || sellerEmirate) && (
              <p>
                {[form.seller_city, sellerEmirate].filter(Boolean).join(", ")}, United Arab
                Emirates
              </p>
            )}
            {form.seller_trn && <p>TRN: {form.seller_trn}</p>}
            {sellerTin && <p>TIN: {sellerTin}</p>}
            {form.seller_email && <p>{form.seller_email}</p>}
            {form.seller_phone && <p>{form.seller_phone}</p>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[23px] font-bold tracking-[0.5px]" style={{ color: acc }}>
            {cfg.titleEn}
          </p>
          <p className="text-[15px] text-[#5a7189] mb-2">{cfg.titleAr}</p>
          <table className="ml-auto border-collapse text-[12.5px]">
            <tbody>
              {meta.map(([k, v]) => (
                <tr key={k}>
                  <td className="py-0.5 pl-3.5 text-right text-[#5a7189]">{k}</td>
                  <td className="py-0.5 pl-3.5 text-right font-semibold">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* party boxes (vouchers carry the party in the definition table) */}
      {cfg.table !== "voucher" && (
        <div className={`grid ${box2 ? "grid-cols-2" : "grid-cols-1"} gap-3.5 my-3.5`}>
          {billToBox}
          {box2}
        </div>
      )}

      {cfg.table === "voucher" ? voucherTable : itemsTable}
      {totalsBlock}

      {showFooter && (
        <>
          <div className="grid grid-cols-2 gap-[60px] mt-11">
            {sigLabels.map((s) => (
              <div
                key={s}
                className="border-t border-[#8fa2b5] pt-1.5 text-xs text-center text-[#5a7189]"
              >
                {s}
              </div>
            ))}
          </div>
          <div className="mt-5 pt-2 border-t border-[#e3e9f0]">
            {!notesInSlot && form.notes && (
              <p className="text-xs text-neutral-500 mb-1">{form.notes}</p>
            )}
            {form.terms && <p className="text-xs text-neutral-400 mb-1">{form.terms}</p>}
            <p className="text-[10.8px] text-[#68798c]">{cfg.note}</p>
            {freeWatermark && (
              <p className="text-[9px] text-neutral-400 mt-1">Made with Filey — the free plan</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
