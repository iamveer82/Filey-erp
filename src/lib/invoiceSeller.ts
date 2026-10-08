import type { CompanyProfile, InvoiceDoc } from "./api";
import { partyTin, readEInvoiceParty, type EInvoiceParty } from "./einvoice";

const SELLER_FIELDS = ["seller_name", "seller_address", "seller_trn", "seller_email", "seller_phone", "seller_city",
  "seller_country_subdivision", "seller_legal_id", "seller_legal_id_type", "tax_country_code"] as const;
type SellerField = typeof SELLER_FIELDS[number];
type SellerDocument = Pick<InvoiceDoc, "status" | "seller_name" | "einvoice"> & { [K in SellerField]?: string | null } & { logo?: string | null; tax_rate?: number };
const text = (value: unknown): string => typeof value === "string" ? value : "";
const normalize = (value: unknown) => text(value).trim().toLowerCase();

/** A new document gets its own company snapshot, never a live profile reference. */
export function companyInvoiceSeller(company: CompanyProfile) {
  const seller = readEInvoiceParty(JSON.stringify(company.einvoice ?? {}));
  const legalId = text(company.legal_id).trim() ? company.legal_id : seller.legal_id;
  const legalType = text(company.legal_id_type).trim() ? company.legal_id_type : seller.legal_id_type;
  return {
    seller_name: company.name,
    seller_address: company.address,
    seller_trn: text(company.trn).trim() ? company.trn : company.vat_number,
    seller_email: company.email,
    seller_phone: company.phone,
    seller_city: company.city,
    seller_country_subdivision: company.country_subdivision,
    seller_legal_id: legalId,
    seller_legal_id_type: legalType,
    tax_country_code: company.country_code,
    einvoice: { seller: { ...seller, legal_id: legalId, legal_id_type: legalType } },
  };
}

export function invoiceSellerMatchesCompany(doc: SellerDocument, company: CompanyProfile): boolean {
  const source = companyInvoiceSeller(company);
  const currentTrn = normalize(doc.seller_trn), sourceTrn = normalize(source.seller_trn);
  const name = normalize(doc.seller_name), sourceName = normalize(source.seller_name);
  const tin = partyTin(doc.einvoice?.seller), sourceTin = partyTin(source.einvoice.seller);
  if (currentTrn && sourceTrn && currentTrn !== sourceTrn || name && sourceName && name !== sourceName || tin && sourceTin && tin !== sourceTin) return false;
  return !!(name && sourceName || currentTrn && sourceTrn || tin && sourceTin) || !name && !currentTrn && !tin;
}

/** Explicit draft action: keep manual values, buyer details and saved metadata. */
export function fillMissingInvoiceSeller<T extends SellerDocument>(doc: T, company: CompanyProfile): T {
  if (doc.status !== "draft") throw new Error("Saved company details can only be applied to a draft invoice.");
  if (!invoiceSellerMatchesCompany(doc, company)) throw new Error("This invoice names a different seller. Review its seller details manually.");
  const preset = companyInvoiceSeller(company);
  const next = { ...doc };
  if (!text(next.seller_legal_id).trim() && text(doc.einvoice?.seller?.legal_id).trim()) next.seller_legal_id = doc.einvoice!.seller!.legal_id;
  if (!text(next.seller_legal_id_type).trim() && text(doc.einvoice?.seller?.legal_id_type).trim()) next.seller_legal_id_type = doc.einvoice!.seller!.legal_id_type;
  for (const key of SELLER_FIELDS) if (!text(next[key]).trim() && text(preset[key]).trim()) next[key] = preset[key]!;
  const seller: EInvoiceParty = { ...doc.einvoice?.seller };
  for (const key of Object.keys(preset.einvoice.seller) as (keyof EInvoiceParty)[]) {
    if (!text(seller[key]).trim() && text(preset.einvoice.seller[key]).trim()) seller[key] = preset.einvoice.seller[key];
  }
  // Both representations describe one registration, so do not introduce a
  // conflicting preset ID when a manual top-level registration is already set.
  seller.legal_id = next.seller_legal_id ?? seller.legal_id;
  seller.legal_id_type = next.seller_legal_id_type ?? seller.legal_id_type;
  return { ...next, einvoice: { ...doc.einvoice, seller } };
}

/** Company-modal edits update only still-linked draft defaults, never issued
 * snapshots or fields the user changed directly on the document. */
export function syncInvoiceSellerPreset<T extends SellerDocument>(doc: T, previous: CompanyProfile, company: CompanyProfile): T {
  if (doc.status !== "draft" || !invoiceSellerMatchesCompany(doc, previous)) return doc;
  const before = companyInvoiceSeller(previous), after = companyInvoiceSeller(company), next = { ...doc };
  for (const key of SELLER_FIELDS) if (doc[key] === before[key]) next[key] = after[key]!;
  const seller = { ...doc.einvoice?.seller };
  const keys = new Set([...Object.keys(before.einvoice.seller), ...Object.keys(after.einvoice.seller)] as (keyof EInvoiceParty)[]);
  for (const key of keys) if (seller[key] === before.einvoice.seller[key]) seller[key] = after.einvoice.seller[key];
  seller.legal_id = next.seller_legal_id ?? seller.legal_id;
  seller.legal_id_type = next.seller_legal_id_type ?? seller.legal_id_type;
  if (doc.logo === previous.logo) next.logo = company.logo;
  if (doc.tax_rate === previous.default_tax_rate) next.tax_rate = company.default_tax_rate;
  return { ...next, einvoice: { ...doc.einvoice, seller } };
}
