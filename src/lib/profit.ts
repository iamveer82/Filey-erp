/* Profit per day and per item from sales invoices and counter receipts.
 * Sales are before tax, after each line's share of the invoice discount; credit notes count
 * against them. Cost is the product's cost price as it is now, times the quantity; a line
 * with no product has no known cost. */
import { billing, erp, type InvoiceDoc, type Product } from "./api";
import { countsForGst } from "./gstReturns";
import { docLineAmount, splitItemMeta, type DocItem } from "./docItems";
import { isCreditNote } from "./einvoice";

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface ProfitLine {
  date: string;
  docId: number;
  productId?: number;
  item: string;
  qty: number;
  sales: number;
  cost: number;
  costKnown: boolean;
}

/** Each line of one invoice as sales and cost. */
export function profitLines(doc: InvoiceDoc, costs: Map<number, number>): ProfitLine[] {
  const sign = isCreditNote(doc.invoice_type_code ?? "") ? -1 : 1;
  const formula = doc.unit_price_formula ?? null;
  const items: DocItem[] = (doc.items ?? []).map((item) => {
    const meta = splitItemMeta(item.custom);
    return { ...item, description: item.description ?? "", ...meta, discount: meta.discount, tax: meta.tax } as DocItem;
  });
  const nets = items.map((it) => docLineAmount(it, formula));
  const gross = nets.reduce((s, n) => s + n, 0);
  const share = gross > 0 ? Math.min(1, (Number(doc.discount) || 0) / gross) : 0;
  return items.map((it, i) => {
    const productId = (it as DocItem & { product_id?: number | null }).product_id ?? undefined;
    const qty = Number(it.qty) || 0;
    const known = productId != null && costs.has(productId);
    return {
      date: doc.issue_date ?? "", docId: doc.id, ...(productId != null ? { productId } : {}),
      item: it.description.trim() || "Item", qty: sign * qty,
      sales: r2(sign * nets[i] * (1 - share)),
      cost: known ? r2(sign * qty * costs.get(productId!)!) : 0, costKnown: known,
    };
  });
}

export const costsOf = (products: Product[]) => new Map(products.map((p) => [p.id, Number(p.cost_price) || 0]));

export interface ProfitRow { key: string; label: string; bills: number; qty: number; sales: number; cost: number; profit: number; margin: number | null; costMissing: boolean }

function rows(lines: ProfitLine[], keyOf: (l: ProfitLine) => string, labelOf: (l: ProfitLine) => string): ProfitRow[] {
  const map = new Map<string, ProfitRow & { docs: Set<number> }>();
  for (const l of lines) {
    const key = keyOf(l);
    const row = map.get(key) ?? { key, label: labelOf(l), bills: 0, qty: 0, sales: 0, cost: 0, profit: 0, margin: null, costMissing: false, docs: new Set<number>() };
    row.docs.add(l.docId);
    row.qty = r2(row.qty + l.qty);
    row.sales = r2(row.sales + l.sales);
    row.cost = r2(row.cost + l.cost);
    row.costMissing ||= !l.costKnown && l.sales !== 0;
    map.set(key, row);
  }
  return [...map.values()].map(({ docs, ...row }) => {
    const profit = r2(row.sales - row.cost);
    return { ...row, bills: docs.size, profit, margin: row.sales ? r2((profit / row.sales) * 100) : null };
  });
}

export const profitByDay = (lines: ProfitLine[]) => rows(lines, (l) => l.date, (l) => l.date).sort((a, b) => b.key.localeCompare(a.key));
export const profitByItem = (lines: ProfitLine[]) =>
  rows(lines, (l) => (l.productId != null ? `p:${l.productId}` : `t:${l.item.toLowerCase()}`), (l) => l.item).sort((a, b) => b.profit - a.profit);

/** Every sales invoice and counter receipt dated from..to (YYYY-MM-DD) as profit lines.
 *  ponytail: one currency only; other-currency invoices are counted in `skipped`, not converted. */
export async function loadProfit(from: string, to: string): Promise<{ currency: string; skipped: number; lines: ProfitLine[] }> {
  const [list, products, company] = await Promise.all([billing.listDocs("sales", true), erp.products(), billing.getCompany()]);
  const currency = company?.currency || "AED";
  const picked = list.filter((d) => (d.issue_date ?? "") >= from && (d.issue_date ?? "") <= to && countsForGst(d.status));
  const same = picked.filter((d) => (d.currency || currency) === currency);
  const docs: InvoiceDoc[] = [];
  for (let i = 0; i < same.length; i += 6) docs.push(...await Promise.all(same.slice(i, i + 6).map((d) => billing.getDoc(d.id))));
  const costs = costsOf(products);
  return { currency, skipped: picked.length - same.length, lines: docs.flatMap((d) => profitLines(d, costs)) };
}

export function profitTotals(lines: ProfitLine[]) {
  const sales = r2(lines.reduce((s, l) => s + l.sales, 0));
  const cost = r2(lines.reduce((s, l) => s + l.cost, 0));
  const profit = r2(sales - cost);
  return { sales, cost, profit, margin: sales ? r2((profit / sales) * 100) : null, bills: new Set(lines.map((l) => l.docId)).size };
}
