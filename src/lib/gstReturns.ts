/* GSTR-1 and GSTR-3B figures from Filey invoices, for Indian businesses.
 *
 * Section rules follow Free-GST-Billing-Software by IamRamgarhia (MIT,
 * github.com/IamRamgarhia/Free-GST-Billing-Software) and the GSTN return format:
 * B2B = buyer has a GSTIN; B2C Large = unregistered inter-state invoice above
 * Rs 1 lakh (threshold since August 2024); B2C Small = the rest, summed by place
 * of supply and rate; credit notes go to CDNR (registered) or CDNUR. GSTR-3B 4(A)
 * input tax credit comes from purchase invoices. */
import { docLineAmount, docTaxBreakdown, splitItemMeta, storedDocTotals, type DocItem } from "./docItems";
import { applyRoundOff } from "./money";
import { isCreditNote } from "./einvoice";
import { gstinError, gstState, gstSupply, stateFromGstin, type GstSupply } from "./gst";
import type { InvoiceDoc } from "./api";

export const B2CL_LIMIT = 100000;
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface GstAmounts { taxable: number; igst: number; cgst: number; sgst: number }
const ZERO: GstAmounts = { taxable: 0, igst: 0, cgst: 0, sgst: 0 };
const plus = (a: GstAmounts, b: GstAmounts, sign = 1): GstAmounts => ({
  taxable: r2(a.taxable + sign * b.taxable), igst: r2(a.igst + sign * b.igst),
  cgst: r2(a.cgst + sign * b.cgst), sgst: r2(a.sgst + sign * b.sgst),
});
export const taxOf = (a: GstAmounts) => r2(a.igst + a.cgst + a.sgst);

export interface GstHsnLine { hsn: string; description: string; uqc: string; qty: number; rate: number; amounts: GstAmounts }

export interface GstDocSummary {
  number: string;
  date: string;
  party: string;
  /** The other party's GSTIN when it is valid. */
  gstin: string;
  supply?: GstSupply;
  /** Place of supply state code ("27"), "96" for exports. */
  pos: string;
  credit: boolean;
  /** Invoice value including tax, as printed. */
  value: number;
  rates: (GstAmounts & { rate: number })[];
  /** Zero-rated / exempt / nil lines. */
  nil: number;
  hsn: GstHsnLine[];
  problems: string[];
}

const UQC: Record<string, string> = {
  pcs: "PCS", pc: "PCS", piece: "PCS", pieces: "PCS", nos: "NOS", no: "NOS", number: "NOS", unit: "UNT", units: "UNT",
  kg: "KGS", kgs: "KGS", g: "GMS", gm: "GMS", gms: "GMS", ton: "TON", tonne: "TON", mt: "MTS", qtl: "QTL",
  l: "LTR", ltr: "LTR", litre: "LTR", liter: "LTR", ml: "MLT", m: "MTR", mtr: "MTR", metre: "MTR", meter: "MTR",
  cm: "CMS", ft: "OTH", sqft: "SQF", sqm: "SQM", box: "BOX", boxes: "BOX", set: "SET", sets: "SET", pack: "PAC", pkt: "PAC",
  dozen: "DOZ", doz: "DOZ", pair: "PRS", pairs: "PRS", roll: "ROL", bag: "BAG", bottle: "BTL", can: "CAN", drum: "DRM", carton: "CTN",
};
export const uqcFor = (unit?: string | null) => UQC[(unit ?? "").trim().toLowerCase().replace(/\.$/, "")] ?? "OTH";

/** One invoice (or purchase invoice) as GST figures. Purchases swap the parties: the
 *  supplier is the seller and the business is the buyer. */
