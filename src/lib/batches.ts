/* Batch and expiry tracking for stock such as medicines, without a new table.
 *
 * Each product keeps the batches it received in custom_fields.__batches. How much of a
 * batch is left is worked out, not stored: stock on hand is assumed to sit in the batches
 * that expire last, because sales take the earliest expiry first (FEFO). That stays true
 * to the product's quantity however the stock went down (an invoice, the counter, a
 * stocktake), with no second counter to drift. Expired stock is written off explicitly. */
import { erp, type Product } from "./api";
import { todayYmd } from "./format";

export const BATCHES_KEY = "__batches";

export interface Batch {
  no: string;
  /** Expiry, YYYY-MM-DD (end of month when only the month is printed). */
  exp: string;
  mfg?: string;
  /** Quantity received in this batch. */
  qty: number;
  /** Printed maximum retail price, per unit. */
  mrp?: number;
  received?: string;
}

export interface BatchStock extends Batch {
  /** Units of this batch still on hand. */
  left: number;
  expired: boolean;
  /** Days until expiry; negative once expired. */
  daysLeft: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const DAY = 86400000;

export function readBatches(p: Pick<Product, "custom_fields">): Batch[] {
  try {
    const raw = p.custom_fields?.[BATCHES_KEY];
    const list = typeof raw === "string" ? JSON.parse(raw) : Array.isArray(raw) ? raw : [];
    return Array.isArray(list)
      ? list.filter((b) => b && typeof b.no === "string" && typeof b.exp === "string" && Number(b.qty) > 0).map((b) => ({ ...b, qty: Number(b.qty) }))
      : [];
  } catch {
    return [];
  }
}

/** "2027-03", "03/27", "03/2027" or "2027-03-15" → YYYY-MM-DD; "" when unreadable. */
export function expiryFrom(input: string): string {
  const s = input.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return s;
  m = /^(\d{4})-(\d{1,2})$/.exec(s) ?? null;
  const mm = m ? [m[1], m[2]] : (() => { const x = /^(\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s); return x ? [x[2].length === 2 ? `20${x[2]}` : x[2], x[1]] : null; })();
  if (!mm) return "";
  const year = Number(mm[0]), month = Number(mm[1]);
  if (month < 1 || month > 12) return "";
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

const days = (exp: string, today: string) => Math.round((Date.parse(`${exp}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);

/** What is left of each batch, earliest expiry first, and any stock received without a batch. */
export function batchStock(batches: Batch[], onHand: number, today: string): { batches: BatchStock[]; unbatched: number } {
  const sorted = [...batches].sort((a, b) => a.exp.localeCompare(b.exp) || (a.received ?? "").localeCompare(b.received ?? ""));
  const received = sorted.reduce((s, b) => s + b.qty, 0);
  let gone = Math.max(0, received - Math.max(0, onHand));
  const out = sorted.map((b) => {
    const take = Math.min(b.qty, gone);
    gone = r3(gone - take);
    const daysLeft = days(b.exp, today);
    return { ...b, left: r3(b.qty - take), expired: daysLeft < 0, daysLeft };
  });
  return { batches: out, unbatched: r3(Math.max(0, onHand - received)) };
}

/** The batch the next sale should come from: the earliest expiry still on hand and in date. */
export function fefoBatch(p: Pick<Product, "custom_fields" | "quantity">, today: string): BatchStock | undefined {
  return batchStock(readBatches(p), Number(p.quantity) || 0, today).batches.find((b) => b.left > 0 && !b.expired);
}

/** Only expired stock is left: the counter must not sell it. */
export function onlyExpired(p: Pick<Product, "custom_fields" | "quantity">, today: string): boolean {
  const { batches, unbatched } = batchStock(readBatches(p), Number(p.quantity) || 0, today);
  return batches.length > 0 && unbatched <= 0 && !batches.some((b) => b.left > 0 && !b.expired) && batches.some((b) => b.left > 0);
}

/** Product fields that store `batches` once stock is `onHand`: used-up batches dropped, and the
 *  product's own batch/expiry set to the next batch to sell, so lists and expiry filters follow. */
export function batchFields(p: Pick<Product, "custom_fields">, batches: Batch[], onHand: number, today: string): Pick<Product, "custom_fields" | "batch_number" | "expiry_date"> {
  const stock = batchStock(batches, onHand, today).batches.filter((b) => b.left > 0);
  // ponytail: a used-up batch keeps only what is left, so the FEFO maths stays identical.
  const kept: Batch[] = stock.map(({ left, expired: _e, daysLeft: _d, ...b }) => ({ ...b, qty: left }));
  const next = stock.find((b) => !b.expired) ?? stock[0];
  const custom = { ...(p.custom_fields ?? {}) };
  if (kept.length) custom[BATCHES_KEY] = JSON.stringify(kept);
  else delete custom[BATCHES_KEY];
  return { custom_fields: custom, batch_number: next?.no ?? "", expiry_date: next?.exp ?? undefined };
}

/** Batches expiring within `withinDays` (or already expired) that still have stock. */
export function expiringBatches(products: Product[], today: string, withinDays = 90) {
  return products.flatMap((p) => batchStock(readBatches(p), Number(p.quantity) || 0, today).batches
    .filter((b) => b.left > 0 && b.daysLeft <= withinDays).map((b) => ({ product: p, batch: b })))
    .sort((a, b) => a.batch.exp.localeCompare(b.batch.exp));
}

/** Receive a batch into stock and record it on the product. */
export async function receiveBatch(p: Product, batch: Batch, today = todayYmd()) {
  // Stock first: if the batch details then fail to save, the units still count, just without a batch.
  await erp.recordStockEntry(p.id, "in", batch.qty, `Batch ${batch.no}`, `Batch ${batch.no} received, expires ${batch.exp}`);
  await erp.updateProduct(p.id, batchFields(p, [...readBatches(p), { ...batch, received: today }], (Number(p.quantity) || 0) + batch.qty, today));
}

export async function writeOffBatch(p: Product, no: string, today = todayYmd()) {
  const all = batchStock(readBatches(p), Number(p.quantity) || 0, today).batches;
  const target = all.find((b) => b.no === no);
  if (!target || target.left <= 0) return 0;
  await erp.recordStockEntry(p.id, "out", target.left, `Batch ${no}`, `Expired batch ${no} written off`);
  const rest = all.filter((b) => b !== target).map(({ left, expired: _e, daysLeft: _d, ...b }) => ({ ...b, qty: left }));
  await erp.updateProduct(p.id, batchFields(p, rest, (Number(p.quantity) || 0) - target.left, today));
  return target.left;
}
