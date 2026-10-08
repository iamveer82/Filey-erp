import type { Ctx } from "./client.js";

type Row = Record<string, any>;
export type DraftKind = "invoice" | "quote" | "purchase_order";
const text = (value: unknown): string => typeof value === "string" ? value : "";
const normalized = (value: unknown) => text(value).trim().toLowerCase();
const object = (value: unknown): Row => {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
};

/** Same identity whitelist as readEInvoiceParty; never copy arbitrary preset JSON. */
function identity(value: unknown): Record<string, string> {
  const source = object(value);
  return Object.fromEntries(["corporate_trn", "tin", "endpoint_id", "endpoint_scheme", "legal_id",
    "legal_id_type", "legal_authority", "identifier", "phone"]
    .filter(key => typeof source[key] === "string").map(key => [key, source[key]]));
}

async function matchingParty(ctx: Ctx, kind: DraftKind, name: string): Promise<Row> {
  const table = kind === "purchase_order" ? "suppliers" : "crm_customers";
  const fields = table === "suppliers" ? ["name"] : ["name", "company"];
  // Separate column queries avoid constructing a PostgREST or() expression from
  // user text. Escape LIKE metacharacters in cloud queries; local rows are
  // already filtered by the adapter's ownership boundary, then matched exactly.
  const results = await Promise.all(fields.map(async field => {
    let query = ctx.supabase.from(table).select("*").eq("org_id", ctx.orgId);
    if (!ctx.local) query = query.ilike(field, name.trim().replace(/[\\%_]/g, "\\$&")).limit(2);
    const { data, error } = await query;
    if (error) throw new Error(`Saved ${table === "suppliers" ? "supplier" : "customer"} details could not be loaded: ${error.message}`);
    return (data ?? []).filter(row => (row.org_id === ctx.orgId || ctx.local && row.org_id == null) && normalized(row[field]) === normalized(name));
  }));
  const matches = [...new Map(results.flat().map(row => [row.id, row])).values()];
  if (matches.length > 1) throw new Error(`Multiple ${table === "suppliers" ? "suppliers" : "customers"} match this name. Choose a unique name in Filey before creating the draft.`);
  return matches[0] ?? {};
}

/** Read snapshots before allocation. Failed/ambiguous presets must not consume a number. */
export async function loadDraftPresets(ctx: Ctx, kind: DraftKind, name: string, overrides: { currency?: string; tax_rate?: number } = {}) {
  const settingKey = `${kind}_number_format`;
  const [companyResult, settingsResult, party] = await Promise.all([
    ctx.supabase.from("company_profile").select("*").eq("org_id", ctx.orgId).limit(2),
    (() => {
      let query = ctx.supabase.from("app_settings").select("id,user_id,org_id,key,value").eq("org_id", ctx.orgId).eq("key", settingKey);
      if (!ctx.local) query = query.eq("user_id", ctx.userId);
      return query;
    })(),
    matchingParty(ctx, kind, name),
  ]);
  if (companyResult.error || settingsResult.error) throw new Error(`Saved company or numbering settings could not be loaded: ${companyResult.error?.message ?? settingsResult.error?.message}`);
  const scoped = (row: Row) => row.org_id === ctx.orgId || ctx.local && row.org_id == null;
  const companies = (companyResult.data ?? []).filter(scoped);
  if (companies.length > 1) throw new Error("Multiple company profiles require review in Filey before creating a draft.");
  const company = companies[0] ?? {};
  const settings = (settingsResult.data ?? []).filter(row => scoped(row) && (row.user_id === ctx.userId || ctx.local && row.user_id == null));
  const owned = settings.filter(row => row.user_id === ctx.userId);
  const applicable = owned.length ? owned : settings;
  if (applicable.length > 1) throw new Error("Multiple saved number formats require review in Filey before creating a draft.");
  const saved = text(applicable[0]?.value);
  const pattern = /\{\d+\}/.test(saved) ? saved : `${kind === "invoice" ? "INV" : kind === "quote" ? "QT" : "PO"}-{YYYY}-{0001}`;
  const currency = (overrides.currency ?? (text(company.currency).trim() || "AED")).toUpperCase();
  // Company registration controls tax independently of an explicit document
  // currency. Numeric-string presets occur in old local caches. For countries
  // without a saved rate, ask for one instead of guessing UAE VAT.
  const country = text(company.country_code).trim().toUpperCase();
  const companyCurrency = text(company.currency).trim().toUpperCase() || "AED";
  const savedRate = company.default_tax_rate;
  if (savedRate != null && typeof savedRate !== "number" &&
      !(typeof savedRate === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(savedRate.trim())))
    throw new Error("The saved company tax rate is invalid. Review it in Filey before creating the draft.");
  const defaultRate = company.default_tax_rate == null
    ? country === "AE" || !country && companyCurrency === "AED" ? 5 : undefined
    : Number(company.default_tax_rate);
  const taxRate = overrides.tax_rate ?? (company.tax_type === "None" ? 0 : defaultRate);
  if (taxRate === undefined) throw new Error("Set the company tax rate in Filey or provide an explicit tax_rate before creating the draft.");
  if (!/^[A-Z]{3}$/.test(currency) || typeof taxRate !== "number" || !Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100 || Math.abs(taxRate * 1000 - Math.round(taxRate * 1000)) > 1e-7)
    throw new Error("Review the currency and tax rate in Filey. Use a three-letter currency and a tax rate from 0 to 100 with at most three decimals.");

  const seller = identity(company.einvoice);
  const legalId = text(company.legal_id).trim() ? company.legal_id : seller.legal_id;
  const legalType = text(company.legal_id_type).trim() ? company.legal_id_type : seller.legal_id_type;
  const buyer = identity(object(party.custom_fields).einvoice_identity);
  const phone = text(party.phone).trim() ? party.phone : party.phone_e164;
  if (typeof phone === "string") buyer.phone = phone;
  const header: Row = {
    currency, tax_rate: taxRate, tax_country_code: company.country_code,
    seller_name: company.name ?? "", seller_address: company.address, seller_trn: text(company.trn).trim() ? company.trn : company.vat_number,
    seller_email: company.email, seller_phone: company.phone,
    template: text(company.default_template).trim() || "minimal", accent: text(company.default_accent).trim() || "#222222", logo: company.logo,
  };
  if (kind === "purchase_order") Object.assign(header, {
    supplier_id: party.id ?? null, supplier_address: party.address, supplier_trn: party.tax_id,
    supplier_email: party.email, supplier_phone: party.phone,
  });
  else Object.assign(header, {
    customer_id: party.id ?? null, customer_address: party.address, customer_trn: party.trn, customer_email: party.email,
  });
  if (kind === "invoice") Object.assign(header, {
    seller_city: company.city, seller_country_subdivision: company.country_subdivision,
    seller_legal_id: legalId, seller_legal_id_type: legalType, tax_country_code: company.country_code,
    buyer_city: party.city, buyer_country_subdivision: party.country_subdivision, buyer_country_code: party.country_code,
    einvoice: { uuid: crypto.randomUUID(), seller: { ...seller, legal_id: legalId, legal_id_type: legalType }, buyer },
  });
  // JSON serialization also drops undefined cloud columns. Do the same locally
  // without copying unsupplied fields or preset references into the document.
  return { pattern, header: JSON.parse(JSON.stringify(header)) as Row, taxRate };
}
