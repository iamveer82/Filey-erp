/* E-way bill JSON for the NIC portal's bulk upload (ewaybillgst.gov.in → Generate Bulk).
 *
 * Field layout follows the portal's bulk schema as used by Free-GST-Billing-Software
 * (MIT, github.com/IamRamgarhia/Free-GST-Billing-Software). An e-way bill is needed
 * to move goods worth more than Rs 50,000. */
import type { InvoiceDoc } from "./api";
import { gstState, stateFromGstin } from "./gst";
import { summarizeGstDoc } from "./gstReturns";

export const EWAY_LIMIT = 50000;

export const TRANSPORT_MODES = [
  { value: "1", label: "Road" },
  { value: "2", label: "Rail" },
  { value: "3", label: "Air" },
  { value: "4", label: "Ship" },
] as const;

export interface EwayTransport {
  mode: "1" | "2" | "3" | "4";
  /** Approximate distance in km; the portal checks it against the PIN codes. */
  distance: number;
  vehicleNo: string;
  transporterId: string;
  transporterName: string;
  /** Railway receipt, airway bill or bill of lading for rail, air and ship. */
  docNo: string;
  docDate: string;
  fromPincode: string;
  toPincode: string;
}

/** The first Indian PIN code (6 digits, not starting with 0) in an address. */
export const pincodeFrom = (address?: string | null) => (address ?? "").match(/\b[1-9]\d{5}\b/)?.[0] ?? "";

const ddmmyyyy = (ymd: string) => /^\d{4}-\d{2}-\d{2}/.test(ymd) ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : ymd;
const lines = (address?: string | null) => (address ?? "").split(/\n|,\s*/).map((s) => s.trim()).filter(Boolean);

/** What is missing before the portal will take the file. */
export function ewayProblems(doc: InvoiceDoc, t: EwayTransport): string[] {
  const d = doc as InvoiceDoc & Record<string, unknown>;
  const out: string[] = [];
  if (!String(d.seller_trn ?? "").trim()) out.push("Your GSTIN is missing (Company details).");
  if (!/^\d{6}$/.test(t.fromPincode)) out.push("Enter the dispatch PIN code (6 digits).");
  if (!/^\d{6}$/.test(t.toPincode)) out.push("Enter the delivery PIN code (6 digits).");
  if (!(t.distance > 0) || t.distance > 4000) out.push("Enter the distance in km (1 to 4000).");
  if (t.mode === "1" && !/^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/.test(t.vehicleNo.replace(/[\s-]/g, "").toUpperCase()) && !t.transporterId.trim())
    out.push("For road, enter the vehicle number (like MH01AB1234), or a transporter ID to let them add it.");
  if (t.mode !== "1" && !t.docNo.trim()) out.push("For rail, air or ship, enter the transport document number.");
  if ((doc.items ?? []).some((item) => item.description?.trim() && !String(item.custom?.hsn ?? "").trim())) out.push("Every line needs its HSN code.");
  return out;
}

export function ewayBillJson(doc: InvoiceDoc, t: EwayTransport) {
  const d = doc as InvoiceDoc & Record<string, unknown>;
  const text = (v: unknown) => typeof v === "string" ? v.trim() : "";
  const sellerGstin = text(d.seller_trn).toUpperCase();
  const buyerGstin = text(d.customer_trn).toUpperCase();
  const g = summarizeGstDoc(doc, { country_subdivision: text(d.seller_country_subdivision), trn: sellerGstin });
  const fromState = Number(gstState(text(d.seller_country_subdivision))?.code ?? stateFromGstin(sellerGstin)?.code ?? 0);
  const exported = g.supply?.kind === "inter" && g.supply.export;
  const toState = exported ? 99 : Number(g.pos || stateFromGstin(buyerGstin)?.code || 0);
  const sum = (key: "taxable" | "igst" | "cgst" | "sgst") => Math.round(g.rates.reduce((s, r) => s + r[key], 0) * 100) / 100;
  const from = lines(text(d.seller_address)), to = lines(text(d.customer_address));
  const road = t.mode === "1";
  return {
    version: "1.0.0621",
    billLists: [{
      userGstin: sellerGstin, supplyType: "O", subSupplyType: exported ? 3 : 1, subSupplyDesc: "",
      docType: "INV", docNo: doc.number, docDate: ddmmyyyy(text(d.issue_date)), transType: 1,
      fromGstin: sellerGstin, fromTrdName: text(d.seller_name), fromAddr1: from[0] ?? "", fromAddr2: from.slice(1).join(", ").slice(0, 120),
      fromPlace: text(d.seller_city) || from[from.length - 1] || "", fromPincode: Number(t.fromPincode), fromStateCode: fromState, actualFromStateCode: fromState,
      toGstin: buyerGstin && g.gstin ? buyerGstin : "URP", toTrdName: text(d.customer_name), toAddr1: to[0] ?? "", toAddr2: to.slice(1).join(", ").slice(0, 120),
      toPlace: text(d.buyer_city) || to[to.length - 1] || "", toPincode: Number(t.toPincode), toStateCode: toState, actualToStateCode: toState,
      totalValue: Math.round((sum("taxable") + g.nil) * 100) / 100, cgstValue: sum("cgst"), sgstValue: sum("sgst"), igstValue: sum("igst"),
      cessValue: 0, cessNonAdvolValue: 0, OthValue: 0, totInvValue: g.value,
      transMode: Number(t.mode), transDistance: String(Math.round(t.distance)),
      transporterId: t.transporterId.trim().toUpperCase(), transporterName: t.transporterName.trim(),
      transDocNo: road ? "" : t.docNo.trim(), transDocDate: road ? "" : ddmmyyyy(t.docDate),
      vehicleNo: road ? t.vehicleNo.replace(/[\s-]/g, "").toUpperCase() : "", vehicleType: road ? "R" : "",
      itemList: g.hsn.filter((line) => line.description).map((line, i) => {
        const intra = g.supply?.kind === "intra";
        return {
          itemNo: i + 1, productName: line.description.slice(0, 100), productDesc: line.description.slice(0, 100),
          hsnCode: Number(line.hsn) || line.hsn, quantity: line.qty, qtyUnit: line.uqc, taxableAmount: line.amounts.taxable,
          cgstRate: intra ? line.rate / 2 : 0, sgstRate: intra ? line.rate / 2 : 0, igstRate: intra ? 0 : line.rate, cessRate: 0, cessNonAdvol: 0,
        };
      }),
    }],
  };
}
