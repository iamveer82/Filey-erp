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

/** Invoice line amount. When a formula is active, the multiplier is the selected
 * field (custom column or `qty`). Otherwise the standard `qty × unit_price` is
 * used so frontend, backend and PDF all agree. */
export function invoiceLineAmount(
  item: { qty: number; unit_price: number; custom?: Record<string, string> | null },
  formula?: { a: string; b?: string } | null
): number {
  const rate = item.unit_price || 0;
  if (formula?.a) {
    const multiplier =
      formula.a === "qty" ? item.qty || 0 : num(item.custom?.[formula.a] || "");
    return r2(multiplier * rate);
  }
  return r2((item.qty || 0) * rate);
}

/** Invoice totals. `unit_price` is treated as a per-unit rate; the line amount is
 * `qty × unit_price`, or `formula.field × unit_price` when a formula is set. */
export function invoiceTotals(
  items: { qty: number; unit_price: number; custom?: Record<string, string> | null }[],
  discount: number,
  taxRatePct: number,
  formula?: { a: string; b?: string } | null
): Totals {
  const subtotal = items.reduce((s, i) => s + invoiceLineAmount(i, formula), 0);
  const disc = Math.min(Math.max(0, discount || 0), subtotal);
  const net = subtotal - disc;
  const tax = net * ((taxRatePct || 0) / 100);
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
