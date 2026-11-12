/* Shop receipts: a saved counter sale (or any invoice) laid out for a till-roll printer
 * (80 mm or 58 mm) or plain A4, and printed in one click through a hidden frame.
 * Prices on a receipt include tax; the tax inside them is shown underneath. */
import { billing, type CompanyProfile, type InvoiceDoc, type InvoicePayment } from "./api";
import { applyRoundOff } from "./money";
import { docTotals, splitItemMeta, type DocItem } from "./docItems";
import { taxRegimeFor } from "./taxRegimes";
import { gstDocTitle, gstSupply, gstTaxRows } from "./gst";
import { isCreditNote } from "./einvoice";
import { money } from "./format";

const r2 = (n: number) => Math.round(n * 100) / 100;

export type ReceiptWidth = "80mm" | "58mm" | "a4";

export interface ReceiptLine { name: string; qty: number; price: number; amount: number; batch?: string; exp?: string }
export interface ReceiptData {
  shop: { name: string; address?: string; phone?: string; taxId?: string; taxIdLabel: string };
  title: string;
  number: string;
  date: string;
  customer: string;
  currency: string;
  lines: ReceiptLine[];
  /** Tax already inside the prices, by head. */
  taxes: { label: string; amount: number }[];
  /** What makes the lines add up to the total. */
  roundOff: number;
  total: number;
  paidBy: string[];
  paid: number;
  tendered?: number;
  change?: number;
  notes?: string;
}

const METHOD_NAMES: Record<string, string> = { cash: "Cash", card: "Card", upi: "UPI", "bank transfer": "Bank transfer", cheque: "Cheque" };
const methodName = (m?: string | null) => METHOD_NAMES[(m ?? "").trim().toLowerCase()] ?? ((m ?? "").trim() || "Other");

/** A receipt from a saved invoice, its company and its payments. Cash given and change come
 *  from the till, as they are not stored. */
export function receiptFromDoc(doc: InvoiceDoc, company: CompanyProfile, payments: InvoicePayment[], cash?: { tendered?: number; change?: number }): ReceiptData {
  const items: DocItem[] = (doc.items ?? []).map((item) => {
    const meta = splitItemMeta(item.custom);
    return { ...item, description: item.description ?? "", ...meta, discount: meta.discount, tax: meta.tax } as DocItem;
  });
  const rate = Number(doc.tax_rate) || 0;
  const t = applyRoundOff(docTotals(items, Number(doc.discount) || 0, rate, doc.unit_price_formula ?? null), !!doc.round_off);
  const lines: ReceiptLine[] = items.map((it) => {
    const lineRate = (it.tax_category || "S") === "S" ? (Number(it.tax) || rate) : 0;
    const price = r2(Number(it.unit_price) * (1 + lineRate / 100));
    const qty = Number(it.qty) || 0;
    const custom = (it.custom ?? {}) as Record<string, string>;
    return { name: it.description || "Item", qty, price, amount: r2(price * qty), ...(custom.batch ? { batch: custom.batch } : {}), ...(custom.exp ? { exp: custom.exp } : {}) };
  });
  const regime = taxRegimeFor(doc.currency, doc.tax_country_code);
  const india = regime.id === "in-gst";
  const supply = india ? gstSupply({ taxCountry: "IN", sellerState: doc.seller_country_subdivision, sellerGstin: doc.seller_trn,
    buyerState: doc.buyer_country_subdivision, buyerGstin: (doc as InvoiceDoc & { customer_trn?: string }).customer_trn, buyerCountry: doc.buyer_country_code }) : undefined;
  const taxes = t.tax > 0.005 ? (india ? gstTaxRows(r2(t.tax), rate, supply, regime.taxLabel) : [{ label: `${regime.taxLabel} (${rate}%)`, amount: r2(t.tax) }]) : [];
  const credit = isCreditNote(doc.invoice_type_code ?? "");
  const total = r2(Math.abs(t.total));
  const paid = r2(payments.reduce((s, p) => s + Number(p.amount || 0), 0));
  return {
    shop: { name: company.name || doc.seller_name, address: [company.address || doc.seller_address, company.city].filter(Boolean).join(", ") || undefined,
      phone: company.phone || doc.seller_phone || undefined, taxId: company.trn || doc.seller_trn || undefined, taxIdLabel: regime.trnLabel },
    title: (india ? gstDocTitle(doc.doc_title, supply, t.tax, credit) : doc.doc_title) || "Receipt",
    number: doc.number, date: doc.issue_date || doc.created_at?.slice(0, 10) || "", customer: doc.customer_name || "Walk-in customer",
    currency: doc.currency || company.currency || "AED", lines, taxes,
    roundOff: r2(total - lines.reduce((s, l) => s + l.amount, 0)), total,
    paidBy: [...new Set(payments.map((p) => methodName(p.method)))], paid,
    ...(cash?.tendered ? { tendered: cash.tendered, change: cash.change ?? r2(cash.tendered - total) } : {}),
    ...(doc.notes ? { notes: doc.notes } : {}),
  };
}

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const PAGE: Record<ReceiptWidth, string> = {
  "80mm": "@page{size:80mm auto;margin:3mm}body{width:74mm;font-size:12px}",
  "58mm": "@page{size:58mm auto;margin:2mm}body{width:54mm;font-size:10.5px}",
  a4: "@page{size:A4;margin:15mm}body{max-width:150mm;margin:0 auto;font-size:13px}",
};

