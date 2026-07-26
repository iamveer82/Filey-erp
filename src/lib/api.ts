import { invoke } from "@tauri-apps/api/core";
import { sb, isConfigured, supabase } from "./supabase";
import { isLocalMode } from "./dataMode";
import { quotationTotals, applyRoundOff } from "./money";
import { splitItemMeta, docTotals as lineAwareTotals } from "./docItems";
import { getExchangeRates } from "./exchange-rates";
import { nextDocNumber } from "./docNumber";
import { checkFreeInvoiceCap } from "./license";
import { localYmd } from "./format";

// ===== Types =====
export interface Product {
  id: number;
  sku: string;
  name: string;
  description?: string;
  category?: string;
  unit_price: number;
  cost_price: number;
  quantity: number;
  reorder_level: number;
  unit?: string;
  batch_number?: string;
  expiry_date?: string;
  barcode?: string;
  warehouse?: string;
  is_serialized?: boolean;
  custom_fields?: Record<string, string>;
  supplier_id?: number;
  shared?: boolean;
  created_at: string;
}
export interface Order {
  id: number;
  order_number: string;
  customer_name: string;
  customer_id?: number;
  status: string;
  total: number;
  shared?: boolean;
  created_at: string;
}
export interface OrderItem {
  id?: number;
  order_id?: number;
  product_id?: number;
  quantity: number;
  unit_price: number;
}
export interface ErpSummary {
  total_products: number;
  low_stock: number;
  inventory_value: number;
  open_orders: number;
  unpaid_invoices: number;
}
export interface Employee {
  id: number;
  employee_code: string;
  name: string;
  email?: string;
  phone?: string;
  department?: string;
  position?: string;
  salary: number;
  hire_date?: string;
  status: string;
}
export interface Attendance {
  id: number;
  employee_id: number;
  employee_name: string;
  date: string;
  check_in?: string;
  check_out?: string;
  status: string;
}
export interface Payroll {
  id: number;
  employee_id: number;
  employee_name: string;
  period: string;
  basic: number;
  allowances: number;
  deductions: number;
  net_pay: number;
  status: string;
  /** Date the salary actually went out. Null while status is 'pending'. */
  paid_on?: string | null;
  created_at?: string;
}
export interface HrSummary {
  headcount: number;
  present_today: number;
  on_leave: number;
  monthly_payroll: number;
}
export interface Account {
  id: number;
  code: string;
  name: string;
  account_type: string;
  balance: number;
}
export interface Expense {
  id: number;
  category: string;
  description?: string;
  amount: number;
  expense_date: string;
  account_id?: number;
}
export interface Txn {
  id: number;
  account_id: number;
  account_name: string;
  txn_type: string;
  amount: number;
  description?: string;
  txn_date: string;
  /** Set when a bank reconciliation confirmed this entry against a statement. */
  reconciled_at?: string | null;
}
export interface FinanceReport {
  total_assets: number;
  total_liabilities: number;
  total_equity: number;
  total_revenue: number;
  total_expenses: number;
  net_profit: number;
  cash_position: number;
}
export interface VatReturn {
  from: string;
  to: string;
  rate: number;               // standard VAT rate % applied (UAE = 5)
  standardSupplyNet: number;  // FTA box 1: standard-rated supplies (net)
  outputVat: number;          // FTA box 1 / 12: output tax due
  standardExpenseNet: number; // FTA box 9: standard-rated expenses (net)
  inputVat: number;           // FTA box 9 / 13: recoverable input tax
  netVatDue: number;          // FTA box 14: net VAT payable (+) or refundable (-)
}
export interface User {
  id: number;
  username: string;
  full_name: string;
  role: string;
  active: boolean;
  created_at: string;
}
export interface Setting {
  key: string;
  value: string;
}
export interface AuditEntry {
  id: number;
  actor: string;
  action: string;
  entity: string;
  details?: string;
  /** before->after diff from log_audit(): {field:{old,new}} for updates,
   *  {_created|_deleted: row} for inserts/deletes. Null for manual logAction. */
  changes?: Record<string, unknown> | null;
  created_at: string;
}

export interface Lead {
  id: number;
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  source?: string;
  status: string;
  est_value: number;
  owner?: string;
  created_at: string;
}
export interface CrmCustomer {
  id: number;
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  phone_e164?: string;
  address?: string;
  trn?: string;
  // --- UAE e-invoice: buyer location (entered once per customer) ---
  city?: string;
  country_subdivision?: string; // emirate (ISO 3166-2:AE)
  country_code?: string;        // default AE
  segment?: string;
  /** Credit ceiling in AED — UI warns when outstanding exceeds it. */
  credit_limit?: number;
  /** Balance carried in from before Filey: + = they owe you, − = you owe them. */
  opening_balance?: number;
  custom_fields?: Record<string, string>;
  /** Per-customer bank details (BankInfo shape: bank_name, account_number, …). */
  bank_details?: Record<string, string>;
  shared?: boolean;
  created_at: string;
}
/** Anything a note, task or activity can be attached to. Stored as
 *  (target_type, target_id) so one timeline query serves every record type. */
export type CrmTargetType =
  | "company"
  | "person"
  | "deal"
  | "lead"
  | "invoice"
  | "employee";

/** A contact at a company. `company_id` points at crm_customers, which is the
 *  company/account object. */
export interface Person {
  id: number;
  company_id?: number | null;
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  phone_e164?: string;
  linkedin?: string;
  notes?: string;
  owner?: string;
  is_primary?: boolean;
  custom_fields?: Record<string, unknown>;
  created_at: string;
}
export interface CrmNote {
  id: number;
  target_type: CrmTargetType;
  target_id: number;
  body: string;
  author?: string;
  pinned?: boolean;
  created_at: string;
  updated_at?: string;
}
export interface CrmTask {
  id: number;
  target_type?: CrmTargetType | null;
  target_id?: number | null;
  title: string;
  body?: string;
  due_date?: string;
  /** open | in_progress | done | cancelled */
  status: string;
  priority?: string;
  assignee?: string;
  completed_at?: string | null;
  created_at: string;
}
export interface Opportunity {
  id: number;
  title: string;
  /** Display name, kept in step with customer_id for back-compat. */
  customer_name: string;
  customer_id?: number | null;
  person_id?: number | null;
  pipeline?: string;
  stage: string;
  value: number;
  probability: number;
  owner?: string;
  expected_close?: string;
  close_reason?: string;
  closed_at?: string | null;
  created_at: string;
}
export interface Activity {
  id: number;
  kind: string;
  subject: string;
  related_to?: string;
  target_type?: CrmTargetType | null;
  target_id?: number | null;
  due_date?: string;
  done: boolean;
  created_at: string;
}
export interface CrmSummary {
  open_leads: number;
  pipeline_value: number;
  won_value: number;
  conversion_rate: number;
  activities_due: number;
}

export interface InvoiceItem {
  id?: number;
  product_id?: number;
  description: string;
  qty: number;
  unit_price: number;
  unit?: string;
  custom?: Record<string, string>;
  /** UAE e-invoice tax category code (S/Z/E/O/AE) — see lib/einvoice.ts. */
  tax_category?: string;
}
export interface InvoiceDocSummary {
  id: number;
  number: string;
  customer_name: string;
  status: string;
  template: string;
  total: number;
  currency?: string;
  paid?: number;
  balance?: number;
  issue_date?: string;
  due_date?: string;
  shared?: boolean;
  updated_at: string;
  unit_price_formula?: { a: string; b?: string } | null;
  /** VAT rate (%) applied to this document — used by statement engine. */
  tax_rate?: number;
}
export interface InvoicePayment {
  id: number;
  invoice_id: number;
  amount: number;
  method?: string;
  note?: string;
  paid_at: string;
}
export interface InvoiceDoc {
  id: number;
  number: string;
  status: string;
  doc_type?: string;
  template: string;
  accent: string;
  currency: string;
  doc_title?: string;
  seller_name: string;
  seller_address?: string;
  seller_trn?: string;
  seller_email?: string;
  seller_phone?: string;
  logo?: string;
  customer_id?: number;
  customer_name: string;
  customer_address?: string;
  customer_trn?: string;
  customer_email?: string;
  issue_date?: string;
  due_date?: string;
  notes?: string;
  terms?: string;
  po_number?: string;
  /** Buyer PO date (Vyapar parity; optional). */
  po_date?: string;
  /** UAE VAT: date goods/services were supplied, when ≠ invoice date. */
  date_of_supply?: string;
  /** Payment-terms preset id (e.g. "net30") — drives due_date autofill. */
  payment_terms?: string;
  /** Round the grand total to a whole currency unit (Vyapar parity). */
  round_off?: boolean;
  tax_rate: number;
  discount: number;
  quotation_id?: number;
  // --- UAE e-invoice (Peppol PINT-AE) mandatory fields; see lib/einvoice.ts ---
  invoice_type_code?: string;      // 380 tax invoice, 381 credit note, …
  transaction_type?: string;       // 8-flag bitstring, see TRANSACTION_TYPE_FLAGS
  payment_means_code?: string;     // UN/ECE 4461
  buyer_city?: string;
  buyer_country_subdivision?: string; // emirate (ISO 3166-2:AE)
  buyer_country_code?: string;        // default AE
  // Seller identity snapshot (autofilled from CompanyProfile at creation).
  seller_city?: string;
  seller_country_subdivision?: string; // emirate
  seller_legal_id?: string;            // trade-license / EID / passport no.
  seller_legal_id_type?: string;       // TL / EID / PAS / CD
  created_at: string;
  updated_at: string;
  items: InvoiceItem[];
  custom_columns?: { key: string; label: string }[];
  stamp?: { data: string; x: number; y: number; opacity?: number; color?: string; cropTop?: number; cropRight?: number; cropBottom?: number; cropLeft?: number };
  signature?: { data: string; x: number; y: number; opacity?: number; color?: string; cropTop?: number; cropRight?: number; cropBottom?: number; cropLeft?: number };
  show_stamp?: boolean;
  show_logo?: boolean;
  show_signature?: boolean;
  unit_price_formula?: { a: string; b: string } | null;
  /** FX rate frozen at save: AED per 1 unit of `currency` (null/absent for AED). */
  fx_rate?: number | null;
}
export type InvoiceDocInput = Omit<
  InvoiceDoc,
  "id" | "created_at" | "updated_at"
> & { id?: number };
export interface CompanyProfile {
  name: string;
  business_type?: string;
  address?: string;
  city?: string;
  zip?: string;
  trn?: string;
  vat_number?: string;
  tax_type?: string;
  // --- UAE e-invoice: seller legal registration + location (entered once) ---
  legal_id?: string;            // trade-license / EID / passport / cabinet-decision no.
  legal_id_type?: string;       // TL / EID / PAS / CD
  country_subdivision?: string; // emirate (ISO 3166-2:AE)
  email?: string;
  phone?: string;
  website?: string;
  currency?: string;
  default_tax_rate?: number;
  logo?: string;
  default_accent: string;
  default_template: string;
}

// ===================================================================
//  Offline-first hybrid layer
//  - Reads: fetch from Supabase when online, mirror into a local cache;
//    serve the cache when offline / unconfigured.
//  - Writes: run against Supabase when online; when offline, single-row
//    ops are queued in a local outbox and replayed on reconnect.
// ===================================================================

const hasTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const onLine = () =>
  typeof navigator === "undefined" ? true : navigator.onLine;

let activeCacheOrg = "default";
/** Scope the local read-cache to an organization. Call whenever the
 *  signed-in user's org changes (login, org switch, sign-out). */
export function setCacheOrg(orgId?: string | null): void {
  activeCacheOrg = orgId && orgId.trim() ? orgId : "default";
}

async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    if (hasTauri) {
      const v = await invoke<string | null>("cache_get", { key });
      return v ? (JSON.parse(v) as T) : null;
    }
    const v = localStorage.getItem("cache:" + key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

async function cacheSet(key: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value);
  try {
    if (hasTauri) await invoke("cache_set", { key, value: json });
    else localStorage.setItem("cache:" + key, json);
  } catch {
    /* cache is best-effort */
  }
}

type OutboxOp =
  | { k: "insert"; t: string; row: Record<string, unknown> }
  | { k: "update"; t: string; id: number; row: Record<string, unknown> }
  | { k: "delete"; t: string; id: number };

async function outboxAdd(op: OutboxOp): Promise<void> {
  const json = JSON.stringify(op);
  try {
    if (hasTauri) {
      await invoke("outbox_add", { op: json });
    } else {
      const a = JSON.parse(localStorage.getItem("outbox") || "[]");
      a.push({ id: Date.now() + a.length, op: json });
      localStorage.setItem("outbox", JSON.stringify(a));
    }
  } catch {
    /* ignore */
  }
}

async function outboxList(): Promise<{ id: number; op: string }[]> {
  try {
    if (hasTauri)
      return await invoke<{ id: number; op: string }[]>("outbox_list");
    return JSON.parse(localStorage.getItem("outbox") || "[]");
  } catch {
    return [];
  }
}

async function outboxRemove(id: number): Promise<void> {
  try {
    if (hasTauri) {
      await invoke("outbox_remove", { entryId: id });
    } else {
      const a = JSON.parse(localStorage.getItem("outbox") || "[]");
      localStorage.setItem(
        "outbox",
        JSON.stringify(a.filter((e: { id: number }) => e.id !== id))
      );
    }
  } catch {
    /* ignore */
  }
}

let flushing = false;
export async function flushOutbox(): Promise<void> {
  if (isLocalMode()) return; // local mode writes are committed directly, no outbox
  if (flushing || !isConfigured || !onLine()) return;
  flushing = true;
  try {
    const list = await outboxList();
    for (const entry of list) {
      let op: OutboxOp;
      try {
        op = JSON.parse(entry.op);
      } catch {
        await outboxRemove(entry.id);
        continue;
      }
      try {
        if (op.k === "insert") {
          const { error } = await sb().from(op.t).insert(op.row);
          if (error) throw error;
        } else if (op.k === "update") {
          const { error } = await sb()
            .from(op.t)
            .update(op.row)
            .eq("id", op.id);
          if (error) throw error;
        } else {
          const { error } = await sb().from(op.t).delete().eq("id", op.id);
          if (error) throw error;
        }
        await outboxRemove(entry.id);
      } catch {
        break; // stop; retry remaining on next reconnect
      }
    }
  } finally {
    flushing = false;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    flushOutbox().catch((e) => console.error("Failed to flush outbox:", e));
  });
}

/** Read-through cache. Online → fetch + mirror; else → cached snapshot. */
async function readCached<T>(
  key: string,
  run: () => Promise<T>,
  empty: T
): Promise<T> {
  if (isLocalMode()) return run(); // local store is the source of truth
  // Namespace the local cache by the active organization so data from
  // one org never bleeds into another on a shared device.
  const k = `${activeCacheOrg}:${key}`;
  if (!isConfigured) return (await cacheGet<T>(k)) ?? empty;
  if (onLine()) {
    try {
      await flushOutbox();
      const data = await run();
      await cacheSet(k, data);
      return data;
    } catch {
      console.error("Failed to read fresh data from server, using cache");
      return (await cacheGet<T>(k)) ?? empty;
    }
  }
  return (await cacheGet<T>(k)) ?? empty;
}

function offlineError(): never {
  throw new Error(
    "You're offline. This change needs a connection — it will not be saved."
  );
}

/** Single-row write: online → run; offline → queue for replay. */
async function write<T>(
  op: OutboxOp,
  run: () => Promise<T>,
  offlineResult: T
): Promise<T> {
  if (isLocalMode()) return run(); // commit straight to the local store
  if (!isConfigured)
    throw new Error("Cloud storage is not configured.");
  if (onLine()) {
    await flushOutbox();
    return run();
  }
  await outboxAdd(op);
  return offlineResult;
}

/** Multi-step / read-modify-write op — requires a live connection. */
async function online<T>(run: () => Promise<T>): Promise<T> {
  if (isLocalMode()) return run(); // no network needed in local mode
  if (!isConfigured)
    throw new Error("Cloud storage is not configured.");
  if (!onLine()) offlineError();
  await flushOutbox();
  return run();
}

// ---- generic Supabase helpers ----
async function sList<T>(
  table: string,
  order?: { col: string; asc: boolean }[],
  select = "*",
  client: any = null
): Promise<T[]> {
  let q: any = (client ?? sb()).from(table).select(select);
  for (const o of order ?? []) q = q.order(o.col, { ascending: o.asc });
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as T[];
}
async function sInsert(
  table: string,
  row: Record<string, unknown>,
  client: any = null
): Promise<number> {
  const { data, error } = await (client ?? sb())
    .from(table)
    .insert(row)
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: number }).id;
}
async function sUpdate(
  table: string,
  id: number,
  patch: Record<string, unknown>,
  client: any = null
): Promise<void> {
  const { error } = await (client ?? sb()).from(table).update(patch).eq("id", id);
  if (error) throw error;
}
async function sDelete(table: string, id: number, client: any = null): Promise<void> {
  const { error } = await (client ?? sb()).from(table).delete().eq("id", id);
  if (error) throw error;
}

/** Org/team data lives ONLY in the cloud. In local mode sb() is the on-device
 *  shim, so team management must talk to the real supabase-js client (signed
 *  in via the sync card). Cloud mode: same client as everything else. */
function cdb(): any {
  if (isLocalMode()) {
    if (!supabase) throw new Error("Cloud isn't configured in this build.");
    return supabase;
  }
  return sb();
}

/** Toggle a record's org-sharing. Shared rows are visible (read-only) to
 *  the whole org; private rows only to their owner + org admins. */
export const shareRecord = (table: string, id: number, shared: boolean) =>
  write(
    { k: "update", t: table, id, row: { shared } },
    () => sUpdate(table, id, { shared }),
    undefined
  );

