import { normalizeEmirate, readEInvoiceParty } from "./einvoice";

/** Supplier metadata uses the same string-valued identity convention as
 * customers. Old local rows and imported JSON may not have that shape. */
export function supplierCustomFields(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => typeof entry === "string"));
}

export function supplierInvoiceDetails(value: unknown) {
  const fields = supplierCustomFields(value);
  const country_code = fields.country_code?.trim() || "";
  return {
    city: fields.city?.trim() || "",
    country_code,
    country_subdivision: country_code === "AE" ? normalizeEmirate(fields.country_subdivision) : fields.country_subdivision?.trim() || "",
    identity: readEInvoiceParty(fields.einvoice_identity),
  };
}
