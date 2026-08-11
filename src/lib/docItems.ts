// Shared document item helpers used by Invoice, Quotation, Purchase Order and
// Receipt editors. Keeps pagination, custom columns and page-break logic in one
// place so every module behaves the same way.

import {
  invoiceTotals,
  invoiceLineAmount,
  r2,
  type CalcMode,
  type InvoiceLineItem,
} from "./money";

export interface DocItem extends InvoiceLineItem {
  product_id?: number;
  description: string;
  unit?: string;
  /** Per-line discount percentage (used by quotation-style docs). */
  discount?: number;
  /** Per-line tax percentage (used by quotation-style docs). */
  tax?: number;
  /** Start a new page in the generated PDF/preview at this item. */
  pageBreakBefore?: boolean;
}

export interface DocCustomColumn {
  key: string;
  label: string;
}

export const RESERVED_ITEM_COLUMNS = new Set([
  "description",
  "qty",
  "unit",
  "unit_price",
  "amount",
  "tax",
  "discount",
  "product_id",
  "id",
  "__calc_mode",
  "__manual_amount",
  "__formula_a",
  "__formula_b",
]);

export const DEFAULT_COLUMN_LABELS = new Set([
  "description",
  "qty",
  "unit",
  "unit price",
  "amount",
  "tax",
  "discount",
]);

export const sanitizeCustomColumns = (cols: DocCustomColumn[]): DocCustomColumn[] =>
  cols.filter(
    (c) =>
      !RESERVED_ITEM_COLUMNS.has(c.key) &&
      !DEFAULT_COLUMN_LABELS.has(c.label.toLowerCase().trim())
  );

// Per-item meta is persisted inside the item's `custom` jsonb so it survives a
// reload with no DB schema change. It is stripped from the in-memory custom map
// so it never renders as a column value.
export const PB_KEY = "__pagebreak";
export const CM_KEY = "__calc_mode";
export const MA_KEY = "__manual_amount";
export const FA_KEY = "__formula_a";
export const FB_KEY = "__formula_b";
// Per-line discount % / tax % (Vyapar parity) — persisted in the same custom
// jsonb as the other item meta, so no DB schema change is needed.
export const DISC_KEY = "__disc_pct";
export const TAXP_KEY = "__tax_pct";

const isCalcMode = (v: string): v is CalcMode =>
  v === "auto" || v === "manual" || v === "formula";

const num = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

export const splitItemMeta = (custom?: Record<string, string> | null) => {
  const c: Record<string, string> = { ...(custom || {}) };
  const pageBreakBefore = c[PB_KEY] === "1";
  delete c[PB_KEY];
  const calcMode = isCalcMode(c[CM_KEY] || "") ? (c[CM_KEY] as CalcMode) : undefined;
  delete c[CM_KEY];
  const amount = num(c[MA_KEY] || "");
  delete c[MA_KEY];
  const itemFormula = c[FA_KEY]
    ? { a: c[FA_KEY], b: c[FB_KEY] || undefined }
    : undefined;
  delete c[FA_KEY];
  delete c[FB_KEY];
  const discount = num(c[DISC_KEY] || "") || undefined;
  delete c[DISC_KEY];
  const tax = num(c[TAXP_KEY] || "") || undefined;
  delete c[TAXP_KEY];
  return { custom: c, pageBreakBefore, calcMode, amount, itemFormula, discount, tax };
};

export const mergeItemMeta = (
  it: {
    custom?: Record<string, string> | null;
    pageBreakBefore?: boolean;
    calcMode?: CalcMode;
    amount?: number;
    itemFormula?: { a: string; b?: string } | null;
    discount?: number;
    tax?: number;
  }
): Record<string, string> | undefined => {
  const c: Record<string, string> = { ...(it.custom || {}) };
  if (it.pageBreakBefore) c[PB_KEY] = "1";
  else delete c[PB_KEY];
  if ((it.discount || 0) > 0) c[DISC_KEY] = String(it.discount);
  else delete c[DISC_KEY];
  if ((it.tax || 0) > 0) c[TAXP_KEY] = String(it.tax);
  else delete c[TAXP_KEY];
  if (it.calcMode) c[CM_KEY] = it.calcMode;
  else delete c[CM_KEY];
  if (it.calcMode === "manual") c[MA_KEY] = String(it.amount || 0);
  else delete c[MA_KEY];
  if (it.calcMode === "formula" && it.itemFormula?.a) {
    c[FA_KEY] = it.itemFormula.a;
    if (it.itemFormula.b) c[FB_KEY] = it.itemFormula.b;
    else delete c[FB_KEY];
  } else {
    delete c[FA_KEY];
    delete c[FB_KEY];
  }
  return Object.keys(c).length ? c : undefined;
};