export function summarizeGstDoc(doc: InvoiceDoc, company: { country_subdivision?: string | null; trn?: string | null }, purchase = false): GstDocSummary {
  const d = doc as InvoiceDoc & Record<string, unknown>;
  const text = (v: unknown) => typeof v === "string" ? v.trim() : "";
  // TCS lines are income tax collected on top of the invoice, outside GST.
  const items: DocItem[] = (doc.items ?? []).filter((item) => !item.custom?.tcs).map((item) => {
    const meta = splitItemMeta(item.custom);
    return { ...item, description: item.description ?? "", ...meta, discount: meta.discount, tax: meta.tax } as DocItem;
  });
  const discount = Number(d.discount) || 0;
  const rate = Number(d.tax_rate) || 0;
  const formula = (d.unit_price_formula as { a: string; b?: string } | null) ?? null;
  const partyGstin = text(d.customer_trn).toUpperCase();
  const ownState = company.country_subdivision, ownGstin = company.trn;
  const supply = gstSupply(purchase
    ? { taxCountry: "IN", sellerState: text(d.buyer_country_subdivision), sellerGstin: partyGstin, buyerState: ownState, buyerGstin: ownGstin, buyerCountry: text(d.buyer_country_code) }
    : { taxCountry: "IN", sellerState: text(d.seller_country_subdivision) || ownState, sellerGstin: text(d.seller_trn) || ownGstin,
      buyerState: text(d.buyer_country_subdivision), buyerGstin: partyGstin, buyerCountry: text(d.buyer_country_code) });
  const problems: string[] = [];
  const gstinProblem = gstinError(partyGstin);
  if (partyGstin && gstinProblem) problems.push(`${purchase ? "Supplier" : "Customer"} GSTIN: ${gstinProblem}`);
  if (!supply) problems.push("State unknown: set the business state and the place of supply, so the tax splits into CGST/SGST or IGST.");
  const currency = text(d.currency) || "INR";
  if (currency !== "INR") problems.push(`Amounts are in ${currency}. Convert them to rupees before filing.`);

  const breakdown = docTaxBreakdown(items, discount, rate, formula);
  const split = (taxable: number, tax: number): GstAmounts => !supply || supply.kind === "inter"
    ? { taxable: r2(taxable), igst: r2(tax), cgst: 0, sgst: 0 }
    : { taxable: r2(taxable), igst: 0, cgst: r2(tax / 2), sgst: r2(tax - r2(tax / 2)) };
  const rates = breakdown.filter((row) => row.rate > 0).map((row) => ({ rate: row.rate, ...split(row.taxable, row.tax) }));
  const nil = r2(breakdown.filter((row) => row.rate <= 0).reduce((sum, row) => sum + row.taxable, 0));

  // HSN lines: each line's share of its rate group's taxable value (discounts spread pro rata).
  const hsn: GstHsnLine[] = [];
  for (const item of items) {
    const category = item.tax_category || "S";
    const lineRate = category === "S" ? (item.tax || rate || 0) : 0;
    const group = breakdown.find((row) => row.category === category && row.rate === lineRate);
    const net = docLineAmount(item, formula);
    const taxable = group && group.net ? net * group.taxable / group.net : net;
    const code = text(item.custom?.hsn);
    if (!code && item.description.trim()) problems.push(`No HSN/SAC on "${item.description.trim().slice(0, 40)}".`);
    hsn.push({ hsn: code, description: item.description.trim(), uqc: uqcFor(item.unit), qty: Number(item.qty) || 0, rate: lineRate,
      amounts: split(taxable, taxable * lineRate / 100) });
  }

  const totals = applyRoundOff(storedDocTotals(doc.items ?? [], discount, rate, formula), !!d.round_off);
  return {
    number: doc.number, date: text(d.issue_date), party: text(d.customer_name),
    gstin: partyGstin && !gstinProblem ? partyGstin : "", supply,
    pos: !supply ? (gstState(text(d.buyer_country_subdivision))?.code ?? stateFromGstin(partyGstin)?.code ?? "")
      : supply.kind === "intra" ? supply.state.code : supply.export ? "96" : supply.placeOfSupply?.code ?? "",
    credit: isCreditNote(text(d.invoice_type_code)), value: r2(Math.abs(totals.total)), rates, nil, hsn, problems,
  };
}

