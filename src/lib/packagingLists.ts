import type { StampSig } from "../components/StampSignature";
import { getCacheScope } from "./api";
import { assertWorkspaceCurrent, effectiveDataMode } from "./dataMode";
import { todayYmd } from "./format";
import { withLocalTransaction } from "./localdb";
import { requireModuleAccess } from "./moduleAccess";
import { notifyDataChanged } from "./realtime";
import { sb, supabase } from "./supabase";

export interface PackagingItem {
  id: string;
  description: string;
  qty: number;
  unit: string;
  package_type: string;
  package_count: number | null;
  /** Weight of one item; totals multiply by qty. Package count is per line. */
  net_weight: number | null;
  gross_weight: number | null;
}

export type PackagingStatus = "draft" | "issued" | "dispatched" | "cancelled";
export interface PackagingForm {
  number: string;
  issue_date: string;
  status: PackagingStatus;
  template: string;
  accent: string;
  font: string;
  company_name: string;
  company_address: string;
  company_trn: string;
  company_phone: string;
  company_email: string;
  company_logo: string;
  recipient_name: string;
  recipient_address: string;
  recipient_email: string;
  recipient_phone: string;
  shipping_address: string;
  invoice_id: number | null;
  invoice_reference: string;
  customer_id: number | null;
  order_reference: string;
  dispatch_date: string;
  carrier: string;
  tracking_number: string;
  notes: string;
  prepared_by: string;
  weight_unit: "kg" | "lb";
  show_net_weight: boolean;
  show_gross_weight: boolean;
  show_packages: boolean;
  show_logo: boolean;
  show_stamp: boolean;
  show_signature: boolean;
  stamp?: StampSig;
  signature?: StampSig;
  items: PackagingItem[];
}

export interface PackagingRecord {
  id: string;
  revision: number;
  created_at: string;
  updated_at: string;
  form: PackagingForm;
}

export const PACKAGING_SETTING_KEY = "packaging_lists";
let writes: Promise<unknown> = Promise.resolve();

export function blankPackagingForm(number: string): PackagingForm {
  return {
    number, issue_date: todayYmd(), status: "draft", template: "packing-minimal",
    accent: "#222222", font: "'Plus Jakarta Sans', system-ui, sans-serif",
    company_name: "", company_address: "", company_trn: "", company_phone: "", company_email: "", company_logo: "",
    recipient_name: "", recipient_address: "", recipient_email: "", recipient_phone: "", shipping_address: "",
    invoice_id: null, invoice_reference: "", customer_id: null, order_reference: "", dispatch_date: "",
    carrier: "", tracking_number: "", notes: "", prepared_by: "", weight_unit: "kg",
    show_net_weight: false, show_gross_weight: true, show_packages: false, show_logo: true,
    show_stamp: false, show_signature: false,
    items: [{ id: crypto.randomUUID(), description: "", qty: 1, unit: "pcs", package_type: "", package_count: null, net_weight: null, gross_weight: null }],
  };
}

export function packagingTotals(items: PackagingItem[]) {
  const totals = { packages: 0, net: 0, gross: 0, quantities: Object.create(null) as Record<string, number> };
  for (const item of items) {
    const unit = item.unit.trim() || "pcs";
    totals.quantities[unit] = (totals.quantities[unit] ?? 0) + item.qty;
    totals.packages += item.package_count ?? 0;
    totals.net += item.qty * (item.net_weight ?? 0);
    totals.gross += item.qty * (item.gross_weight ?? 0);
  }
  return totals;
}

function text(value: unknown, label: string, max = 250, required = false, multiline = false): void {
  if (typeof value !== "string" || value.length > max || required && !value.trim())
    throw new Error(`${label} ${required ? "is required and " : ""}must be at most ${max} characters.`);
  if (!multiline && /[\r\n]/.test(value)) throw new Error(`${label} must be a single line.`);
}

