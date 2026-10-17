/* Declaration letters (UAE VAT supply declarations): the form, its standard wording and the
 * store. Shared by the Declaration Letter page and the agent's declaration tools. */
import { companyCountry } from "./companyCountry";
import { tools, type CompanyProfile } from "./api";
import { todayYmd } from "./format";
import type { StampSig } from "../components/StampSignature";

const today = () => todayYmd();
export const DECLARATION_HEADER_SPACE = 180;

/** Default body. Tokens in {curly braces} are filled from the form fields at
 *  render time, so the standard wording stays intact while the figures update
 *  live. Users can edit the wording freely; tokens they keep still resolve. */
export const DEFAULT_BODY = `This is with reference to Chapter Four Article (48) Clauses (3) & (4) of the Federal Decree - Law No. (8) of 2017 on Value Added Tax, we {company} hereby confirm that we are a Tax Registrant in the United Arab Emirates with Tax Registration Number {trn} LPO.No: {lpo} (QUANTITY OF {qty} {unit} AMOUNTING TO A SUM OF AED {amount})

We confirm that any crude or refined oil, unprocessed or processed natural gas, or any hydrocarbons supplied by you to us; our intention is to resell these crude or refined oil, unprocessed or processed natural gas, or any hydrocarbons or use these goods to produce or distribute any form of energy. You shall not charge VAT on the invoices raised on us in respect of such supplies.

We also confirm that we shall be responsible to the Federal Tax Authority of United Arab Emirates for calculating the Due Tax and shall be responsible for all applicable Tax obligations in respect of such supplies.

A copy of the Certificate of Registration for Value Added Tax in the United Arab Emirates is enclosed herewith for your perusal.`;

export type DeclForm = {
  country_code?: string;
  currency?: string;
  title?: string;
  ref: string;
  show_stamp?: boolean;
  show_signature?: boolean;
  use_letterhead?: boolean;
  header_space?: number;
  footer_space?: number;
  /** Per-letter stamp/signature copy (position, opacity, crop) seeded from the company asset. */
  stamp?: StampSig;
  signature?: StampSig;
  date: string;
  company_name: string;
  company_trn: string;
  recipient_name: string;
  recipient_location: string;
  recipient_trn: string;
  lpo_ref: string;
  qty: string;
  unit: string;
  amount: string;
  body: string;
};

/** A persisted declaration letter — the form plus list metadata. */
export interface SavedDecl extends DeclForm {
  id: string;
  updated_at: string;
}

export const letterName = (letter: Pick<DeclForm, "title">) =>
  letter.title?.trim() || "DECLARATION LETTER";

export function blankDecl(company?: CompanyProfile | null): DeclForm {
  const country = company ? companyCountry(company) : "";
  return {
    country_code: country || undefined,
    currency: company?.currency || "AED",
    title: "DECLARATION LETTER",
    header_space: DECLARATION_HEADER_SPACE,
    ref: "",
    date: today(),
    company_name: company?.name || "Your Company",
    company_trn: company?.trn || "",
    recipient_name: "",
    recipient_location: "",
    recipient_trn: "",
    lpo_ref: "",
    qty: "",
    unit: "MT",
    amount: "",
    body: country && country !== "AE" ? "We, {company}, confirm the following details for {recipient}.\n\nReference: {lpo}\nQuantity: {qty} {unit}\nAmount: {currency} {amount}\n\n[Enter the purpose of this declaration and the statements you wish to confirm.]" : DEFAULT_BODY,
  };
}

/* ----------------------------- store ----------------------------- */
/* Declaration letters have no dedicated table — they're low-volume and
 * simple, so we persist the list as a single JSON app-setting (same
 * cross-device pattern as bank details / letterhead, no DB migration). */

export const STORE_KEY = "declaration_letters";

export async function listDeclarations(): Promise<SavedDecl[]> {
  const rows = await tools.settings();
  const row = rows.find((r) => r.key === STORE_KEY);
  if (!row) return [];
  const arr: unknown = JSON.parse(row.value);
  if (!Array.isArray(arr) || !arr.every((d) => d && typeof d === "object" && typeof d.id === "string" && typeof d.body === "string")) {
    throw new Error("Saved declaration letters could not be read. Restore a valid backup before making changes.");
  }
  return arr as SavedDecl[];
}

export async function upsertDeclaration(doc: SavedDecl): Promise<SavedDecl[]> {
  const list = await listDeclarations();
  const next = [doc, ...list.filter((d) => d.id !== doc.id)];
  await tools.setSetting(STORE_KEY, JSON.stringify(next));
  return next;
}

export async function removeDeclarations(ids: Set<string>): Promise<SavedDecl[]> {
  const list = await listDeclarations();
  const next = list.filter((d) => !ids.has(d.id));
  await tools.setSetting(STORE_KEY, JSON.stringify(next));
  return next;
}

export const newId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : String(Date.now());