/** Share a parent doc and cascade the flag to its line items. */
async function shareWithItems(
  parent: string,
  itemsTable: string,
  fk: string,
  id: number,
  shared: boolean
): Promise<void> {
  await sUpdate(parent, id, { shared });
  const { error } = await sb()
    .from(itemsTable)
    .update({ shared })
    .eq(fk, id);
  if (error) throw error;
}

const clean = <T extends Record<string, unknown>>(o: T) =>
  Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined)
  ) as Record<string, unknown>;

export type StockMovementType = "sale" | "purchase" | "order" | "in" | "out" | "adjust";

/** One row per stock quantity change. qty is signed: positive = in, negative = out. */
export interface StockMovement {
  id: number;
  product_id: number;
  qty: number;
  type: StockMovementType;
  ref?: string | null;
  note?: string | null;
  moved_at: string; // ISO
  created_at: string;
}

/** Where a stock change came from — logged alongside the quantity write so
 *  every product has a full movement history ("why is stock 47?"). */
type StockCtx = {
  type: StockMovementType;
  ref?: string;
  note?: string;
  date?: string; // yyyy-mm-dd; defaults to now
};

/** Weighted-average unit cost after folding a receipt into current stock.
 *  First stock (or unpriced product) takes the receipt cost as-is. */
export function nextAvgCost(
  onHand: number,
  oldCost: number,
  recvQty: number,
  unitCost: number
): number {
  const next =
    oldCost > 0 && onHand > 0
      ? (onHand * oldCost + recvQty * unitCost) / (onHand + recvQty)
      : unitCost;
  return Math.round(next * 100) / 100;
}

/** Fold a goods receipt into products.cost_price (moving average), so COGS
 *  and stock valuation track what the stock actually cost. Call BEFORE the
 *  quantity is incremented — onHand must be the pre-receipt quantity.
 *  Best-effort: a cost update failure must not block receiving. */
async function applyMovingAverageCost(
  productId: number,
  recvQty: number,
  unitCost: number
): Promise<void> {
  if (!productId || !(recvQty > 0) || !(unitCost > 0)) return;
  try {
    const { data } = await sb()
      .from("products")
      .select("quantity,cost_price")
      .eq("id", productId)
      .single();
    const onHand = Math.max(0, Number(data?.quantity) || 0);
    const oldCost = Number(data?.cost_price) || 0;
    const next = nextAvgCost(onHand, oldCost, recvQty, unitCost);
    if (next !== oldCost)
      await sb().from("products").update({ cost_price: next }).eq("id", productId);
  } catch (e) {
    console.warn("Moving-average cost update failed", e);
  }
}

async function adjustProductStock(
  productId: number,
  delta: number,
  ctx?: StockCtx
): Promise<void> {
  if (!productId || delta === 0) return;
  const apply = async () => {
    const { error } = await sb().rpc("adjust_product_stock", {
      p_id: productId,
      p_delta: delta,
    });
    if (!error) return;
    // Fallback: read current qty and write the delta ourselves (best-effort, not atomic).
    const { data: row, error: fe } = await sb()
      .from("products")
      .select("quantity")
      .eq("id", productId)
      .single();
    if (fe) throw new Error(`Stock RPC failed and fallback fetch failed: ${fe.message}`);
    const next = Math.max(0, (Number(row?.quantity) || 0) + delta);
    const { error: ue } = await sb()
      .from("products")
      .update({ quantity: next })
      .eq("id", productId);
    if (ue) throw new Error(`Stock RPC failed and fallback update failed: ${ue.message}`);
  };
  await apply();
  // Movement log — best-effort: a failed log must never undo/block the stock write.
  try {
    await sInsert("stock_movements", {
      product_id: productId,
      qty: delta,
      type: ctx?.type ?? "adjust",
      ref: ctx?.ref?.trim() || null,
      note: ctx?.note?.trim() || null,
      moved_at: ctx?.date
        ? new Date(`${ctx.date}T12:00:00`).toISOString()
        : new Date().toISOString(),
    });
  } catch (e) {
    console.warn("stock movement log failed", e);
  }
}

/** Invoices created since the 1st of the current month (free-tier cap). */
async function invoicesThisMonth(): Promise<number> {
  const rows = await sList<{ created_at?: string }>("invoice_docs");
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  return rows.filter((r) => r.created_at && new Date(r.created_at) >= start).length;
}

async function adjustAccountBalance(accountId: number, delta: number): Promise<void> {
  if (!accountId || delta === 0) return;
  const { error } = await sb().rpc("adjust_account_balance", {
    p_id: accountId,
    p_delta: delta,
  });
  if (!error) return;
  const { data: row, error: fe } = await sb()
    .from("accounts")
    .select("balance")
    .eq("id", accountId)
    .single();
  if (fe) throw new Error(`Account balance RPC failed and fallback fetch failed: ${fe.message}`);
  const next = (Number(row?.balance) || 0) + delta;
  const { error: ue } = await sb()
    .from("accounts")
    .update({ balance: next })
    .eq("id", accountId);
  if (ue) throw new Error(`Account balance RPC failed and fallback update failed: ${ue.message}`);
}

// ===== ERP Core =====

/** Legacy shape of the pre-table `stock_issues` JSON app-setting. Only used
 *  by migrateLegacyStockIssues; new code reads/writes stock_movements rows. */
interface LegacyStockIssue {
  qty: number;
  invoice: string;
  note?: string;
  date: string; // ISO
  type?: "in" | "out" | "adjust";
}

/** One-time move of the legacy stock_issues JSON blob into stock_movements
 *  rows. Runs lazily on first movement read; deletes the setting after so it
 *  never runs twice. (Two devices racing this could duplicate history rows —
 *  accepted: single-user desktop, and movements are informational.) */
async function migrateLegacyStockIssues(): Promise<void> {
  const { data } = await sb()
    .from("app_settings")
    .select("id,value")
    .eq("key", "stock_issues")
    .maybeSingle();
  const row = data as { id?: number; value?: string } | null;
  if (!row?.id || !row.value) return;
  try {
    const map = JSON.parse(row.value) as Record<string, LegacyStockIssue[]>;
    for (const [pid, list] of Object.entries(map)) {
      for (const h of list ?? []) {
        const t = h.type ?? "out";
        const qty =
          t === "out"
            ? -Math.abs(Number(h.qty) || 0)
            : t === "in"
              ? Math.abs(Number(h.qty) || 0)
              : Number(h.qty) || 0;
        if (!qty) continue;
        await sInsert("stock_movements", {
          product_id: Number(pid),
          qty,
          type: t,
          ref: h.invoice || null,
          note: h.note || null,
          moved_at: h.date || new Date().toISOString(),
        });
      }
    }
    await sDelete("app_settings", row.id);
  } catch (e) {
    console.warn("Legacy stock_issues migration failed", e);
  }
}

export const erp = {
  products: () =>
    readCached<Product[]>(
      "erp_products",
      () => sList<Product>("products", [{ col: "name", asc: true }]),
      []
    ),
  createProduct: (input: Omit<Product, "id" | "created_at">) => {
    const row = clean(input as Record<string, unknown>);
    return write({ k: "insert", t: "products", row }, () =>
      sInsert("products", row), -1
    );
  },
  updateStock: (productId: number, delta: number, note?: string) =>
    online(async () => {
      // Atomic — avoids lost updates when two clients adjust stock at once.
      await adjustProductStock(productId, delta, {
        type: "adjust",
        note: note ?? "Manual stock update",
      });
    }),
  /** Record a manual stock entry: applies the delta to the product's stock
   *  atomically and logs a movement row. "out" subtracts qty, "in" adds qty,
   *  "adjust" applies qty as a signed delta. */
  recordStockEntry: (
    productId: number,
    type: "in" | "out" | "adjust",
    qty: number,
    reference: string,
    note?: string,
    date?: string // yyyy-mm-dd; defaults to now
  ) =>
    online(async () => {
      const q =
        type === "adjust" ? Math.trunc(Number(qty) || 0) : Math.abs(Number(qty) || 0);
      if (!productId || q === 0) return;
      const delta = type === "out" ? -q : q;
      await adjustProductStock(productId, delta, {
        type,
        ref: reference,
        note,
        date,
      });
    }),
  /** All stock movements, keyed by product id, oldest first (one read). */
  stockMovements: () =>
    online(async () => {
      await migrateLegacyStockIssues();
      const rows = await sList<StockMovement>("stock_movements", [
        { col: "moved_at", asc: true },
      ]);
      const map: Record<string, StockMovement[]> = {};
      for (const m of rows) (map[String(m.product_id)] ??= []).push(m);
      return map;
    }),
  updateProduct: (
    productId: number,
    patch: Partial<Omit<Product, "id" | "created_at">>
  ) => {
    const row = clean(patch as Record<string, unknown>);
    return write({ k: "update", t: "products", id: productId, row }, () =>
      sUpdate("products", productId, row), undefined
    );
  },
  deleteProduct: (productId: number) =>
    write({ k: "delete", t: "products", id: productId }, () =>
      sDelete("products", productId), undefined
    ),
  orders: () =>
    readCached<Order[]>(
      "erp_orders",
      () => sList<Order>("orders", [{ col: "id", asc: false }]),
      []
    ),
  createOrder: (orderNumber: string, customerName: string, total: number) => {
    const row = {
      order_number: orderNumber,
      customer_name: customerName,
      status: "draft",
      total,
    };
    return write({ k: "insert", t: "orders", row }, () =>
      sInsert("orders", row), -1
    );
  },
  createOrderWithItems: (
    orderNumber: string,
    customerName: string,
    lines: { product_id: number; quantity: number; unit_price: number }[],
    total: number,
    customerId?: number
  ) =>
    online(async () => {
      const orderId = await sInsert("orders", {
        order_number: orderNumber,
        customer_name: customerName,
        customer_id: customerId ?? null,
        status: "draft",
        total,
      });
      if (lines.length) {
        const { error: itemsErr } = await sb()
          .from("order_items")
          .insert(
            lines.map((l) => ({
              order_id: orderId,
              product_id: l.product_id,
              quantity: l.quantity,
              unit_price: l.unit_price,
            }))
          );
        if (itemsErr) throw itemsErr;
        for (const l of lines) {
          // Atomic decrement (clamped at 0 server-side).
          await adjustProductStock(l.product_id, -l.quantity, {
            type: "order",
            ref: `Order #${orderId}`,
          });
        }
      }
      return orderId;
    }),
  setOrderStatus: (orderId: number, status: string) =>
    write({ k: "update", t: "orders", id: orderId, row: { status } }, () =>
      sUpdate("orders", orderId, { status }), undefined
    ),
  /** Fetch an order plus its line items (for editing). */
  getOrder: (orderId: number) =>
    online(async () => {
      const { data: order, error } = await sb()
        .from("orders")
        .select("*")
        .eq("id", orderId)
        .single();
      if (error) throw error;
      const { data: items, error: ie } = await sb()
        .from("order_items")
        .select("*")
        .eq("order_id", orderId);
      if (ie) throw ie;
      return {
        ...(order as Order),
        items: (items ?? []) as OrderItem[],
      };
    }),
  /** Update an order header + replace its line items, re-adjusting stock by
   *  the net delta (old qty restored, new qty removed) atomically per product. */
  updateOrder: (
    orderId: number,
    patch: {
      customer_name?: string;
      status?: string;
      total: number;
      customer_id?: number | null;
    },
    lines: { product_id: number; quantity: number; unit_price: number }[]
  ) =>
    online(async () => {
      const { data: oldItems, error: oe } = await sb()
        .from("order_items")
        .select("product_id,quantity")
        .eq("order_id", orderId);
      if (oe) throw oe;
      const oldMap = new Map<number, number>();
      for (const it of (oldItems ?? []) as {
        product_id: number | null;
        quantity: number;
      }[]) {
        if (it.product_id != null)
          oldMap.set(it.product_id, (oldMap.get(it.product_id) ?? 0) + it.quantity);
      }
      const newMap = new Map<number, number>();
      for (const l of lines)
        newMap.set(l.product_id, (newMap.get(l.product_id) ?? 0) + l.quantity);

      const headerRow = clean({
        customer_name: patch.customer_name,
        status: patch.status,
        customer_id: patch.customer_id,
        total: patch.total,
      });
      const { error: ue } = await sb()
        .from("orders")
        .update(headerRow)
        .eq("id", orderId);
      if (ue) throw ue;

      const { error: de } = await sb()
        .from("order_items")
        .delete()
        .eq("order_id", orderId);
      if (de) throw de;
      if (lines.length) {
        const { error: ie } = await sb()
          .from("order_items")
          .insert(
            lines.map((l) => ({
              order_id: orderId,
              product_id: l.product_id,
              quantity: l.quantity,
              unit_price: l.unit_price,
            }))
          );
        if (ie) throw ie;
      }

      const ids = new Set<number>([...oldMap.keys(), ...newMap.keys()]);
      for (const pid of ids) {
        const delta = (oldMap.get(pid) ?? 0) - (newMap.get(pid) ?? 0);
        if (delta !== 0) {
          await adjustProductStock(pid, delta, {
            type: "order",
            ref: `Order #${orderId}`,
            note: "Order edited",
          });
        }
      }
    }),
  /** Delete an order, restoring any stock its line items had reserved. */
  deleteOrder: (orderId: number) =>
    online(async () => {
      const { data: items, error: oe } = await sb()
        .from("order_items")
        .select("product_id,quantity")
        .eq("order_id", orderId);
      if (oe) throw oe;
      for (const it of (items ?? []) as {
        product_id: number | null;
        quantity: number;
      }[]) {
        if (it.product_id != null && it.quantity) {
          await adjustProductStock(it.product_id, it.quantity, {
            type: "order",
            ref: `Order #${orderId}`,
            note: "Order deleted — stock restored",
          });
        }
      }
      const { error: de } = await sb()
        .from("order_items")
        .delete()
        .eq("order_id", orderId);
      if (de) throw de;
      const { error: ee } = await sb().from("orders").delete().eq("id", orderId);
      if (ee) throw ee;
    }),
  shareOrder: (orderId: number, shared: boolean) =>
    online(() =>
      shareWithItems("orders", "order_items", "order_id", orderId, shared)
    ),
  summary: () =>
    readCached<ErpSummary>(
      "erp_summary",
      async () => {
        const [products, orders, docs, items] = await Promise.all([
          sList<Product>("products"),
          sList<Order>("orders"),
          sList<any>("invoice_docs"),
          sList<any>("invoice_doc_items"),
        ]);
        const byDoc = new Map<number, any[]>();
        for (const it of items) {
          const a = byDoc.get(it.invoice_id) ?? [];
          a.push(it);
          byDoc.set(it.invoice_id, a);
        }
        const unpaid = docs
          .filter((d) => d.status !== "paid")
          .reduce((s, d) => s + docTotal(d, byDoc.get(d.id) ?? []), 0);
        return {
          total_products: products.length,
          low_stock: products.filter((p) => p.quantity <= p.reorder_level)
            .length,
          inventory_value: products.reduce(
            (s, p) => s + p.quantity * p.cost_price,
            0
          ),
          open_orders: orders.filter((o) =>
            ["draft", "confirmed"].includes(o.status)
          ).length,
          unpaid_invoices: unpaid,
        };
      },
      {
        total_products: 0,
        low_stock: 0,
        inventory_value: 0,
        open_orders: 0,
        unpaid_invoices: 0,
      }
    ),
};

