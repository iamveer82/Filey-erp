/* India GST: state codes, GSTIN checks and the CGST/SGST/IGST split.
 *
 * The rules follow Free-GST-Billing-Software by IamRamgarhia (MIT,
 * github.com/IamRamgarhia/Free-GST-Billing-Software) and the GST law it cites:
 * intra-state supply = CGST + SGST (CGST + UTGST in a Union territory without a
 * legislature), inter-state supply or export = IGST. */

export interface GstState {
  code: string;
  name: string;
  /** Union territory without a legislature: intra-state tax is CGST + UTGST. */
  utgst?: boolean;
}

export const GST_STATES: GstState[] = [
  { code: "01", name: "Jammu and Kashmir" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh", utgst: true },
  { code: "05", name: "Uttarakhand" },
  { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" },
  { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" },
  { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" },
  { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" },
  { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "24", name: "Gujarat" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu", utgst: true },
  { code: "27", name: "Maharashtra" },
  { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" },
  { code: "31", name: "Lakshadweep", utgst: true },
  { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman and Nicobar Islands", utgst: true },
  { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh", utgst: true },
  { code: "97", name: "Other Territory" },
];

/** Options for a state picker; the saved value is the state name. */
export const GST_STATE_OPTIONS = GST_STATES.map((s) => ({ value: s.name, label: `${s.name} (${s.code})` }));

const squash = (v: string) => v.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
/** Old names people still type. */
const OLD_NAMES: Record<string, string> = {
  orissa: "21", pondicherry: "34", newdelhi: "07", nctofdelhi: "07", uttaranchal: "05", damananddiu: "26", dadraandnagarhaveli: "26",
};

/** The state a saved value names: a state name, "27", "27-Maharashtra" or "IN-27". */
export function gstState(value?: string | null): GstState | undefined {
  const v = (value ?? "").trim();
  if (!v) return undefined;
  const code = v.match(/^(?:IN-)?(\d{2})\b/i)?.[1] ?? OLD_NAMES[squash(v)];
  return GST_STATES.find((s) => s.code === code || squash(s.name) === squash(v));
}

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** True when the 15th character matches the check digit the GSTIN carries. */
export function gstinChecksumOk(gstin: string): boolean {
  const g = gstin.trim().toUpperCase();
  if (!GSTIN.test(g)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = CHARS.indexOf(g[i]) * (i % 2 ? 2 : 1);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36] === g[14];
}

/** "" when fine, else what is wrong. A mistyped GSTIN fails its check digit. */
export function gstinError(gstin?: string | null): string {
  const g = (gstin ?? "").trim().toUpperCase();
  if (!g) return "";
  if (!GSTIN.test(g)) return "GSTIN must be 15 characters in the Indian GSTIN format.";
  if (!GST_STATES.some((s) => s.code === g.slice(0, 2))) return "The first two digits of this GSTIN are not a GST state code.";
  if (!gstinChecksumOk(g)) return "This GSTIN fails its check digit. Check it for a typing mistake.";
  return "";
}

/** The state a valid GSTIN is registered in (its first two digits). */
export function stateFromGstin(gstin?: string | null): GstState | undefined {
  const g = (gstin ?? "").trim().toUpperCase();
  return GSTIN.test(g) ? GST_STATES.find((s) => s.code === g.slice(0, 2)) : undefined;
}

/** A typed GSTIN fills the party's state (and country) while the state is still empty. */
export function fillStateFromGstin<T extends { trn: string; country_code: string; country_subdivision: string }>(f: T): T {
  const state = stateFromGstin(f.trn);
  if (!state || (f.country_code && f.country_code !== "IN") || f.country_subdivision) return f;
  return { ...f, country_code: "IN", country_subdivision: state.name };
}

export interface GstParties {
  taxCountry?: string | null;
  sellerState?: string | null;
  sellerGstin?: string | null;
  /** Place of supply: the buyer's state as chosen on the document. */
  buyerState?: string | null;
  buyerGstin?: string | null;
  buyerCountry?: string | null;
}

export type GstSupply =
  | { kind: "intra"; state: GstState; utgst: boolean }
  | { kind: "inter"; placeOfSupply?: GstState; export: boolean };

/** Intra-state or inter-state, or undefined when the states are not known yet. */
export function gstSupply(p: GstParties): GstSupply | undefined {
  if ((p.taxCountry ?? "").toUpperCase() !== "IN") return undefined;
  const buyerCountry = (p.buyerCountry ?? "").toUpperCase();
  if (buyerCountry && buyerCountry !== "IN") return { kind: "inter", export: true };
  const seller = gstState(p.sellerState) ?? stateFromGstin(p.sellerGstin);
  const buyer = gstState(p.buyerState) ?? stateFromGstin(p.buyerGstin);
  if (!seller || !buyer) return undefined;
  return seller.code === buyer.code
    ? { kind: "intra", state: seller, utgst: !!seller.utgst }
    : { kind: "inter", placeOfSupply: buyer, export: false };
}

export interface TaxRow {
  label: string;
  amount: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (n: number) => `${Number(n.toFixed(3))}%`;

/** How the tax line prints: one row, or CGST + SGST/UTGST halves, or IGST. */
export function gstTaxRows(tax: number, rate: number, supply: GstSupply | undefined, label = "GST"): TaxRow[] {
  if (!supply) return [{ label: `${label} (${pct(rate)})`, amount: tax }];
  if (supply.kind === "inter") return [{ label: `IGST (${pct(rate)})`, amount: tax }];
  const cgst = round2(tax / 2);
  return [
    { label: `CGST (${pct(rate / 2)})`, amount: cgst },
    { label: `${supply.utgst ? "UTGST" : "SGST"} (${pct(rate / 2)})`, amount: round2(tax - cgst) },
  ];
}

/** "Maharashtra (27)" for the Place of supply line. */
export const placeOfSupplyLabel = (supply: GstSupply | undefined): string =>
  !supply ? "" : supply.kind === "intra" ? `${supply.state.name} (${supply.state.code})`
    : supply.export ? "Outside India (96)" : supply.placeOfSupply ? `${supply.placeOfSupply.name} (${supply.placeOfSupply.code})` : "";

const isExport = (supply: GstSupply | undefined) => supply?.kind === "inter" && supply.export;

/** Rule 49: a domestic supply with no tax (exempt or nil-rated goods, or a composition
 *  dealer) goes out on a Bill of Supply, not a Tax Invoice. A title the user typed stays. */
export function gstDocTitle(title: string | null | undefined, supply: GstSupply | undefined, tax: number, credit: boolean): string {
  const t = (title ?? "").trim();
  if (credit || isExport(supply) || Math.abs(tax) >= 0.005 || !/^(tax invoice|invoice)?$/i.test(t)) return t;
  return "Bill of Supply";
}

/** Rule 46 endorsement printed on an export invoice. */
export const gstEndorsement = (supply: GstSupply | undefined, tax: number): string =>
  !isExport(supply) ? "" : Math.abs(tax) >= 0.005 ? "Supply meant for export on payment of IGST"
    : "Supply meant for export under bond or letter of undertaking without payment of IGST";

export const COMPOSITION_DECLARATION = "Composition taxable person, not eligible to collect tax on supplies.";