/** The receipt as a complete HTML page. Every value is escaped. */
export function receiptHtml(r: ReceiptData, width: ReceiptWidth = "80mm"): string {
  const m = (v: number) => esc(money(v, r.currency));
  const row = (k: string, v: string, strong = false) => `<tr${strong ? ' class="b"' : ""}><td>${k}</td><td class="r">${v}</td></tr>`;
  const lines = r.lines.map((l) => `<tr><td colspan="2">${esc(l.name)}${l.batch ? `<div class="s">Batch ${esc(l.batch)}${l.exp ? ` · Exp ${esc(l.exp.slice(0, 7))}` : ""}</div>` : ""}</td></tr>`
    + `<tr><td class="s">${esc(l.qty)} × ${m(l.price)}</td><td class="r">${m(l.amount)}</td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(r.title)} ${esc(r.number)}</title><style>
${PAGE[width]}
*{box-sizing:border-box}body{font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:#000;margin:0 auto;padding:0;line-height:1.35}
h1{font-size:1.25em;margin:0;text-align:center}p{margin:0}.c{text-align:center}.s{font-size:.85em;color:#333}.r{text-align:right;white-space:nowrap}
table{width:100%;border-collapse:collapse}td{padding:1px 0;vertical-align:top}.b td{font-weight:700;font-size:1.15em;padding-top:4px}
hr{border:0;border-top:1px dashed #000;margin:6px 0}
</style></head><body>
<h1>${esc(r.shop.name)}</h1>
${r.shop.address ? `<p class="c s">${esc(r.shop.address)}</p>` : ""}${r.shop.phone ? `<p class="c s">${esc(r.shop.phone)}</p>` : ""}${r.shop.taxId ? `<p class="c s">${esc(r.shop.taxIdLabel)}: ${esc(r.shop.taxId)}</p>` : ""}
<hr><p class="c"><strong>${esc(r.title)}</strong></p>
<table>${row("No.", esc(r.number))}${row("Date", esc(r.date))}${row("Customer", esc(r.customer))}</table>
<hr><table>${lines}</table><hr>
<table>${r.taxes.map((t) => row(`Incl. ${esc(t.label)}`, m(t.amount))).join("")}${Math.abs(r.roundOff) >= 0.005 ? row("Round off", m(r.roundOff)) : ""}${row("Total", m(r.total), true)}
${r.paidBy.length ? row(`Paid by ${esc(r.paidBy.join(", "))}`, m(r.paid)) : ""}${r.tendered ? row("Cash given", m(r.tendered)) + row("Change", m(r.change ?? 0)) : ""}</table>
${r.notes ? `<hr><p class="c s">${esc(r.notes)}</p>` : ""}
<p class="c s" style="margin-top:6px">Thank you!</p>
</body></html>`;
}

/** Print an HTML page without leaving Filey: a hidden frame opens the system print dialog. */
export function printHtml(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
        resolve();
      } catch (e) { reject(e); }
      // The dialog blocks until closed in most engines; remove the frame shortly after.
      setTimeout(() => frame.remove(), 60_000);
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}

/* Printer choice is per device: the till's printer is not the office's. */
const PREFS_KEY = "filey_receipt_prefs";
export interface ReceiptPrefs { width: ReceiptWidth; auto: boolean }
export function receiptPrefs(): ReceiptPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    return { width: ["80mm", "58mm", "a4"].includes(v.width) ? v.width : "80mm", auto: v.auto === true };
  } catch {
    return { width: "80mm", auto: false };
  }
}
export function saveReceiptPrefs(prefs: ReceiptPrefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* private window: the choice just isn't kept */ }
}

/** Print a saved sale's receipt with this device's printer width. */
export async function printSavedReceipt(id: number, cash?: { tendered?: number; change?: number }): Promise<void> {
  const [doc, payments, company] = await Promise.all([billing.getDoc(id), billing.payments(id).catch(() => []), billing.getCompany()]);
  await printHtml(receiptHtml(receiptFromDoc(doc, company, payments, cash), receiptPrefs().width));
}