// ===== HR =====
export const hr = {
  employees: () =>
    readCached<Employee[]>(
      "hr_employees",
      () => sList<Employee>("employees", [{ col: "name", asc: true }]),
      []
    ),
  createEmployee: (input: Omit<Employee, "id" | "status">) => {
    const row = clean(input as Record<string, unknown>);
    return write({ k: "insert", t: "employees", row }, () =>
      sInsert("employees", row), -1
    );
  },
  setEmployeeStatus: (employeeId: number, status: string) =>
    write(
      { k: "update", t: "employees", id: employeeId, row: { status } },
      () => sUpdate("employees", employeeId, { status }),
      undefined
    ),
  deleteEmployee: (employeeId: number) =>
    write({ k: "delete", t: "employees", id: employeeId }, () =>
      sDelete("employees", employeeId), undefined
    ),
  attendance: () =>
    readCached<Attendance[]>(
      "hr_attendance",
      async () => {
        const rows = await sList<any>(
          "attendance",
          [
            { col: "date", asc: false },
            { col: "id", asc: false },
          ],
          "*, employees(name)"
        );
        return rows.map((r) => ({
          id: r.id,
          employee_id: r.employee_id,
          employee_name: r.employees?.name ?? "—",
          date: r.date,
          check_in: r.check_in ?? undefined,
          check_out: r.check_out ?? undefined,
          status: r.status,
        })) as Attendance[];
      },
      []
    ),
  markAttendance: (
    employeeId: number,
    date: string,
    status: string,
    checkIn?: string,
    checkOut?: string
  ) => {
    const row = {
      employee_id: employeeId,
      date,
      status,
      check_in: checkIn ?? null,
      check_out: checkOut ?? null,
    };
    return write({ k: "insert", t: "attendance", row }, () =>
      sInsert("attendance", row), -1
    );
  },
  payroll: () =>
    readCached<Payroll[]>(
      "hr_payroll",
      async () => {
        const rows = await sList<any>(
          "payroll",
          [{ col: "id", asc: false }],
          "*, employees(name)"
        );
        return rows.map((r) => ({
          id: r.id,
          employee_id: r.employee_id,
          employee_name: r.employees?.name ?? "—",
          period: r.period,
          basic: r.basic,
          allowances: r.allowances,
          deductions: r.deductions,
          net_pay: r.net_pay,
          status: r.status,
          paid_on: r.paid_on ?? null,
          created_at: r.created_at,
        })) as Payroll[];
      },
      []
    ),
  /** Mark a payroll run paid (or back to pending), stamping the date it went
   *  out. `status` alone couldn't answer "when was this salary paid?". */
  setPayrollPaid: (payrollId: number, paid: boolean, paidOn?: string) => {
    const row = {
      status: paid ? "paid" : "pending",
      paid_on: paid ? paidOn || localYmd(new Date()) : null,
    };
    return write(
      { k: "update", t: "payroll", id: payrollId, row },
      () => sUpdate("payroll", payrollId, row),
      undefined
    );
  },
  runPayroll: (
    employeeId: number,
    period: string,
    basic: number,
    allowances: number,
    deductions: number,
    accountId?: number | null
  ) => {
    const net = basic + allowances - deductions;
    const row = {
      employee_id: employeeId,
      period,
      basic,
      allowances,
      deductions,
      net_pay: net,
      status: "pending",
    };
    return online(async () => {
      const id = await sInsert("payroll", row);
      const targetId = accountId ?? (await findOrCreatePayrollAccount());
      const today = new Date().toISOString().slice(0, 10);
      const ref = `Payroll ${id}`;
      if (targetId > 0) {
        await sInsert("transactions", {
          account_id: targetId,
          txn_type: "debit",
          amount: net,
          description: `Payroll ${period}`,
          ref,
          source: "payroll",
          txn_date: today,
        });
        await adjustAccountBalance(targetId, ledgerDelta("expense", "debit", net));
        // Contra leg — salaries paid from Cash/Bank (keeps the ledger balanced).
        const cashId = await findOrCreateCashAccount();
        if (cashId > 0) {
          await sInsert("transactions", {
            account_id: cashId,
            txn_type: "credit",
            amount: net,
            description: `Payroll ${period} — paid`,
            ref,
            source: "payroll",
            txn_date: today,
          });
          await adjustAccountBalance(cashId, ledgerDelta("asset", "credit", net));
        }
      }
      return id;
    });
  },
  markPayrollPaid: (payrollId: number) =>
    write(
      { k: "update", t: "payroll", id: payrollId, row: { status: "paid" } },
      () => sUpdate("payroll", payrollId, { status: "paid" }),
      undefined
    ),
  summary: () =>
    readCached<HrSummary>(
      "hr_summary",
      async () => {
        const today = new Date().toISOString().slice(0, 10);
        const [emps, att, pay] = await Promise.all([
          sList<Employee>("employees"),
          sList<{ date: string; status: string }>("attendance"),
          sList<{ net_pay: number; status: string }>("payroll"),
        ]);
        const active = emps.filter((e) => e.status === "active");
        return {
          headcount: active.length,
          present_today: att.filter(
            (a) => a.date === today && a.status === "present"
          ).length,
          on_leave: att.filter(
            (a) => a.date === today && a.status === "leave"
          ).length,
          monthly_payroll: pay
            .filter((p) => p.status !== "paid")
            .reduce((s, p) => s + p.net_pay, 0),
        };
      },
      { headcount: 0, present_today: 0, on_leave: 0, monthly_payroll: 0 }
    ),
};

// ===== Finance =====
/** AED-equivalent of a document amount. `fxRate` is AED per 1 unit of the doc
 *  currency (frozen at save from lib/exchange-rates). AED docs and unknown rates
 *  pass through unchanged. */
export function aedEquivalent(
  amount: number,
  currency?: string | null,
  fxRate?: number | null
): number {
  if (!currency || currency === "AED") return amount;
  return fxRate && fxRate > 0 ? amount * fxRate : amount;
}

/** Compute the core UAE FTA VAT 201 figures from ledger transactions.
 *  Output/Input VAT come straight from the VAT account postings (already
 *  tax-category-aware — only standard-rated "S" lines post VAT; reversals on
 *  un-finalize net out). Net supply/expense amounts are derived from the tax at
 *  the standard rate — exact under the single-rate UAE regime. Zero-rated and
 *  exempt supplies (boxes 4–5) carry no VAT and aren't derivable here; a later
 *  pass can add them from invoice line tax_category. */
export function computeVatReturn(
  txns: Pick<Txn, "account_name" | "txn_type" | "amount" | "txn_date">[],
  ratePct: number,
  from?: string,
  to?: string
): VatReturn {
  const inRange = (d: string) => (!from || d >= from) && (!to || d <= to);
  let outputVat = 0;
  let inputVat = 0;
  for (const t of txns) {
    if (!t.txn_date || !inRange(t.txn_date)) continue;
    const amt = Number(t.amount) || 0;
    if (/output vat/i.test(t.account_name)) {
      // liability: a credit raises tax owed, a debit (reversal) lowers it
      outputVat += t.txn_type === "credit" ? amt : -amt;
    } else if (/input vat/i.test(t.account_name)) {
      // asset: a debit raises recoverable tax, a credit (reversal) lowers it
      inputVat += t.txn_type === "debit" ? amt : -amt;
    }
  }
  const rate = ratePct > 0 ? ratePct : 5;
  const r = rate / 100;
  return {
    from: from ?? "",
    to: to ?? "",
    rate,
    standardSupplyNet: r ? outputVat / r : 0,
    outputVat,
    standardExpenseNet: r ? inputVat / r : 0,
    inputVat,
    netVatDue: outputVat - inputVat,
  };
}

export interface TrialBalanceRow {
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
}
export interface TrialBalance {
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
}

/** Trial balance: every account on its normal side (asset/expense = debit,
 *  liability/equity/revenue = credit); a negative balance flips sides. Debit and
 *  credit totals match when the books balance. */
export function computeTrialBalance(accounts: Account[]): TrialBalance {
  const rows: TrialBalanceRow[] = [];
  let totalDebit = 0;
  let totalCredit = 0;
  for (const a of accounts) {
    const debitNormal = a.account_type === "asset" || a.account_type === "expense";
    const bal = Number(a.balance) || 0;
    let debit = 0;
    let credit = 0;
    if (debitNormal) {
      if (bal >= 0) debit = bal;
      else credit = -bal;
    } else {
      if (bal >= 0) credit = bal;
      else debit = -bal;
    }
    if (debit === 0 && credit === 0) continue;
    rows.push({ code: a.code, name: a.name, type: a.account_type, debit, credit });
    totalDebit += debit;
    totalCredit += credit;
  }
  return { rows, totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.01 };
}

export interface BalanceSheetLine {
  code: string;
  name: string;
  amount: number;
}
export interface BalanceSheet {
  assets: BalanceSheetLine[];
  liabilities: BalanceSheetLine[];
  equity: BalanceSheetLine[];
  totalAssets: number;
  totalLiabilities: number;
  netProfit: number;
  totalEquity: number;
  balanced: boolean;
}

/** Balance sheet from account balances. Current-period profit (revenue −
 *  expense, since this ledger doesn't post closing entries) is folded into
 *  equity so Assets = Liabilities + Equity holds. */
export function computeBalanceSheet(accounts: Account[]): BalanceSheet {
  const pick = (t: string): BalanceSheetLine[] =>
    accounts
      .filter((a) => a.account_type === t)
      .map((a) => ({ code: a.code, name: a.name, amount: Number(a.balance) || 0 }));
  const sum = (xs: BalanceSheetLine[]) => xs.reduce((s, x) => s + x.amount, 0);
  const assets = pick("asset");
  const liabilities = pick("liability");
  const equityAccts = pick("equity");
  const netProfit = sum(pick("revenue")) - sum(pick("expense"));
  const totalAssets = sum(assets);
  const totalLiabilities = sum(liabilities);
  const totalEquity = sum(equityAccts) + netProfit;
  return {
    assets,
    liabilities,
    equity: [...equityAccts, { code: "", name: "Net profit (current period)", amount: netProfit }],
    totalAssets,
    totalLiabilities,
    netProfit,
    totalEquity,
    balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
  };
}

export interface CashSummary {
  inflow: number;
  outflow: number;
  net: number;
}
/** Direct cash movement over a period: debits to cash/bank accounts are
 *  inflows, credits are outflows. A simplified statement — not the categorised
 *  operating/investing/financing breakdown. */
export function computeCashSummary(
  txns: Pick<Txn, "account_name" | "txn_type" | "amount" | "txn_date">[],
  from?: string,
  to?: string
): CashSummary {
  const inRange = (d: string) => (!from || d >= from) && (!to || d <= to);
  let inflow = 0;
  let outflow = 0;
  for (const t of txns) {
    if (!t.txn_date || !inRange(t.txn_date)) continue;
    if (!/cash|bank/i.test(t.account_name)) continue;
    const amt = Number(t.amount) || 0;
    if (t.txn_type === "debit") inflow += amt;
    else outflow += amt;
  }
  return { inflow, outflow, net: inflow - outflow };
}

export const fin = {
  accounts: () =>
    readCached<Account[]>(
      "fin_accounts",
      () => sList<Account>("accounts", [{ col: "code", asc: true }]),
      []
    ),
  createAccount: (input: Omit<Account, "id">) => {
    const row = clean(input as Record<string, unknown>);
    return write({ k: "insert", t: "accounts", row }, () =>
      sInsert("accounts", row), -1
    );
  },
  updateAccount: (id: number, input: Partial<Omit<Account, "id">>) => {
    const row = clean(input as Record<string, unknown>);
    return write(
      { k: "update", t: "accounts", id, row },
      () => sUpdate("accounts", id, row),
      undefined
    );
  },
  deleteAccount: (id: number) =>
    write(
      { k: "delete", t: "accounts", id },
      async () => {
        // Reverse this account's effect on the running balances, then delete.
        const { data, error } = await sb()
          .from("accounts")
          .select("balance,account_type")
          .eq("id", id)
          .single();
        if (error) throw error;
        const acct = data as { balance: number; account_type: string } | null;
        if (acct) {
          // Reset balance to zero by posting the opposite of the current balance.
          const zeroingDelta =
            acct.account_type === "revenue" || acct.account_type === "liability"
              ? -Number(acct.balance)
              : Number(acct.balance);
          if (zeroingDelta !== 0) {
            // Find a partner account to absorb the offset. Use Sales Revenue for
            // revenue accounts, AR for assets, Operating Expenses for expenses.
            let partnerId = -1;
            if (acct.account_type === "revenue") {
              partnerId = await findOrCreateSalesAccount();
            } else if (acct.account_type === "expense") {
              partnerId = await findOrCreateExpenseAccount();
            } else {
              partnerId = await findOrCreateArAccount();
            }
            if (partnerId > 0) {
              await sInsert("transactions", {
                account_id: partnerId,
                txn_type: zeroingDelta > 0 ? "debit" : "credit",
                amount: Math.abs(zeroingDelta),
                description: "Account deletion adjustment",
                txn_date: new Date().toISOString().slice(0, 10),
                source: "system",
              });
              await adjustAccountBalance(partnerId, Math.abs(zeroingDelta));
            }
          }
        }
        await sDelete("accounts", id);
      },
      undefined
    ),
  expenses: () =>
    readCached<Expense[]>(
      "fin_expenses",
      () =>
        sList<Expense>("expenses", [{ col: "expense_date", asc: false }]),
      []
    ),
  createExpense: (
    category: string,
    description: string | null,
    amount: number,
    expenseDate: string,
    accountId: number | null
  ) => {
    const row = {
      category,
      description,
      amount,
      expense_date: expenseDate,
      account_id: accountId,
    };
    return online(async () => {
      const id = await sInsert("expenses", row);
      const targetId = accountId ?? (await findOrCreateExpenseAccount());
      const ref = `Expense ${id}`;
      if (targetId > 0) {
        await sInsert("transactions", {
          account_id: targetId,
          txn_type: "debit",
          amount,
          description: description ?? category,
          ref,
          source: "expense",
          txn_date: expenseDate,
        });
        await adjustAccountBalance(targetId, ledgerDelta("expense", "debit", amount));
        // Contra leg — expense assumed paid from Cash/Bank, so the books stay
        // balanced (debit Expense, credit Cash). On-credit spend → manual AP entry.
        const cashId = await findOrCreateCashAccount();
        if (cashId > 0) {
          await sInsert("transactions", {
            account_id: cashId,
            txn_type: "credit",
            amount,
            description: `${description ?? category} — paid`,
            ref,
            source: "expense",
            txn_date: expenseDate,
          });
          await adjustAccountBalance(cashId, ledgerDelta("asset", "credit", amount));
        }
      }
      return id;
    });
  },
  deleteExpense: (expenseId: number) =>
    write({ k: "delete", t: "expenses", id: expenseId }, () =>
      sDelete("expenses", expenseId), undefined
    ),
  transactions: () =>
    readCached<Txn[]>(
      "fin_transactions",
      async () => {
        const rows = await sList<any>(
          "transactions",
          [{ col: "txn_date", asc: false }],
          "*, accounts(name)"
        );
        // The local shim is schemaless — no embedded join — so resolve
        // account names from the accounts table when the join came back empty.
        const names = new Map<number, string>();
        if (rows.some((r) => r.account_id != null && !r.accounts?.name)) {
          const accts = await sList<any>("accounts");
          for (const a of accts) names.set(a.id, a.name);
        }
        return rows.map((r) => ({
          id: r.id,
          account_id: r.account_id,
          account_name: r.accounts?.name ?? names.get(r.account_id) ?? "—",
          txn_type: r.txn_type,
          amount: r.amount,
          description: r.description ?? undefined,
          txn_date: r.txn_date,
          reconciled_at: r.reconciled_at ?? null,
        })) as Txn[];
      },
      []
    ),
  /** Stamp book entries as reconciled against a bank statement. Per-id loop —
   *  the local shim has no .in() filter, and lists are tens of rows. */
  markReconciled: (ids: number[]) =>
    online(async () => {
      const at = new Date().toISOString();
      for (const id of ids)
        await sUpdate("transactions", id, { reconciled_at: at });
    }),
  postTransaction: (
    accountId: number,
    txnType: string,
    amount: number,
    description: string | null
  ) => {
    const row = {
      account_id: accountId,
      txn_type: txnType,
      amount,
      description,
    };
    return online(async () => {
      const id = await sInsert("transactions", row);
      // Sign depends on the account's normal balance, not a fixed credit=+ rule:
      // a debit grows an asset/expense but shrinks a liability/revenue.
      const { data: acct } = await sb()
        .from("accounts")
        .select("account_type")
        .eq("id", accountId)
        .single();
      const type = (acct as { account_type: string } | null)?.account_type ?? "asset";
      await adjustAccountBalance(accountId, ledgerDelta(type, txnType, amount));
      return id;
    });
  },
  updateTransaction: (
    id: number,
    patch: Partial<Pick<Txn, "description" | "txn_date">>
  ) =>
    write(
      { k: "update", t: "transactions", id, row: patch as Record<string, unknown> },
      () => sUpdate("transactions", id, patch as Record<string, unknown>),
      undefined
    ),
  deleteTransaction: (id: number) =>
    write(
      { k: "delete", t: "transactions", id },
      async () => {
        const { data, error } = await sb()
          .from("transactions")
          .select("account_id,txn_type,amount")
          .eq("id", id)
          .single();
        if (error) throw error;
        const t = data as {
          account_id: number;
          txn_type: string;
          amount: number;
        } | null;
        if (t?.account_id) {
          // Undo with the same type-aware delta the posting used, else asset/
          // expense legs (e.g. an invoice's AR debit) reverse the wrong way.
          const { data: a } = await sb()
            .from("accounts")
            .select("account_type")
            .eq("id", t.account_id)
            .single();
          const type = (a as { account_type: string } | null)?.account_type ?? "asset";
          await adjustAccountBalance(
            t.account_id,
            -ledgerDelta(type, t.txn_type, Number(t.amount))
          );
        }
        await sDelete("transactions", id);
      },
      undefined
    ),
  /** Repair the ledger after the legacy duplicate-posting bug: drop exact
   *  duplicate transactions (same account, type, amount, description and date —
   *  e.g. an invoice leg posted more than once) and recompute every account
   *  balance from the survivors so balances match the journal. Idempotent. */
  repairLedger: () =>
    online(async () => {
      const txns = await sList<any>("transactions", [{ col: "id", asc: true }]);
      const seen = new Set<string>();
      let removed = 0;
      for (const t of txns) {
        const key = [
          t.account_id ?? "",
          t.txn_type,
          Number(t.amount),
          t.description ?? "",
          t.txn_date ?? "",
        ].join("|");
        if (seen.has(key)) {
          await sDelete("transactions", t.id);
          removed++;
        } else {
          seen.add(key);
        }
      }
      // Recompute every account balance from the surviving transactions.
      const accts = await sList<Account>("accounts");
      const typeById = new Map(accts.map((a) => [a.id, a.account_type]));
      const bal = new Map<number, number>();
      const survivors = await sList<any>("transactions");
      for (const t of survivors) {
        if (!t.account_id) continue;
        const type = typeById.get(t.account_id) ?? "asset";
        bal.set(
          t.account_id,
          (bal.get(t.account_id) ?? 0) +
            ledgerDelta(type, t.txn_type, Number(t.amount))
        );
      }
      for (const a of accts)
        await sUpdate("accounts", a.id, { balance: bal.get(a.id) ?? 0 });
      return { removed };
    }),
  report: () =>
    readCached<FinanceReport>(
      "fin_report",
      async () => {
        const accts = await sList<Account>("accounts");
        const sumType = (t: string) =>
          accts
            .filter((a) => a.account_type === t)
            .reduce((s, a) => s + a.balance, 0);
        const revenue = sumType("revenue");
        const expenses = sumType("expense");
        const assets = sumType("asset");
        return {
          total_assets: assets,
          total_liabilities: sumType("liability"),
          total_equity: sumType("equity"),
          total_revenue: revenue,
          total_expenses: expenses,
          net_profit: revenue - expenses,
          cash_position: accts
            .filter(
              (a) =>
                a.account_type === "asset" &&
                /cash|bank/i.test(a.name)
            )
            .reduce((s, a) => s + a.balance, 0),
        };
      },
      {
        total_assets: 0,
        total_liabilities: 0,
        total_equity: 0,
        total_revenue: 0,
        total_expenses: 0,
        net_profit: 0,
        cash_position: 0,
      }
    ),
};