/** Backward-compatible wrappers (Quoting/PO still import these). */
export const splitPageBreak = (custom?: Record<string, string> | null) => {
  const { custom: c, pageBreakBefore } = splitItemMeta(custom);
  return { custom: c, pageBreakBefore };
};

export const mergePageBreak = (it: DocItem): Record<string, string> | undefined =>
  mergeItemMeta(it);

/** Split items into pages driven only by manual breaks. Default = one page. */
export const paginateItems = (items: DocItem[]): DocItem[][] => {
  const pages: DocItem[][] = [[]];
  items.forEach((it, i) => {
    const cur = pages[pages.length - 1];
    if (i > 0 && it.pageBreakBefore) {
      pages.push([it]);
    } else {
      cur.push(it);
    }
  });
  return pages;
};

/** Gross for a line before doc-level or line-level discount/tax. */
function docLineGross(
  item: DocItem,
  formula?: { a: string; b?: string } | null
): number {
  if (item.calcMode === "manual") return item.amount || 0;
  if (item.calcMode === "formula" && item.itemFormula?.a) {
    const rate = item.unit_price || 0;
    const multiplier =
      item.itemFormula.a === "qty"
        ? item.qty || 0
        : num(item.custom?.[item.itemFormula.a] || "");
    return r2(multiplier * rate);
  }
  if (formula?.a) {
    const rate = item.unit_price || 0;
    const multiplier =
      formula.a === "qty" ? item.qty || 0 : num(item.custom?.[formula.a] || "");
    return r2(multiplier * rate);
  }
  return r2((item.qty || 0) * (item.unit_price || 0));
}

/** Line amount net of the line's own discount and EXCLUSIVE of tax.
 *
 *  It used to add the per-line tax back in, which every caller then got wrong
 *  in the same way: the printed Amount column showed VAT that the Tax row below
 *  it reported again, and the three places that treat this as a taxable base
 *  (the editor's per-line VAT column, the UAE pack's line VAT, DocView's
 *  category allocation) were charging tax on a tax-inclusive figure. Totals are
 *  unaffected — docTotals works from docLineGross, never from this. */
export function docLineAmount(
  item: DocItem,
  formula?: { a: string; b?: string } | null
): number {
  if (item.calcMode === "manual" || (item.discount || 0) > 0 || (item.tax || 0) > 0) {
    const gross =
      item.calcMode === "manual" ? item.amount || 0 : docLineGross(item, formula);
    return r2(gross - gross * ((item.discount || 0) / 100));
  }
  return invoiceLineAmount(item, formula);
}

/** Line amount for an item read straight back out of the database, where the
 *  per-line meta (calc mode, manual amount, per-line formula, discount %) is
 *  still packed into the `custom` jsonb.
 *
 *  The editors hold items with that meta already unpacked, so they can call
 *  docLineAmount() directly. Anything rendering a *stored* document — the
 *  quick-view modals — cannot, and multiplying qty × unit_price there printed
 *  the wrong amount for every line with a manual amount, a formula or a
 *  discount: the figure disagreed with the invoice itself and with the total
 *  shown directly beneath it. */
export function storedLineAmount(
  it: {
    qty: number;
    unit_price: number;
    custom?: Record<string, string> | null;
    /** Quotation items keep discount/tax in real columns rather than in the
     *  `custom` meta, so both sources have to be honoured. */
    discount?: number;
    tax?: number;
  },
  formula?: { a: string; b?: string } | null
): number {
  const { custom, calcMode, amount, itemFormula, discount, tax } = splitItemMeta(
    it.custom
  );
  return docLineAmount(
    {
      description: "",
      ...it,
      custom,
      calcMode,
      amount,
      itemFormula,
      discount: discount ?? it.discount,
      tax: tax ?? it.tax,
    },
    formula
  );
}