function validDate(value: unknown, optional = false): boolean {
  if (optional && value === "") return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validatePackagingForm(form: PackagingForm): void {
  if (!form || typeof form !== "object") throw new Error("Packaging list data could not be read.");
  text(form.number, "Packaging list number", 100, true);
  text(form.recipient_name, "Recipient name", 160, true);
  text(form.company_name, "Company name", 160);
  text(form.company_trn, "Company tax number", 60);
  text(form.font, "Font");
  for (const key of ["company_phone", "recipient_phone"] as const) text(form[key], key.replace(/_/g, " "), 40);
  for (const key of ["invoice_reference", "order_reference", "carrier", "tracking_number", "prepared_by"] as const) text(form[key], key.replace(/_/g, " "), 120);
  for (const key of ["company_address", "recipient_address", "shipping_address"] as const) {
    const label = key.replace(/_/g, " ");
    text(form[key], label, 400, false, true);
    if (form[key].split(/\r\n?|\n/).length > 6) throw new Error(`${label} must be at most six lines.`);
  }
  for (const key of ["company_email", "recipient_email"] as const) text(form[key], key.replace(/_/g, " "), 254);
  text(form.notes, "Notes", 10000, false, true);
  text(form.company_logo, "Company logo", 5_000_000, false, true);
  text(form.template, "Template", 100, true);
  if (!/^#[0-9a-f]{6}$/i.test(form.accent)) throw new Error("Choose a valid accent color.");
  if (!["draft", "issued", "dispatched", "cancelled"].includes(form.status)) throw new Error("Choose a valid packaging list status.");
  if (!["kg", "lb"].includes(form.weight_unit)) throw new Error("Choose kg or lb for weights.");
  if (!validDate(form.issue_date) || !validDate(form.dispatch_date, true)) throw new Error("Enter valid issue and dispatch dates.");
  for (const key of ["invoice_id", "customer_id"] as const)
    if (form[key] !== null && (!Number.isSafeInteger(form[key]) || form[key]! <= 0)) throw new Error("Choose a valid saved reference or leave it empty.");
  for (const key of ["show_net_weight", "show_gross_weight", "show_packages", "show_logo", "show_stamp", "show_signature"] as const)
    if (typeof form[key] !== "boolean") throw new Error("Packaging list display options could not be read.");
  for (const asset of [form.stamp, form.signature]) {
    if (!asset) continue;
    text(asset.data, "Stamp or signature", 5_000_000, false, true);
    text(asset.color, "Stamp or signature color", 100);
    for (const key of ["x", "y", "opacity", "cropTop", "cropRight", "cropBottom", "cropLeft", "scale"] as const)
      if (!Number.isFinite(asset[key]) || asset[key] < 0 || asset[key] > (key === "scale" ? 500 : 100)) throw new Error("Stamp or signature adjustments could not be read.");
  }
  if (!Array.isArray(form.items) || !form.items.length || form.items.length > 500) throw new Error("A packaging list needs between 1 and 500 items.");
  const ids = new Set<string>();
  for (const item of form.items) {
    if (!item || typeof item !== "object") throw new Error("Packaging list items could not be read.");
    text(item.id, "Item ID", 100, true);
    if (ids.has(item.id)) throw new Error("Each packaging list item needs a unique ID.");
    ids.add(item.id);
    text(item.description, "Item description", 2000, true, true);
    text(item.unit, "Quantity unit", 20, true);
    text(item.package_type, "Package type", 60);
    if (!Number.isFinite(item.qty) || item.qty <= 0) throw new Error("Item quantities must be positive numbers.");
    if (item.package_count !== null && (!Number.isSafeInteger(item.package_count) || item.package_count < 0)) throw new Error("Package counts must be whole numbers of zero or more.");
    for (const weight of [item.net_weight, item.gross_weight])
      if (weight !== null && (!Number.isFinite(weight) || weight < 0)) throw new Error("Weights must be numbers of zero or more.");
    if (item.net_weight !== null && item.gross_weight !== null && item.net_weight > item.gross_weight) throw new Error("Net weight cannot exceed gross weight.");
  }
  const totals = packagingTotals(form.items);
  if (!Number.isSafeInteger(totals.packages) || ![totals.net, totals.gross, ...Object.values(totals.quantities)].every(Number.isFinite)) throw new Error("Packaging list totals are too large.");
}

function scope(expected?: string): string {
  assertWorkspaceCurrent();
  const account = getCacheScope();
  if (!account) throw new Error("Sign in to load or save packaging lists.");
  const current = `${effectiveDataMode()}:${account}`;
  if (expected && current !== expected) throw new Error("Your workspace changed. Reopen Packaging List before continuing.");
  if (current.startsWith("cloud:") && typeof navigator !== "undefined" && !navigator.onLine)
    throw new Error("Connect to the internet to load or save cloud packaging lists.");
  return current;
}

function parseRecords(value: string | undefined): PackagingRecord[] {
  if (value === undefined) return [];
  try {
    const records: unknown = JSON.parse(value);
    if (!Array.isArray(records)) throw new Error("Invalid collection");
    const ids = new Set<string>();
    for (const record of records) {
      if (!record || typeof record.id !== "string" || !record.id || ids.has(record.id) ||
        !Number.isSafeInteger(record.revision) || record.revision < 1 ||
        typeof record.created_at !== "string" || !Number.isFinite(Date.parse(record.created_at)) ||
        typeof record.updated_at !== "string" || !Number.isFinite(Date.parse(record.updated_at))) throw new Error("Invalid record");
      validatePackagingForm(record.form);
      ids.add(record.id);
    }
    return records;
  } catch {
    throw new Error("Saved packaging lists could not be read. The original data has been preserved.");
  }
}

async function settingRow(expected: string, client: ReturnType<typeof sb>) {
  scope(expected);
  await requireModuleAccess("packaging-list");
  scope(expected);
  let userId: string | undefined, orgId: string | undefined;
  if (expected.startsWith("cloud:")) {
    const { data, error } = await supabase!.auth.getSession();
    scope(expected);
    if (error) throw error;
    userId = data.session?.user.id;
    const account = getCacheScope()!;
    if (!userId || !account.endsWith(`:user:${userId}`)) throw new Error("Your cloud account changed. Sign in before using packaging lists.");
    orgId = account.slice(0, -`:user:${userId}`.length);
  }
  let query = client.from("app_settings").select("id,value,sync_revision").eq("key", PACKAGING_SETTING_KEY);
  if (orgId) query = query.eq("org_id", orgId);
  const { data, error } = await query.limit(2);
  scope(expected);
  if (error) throw error;
  if (!Array.isArray(data) || data.length > 1) throw new Error("Saved packaging lists have duplicate settings. The original data has been preserved.");
  const row = data[0] as { id: number; value: string; sync_revision?: number } | undefined;
  if (data.length && (!row || !Number.isSafeInteger(row.id) || row.id <= 0 || typeof row.value !== "string"))
    throw new Error("Saved packaging lists could not be read. The original data has been preserved.");
  if (orgId && row && (!Number.isSafeInteger(row.sync_revision) || row.sync_revision! < 1))
    throw new Error("Cloud packaging list revisions could not be verified. Ask your administrator to update the cloud database before saving.");
  return { row, records: parseRecords(row?.value), userId, orgId };
}

export async function loadPackagingLists(): Promise<PackagingRecord[]> {
  const expected = scope();
  return (await settingRow(expected, sb())).records;
}

async function changeRecords<T>(expected: string, change: (records: PackagingRecord[]) => { records: PackagingRecord[]; result: T }, client: ReturnType<typeof sb>): Promise<T> {
  // ponytail: low-volume documents share one JSON setting; split into rows if
  // collection size becomes slow. CAS preserves edits from other windows.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { row, records, userId, orgId } = await settingRow(expected, client);
    const next = change(records);
    scope(expected);
    const value = JSON.stringify(next.records);
    if (row) {
      let query = client.from("app_settings").update({ value }).eq("id", row.id);
      query = orgId ? query.eq("org_id", orgId).eq("sync_revision", row.sync_revision!) : query.eq("value", row.value);
      const { data, error } = await query.select("id").maybeSingle();
      scope(expected);
      if (error) throw error; // Unknown write outcomes must never be retried.
      if (!data) continue;
    } else {
      const { error } = await client.from("app_settings").insert({ key: PACKAGING_SETTING_KEY, value, ...(userId ? { user_id: userId, org_id: orgId } : {}) }).select("id").single();
      scope(expected);
      if (error?.code === "23505") continue; // Another window created the setting.
      if (error) throw error;
    }
    return next.result;
  }
  throw new Error("Packaging lists changed in another window. Reload and try again.");
}

function mutate<T>(change: (records: PackagingRecord[]) => { records: PackagingRecord[]; result: T }): Promise<T> {
  const expected = scope();
  const operation = writes.then(async () => {
    scope(expected);
    const client = sb();
    const result = expected.startsWith("local:")
      ? await withLocalTransaction(tx => changeRecords(expected, change, tx as unknown as ReturnType<typeof sb>))
      : await changeRecords(expected, change, client);
    scope(expected);
    notifyDataChanged(["app_settings"]);
    return result;
  });
  writes = operation.then(() => {}, () => {});
  return operation;
}

export async function savePackagingList(form: PackagingForm, id?: string, expectedRevision?: number, expectedUpdatedAt?: string): Promise<PackagingRecord> {
  validatePackagingForm(form);
  const savedForm = structuredClone(form);
  if (savedForm.stamp) delete savedForm.stamp._previewUrl;
  if (savedForm.signature) delete savedForm.signature._previewUrl;
  const recordId = id || crypto.randomUUID();
  return mutate(records => {
    const previous = records.find(record => record.id === recordId);
    if (id && (!previous || !Number.isSafeInteger(expectedRevision) || previous.revision !== expectedRevision || previous.updated_at !== expectedUpdatedAt))
      throw new Error("This packaging list changed or was deleted. Reload it before saving.");
    if (records.some(record => record.id !== recordId && record.form.number.trim().toLowerCase() === savedForm.number.trim().toLowerCase()))
      throw new Error("This packaging list number is already in use. Choose another number.");
    if (previous?.revision === Number.MAX_SAFE_INTEGER) throw new Error("This packaging list revision is too large. The original data has been preserved.");
    const now = new Date(Math.max(Date.now(), previous ? Date.parse(previous.updated_at) + 1 : 0)).toISOString();
    const record = { id: recordId, revision: (previous?.revision ?? 0) + 1, created_at: previous?.created_at ?? now, updated_at: now, form: savedForm };
    return { records: [record, ...records.filter(item => item.id !== recordId)], result: record };
  });
}

export async function deletePackagingList(id: string, expectedRevision: number, expectedUpdatedAt: string): Promise<void> {
  return mutate(records => {
    const previous = records.find(record => record.id === id);
    if (!previous || !Number.isSafeInteger(expectedRevision) || previous.revision !== expectedRevision || previous.updated_at !== expectedUpdatedAt)
      throw new Error("This packaging list changed or was deleted. Reload it before deleting.");
    return { records: records.filter(record => record.id !== id), result: undefined };
  });
}