// ===== Tools =====
export const tools = {
  users: () =>
    readCached<User[]>(
      "tools_users",
      () => sList<User>("app_users", [{ col: "id", asc: true }]),
      []
    ),
  createUser: (username: string, fullName: string, role: string) => {
    const row = { username, full_name: fullName, role, active: true };
    return write({ k: "insert", t: "app_users", row }, () =>
      sInsert("app_users", row), -1
    );
  },
  toggleUser: (userId: number) =>
    online(async () => {
      const { data, error } = await sb()
        .from("app_users")
        .select("active")
        .eq("id", userId)
        .single();
      if (error) throw error;
      await sUpdate("app_users", userId, {
        active: !(data as { active: boolean }).active,
      });
    }),
  settings: () =>
    readCached<Setting[]>(
      "tools_settings",
      () =>
        sList<Setting>(
          "app_settings",
          [{ col: "key", asc: true }],
          "key,value"
        ),
      []
    ),
  setSetting: (key: string, value: string) =>
    online(async () => {
      const { data } = await sb()
        .from("app_settings")
        .select("id")
        .eq("key", key)
        .maybeSingle();
      const row = data as { id?: number } | null;
      if (row?.id) await sUpdate("app_settings", row.id, { value });
      else await sInsert("app_settings", { key, value });
    }),
  auditLog: () =>
    readCached<AuditEntry[]>(
      "tools_audit",
      () =>
        sList<AuditEntry>("audit_log", [{ col: "id", asc: false }]),
      []
    ),
  logAction: (
    actor: string,
    action: string,
    entity: string,
    details: string | null
  ) => {
    const row = { actor, action, entity, details };
    return write({ k: "insert", t: "audit_log", row }, () =>
      sInsert("audit_log", row).then(() => undefined),
      undefined
    );
  },
};

// ===== CRM =====
const STAGE_PROB: Record<string, number> = {
  qualification: 20,
  proposal: 45,
  negotiation: 70,
  won: 100,
  lost: 0,
};

/** Resolve a deal's stored display name back to a customer row.
 *
 *  Deals were created with `company || name` as their only link, so match on
 *  either field. Returns null when nothing matches OR when several customers
 *  share the name — an ambiguous link is worse than none, because the wrong
 *  company would silently inherit the deal's value in every forecast. */
export function matchCustomerId(
  displayName: string | null | undefined,
  customers: Pick<CrmCustomer, "id" | "name" | "company">[]
): number | null {
  const key = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  const target = key(displayName);
  if (!target) return null;
  const hits = customers.filter(
    (c) => key(c.company) === target || key(c.name) === target
  );
  return hits.length === 1 ? hits[0].id : null;
}

export const crm = {
  leads: () =>
    readCached<Lead[]>(
      "crm_leads",
      () => sList<Lead>("crm_leads", [{ col: "id", asc: false }]),
      []
    ),
  createLead: (input: Omit<Lead, "id" | "status" | "created_at">) => {
    const row = clean(input as Record<string, unknown>);
    return write({ k: "insert", t: "crm_leads", row }, () =>
      sInsert("crm_leads", row), -1
    );
  },
  setLeadStatus: (leadId: number, status: string) =>
    write(
      { k: "update", t: "crm_leads", id: leadId, row: { status } },
      () => sUpdate("crm_leads", leadId, { status }),
      undefined
    ),
  deleteLead: (leadId: number) =>
    write({ k: "delete", t: "crm_leads", id: leadId }, () =>
      sDelete("crm_leads", leadId), undefined
    ),
  convertLead: (leadId: number) =>
    online(async () => {
      const { data, error } = await sb()
        .from("crm_leads")
        .select("*")
        .eq("id", leadId)
        .single();
      if (error) throw error;
      const l = data as Lead;
      const display = l.company || l.name;
      await sInsert("crm_customers", {
        name: l.name,
        company: l.company ?? null,
        email: l.email ?? null,
        phone: l.phone ?? null,
        segment: "Converted lead",
      });
      const oppId = await sInsert("crm_opportunities", {
        title: `${display} — new opportunity`,
        customer_name: display,
        stage: "qualification",
        value: l.est_value,
        probability: 20,
        owner: l.owner ?? null,
      });
      await sUpdate("crm_leads", leadId, { status: "converted" });
      return oppId;
    }),
  customers: () =>
    readCached<CrmCustomer[]>(
      "crm_customers",
      () =>
        sList<CrmCustomer>("crm_customers", [{ col: "name", asc: true }]),
      []
    ),
  createCustomer: (input: Omit<CrmCustomer, "id" | "created_at">) => {
    const row = clean(input as Record<string, unknown>);
    return write({ k: "insert", t: "crm_customers", row }, () =>
      sInsert("crm_customers", row), -1
    );
  },
  updateCustomer: (
    id: number,
    patch: Partial<Omit<CrmCustomer, "id" | "created_at">>
  ) => {
    const row = clean(patch as Record<string, unknown>);
    return write({ k: "update", t: "crm_customers", id, row }, () =>
      sUpdate("crm_customers", id, row), undefined
    );
  },
  deleteCustomer: (customerId: number) =>
    write({ k: "delete", t: "crm_customers", id: customerId }, () =>
      sDelete("crm_customers", customerId), undefined
    ),
  opportunities: () =>
    readCached<Opportunity[]>(
      "crm_opps",
      () =>
        sList<Opportunity>("crm_opportunities", [
          { col: "id", asc: false },
        ]),
      []
    ),
  createOpportunity: (input: Omit<Opportunity, "id" | "created_at">) => {
    const row = clean(input as Record<string, unknown>);
    return write({ k: "insert", t: "crm_opportunities", row }, () =>
      sInsert("crm_opportunities", row), -1
    );
  },
  setOppStage: (oppId: number, stage: string) => {
    const patch = { stage, probability: STAGE_PROB[stage] ?? 30 };
    return write(
      { k: "update", t: "crm_opportunities", id: oppId, row: patch },
      () => sUpdate("crm_opportunities", oppId, patch),
      undefined
    );
  },
  deleteOpportunity: (oppId: number) =>
    write({ k: "delete", t: "crm_opportunities", id: oppId }, () =>
      sDelete("crm_opportunities", oppId), undefined
    ),
  activities: () =>
    readCached<Activity[]>(
      "crm_activities",
      () =>
        sList<Activity>("crm_activities", [
          { col: "done", asc: true },
          { col: "due_date", asc: true },
          { col: "id", asc: false },
        ]),
      []
    ),
  createActivity: (input: Omit<Activity, "id" | "done" | "created_at">) => {
    const row = clean(input as Record<string, unknown>);
    return write({ k: "insert", t: "crm_activities", row }, () =>
      sInsert("crm_activities", row), -1
    );
  },
  toggleActivity: (activityId: number) =>
    online(async () => {
      const { data, error } = await sb()
        .from("crm_activities")
        .select("done")
        .eq("id", activityId)
        .single();
      if (error) throw error;
      await sUpdate("crm_activities", activityId, {
        done: !(data as { done: boolean }).done,
      });
    }),
  summary: () =>
    readCached<CrmSummary>(
      "crm_summary",
      async () => {
        const [leads, opps, acts] = await Promise.all([
          sList<Lead>("crm_leads"),
          sList<Opportunity>("crm_opportunities"),
          sList<Activity>("crm_activities"),
        ]);
        const converted = leads.filter(
          (l) => l.status === "converted"
        ).length;
        return {
          open_leads: leads.filter(
            (l) => !["converted", "lost"].includes(l.status)
          ).length,
          pipeline_value: opps
            .filter((o) => !["won", "lost"].includes(o.stage))
            .reduce((s, o) => s + o.value, 0),
          won_value: opps
            .filter((o) => o.stage === "won")
            .reduce((s, o) => s + o.value, 0),
          conversion_rate: leads.length
            ? (converted / leads.length) * 100
            : 0,
          activities_due: acts.filter((a) => !a.done).length,
        };
      },
      {
        open_leads: 0,
        pipeline_value: 0,
        won_value: 0,
        conversion_rate: 0,
        activities_due: 0,
      }
    ),

  // ---------- people (contacts at a company) ----------
  people: () =>
    readCached<Person[]>(
      "crm_people",
      () => sList<Person>("crm_people", [{ col: "name", asc: true }]),
      []
    ),
  createPerson: (input: Omit<Person, "id" | "created_at">) => {
    const row = clean(input as Record<string, unknown>);
    return write({ k: "insert", t: "crm_people", row }, () =>
      sInsert("crm_people", row), -1
    );
  },
  updatePerson: (personId: number, patch: Partial<Person>) => {
    const row = clean(patch as Record<string, unknown>);
    return write(
      { k: "update", t: "crm_people", id: personId, row },
      () => sUpdate("crm_people", personId, row),
      undefined
    );
  },
  deletePerson: (personId: number) =>
    write({ k: "delete", t: "crm_people", id: personId }, () =>
      sDelete("crm_people", personId), undefined
    ),

  // ---------- notes (attach to any record) ----------
  notes: () =>
    readCached<CrmNote[]>(
      "crm_notes",
      () => sList<CrmNote>("crm_notes", [{ col: "id", asc: false }]),
      []
    ),
  addNote: (input: Omit<CrmNote, "id" | "created_at">) => {
    const row = clean(input as Record<string, unknown>);
    return write({ k: "insert", t: "crm_notes", row }, () =>
      sInsert("crm_notes", row), -1
    );
  },
  updateNote: (noteId: number, patch: Partial<CrmNote>) => {
    const row = clean(patch as Record<string, unknown>);
    return write(
      { k: "update", t: "crm_notes", id: noteId, row },
      () => sUpdate("crm_notes", noteId, row),
      undefined
    );
  },
  deleteNote: (noteId: number) =>
    write({ k: "delete", t: "crm_notes", id: noteId }, () =>
      sDelete("crm_notes", noteId), undefined
    ),

  // ---------- tasks ----------
  tasks: () =>
    readCached<CrmTask[]>(
      "crm_tasks",
      () => sList<CrmTask>("crm_tasks", [{ col: "id", asc: false }]),
      []
    ),
  addTask: (input: Omit<CrmTask, "id" | "created_at" | "status"> & { status?: string }) => {
    const row = clean({ status: "open", ...input } as Record<string, unknown>);
    return write({ k: "insert", t: "crm_tasks", row }, () =>
      sInsert("crm_tasks", row), -1
    );
  },
  updateTask: (taskId: number, patch: Partial<CrmTask>) => {
    const row = clean(patch as Record<string, unknown>);
    return write(
      { k: "update", t: "crm_tasks", id: taskId, row },
      () => sUpdate("crm_tasks", taskId, row),
      undefined
    );
  },
  /** Flip a task between done and open, stamping completed_at to match. */
  setTaskDone: (taskId: number, done: boolean) => {
    const row = {
      status: done ? "done" : "open",
      completed_at: done ? new Date().toISOString() : null,
    };
    return write(
      { k: "update", t: "crm_tasks", id: taskId, row },
      () => sUpdate("crm_tasks", taskId, row),
      undefined
    );
  },
  deleteTask: (taskId: number) =>
    write({ k: "delete", t: "crm_tasks", id: taskId }, () =>
      sDelete("crm_tasks", taskId), undefined
    ),

  /** Link deals to companies and promote merged contact names to real people.
   *  Mirrors the backfill in supabase/2026-07-26-crm-objects.sql for local
   *  mode, where that SQL never runs. Idempotent — only touches rows that are
   *  still unlinked, so it is safe to call on every load. */
  backfillLinks: () =>
    online(async () => {
      const [customers, opps, people] = await Promise.all([
        sList<CrmCustomer>("crm_customers"),
        sList<Opportunity>("crm_opportunities"),
        sList<Person>("crm_people"),
      ]);

      let linked = 0;
      for (const o of opps) {
        if (o.customer_id != null) continue;
        const id = matchCustomerId(o.customer_name, customers);
        if (id == null) continue;
        await sUpdate("crm_opportunities", o.id, { customer_id: id });
        linked++;
      }

      let promoted = 0;
      for (const c of customers) {
        const name = (c.name ?? "").trim();
        const company = (c.company ?? "").trim();
        if (!name || !company) continue;
        if (name.toLowerCase() === company.toLowerCase()) continue;
        const exists = people.some(
          (p) =>
            p.company_id === c.id &&
            (p.name ?? "").trim().toLowerCase() === name.toLowerCase()
        );
        if (exists) continue;
        await sInsert("crm_people", {
          company_id: c.id,
          name,
          email: c.email ?? null,
          phone: c.phone ?? null,
          phone_e164: c.phone_e164 ?? null,
          is_primary: true,
        });
        promoted++;
      }
      return { linked, promoted };
    }),
};

// ===== Follow-ups / reminders =====
export type FollowUpRepeat = "none" | "daily" | "weekly" | "monthly";

export interface FollowUp {
  id: number;
  customer_id?: number | null;
  customer_name?: string;
  title: string;
  due_date: string; // YYYY-MM-DD
  done: boolean;
  /** Recurrence — completing a repeating item spawns the next occurrence. */
  repeat?: FollowUpRepeat;
  created_at: string;
}

/** Next due date for a repeating follow-up (date-only math, UTC — no TZ drift). */
export function nextFollowUpDate(due: string, repeat: FollowUpRepeat): string {
  const [y, m, d] = due.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (repeat === "daily") dt.setUTCDate(dt.getUTCDate() + 1);
  else if (repeat === "weekly") dt.setUTCDate(dt.getUTCDate() + 7);
  else {
    // Monthly clamps to the target month's length (Jan 31 → Feb 28/29).
    const day = dt.getUTCDate();
    dt.setUTCDate(1);
    dt.setUTCMonth(dt.getUTCMonth() + 1);
    const max = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
    dt.setUTCDate(Math.min(day, max));
  }
  return dt.toISOString().slice(0, 10);
}

const todayISO = () => new Date().toISOString().slice(0, 10);

export const followups = {
  list: (customerId?: number) =>
    readCached<FollowUp[]>(
      customerId != null ? `follow_ups:${customerId}` : "follow_ups",
      async () => {
        let q = sb().from("follow_ups").select("*");
        if (customerId != null) q = q.eq("customer_id", customerId);
        const { data, error } = await q
          .order("done", { ascending: true })
          .order("due_date", { ascending: true });
        if (error) throw error;
        return (data ?? []) as FollowUp[];
      },
      []
    ),
  /** Open (not done) items due today or overdue — used for reminders. */
  due: async (): Promise<FollowUp[]> => {
    if (!isConfigured) return [];
    const { data } = await sb()
      .from("follow_ups")
      .select("*")
      .eq("done", false)
      .lte("due_date", todayISO())
      .order("due_date", { ascending: true });
    return (data ?? []) as FollowUp[];
  },
  create: (input: {
    title: string;
    due_date: string;
    customer_id?: number | null;
    customer_name?: string;
    repeat?: FollowUpRepeat;
  }) => {
    const row = clean(input as Record<string, unknown>);
    return write({ k: "insert", t: "follow_ups", row }, () =>
      sInsert("follow_ups", row), -1
    );
  },
  /** Mark done; a repeating item also spawns its next occurrence. */
  complete: async (f: FollowUp): Promise<void> => {
    await followups.update(f.id, { done: true });
    if (f.repeat && f.repeat !== "none")
      await followups.create({
        title: f.title,
        due_date: nextFollowUpDate(f.due_date, f.repeat),
        customer_id: f.customer_id ?? null,
        customer_name: f.customer_name || "",
        repeat: f.repeat,
      });
  },
  update: (id: number, patch: Partial<FollowUp>) => {
    const row = clean(patch as Record<string, unknown>);
    return write({ k: "update", t: "follow_ups", id, row }, () =>
      sUpdate("follow_ups", id, row), undefined
    );
  },
  remove: (id: number) =>
    write({ k: "delete", t: "follow_ups", id }, () =>
      sDelete("follow_ups", id), undefined
    ),
};

// ===== Billing / Invoicing =====
function docTotal(
  d: {
    tax_rate: number;
    discount: number;
    unit_price_formula?: { a: string; b?: string } | null;
    round_off?: boolean | null;
  },
  items: {
    qty: number;
    unit_price: number;
    custom?: Record<string, string> | null;
  }[]
) {
  return applyRoundOff(
    lineAwareTotals(
      docLineItems(items) as any,
      d.discount,
      d.tax_rate,
      d.unit_price_formula
    ),
    !!d.round_off
  ).total;
}

function docLineItems(
  items: { qty: number; unit_price: number; custom?: Record<string, string> | null }[]
) {
  return items.map((it) => {
    const { calcMode, amount, itemFormula, discount, tax } = splitItemMeta(it.custom);
    return { ...it, calcMode, amount, itemFormula, discount, tax };
  });
}

/** Net (ex-VAT, after discount), VAT amount and gross — used to split the ledger
 *  so revenue/inventory exclude VAT and the tax sits in its own account.
 *  Line-aware (per-line discount/tax from item meta) + round-off: the signed
 *  rounding adjustment lands in `net` so net + tax always equals gross. */
function docTotals(
  d: {
    tax_rate: number;
    discount: number;
    unit_price_formula?: { a: string; b?: string } | null;
    round_off?: boolean | null;
  },
  items: { qty: number; unit_price: number; custom?: Record<string, string> | null }[]
) {
  const t = applyRoundOff(
    lineAwareTotals(docLineItems(items) as any, d.discount, d.tax_rate, d.unit_price_formula),
    !!d.round_off
  );
  return { net: Math.round((t.total - t.tax) * 100) / 100, tax: t.tax, total: t.total };
}

