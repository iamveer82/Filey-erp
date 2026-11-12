/* The sales counter (point of sale) for any shop: scan or search, bill, take payment, print
 * the receipt. Ideas from PharmaSpot by drkNsubuga (MIT, github.com/drkNsubuga/PharmaSpot).
 * A product that has batches sells from the batch that expires first, at its MRP, and its
 * expired stock is never sold. Pharma mode adds the patient and doctor on the receipt.
 *
 * A counter sale is an ordinary Filey invoice on the receipt layout, finalised and paid in
 * one go, so stock, cost of goods, the ledger and tax returns all follow the usual paths. */
import { billing, erp, type InvoiceDocInput, type Product } from "./api";
import { applyRoundOff } from "./money";
import { docTotals } from "./docItems";
import { companyInvoiceSeller } from "./invoiceSeller";
import { allocateDocumentNumber } from "./documentNumbers";
import { loadDocFormats } from "./numberFormat";
import { batchStock, fefoBatch, onlyExpired, readBatches } from "./batches";
import { isLocalMode } from "./dataMode";
import { companyCountry } from "./companyCountry";

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface CartLine {
  productId: number;
  name: string;
  qty: number;
  /** Shelf price per unit, tax included (the batch MRP when the product has batches). */
  price: number;
  batch?: string;
  exp?: string;
}

/** Payment methods at the till. UPI is Indian, so it is offered to Indian businesses only. */
export const counterMethods = (india: boolean): [string, string][] =>
  [["cash", "Cash"], ["card", "Card"], ...(india ? [["upi", "UPI"] as [string, string]] : []), ["bank transfer", "Bank transfer"]];

/** Counter sales are the receipts: invoices on the receipt layout. */
export const isCounterSale = (doc: { template?: string | null }) => doc.template === "receipt";

