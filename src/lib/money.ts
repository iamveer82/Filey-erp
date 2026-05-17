// Pure money math — the single source of truth for invoice & quotation
// totals. No framework/Tauri imports so it is unit-testable in isolation.

export interface Totals {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Invoice: flat discount amount + a single tax rate (%) on the net. */
export function invoiceTotals(
  items: { qty: number; unit_price: number }[],
  discount: number,
  taxRatePct: number
): Totals {
  const subtotal = items.reduce(
    (s, i) => s + (i.qty || 0) * (i.unit_price || 0),
    0
  );
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