/** Generic account lookup / auto-create. */
async function findOrCreateAccount(
  type: string,
  code: string,
  name: string,
  pattern: RegExp
): Promise<number> {
  const { data } = await sb()
    .from("accounts")
    .select("id,name")
    .eq("account_type", type);
  const list = (data as { id: number; name: string }[] | null) ?? [];
  // Match by name pattern only — no "first account of this type" fallback. That
  // fallback let e.g. the AP lookup grab an "Output VAT" liability (and vice
  // versa); a dedicated account is created instead when nothing matches.
  const acct = list.find((a) => pattern.test(a.name));
  if (acct) return acct.id;
  try {
    return await sInsert("accounts", { code, name, account_type: type, balance: 0 });
  } catch {
    return -1;
  }
}

async function findOrCreateOutputVatAccount(): Promise<number> {
  // Named without "Payable" so the AP pattern can't claim it.
  return findOrCreateAccount("liability", "2100", "Output VAT", /output vat|vat on sales|sales vat/i);
}
async function findOrCreateInputVatAccount(): Promise<number> {
  return findOrCreateAccount(
    "asset",
    "1250",
    "Input VAT",
    /input vat|vat on purchases|purchase vat|vat recoverable/i
  );
}

async function findOrCreateSalesAccount(): Promise<number> {
  return findOrCreateAccount("revenue", "4000", "Sales Revenue", /sales|revenue|income/i);
}
async function findOrCreateArAccount(): Promise<number> {
  return findOrCreateAccount(
    "asset",
    "1200",
    "Accounts Receivable",
    /receivable|debtors|ar/i
  );
}
async function findOrCreateCashAccount(): Promise<number> {
  return findOrCreateAccount(
    "asset",
    "1000",
    "Cash & Bank",
    /cash|bank/i
  );
}

async function findOrCreateExpenseAccount(): Promise<number> {
  const { data } = await sb()
    .from("accounts")
    .select("id,name")
    .eq("account_type", "expense");
  const list = (data as { id: number; name: string }[] | null) ?? [];
  const acct = list.find((a) => /operating|expense|general/i.test(a.name)) ?? list[0];
  if (acct) return acct.id;
  try {
    return await sInsert("accounts", {
      code: "5000",
      name: "Operating Expenses",
      account_type: "expense",
      balance: 0,
    });
  } catch {
    return -1;
  }
}

async function findOrCreatePayrollAccount(): Promise<number> {
  const { data } = await sb()
    .from("accounts")
    .select("id,name")
    .eq("account_type", "expense");
  const list = (data as { id: number; name: string }[] | null) ?? [];
  const acct = list.find((a) => /salary|payroll|wage/i.test(a.name)) ?? list[0];
  if (acct) return acct.id;
  try {
    return await sInsert("accounts", {
      code: "5200",
      name: "Salaries & Wages",
      account_type: "expense",
      balance: 0,
    });
  } catch {
    return -1;
  }
}

/** The signed change a posting makes to an account's (natural-positive) balance.
 *  Assets & expenses grow on a debit; liabilities, revenue & equity grow on a
 *  credit. Every ledger posting and reversal goes through this so balances stay
 *  consistent with how the Reports page sums them by type. */
function ledgerDelta(type: string, txnType: string, amount: number): number {
  const debitPositive = type === "asset" || type === "expense";
  const increases = debitPositive ? txnType === "debit" : txnType === "credit";
  return increases ? amount : -amount;
}

/** Reverse every accounting transaction linked to an invoice/PO and restore the
 *  account balances. Type-aware, so it exactly undoes each posting (an earlier
 *  fixed-sign version double-counted asset/expense legs). Used before re-posting
 *  or when a document is reverted to draft / deleted. */
async function reverseInvoiceTransactions(
  invoiceId: number | undefined,
  ref: string
): Promise<number> {
  // Match by BOTH keys. Postings made before invoice_id was tracked carry only
  // a ref; reversing by either key keeps re-finalize from leaving orphan rows
  // that pile up (the "8 invoices → 15 entries" bug). Dedup by row id so a row
  // matched on both keys isn't reversed twice.
  type TxnRow = { id: number; account_id: number | null; txn_type: string; amount: number | string };
  const rows = new Map<number, TxnRow>();
  const byRef = await sb().from("transactions").select("*").eq("ref", ref);
  if (byRef.error) throw byRef.error;
  for (const t of (byRef.data ?? []) as TxnRow[]) rows.set(t.id, t);
  if (invoiceId) {
    const byId = await sb()
      .from("transactions")
      .select("*")
      .eq("invoice_id", invoiceId);
    if (byId.error) throw byId.error;
    for (const t of (byId.data ?? []) as TxnRow[]) rows.set(t.id, t);
  }
  const txns = [...rows.values()];
  if (txns.length) {
    const accts = await sList<Account>("accounts");
    const typeById = new Map(accts.map((a) => [a.id, a.account_type]));
    for (const t of txns) {
      if (!t.account_id) continue;
      const type = typeById.get(t.account_id) ?? "asset";
      await adjustAccountBalance(
        t.account_id,
        -ledgerDelta(type, t.txn_type, Number(t.amount))
      );
    }
  }
  const delRef = await sb().from("transactions").delete().eq("ref", ref);
  if (delRef.error) throw delRef.error;
  if (invoiceId) {
    const delId = await sb()
      .from("transactions")
      .delete()
      .eq("invoice_id", invoiceId);
    if (delId.error) throw delId.error;
  }
  return txns.length;
}

/** Undo a document's Inventory (and, for sales, Orders) footprint. A sales
 *  invoice decremented stock (restore by +qty) and has a linked SO; a purchase
 *  invoice incremented stock (restore by -qty) and has no order. */
async function reverseInvoiceOrderAndStock(
  number: string,
  items: { product_id?: number; qty: number; unit_price: number }[],
  isPurchase = false
) {
  if (!isPurchase) {
    const orderNumber = `SO-${number}`;
    const { data: order } = await sb()
      .from("orders")
      .select("id")
      .eq("order_number", orderNumber)
      .maybeSingle();
    if (order?.id) {
      await sb().from("orders").delete().eq("id", order.id);
    }
  }
  const dir = isPurchase ? -1 : 1;
  for (const it of items) {
    if (!it.product_id || !it.qty) continue;
    await adjustProductStock(it.product_id, dir * Math.abs(Number(it.qty)), {
      type: isPurchase ? "purchase" : "sale",
      ref: `${isPurchase ? "Bill" : "Invoice"} ${number}`,
      note: "Posting reversed",
    });
  }
}

/** Mirror a finalized invoice into Orders, Inventory and Accounting.
 *  Reverses any previous posting first, so re-finalizing or editing an already
 *  posted invoice keeps the three modules in sync. */
async function propagateInvoice(
  doc: Record<string, unknown>,
  items: {
    product_id?: number;
    qty: number;
    unit_price: number;
    // Carries per-line meta (calc mode, manual amount, formula, per-line
    // tax/discount) so the linked order total matches the invoice exactly.
    custom?: Record<string, string> | null;
  }[]
) {
  try {
    const id = Number(doc.id ?? 0);
    const number = String(doc.number ?? "").trim();
    if (!number) return;
    const isPurchase = doc.doc_type === "purchase";
    const ref = `${isPurchase ? "Bill" : "Invoice"} ${number}`;
    const source = isPurchase ? "purchase_invoice" : "invoice";

    // 1) Reverse any previous posting for this document. Only touch stock/orders
    //    if a prior posting actually existed (else first finalize would net to 0).
    const prior = await reverseInvoiceTransactions(id || undefined, ref);
    if (prior > 0) await reverseInvoiceOrderAndStock(number, items, isPurchase);

    const { net, tax, total } = docTotals(
      { tax_rate: Number(doc.tax_rate ?? 0), discount: Number(doc.discount ?? 0) },
      items
    );
    const txnDate =
      (doc.issue_date as string) || new Date().toISOString().slice(0, 10);

    if (isPurchase) {
      // Purchase invoice (supplier bill): stock IN, debit Purchases, credit AP.
      for (const it of items) {
        if (!it.product_id || !it.qty) continue;
        const qty = Math.abs(Number(it.qty));
        // Moving average first — needs the pre-receipt on-hand quantity.
        await applyMovingAverageCost(it.product_id, qty, Number(it.unit_price) || 0);
        await adjustProductStock(it.product_id, qty, { type: "purchase", ref });
      }
      if (total > 0) {
        const inventoryId = await findOrCreateInventoryAccount();
        const apId = await findOrCreateApAccount();
        // debit Inventory (net, ex-VAT)
        if (inventoryId > 0) {
          await sInsert("transactions", {
            account_id: inventoryId,
            txn_type: "debit",
            amount: net,
            description: `${ref} — Inventory`,
            ref,
            source,
            invoice_id: id || null,
            txn_date: txnDate,
          });
          await adjustAccountBalance(inventoryId, ledgerDelta("asset", "debit", net));
        }
        // debit Input VAT (recoverable) for the tax portion
        if (tax > 0) {
          const vatId = await findOrCreateInputVatAccount();
          if (vatId > 0) {
            await sInsert("transactions", {
              account_id: vatId,
              txn_type: "debit",
              amount: tax,
              description: `${ref} — Input VAT`,
              ref,
              source,
              invoice_id: id || null,
              txn_date: txnDate,
            });
            await adjustAccountBalance(vatId, ledgerDelta("asset", "debit", tax));
          }
        }
        // credit Accounts Payable (gross — what we owe the supplier)
        if (apId > 0) {
          await sInsert("transactions", {
            account_id: apId,
            txn_type: "credit",
            amount: total,
            description: `${ref} — Accounts Payable`,
            ref,
            source,
            invoice_id: id || null,
            txn_date: txnDate,
          });
          await adjustAccountBalance(apId, ledgerDelta("liability", "credit", total));
        }
      }
      return;
    }

    // Sales invoice: linked sales order + stock OUT + debit AR / credit Sales.
    await sInsert("orders", {
      order_number: `SO-${number}`,
      customer_name: doc.customer_name ?? "—",
      customer_id: (doc.customer_id as number | undefined) ?? null,
      status: "completed",
      total,
    });
    for (const it of items) {
      if (!it.product_id || !it.qty) continue;
      await adjustProductStock(it.product_id, -Math.abs(Number(it.qty)), {
        type: "sale",
        ref,
      });
    }
    // COGS: relieve Inventory at cost and book the cost of the sale. Only
    // product-linked lines have a cost; free-text lines are skipped. Tagged with
    // this invoice's ref/id so it reverses with the rest on revert.
    {
      const products = await sList<Product>("products");
      const costById = new Map(products.map((p) => [p.id, Number(p.cost_price) || 0]));
      let cogs = 0;
      for (const it of items) {
        if (!it.product_id || !it.qty) continue;
        cogs += (costById.get(it.product_id) ?? 0) * Math.abs(Number(it.qty));
      }
      cogs = Math.round(cogs * 100) / 100;
      if (cogs > 0) {
        const cogsId = await findOrCreateCogsAccount();
        const invId = await findOrCreateInventoryAccount();
        if (cogsId > 0) {
          await sInsert("transactions", {
            account_id: cogsId,
            txn_type: "debit",
            amount: cogs,
            description: `${ref} — Cost of Goods Sold`,
            ref,
            source,
            invoice_id: id || null,
            txn_date: txnDate,
          });
          await adjustAccountBalance(cogsId, ledgerDelta("expense", "debit", cogs));
        }
        if (invId > 0) {
          await sInsert("transactions", {
            account_id: invId,
            txn_type: "credit",
            amount: cogs,
            description: `${ref} — Inventory (COGS)`,
            ref,
            source,
            invoice_id: id || null,
            txn_date: txnDate,
          });
          await adjustAccountBalance(invId, ledgerDelta("asset", "credit", cogs));
        }
      }
    }
    if (total > 0) {
      const revenueId = await findOrCreateSalesAccount();
      const arId = await findOrCreateArAccount();
      // credit Sales Revenue (net, ex-VAT)
      if (revenueId > 0) {
        await sInsert("transactions", {
          account_id: revenueId,
          txn_type: "credit",
          amount: net,
          description: `${ref} — Sales Revenue`,
          ref,
          source,
          invoice_id: id || null,
          txn_date: txnDate,
        });
        await adjustAccountBalance(revenueId, ledgerDelta("revenue", "credit", net));
      }
      // credit Output VAT (liability owed to the tax authority)
      if (tax > 0) {
        const vatId = await findOrCreateOutputVatAccount();
        if (vatId > 0) {
          await sInsert("transactions", {
            account_id: vatId,
            txn_type: "credit",
            amount: tax,
            description: `${ref} — Output VAT`,
            ref,
            source,
            invoice_id: id || null,
            txn_date: txnDate,
          });
          await adjustAccountBalance(vatId, ledgerDelta("liability", "credit", tax));
        }
      }
      // debit Accounts Receivable (gross — what the customer owes)
      if (arId > 0) {
        await sInsert("transactions", {
          account_id: arId,
          txn_type: "debit",
          amount: total,
          description: `${ref} — Accounts Receivable`,
          ref,
          source,
          invoice_id: id || null,
          txn_date: txnDate,
        });
        await adjustAccountBalance(arId, ledgerDelta("asset", "debit", total));
      }
    }
  } catch (e) {
    console.error("Invoice propagation failed:", e);
  }
}

/** Remove an invoice's footprint from Orders, Inventory and Accounting. */
async function unpropagateInvoice(
  doc: Record<string, unknown>,
  items: { product_id?: number; qty: number; unit_price: number }[]
) {
  try {
    const id = Number(doc.id ?? 0);
    const number = String(doc.number ?? "").trim();
    if (!number) return;
    const isPurchase = doc.doc_type === "purchase";
    const ref = `${isPurchase ? "Bill" : "Invoice"} ${number}`;
    const prior = await reverseInvoiceTransactions(id || undefined, ref);
    if (prior > 0) await reverseInvoiceOrderAndStock(number, items, isPurchase);
  } catch (e) {
    console.error("Invoice unpropagation failed:", e);
  }
}

async function findOrCreateApAccount(): Promise<number> {
  return findOrCreateAccount(
    "liability",
    "2000",
    "Accounts Payable",
    /payable|creditors|ap\b/i
  );
}
/** Inventory as a balance-sheet asset — stock you've bought to resell. The cost
 *  sits here until the goods are sold (then it becomes COGS). */
async function findOrCreateInventoryAccount(): Promise<number> {
  return findOrCreateAccount("asset", "1300", "Inventory", /inventory|stock/i);
}
async function findOrCreateCogsAccount(): Promise<number> {
  return findOrCreateAccount("expense", "5050", "Cost of Goods Sold", /cost of goods|cogs/i);
}

/** A purchase order's accounting footprint, posted when it's received/done:
 *  debit Inventory (net, ex-VAT), debit Input VAT (recoverable tax portion),
 *  credit Accounts Payable (gross — what we owe the supplier). The stored PO
 *  `total` is the net subtotal (Σ qty × unit_cost); VAT is derived from the
 *  PO's `tax_rate`. Idempotent — reverses any prior posting for this PO before
 *  re-posting. Stock is handled separately by pos.receive. */
async function propagatePurchase(doc: Record<string, unknown>) {
  try {
    const number = String(doc.po_number ?? "").trim();
    if (!number) return;
    const ref = `PO ${number}`;
    await reverseInvoiceTransactions(undefined, ref); // clear prior posting
    const net = Number(doc.total ?? 0); // PO total is the net subtotal, ex-VAT
    if (net <= 0) return;
    const rate = Number(doc.tax_rate ?? 0);
    const tax = rate > 0 ? Math.round(net * rate) / 100 : 0; // recoverable Input VAT
    const gross = net + tax; // what we owe the supplier
    const txnDate =
      (doc.order_date as string) || new Date().toISOString().slice(0, 10);
    const inventoryId = await findOrCreateInventoryAccount();
    const apId = await findOrCreateApAccount();
    // debit Inventory (net, ex-VAT)
    if (inventoryId > 0) {
      await sInsert("transactions", {
        account_id: inventoryId,
        txn_type: "debit",
        amount: net,
        description: `${ref} — Inventory`,
        ref,
        source: "purchase",
        txn_date: txnDate,
      });
      await adjustAccountBalance(inventoryId, ledgerDelta("asset", "debit", net));
    }
    // debit Input VAT (recoverable) for the tax portion
    if (tax > 0) {
      const vatId = await findOrCreateInputVatAccount();
      if (vatId > 0) {
        await sInsert("transactions", {
          account_id: vatId,
          txn_type: "debit",
          amount: tax,
          description: `${ref} — Input VAT`,
          ref,
          source: "purchase",
          txn_date: txnDate,
        });
        await adjustAccountBalance(vatId, ledgerDelta("asset", "debit", tax));
      }
    }
    // credit Accounts Payable (gross — net + recoverable VAT)
    if (apId > 0) {
      await sInsert("transactions", {
        account_id: apId,
        txn_type: "credit",
        amount: gross,
        description: `${ref} — Accounts Payable`,
        ref,
        source: "purchase",
        txn_date: txnDate,
      });
      await adjustAccountBalance(apId, ledgerDelta("liability", "credit", gross));
    }
  } catch (e) {
    console.error("Purchase propagation failed:", e);
  }
}

/** Remove a purchase order's accounting footprint (reverted to draft/deleted). */
async function unpropagatePurchase(doc: Record<string, unknown>) {
  try {
    const number = String(doc.po_number ?? "").trim();
    if (!number) return;
    await reverseInvoiceTransactions(undefined, `PO ${number}`);
  } catch (e) {
    console.error("Purchase unpropagation failed:", e);
  }
}

/** A purchase order is "done" (posts to accounting) once received/completed. */
const PO_DONE = (status: unknown) =>
  status === "received" || status === "completed";

