// Pure money math — the single source of truth for invoice & quotation
// totals. No framework/Tauri imports so it is unit-testable in isolation.

export interface Totals {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}

export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const num = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

export type CalcMode = "auto" | "manual" | "formula";

export interface InvoiceLineItem {
  qty: number;
  unit_price: number;
  custom?: Record<string, string> | null;
  /** Override the line amount directly (used when calcMode === 'manual'). */
  amount?: number;
  calcMode?: CalcMode;
  /** Per-line formula overrides the doc-level formula for this line. */
  itemFormula?: { a: string; b?: string } | null;
  /** UAE e-invoice tax category (S/Z/E/O/AE). Only "S" (the default) is taxed;
   *  zero-rated/exempt/out-of-scope/reverse-charge contribute no VAT. */
  tax_category?: string | null;
}

/** Invoice line amount. Priority:
 * 1. Manual amount (`calcMode === 'manual'`).
 * 2. Per-line formula (`calcMode === 'formula'`).
 * 3. Doc-level formula.
 * 4. Standard `qty × unit_price`.
 * This keeps frontend, backend and PDF in agreement. */
export function invoiceLineAmount(
  item: InvoiceLineItem,
  formula?: { a: string; b?: string } | null
): number {
  const rate = item.unit_price || 0;
  if (item.calcMode === "manual") {
    return r2(item.amount || 0);
  }
  const activeFormula =
    item.calcMode === "formula" && item.itemFormula?.a ? item.itemFormula : formula;
  if (activeFormula?.a) {
    const multiplier =
      activeFormula.a === "qty" ? item.qty || 0 : num(item.custom?.[activeFormula.a] || "");
    return r2(multiplier * rate);
  }
  return r2((item.qty || 0) * rate);
}

/** Invoice totals. `unit_price` is treated as a per-unit rate; the line amount is
 * `qty × unit_price`, a doc-level formula, or a per-line override. */
export function invoiceTotals(
  items: InvoiceLineItem[],
  discount: number,
  taxRatePct: number,
  formula?: { a: string; b?: string } | null
): Totals {
  const subtotal = items.reduce((s, i) => s + invoiceLineAmount(i, formula), 0);
  const disc = Math.min(Math.max(0, discount || 0), subtotal);
  const net = subtotal - disc;
  // Category-aware VAT: only standard-rated ("S", the default) lines are taxed;
  // zero-rated / exempt / out-of-scope / reverse-charge contribute no VAT. The
  // document discount is allocated across lines pro-rata by net. With every line
  // standard (or no category set) this equals net × rate — the prior flat result.
  const rate = (taxRatePct || 0) / 100;
  let tax = 0;
  if (subtotal > 0) {
    for (const i of items) {
      if ((i.tax_category ?? "S") !== "S") continue;
      const lineNet = invoiceLineAmount(i, formula);
      tax += (lineNet / subtotal) * net * rate;
    }
  }
  return {
    subtotal: r2(subtotal),
    discount: r2(disc),
    tax: r2(tax),
    total: r2(net + tax),
  };
}

/** Quotation: per-line discount (%) then per-line tax (%). */
export function quotationTotals(
  items: { qty: number; rate: number; discount: number; tax: number }[]
): Totals {
  let subtotal = 0;
  let discount = 0;
  let tax = 0;
  for (const i of items) {
    const gross = (i.qty || 0) * (i.rate || 0);
    const disc = gross * ((i.discount || 0) / 100);
    subtotal += gross;
    discount += disc;
    tax += (gross - disc) * ((i.tax || 0) / 100);
  }
  return {
    subtotal: r2(subtotal),
    discount: r2(discount),
    tax: r2(tax),
    total: r2(subtotal - discount + tax),
  };
}
