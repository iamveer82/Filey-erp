// Pure money math — the single source of truth for invoice & quotation
// totals. No framework/Tauri imports so it is unit-testable in isolation.

export interface Totals {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}

export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Allocate discounts in cents, then round VAT once per category/rate.
 * The largest-remainder allocation keeps mixed-tax totals exactly reconciled. */
export function taxBreakdown(lines: { category: string; net: number; rate: number }[], discount: number) {
  const groups = new Map<string, { category: string; rate: number; net: number }>();
  for (const line of lines) {
    const key = `${line.category}:${line.rate}`;
    const group = groups.get(key) ?? { category: line.category, rate: line.rate, net: 0 };
    group.net += Math.round(line.net * 100);
    groups.set(key, group);
  }
  const rows = [...groups.values()];
  const total = rows.reduce((sum, row) => sum + row.net, 0);
  const cents = Math.min(Math.max(0, Math.round(discount * 100)), total);
  const shares = rows.map(row => total > 0 ? cents * row.net / total : 0);
  const allocated = shares.map(Math.floor);
  const order = shares.map((share, index) => ({ index, remainder: share - allocated[index] }))
    .sort((a, b) => b.remainder - a.remainder);
  const remaining = cents - allocated.reduce((sum, value) => sum + value, 0);
  for (let i = 0; i < remaining; i++) allocated[order[i].index]++;
  return rows.map((row, index) => {
    const taxable = (row.net - allocated[index]) / 100;
    return { category: row.category, rate: row.rate, net: row.net / 100,
      discount: allocated[index] / 100, taxable, tax: r2(taxable * row.rate / 100) };
  });
}

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
  const tax = taxBreakdown(items.map(i => ({ category: i.tax_category || "S",
    net: invoiceLineAmount(i, formula), rate: (i.tax_category ?? "S") === "S" ? taxRatePct || 0 : 0,
  })), disc).reduce((sum, row) => sum + row.tax, 0);
  return {
    subtotal: r2(subtotal),
    discount: r2(disc),
    tax: r2(tax),
    total: r2(net + tax),
  };
}

export interface RoundedTotals extends Totals {
  /** Signed adjustment applied to reach a whole-currency total (±0.50 max). */
  round_off: number;
}

/** Vyapar-style round-off: nudge the grand total to the nearest whole unit.
 *  Applied AFTER tax so ledger + doc agree; disabled → zero adjustment. */
export function applyRoundOff(t: Totals, enabled?: boolean): RoundedTotals {
  if (!enabled) return { ...t, round_off: 0 };
  const total = Math.round(t.total);
  return { ...t, round_off: r2(total - t.total), total };
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