/** Filed documents only: drafts and cancelled invoices stay out of a return. */
export const countsForGst = (status?: string | null) => !/^(draft|cancel+ed|void(ed)?)$/i.test((status ?? "").trim());

export interface Gstr1 {
  b2b: GstDocSummary[];
  b2cl: GstDocSummary[];
  exports: GstDocSummary[];
  b2cs: { type: "INTRA" | "INTER"; pos: string; rate: number; amounts: GstAmounts }[];
  cdnr: GstDocSummary[];
  cdnur: GstDocSummary[];
  hsn: GstHsnLine[];
  nil: number;
  problems: { number: string; problem: string }[];
}

export function buildGstr1(docs: GstDocSummary[]): Gstr1 {
  const out: Gstr1 = { b2b: [], b2cl: [], exports: [], b2cs: [], cdnr: [], cdnur: [], hsn: [], nil: 0, problems: [] };
  const b2cs = new Map<string, Gstr1["b2cs"][number]>();
  const hsn = new Map<string, GstHsnLine>();
  for (const doc of docs) {
    for (const problem of doc.problems) out.problems.push({ number: doc.number, problem });
    const sign = doc.credit ? -1 : 1;
    out.nil = r2(out.nil + sign * doc.nil);
    for (const line of doc.hsn) {
      const key = `${line.hsn}|${line.rate}|${line.uqc}`;
      const prev = hsn.get(key) ?? { ...line, qty: 0, amounts: ZERO };
      hsn.set(key, { ...prev, qty: r2(prev.qty + sign * line.qty), amounts: plus(prev.amounts, line.amounts, sign) });
    }
    if (doc.credit) { (doc.gstin ? out.cdnr : out.cdnur).push(doc); continue; }
    if (doc.gstin) { out.b2b.push(doc); continue; }
    if (doc.supply?.kind === "inter" && doc.supply.export) { out.exports.push(doc); continue; }
    if (doc.supply?.kind === "inter" && doc.value > B2CL_LIMIT) { out.b2cl.push(doc); continue; }
    for (const row of doc.rates) {
      const type = doc.supply?.kind === "inter" ? "INTER" : "INTRA";
      const key = `${type}|${doc.pos}|${row.rate}`;
      const prev = b2cs.get(key) ?? { type, pos: doc.pos, rate: row.rate, amounts: ZERO };
      b2cs.set(key, { ...prev, amounts: plus(prev.amounts, row) });
    }
  }
  out.b2cs = [...b2cs.values()].sort((a, b) => a.pos.localeCompare(b.pos) || a.rate - b.rate);
  out.hsn = [...hsn.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate);
  return out;
}

export interface Gstr3b {
  /** 3.1(a) outward taxable supplies (credit notes reduce it). */
  outward: GstAmounts;
  /** 3.1(b) zero-rated: exports. */
  zeroRated: GstAmounts;
  /** 3.1(c) nil-rated and exempt. */
  nil: number;
  /** 4(A)(5) input tax credit from purchase invoices. */
  itc: GstAmounts;
  /** Tax to pay in cash after setting the credit off, per head (never below zero). */
  payable: { igst: number; cgst: number; sgst: number };
}

export function buildGstr3b(sales: GstDocSummary[], purchases: GstDocSummary[]): Gstr3b {
  let outward = ZERO, zeroRated = ZERO, itc = ZERO, nil = 0;
  for (const doc of sales) {
    const sign = doc.credit ? -1 : 1;
    nil = r2(nil + sign * doc.nil);
    for (const row of doc.rates) {
      if (doc.supply?.kind === "inter" && doc.supply.export) zeroRated = plus(zeroRated, row, sign);
      else outward = plus(outward, row, sign);
    }
  }
  for (const doc of purchases) for (const row of doc.rates) itc = plus(itc, row, doc.credit ? -1 : 1);
  // ponytail: same-head set-off only; the IGST-first cross utilisation order is the portal's job.
  return { outward, zeroRated, nil, itc, payable: {
    igst: r2(Math.max(0, outward.igst + zeroRated.igst - itc.igst)),
    cgst: r2(Math.max(0, outward.cgst - itc.cgst)),
    sgst: r2(Math.max(0, outward.sgst - itc.sgst)),
  } };
}