export const billing = {
  listDocs: (docType: "sales" | "purchase" = "sales") =>
    readCached<InvoiceDocSummary[]>(
      `billing_docs:${docType}`,
      async () => {
        const [allDocs, items, payments] = await Promise.all([
          sList<any>("invoice_docs", [
            { col: "issue_date", asc: false },
            { col: "id", asc: false },
          ]),
          sList<any>("invoice_doc_items"),
          sList<any>("invoice_payments"),
        ]);
        // Only explicit "purchase" rows are purchase invoices; everything else
        // (including legacy rows whose doc_type held a title) is a sales doc.
        const docs = allDocs.filter(
          (d) => (d.doc_type === "purchase" ? "purchase" : "sales") === docType
        );
        const byDoc = new Map<number, any[]>();
        for (const it of items) {
          const a = byDoc.get(it.invoice_id) ?? [];
          a.push(it);
          byDoc.set(it.invoice_id, a);
        }
        const paidByDoc = new Map<number, number>();
        for (const p of payments)
          paidByDoc.set(
            p.invoice_id,
            (paidByDoc.get(p.invoice_id) ?? 0) + Number(p.amount)
          );
        return docs.map((d) => {
          const total = docTotal(d, byDoc.get(d.id) ?? []);
          const paid = paidByDoc.get(d.id) ?? 0;
          return {
            id: d.id,
            number: d.number,
            customer_name: d.customer_name,
            status: d.status,
            template: d.template,
            total,
            currency: d.currency ?? "AED",
            paid,
            balance: Math.max(0, total - paid),
            issue_date: d.issue_date ?? undefined,
            due_date: d.due_date ?? undefined,
            shared: d.shared ?? undefined,
            updated_at: d.updated_at,
            tax_rate: d.tax_rate ?? undefined,
          };
        }) as InvoiceDocSummary[];
      },
      []
    ),
  getDoc: (docId: number) =>
    readCached<InvoiceDoc>(
      `invoice_doc:${docId}`,
      async () => {
        const { data: d, error } = await sb()
          .from("invoice_docs")
          .select("*")
          .eq("id", docId)
          .single();
        if (error) throw error;
        const items = await sList<any>(
          "invoice_doc_items",
          [
            { col: "position", asc: true },
            { col: "id", asc: true },
          ]
        );
        return {
          ...(d as InvoiceDoc),
          items: items
            .filter((i) => i.invoice_id === docId)
            .map((i) => ({
              id: i.id,
              description: i.description,
              qty: i.qty,
              unit_price: i.unit_price,
              unit: i.unit || undefined,
              custom: (i.custom as Record<string, string>) || undefined,
              product_id: i.product_id ?? undefined,
              tax_category: i.tax_category || undefined,
            })),
        } as InvoiceDoc;
      },
      null as unknown as InvoiceDoc
    ),
  saveDoc: (input: InvoiceDocInput) =>
    online(async () => {
      const { items, id, ...docFields } = input;
      const row = clean(docFields as Record<string, unknown>);
      // Freeze the FX rate (AED per unit) the first time a non-AED invoice is
      // saved, so its AED-equivalent doesn't drift with live rates afterward.
      // Best-effort + cached (lib/exchange-rates); never blocks the save.
      const cur = String(row.currency ?? "AED");
      if (cur !== "AED" && !row.fx_rate) {
        try {
          const rates = await getExchangeRates();
          if (rates[cur] > 0) row.fx_rate = rates[cur];
        } catch (e) {
          console.warn("FX freeze skipped:", e);
        }
      }
      let docId: number;
      if (id && id > 0) {
        await sUpdate("invoice_docs", id, row);
        const { error } = await sb()
          .from("invoice_doc_items")
          .delete()
          .eq("invoice_id", id);
        if (error) throw error;
        docId = id;
      } else {
        await checkFreeInvoiceCap(invoicesThisMonth);
        docId = await sInsert("invoice_docs", row);
      }
      if (items.length) {
        const { error } = await sb()
          .from("invoice_doc_items")
          .insert(
            items.map((it, i) => ({
              invoice_id: docId,
              description: it.description,
              qty: it.qty,
              unit_price: it.unit_price,
              unit: it.unit || undefined,
              custom: it.custom || undefined,
              tax_category: it.tax_category || undefined,
              position: i,
              product_id: it.product_id ?? null,
            }))
          );
        if (error) throw error;
      }
      // Keep Orders, Inventory and Accounting in sync with the invoice state.
      // Pass the saved id so postings carry invoice_id and can be reversed.
      // Idempotent + best-effort: failures are logged but never block saving.
      const docRow: Record<string, unknown> = {
        ...(row as Record<string, unknown>),
        id: docId,
      };
      if (String(docRow.status ?? "") === "sent") {
        await propagateInvoice(docRow, items);
      } else {
        await unpropagateInvoice(docRow, items);
      }
      return docId;
    }),
  deleteDoc: (docId: number) =>
    write({ k: "delete", t: "invoice_docs", id: docId }, async () => {
      const { data: doc, error } = await sb()
        .from("invoice_docs")
        .select("*")
        .eq("id", docId)
        .single();
      if (error) throw error;
      const items = await sList<any>("invoice_doc_items");
      await sDelete("invoice_docs", docId);
      await unpropagateInvoice(
        doc as Record<string, unknown>,
        items
          .filter((i) => i.invoice_id === docId)
          .map((i) => ({
            product_id: i.product_id ?? undefined,
            qty: i.qty,
            unit_price: i.unit_price,
          }))
      );
      // Restore any advance credit this invoice had consumed — otherwise the
      // negative `applied:inv#<id>` ledger row outlives the invoice and the
      // customer's credit stays reduced by a document that no longer exists.
      try {
        const tag = `applied:inv#${docId}`;
        const advs = await sList<any>("advances");
        for (const a of advs) if (a.note === tag) await sDelete("advances", a.id);
      } catch {
        /* best-effort — never block the delete */
      }
      return undefined;
    }, undefined),
  setStatus: (docId: number, status: string) =>
    write(
      { k: "update", t: "invoice_docs", id: docId, row: { status } },
      async () => {
        const { data: doc, error } = await sb()
          .from("invoice_docs")
          .select("*")
          .eq("id", docId)
          .single();
        if (error) throw error;
        const items = await sList<any>("invoice_doc_items");
        await sUpdate("invoice_docs", docId, { status });
        const docItems = items
          .filter((i) => i.invoice_id === docId)
          .map((i) => ({
            product_id: i.product_id ?? undefined,
            qty: i.qty,
            unit_price: i.unit_price,
            custom: i.custom ?? undefined, // keep meta so the order total matches
          }));
        if (status === "sent") {
          await propagateInvoice(doc as Record<string, unknown>, docItems);
        } else {
          await unpropagateInvoice(doc as Record<string, unknown>, docItems);
        }
      },
      undefined
    ),
  shareDoc: (docId: number, shared: boolean) =>
    online(() =>
      shareWithItems(
        "invoice_docs",
        "invoice_doc_items",
        "invoice_id",
        docId,
        shared
      )
    ),
  /** Ensure the invoice is shared and return its public portal token. */
  publicLink: (docId: number) =>
    online(async () => {
      if (isLocalMode())
        throw new Error("Public links need Cloud mode — they don't work offline.");
      await shareWithItems(
        "invoice_docs",
        "invoice_doc_items",
        "invoice_id",
        docId,
        true
      );
      const { data, error } = await sb()
        .from("invoice_docs")
        .select("share_token")
        .eq("id", docId)
        .single();
      if (error) throw error;
      return (data as { share_token: string }).share_token;
    }),
  // ----- payments -----
  payments: (invoiceId: number) =>
    online(async () => {
      const { data, error } = await sb()
        .from("invoice_payments")
        .select("*")
        .eq("invoice_id", invoiceId)
        .order("paid_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as InvoicePayment[];
    }),
  addPayment: (
    invoiceId: number,
    amount: number,
    method: string | null,
    paidAt: string
  ) =>
    online(async () => {
      const { data: pay } = await sb()
        .from("invoice_payments")
        .insert({
          invoice_id: invoiceId,
          amount,
          method: method ?? null,
          paid_at: paidAt,
        })
        .select("id")
        .single();
      const paymentId = (pay as { id: number } | null)?.id;

      // Auto-mark the invoice paid once the balance is cleared.
      const [{ data: doc }, items, { data: pays }] = await Promise.all([
        sb().from("invoice_docs").select("*").eq("id", invoiceId).single(),
        sList<any>("invoice_doc_items"),
        sb()
          .from("invoice_payments")
          .select("amount")
          .eq("invoice_id", invoiceId),
      ]);
      const docRow = doc as InvoiceDoc;
      const total = docTotal(
        docRow,
        (
          items as {
            invoice_id: number;
            qty: number;
            unit_price: number;
            custom?: Record<string, string> | null;
          }[]
        ).filter((i) => i.invoice_id === invoiceId)
      );
      const paid = ((pays as { amount: number | string }[]) ?? []).reduce(
        (s, p) => s + Number(p.amount),
        0
      );
      const status =
        paid >= total - 0.005 ? "paid" : docRow.status === "paid" ? "sent" : docRow.status;
      if (status !== docRow.status)
        await sUpdate("invoice_docs", invoiceId, { status });

      // Post the cash receipt to accounting: debit Cash/Bank, credit AR.
      const ref = `Invoice ${docRow?.number ?? invoiceId} Payment`;
      const cashId = await findOrCreateCashAccount();
      const arId = await findOrCreateArAccount();
      if (cashId > 0) {
        await sInsert("transactions", {
          account_id: cashId,
          txn_type: "debit",
          amount,
          description: `${ref} — Cash/Bank`,
          ref,
          source: "payment",
          invoice_id: invoiceId,
          txn_date: paidAt,
        });
        await adjustAccountBalance(cashId, ledgerDelta("asset", "debit", amount));
      }
      if (arId > 0) {
        await sInsert("transactions", {
          account_id: arId,
          txn_type: "credit",
          amount,
          description: `${ref} — AR reduction`,
          ref,
          source: "payment",
          invoice_id: invoiceId,
          txn_date: paidAt,
        });
        await adjustAccountBalance(arId, ledgerDelta("asset", "credit", amount));
      }
      return paymentId;
    }),
  removePayment: (id: number) =>
    online(async () => {
      const { data: p, error } = await sb()
        .from("invoice_payments")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      const invoiceId = (p as { invoice_id?: number } | null)?.invoice_id;
      await sDelete("invoice_payments", id);
      if (invoiceId) {
        // Reverse the accounting entries for this payment.
        const { data: doc } = await sb()
          .from("invoice_docs")
          .select("number,status")
          .eq("id", invoiceId)
          .single();
        const docMeta = doc as { number?: string; status?: string } | null;
        const ref = `Invoice ${docMeta?.number ?? invoiceId} Payment`;
        await reverseInvoiceTransactions(invoiceId, ref);
        // If the invoice was fully paid, move it back to sent.
        if (docMeta?.status === "paid") {
          await sUpdate("invoice_docs", invoiceId, { status: "sent" });
        }
      }
    }),
  getCompany: () =>
    readCached<CompanyProfile>(
      "company_profile",
      async () => {
        // One row per org; RLS scopes the read to the caller's org.
        const { data, error } = await sb()
          .from("company_profile")
          .select("*")
          .maybeSingle();
        if (error) throw error;
        if (data) {
          const c = data as CompanyProfile;
          return {
            name: c.name,
            business_type: c.business_type ?? undefined,
            address: c.address ?? undefined,
            city: c.city ?? undefined,
            zip: c.zip ?? undefined,
            trn: c.trn ?? undefined,
            vat_number: c.vat_number ?? undefined,
            tax_type: c.tax_type ?? "VAT",
            email: c.email ?? undefined,
            phone: c.phone ?? undefined,
            website: c.website ?? undefined,
            currency: c.currency ?? "AED",
            default_tax_rate:
              c.default_tax_rate == null ? 5 : Number(c.default_tax_rate),
            logo: c.logo ?? undefined,
            default_accent: c.default_accent,
            default_template: c.default_template,
          };
        }
        return {
          name: "My Company",
          address: "",
          trn: "",
          email: "",
          phone: "",
          tax_type: "VAT",
          currency: "AED",
          default_tax_rate: 5,
          default_accent: "#222222",
          default_template: "minimal",
        };
      },
      {
        name: "My Company",
        tax_type: "VAT",
        currency: "AED",
        default_tax_rate: 5,
        default_accent: "#222222",
        default_template: "minimal",
      }
    ),
  saveCompany: async (input: CompanyProfile) => {
    if (!isConfigured) throw new Error("Cloud storage is not configured.");
    // Local mode writes straight to the on-device store — no network required.
    if (!isLocalMode() && !onLine())
      throw new Error(
        "You're offline. Company details need a connection to save."
      );
    await flushOutbox();
    const row = clean(input as unknown as Record<string, unknown>);
    // One profile per org. Update the existing row if present, else insert
    // (org_id/user_id fill from defaults). RLS permits writes for org
    // owners/admins only — so verify the write actually touched a row and
    // surface a clear reason instead of silently "succeeding".
    const { data, error: selErr } = await sb()
      .from("company_profile")
      .select("id")
      .maybeSingle();
    if (selErr) throw selErr;
    if (data) {
      const { data: updated, error } = await sb()
        .from("company_profile")
        .update(row)
        .eq("id", (data as { id: number }).id)
        .select("id");
      if (error) throw error;
      if (!updated || updated.length === 0)
        throw new Error(
          "You don't have permission to edit company details — only an organization owner or admin can. (Switch to your own workspace, or ask an admin.)"
        );
    } else {
      const { error } = await sb()
        .from("company_profile")
        .insert(row)
        .select("id")
        .single();
      if (error) throw error;
    }
    await cacheSet(`${activeCacheOrg}:company_profile`, input);
  },
};

// ===== Quoting =====
export interface QuotationItem {
  id?: number;
  product: string;
  product_id?: number;
  sku?: string;
  qty: number;
  rate: number;
  discount: number; // percent
  tax: number; // percent
  unit?: string;
  custom?: Record<string, string>;
}
export interface QuotationSummary {
  id: number;
  number: string;
  customer_name: string;
  status: string;
  template: string;
  total: number;
  quote_date?: string;
  valid_until?: string;
  shared?: boolean;
  updated_at: string;
}
export interface QuotationDoc {
  id: number;
  number: string;
  status: string;
  template: string;
  accent: string;
  currency: string;
  quote_date?: string;
  valid_until?: string;
  sales_person?: string;
  customer_id?: number;
  customer_name: string;
  customer_address?: string;
  customer_trn?: string;
  customer_email?: string;
  terms?: string;
  notes?: string;
  doc_title?: string;
  custom_columns?: { key: string; label: string }[];
  unit_price_formula?: { a: string; b: string } | null;
  discount?: number;
  tax_rate?: number;
  shared?: boolean;
  share_token?: string;
  logo?: string;
  seller_name?: string;
  seller_address?: string;
  seller_trn?: string;
  seller_email?: string;
  seller_phone?: string;
  created_at: string;
  updated_at: string;
  items: QuotationItem[];
  show_stamp?: boolean;
  show_logo?: boolean;
  show_signature?: boolean;
}
export type QuotationInput = Omit<
  QuotationDoc,
  "id" | "created_at" | "updated_at"
> & { id?: number };
export interface QuoteTemplate {
  id: number;
  name: string;
  base_template: string;
  created_at: string;
}
export interface ToolRun {
  id: number;
  tool: string;
  tool_name: string;
  file_name: string;
  storage_paths?: string[];
  size_bytes?: number;
  created_at: string;
}

// ===== RECURRING INVOICES (#17) =====
export interface Recurrence {
  id: number;
  base_invoice_id: number;
  interval: "weekly" | "monthly" | "yearly";
  next_run: string;
  last_run?: string | null;
  active: boolean;
}

// All-UTC so the YYYY-MM-DD in == YYYY-MM-DD out (mixing local Date with
// toISOString() shifts a day in UTC-negative zones). Month/year steps clamp
// to the target month's last day, so Jan 31 +1mo = Feb 28/29, not Mar 3.
export function addInterval(dateISO: string, interval: string): string {
  const d = new Date(dateISO + "T00:00:00Z");
  if (interval === "weekly") {
    d.setUTCDate(d.getUTCDate() + 7);
  } else {
    const day = d.getUTCDate();
    d.setUTCDate(1); // avoid overflow while we shift the month/year
    if (interval === "yearly") d.setUTCFullYear(d.getUTCFullYear() + 1);
    else d.setUTCMonth(d.getUTCMonth() + 1);
    const lastDay = new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
    ).getUTCDate();
    d.setUTCDate(Math.min(day, lastDay));
  }
  return d.toISOString().slice(0, 10);
}

