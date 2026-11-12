/* A product's editable fields and how they save. Existing stock changes only through
 * Stocktake or Batches; internal custom-field keys (__batches) are carried through untouched. */
import { erp, type Product } from "./api";
import { batchFields, expiryFrom } from "./batches";

/** Custom-field keys with their own inputs, so they are not listed again as custom fields. */
export const OWN_KEYS = new Set(["purchase_date", "mrp", "hsn"]);

export const blankProduct = {
  sku: "", name: "", category: "", unit: "", description: "",
  unit_price: 0, cost_price: 0, mrp: 0, hsn: "",
  quantity: 0, reorder_level: 0, warehouse: "",
  barcode: "", supplier_id: "",
  batch_number: "", expiry_date: "", purchase_date: "",
  // Opening batch, new products only.
  obNo: "", obExp: "", obMfg: "", obMrp: 0,
  is_serialized: false,
};
export type ProductForm = typeof blankProduct;
export interface CustomField { key: string; value: string }

export function formFromProduct(product: Product): { form: ProductForm; custom: CustomField[] } {
  const cf = product.custom_fields ?? {};
  return {
    form: {
      ...blankProduct,
      sku: product.sku ?? "", name: product.name ?? "", category: product.category ?? "", unit: product.unit ?? "",
      description: product.description ?? "", unit_price: product.unit_price ?? 0, cost_price: product.cost_price ?? 0,
      mrp: Number(cf.mrp) || 0, hsn: String(cf.hsn ?? ""), quantity: product.quantity ?? 0, reorder_level: product.reorder_level ?? 0,
      warehouse: product.warehouse ?? "", barcode: product.barcode ?? "", supplier_id: product.supplier_id ? String(product.supplier_id) : "",
      batch_number: product.batch_number ?? "", expiry_date: product.expiry_date ?? "", purchase_date: String(cf.purchase_date ?? ""),
      is_serialized: product.is_serialized ?? false,
    },
    custom: Object.entries(cf).filter(([k]) => !OWN_KEYS.has(k) && !k.startsWith("__")).map(([key, value]) => ({ key, value: String(value) })),
  };
}

/** "Paracetamol 500mg Strip" → "PARA-500-STRI": a readable SKU to start from. */
export function skuFromName(name: string, taken: Iterable<string> = []): string {
  const parts = name.toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").split(/\s+/).filter(Boolean).slice(0, 3).map((w) => /^\d/.test(w) ? w.replace(/\D.*$/, "") || w : w.slice(0, 4));
  const base = parts.join("-") || "ITEM";
  const used = new Set([...taken].map((s) => s.toUpperCase()));
  if (!used.has(base)) return base;
  for (let i = 2; i < 1000; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now() % 10000}`;
}

export interface ProductCheck { name?: string; sku?: string; barcode?: string; batch?: string }

/** What blocks saving. `others` are the rest of the catalogue, for duplicate SKUs and barcodes. */
export function checkProduct(f: ProductForm, isNew: boolean, others: Product[]): ProductCheck {
  const out: ProductCheck = {};
  if (!f.name.trim()) out.name = "Name is required.";
  if (!f.sku.trim()) out.sku = "SKU is required.";
  else if (others.some((p) => p.sku.trim().toUpperCase() === f.sku.trim().toUpperCase())) out.sku = "Another product already uses this SKU.";
  const code = f.barcode.trim();
  const clash = code && others.find((p) => (p.barcode ?? "").trim() === code);
  if (clash) out.barcode = `Already on ${clash.name}.`;
  if (isNew && (f.obNo.trim() || f.obExp.trim())) {
    if (!f.obNo.trim()) out.batch = "Enter the batch number.";
    else if (!expiryFrom(f.obExp)) out.batch = "Use MM/YY or YYYY-MM-DD for the expiry.";
    else if (!(f.quantity > 0)) out.batch = "Enter the opening quantity for this batch.";
  }
  return out;
}

/** Create or update the product. Returns its id. */
export async function saveProduct(f: ProductForm, custom: CustomField[], product: Product | null, today: string): Promise<number> {
  const cf: Record<string, string> = Object.fromEntries(custom.filter((c) => c.key.trim()).map((c) => [c.key.trim(), c.value]));
  if (f.purchase_date) cf.purchase_date = f.purchase_date;
  if (f.mrp > 0) cf.mrp = String(f.mrp);
  if (f.hsn.trim()) cf.hsn = f.hsn.trim();
  for (const [key, value] of Object.entries(product?.custom_fields ?? {})) if (key.startsWith("__")) cf[key] = String(value);
  const base = {
    sku: f.sku.trim(), name: f.name.trim(), category: f.category.trim() || undefined, unit: f.unit.trim() || undefined,
    description: f.description, unit_price: f.unit_price, cost_price: f.cost_price, reorder_level: f.reorder_level,
    warehouse: f.warehouse.trim() || undefined, barcode: f.barcode.trim() || undefined, is_serialized: f.is_serialized,
    supplier_id: f.supplier_id ? Number(f.supplier_id) : undefined,
    batch_number: f.batch_number || undefined, expiry_date: f.expiry_date || undefined,
  };
  if (product) {
    // Existing stock changes through Stocktake, which checks concurrent changes.
    await erp.updateProduct(product.id, { ...base, custom_fields: cf } as Partial<Omit<Product, "id" | "created_at">>);
    return product.id;
  }
  const obExp = expiryFrom(f.obExp);
  const batch = f.obNo.trim() && obExp
    ? batchFields({ custom_fields: cf }, [{ no: f.obNo.trim().toUpperCase(), exp: obExp, qty: f.quantity, received: today,
        ...(f.obMfg ? { mfg: f.obMfg } : {}), ...(f.obMrp > 0 ? { mrp: f.obMrp } : {}) }], f.quantity, today)
    : { custom_fields: cf };
  return erp.createProduct({ ...base, ...batch, quantity: f.quantity,
    custom_fields: Object.keys(batch.custom_fields ?? {}).length ? batch.custom_fields : undefined } as Omit<Product, "id" | "created_at">);
}