/** Net turnover split by UAE tax category (S/Z/E/O/AE), after both per-line and
 *  document discounts. FTA VAT 201 boxes 4 and 5 report zero-rated and exempt
 *  supplies by net amount — those lines carry no VAT, so the ledger cannot tell
 *  them apart from each other or from standard revenue. Allocation mirrors
 *  docTotals(): the document discount is spread pro-rata by post-line-discount
 *  net, so summing every category returns the document's own net. */
export function netByTaxCategory(
  items: DocItem[],
  discount: number,
  formula?: { a: string; b?: string } | null
): Record<string, number> {
  const lineNet = (i: DocItem) =>
    docLineGross(i, formula) * (1 - (i.discount || 0) / 100);
  const subtotal = items.reduce((s, i) => s + docLineGross(i, formula), 0);
  const netAfterLineDisc = items.reduce((s, i) => s + lineNet(i), 0);
  const disc = Math.min(
    Math.max(0, discount || 0) + (subtotal - netAfterLineDisc),
    subtotal
  );
  const scale = netAfterLineDisc > 0 ? (subtotal - disc) / netAfterLineDisc : 0;
  const out: Record<string, number> = {};
  for (const i of items) {
    const cat = i.tax_category ?? "S";
    out[cat] = r2((out[cat] ?? 0) + lineNet(i) * scale);
  }
  return out;
}

/** Totals that respect either doc-level discount/tax or per-line discount/tax. */
export function docTotals(
  items: DocItem[],
  discount: number,
  taxRatePct: number,
  formula?: { a: string; b?: string } | null
) {
  const hasLineLevel = items.some((i) => (i.discount || 0) > 0 || (i.tax || 0) > 0);
  if (!hasLineLevel) {
    return invoiceTotals(items, discount, taxRatePct, formula);
  }
  // Net of each line after its OWN discount %, before the document discount.
  const lineNet = (i: DocItem) =>
    docLineGross(i, formula) * (1 - (i.discount || 0) / 100);
  // Only standard-rated lines carry VAT — zero-rated, exempt, out-of-scope and
  // reverse-charge do not. invoiceTotals() has always honoured this, but this
  // branch (taken as soon as any line has a per-line discount or tax) taxed
  // every line flat, so adding a line discount to an invoice silently charged
  // 5% on its zero-rated lines and disagreed with the VAT breakdown printed
  // beside it.
  const isStandard = (i: DocItem) => (i.tax_category ?? "S") === "S";

  const subtotal = items.reduce((s, i) => s + docLineGross(i, formula), 0);
  const lineDiscount = items.reduce(
    (s, i) => s + docLineGross(i, formula) * ((i.discount || 0) / 100),
    0
  );
  const disc = Math.min(Math.max(0, discount || 0) + lineDiscount, subtotal);
  const net = subtotal - disc;
  const lineTax = items.reduce(
    (s, i) => (isStandard(i) ? s + lineNet(i) * ((i.tax || 0) / 100) : s),
    0
  );
  // The document-level discount is allocated across lines pro-rata by net, so
  // the standard-rated share of `net` is what the document rate applies to. A
  // line carrying its OWN tax % is excluded: it has been rated explicitly, and
  // adding the document rate on top of it taxed that line twice.
  const netAfterLineDisc = items.reduce((s, i) => s + lineNet(i), 0);
  const docRatedNet = items.reduce(
    (s, i) => (isStandard(i) && !((i.tax || 0) > 0) ? s + lineNet(i) : s),
    0
  );
  const taxableNet =
    netAfterLineDisc > 0 ? net * (docRatedNet / netAfterLineDisc) : 0;
  const tax = taxableNet * ((taxRatePct || 0) / 100) + lineTax;
  return {
    subtotal: r2(subtotal),
    discount: r2(disc),
    tax: r2(tax),
    total: r2(net + tax),
  };
}
