/* GSTR-2B reconciliation: the JSON downloaded from the GST portal (Returns → GSTR-2B →
 * Download JSON) matched against Filey purchase invoices, by supplier GSTIN and invoice
 * number, with taxable value and tax compared to the rupee. */
import { taxOf, type GstDocSummary } from "./gstReturns";

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const text = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

export interface Gstr2bDoc {
  gstin: string;
  name: string;
  number: string;
  /** YYYY-MM-DD */
  date: string;
  value: number;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  /** Credit or debit note rather than an invoice. */
  note: "" | "C" | "D";
  /** The portal says the credit can be claimed. */
  itc: boolean;
}

const ymd = (ddmmyyyy: string) => {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(ddmmyyyy);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ddmmyyyy;
};

function amounts(row: Record<string, unknown>) {
  const items = Array.isArray(row.items) ? (row.items as Record<string, unknown>[]) : Array.isArray(row.itms) ? (row.itms as Record<string, unknown>[]).map((i) => (i.itm_det ?? i) as Record<string, unknown>) : null;
  const pick = (key: string, alt: string) => items
    ? r2(items.reduce((s, i) => s + num(i[key] ?? i[alt]), 0))
    : r2(num(row[key] ?? row[alt]));
  return { taxable: pick("txval", "txval"), igst: pick("igst", "iamt"), cgst: pick("cgst", "camt"), sgst: pick("sgst", "samt") };
}

/** Invoices and credit/debit notes from a GSTR-2B JSON file. Throws on a file that is not one. */
export function parseGstr2b(json: unknown): { gstin: string; period: string; docs: Gstr2bDoc[] } {
  const root = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const data = (root.data && typeof root.data === "object" ? root.data : root) as Record<string, unknown>;
  const docdata = data.docdata as Record<string, unknown> | undefined;
  if (!docdata || typeof docdata !== "object") throw new Error("This is not a GSTR-2B JSON file. Download it from Returns → GSTR-2B on the GST portal.");
  const docs: Gstr2bDoc[] = [];
  const suppliers = (key: string) => (Array.isArray(docdata[key]) ? (docdata[key] as Record<string, unknown>[]) : []);
  for (const s of suppliers("b2b")) {
    for (const inv of Array.isArray(s.inv) ? (s.inv as Record<string, unknown>[]) : []) {
      docs.push({ gstin: text(s.ctin).toUpperCase(), name: text(s.trdnm), number: text(inv.inum), date: ymd(text(inv.dt)),
        value: r2(num(inv.val)), ...amounts(inv), note: "", itc: text(inv.itcavl).toUpperCase() !== "N" });
    }
  }
  for (const s of suppliers("cdnr")) {
    for (const nt of Array.isArray(s.nt) ? (s.nt as Record<string, unknown>[]) : []) {
      const kind = text(nt.typ ?? nt.ntty).toUpperCase() === "D" ? "D" : "C";
      docs.push({ gstin: text(s.ctin).toUpperCase(), name: text(s.trdnm), number: text(nt.ntnum ?? nt.nt_num), date: ymd(text(nt.dt ?? nt.nt_dt)),
        value: r2(num(nt.val)), ...amounts(nt), note: kind, itc: text(nt.itcavl).toUpperCase() !== "N" });
    }
  }
  const rtn = text(data.rtnprd);
  return { gstin: text(data.gstin).toUpperCase(), period: /^\d{6}$/.test(rtn) ? `${rtn.slice(2)}-${rtn.slice(0, 2)}` : "", docs };
}

/** Invoice numbers as suppliers type them differ in case, spaces, slashes and leading zeros. */
export const invoiceKey = (number: string) => number.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+(?=\d)/, "");

export interface Gstr2bPair { portal: Gstr2bDoc; books: GstDocSummary; taxableDiff: number; taxDiff: number }

export interface Gstr2bMatch {
  matched: Gstr2bPair[];
  /** Same invoice, different amounts. */
  mismatched: Gstr2bPair[];
  /** On the portal, not in Filey: record the purchase or ask why it is there. */
  missingInBooks: Gstr2bDoc[];
  /** In Filey, not on the portal: the supplier has not filed it, so the credit is at risk. */
  missingInPortal: GstDocSummary[];
}

const booksTaxable = (d: GstDocSummary) => r2(d.rates.reduce((s, r) => s + r.taxable, 0) + d.nil);
const booksTax = (d: GstDocSummary) => r2(d.rates.reduce((s, r) => s + taxOf(r), 0));

export function matchGstr2b(portal: Gstr2bDoc[], books: GstDocSummary[], tolerance = 1): Gstr2bMatch {
  const out: Gstr2bMatch = { matched: [], mismatched: [], missingInBooks: [], missingInPortal: [] };
  const left = new Set(books);
  const find = (p: Gstr2bDoc) => {
    const key = invoiceKey(p.number);
    const same = [...left].filter((b) => invoiceKey(b.number) === key && b.credit === (p.note === "C"));
    return same.find((b) => b.gstin === p.gstin) ?? (same.length === 1 && !same[0].gstin ? same[0] : undefined);
  };
  for (const p of portal) {
    const b = find(p);
    if (!b) { out.missingInBooks.push(p); continue; }
    left.delete(b);
    const pair = { portal: p, books: b, taxableDiff: r2(booksTaxable(b) - p.taxable), taxDiff: r2(booksTax(b) - (p.igst + p.cgst + p.sgst)) };
    (Math.abs(pair.taxableDiff) <= tolerance && Math.abs(pair.taxDiff) <= tolerance ? out.matched : out.mismatched).push(pair);
  }
  out.missingInPortal = [...left];
  return out;
}