/** Products matching a barcode or SKU exactly, else a name, SKU, category or batch number; in stock first. */
export function findProducts(products: Product[], query: string, limit = 20): Product[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const exact = products.filter((p) => (p.barcode ?? "").toLowerCase() === q || p.sku.toLowerCase() === q);
  if (exact.length) return exact;
  return products
    .filter((p) => [p.name, p.sku, p.barcode, p.category, p.description, ...readBatches(p).map((b) => b.no)]
      .some((v) => (v ?? "").toLowerCase().includes(q)))
    .sort((a, b) => Number(b.quantity > 0) - Number(a.quantity > 0) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Does this product keep batches (and so expiry)? */
export const hasBatches = (p: Product) => readBatches(p).length > 0;

/** Units that may be sold today: stock on hand less expired batches. */
export function sellable(p: Product, today: string): number {
  const onHand = Math.max(0, Number(p.quantity) || 0);
  const { batches, unbatched } = batchStock(readBatches(p), Number(p.quantity) || 0, today);
  return batches.length ? r2(unbatched + batches.filter((b) => !b.expired).reduce((s, b) => s + b.left, 0)) : onHand;
}

/** A cart line for `qty` of `p`. A product with batches takes the next in-date batch at its MRP
 *  and refuses expired or no stock; one without batches sells at its price, as invoices do. */
export function lineFor(p: Product, today: string, qty = 1): CartLine {
  if (!hasBatches(p)) return { productId: p.id, name: p.name, qty, price: Number(p.unit_price) || 0 };
  if (onlyExpired(p, today)) throw new Error(`Only expired stock of ${p.name} is left. Write it off under Inventory → Batches.`);
  if ((Number(p.quantity) || 0) <= 0) throw new Error(`${p.name} is out of stock.`);
  const b = fefoBatch(p, today);
  return { productId: p.id, name: p.name, qty, price: Number(b?.mrp) || Number(p.unit_price) || 0, ...(b ? { batch: b.no, exp: b.exp } : {}) };
}

export const cartTotal = (lines: CartLine[]) => r2(lines.reduce((s, l) => s + l.qty * l.price, 0));

/** Invoice lines priced before tax so that, with tax added and rounded, the bill equals the shelf price. */
export function counterItems(lines: CartLine[], taxRate: number) {
  return lines.map((l) => ({
    product_id: l.productId,
    description: l.name,
    qty: l.qty,
    unit_price: r2(l.price / (1 + taxRate / 100)),
    custom: { ...(l.batch ? { batch: l.batch } : {}), ...(l.exp ? { exp: l.exp.slice(0, 7) } : {}) },
  }));
}

export interface CounterSale {
  lines: CartLine[];
  method: string;
  customer?: string;
  customerId?: number;
  patient?: string;
  doctor?: string;
  today: string;
}

/** Record a counter sale: a paid receipt that takes the stock and posts the takings. */
export async function sellAtCounter(sale: CounterSale): Promise<{ id: number; number: string; total: number }> {
  const lines = sale.lines.filter((l) => l.qty > 0);
  if (!lines.length) throw new Error("Add at least one item to the bill.");
  const products = await erp.products({ fresh: true });
  for (const l of lines) {
    const p = products.find((x) => x.id === l.productId);
    if (!p) throw new Error(`${l.name} is no longer in Inventory.`);
    if (!(l.price >= 0)) throw new Error(`Enter a price for ${l.name}.`);
    // Stock that keeps batches must be in date; other stock may go below zero, as on an invoice.
    if (!hasBatches(p)) continue;
    const wanted = lines.filter((x) => x.productId === l.productId).reduce((s, x) => s + x.qty, 0);
    const can = sellable(p, sale.today);
    if (wanted > can) throw new Error(`Only ${can} of ${p.name} can be sold${can < (Number(p.quantity) || 0) ? " (the rest is expired)" : ""}.`);
  }
  const co = await billing.getCompany(true);
  const taxRate = co.tax_type === "None" ? 0 : Number(co.default_tax_rate) || 0;
  const india = companyCountry(co) === "IN";
  const items = counterItems(lines, taxRate);
  const rx = [sale.patient?.trim() && `Patient: ${sale.patient.trim()}`, sale.doctor?.trim() && `Prescribed by: ${sale.doctor.trim()}`].filter(Boolean).join(" · ");
  const number = await allocateDocumentNumber("invoice",
    isLocalMode() ? (await billing.listDocs("sales")).map((d) => d.number) : [], await loadDocFormats());
  const input: InvoiceDocInput = {
    number,
    status: "sent",
    // A tax receipt must say "Tax Invoice" (India turns a tax-free one into a Bill of Supply).
    doc_title: india || taxRate > 0 ? "Tax Invoice" : "Receipt",
    template: "receipt",
    accent: co.default_accent || "#222222",
    currency: co.currency || "INR",
    ...companyInvoiceSeller(co),
    logo: co.logo,
    customer_name: sale.customer?.trim() || "Walk-in customer",
    ...(sale.customerId ? { customer_id: sale.customerId } : {}),
    buyer_country_code: co.country_code || undefined,
    buyer_country_subdivision: co.country_subdivision || undefined,
    issue_date: sale.today,
    due_date: sale.today,
    tax_rate: taxRate,
    discount: 0,
    round_off: true,
    notes: rx || "Thank you for shopping with us.",
    items,
    custom_columns: items.some((i) => i.custom.batch) ? [{ key: "batch", label: "Batch" }, { key: "exp", label: "Exp." }] : [],
  } as InvoiceDocInput;
  const id = await billing.saveDoc(input);
  const total = applyRoundOff(docTotals(items, 0, taxRate, null), true).total;
  if (total > 0) await billing.addPayment(id, r2(total), sale.method || "cash", sale.today);
  return { id, number, total: r2(total) };
}

export const lowStock = (products: Product[]) =>
  products.filter((p) => (Number(p.reorder_level) || 0) > 0 && (Number(p.quantity) || 0) <= (Number(p.reorder_level) || 0));

/* Bills on hold (PharmaSpot's open tabs): kept on this device only. */
const HELD_KEY = "filey_counter_held";
export interface HeldBill { id: string; label: string; at: string; lines: CartLine[]; customer?: string; customerId?: number; patient?: string; doctor?: string }
export function heldBills(): HeldBill[] {
  try { const v = JSON.parse(localStorage.getItem(HELD_KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function saveHeldBills(bills: HeldBill[]) {
  try { localStorage.setItem(HELD_KEY, JSON.stringify(bills.slice(0, 30))); } catch { /* private window: holds just aren't kept */ }
}