export const recurrences = {
  list: () =>
    online(async () => {
      const { data, error } = await sb()
        .from("invoice_recurrence")
        .select("*")
        .order("next_run", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Recurrence[];
    }),
  create: (baseInvoiceId: number, interval: Recurrence["interval"]) =>
    online(() =>
      sInsert("invoice_recurrence", {
        base_invoice_id: baseInvoiceId,
        interval,
        next_run: addInterval(todayISO(), interval),
      })
    ),
  cancel: (id: number) =>
    online(async () => {
      await sUpdate("invoice_recurrence", id, { active: false });
    }),
  /** Generate any invoices whose recurrence is due; returns how many were created. */
  generateDue: () =>
    online(async () => {
      const { data } = await sb()
        .from("invoice_recurrence")
        .select("*")
        .eq("active", true);
      const today = todayISO();
      const due = ((data ?? []) as Recurrence[]).filter((r) => r.next_run <= today);
      let made = 0;
      for (const r of due) {
        const base = await billing.getDoc(r.base_invoice_id).catch(() => null);
        if (!base) {
          await sUpdate("invoice_recurrence", r.id, { active: false });
          continue;
        }
        const input: InvoiceDocInput = {
          number: `${base.number || "INV"}-${today.replace(/-/g, "")}`,
          status: "draft",
          template: base.template,
          accent: base.accent,
          currency: base.currency,
          seller_name: base.seller_name,
          seller_address: base.seller_address,
          seller_trn: base.seller_trn,
          seller_email: base.seller_email,
          seller_phone: base.seller_phone,
          logo: base.logo,
          customer_id: base.customer_id,
          customer_name: base.customer_name,
          customer_address: base.customer_address,
          customer_trn: base.customer_trn,
          customer_email: base.customer_email,
          issue_date: today,
          notes: base.notes,
          terms: base.terms,
          tax_rate: base.tax_rate,
          discount: base.discount,
          items: base.items.map((it) => ({
            description: it.description,
            qty: it.qty,
            unit_price: it.unit_price,
            product_id: it.product_id,
          })),
        };
        await billing.saveDoc(input);
        // Advance next_run past today: if the recurrence lagged several
        // intervals (app unopened for a while), stepping one interval at a
        // time would re-fire on every load and mint duplicate invoices with
        // the same date-suffixed number. Missed occurrences are skipped, not
        // back-filled — one invoice per catch-up.
        let next = addInterval(r.next_run, r.interval);
        while (next <= today) next = addInterval(next, r.interval);
        await sUpdate("invoice_recurrence", r.id, {
          next_run: next,
          last_run: today,
        });
        made++;
      }
      return made;
    }),
};

const quoteTotal = (items: QuotationItem[]) =>
  quotationTotals(items).total;

export const quotes = {
  listDocs: () =>
    readCached<QuotationSummary[]>(
      "quotation_docs",
      async () => {
        const [docs, items] = await Promise.all([
          sList<any>("quotations", [
            { col: "quote_date", asc: false },
            { col: "id", asc: false },
          ]),
          sList<any>("quotation_items"),
        ]);
        const byDoc = new Map<number, any[]>();
        for (const it of items) {
          const a = byDoc.get(it.quotation_id) ?? [];
          a.push(it);
          byDoc.set(it.quotation_id, a);
        }
        return docs.map((d) => ({
          id: d.id,
          number: d.number,
          customer_name: d.customer_name,
          status: d.status,
          template: d.template,
          shared: d.shared ?? false,
          total: quoteTotal(byDoc.get(d.id) ?? []),
          quote_date: d.quote_date ?? undefined,
          valid_until: d.valid_until ?? undefined,
          updated_at: d.updated_at,
        })) as QuotationSummary[];
      },
      []
    ),
  getDoc: (docId: number) =>
    readCached<QuotationDoc>(
      `quotation_doc:${docId}`,
      async () => {
        const { data: d, error } = await sb()
          .from("quotations")
          .select("*")
          .eq("id", docId)
          .single();
        if (error) throw error;
        const items = await sList<any>("quotation_items", [
          { col: "position", asc: true },
          { col: "id", asc: true },
        ]);
        return {
          ...(d as QuotationDoc),
          custom_columns: Array.isArray(d.custom_columns) ? d.custom_columns : [],
          unit_price_formula: d.unit_price_formula || null,
          items: items
            .filter((i) => i.quotation_id === docId)
            .map((i) => ({
              id: i.id,
              product: i.product,
              sku: i.sku ?? undefined,
              product_id: i.product_id ?? undefined,
              qty: i.qty,
              rate: i.rate,
              discount: i.discount,
              tax: i.tax,
              unit: i.unit ?? undefined,
              custom: (i.custom as Record<string, string>) ?? undefined,
            })),
        } as QuotationDoc;
      },
      null as unknown as QuotationDoc
    ),
  saveDoc: (input: QuotationInput) =>
    online(async () => {
      const { items, id, ...docFields } = input;
      const row = clean(docFields as Record<string, unknown>);
      let docId: number;
      if (id && id > 0) {
        await sUpdate("quotations", id, row);
        const { error } = await sb()
          .from("quotation_items")
          .delete()
          .eq("quotation_id", id);
        if (error) throw error;
        docId = id;
      } else {
        docId = await sInsert("quotations", row);
      }
      if (items.length) {
        const { error } = await sb()
          .from("quotation_items")
          .insert(
            items.map((it, i) => ({
              quotation_id: docId,
              product: it.product,
              sku: it.sku ?? null,
              product_id: it.product_id ?? null,
              qty: it.qty,
              rate: it.rate,
              discount: it.discount,
              tax: it.tax,
              unit: it.unit ?? null,
              custom: it.custom ?? null,
              position: i,
            }))
          );
        if (error) throw error;
      }
      return docId;
    }),
  deleteDoc: (docId: number) =>
    write({ k: "delete", t: "quotations", id: docId }, () =>
      sDelete("quotations", docId), undefined
    ),
  setStatus: (docId: number, status: string) =>
    write(
      { k: "update", t: "quotations", id: docId, row: { status } },
      () => sUpdate("quotations", docId, { status }),
      undefined
    ),
  shareDoc: (docId: number, shared: boolean) =>
    online(() =>
      shareWithItems(
        "quotations",
        "quotation_items",
        "quotation_id",
        docId,
        shared
      )
    ),
  publicLink: async (docId: number) => {
    if (isLocalMode())
      throw new Error("Public links need Cloud mode — they don't work offline.");
    await quotes.shareDoc(docId, true);
    const { data, error } = await sb()
      .from("quotations")
      .select("share_token")
      .eq("id", docId)
      .single();
    if (error) throw error;
    return (data as { share_token: string }).share_token;
  },
  convertToInvoice: (quotationId: number) =>
    online(async () => {
      const { data: q, error } = await sb()
        .from("quotations")
        .select("*")
        .eq("id", quotationId)
        .single();
      if (error) throw error;
      const qd = q as QuotationDoc;
      const qItems = await sList<any>(
        "quotation_items",
        [{ col: "position", asc: true }]
      );
      const items = qItems.filter((i) => i.quotation_id === quotationId);
      const company = await billing.getCompany().catch(() => null);
      const y = new Date().getFullYear();
      const number = `INV-${y}-${String(
        Math.floor(Math.random() * 9000) + 1000
      )}`;
      const issue = new Date().toISOString().slice(0, 10);
      const due = new Date(Date.now() + 30 * 86400000)
        .toISOString()
        .slice(0, 10);
      await checkFreeInvoiceCap(invoicesThisMonth);
      const docId = await sInsert("invoice_docs", {
        number,
        status: "draft",
        template: company?.default_template ?? "minimal",
        accent: company?.default_accent ?? "#0A0A0A",
        currency: qd.currency,
        seller_name: company?.name ?? "",
        seller_address: company?.address ?? null,
        seller_trn: company?.trn ?? null,
        seller_email: company?.email ?? null,
        seller_phone: company?.phone ?? null,
        logo: company?.logo ?? null,
        customer_id: qd.customer_id ?? null,
        customer_name: qd.customer_name,
        customer_address: qd.customer_address ?? null,
        customer_trn: qd.customer_trn ?? null,
        customer_email: qd.customer_email ?? null,
        issue_date: issue,
        due_date: due,
        notes: null,
        terms: qd.terms ?? null,
        tax_rate: company?.default_tax_rate ?? 5,
        discount: 0,
        quotation_id: quotationId,
      });
      if (items.length) {
        const { error: itemsErr } = await sb()
          .from("invoice_doc_items")
          .insert(
            items.map((it, i) => ({
              invoice_id: docId,
              product_id: it.product_id ?? null,
              description: it.sku
                ? `${it.product} (${it.sku})`
                : it.product,
              qty: it.qty,
              unit_price:
                Number(it.rate) * (1 - Number(it.discount || 0) / 100),
              position: i,
            }))
          );
        if (itemsErr) throw itemsErr;
      }
      await sUpdate("quotations", quotationId, { status: "accepted" });
      return docId;
    }),
};

export const quoteTemplates = {
  list: () =>
    readCached<QuoteTemplate[]>(
      "quotation_templates",
      () =>
        sList<QuoteTemplate>("quotation_templates", [
          { col: "id", asc: false },
        ]),
      []
    ),
  create: (name: string, baseTemplate: string) => {
    const row = { name, base_template: baseTemplate };
    return write({ k: "insert", t: "quotation_templates", row }, () =>
      sInsert("quotation_templates", row), -1
    );
  },
  remove: (id: number) =>
    write({ k: "delete", t: "quotation_templates", id }, () =>
      sDelete("quotation_templates", id), undefined
    ),
};

// ===== Suppliers =====
export interface Supplier {
  id: number;
  name: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  address?: string;
  tax_id?: string;
  notes?: string;
  /** Per-supplier bank details (BankInfo shape: bank_name, account_number, …). */
  bank_details?: Record<string, string>;
  shared?: boolean;
  created_at: string;
}

export const suppliers = {
  list: () =>
    readCached<Supplier[]>(
      "suppliers",
      () => sList<Supplier>("suppliers", [{ col: "name", asc: true }]),
      []
    ),
  create: (input: Omit<Supplier, "id" | "created_at">) => {
    const row = clean(input as Record<string, unknown>);
    return write({ k: "insert", t: "suppliers", row }, () =>
      sInsert("suppliers", row), -1
    );
  },
  update: (id: number, patch: Partial<Omit<Supplier, "id" | "created_at">>) => {
    const row = clean(patch as Record<string, unknown>);
    return write(
      { k: "update", t: "suppliers", id, row },
      () => sUpdate("suppliers", id, row),
      undefined
    );
  },
  remove: (id: number) =>
    write({ k: "delete", t: "suppliers", id }, () =>
      sDelete("suppliers", id), undefined
    ),
};

// ===== Purchase Orders =====
export interface PoItem {
  id?: number;
  product_id?: number;
  description: string;
  quantity: number;
  unit_cost: number;
  unit?: string;
  custom?: Record<string, string>;
}

export interface PoPayment {
  id: number;
  po_id: number;
  amount: number;
  method?: string;
  paid_at: string;
}
export interface PoSummary {
  id: number;
  po_number: string;
  supplier_id?: number;
  supplier_name: string;
  status: string;
  template?: string;
  currency?: string;
  total: number;
  /** Number of line items on the PO (from purchase_order_items). */
  items_count: number;
  order_date: string;
  expected_date?: string;
  shared?: boolean;
  updated_at: string;
  /** VAT rate (%) applied to this PO — used by statement engine. */
  tax_rate?: number;
}
export interface PurchaseOrder {
  id: number;
  po_number: string;
  supplier_id?: number;
  supplier_name?: string;
  supplier_address?: string;
  supplier_trn?: string;
  supplier_email?: string;
  supplier_phone?: string;
  status: string;
  template: string;
  accent: string;
  currency: string;
  total: number;
  order_date: string;
  expected_date?: string;
  notes?: string;
  terms?: string;
  doc_title?: string;
  custom_columns?: { key: string; label: string }[];
  unit_price_formula?: { a: string; b: string } | null;
  discount?: number;
  tax_rate?: number;
  shared?: boolean;
  share_token?: string;
  logo?: string;
  seller_name?: string;
  seller_address?: string;
  seller_trn?: string;
  seller_email?: string;
  seller_phone?: string;
  show_stamp?: boolean;
  show_logo?: boolean;
  show_signature?: boolean;
  created_at: string;
  updated_at: string;
  items: PoItem[];
}
export type PoInput = Omit<
  PurchaseOrder,
  "id" | "created_at" | "updated_at"
> & { id?: number; };

export const pos = {
  /** Create draft POs for every product at/below its reorder level, grouped
   *  by supplier (products without one share a single supplier-less draft).
   *  Returns the created PO numbers. */
  createDraftsFromLowStock: () =>
    online(async () => {
      const [products, sups, existing] = await Promise.all([
        sList<Product>("products"),
        sList<Supplier>("suppliers"),
        sList<{ po_number?: string }>("purchase_orders"),
      ]);
      const low = products.filter(
        (p) => p.reorder_level > 0 && p.quantity <= p.reorder_level
      );
      if (!low.length) return [] as string[];
      const company = await billing.getCompany().catch(() => null);
      const bySupplier = new Map<number, Product[]>();
      for (const p of low) {
        const sid = p.supplier_id ?? 0;
        const group = bySupplier.get(sid) ?? [];
        group.push(p);
        bySupplier.set(sid, group);
      }
      const supById = new Map(sups.map((s) => [s.id, s]));
      const existingNums = existing.map((r) => r.po_number ?? "").filter(Boolean);
      const created: string[] = [];
      for (const [sid, prods] of bySupplier) {
        const sup = supById.get(sid);
        // ponytail: refill to 2× reorder level — a draft the user edits anyway.
        const items = prods.map((p) => ({
          product_id: p.id,
          description: p.name,
          quantity: Math.max(1, p.reorder_level * 2 - p.quantity),
          unit_cost: Number(p.cost_price) || 0,
          unit: p.unit,
        }));
        const num = nextDocNumber({ prefix: "PO", existing: existingNums });
        existingNums.push(num);
        await pos.save({
          po_number: num,
          status: "draft",
          doc_title: "Purchase Order",
          template: company?.default_template || "minimal",
          accent: company?.default_accent || "#222222",
          currency: company?.currency || "AED",
          seller_name: company?.name || "",
          seller_address: company?.address,
          seller_trn: company?.trn,
          seller_email: company?.email,
          seller_phone: company?.phone,
          supplier_id: sid || undefined,
          supplier_name: sup?.name ?? "",
          supplier_address: sup?.address ?? "",
          supplier_email: sup?.email ?? "",
          supplier_phone: sup?.phone ?? "",
          supplier_trn: sup?.tax_id ?? "",
          order_date: new Date().toISOString().slice(0, 10),
          notes: "Auto-created from low stock",
          total: items.reduce((s, it) => s + it.quantity * it.unit_cost, 0),
          items,
        } as PoInput);
        created.push(num);
      }
      return created;
    }),
  list: () =>
    readCached<PoSummary[]>(
      "purchase_orders",
      async () => {
        const [rows, supRows, itemRows] = await Promise.all([
          sList<any>("purchase_orders", [
            { col: "order_date", asc: false },
            { col: "id", asc: false },
          ]),
          sList<Supplier>("suppliers"),
          // One batched fetch of just the FK, counted in JS below — the
          // local shim has no embedded count/join, so a subquery select
          // wouldn't work offline (same pattern as pos.get).
          sList<{ po_id: number | string }>(
            "purchase_order_items",
            undefined,
            "po_id"
          ),
        ]);
        const byId = new Map(supRows.map((s) => [s.id, s]));
        const itemCounts = new Map<number, number>();
        for (const it of itemRows) {
          const k = Number(it.po_id);
          itemCounts.set(k, (itemCounts.get(k) ?? 0) + 1);
        }
        return rows.map((r) => ({
          id: r.id,
          po_number: r.po_number,
          supplier_id: r.supplier_id ?? undefined,
          supplier_name: r.supplier_name ?? byId.get(r.supplier_id)?.name ?? "—",
          status: r.status,
          template: r.template ?? "uae",
          currency: r.currency ?? "AED",
          total: Number(r.total),
          items_count: itemCounts.get(Number(r.id)) ?? 0,
          order_date: r.order_date,
          expected_date: r.expected_date ?? undefined,
          shared: r.shared ?? false,
          updated_at: r.updated_at,
          tax_rate: r.tax_rate ?? undefined,
        })) as PoSummary[];
      },
      []
    ),
  get: (poId: number) =>
    readCached<PurchaseOrder>(
      `purchase_order:${poId}`,
      async () => {
        const { data, error } = await sb()
          .from("purchase_orders")
          .select("*")
          .eq("id", poId)
          .single();
        if (error) throw error;
        const items = await sList<any>("purchase_order_items", [
          { col: "position", asc: true },
        ]);
        const filtered = items
          .filter((i) => i.po_id === poId)
          .map((i) => ({
            id: i.id,
            product_id: i.product_id ?? undefined,
            description: i.description,
            quantity: Number(i.quantity),
            unit_cost: Number(i.unit_cost),
            unit: i.unit ?? undefined,
            custom: (i.custom as Record<string, string>) ?? undefined,
          }));
        const d = data as PurchaseOrder;
        return {
          ...(d as PurchaseOrder),
          custom_columns: Array.isArray(d.custom_columns) ? d.custom_columns : [],
          unit_price_formula: d.unit_price_formula || null,
          id: d.id,
          po_number: d.po_number,
          supplier_id: d.supplier_id ?? undefined,
          status: d.status,
          total: Number(d.total),
          order_date: d.order_date,
          expected_date: d.expected_date ?? undefined,
          notes: d.notes ?? undefined,
          created_at: d.created_at,
          updated_at: d.updated_at,
          items: filtered,
        };
      },
      null as unknown as PurchaseOrder
    ),
  save: (input: PoInput) =>
    online(async () => {
      const { items, id, ...fields } = input;
      // Trust the caller's precomputed total (it accounts for unit_price_formula
      // line amounts); only recompute the naive qty*cost when none was passed.
      const total =
        (input as { total?: number }).total != null
          ? Number((input as { total?: number }).total)
          : items.reduce((s, it) => s + it.quantity * it.unit_cost, 0);
      const row = clean({ ...fields, total } as Record<string, unknown>);
      let poId: number;
      if (id && id > 0) {
        await sUpdate("purchase_orders", id, row);
        const { error } = await sb()
          .from("purchase_order_items")
          .delete()
          .eq("po_id", id);
        if (error) throw error;
        poId = id;
      } else {
        poId = await sInsert("purchase_orders", row);
      }
      if (items.length) {
        const { error } = await sb()
          .from("purchase_order_items")
          .insert(
            items.map((it, i) => ({
              po_id: poId,
              product_id: it.product_id ?? null,
              description: it.description,
              quantity: it.quantity,
              unit_cost: it.unit_cost,
              unit: it.unit ?? null,
              custom: it.custom ?? null,
              position: i,
            }))
          );
        if (error) throw error;
      }
      // Post to Accounting once the PO is received/done; clear it otherwise.
      const saved = { ...row, id: poId };
      if (PO_DONE((row as Record<string, unknown>).status))
        await propagatePurchase(saved);
      else await unpropagatePurchase(saved);
      return poId;
    }),
  setStatus: (poId: number, status: string) =>
    write(
      { k: "update", t: "purchase_orders", id: poId, row: { status } },
      async () => {
        const { data: doc, error } = await sb()
          .from("purchase_orders")
          .select("*")
          .eq("id", poId)
          .single();
        if (error) throw error;
        await sUpdate("purchase_orders", poId, { status });
        const po = { ...(doc as Record<string, unknown>), status };
        if (PO_DONE(status)) await propagatePurchase(po);
        else await unpropagatePurchase(po);
      },
      undefined
    ),
  shareDoc: (poId: number, shared: boolean) =>
    online(() =>
      shareWithItems(
        "purchase_orders",
        "purchase_order_items",
        "po_id",
        poId,
        shared
      )
    ),
  publicLink: async (poId: number) => {
    if (isLocalMode())
      throw new Error("Public links need Cloud mode — they don't work offline.");
    await pos.shareDoc(poId, true);
    const { data, error } = await sb()
      .from("purchase_orders")
      .select("share_token")
      .eq("id", poId)
      .single();
    if (error) throw error;
    return (data as { share_token: string }).share_token;
  },
  /** Receive items into stock: increments products.quantity by each line. */
  receive: (poId: number) =>
    online(async () => {
      const po = await pos.get(poId);
      for (const it of po.items) {
        if (!it.product_id) continue;
        const qty = Math.abs(Number(it.quantity));
        // Moving average first — needs the pre-receipt on-hand quantity.
        await applyMovingAverageCost(it.product_id, qty, Number(it.unit_cost) || 0);
        await adjustProductStock(it.product_id, qty, {
          type: "purchase",
          ref: po.po_number ? `PO ${po.po_number}` : `PO #${poId}`,
        });
      }
      await sUpdate("purchase_orders", poId, { status: "received" });
      // Receiving = done → post Purchases / Accounts Payable to Accounting.
      await propagatePurchase({ ...(po as unknown as Record<string, unknown>), status: "received" });
    }),
  remove: (poId: number) =>
    write({ k: "delete", t: "purchase_orders", id: poId }, async () => {
      const { data: doc } = await sb()
        .from("purchase_orders")
        .select("*")
        .eq("id", poId)
        .single();
      if (doc) await unpropagatePurchase(doc as Record<string, unknown>);
      await sDelete("purchase_orders", poId);
    }, undefined),
  /* ---- payments ---- */
  /** All PO payments in one query — dashboard aggregates payable per PO. */
  allPayments: () =>
    readCached<{ po_id: number; amount: number }[]>(
      "po_payments:all",
      async () => {
        const { data } = await sb().from("po_payments").select("po_id,amount");
        return ((data ?? []) as { po_id: number | string; amount: number | string }[]).map(
          (p) => ({ po_id: Number(p.po_id), amount: Number(p.amount) || 0 })
        );
      },
      []
    ),
  payments: (poId: number) =>
    readCached<PoPayment[]>(
      `po_payments:${poId}`,
      async () => {
        const { data } = await sb()
          .from("po_payments")
          .select("*")
          .eq("po_id", poId)
          .order("paid_at", { ascending: false });
        return (
          (data ?? []) as {
            id: number;
            po_id: number;
            amount: number | string;
            method?: string | null;
            paid_at: string;
          }[]
        ).map((p) => ({
          id: p.id,
          po_id: p.po_id,
          amount: Number(p.amount),
          method: p.method ?? undefined,
          paid_at: p.paid_at,
        })) as PoPayment[];
      },
      []
    ),
  addPayment: (poId: number, amount: number, method?: string | null, paidAt?: string) =>
    write(
      { k: "insert", t: "po_payments", row: { po_id: poId, amount, method: method || null, paid_at: paidAt || new Date().toISOString().slice(0, 10) } },
      () => sInsert("po_payments", { po_id: poId, amount, method: method || null, paid_at: paidAt || new Date().toISOString().slice(0, 10) }),
      -1
    ),
  removePayment: (paymentId: number) =>
    write({ k: "delete", t: "po_payments", id: paymentId }, () =>
      sDelete("po_payments", paymentId), undefined
    ),
};

// ===== Advances (party-level prepayment credit) =====
// A standalone credit ledger keyed by party, not tied to any one invoice/PO:
// money a customer paid up front, or money paid to a supplier in advance. The
// balance is shown on the party's detail card and netted against what they owe.
export interface Advance {
  id: number;
  party_type: "customer" | "supplier";
  party_id: number;
  party_name: string;
  amount: number;
  note?: string;
  paid_at: string;
  created_at: string;
}

export const advances = {
  list: () =>
    readCached<Advance[]>(
      "advances",
      () => sList<Advance>("advances", [{ col: "paid_at", asc: false }]),
      []
    ),
  forParty: (partyType: "customer" | "supplier", partyId: number) =>
    readCached<Advance[]>(
      `advances:${partyType}:${partyId}`,
      async () => {
        const { data } = await sb()
          .from("advances")
          .select("*")
          .eq("party_type", partyType)
          .eq("party_id", partyId)
          .order("paid_at", { ascending: false });
        return (data ?? []) as Advance[];
      },
      []
    ),
  add: (input: {
    party_type: "customer" | "supplier";
    party_id: number;
    party_name: string;
    amount: number;
    note?: string;
    paid_at?: string;
  }) => {
    const row = {
      party_type: input.party_type,
      party_id: input.party_id,
      party_name: input.party_name,
      amount: input.amount,
      note: input.note || null,
      paid_at: input.paid_at || new Date().toISOString().slice(0, 10),
    };
    return write({ k: "insert", t: "advances", row }, () =>
      sInsert("advances", row), -1
    );
  },
  remove: (id: number) =>
    write({ k: "delete", t: "advances", id }, () =>
      sDelete("advances", id), undefined
    ),
  update: (id: number, patch: Partial<Pick<Advance, "amount" | "note" | "paid_at">>) =>
    write({ k: "update", t: "advances", id, row: patch }, () =>
      sUpdate("advances", id, patch), undefined
    ),
  /** Apply (consume) advance credit against a specific invoice. Idempotent per
   *  invoice id: replaces any prior consumption for that invoice, so re-saving
   *  with a new amount rebalances cleanly. Stored as a NEGATIVE ledger entry so
   *  the party's credit balance (sum of entries) drops by the applied amount.
   *  Pass amount 0 to clear. */
  applyToInvoice: (
    partyId: number,
    partyName: string,
    invoiceId: number,
    amount: number
  ) =>
    online(async () => {
      const tag = `applied:inv#${invoiceId}`;
      const rows = await sList<Advance>("advances", [{ col: "id", asc: true }]);
      for (const r of rows)
        if (
          r.party_type === "customer" &&
          String(r.party_id) === String(partyId) &&
          r.note === tag
        )
          await sDelete("advances", r.id);
      if (amount > 0)
        await sInsert("advances", {
          party_type: "customer",
          party_id: partyId,
          party_name: partyName,
          amount: -Math.abs(amount),
          note: tag,
          paid_at: new Date().toISOString().slice(0, 10),
        });
    }),
  /** Net advance credit currently available for a customer (sum of all their
   *  ledger entries — positive deposits minus negative consumptions). */
  creditFor: async (partyId: number): Promise<number> => {
    const rows = await advances.forParty("customer", partyId);
    return rows.reduce((s, a) => s + Number(a.amount), 0);
  },
  /** Credit applicable to ONE invoice: the customer's net credit with this
   *  invoice's own prior consumption added back, so editing the applied amount
   *  rebalances against the right pool. Pass invoiceId undefined for a new doc. */
  creditForInvoice: async (
    partyId: number,
    invoiceId?: number
  ): Promise<number> => {
    const rows = await advances.forParty("customer", partyId);
    const tag = invoiceId ? `applied:inv#${invoiceId}` : null;
    return rows.reduce((s, a) => s + (a.note === tag ? 0 : Number(a.amount)), 0);
  },
};

// ===== Payment Receipts =====
export interface ReceiptSummary {
  id: number;
  number: string;
  customer_name: string;
  status: string;
  template: string;
  amount: number;
  payment_date: string;
  payment_method?: string;
  shared?: boolean;
  updated_at: string;
}

export interface ReceiptDoc {
  id: number;
  number: string;
  status: string;
  template: string;
  accent: string;
  currency: string;
  logo?: string;
  seller_name?: string;
  seller_address?: string;
  seller_trn?: string;
  seller_email?: string;
  seller_phone?: string;
  customer_name: string;
  customer_address?: string;
  customer_trn?: string;
  customer_email?: string;
  issue_date?: string;
  due_date?: string;
  notes?: string;
  terms?: string;
  tax_rate?: number;
  discount?: number;
  amount: number;
  amount_words?: string;
  payment_method?: string;
  ref_number?: string;
  for_description?: string;
  show_stamp?: boolean;
  show_logo?: boolean;
  show_signature?: boolean;
  shared?: boolean;
  share_token?: string;
  created_at: string;
  updated_at: string;
}

export type ReceiptInput = Omit<ReceiptDoc, "id" | "created_at" | "updated_at"> & { id?: number };

export const receipts = {
  list: () =>
    readCached<ReceiptSummary[]>(
      "payment_receipts",
      async () => {
        const rows = await sList<any>("payment_receipts", [
          { col: "issue_date", asc: false },
          { col: "id", asc: false },
        ]);
        return rows.map((r) => ({
          id: r.id,
          number: r.number,
          customer_name: r.customer_name,
          status: r.status,
          template: r.template,
          amount: Number(r.amount),
          payment_date: r.issue_date,
          payment_method: r.payment_method,
          shared: r.shared ?? false,
          updated_at: r.updated_at,
        })) as ReceiptSummary[];
      },
      []
    ),
  get: (id: number) =>
    readCached<ReceiptDoc>(
      `payment_receipt:${id}`,
      async () => {
        const { data, error } = await sb()
          .from("payment_receipts")
          .select("*")
          .eq("id", id)
          .single();
        if (error) throw error;
        return { ...(data as ReceiptDoc) };
      },
      null as unknown as ReceiptDoc
    ),
  save: (input: ReceiptInput) =>
    online(async () => {
      const { id, ...fields } = input;
      const row = clean(fields as Record<string, unknown>);
      if (id && id > 0) {
        await sUpdate("payment_receipts", id, row);
        return id;
      }
      return sInsert("payment_receipts", row);
    }),
  delete: (id: number) =>
    write({ k: "delete", t: "payment_receipts", id }, () =>
      sDelete("payment_receipts", id), undefined
    ),
  setStatus: (id: number, status: string) =>
    write(
      { k: "update", t: "payment_receipts", id, row: { status } },
      () => sUpdate("payment_receipts", id, { status }),
      undefined
    ),
  shareDoc: (id: number, shared: boolean) =>
    write(
      { k: "update", t: "payment_receipts", id, row: { shared } },
      () => sUpdate("payment_receipts", id, { shared }),
      undefined
    ),
  publicLink: async (id: number) => {
    if (isLocalMode())
      throw new Error("Public links need Cloud mode — they don't work offline.");
    await receipts.shareDoc(id, true);
    const { data, error } = await sb()
      .from("payment_receipts")
      .select("share_token")
      .eq("id", id)
      .single();
    if (error) throw error;
    return (data as { share_token: string }).share_token;
  },
};

export const toolRuns = {
  list: () =>
    readCached<ToolRun[]>(
      "tool_runs",
      () => sList<ToolRun>("tool_runs", [{ col: "id", asc: false }]),
      []
    ),
  log: (tool: string, toolName: string, fileName: string) => {
    const row = { tool, tool_name: toolName, file_name: fileName };
    return write({ k: "insert", t: "tool_runs", row }, () =>
      sInsert("tool_runs", row), -1
    );
  },
  rename: (id: number, fileName: string) =>
    write(
      { k: "update", t: "tool_runs", id, row: { file_name: fileName } },
      () => sUpdate("tool_runs", id, { file_name: fileName }),
      undefined
    ),
  setPaths: (id: number, paths: string[], sizeBytes = 0) =>
    write(
      {
        k: "update",
        t: "tool_runs",
        id,
        row: { storage_paths: paths, size_bytes: sizeBytes },
      },
      () =>
        sUpdate("tool_runs", id, {
          storage_paths: paths,
          size_bytes: sizeBytes,
        }),
      undefined
    ),
  remove: (id: number) =>
    write({ k: "delete", t: "tool_runs", id }, () =>
      sDelete("tool_runs", id), undefined
    ),
};

// ===== Organizations / RBAC =====
export interface Organization {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
}
export interface OrgMember {
  id: number;
  org_id: string;
  user_id: string;
  role: string;
  name: string;
  email: string;
  modules?: string[] | null;
}
export interface Invitation {
  id: string;
  org_id: string;
  email: string;
  role: string;
  modules?: string[] | null;
  status: string;
  created_at: string;
}

// ===== Company message board =====
export interface OrgMessage {
  id: number;
  user_id: string;
  body: string;
  author: string;
  parent_id?: number | null;
  created_at: string;
}

export const messages = {
  list: () =>
    readCached<OrgMessage[]>(
      "org_messages",
      async () => {
        const [rows, profs] = await Promise.all([
          sList<any>("org_messages", [{ col: "id", asc: false }]),
          sList<any>("profiles"),
        ]);
        const byId = new Map(profs.map((p) => [p.id, p]));
        return rows.slice(0, 200).map((r) => ({
          id: r.id,
          user_id: r.user_id,
          body: r.body,
          author: byId.get(r.user_id)?.name ?? "Team member",
          parent_id: r.parent_id ?? null,
          created_at: r.created_at,
        })) as OrgMessage[];
      },
      []
    ),
  post: (body: string, parentId?: number | null) => {
    const row: Record<string, unknown> = { body };
    if (parentId) row.parent_id = parentId;
    return write({ k: "insert", t: "org_messages", row }, () =>
      sInsert("org_messages", row).then(() => undefined), undefined
    );
  },
  remove: (id: number) =>
    write({ k: "delete", t: "org_messages", id }, () =>
      sDelete("org_messages", id), undefined
    ),
};

// ===== Notifications (per-user inbox) =====
export interface Notification {
  id: number;
  actor: string;
  kind: string;
  body: string;
  link?: string;
  read: boolean;
  created_at: string;
}

export const notifs = {
  list: () =>
    online(async () => {
      const { data, error } = await sb()
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as Notification[];
    }),
  markRead: (id: number) =>
    online(async () => {
      const { error } = await sb()
        .from("notifications")
        .update({ read: true })
        .eq("id", id);
      if (error) throw error;
    }),
  markAllRead: () =>
    online(async () => {
      const { error } = await sb()
        .from("notifications")
        .update({ read: true })
        .eq("read", false);
      if (error) throw error;
    }),
};

export const org = {
  get: () =>
    readCached<Organization | null>(
      "organization",
      async () => {
        const rows = await sList<Organization>("organizations", undefined, "*", cdb());
        return rows[0] ?? null;
      },
      null
    ),
  members: () =>
    readCached<OrgMember[]>(
      "org_members",
      async () => {
        const [mems, profs] = await Promise.all([
          sList<any>("org_members", [{ col: "id", asc: true }], "*", cdb()),
          sList<any>("profiles", undefined, "*", cdb()),
        ]);
        const byId = new Map(profs.map((p) => [p.id, p]));
        return mems.map((m) => ({
          id: m.id,
          org_id: m.org_id,
          user_id: m.user_id,
          role: m.role,
          modules: m.modules ?? null,
          name: byId.get(m.user_id)?.name ?? "—",
          email: byId.get(m.user_id)?.email ?? "",
        })) as OrgMember[];
      },
      []
    ),
  /** Create a new organization; returns its id. */
  create: (name: string) =>
    online(async () => {
      const id = await sInsert("organizations", { name }, cdb());
      await sInsert("org_members", { org_id: String(id), role: "owner" }, cdb());
      return String(id);
    }),
  setRole: (memberId: number, role: string) =>
    write(
      { k: "update", t: "org_members", id: memberId, row: { role } },
      () => sUpdate("org_members", memberId, { role }, cdb()),
      undefined
    ),
  setMemberModules: (memberId: number, modules: string[] | null) =>
    write(
      { k: "update", t: "org_members", id: memberId, row: { modules } },
      () => sUpdate("org_members", memberId, { modules }, cdb()),
      undefined
    ),
  remove: (memberId: number) =>
    write({ k: "delete", t: "org_members", id: memberId }, () =>
      sDelete("org_members", memberId, cdb()), undefined
    ),
  // ----- invitations -----
  invites: () =>
    readCached<Invitation[]>(
      "invitations",
      () =>
        sList<Invitation>(
          "invitations",
          [{ col: "created_at", asc: false }],
          "*",
          cdb()
        ),
      []
    ),
  invite: (email: string, role: string, modules: string[] | null) =>
    online(() =>
      sInsert(
        "invitations",
        { email: email.trim().toLowerCase(), role, modules },
        cdb()
      ).then(() => undefined)
    ),
  revokeInvite: (id: string) =>
    online(async () => {
      const { error } = await cdb().from("invitations").delete().eq("id", id);
      if (error) throw error;
    }),
  /** Pending invitations addressed to the signed-in user's email. */
  myInvites: () =>
    online(async () => {
      const { data, error } = await cdb()
        .from("invitations")
        .select("*")
        .eq("status", "pending");
      if (error) throw error;
      return (data ?? []) as Invitation[];
    }),
  acceptInvite: (id: string) =>
    online(async () => {
      const { error } = await cdb().rpc("accept_invitation", { invite: id });
      if (error) throw error;
    }),
};