const ddmmyyyy = (ymd: string) => /^\d{4}-\d{2}-\d{2}/.test(ymd) ? `${ymd.slice(8, 10)}-${ymd.slice(5, 7)}-${ymd.slice(0, 4)}` : ymd;
const items = (rates: GstDocSummary["rates"], intra = true) => rates.map((row, i) => ({
  num: i + 1, itm_det: { txval: row.taxable, rt: row.rate, iamt: row.igst, ...(intra ? { camt: row.cgst, samt: row.sgst } : {}), csamt: 0 },
}));

/** GSTR-1 in the GSTN offline-tool JSON layout (B2B, B2CL, B2CS, CDNR, HSN).
 *  Exports and CDNUR need shipping-bill details, so they are left to the portal. */
export function gstr1Json(r1: Gstr1, gstin: string, period: string) {
  const byKey = <T,>(rows: T[], key: (row: T) => string) => rows.reduce((map, row) => map.set(key(row), [...(map.get(key(row)) ?? []), row]), new Map<string, T[]>());
  return {
    gstin, fp: `${period.slice(5, 7)}${period.slice(0, 4)}`,
    b2b: [...byKey(r1.b2b, (d) => d.gstin)].map(([ctin, docs]) => ({ ctin, inv: docs.map((d) => ({
      inum: d.number, idt: ddmmyyyy(d.date), val: d.value, pos: d.pos, rchrg: "N", inv_typ: "R", itms: items(d.rates) })) })),
    b2cl: [...byKey(r1.b2cl, (d) => d.pos)].map(([pos, docs]) => ({ pos, inv: docs.map((d) => ({
      inum: d.number, idt: ddmmyyyy(d.date), val: d.value, itms: items(d.rates, false) })) })),
    b2cs: r1.b2cs.map((row) => ({ sply_ty: row.type, pos: row.pos, typ: "OE", rt: row.rate, txval: row.amounts.taxable,
      iamt: row.amounts.igst, ...(row.type === "INTRA" ? { camt: row.amounts.cgst, samt: row.amounts.sgst } : {}), csamt: 0 })),
    cdnr: [...byKey(r1.cdnr, (d) => d.gstin)].map(([ctin, docs]) => ({ ctin, nt: docs.map((d) => ({
      ntty: "C", nt_num: d.number, nt_dt: ddmmyyyy(d.date), val: d.value, pos: d.pos, rchrg: "N", inv_typ: "R", itms: items(d.rates) })) })),
    hsn: { data: r1.hsn.filter((line) => line.hsn).map((line, i) => ({
      num: i + 1, hsn_sc: line.hsn, desc: line.description.slice(0, 30), uqc: line.uqc, qty: line.qty, rt: line.rate,
      txval: line.amounts.taxable, iamt: line.amounts.igst, camt: line.amounts.cgst, samt: line.amounts.sgst, csamt: 0 })) },
  };
}

/** CMP-08: a composition dealer pays tax on its turnover each quarter, half CGST and half SGST.
 *  Exports are left out; credit notes reduce the turnover. */
export function compositionTax(sales: GstDocSummary[], rate: number) {
  const turnover = r2(sales.filter((d) => !(d.supply?.kind === "inter" && d.supply.export))
    .reduce((s, d) => s + (d.credit ? -1 : 1) * d.value, 0));
  const tax = r2(turnover * rate / 100);
  return { turnover, tax, cgst: r2(tax / 2), sgst: r2(tax - r2(tax / 2)) };
}

/** The three YYYY-MM months of the quarter holding `month` (Apr-Jun, Jul-Sep, Oct-Dec, Jan-Mar). */
export function quarterMonths(month: string): string[] {
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
  const start = m - ((m - 1) % 3);
  return [0, 1, 2].map((i) => `${y}-${String(start + i).padStart(2, "0")}`);
}