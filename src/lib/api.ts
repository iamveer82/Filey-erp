import { clearLog } from "./log";
import { defaultTaxRate, validateCountry, taxIdError } from "./taxRegimes";
import { validateWorkItem, type WorkInput, type WorkItem } from "./workItems";
import { invoke } from "@tauri-apps/api/core";
import { sb, isConfigured, supabase } from "./supabase";
import { isLocalMode, assertWorkspaceCurrent } from "./dataMode";
import { applyRoundOff, r2 } from "./money";
import {
  splitItemMeta,
  mergeItemMeta,
  docLineAmount,
  docTotals as lineAwareTotals,
  netByTaxCategory,
} from "./docItems";
import { getExchangeRates, docAmountInAed, unratedCurrency } from "./exchange-rates";
import { nextDocNumber } from "./docNumber";
import { checkFreeInvoiceCap } from "./license";
import { localYmd, todayYmd } from "./format";
import {
  ENTITY_LABEL,
  ENTITY_LABEL_COL,
  ENTITY_TABLE,
  isEntityType,
  type EntityType,
  type LinkedRecord,
} from "./links";
import { notifyDataChanged } from "./realtime";
import { log } from "./log";
import { withLocalTransaction } from "./localdb";
import { loadModuleAccess } from "./moduleAccess";
import { validateExpense, type ExpenseDetails } from "./expenseDetails";

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
  // --- UAE WPS payroll (only needed to file a salary file) ---
  /** MOHRE labour card / personal number, 14 digits. */
  labour_card_no?: string;
  /** Salary account IBAN — where WPS pays them. */
  iban?: string;
  /** Receiving bank's routing code, 9 digits. */
  bank_routing_code?: string;
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
  details?: ExpenseDetails | null;
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
  zeroRatedNet: number;       // FTA box 4: zero-rated supplies (net, no VAT)
  exemptNet: number;          // FTA box 5: exempt supplies (net, no VAT)
  reverseChargeNet: number;   // FTA box 3: supplies under reverse charge (net)
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
  converted_company_id?: number | null;
  converted_person_id?: number | null;
  converted_deal_id?: number | null;
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
export interface EmailOptOut {
  id: number;
  email: string;
  reason: "unsubscribed" | "bounced" | "manual";
  created_at?: string;
}

export interface CampaignRecipient {
  customer_id: number;
  name: string;
  email: string;
  /** pending → sent | failed | skipped (opted out, or no address). */
  status: "pending" | "sent" | "failed" | "skipped";
  error?: string;
  sent_at?: string;
}

export interface Campaign {
  id: number;
  name: string;
  subject: string;
  body_html: string;
  status: "draft" | "sending" | "sent" | "paused";
  /** How the list was picked, kept so a past send can be explained. */
  audience: { filter?: string; min_score?: number };
  recipients: CampaignRecipient[];
  sent_count: number;
  failed_count: number;
  sent_at?: string;
  created_at?: string;
  updated_at?: string;
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
  telegram?: string;
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
  quotation_id?: number | null;
  invoice_id?: number | null;
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
  /** Set by the set_updated_at trigger on every write — the "last touched"
   *  signal the pipeline health check uses to spot a stalled deal. */
  updated_at?: string;
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
  customer_id?: number | null;
  quotation_id?: number | null;
  /** Authoring user — distinguishes my invoices from team-shared ones. */
  user_id?: string;
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
  /** Member user-ids this invoice is explicitly shared with. */
  shared_with?: string[] | null;
  updated_at: string;
  unit_price_formula?: { a: string; b?: string } | null;
  /** VAT rate (%) applied to this document — used by statement engine. */
  tax_rate?: number;
  /** AED per unit of `currency`, frozen when the document was first saved.
   *  Aggregates convert with this so a total never mixes currencies. */
  fx_rate?: number | null;
  /** Net turnover per UAE tax category (S/Z/E/O/AE) — feeds VAT 201 boxes 4/5,
   *  which the ledger cannot supply because those lines carry no VAT. */
  net_by_tax_category?: Record<string, number>;
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
  /** Frozen jurisdiction; changing currency never changes tax treatment. */
  tax_country_code?: string;
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
  country_code?: string;
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
  // --- UAE WPS payroll: the employer half of a salary file ---
  /** MOHRE establishment ID, 13 digits. */
  mol_establishment_id?: string;
  /** Paying bank's routing code, 9 digits. */
  wps_bank_code?: string;
  /** Business WhatsApp number in E.164 — the one customers message, which is
   *  often not the same as `phone`. */
  whatsapp?: string;
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
let cacheIdentity = 0;
/** Scope the local read-cache to an organization. Call whenever the
 *  signed-in user's org changes (login, org switch, sign-out). */
export function setCacheOrg(orgId?: string | null, userId?: string): void {
  const next = `${orgId?.trim() || "default"}${userId ? `:user:${userId}` : ""}`;
  if (next === activeCacheOrg) return;
  clearLog();
  activeCacheOrg = next;
  cacheIdentity++;
  if (typeof window !== "undefined") window.dispatchEvent(new Event("filey:agent-storage"));
}

/** A consumer must not use an anonymous/default cache for account data. */
export function getCacheScope(): string | null {
  return activeCacheOrg.includes(":user:") ? activeCacheOrg : null;
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

/** Cache entries carry the moment they were stored so a read can tell whether
 *  they predate a write made in this session. */
type CacheEnvelope<T> = { __t: number; v: T };

async function cacheRead<T>(key: string): Promise<CacheEnvelope<T> | null> {
  const raw = await cacheGet<unknown>(key);
  if (raw == null) return null;
  if (typeof raw === "object" && raw !== null && "__t" in raw)
    return raw as CacheEnvelope<T>;
  // Written before entries were stamped: still a usable offline fallback, but
  // never fresh enough to serve without going to the server first.
  return { __t: 0, v: raw as T };
}

let cacheClock = 0;
const cacheStamp = () => cacheClock = Math.max(Date.now(), cacheClock + 1);
const cacheWrite = (key: string, value: unknown): Promise<void> =>
  cacheSet(key, { __t: cacheStamp(), v: value } satisfies CacheEnvelope<unknown>);

/** When the last mutation happened. A cached list stored before this can't be
 *  trusted to show it, so those reads go to the server instead of serving. */
let lastWriteAt = 0;
let lastAnyWriteAt = 0;
const tableWrites = new Map<string, number>();
function markWrite(tables?: readonly string[]): void {
  lastAnyWriteAt = cacheStamp();
  if (tables?.length) for (const table of tables) tableWrites.set(table, lastAnyWriteAt);
  else lastWriteAt = lastAnyWriteAt;
}
const readRevision = (tables?: readonly string[]) => tables
  ? Math.max(lastWriteAt, ...tables.map(table => tableWrites.get(table) ?? 0))
  : lastAnyWriteAt;

const fetching = new Map<string, Promise<unknown>>();
class SupersededRead extends Error {}

/** Share one cloud read between mounted pages, header widgets and refreshes.
 * A save or identity change prevents an older response from becoming current. */
function fetchCached<T>(k: string, run: () => Promise<T>, tables?: readonly string[]): Promise<T> {
  const identity = cacheIdentity, revision = readRevision(tables);
  const requestKey = `${identity}:${revision}:${k}`;
  const pending = fetching.get(requestKey);
  if (pending) return pending as Promise<T>;
  const request = (async () => {
    await flushOutbox();
    if (identity !== cacheIdentity || isLocalMode()) throw new SupersededRead();
    const fresh = await run();
    assertWorkspaceCurrent();
    if (identity !== cacheIdentity || revision !== readRevision(tables) || isLocalMode()) throw new SupersededRead();
    await cacheWrite(k, fresh);
    if (identity !== cacheIdentity || revision !== readRevision(tables) || isLocalMode()) throw new SupersededRead();
    return fresh;
  })();
  fetching.set(requestKey, request);
  void request.finally(() => fetching.delete(requestKey)).catch(() => {});
  return request;
}

/** Background refresh behind a served cache hit. One per key at a time; the
 *  UI is only nudged when the data actually changed, so this can't loop. */
const revalidating = new Set<string>();
function revalidate<T>(k: string, run: () => Promise<T>, tables?: readonly string[]): void {
  if (revalidating.has(k)) return;
  revalidating.add(k);
  void (async () => {
    try {
      const prev = await cacheRead<T>(k);
      const fresh = await fetchCached(k, run, tables);
      if (JSON.stringify(prev?.v) !== JSON.stringify(fresh)) notifyDataChanged(tables);
    } catch {
      /* keep serving the cached copy */
    } finally {
      revalidating.delete(k);
    }
  })();
}

type OutboxOp =
  | { k: "insert"; t: string; row: Record<string, unknown> }
  | { k: "update"; t: string; id: number; row: Record<string, unknown> }
  | { k: "delete"; t: string; id: number };

export async function pendingCloudWrites(): Promise<{ id: number; op: string }[]> {
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

/** True for a failure that repeating cannot fix: Postgres integrity-violation
 *  classes (23xxx — unique key taken, foreign key gone, NOT NULL) and
 *  PostgREST's no-rows. A row deleted on another device, or an id already
 *  claimed there, will read the same way on every retry.
 *
 *  Everything else is treated as temporary — offline, timeout, 5xx, an expired
 *  token — and left queued. Erring that way costs a retry; erring the other
 *  way discards a write the user made. */
export function outboxOpIsDoomed(e: unknown): boolean {
  const code = String((e as { code?: string } | null)?.code ?? "");
  return /^23\d\d\d$/.test(code) || code === "PGRST116";
}

let flushing = false;
export async function flushOutbox(): Promise<void> {
  if (isLocalMode()) return; // local mode writes are committed directly, no outbox
  if (flushing || !isConfigured || !onLine()) return;
  flushing = true;
  try {
    const list = await pendingCloudWrites();
    for (const entry of list) {
      let op: OutboxOp & { _workspace?: string };
      try {
        op = JSON.parse(entry.op);
      } catch {
        await outboxRemove(entry.id);
        continue;
      }
      // Older unscoped entries cannot safely be attributed to the current account.
      // Keep them available for explicit recovery instead of replaying into another company.
      if (op._workspace !== activeCacheOrg) continue;
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
      } catch (e) {
        // Order matters here — an insert must land before the update that
        // follows it — so a temporary failure stops the whole replay and
        // everything waits for the next reconnect.
        if (!outboxOpIsDoomed(e)) break;
        // But an op that can NEVER apply used to stop it the same way, and
        // nothing ever cleared it: the queue jammed on that one entry, every
        // offline write made afterwards piled up behind it, and none of them
        // ever reached the cloud. No error surfaced anywhere. Drop the doomed
        // op and keep draining — it was already lost, the ones behind it were
        // not.
        log.warn(
          "outbox",
          `dropping ${op.k} on ${op.t} — it cannot succeed`,
          (e as { message?: string })?.message ?? e
        );
        await outboxRemove(entry.id);
      }
    }
  } finally {
    flushing = false;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("filey:cloud-change", event => markWrite((event as CustomEvent<{ tables?: string[] }>).detail?.tables));
  for (const event of ["filey:remote-update", "focus", "online"])
    window.addEventListener(event, () => markWrite());
  window.addEventListener("online", () => {
    flushOutbox().catch((e) => console.error("Failed to flush outbox:", e));
  });
}

/** Read-through cache. Online → fetch + mirror; else → cached snapshot. */
async function readCached<T>(
  key: string,
  run: () => Promise<T>,
  empty: T,
  tables?: readonly string[],
  retry = true
): Promise<T> {
  assertWorkspaceCurrent();
  if (isLocalMode()) return run(); // local store is the source of truth
  const identity = cacheIdentity;
  const current = () => {
    assertWorkspaceCurrent();
    if (identity !== cacheIdentity || isLocalMode()) throw new Error("Your workspace changed. Reopen this section.");
  };
  // Membership itself is loaded by a separate RPC, never this cache. Restricted
  // staff always read through RLS so a former role's cached rows cannot leak.
  const access = await loadModuleAccess();
  current();
  if (!access.admin && access.modules !== null) {
    const data = await run();
    current();
    return data;
  }
  // Namespace the local cache by the active organization so data from
  // one org never bleeds into another on a shared device.
  const k = `${activeCacheOrg}:${key}`;
  if (!isConfigured) return (await cacheRead<T>(k))?.v ?? empty;

  const hit = await cacheRead<T>(k);
  current();
  if (!onLine()) return hit?.v ?? empty;

  // Stale-while-revalidate. This used to await the network on every read even
  // with a perfectly good local copy in hand, so opening the app in cloud mode
  // paid a full round trip per list before anything appeared. Serve the copy
  // and refresh behind it — but only when it provably post-dates every write
  // made this session, or a user could save something and not see it.
  if (hit && hit.__t > readRevision(tables)) {
    if (Date.now() - hit.__t > 15_000) revalidate(k, run, tables);
    return hit.v;
  }

  try {
    return await fetchCached(k, run, tables);
  } catch (error) {
    current();
    if (error instanceof SupersededRead) {
      if (retry) return readCached(key, run, empty, tables, false);
      throw new Error("Data changed while loading. Please try again.");
    }
    if (!hit) throw error; // A failed first load is not an empty business.
    console.warn("Could not refresh data; displaying the saved snapshot");
    return hit.v;
  }
}

function offlineError(): never {
  throw new Error(
    "You're offline. This change needs a connection — it will not be saved."
  );
}

/** Cloud saves require connectivity; local saves commit directly to the device. */
async function write<T>(
  _op: OutboxOp,
  run: () => Promise<T>,
  _offlineResult: T
): Promise<T> {
  assertWorkspaceCurrent();
  if (!isLocalMode()) {
    if (!isConfigured) throw new Error("Cloud storage is not configured.");
    if (!onLine()) return offlineError();
    await flushOutbox();
  }
  const result = await run();
  // A read started during the save may have cached the previous rows.
  markWrite([_op.t]);
  notifyDataChanged([_op.t]);
  return result;
}

/** Many-row write in ONE round trip.
 *
 *  A CSV import used to call the single-row create per row, and each of those
 *  reloads the whole collection, re-serialises it, rewrites the sync journal
 *  and fires a local-write event. Measured on this store: 4000 rows in one
 *  call is ~13ms; the same rows one at a time is ~400x more per row, which is
 *  the import sitting there frozen.
 *
 *  Cloud batches require connectivity, so an unsaved import cannot appear successful. */
async function writeMany<T>(
  _ops: OutboxOp[],
  run: () => Promise<T>,
  _offlineResult: T
): Promise<T> {
  assertWorkspaceCurrent();
  if (!isLocalMode()) {
    if (!isConfigured) throw new Error("Cloud storage is not configured.");
    if (!onLine()) return offlineError();
    await flushOutbox();
  }
  const result = await run();
  const tables = [...new Set(_ops.map(op => op.t))];
  markWrite(tables);
  notifyDataChanged(tables);
  return result;
}

/** Multi-step / read-modify-write op — requires a live connection. */
async function online<T>(run: () => Promise<T>, mutates = true): Promise<T> {
  // Most callers mutate. Read-only callers opt out so live reloads cannot
  // trigger another reload indefinitely.
  if (mutates) markWrite();
  assertWorkspaceCurrent();
  if (!isLocalMode()) {
    if (!isConfigured) throw new Error("Cloud storage is not configured.");
    if (!onLine()) offlineError();
    await flushOutbox();
  }
  const result = await run();
  // Invalidate snapshots that were fetched while this operation was saving.
  if (mutates) { markWrite(); notifyDataChanged(); }
  return result;
}

// ---- generic Supabase helpers ----
async function sList<T>(
  table: string,
  order?: { col: string; asc: boolean }[],
  select = "*",
  client: any = null,
  limit = Infinity
): Promise<T[]> {
  if (limit !== Infinity && (!Number.isInteger(limit) || limit < 0)) throw new Error("Invalid row limit.");
  const rows: T[] = [];
  const remote = client != null || !isLocalMode();
  for (let offset = 0; offset < limit; offset += 500) {
    const take = Math.min(500, limit - offset);
    let q: any = (client ?? sb()).from(table).select(select);
    for (const o of order ?? []) {
      // Offline IDs are random. "Newest first" must sort by creation time;
      // keep id as the stable tie-breaker used by pagination.
      if (o.col === "id" && !o.asc && !(order ?? []).some(entry => entry.col === "created_at"))
        q = q.order("created_at", { ascending: false });
      q = q.order(o.col, { ascending: o.asc });
    }
    if (remote) {
      if (!(order ?? []).some(o => o.col === "id")) q = q.order("id", { ascending: true });
      q = q.range(offset, offset + take - 1);
    }
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!remote || (data ?? []).length < take) return rows.slice(0, limit);
  }
  return rows;
}
/** Child rows belonging to one parent, filtered by the server.
 *
 *  Every caller of this used to sList() the whole child table and throw away
 *  all but one parent's rows in JavaScript, so opening a single invoice, quote
 *  or PO transferred every line item in the database. */
async function sChildren<T>(
  table: string,
  fk: string,
  // string too, not just a parent id — the same server-side narrowing applies
  // to a date column (attendance for one day) as to a foreign key.
  id: number | string,
  order?: { col: string; asc: boolean }[],
  client: any = null
): Promise<T[]> {
  let q: any = (client ?? sb()).from(table).select("*").eq(fk, id);
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
/** Quotes and POs share the same header/line save contract. */
async function saveDocumentLines(
  table: "quotations" | "purchase_orders", itemTable: string, fk: string,
  row: Record<string, unknown>, items: Record<string, unknown>[], id?: number
): Promise<number> {
  if (items.length > 500) throw new Error("A document supports at most 500 lines.");
  const mode = isLocalMode(), scope = activeCacheOrg;
  const checkScope = () => { assertWorkspaceCurrent(); if (mode !== isLocalMode() || scope !== activeCacheOrg) throw new Error("Workspace changed. Reopen the document before saving."); };
  if (!isLocalMode()) {
    const { data, error } = await sb().rpc("filey_save_document", { p_table: table, p_header: row, p_items: items, p_id: id || null });
    if (error) throw error;
    return Number(data);
  }
  return withLocalTransaction(async (client) => {
    checkScope();
    const stale = id ? await sChildren<{ id: number }>(itemTable, fk, id, undefined, client) : [];
    const docId = id || await sInsert(table, row, client);
    await sInsertMany(itemTable, items.map((item, position) => ({ ...item, [fk]: docId, position })), client);
    if (id) await sUpdate(table, id, row, client);
    await sDeleteMany(itemTable, stale.map((line) => line.id), client);
    checkScope();
    return docId;
  });
}

/** Rows per round trip. A 5000-row import in one request is a body big enough
 *  to time out against PostgREST, and the matching delete filter would blow
 *  past the URL length limit — the continuous sync chunks its deletes at 100
 *  for exactly that reason. Chunked, the import is still one write per chunk
 *  instead of one per row, which is where the win actually came from. */
const BULK_CHUNK = 500;
const chunked = <T>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

/** Insert an array of rows. All-or-nothing per chunk, like Postgres — callers
 *  that need to know WHICH row was bad retry the slow way on failure. */
async function sInsertMany(
  table: string,
  rows: Record<string, unknown>[],
  client: any = null
): Promise<number[]> {
  if (!rows.length) return [];
  const ids: number[] = [];
  for (const part of chunked(rows, BULK_CHUNK)) {
    const { data, error } = await (client ?? sb())
      .from(table)
      .insert(part)
      .select("id");
    // Earlier chunks are already committed, so the count rides on the error: a
    // caller that retries row by row must start after them or it writes the
    // successful rows a second time.
    if (error) throw Object.assign(new Error(error.message), { inserted: ids.length });
    for (const r of (data ?? []) as { id: number }[]) ids.push(r.id);
  }
  return ids;
}

/** How many rows a failed bulk insert had already written. */
export const insertedBefore = (e: unknown): number =>
  typeof (e as { inserted?: unknown })?.inserted === "number"
    ? (e as { inserted: number }).inserted
    : 0;
async function sUpdate(
  table: string,
  id: number,
  patch: Record<string, unknown>,
  client: any = null
): Promise<void> {
  const { data, error } = await (client ?? sb()).from(table).update(patch).eq("id", id).select("id").single();
  if (error) throw error;
  if (!data) throw new Error("Record not found or access denied. Refresh before trying again.");
}
async function sDelete(table: string, id: number, client: any = null): Promise<void> {
  const { error } = await (client ?? sb()).from(table).delete().eq("id", id);
  if (error) throw error;
}
/** Delete many ids in one statement. Selecting 200 rows and deleting them one
 *  at a time rewrote the whole collection 200 times. */
async function sDeleteMany(
  table: string,
  ids: number[],
  client: any = null
): Promise<void> {
  if (!ids.length) return;
  // 100, not BULK_CHUNK: this filter rides in the URL, and that is the size
  // the continuous sync settled on for the same reason.
  for (const part of chunked(ids, 100)) {
    const { error } = await (client ?? sb()).from(table).delete().in("id", part);
    if (error) throw error;
  }
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

/** Read a jsonb column that the cloud returns already parsed and the local
 *  SQLite shim returns as TEXT. Falls back rather than throwing — a malformed
 *  recipients blob should show an empty campaign, not break the whole page. */
function parseJsonCol<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    console.error("Could not parse JSON column; using fallback");
    return fallback;
  }
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
 *  Invoice transactions require the cost write to succeed with the receipt. */
async function applyMovingAverageCost(
  productId: number,
  recvQty: number,
  unitCost: number,
  client: any = null,
): Promise<void> {
  if (!productId || !(recvQty > 0) || !(unitCost > 0)) return;
  try {
    const db = client ?? sb();
    const { data, error } = await db
      .from("products")
      .select("quantity,cost_price")
      .eq("id", productId)
      .single();
    if (error) throw error;
    const onHand = Math.max(0, Number(data?.quantity) || 0);
    const oldCost = Number(data?.cost_price) || 0;
    const next = nextAvgCost(onHand, oldCost, recvQty, unitCost);
    if (next !== oldCost) {
      const updated = await db.from("products").update({ cost_price: next }).eq("id", productId);
      if (updated.error) throw updated.error;
    }
  } catch (e) {
    if (client && isLocalMode()) throw e;
    console.warn("Moving-average cost update failed", e);
  }
}

async function adjustProductStock(
  productId: number,
  delta: number,
  ctx?: StockCtx,
  client: any = null,
): Promise<void> {
  if (!Number.isInteger(productId) || productId <= 0 || !Number.isFinite(delta))
    throw new Error("Choose a product and enter a finite stock quantity.");
  if (delta === 0) return;
  const db = client ?? sb();
  const apply = async () => {
    if (!(client && isLocalMode())) {
      const { error } = await db.rpc("adjust_product_stock", {
        p_id: productId,
        p_delta: delta,
      });
      if (!error) return;
      if (isLocalMode() || !["PGRST202", "42883"].includes(error.code)) throw new Error(error.message);
    }
    // Local transactions stage this delta; the missing-cloud-RPC fallback is stepwise.
    const { data: row, error: fe } = await db
      .from("products")
      .select("quantity")
      .eq("id", productId)
      .single();
    if (fe) throw new Error(`Could not read product stock: ${fe.message}`);
    // NOT clamped at zero. Clamping loses the overshoot, and every stock move
    // here has a reverse: selling 5 from a stock of 3 clamped to 0, then
    // reverting that invoice added 5 back and left 5 on hand where 3 had been.
    // Overselling invented inventory, silently, and the stock_movements ledger
    // (which records the true -5/+5) stopped agreeing with the product row.
    // Negative stock is information — it says you owe units — so record it.
    const next = (Number(row?.quantity) || 0) + delta;
    const { error: ue } = await db
      .from("products")
      .update({ quantity: next })
      .eq("id", productId);
    if (ue) throw new Error(`Could not update product stock: ${ue.message}`);
  };
  await apply();
  // A scoped local transaction keeps the movement and quantity inseparable.
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
    }, client);
  } catch (e) {
    if (client && isLocalMode()) throw e;
    console.warn("stock movement log failed", e);
  }
}

/** Invoices created since the 1st of the current month (free-tier cap). */
export async function invoicesThisMonth(): Promise<number> {
  const rows = await sList<{ created_at?: string }>("invoice_docs");
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  return rows.filter((r) => r.created_at && new Date(r.created_at) >= start).length;
}

async function adjustAccountBalance(
  accountId: number,
  delta: number,
  client: any = null,
): Promise<void> {
  if (!accountId || delta === 0) return;
  const db = client ?? sb();
  if (!(client && isLocalMode())) {
    const { error } = await db.rpc("adjust_account_balance", {
      p_id: accountId,
      p_delta: delta,
    });
    if (!error) return;
    if (isLocalMode() || !["PGRST202", "42883"].includes(error.code))
      throw new Error(error.message);
  }
  const { data: row, error: fe } = await db
    .from("accounts")
    .select("balance")
    .eq("id", accountId)
    .single();
  if (fe) throw new Error(`Account balance RPC failed and fallback fetch failed: ${fe.message}`);
  const next = (Number(row?.balance) || 0) + delta;
  const { error: ue } = await db.from("accounts").update({ balance: next }).eq("id", accountId);
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
      [], ["products"]
    ),
  createProduct: (input: Omit<Product, "id" | "created_at">) => {
    const row = clean(input as Record<string, unknown>);
    return write({ k: "insert", t: "products", row }, () =>
      sInsert("products", row), -1
    );
  },
  /** Import path: every row in one write. See writeMany. */
  createProducts: (inputs: Omit<Product, "id" | "created_at">[]) => {
    const rows = inputs.map((i) => clean(i as Record<string, unknown>));
    return writeMany(
      rows.map((row) => ({ k: "insert" as const, t: "products", row })),
      () => sInsertMany("products", rows),
      []
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
        type === "adjust" ? Number(qty) : Math.abs(Number(qty));
      if (!Number.isFinite(q) || !Number.isInteger(productId) || productId <= 0)
        throw new Error("Choose a product and enter a finite stock quantity.");
      if (q === 0) return;
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
    }, false),
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
  /** Bulk-select delete: one statement for the whole selection. */
  deleteProducts: (productIds: number[]) =>
    writeMany(
      productIds.map((id) => ({ k: "delete" as const, t: "products", id })),
      () => sDeleteMany("products", productIds),
      undefined
    ),
  orders: () =>
    readCached<Order[]>(
      "erp_orders",
      () => sList<Order>("orders", [{ col: "id", asc: false }]),
      [], ["orders"]
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
    }, false),
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
        // Convert before summing: a $1,000 invoice added straight onto a
        // AED 1,000 one produces 2,000 of no currency at all.
        const rates = await getExchangeRates().catch(() => ({}));
        const unpaid = docs
          .filter((d) => d.status !== "paid")
          .reduce(
            (s, d) =>
              s +
              docAmountInAed(
                docTotal(d, byDoc.get(d.id) ?? []),
                d.currency,
                d.fx_rate,
                rates
              ),
            0
          );
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
const pendingPayrollRuns = new Set<string>();
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
  updateEmployee: (employeeId: number, input: Partial<Employee>) => {
    const row = clean(input as Record<string, unknown>);
    return write(
      { k: "update", t: "employees", id: employeeId, row },
      () => sUpdate("employees", employeeId, row),
      undefined
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
    accountId?: number | null,
  ) => {
    const net = basic + allowances - deductions;
    const row = {
      employee_id: employeeId,
      period: period.trim(),
      basic,
      allowances,
      deductions,
      net_pay: net,
      status: "pending",
    };
    return online(async () => {
      if (
        !Number.isInteger(employeeId) ||
        employeeId <= 0 ||
        !row.period ||
        [basic, allowances, deductions].some((value) => !Number.isFinite(value) || value < 0) ||
        net < 0
      )
        throw new Error("Choose an employee and period, with valid non-negative pay amounts.");
      const key = `${activeCacheOrg}:${employeeId}:${row.period}`;
      if (pendingPayrollRuns.has(key))
        throw new Error("Payroll for this employee and period is already being recorded.");
      pendingPayrollRuns.add(key);
      try {
        const record = async (client: any) => {
          const employee = await client.from("employees").select("id").eq("id", employeeId).single();
          if (employee.error) throw employee.error;
          const existing = await client
            .from("payroll")
            .select("id")
            .eq("employee_id", employeeId)
            .eq("period", row.period)
            .maybeSingle();
          if (existing.error) throw existing.error;
          if (existing.data)
            throw new Error(
              "Payroll is already recorded for this employee and period. Open the existing payslip instead.",
            );
          const targetId = accountId ?? (await findOrCreatePayrollAccount(client));
          const account = await client
            .from("accounts")
            .select("account_type")
            .eq("id", targetId)
            .single();
          if (account.error) throw account.error;
          if (account.data?.account_type !== "expense")
            throw new Error("Choose an expense account for payroll.");
          const id = await sInsert("payroll", row, client);
          const today = todayYmd();
          const ref = `Payroll ${id}`;
          if (net > 0) {
            await sInsert(
              "transactions",
              {
                account_id: targetId,
                txn_type: "debit",
                amount: net,
                description: `Payroll ${period}`,
                ref,
                source: "payroll",
                txn_date: today,
              },
              client,
            );
            await adjustAccountBalance(targetId, ledgerDelta("expense", "debit", net), client);
            // Contra leg — salaries paid from Cash/Bank (keeps the ledger balanced).
            const cashId = await findOrCreateCashAccount(client);
            if (cashId > 0) {
              await sInsert(
                "transactions",
                {
                  account_id: cashId,
                  txn_type: "credit",
                  amount: net,
                  description: `Payroll ${period} — paid`,
                  ref,
                  source: "payroll",
                  txn_date: today,
                },
                client,
              );
              await adjustAccountBalance(cashId, ledgerDelta("asset", "credit", net), client);
            }
          }
          return id;
        };
        return await (isLocalMode() ? withLocalTransaction(record) : record(sb()));
      } finally {
        pendingPayrollRuns.delete(key);
      }
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
        const today = todayYmd();
        const [emps, att, pay] = await Promise.all([
          sList<Employee>("employees"),
          // Only today's rows. This used to read the whole attendance table —
          // every employee for every day since the company started — and then
          // throw all but today away in JS, purely to show two counters.
          sChildren<{ date: string; status: string }>("attendance", "date", today),
          sList<{ net_pay: number; status: string }>("payroll"),
        ]);
        const active = emps.filter((e) => e.status === "active");
        return {
          headcount: active.length,
          present_today: att.filter((a) => a.status === "present").length,
          on_leave: att.filter((a) => a.status === "leave").length,
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
  to?: string,
  /** Issued sales invoices for the same period. Boxes 4/5 (zero-rated and
   *  exempt supplies) report net turnover that carries no VAT at all, so it
   *  leaves no trace in the tax accounts the ledger boxes are derived from —
   *  it has to come off the invoice lines. Omit and those boxes read zero. */
  invoices?: Pick<
    InvoiceDocSummary,
    "status" | "issue_date" | "net_by_tax_category"
  >[]
): VatReturn {
  const inRange = (d: string) => (!from || d >= from) && (!to || d <= to);
  let zeroRatedNet = 0;
  let exemptNet = 0;
  let reverseChargeNet = 0;
  for (const inv of invoices ?? []) {
    // A draft has not been issued to the customer, so it is not yet a supply.
    if (inv.status === "draft") continue;
    if (!inv.issue_date || !inRange(inv.issue_date)) continue;
    const byCat = inv.net_by_tax_category ?? {};
    zeroRatedNet += byCat.Z ?? 0;
    exemptNet += byCat.E ?? 0;
    reverseChargeNet += byCat.AE ?? 0;
  }
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
    zeroRatedNet: r2(zeroRatedNet),
    exemptNet: r2(exemptNet),
    reverseChargeNet: r2(reverseChargeNet),
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
                txn_date: todayYmd(),
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
    accountId: number | null,
    details?: ExpenseDetails | null
  ) => {
    const row = {
      category,
      description,
      amount,
      expense_date: expenseDate,
      account_id: accountId,
      ...(details ? { details } : {}),
    };
    return online(async () => {
      validateExpense(category, amount, expenseDate, details);
      if (!isLocalMode()) {
        const { data, error } = await sb().rpc("filey_record_expense", { p_expense: row });
        if (error) throw new Error(["PGRST202", "42883", "42703"].includes(error.code) ? "Expense storage needs the latest database update. Apply the expense-entry migration before saving." : error.message);
        return Number(data);
      }
      return withLocalTransaction(async client => {
      if (details?.submission_id) {
        const existing = (await sList<Expense>("expenses", undefined, "*", client)).find(expense => expense.details?.submission_id === details.submission_id);
        if (existing) {
          if (existing.amount !== amount || existing.category !== category || existing.expense_date !== expenseDate || JSON.stringify(existing.details) !== JSON.stringify(details))
            throw new Error("This expense was already saved. Open it from Purchase to review the saved details.");
          return existing.id;
        }
      }
      if (details?.receipt) {
        const file = await client.from("user_files").select("id").eq("id", details.receipt.id).single();
        if (file.error || !file.data) throw new Error("The receipt could not be found. Attach it again before saving.");
      }
      const targetId = accountId ?? (await findOrCreateExpenseAccount(client));
      const cashId = details?.payment_account_id ?? await findOrCreateCashAccount(client);
      for (const [id, type] of [[targetId, "expense"], [cashId, "asset"]] as const) {
        const account = await client.from("accounts").select("account_type").eq("id", id).single();
        if (account.error || account.data?.account_type !== type) throw new Error(`Choose a valid ${type === "expense" ? "expense" : "cash or bank"} account.`);
      }
      const id = await sInsert("expenses", { ...row, account_id: targetId }, client);
      const ref = `Expense ${id}`;
        await sInsert("transactions", {
          account_id: targetId,
          txn_type: "debit",
          amount,
          description: description ?? category,
          ref,
          source: "expense",
          txn_date: expenseDate,
        }, client);
        await adjustAccountBalance(targetId, ledgerDelta("expense", "debit", amount), client);
        // Contra leg — expense assumed paid from Cash/Bank, so the books stay
        // balanced (debit Expense, credit Cash). On-credit spend → manual AP entry.
          await sInsert("transactions", {
            account_id: cashId,
            txn_type: "credit",
            amount,
            description: `${description ?? category} — paid`,
            ref,
            source: "expense",
            txn_date: expenseDate,
          }, client);
          await adjustAccountBalance(cashId, ledgerDelta("asset", "credit", amount), client);
      return id;
      });
    });
  },
  getExpense: (id: number) => online(async () => {
    const { data, error } = await sb().from("expenses").select("*").eq("id", id).single();
    if (error) throw error;
    return data as Expense;
  }, false),
  deleteExpense: (expenseId: number) =>
    online(async () => {
      if (!isLocalMode()) {
        const { error } = await sb().rpc("filey_delete_expense", { p_id: expenseId });
        if (error) throw error;
        return;
      }
      await withLocalTransaction(async client => {
        const expense = await client.from("expenses").select("id").eq("id", expenseId).single();
        if (expense.error) throw expense.error;
        const { data, error } = await client.from("transactions").select("*").eq("source", "expense").eq("ref", `Expense ${expenseId}`);
        if (error) throw error;
        await reverseTransactions(data as InvoiceTxn[], client);
        await sDelete("expenses", expenseId, client);
      });
    }),
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
    description: string | null,
    txnDate = todayYmd()
  ) => {
    const row = {
      account_id: accountId,
      txn_type: txnType,
      amount,
      description,
      txn_date: txnDate,
    };
    return online(async () => {
      const date = new Date(`${txnDate}T00:00:00.000Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(txnDate) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== txnDate)
        throw new Error("Enter a valid journal date.");
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
      const accts = await sList<Account>("accounts");
      const typeById = new Map(accts.map((a) => [a.id, a.account_type]));
      const deltaOf = (t: any): number =>
        ledgerDelta(typeById.get(t.account_id) ?? "asset", t.txn_type, Number(t.amount));

      // Sum the journal as it stands AND as it will stand once the duplicates
      // are gone, in one pass. Only the DIFFERENCE is applied to each stored
      // balance.
      //
      // Overwriting the balance with the survivors' sum — what this used to do
      // — throws away everything an account holds that was never posted as a
      // transaction, and the opening balance typed in when the account was
      // created is exactly that: createAccount stores it on the row and posts
      // no journal entry for it. A bank account opened at 50,000 was silently
      // reset to zero, by a button whose own confirm dialog promises accounts
      // are untouched. Repairing drift must not destroy the starting position.
      const seen = new Set<string>();
      const dupes: any[] = [];
      const before = new Map<number, number>();
      const after = new Map<number, number>();
      for (const t of txns) {
        const key = [
          t.account_id ?? "",
          t.txn_type,
          Number(t.amount),
          t.description ?? "",
          t.txn_date ?? "",
        ].join("|");
        const dupe = seen.has(key);
        if (dupe) dupes.push(t);
        else seen.add(key);
        if (!t.account_id) continue;
        const d = deltaOf(t);
        before.set(t.account_id, (before.get(t.account_id) ?? 0) + d);
        if (!dupe) after.set(t.account_id, (after.get(t.account_id) ?? 0) + d);
      }

      for (const t of dupes) await sDelete("transactions", t.id);
      for (const a of accts) {
        // Whatever the balance holds beyond the journal is the opening
        // position; it survives untouched.
        const opening = Number(a.balance ?? 0) - (before.get(a.id) ?? 0);
        await sUpdate("accounts", a.id, {
          balance: r2(opening + (after.get(a.id) ?? 0)),
        });
      }
      return { removed: dupes.length };
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
      [], ["app_settings"]
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
  auditLog: (limit = 200) =>
    online(async () => {
      const { data, error } = await sb()
        .from("audit_log")
        .select("*")
        .order("id", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as AuditEntry[];
    }, false),
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

const CRM_TABLES = new Set(["crm_customers", "crm_people", "crm_leads", "crm_opportunities", "crm_tasks", "crm_notes", "crm_activities"]);

/** The new CRM editor needs acknowledged writes, including an error if RLS
 *  or a concurrent deletion means an update matched no row. */
export async function persistCrmRecord(table: string, patch: Record<string, unknown>, id?: number, expectedUpdatedAt?: string | null): Promise<number> {
  if (!CRM_TABLES.has(table)) throw new Error("Unsupported CRM object.");
  const result = await online(async () => {
    const row = clean(patch);
    delete row.id; delete row.user_id; delete row.org_id; delete row.created_at;
    row.updated_at = new Date().toISOString();
    if (id == null) return sInsert(table, row);
    let query = sb().from(table).update(row).eq("id", id);
    if (expectedUpdatedAt !== undefined) query = expectedUpdatedAt === null ? query.is("updated_at", null) : query.eq("updated_at", expectedUpdatedAt);
    const { data, error } = await query.select("id").single();
    if (expectedUpdatedAt !== undefined && (error?.code === "PGRST116" || (!error && !data))) throw new Error("Record changed or is unavailable. Refresh it before retrying.");
    if (error) throw error;
    if (!data) throw new Error("Record no longer exists or you do not have permission to edit it.");
    return Number(data.id);
  });
  markWrite();
  notifyDataChanged();
  return result;
}

export async function removeCrmRecord(table: string, id: number): Promise<void> {
  if (!CRM_TABLES.has(table)) throw new Error("Unsupported CRM object.");
  await online(async () => {
    if (isLocalMode()) {
      const { data, error } = await sb().from(table).select("id").eq("id", id).single();
      if (error || !data) throw new Error("Record no longer exists.");
      await sDelete(table, id);
    } else {
      const { data, error } = await sb().from(table).delete().eq("id", id).select("id").single();
      if (error) throw error;
      if (!data) throw new Error("Record no longer exists or you do not have permission to delete it.");
    }
  });
  markWrite();
  notifyDataChanged();
}

export async function importCrmRecords(table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (!CRM_TABLES.has(table) || rows.length === 0 || rows.length > 500) throw new Error("Import between 1 and 500 CRM records at a time.");
  await online(async () => {
    const { error } = await sb().from(table).insert(rows.map((input) => {
      const row = clean(input);
      delete row.id; delete row.user_id; delete row.org_id;
      return row;
    }));
    if (error) throw error;
  });
  markWrite();
  notifyDataChanged();
}

const leadConversions = new Map<number, Promise<number>>();
async function convertLead(leadId: number): Promise<number> {
  const running = leadConversions.get(leadId);
  if (running) return running;
  const run = online(async () => {
    if (!isLocalMode()) {
      const { data, error } = await sb().rpc("filey_convert_lead", { p_lead_id: leadId });
      if (error) throw error;
      return Number(data);
    }
    const { data, error } = await sb().from("crm_leads").select("*").eq("id", leadId).single();
    if (error) throw error;
    const lead = data as Lead;
    if (lead.converted_deal_id) return lead.converted_deal_id;
    if (lead.status === "converted") throw new Error("This lead was already converted. Find its company and deal in CRM.");
    const created: [string, number][] = [];
    // ponytail: local storage has no multi-collection transaction; compensate
    // failed writes. Move to a SQLite transaction if crash-atomic conversion is needed.
    try {
      const companyId = await sInsert("crm_customers", { name: lead.name, company: lead.company || lead.name, email: lead.email || null, phone: lead.phone || null, segment: "Converted lead" });
      created.push(["crm_customers", companyId]);
      const personId = await sInsert("crm_people", { company_id: companyId, name: lead.name, email: lead.email || null, phone: lead.phone || null, owner: lead.owner || null, is_primary: true });
      created.push(["crm_people", personId]);
      const dealId = await sInsert("crm_opportunities", { title: `${lead.company || lead.name} — new opportunity`, customer_name: lead.company || lead.name, customer_id: companyId, person_id: personId, stage: "qualification", value: lead.est_value || 0, probability: 20, owner: lead.owner || null });
      created.push(["crm_opportunities", dealId]);
      await sUpdate("crm_leads", leadId, { status: "converted", converted_company_id: companyId, converted_person_id: personId, converted_deal_id: dealId });
      return dealId;
    } catch (error) {
      const rollback = await Promise.allSettled(created.reverse().map(([table, id]) => sDelete(table, id)));
      if (rollback.some((r) => r.status === "rejected")) throw new Error("Lead conversion failed and some new records could not be removed. Review companies, contacts and deals before retrying.");
      throw error;
    }
  });
  leadConversions.set(leadId, run);
  try { const id = await run; markWrite(); notifyDataChanged(); return id; }
  finally { leadConversions.delete(leadId); }
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
  convertLead,
  customers: () =>
    readCached<CrmCustomer[]>(
      "crm_customers",
      () =>
        sList<CrmCustomer>("crm_customers", [{ col: "name", asc: true }]),
      [], ["crm_customers"]
    ),
  createCustomer: (input: Omit<CrmCustomer, "id" | "created_at">) => {
    const row = clean(input as Record<string, unknown>);
    return write({ k: "insert", t: "crm_customers", row }, () =>
      sInsert("crm_customers", row), -1
    );
  },
  /** Import path: every row in one write. See writeMany. */
  createCustomers: (inputs: Omit<CrmCustomer, "id" | "created_at">[]) => {
    const rows = inputs.map((i) => clean(i as Record<string, unknown>));
    return writeMany(
      rows.map((row) => ({ k: "insert" as const, t: "crm_customers", row })),
      () => sInsertMany("crm_customers", rows),
      []
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
  /** Addresses that must never receive a campaign. Read on every send. */
  optOuts: () =>
    readCached<EmailOptOut[]>(
      "email_optouts",
      () => sList<EmailOptOut>("email_optouts", [{ col: "id", asc: false }]),
      []
    ),
  /** The same list, for the send path. No cache and no empty fallback: a read
   *  that fails must not look like "nobody has unsubscribed", so the error
   *  travels and the campaign stops instead of mailing the whole opt-out list. */
  optOutsStrict: () =>
    sList<EmailOptOut>("email_optouts", [{ col: "id", asc: false }]),
  addOptOut: (email: string, reason: EmailOptOut["reason"] = "manual") => {
    const row = clean({ email: email.trim().toLowerCase(), reason });
    return write({ k: "insert", t: "email_optouts", row }, () =>
      sInsert("email_optouts", row), -1
    );
  },
  /** Only for an address added by mistake — an unsubscribe is not undoable by
   *  the business, and the UI does not offer it for those. */
  removeOptOut: (id: number) =>
    write({ k: "delete", t: "email_optouts", id }, () =>
      sDelete("email_optouts", id), undefined
    ),
  campaigns: () =>
    readCached<Campaign[]>(
      "campaigns",
      async () => {
        const rows = await sList<Record<string, unknown>>("campaigns", [
          { col: "id", asc: false },
        ]);
        // The local SQLite shim stores jsonb columns as TEXT, so both shapes
        // have to be tolerated on read.
        return rows.map((r) => ({
          ...(r as unknown as Campaign),
          audience: parseJsonCol(r.audience, {}),
          recipients: parseJsonCol(r.recipients, [] as CampaignRecipient[]),
        }));
      },
      []
    ),
  createCampaign: (input: {
    name: string;
    subject: string;
    body_html: string;
    audience: Campaign["audience"];
    recipients: CampaignRecipient[];
  }) => {
    const row = clean({
      name: input.name,
      subject: input.subject,
      body_html: input.body_html,
      status: "draft",
      audience: JSON.stringify(input.audience),
      recipients: JSON.stringify(input.recipients),
    });
    return write({ k: "insert", t: "campaigns", row }, () =>
      sInsert("campaigns", row), -1
    );
  },
  updateCampaign: (id: number, patch: Partial<Campaign>) => {
    const row = clean({
      ...patch,
      ...(patch.audience ? { audience: JSON.stringify(patch.audience) } : {}),
      ...(patch.recipients ? { recipients: JSON.stringify(patch.recipients) } : {}),
    } as Record<string, unknown>);
    return write({ k: "update", t: "campaigns", id, row }, () =>
      sUpdate("campaigns", id, row), undefined
    );
  },
  deleteCampaign: (id: number) =>
    write({ k: "delete", t: "campaigns", id }, () =>
      sDelete("campaigns", id), undefined
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
  /**
   * Move a deal to another stage, closing the loop trycompai closes on every
   * deal: won/lost stamps closed_at + close_reason (both real columns since
   * 2026-07-26-crm-objects.sql), reopening clears them, and every move leaves a
   * kind:"stage_change" activity on the deal so the timeline answers "when did
   * this stall?" without guessing. `reason` is optional and free-text — the
   * win/loss report groups by exactly what was typed.
   */
  setOppStage: async (oppId: number, stage: string, opts?: { reason?: string }) => {
    const patch: Record<string, unknown> = {
      stage,
      probability: STAGE_PROB[stage] ?? 30,
    };
    // Read the current row first: only a move INTO a closing stage stamps the
    // close fields, and only a move OUT of one clears them.
    const { data } = await sb()
      .from("crm_opportunities")
      .select("stage,title")
      .eq("id", oppId)
      .maybeSingle();
    const from = ((data as { stage?: string } | null)?.stage ?? "").toLowerCase();
    const title =
      (data as { title?: string } | null)?.title || "Untitled deal";
    if (!from)
      throw new Error(`Deal ${oppId} not found — it may have been deleted.`);

    const target = stage.toLowerCase();
    if (["won", "lost"].includes(target)) {
      patch.closed_at = new Date().toISOString();
      // Only sent when given — re-closing without a reason must not wipe one.
      const reason = opts?.reason?.trim();
      if (reason) patch.close_reason = reason;
    } else if (["won", "lost"].includes(from)) {
      patch.closed_at = null;
      patch.close_reason = null;
    }

    await write(
      { k: "update", t: "crm_opportunities", id: oppId, row: patch },
      () => sUpdate("crm_opportunities", oppId, patch as never),
      undefined
    );

    // Best-effort trail: a failed activity insert must never roll back the
    // stage move itself.
    if (target !== from) {
      try {
        await crm.createActivity({
          kind: "stage_change",
          subject:
            `${title}: ${from || "new"} → ${target}` +
            (opts?.reason?.trim() ? ` (${opts.reason.trim()})` : ""),
          target_type: "deal",
          target_id: oppId,
        } as Omit<Activity, "id" | "done" | "created_at">);
      } catch {
        /* trail is advisory */
      }
    }
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
  /** Set when the reminder is about a supplier instead of a customer — the two
   *  are mutually exclusive, and the Follow-ups page splits its sections on
   *  this. Unlinked reminders (neither id) count as customer-side. */
  supplier_id?: number | null;
  /** Display name of whichever party the row points at, customer or supplier. */
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

const todayISO = () => todayYmd();

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
    supplier_id?: number | null;
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
  pattern: RegExp,
  client: any = null
): Promise<number> {
  const { data, error } = await (client ?? sb())
    .from("accounts")
    .select("id,name")
    .eq("account_type", type);
  if (error) throw error;
  const list = (data as { id: number; name: string }[] | null) ?? [];
  // Match by name pattern only — no "first account of this type" fallback. That
  // fallback let e.g. the AP lookup grab an "Output VAT" liability (and vice
  // versa); a dedicated account is created instead when nothing matches.
  const acct = list.find((a) => pattern.test(a.name));
  if (acct) return acct.id;
  return sInsert("accounts", { code, name, account_type: type, balance: 0 }, client);
}

async function findOrCreateOutputVatAccount(client: any = null): Promise<number> {
  // Named without "Payable" so the AP pattern can't claim it.
  return findOrCreateAccount("liability", "2100", "Output VAT", /output vat|vat on sales|sales vat/i, client);
}
async function findOrCreateInputVatAccount(client: any = null): Promise<number> {
  return findOrCreateAccount(
    "asset",
    "1250",
    "Input VAT",
    /input vat|vat on purchases|purchase vat|vat recoverable/i, client
  );
}

async function findOrCreateSalesAccount(client: any = null): Promise<number> {
  return findOrCreateAccount("revenue", "4000", "Sales Revenue", /sales|revenue|income/i, client);
}
async function findOrCreateArAccount(client: any = null): Promise<number> {
  return findOrCreateAccount(
    "asset",
    "1200",
    "Accounts Receivable",
    /\b(receivable|debtors|ar)\b/i, client
  );
}
async function findOrCreateCashAccount(client: any = null): Promise<number> {
  return findOrCreateAccount(
    "asset",
    "1000",
    "Cash & Bank",
    /cash|bank/i, client
  );
}

/** Where the difference goes when a foreign invoice settles at a rate other
 *  than the one it was raised at. Held as an expense account carrying both
 *  directions: a loss adds to it, a gain nets against it. Only ever created
 *  when a difference actually arises, so a business billing in pegged dollars
 *  never sees it. */
async function findOrCreateFxAccount(client: any = null): Promise<number> {
  return findOrCreateAccount(
    "expense",
    "5900",
    "Foreign Exchange Gain/Loss",
    /foreign exchange|fx gain|exchange (gain|loss)/i, client
  );
}

async function findOrCreateExpenseAccount(client: any = null): Promise<number> {
  return findOrCreateAccount("expense", "5000", "Operating Expenses", /operating|expense|general/i, client);
}

async function findOrCreatePayrollAccount(client: any = null): Promise<number> {
  return findOrCreateAccount("expense", "5200", "Salaries & Wages", /\b(salar(?:y|ies)|payroll|wages?)\b/i, client);
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
type InvoiceTxn = {
  id: number; account_id: number | null; txn_type: string; amount: number | string;
  invoice_id?: number | null; source?: string | null; ref?: string | null;
  description?: string; txn_date?: string;
};

async function reverseTransactions(txns: InvoiceTxn[], client: any = null): Promise<void> {
  if (!txns.length) return;
  const accts = await sList<Account>("accounts", undefined, "*", client);
  const typeById = new Map(accts.map((a) => [a.id, a.account_type]));
  for (const t of txns) {
    const delta = t.account_id
      ? -ledgerDelta(typeById.get(t.account_id) ?? "asset", t.txn_type, Number(t.amount))
      : 0;
    if (t.account_id) {
      await adjustAccountBalance(t.account_id, delta, client);
    }
    try {
      await sDelete("transactions", t.id, client);
    } catch (error) {
      if (t.account_id) await adjustAccountBalance(t.account_id, -delta, client);
      throw error;
    }
  }
}

async function reverseInvoiceTransactions(
  invoiceId: number | undefined,
  ref: string,
  includePayments = false,
  client: any = null,
): Promise<number> {
  // Match by BOTH keys. Postings made before invoice_id was tracked carry only
  // a ref; reversing by either key keeps re-finalize from leaving orphan rows
  // that pile up (the "8 invoices → 15 entries" bug). Dedup by row id so a row
  // matched on both keys isn't reversed twice.
  const rows = new Map<number, InvoiceTxn>();
  const db = client ?? sb();
  const byRef = await db.from("transactions").select("*").eq("ref", ref);
  if (byRef.error) throw byRef.error;
  for (const t of (byRef.data ?? []) as InvoiceTxn[]) {
    if (!t.invoice_id || t.invoice_id === invoiceId) rows.set(t.id, t);
  }
  if (invoiceId) {
    const byId = await db
      .from("transactions")
      .select("*")
      .eq("invoice_id", invoiceId);
    if (byId.error) throw byId.error;
    for (const t of (byId.data ?? []) as InvoiceTxn[]) rows.set(t.id, t);
  }
  const txns = [...rows.values()].filter((t) => includePayments ||
    (t.source !== "payment" && !/ Payment(?: #\d+)?$/.test(t.ref ?? "")));
  await reverseTransactions(txns, client);
  return txns.length;
}

/** Undo a document's Inventory (and, for sales, Orders) footprint. A sales
 *  invoice decremented stock (restore by +qty) and has a linked SO; a purchase
 *  invoice incremented stock (restore by -qty) and has no order. */
async function reverseInvoiceOrderAndStock(
  number: string,
  items: { product_id?: number; qty: number; unit_price: number }[],
  isPurchase = false,
  client: any = null,
) {
  if (!isPurchase) {
    const orderNumber = `SO-${number}`;
    const { data: order, error } = await (client ?? sb())
      .from("orders")
      .select("id")
      .eq("order_number", orderNumber)
      .maybeSingle();
    if (error) throw error;
    if (order?.id) {
      await sDelete("orders", order.id, client);
    }
  }
  const dir = isPurchase ? -1 : 1;
  const ref = `${isPurchase ? "Bill" : "Invoice"} ${number}`;
  const movements = await sChildren<{ product_id: number; qty: number }>("stock_movements", "ref", ref, undefined, client);
  if (movements.length) {
    const net = new Map<number, number>();
    for (const m of movements) net.set(m.product_id, (net.get(m.product_id) ?? 0) + Number(m.qty));
    for (const [productId, qty] of net) {
      if (qty) await adjustProductStock(productId, -qty, {
        type: isPurchase ? "purchase" : "sale", ref, note: "Posting reversed",
      }, client);
    }
    return;
  }
  for (const it of items) {
    if (!it.product_id || !it.qty) continue;
    await adjustProductStock(it.product_id, dir * Math.abs(Number(it.qty)), {
      type: isPurchase ? "purchase" : "sale",
      ref: `${isPurchase ? "Bill" : "Invoice"} ${number}`,
      note: "Posting reversed",
    }, client);
  }
}

/** Mirror a finalized invoice into Orders, Inventory and Accounting.
 *  Reverses any previous posting first, so re-finalizing or editing an already
 *  posted invoice keeps the three modules in sync. */
/**
 * Statuses that mean "this invoice is live and belongs in Orders, Inventory and
 * the ledger". Only "draft" is unposted. Testing for "sent" alone meant that
 * collecting payment — which moves the invoice to "paid" — reversed the very
 * postings the sale had created, emptying the books for work already invoiced.
 */
const POSTED_STATUSES = new Set(["sent", "paid", "overdue"]);
export const isPostedStatus = (status: unknown) => POSTED_STATUSES.has(String(status ?? ""));

async function propagateInvoice(
  doc: Record<string, unknown>,
  items: {
    product_id?: number;
    qty: number;
    unit_price: number;
    // Carries per-line meta (calc mode, manual amount, formula, per-line
    // tax/discount) so the linked order total matches the invoice exactly.
    custom?: Record<string, string> | null;
  }[],
  client: any = null,
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
    const prior = await reverseInvoiceTransactions(id || undefined, ref, false, client);
    if (prior > 0) await reverseInvoiceOrderAndStock(number, items, isPurchase, client);

    const { net: netDoc, tax: taxDoc, total: totalDoc } = docTotals(
      {
        tax_rate: Number(doc.tax_rate ?? 0),
        discount: Number(doc.discount ?? 0),
        // Both of these were missing, so the ledger recomputed the document from
        // a different formula than the document itself uses: round-off left the
        // posted total up to 0.50 away from the printed one (AR never cleared,
        // because payments settle against the rounded figure), and a doc-level
        // unit-price formula was ignored entirely in favour of qty × price.
        unit_price_formula:
          (doc.unit_price_formula as { a: string; b?: string } | null) ?? null,
        round_off: !!doc.round_off,
      },
      items
    );
    // The ledger is kept in ONE currency. A document written in dollars must be
    // posted at its dirham value or the trial balance stops balancing against
    // reality, the P&L reports dollars as dirhams, and the VAT return — which
    // is derived from the tax accounts — under-reports by the exchange rate.
    // The document's own frozen rate is the one that applied on the date of
    // supply, which is what the FTA asks for.
    const ledgerRates = await getExchangeRates().catch(() => ({}));
    const toBase = (v: number) =>
      docAmountInAed(v, doc.currency as string, doc.fx_rate as number, ledgerRates);
    const net = toBase(netDoc);
    const tax = toBase(taxDoc);
    const total = toBase(totalDoc);
    const txnDate = (doc.issue_date as string) || todayYmd();

    if (isPurchase) {
      // Purchase invoice (supplier bill): stock IN, debit Purchases, credit AP.
      // products.cost_price is held in the base currency, so a bill in USD has
      // to be converted before it touches the moving average — otherwise a
      // $10 part is booked as costing 10 dirhams and every margin, COGS figure
      // and stock valuation downstream is wrong by the exchange rate.
      for (const it of items) {
        if (!it.product_id || !it.qty) continue;
        const qty = Math.abs(Number(it.qty));
        // Moving average first — needs the pre-receipt on-hand quantity.
        await applyMovingAverageCost(it.product_id, qty, toBase(Number(it.unit_price) || 0), client);
        await adjustProductStock(it.product_id, qty, { type: "purchase", ref }, client);
      }
      if (total > 0) {
        const inventoryId = await findOrCreateInventoryAccount(client);
        const apId = await findOrCreateApAccount(client);
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
          }, client);
          await adjustAccountBalance(inventoryId, ledgerDelta("asset", "debit", net), client);
        }
        // debit Input VAT (recoverable) for the tax portion
        if (tax > 0) {
          const vatId = await findOrCreateInputVatAccount(client);
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
            }, client);
            await adjustAccountBalance(vatId, ledgerDelta("asset", "debit", tax), client);
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
          }, client);
          await adjustAccountBalance(apId, ledgerDelta("liability", "credit", total), client);
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
    }, client);
    for (const it of items) {
      if (!it.product_id || !it.qty) continue;
      await adjustProductStock(it.product_id, -Math.abs(Number(it.qty)), {
        type: "sale",
        ref,
      }, client);
    }
    // COGS: relieve Inventory at cost and book the cost of the sale. Only
    // product-linked lines have a cost; free-text lines are skipped. Tagged with
    // this invoice's ref/id so it reverses with the rest on revert.
    {
      const products = await sList<Product>("products", undefined, "*", client);
      const costById = new Map(products.map((p) => [p.id, Number(p.cost_price) || 0]));
      let cogs = 0;
      for (const it of items) {
        if (!it.product_id || !it.qty) continue;
        cogs += (costById.get(it.product_id) ?? 0) * Math.abs(Number(it.qty));
      }
      cogs = Math.round(cogs * 100) / 100;
      if (cogs > 0) {
        const cogsId = await findOrCreateCogsAccount(client);
        const invId = await findOrCreateInventoryAccount(client);
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
          }, client);
          await adjustAccountBalance(cogsId, ledgerDelta("expense", "debit", cogs), client);
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
          }, client);
          await adjustAccountBalance(invId, ledgerDelta("asset", "credit", cogs), client);
        }
      }
    }
    if (total > 0) {
      const revenueId = await findOrCreateSalesAccount(client);
      const arId = await findOrCreateArAccount(client);
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
        }, client);
        await adjustAccountBalance(revenueId, ledgerDelta("revenue", "credit", net), client);
      }
      // credit Output VAT (liability owed to the tax authority)
      if (tax > 0) {
        const vatId = await findOrCreateOutputVatAccount(client);
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
          }, client);
          await adjustAccountBalance(vatId, ledgerDelta("liability", "credit", tax), client);
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
        }, client);
        await adjustAccountBalance(arId, ledgerDelta("asset", "debit", total), client);
      }
    }
  } catch (e) {
    console.error("Invoice propagation failed:", e);
    throw e;
  }
}

/** Remove an invoice's footprint from Orders, Inventory and Accounting. */
async function unpropagateInvoice(
  doc: Record<string, unknown>,
  items: { product_id?: number; qty: number; unit_price: number }[],
  client: any = null,
) {
  try {
    const id = Number(doc.id ?? 0);
    const number = String(doc.number ?? "").trim();
    if (!number) return;
    const isPurchase = doc.doc_type === "purchase";
    const ref = `${isPurchase ? "Bill" : "Invoice"} ${number}`;
    const prior = await reverseInvoiceTransactions(id || undefined, ref, false, client);
    if (prior > 0 || isPostedStatus(doc.status)) await reverseInvoiceOrderAndStock(number, items, isPurchase, client);
  } catch (e) {
    console.error("Invoice unpropagation failed:", e);
    throw e;
  }
}

async function findOrCreateApAccount(client: any = null): Promise<number> {
  return findOrCreateAccount(
    "liability",
    "2000",
    "Accounts Payable",
    /\b(payable|creditors|ap)\b/i, client
  );
}
/** Inventory as a balance-sheet asset — stock you've bought to resell. The cost
 *  sits here until the goods are sold (then it becomes COGS). */
async function findOrCreateInventoryAccount(client: any = null): Promise<number> {
  return findOrCreateAccount("asset", "1300", "Inventory", /inventory|stock/i, client);
}
async function findOrCreateCogsAccount(client: any = null): Promise<number> {
  return findOrCreateAccount("expense", "5050", "Cost of Goods Sold", /cost of goods|cogs/i, client);
}

function purchaseTotals(doc: Pick<PurchaseOrder, "discount" | "tax_rate" | "unit_price_formula">, items: PoItem[]) {
  return lineAwareTotals(items.map(it => ({
    ...splitItemMeta(it.custom), description: it.description,
    qty: Number(it.quantity), unit_price: Number(it.unit_cost),
  })), Number(doc.discount ?? 0), Number(doc.tax_rate ?? 0), doc.unit_price_formula);
}

/** Recalculate from saved lines: older PO totals sometimes excluded VAT.
 * This keeps Inventory net, Input VAT separate and Accounts Payable gross. */
async function propagatePurchase(doc: Record<string, unknown>) {
  try {
    const number = String(doc.po_number ?? "").trim();
    if (!number) return;
    const ref = `PO ${number}`;
    const items = await sChildren<PoItem>("purchase_order_items", "po_id", Number(doc.id));
    const totals = purchaseTotals(doc as unknown as PurchaseOrder, items);
    const rates = await getExchangeRates().catch(() => ({}));
    const toBase = (value: number) => r2(docAmountInAed(value, doc.currency as string, doc.fx_rate as number, rates));
    const gross = toBase(totals.total);
    const tax = toBase(totals.tax);
    const net = r2(gross - tax);
    await reverseInvoiceTransactions(undefined, ref);
    if (gross <= 0) return;
    const txnDate =
      (doc.order_date as string) || todayYmd();
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
        // Ask for the summary columns only. `select("*")` pulled all 36 of
        // them, and invoice_docs carries `logo` — a base64 data URL — so
        // rendering a list of numbers and totals shipped an embedded image per
        // invoice, plus notes, terms, addresses and the stamp/signature blobs.
        // (The local shim ignores the column list and returns whole rows, which
        // costs nothing there; this is purely for the cloud round trip.)
        const DOC_COLS =
          "id,user_id,number,customer_id,quotation_id,customer_name,status,template,currency,fx_rate,issue_date,due_date," +
          "shared,shared_with,updated_at,tax_rate,discount,round_off,unit_price_formula,doc_type";
        const [allDocs, items, payments] = await Promise.all([
          // A purchase list can be filtered server-side. A sales list can't:
          // doc_type is null on legacy rows and those count as sales, which
          // PostgREST's neq would exclude — and the shim has no or(). Narrow
          // rows make the client-side pass cheap either way.
          docType === "purchase"
            ? sList<any>(
                "invoice_docs",
                [
                  { col: "issue_date", asc: false },
                  { col: "id", asc: false },
                ],
                DOC_COLS
              ).then((rows) => rows.filter((d) => d.doc_type === "purchase"))
            : sList<any>(
                "invoice_docs",
                [
                  { col: "issue_date", asc: false },
                  { col: "id", asc: false },
                ],
                DOC_COLS
              ),
          sList<any>(
            "invoice_doc_items",
            undefined,
            "invoice_id,qty,unit_price,custom,tax_category"
          ),
          sList<any>("invoice_payments", undefined, "invoice_id,amount"),
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
          const docLines = byDoc.get(d.id) ?? [];
          const total = docTotal(d, docLines);
          const paid = paidByDoc.get(d.id) ?? 0;
          return {
            id: d.id,
            number: d.number,
            customer_id: d.customer_id,
            quotation_id: d.quotation_id,
            customer_name: d.customer_name,
            status: d.status,
            template: d.template,
            total,
            currency: d.currency ?? "AED",
            // The rate frozen when this document was saved. Without it every
            // list total has to guess at today's rate, and last quarter's
            // figures move every time the market does.
            fx_rate: d.fx_rate ?? undefined,
            paid,
            balance: Math.max(0, total - paid),
            issue_date: d.issue_date ?? undefined,
            due_date: d.due_date ?? undefined,
            shared: d.shared ?? undefined,
            updated_at: d.updated_at,
            tax_rate: d.tax_rate ?? undefined,
            net_by_tax_category: netByTaxCategory(
              docLineItems(docLines) as never,
              d.discount,
              d.unit_price_formula
            ),
          };
        }) as InvoiceDocSummary[];
      },
      [], ["invoice_docs", "invoice_doc_items", "invoice_payments"]
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
        // Filter server-side. This used to pull every item row in the database
        // and discard all but one document's worth in JavaScript, so opening a
        // single invoice cost a full-table transfer.
        const { data: itemRows, error: itemErr } = await sb()
          .from("invoice_doc_items")
          .select("*")
          .eq("invoice_id", docId)
          .order("position", { ascending: true })
          .order("id", { ascending: true });
        if (itemErr) throw itemErr;
        const items = (itemRows ?? []) as any[];
        return {
          ...(d as InvoiceDoc),
          items: items
            // The query above already filtered on invoice_id server-side, so
            // this is belt-and-braces — but with === it was a liability: an id
            // that came back as a string would match nothing, silently yield an
            // empty item list, and saveDoc would then persist that emptiness.
            // eslint-disable-next-line eqeqeq
            .filter((i) => i.invoice_id == docId)
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
      if (items.length > 500) throw new Error("A document supports at most 500 lines.");
      if (items.some((item) => !Number.isFinite(Number(item.qty)) || Number(item.qty) < 0 ||
        !Number.isFinite(Number(item.unit_price)) || Number(item.unit_price) < 0))
        throw new Error("Invoice quantities and prices must be finite, non-negative numbers.");
      const row = clean(docFields as Record<string, unknown>);
      if (!id && !row.tax_country_code) {
        const company = await billing.getCompany();
        if (company.country_code) row.tax_country_code = company.country_code;
      }
      validateCountry(row.tax_country_code as string | undefined, row.template as string | undefined);
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
      const persist = async (client: any) => {
        let docId: number;
        // Ids of the lines this save replaces. They are NOT deleted here: this
        // used to wipe every item first and re-insert after, with no transaction
        // between, so anything that made the insert fail — a column the cloud DB
        // hadn't migrated yet, a check constraint, a dropped connection — left
        // the invoice permanently empty and showing a zero total. The delete is
        // deferred until the replacements are safely written.
        let staleItemIds: number[] = [];
        let previousDoc: Record<string, unknown> | null = null;
        let previousItems: any[] = [];
        if (id && id > 0) {
          const previous = await client.from("invoice_docs").select("*").eq("id", id).single();
          if (previous.error) throw previous.error;
          previousDoc = previous.data;
          const { data: existing, error } = await client
            .from("invoice_doc_items")
            .select("*")
            .eq("invoice_id", id);
          if (error) throw error;
          staleItemIds = ((existing ?? []) as { id: number }[]).map((r) => r.id);
          previousItems = existing ?? [];
          docId = id;
        } else {
          await checkFreeInvoiceCap(invoicesThisMonth);
          docId = await sInsert("invoice_docs", row, client);
        }
        let insertedItemIds: number[] = [];
        try {
          if (items.length) {
            insertedItemIds = await sInsertMany(
              "invoice_doc_items",
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
              })),
              client,
            );
            // Throwing here now costs the user nothing: the previous lines are
            // still in the table, so the invoice survives a failed save intact.
          }
          if (previousDoc) await sUpdate("invoice_docs", docId, row, client);
          // Replacements are in. Retiring the old lines by id (rather than by
          // invoice_id) is what keeps the ones just written.
          if (staleItemIds.length) {
            const { error } = await client.from("invoice_doc_items").delete().in("id", staleItemIds);
            if (error) throw error;
          }
          return { docId, previousDoc, previousItems };
        } catch (error) {
          // Device writes are staged by withLocalTransaction. Cloud retains a
          // compensating path until invoice posting has a server transaction.
          if (!isLocalMode()) {
            try {
              await sDeleteMany("invoice_doc_items", insertedItemIds, client);
              if (previousDoc) {
                await sUpdate("invoice_docs", docId, previousDoc, client);
                if (previousItems.length) {
                  const restored = await client
                    .from("invoice_doc_items")
                    .upsert(previousItems, { onConflict: "id" });
                  if (restored.error) throw restored.error;
                }
              } else await sDelete("invoice_docs", docId, client);
            } catch {
              throw new Error(
                "The invoice save failed and could not be fully restored. Reopen this invoice and check its lines before retrying.",
              );
            }
          }
          throw error;
        }
      };
      const saveAndPost = async (client: any) => {
        const { docId, previousDoc, previousItems } = await persist(client);
        // Keep the invoice, its lines, stock and ledger in the same local commit.
        // Reverse the PREVIOUS quantities and number before posting an edit.
        if (previousDoc) await unpropagateInvoice(previousDoc, previousItems, client);
        const docRow: Record<string, unknown> = { ...row, id: docId };
        if (isPostedStatus(docRow.status)) {
          await propagateInvoice(docRow, items, client);
        } else {
          await unpropagateInvoice(docRow, items, client);
        }
        return docId;
      };
      return isLocalMode() ? withLocalTransaction(saveAndPost) : saveAndPost(sb());
    }),
  deleteDoc: (docId: number) =>
    online(async () => {
      const { data: doc, error } = await sb()
        .from("invoice_docs")
        .select("*")
        .eq("id", docId)
        .single();
      if (error) throw error;
      const items = await sChildren<any>("invoice_doc_items", "invoice_id", docId);
      await unpropagateInvoice(
        doc as Record<string, unknown>,
        items
          .map((i) => ({
            product_id: i.product_id ?? undefined,
            qty: i.qty,
            unit_price: i.unit_price,
          }))
      );
      // Reverse receipts while the foreign key still identifies their invoice.
      await reverseInvoiceTransactions(docId, `Invoice ${doc.number} Payment`, true);
      // Restore any advance credit this invoice had consumed — otherwise the
      // negative `applied:inv#<id>` ledger row outlives the invoice and the
      // customer's credit stays reduced by a document that no longer exists.
      const advs = await sList<any>("advances");
      for (const a of advs) if (a.note === `applied:inv#${docId}`) await sDelete("advances", a.id);
      // Local storage has no FK cascades; explicitly clean child rows in both modes.
      for (const table of ["invoice_payments", "invoice_doc_items"]) {
        const { error: childError } = await sb().from(table).delete().eq("invoice_id", docId);
        if (childError) throw childError;
      }
      await sDelete("invoice_docs", docId);
      return undefined;
    }),
  setStatus: (docId: number, status: string) =>
    online(
      async () => {
        const change = async (client: any) => {
          const { data: doc, error } = await client
            .from("invoice_docs")
            .select("*")
            .eq("id", docId)
            .single();
          if (error) throw error;
          const items = await sChildren<any>("invoice_doc_items", "invoice_id", docId, undefined, client);
          await sUpdate("invoice_docs", docId, { status }, client);
          if (isPostedStatus(status) === isPostedStatus(doc.status)) return;
          const docItems = items
            .map((i) => ({
              product_id: i.product_id ?? undefined,
              qty: i.qty,
              unit_price: i.unit_price,
              custom: i.custom ?? undefined, // keep meta so the order total matches
              tax_category: i.tax_category ?? undefined,
            }));
          if (isPostedStatus(status)) {
            await propagateInvoice(doc as Record<string, unknown>, docItems, client);
          } else {
            await unpropagateInvoice(doc as Record<string, unknown>, docItems, client);
          }
        };
        return isLocalMode() ? withLocalTransaction(change) : change(sb());
      }
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
  /** Team-share an invoice: with the whole org (all=true) or specific
   *  members (replaces shared_with). Server validates author/admin. */
  shareWithMembers: (docId: number, all: boolean, userIds: string[]) =>
    online(async () => {
      const { data, error } = await sb().rpc("share_invoice", {
        p_id: docId,
        p_all: all,
        p_user_ids: JSON.parse(JSON.stringify(userIds ?? [])),
      });
      if (error) throw error;
      if (!data?.ok) throw new Error("Sharing was not saved. Check your permissions and selected members.");
    }),
  /** The invoice's current team-visibility state (author/admin reads directly). */
  sharingState: (docId: number) =>
    online(async () => {
      const { data, error } = await sb()
        .from("invoice_docs")
        .select("shared, shared_with, user_id")
        .eq("id", docId)
        .single();
      if (error) throw error;
      return data as { shared: boolean; shared_with: string[] | null; user_id: string };
    }, false),
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
  /** Complete dated payment history for reporting; consumers must join to the
   * relevant sales/purchase invoices before aggregating or converting currency. */
  allPayments: () =>
    readCached<InvoicePayment[]>(
      "invoice_payments:all",
      () => sList<InvoicePayment>("invoice_payments", [{ col: "paid_at", asc: false }]),
      []
    ),
  payments: (invoiceId: number) =>
    online(async () => {
      const { data, error } = await sb()
        .from("invoice_payments")
        .select("*")
        .eq("invoice_id", invoiceId)
        .order("paid_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as InvoicePayment[];
    }, false),
  addPayment: (
    invoiceId: number,
    amount: number,
    method: string | null,
    paidAt: string
  ) =>
    online(async () => {
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a payment amount greater than zero.");
      if (!paidAt || Number.isNaN(Date.parse(paidAt))) throw new Error("Enter a valid payment date.");
      const payRates = await getExchangeRates().catch(() => ({}));
      const record = async (client: any) => {
        // Validate and read before inserting: a missing/inaccessible invoice must
        // never leave an orphan payment behind or turn a failed read into 'paid'.
        const [{ data: doc, error: docError }, items, pays] = await Promise.all([
          client.from("invoice_docs").select("*").eq("id", invoiceId).single(),
          sChildren<any>("invoice_doc_items", "invoice_id", invoiceId, undefined, client),
          sChildren<InvoicePayment>("invoice_payments", "invoice_id", invoiceId, undefined, client),
        ]);
        if (docError) throw docError;
        if (!doc) throw new Error("Invoice not found or access denied.");
        const docRow = doc as InvoiceDoc;
        if (!isPostedStatus(docRow.status))
          throw new Error(
            "Finalize this invoice before recording a payment. Use an advance for a prepayment.",
          );
        const isPurchase = docRow.doc_type === "purchase";
        const total = docTotal(docRow, items);
        const paid = pays.reduce((sum, payment) => sum + Number(payment.amount), amount);
        const { data: pay, error: paymentError } = await client
          .from("invoice_payments")
          .insert({
            invoice_id: invoiceId,
            amount,
            method: method ?? null,
            paid_at: paidAt,
          })
          .select("id")
          .single();
        if (paymentError) throw paymentError;
        const paymentId = (pay as { id: number } | null)?.id;

        // Auto-mark the invoice paid once the balance is cleared.
        const status = paid >= total - 0.005 ? "paid" : docRow.status === "paid" ? "sent" : docRow.status;
        if (status !== docRow.status) await sUpdate("invoice_docs", invoiceId, { status }, client);

        // Customer receipts debit Cash and credit AR. Supplier bill payments
        // credit Cash and debit AP; paying a supplier must never increase cash.
        // The payment is entered in the INVOICE's currency, and the ledger is in
        // the base one. Posting face value credited AR by 500 against a debit of
        // 1,836 for the same $500 — so the receivable never cleared however much
        // the customer paid, and cash was understated by the exchange rate.
        const docCurrency = (docRow as { currency?: string } | null)?.currency;
        const docFx = (docRow as { fx_rate?: number } | null)?.fx_rate;
        // AR was raised at the rate on the date of supply, so it must be RELIEVED
        // at that same rate or the receivable never reaches zero.
        const amountBase = docAmountInAed(amount, docCurrency, docFx, payRates);
        // Cash, though, is worth what it was worth on the day it arrived. When
        // those differ the gap is a real gain or loss, not a rounding artefact —
        // it posts to Foreign Exchange Gain/Loss so the books still balance.
        // Pegged currencies produce zero here and no account is ever created.
        // …but only when a spot rate actually exists. Without one, converting
        // "spot" passes the raw number through, which would read as a loss the
        // size of the whole invoice. No rate means no opinion: settle at the
        // document's own rate and post no difference.
        const amountSpot = unratedCurrency(docCurrency, null, payRates)
          ? amountBase
          : docAmountInAed(amount, docCurrency, null, payRates);
        const fxDiff = Number((amountSpot - amountBase).toFixed(2));
        const ref = `Invoice payment #${paymentId}`;
        const cashId = await findOrCreateCashAccount(client);
        const arId = await (isPurchase ? findOrCreateApAccount(client) : findOrCreateArAccount(client));
        if (cashId > 0) {
          await sInsert(
            "transactions",
            {
              account_id: cashId,
              txn_type: isPurchase ? "credit" : "debit",
              amount: amountSpot,
              description: `${ref} — Cash/Bank`,
              ref,
              source: "payment",
              invoice_id: invoiceId,
              txn_date: paidAt,
            },
            client,
          );
          await adjustAccountBalance(
            cashId,
            ledgerDelta("asset", isPurchase ? "credit" : "debit", amountSpot),
            client,
          );
        }
        if (Math.abs(fxDiff) >= 0.01) {
          // Cash came in worth more than the receivable (gain, credit) or less
          // (loss, debit). Either way this is the entry that keeps debits and
          // credits equal once the two legs are valued at different rates.
          const fxId = await findOrCreateFxAccount(client);
          if (fxId > 0) {
            const gain = isPurchase ? fxDiff < 0 : fxDiff > 0;
            await sInsert(
              "transactions",
              {
                account_id: fxId,
                txn_type: gain ? "credit" : "debit",
                amount: Math.abs(fxDiff),
                description: `${ref} — exchange ${gain ? "gain" : "loss"}`,
                ref,
                source: "payment",
                invoice_id: invoiceId,
                txn_date: paidAt,
              },
              client,
            );
            await adjustAccountBalance(
              fxId,
              ledgerDelta("expense", gain ? "credit" : "debit", Math.abs(fxDiff)),
              client,
            );
          }
        }
        if (arId > 0) {
          await sInsert(
            "transactions",
            {
              account_id: arId,
              txn_type: isPurchase ? "debit" : "credit",
              amount: amountBase,
              description: `${ref} — ${isPurchase ? "AP" : "AR"} reduction`,
              ref,
              source: "payment",
              invoice_id: invoiceId,
              txn_date: paidAt,
            },
            client,
          );
          await adjustAccountBalance(
            arId,
            ledgerDelta(isPurchase ? "liability" : "asset", isPurchase ? "debit" : "credit", amountBase),
            client,
          );
        }
        return paymentId;
      };
      return isLocalMode() ? withLocalTransaction(record) : record(sb());
    }),
  removePayment: (id: number) =>
    online(async () => {
      const remove = async (client: any) => {
        const { data: p, error } = await client
          .from("invoice_payments")
          .select("*")
          .eq("id", id)
          .single();
        if (error) throw error;
        const invoiceId = (p as { invoice_id?: number } | null)?.invoice_id;
        if (invoiceId) {
          // Reverse the accounting entries for this payment.
          const { data: doc, error: docError } = await client
            .from("invoice_docs")
            .select("*")
            .eq("id", invoiceId)
            .single();
          if (docError) throw docError;
          const docMeta = doc as InvoiceDoc;
          const txns = await sChildren<InvoiceTxn>(
            "transactions",
            "invoice_id",
            invoiceId,
            undefined,
            client,
          );
          let selected = txns.filter((t) => t.ref === `Invoice payment #${id}`);
          if (!selected.length) {
            // Older versions gave every receipt the same ref. Recover each receipt's
            // cash / optional FX / AR bundle, never the invoice's sale or COGS legs.
            const legacy = txns
              .filter((t) => t.source === "payment" && / Payment$/.test(t.ref ?? ""))
              .sort((a, b) => a.id - b.id);
            const bundles: InvoiceTxn[][] = [];
            let bundle: InvoiceTxn[] = [];
            for (const t of legacy) {
              bundle.push(t);
              if (/— (?:AR|AP) reduction$/.test(t.description ?? "")) {
                bundles.push(bundle);
                bundle = [];
              }
            }
            const baseAmount = docAmountInAed(
              Number(p.amount),
              docMeta.currency,
              docMeta.fx_rate,
              await getExchangeRates().catch(() => ({})),
            );
            const matches = bundles.filter(
              (b) =>
                b.every((t) => t.txn_date?.slice(0, 10) === String(p.paid_at).slice(0, 10)) &&
                Math.abs(Number(b[b.length - 1].amount) - baseAmount) < 0.005,
            );
            const signature = (b: InvoiceTxn[]) =>
              JSON.stringify(b.map((t) => [t.account_id, t.txn_type, Number(t.amount)]));
            if (
              legacy.length &&
              (!matches.length || matches.some((b) => signature(b) !== signature(matches[0])))
            ) {
              throw new Error(
                "This older payment cannot be matched safely to its ledger entries. Reconcile it before deleting it.",
              );
            }
            selected = matches[0] ?? [];
          }
          await reverseTransactions(selected, client);
          await sDelete("invoice_payments", id, client);
          // If the invoice was fully paid, move it back to sent.
          if (docMeta.status === "paid") {
            const remaining = await sChildren<InvoicePayment>(
              "invoice_payments",
              "invoice_id",
              invoiceId,
              undefined,
              client,
            );
            const items = await sChildren<any>(
              "invoice_doc_items",
              "invoice_id",
              invoiceId,
              undefined,
              client,
            );
            if (
              remaining.reduce((sum, r) => sum + Number(r.amount), 0) <
              docTotal(docMeta, items) - 0.005
            )
              await sUpdate("invoice_docs", invoiceId, { status: "sent" }, client);
          }
        } else {
          await sDelete("invoice_payments", id, client);
        }
      };
      return isLocalMode() ? withLocalTransaction(remove) : remove(sb());
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
          // Keep every column the row has. A hand-listed whitelist here silently
          // dropped fields as the table grew (legal_id / emirate came back blank
          // after a save). Only the row identity is stripped — saveCompany sends
          // this object straight back as an update.
          const { id: _id, org_id: _org, user_id: _uid, created_at: _ca,
            updated_at: _ua, ...rest } = data as Record<string, unknown>;
          const c = rest as unknown as CompanyProfile;
          return {
            ...c,
            trn: c.trn || c.vat_number,
            tax_type: c.tax_type ?? "VAT",
            currency: c.currency ?? "AED",
            default_tax_rate:
              c.tax_type === "None" ? 0 : defaultTaxRate(c.currency ?? "AED", c.default_tax_rate == null ? undefined : Number(c.default_tax_rate), c.country_code),
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
      }, ["company_profile"]
    ),
  saveCompany: async (input: CompanyProfile) => {
    validateCountry(input.country_code);
    const taxError = taxIdError(input.trn, input.country_code);
    if (taxError) throw new Error(taxError);
    if (input.default_tax_rate != null && (!Number.isFinite(input.default_tax_rate) || input.default_tax_rate < 0 || input.default_tax_rate > 100)) throw new Error("Default tax rate must be between 0 and 100.");
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
    markWrite();
    await cacheWrite(`${activeCacheOrg}:company_profile`, input);
    notifyDataChanged();
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
  customer_id?: number | null;
  number: string;
  customer_name: string;
  status: string;
  template: string;
  total: number;
  /** The quote's own currency — not the company's. */
  currency?: string;
  /** AED per unit of `currency`, frozen when the quote was saved. */
  fx_rate?: number | null;
  quote_date?: string;
  valid_until?: string;
  shared?: boolean;
  updated_at: string;
}
export interface QuotationDoc {
  /** Frozen jurisdiction; changing currency never changes tax treatment. */
  tax_country_code?: string;
  id: number;
  number: string;
  status: string;
  template: string;
  accent: string;
  currency: string;
  fx_rate?: number | null;
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
  /** Round the grand total to a whole unit of currency, as invoices can. */
  round_off?: boolean;
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
    }, false),
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
        let base: InvoiceDoc | null = null;
        try {
          base = await billing.getDoc(r.base_invoice_id);
        } catch (e: any) {
          // Only "that invoice is gone" retires a recurrence. Any other
          // failure — offline, RLS hiccup, timeout — is temporary, and
          // cancelling on one silently ends a subscription the user set up,
          // with no way back from the UI. Skip this run and try next time.
          const gone =
            e?.code === "PGRST116" || /no rows/i.test(e?.message ?? String(e));
          if (!gone) continue;
        }
        if (!base) {
          await sUpdate("invoice_recurrence", r.id, { active: false });
          continue;
        }
        // Carry the WHOLE base document and override only what a new
        // occurrence must change. Listing the fields by hand is how this
        // drifted: unit_price_formula, each line's `custom` (manual amounts,
        // per-line discounts and formulas) and round_off were all left behind,
        // so a recurring invoice could bill a different figure than the
        // invoice it recurs from — silently, every month.
        const {
          id: _id,
          created_at: _created,
          updated_at: _updated,
          // Inheriting these would date the new invoice to the old cycle and
          // re-link it to a quotation it did not come from.
          due_date: _due,
          quotation_id: _quote,
          ...carried
        } = base;
        const input: InvoiceDocInput = {
          ...carried,
          number: `${base.number || "INV"}-${today.replace(/-/g, "")}`,
          status: "draft",
          issue_date: today,
          items: base.items.map((it) => ({
            description: it.description,
            qty: it.qty,
            unit_price: it.unit_price,
            unit: it.unit,
            custom: it.custom,
            tax_category: it.tax_category,
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

const quoteTotal = (items: QuotationItem[], doc: QuotationDoc) =>
  applyRoundOff(lineAwareTotals(items.map(it => ({
    ...splitItemMeta(it.custom), description: it.product, qty: it.qty, unit_price: it.rate,
    discount: it.discount, tax: it.tax,
  })), doc.discount ?? 0, doc.tax_rate ?? 0, doc.unit_price_formula), !!doc.round_off).total;

/** One quotation line, converted for an invoice. Returns the money fields only
 *  — the caller owns identity and position.
 *
 *  A quotation line can be a manual amount or a formula, both of which live in
 *  the item's `custom` jsonb. Recomputing qty × rate on conversion therefore
 *  produced an invoice that disagreed with the quote the customer signed. The
 *  accepted figure is pinned as a manual amount instead, and `unit_price` is
 *  back-derived so a per-unit price still prints sensibly. */
function convertedLine(
  it: { qty: number; rate: number; discount?: number; tax?: number; custom?: Record<string, string> | null },
  formula?: { a: string; b: string } | null
): { unit_price: number; custom: Record<string, string> | undefined } {
  const { custom, calcMode, amount, itemFormula } = splitItemMeta(it.custom);
  const line = docLineAmount(
    {
      description: "",
      qty: Number(it.qty) || 0,
      unit_price: Number(it.rate) || 0,
      custom,
      calcMode,
      amount,
      itemFormula,
      discount: Number(it.discount || 0),
      tax: Number(it.tax || 0),
    },
    formula
  );
  const qty = Number(it.qty) || 0;
  return {
    unit_price: qty ? r2(line / qty) : line,
    custom: mergeItemMeta({ custom, calcMode: "manual", amount: line, tax: Number(it.tax || 0) }),
  };
}

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
          customer_id: d.customer_id,
          customer_name: d.customer_name,
          status: d.status,
          template: d.template,
          shared: d.shared ?? false,
          total: quoteTotal(byDoc.get(d.id) ?? [], d),
          // The list used to render every quote's total in the COMPANY's
          // currency, so a quote written in dollars was displayed as dirhams
          // at the same number.
          currency: d.currency ?? "AED",
          fx_rate: d.fx_rate ?? undefined,
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
        const items = await sChildren<any>("quotation_items", "quotation_id", docId, [
          { col: "position", asc: true },
          { col: "id", asc: true },
        ]);
        return {
          ...(d as QuotationDoc),
          custom_columns: Array.isArray(d.custom_columns) ? d.custom_columns : [],
          unit_price_formula: d.unit_price_formula || null,
          items: items
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
      const local = isLocalMode(), scope = activeCacheOrg;
      const { items, id, ...docFields } = input;
      const row = clean(docFields as Record<string, unknown>);
      if (!id && !row.tax_country_code) {
        const company = await billing.getCompany();
        if (company.country_code) row.tax_country_code = company.country_code;
      }
      validateCountry(row.tax_country_code as string | undefined, row.template as string | undefined);
      if (row.currency !== "AED" && !row.fx_rate) {
        if (id) {
          const { data: saved, error } = await sb().from("quotations").select("currency,fx_rate").eq("id", id).single();
          if (error) throw error;
          if (saved?.currency === row.currency && Number(saved.fx_rate) > 0) row.fx_rate = saved.fx_rate;
        }
      }
      if (row.currency !== "AED" && !row.fx_rate) {
        const rates = await getExchangeRates();
        if (rates[String(row.currency)] > 0) row.fx_rate = rates[String(row.currency)];
      }
      if (local !== isLocalMode() || scope !== activeCacheOrg) throw new Error("Workspace changed. Reopen the quotation before saving.");
      const docId = await saveDocumentLines("quotations", "quotation_items", "quotation_id", row,
        items.map(it => ({
          product: it.product, sku: it.sku ?? null, product_id: it.product_id ?? null,
          qty: it.qty, rate: it.rate, discount: it.discount, tax: it.tax,
          unit: it.unit ?? null, custom: it.custom ?? null,
        })), id);
      return docId;
    }),
  deleteDoc: (docId: number) =>
    write({ k: "delete", t: "quotations", id: docId }, () =>
      sDelete("quotations", docId), undefined
    ),
  /** Bulk-select delete: one statement for the whole selection. */
  deleteDocs: (docIds: number[]) =>
    writeMany(
      docIds.map((id) => ({ k: "delete" as const, t: "quotations", id })),
      () => sDeleteMany("quotations", docIds),
      undefined
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
      if (!Number.isSafeInteger(quotationId) || quotationId <= 0) throw new Error("Choose a saved quotation.");
      const client = sb(), local = isLocalMode(), scope = activeCacheOrg;
      const company = await billing.getCompany();
      const { pickDocNumber, loadDocFormats } = await import("./numberFormat");
      const formats = await loadDocFormats();
      const convert = async (tx: { from: (table: string) => any }) => {
        if (local !== isLocalMode() || scope !== activeCacheOrg) throw new Error("Workspace changed. Reopen the quotation.");
        const { data: q, error } = await tx.from("quotations").select("*").eq("id", quotationId).single();
        if (error || !q) throw error || new Error("Quotation not found.");
        const existing = await sChildren<{ id: number }>("invoice_docs", "quotation_id", quotationId, [{ col: "id", asc: true }], tx);
        if (existing.length) return existing[0].id;
        const qd = q as QuotationDoc;
        const items = await sChildren<any>("quotation_items", "quotation_id", quotationId, [{ col: "position", asc: true }], tx);
        if (!items.length || items.length > 500) throw new Error("A quotation needs between 1 and 500 lines before conversion.");
        const numbers = await sList<{ number: string }>("invoice_docs", undefined, "number", tx);
        const due = new Date(); due.setDate(due.getDate() + 30);
        const header = {
          number: pickDocNumber("invoice", numbers.map(row => row.number), formats),
          status: "draft", doc_type: "invoice", quotation_id: quotationId,
          template: qd.template || company.default_template || "minimal",
          accent: qd.accent || company.default_accent || "#0A0A0A",
          currency: qd.currency, fx_rate: qd.fx_rate ?? null, tax_country_code: qd.tax_country_code,
          seller_name: qd.seller_name || company.name, seller_address: qd.seller_address ?? null,
          seller_trn: qd.seller_trn ?? null, seller_email: qd.seller_email ?? null,
          seller_phone: qd.seller_phone ?? null, logo: qd.logo ?? null,
          customer_id: qd.customer_id ?? null, customer_name: qd.customer_name,
          customer_address: qd.customer_address ?? null, customer_trn: qd.customer_trn ?? null,
          customer_email: qd.customer_email ?? null, issue_date: todayYmd(), due_date: localYmd(due),
          notes: qd.notes ?? null, terms: qd.terms ?? null, tax_rate: qd.tax_rate ?? 0,
          discount: qd.discount ?? 0, round_off: qd.round_off ?? false,
          custom_columns: qd.custom_columns ?? [], show_stamp: qd.show_stamp ?? false,
          show_signature: qd.show_signature ?? false,
        };
        const lines = items.map((it, position) => ({
          product_id: it.product_id ?? null,
          description: it.sku ? `${it.product} (${it.sku})` : it.product,
          qty: it.qty, unit: it.unit ?? null, ...convertedLine(it, qd.unit_price_formula), position,
        }));
        if (local !== isLocalMode() || scope !== activeCacheOrg) throw new Error("Workspace changed. Reopen the quotation.");
        await checkFreeInvoiceCap(invoicesThisMonth);
        if (!local) {
          const { data, error: conversionError } = await client.rpc("filey_convert_quotation", {
            p_id: quotationId, p_header: header, p_items: lines,
            p_updated_at: (q as { updated_at?: string }).updated_at ?? null,
          });
          if (conversionError?.code === "PGRST202") throw new Error("Cloud quotation conversion needs the CRM sales workflow database update. Ask your administrator to apply the 2026-09-12 migration, then retry.");
          if (conversionError) throw conversionError;
          if (!Number.isSafeInteger(Number(data)) || Number(data) <= 0) throw new Error("The conversion result could not be confirmed. Refresh sales documents before retrying.");
          return Number(data);
        }
        const id = await sInsert("invoice_docs", clean(header), tx);
        await sInsertMany("invoice_doc_items", lines.map(line => ({ ...line, invoice_id: id })), tx);
        await sUpdate("quotations", quotationId, { status: "accepted" }, tx);
        return id;
      };
      return local ? withLocalTransaction(convert) : convert(client);
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
  /** AED per document currency unit, frozen when saved. */
  fx_rate?: number | null;
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
  /** AED per document currency unit, frozen when saved. */
  fx_rate?: number | null;
  /** Frozen jurisdiction; changing currency never changes tax treatment. */
  tax_country_code?: string;
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
          order_date: todayYmd(),
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
          sList<PoItem & { po_id: number | string }>(
            "purchase_order_items", undefined, "po_id,description,quantity,unit_cost,custom"
          ),
        ]);
        const byId = new Map(supRows.map((s) => [s.id, s]));
        const itemsByPo = new Map<number, PoItem[]>();
        for (const it of itemRows) {
          const k = Number(it.po_id);
          const group = itemsByPo.get(k) ?? [];
          group.push(it);
          itemsByPo.set(k, group);
        }
        return rows.map((r) => ({
          id: r.id,
          po_number: r.po_number,
          supplier_id: r.supplier_id ?? undefined,
          supplier_name: r.supplier_name ?? byId.get(r.supplier_id)?.name ?? "—",
          status: r.status,
          template: r.template ?? "uae",
          currency: r.currency ?? "AED",
          fx_rate: r.fx_rate,
          total: purchaseTotals(r, itemsByPo.get(Number(r.id)) ?? []).total,
          items_count: itemsByPo.get(Number(r.id))?.length ?? 0,
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
        const items = await sChildren<any>("purchase_order_items", "po_id", poId, [
          { col: "position", asc: true },
        ]);
        const filtered = items
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
          total: purchaseTotals(d, filtered).total,
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
      const total = purchaseTotals(input, items).total;
      const row = clean({ ...fields, total } as Record<string, unknown>);
      if (row.currency !== "AED" && !row.fx_rate) {
        const rates = await getExchangeRates().catch(() => ({} as Record<string, number>));
        if (rates[String(row.currency)] > 0) row.fx_rate = rates[String(row.currency)];
      }
      if (!id && !row.tax_country_code) {
        const company = await billing.getCompany();
        if (company.country_code) row.tax_country_code = company.country_code;
      }
      validateCountry(row.tax_country_code as string | undefined, row.template as string | undefined);
      const poId = await saveDocumentLines("purchase_orders", "purchase_order_items", "po_id", row,
        items.map(it => ({
          product_id: it.product_id ?? null, description: it.description, quantity: it.quantity,
          unit_cost: it.unit_cost, unit: it.unit ?? null, custom: it.custom ?? null,
        })), id);
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
      if (String(po.status).toLowerCase() === "received" || (po as unknown as { stock_received?: boolean }).stock_received) {
        await propagatePurchase({ ...(po as unknown as Record<string, unknown>), status: "received" });
        return;
      }
      if (!isLocalMode()) {
        const rates = await getExchangeRates();
        const fx = docAmountInAed(1, po.currency, undefined, rates);
        const { error } = await sb().rpc("filey_receive_purchase_order", { p_id: poId, p_fx: fx });
        if (error) throw error;
        await propagatePurchase({ ...(po as unknown as Record<string, unknown>), status: "received" });
        return;
      }
      // Same rule as a supplier bill: stock is valued in the base currency, so
      // a PO raised in USD converts before it moves the average cost.
      const poRates = await getExchangeRates().catch(() => ({}));
      const poCurrency = (po as unknown as { currency?: string }).currency;
      const poFx = (po as unknown as { fx_rate?: number }).fx_rate;
      for (const it of po.items) {
        if (!it.product_id) continue;
        const qty = Math.abs(Number(it.quantity));
        // Moving average first — needs the pre-receipt on-hand quantity.
        await applyMovingAverageCost(
          it.product_id,
          qty,
          docAmountInAed(Number(it.unit_cost) || 0, poCurrency, poFx, poRates)
        );
        await adjustProductStock(it.product_id, qty, {
          type: "purchase",
          ref: po.po_number ? `PO ${po.po_number}` : `PO #${poId}`,
        });
      }
      await sUpdate("purchase_orders", poId, { status: "received", stock_received: true });
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
        const data = await sList<{ po_id: number | string; amount: number | string }>("po_payments", undefined, "id,po_id,amount");
        return data.map(
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
      { k: "insert", t: "po_payments", row: { po_id: poId, amount, method: method || null, paid_at: paidAt || todayYmd() } },
      () => sInsert("po_payments", { po_id: poId, amount, method: method || null, paid_at: paidAt || todayYmd() }),
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
      paid_at: input.paid_at || todayYmd(),
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
      // Matched on the tag alone, not the party. The tag already names one
      // invoice, so scoping the purge by party_id only meant that changing an
      // invoice's customer stranded the old consumption on the old customer —
      // credit permanently eaten by an invoice that is no longer theirs.
      for (const r of rows)
        if (r.party_type === "customer" && r.note === tag)
          await sDelete("advances", r.id);
      if (amount > 0)
        await sInsert("advances", {
          party_type: "customer",
          party_id: partyId,
          party_name: partyName,
          amount: -Math.abs(amount),
          note: tag,
          paid_at: todayYmd(),
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
    // `tag &&` is load-bearing. A deposit entered without a note is stored with
    // note = null, and on a NEW invoice there is no id, so the tag was null
    // too — `a.note === tag` matched every plain deposit and excluded it. The
    // editor asked how much credit was available before the invoice had been
    // saved and was told zero, however much the customer had on account.
    const tag = invoiceId ? `applied:inv#${invoiceId}` : null;
    return rows.reduce(
      (s, a) => s + (tag && a.note === tag ? 0 : Number(a.amount)),
      0
    );
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
  currency?: string;
  payment_date: string;
  payment_method?: string;
  shared?: boolean;
  updated_at: string;
}

export interface ReceiptDoc {
  tax_country_code?: string;
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
          currency: r.currency,
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
      if (!id && !row.tax_country_code) {
        const company = await billing.getCompany();
        if (company.country_code) row.tax_country_code = company.country_code;
      }
      validateCountry(row.tax_country_code as string | undefined, row.template as string | undefined);
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

/* tool_runs is an append-only log: one row every time a tool runs, forever.
 * list()/rename()/remove() had no callers anywhere — PdfTools only writes, via
 * log() and setPaths(). list() in particular read the entire table with no
 * limit, so it would have grown into the slowest query in the app while never
 * rendering anything. Deleted rather than paginated; add a bounded read back
 * when something actually displays this history. */
export const toolRuns = {
  log: (tool: string, toolName: string, fileName: string) => {
    const row = { tool, tool_name: toolName, file_name: fileName };
    return write({ k: "insert", t: "tool_runs", row }, () =>
      sInsert("tool_runs", row), -1
    );
  },
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
  /** Which channel it was posted in. Rows predating channels read "general". */
  channel: string;
  created_at: string;
}

export const messages = {
  /** Messages in one channel, or every channel when omitted. */
  list: (channel?: string) =>
    readCached<OrgMessage[]>(
      channel ? `org_messages:${channel}` : "org_messages",
      async () => {
        const [rows, profs] = await Promise.all([
          sList<any>("org_messages", [{ col: "id", asc: false }]),
          sList<any>("profiles"),
        ]);
        const byId = new Map(profs.map((p) => [p.id, p]));
        // Filter before the 200 cap, not after — otherwise a busy channel
        // pushes a quiet one off the end and it looks empty.
        const mine = channel
          ? rows.filter((r) => (r.channel ?? "general") === channel)
          : rows;
        return mine.slice(0, 200).map((r) => ({
          id: r.id,
          user_id: r.user_id,
          body: r.body,
          author: byId.get(r.user_id)?.name ?? "Team member",
          parent_id: r.parent_id ?? null,
          channel: r.channel ?? "general",
          created_at: r.created_at,
        })) as OrgMessage[];
      },
      []
    ),
  post: (body: string, parentId?: number | null, channel = "general") => {
    const row: Record<string, unknown> = { body, channel };
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
    }, false),
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
    }, false),
  acceptInvite: (id: string) =>
    online(async () => {
      const { error } = await cdb().rpc("accept_invitation", { invite: id });
      if (error) throw error;
    }),
};

/* ===== Links =====
 *
 * The bidirectional graph. Everything else in this file models one module's
 * records; this models the edges between them, so a purchase order can point
 * at the invoice it produced and that invoice shows the PO without a second
 * row being stored.
 *
 * Reads resolve each edge to a real label by querying the target table, which
 * is why renaming a customer keeps its links intact — the edge holds an id,
 * not a name like crm_activities.related_to does.
 */
export const links = {
  /** Every link touching this record, in both directions, newest first. */
  for: (type: EntityType, id: number) =>
    readCached<LinkedRecord[]>(
      `entity_links:${type}:${id}`,
      async () => {
        const [out, inc] = await Promise.all([
          sb()
            .from("entity_links")
            .select("*")
            .eq("from_type", type)
            .eq("from_id", id),
          sb()
            .from("entity_links")
            .select("*")
            .eq("to_type", type)
            .eq("to_id", id),
        ]);
        // A read that FAILED is not evidence there are no links. Swallowing the
        // error rendered "nothing linked here", and readCached would then store
        // that empty list as this record’s truth. Throw instead — readCached
        // falls back to the last good copy.
        if (out.error) throw out.error;
        if (inc.error) throw inc.error;
        const rows = [
          ...((out.data ?? []) as any[]).map((r) => ({ r, direction: "outgoing" as const })),
          ...((inc.data ?? []) as any[]).map((r) => ({ r, direction: "incoming" as const })),
        ];
        if (!rows.length) return [];

        // Resolve labels one table at a time rather than one row at a time —
        // a record with twenty links should cost a handful of queries, not
        // twenty. Unknown types are dropped instead of rendering a blank chip.
        const wanted = new Map<EntityType, Set<number>>();
        for (const { r, direction } of rows) {
          const t = (direction === "outgoing" ? r.to_type : r.from_type) as string;
          if (!isEntityType(t)) continue;
          const rid = Number(direction === "outgoing" ? r.to_id : r.from_id);
          (wanted.get(t) ?? wanted.set(t, new Set()).get(t)!).add(rid);
        }
        const labels = new Map<string, string>();
        await Promise.all(
          [...wanted].map(async ([t, ids]) => {
            const col = ENTITY_LABEL_COL[t];
            const { data } = await sb()
              .from(ENTITY_TABLE[t])
              .select(`id, ${col}`)
              .in("id", [...ids]);
            for (const row of (data ?? []) as any[])
              labels.set(`${t}:${row.id}`, String(row[col] ?? "").trim());
          })
        );

        return rows
          .map(({ r, direction }) => {
            const t = (direction === "outgoing" ? r.to_type : r.from_type) as string;
            if (!isEntityType(t)) return null;
            const rid = Number(direction === "outgoing" ? r.to_id : r.from_id);
            return {
              linkId: r.id,
              type: t,
              id: rid,
              // A deleted target still has an edge; say so rather than render
              // an empty chip the user cannot act on.
              label: labels.get(`${t}:${rid}`) || `${ENTITY_LABEL[t]} #${rid}`,
              kind: r.kind ?? "related",
              note: r.note ?? undefined,
              direction,
              created_at: r.created_at,
            } as LinkedRecord;
          })
          .filter((x): x is LinkedRecord => x !== null)
          .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
      },
      []
    ),

  add: (
    from: { type: EntityType; id: number },
    to: { type: EntityType; id: number },
    opts: { kind?: string; note?: string } = {}
  ) => {
    const row = {
      from_type: from.type,
      from_id: from.id,
      to_type: to.type,
      to_id: to.id,
      kind: opts.kind ?? "related",
      note: opts.note ?? null,
    };
    return write({ k: "insert", t: "entity_links", row }, async () => {
      // Re-linking the same pair must be a no-op, not a second edge or a
      // constraint error. Postgres has a unique index for this, but the
      // offline shim has neither that nor upsert's onConflict — so the check
      // is done here, where both modes get it.
      const { data: dupe, error: dupeError } = await sb()
        .from("entity_links")
        .select("id")
        .eq("from_type", row.from_type)
        .eq("from_id", row.from_id)
        .eq("to_type", row.to_type)
        .eq("to_id", row.to_id)
        .eq("kind", row.kind);
      // A failed check read as "no duplicate" and fell through to the insert.
      // Offline that is the only guard there is — the shim has no unique index —
      // so one failed read left a second identical edge on the graph.
      if (dupeError) throw dupeError;
      const existing = ((dupe ?? []) as { id: number }[])[0];
      if (existing) return existing.id;

      const { data, error } = await sb()
        .from("entity_links")
        .insert(row)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      return (data as { id: number } | null)?.id ?? -1;
    }, -1);
  },

  remove: (linkId: number) =>
    write({ k: "delete", t: "entity_links", id: linkId }, () =>
      sDelete("entity_links", linkId), undefined
    ),

  /** Records of one type matching a search term — what the picker offers. */
  search: async (type: EntityType, term: string, limit = 8) => {
    const col = ENTITY_LABEL_COL[type];
    let q = sb().from(ENTITY_TABLE[type]).select(`id, ${col}`).limit(limit);
    if (term.trim()) q = q.ilike(col, `%${term.trim()}%`);
    const { data, error } = await q;
    // "Nothing found" and "the search broke" look identical to someone staring
    // at an empty picker. The caller catches this and can say which it was.
    if (error) throw error;
    return ((data ?? []) as any[]).map((r) => ({
      id: Number(r.id),
      label: String(r[col] ?? "").trim() || `#${r.id}`,
    }));
  },
};

/* ===== Team comms =====
 *
 * Chat channels, a record of email actually sent, and call logs. The email and
 * call tables carry the same (entity_type, entity_id) pair the link graph uses,
 * so a customer's page can show its own correspondence without a join table
 * per module.
 */

export interface OrgChannel {
  id: number;
  name: string;
  purpose?: string | null;
  created_at: string;
}

export const channels = {
  list: () =>
    readCached<OrgChannel[]>(
      "org_channels",
      () => sList<OrgChannel>("org_channels", [{ col: "name", asc: true }]),
      []
    ),
  /** Create a channel. Names are lowercased and stripped so #Sales and
   *  #sales are the same room rather than two half-empty ones. */
  create: async (name: string, purpose?: string) => {
    const clean = name.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "");
    // Rejects rather than throwing synchronously: this reads as async, and a
    // caller's .catch() would never see a sync throw.
    if (!clean) throw new Error("Give the channel a name.");
    const row = { name: clean, purpose: purpose?.trim() || null, shared: true };
    return write({ k: "insert", t: "org_channels", row }, async () => {
      const existing = await sList<OrgChannel>("org_channels");
      const dupe = existing.find((c) => c.name === clean);
      if (dupe) return dupe.id;
      return sInsert("org_channels", row);
    }, -1);
  },
  remove: (id: number) =>
    write({ k: "delete", t: "org_channels", id }, () =>
      sDelete("org_channels", id), undefined
    ),
};

export interface EmailMessage {
  id: number;
  to_email: string;
  to_name?: string | null;
  subject: string;
  body?: string | null;
  entity_type?: string | null;
  entity_id?: number | null;
  status: string;
  error?: string | null;
  sent_at: string;
}

export const emailLog = {
  /** Everything sent, newest first. */
  list: (limit = 100) =>
    readCached<EmailMessage[]>(
      `email_messages:recent:${limit}`,
      () => sList<EmailMessage>("email_messages", [{ col: "sent_at", asc: false }], "*", null, limit),
      [], ["email_messages"]
    ),
  /** Correspondence about one record — what a customer page shows. */
  forEntity: (entityType: string, entityId: number) =>
    readCached<EmailMessage[]>(
      `email_messages:${entityType}:${entityId}`,
      async () => {
        const { data } = await sb()
          .from("email_messages")
          .select("*")
          .eq("entity_type", entityType)
          .eq("entity_id", entityId)
          .order("sent_at", { ascending: false });
        return (data ?? []) as EmailMessage[];
      },
      []
    ),
  /** Record a send. Called by the email path itself, so history accrues
   *  without every caller remembering to log. */
  record: (input: {
    to_email: string;
    to_name?: string;
    subject: string;
    body?: string;
    entity_type?: string;
    entity_id?: number;
    status?: "sent" | "failed";
    error?: string;
  }) => {
    const row = {
      to_email: input.to_email,
      to_name: input.to_name ?? null,
      subject: input.subject ?? "",
      body: input.body ?? null,
      entity_type: input.entity_type ?? null,
      entity_id: input.entity_id ?? null,
      status: input.status ?? "sent",
      error: input.error ?? null,
    };
    return write({ k: "insert", t: "email_messages", row }, () =>
      sInsert("email_messages", row), -1
    );
  },
};

export interface CallLog {
  id: number;
  direction: "outgoing" | "incoming" | "missed";
  contact_name?: string | null;
  contact_phone?: string | null;
  entity_type?: string | null;
  entity_id?: number | null;
  started_at: string;
  duration_secs: number;
  outcome?: string | null;
  notes?: string | null;
}

export const callLog = {
  list: (limit = 100) =>
    readCached<CallLog[]>(
      `call_logs:recent:${limit}`,
      () => sList<CallLog>("call_logs", [{ col: "started_at", asc: false }], "*", null, limit),
      [], ["call_logs"]
    ),
  forEntity: (entityType: string, entityId: number) =>
    readCached<CallLog[]>(
      `call_logs:${entityType}:${entityId}`,
      async () => {
        const { data } = await sb()
          .from("call_logs")
          .select("*")
          .eq("entity_type", entityType)
          .eq("entity_id", entityId)
          .order("started_at", { ascending: false });
        return (data ?? []) as CallLog[];
      },
      []
    ),
  add: (input: {
    direction?: "outgoing" | "incoming" | "missed";
    contact_name?: string;
    contact_phone?: string;
    entity_type?: string;
    entity_id?: number;
    started_at?: string;
    duration_secs?: number;
    outcome?: string;
    notes?: string;
  }) => {
    const row = {
      direction: input.direction ?? "outgoing",
      contact_name: input.contact_name ?? null,
      contact_phone: input.contact_phone ?? null,
      entity_type: input.entity_type ?? null,
      entity_id: input.entity_id ?? null,
      started_at: input.started_at ?? new Date().toISOString(),
      duration_secs: Math.max(0, Math.round(input.duration_secs ?? 0)),
      outcome: input.outcome ?? null,
      notes: input.notes ?? null,
    };
    return write({ k: "insert", t: "call_logs", row }, () =>
      sInsert("call_logs", row), -1
    );
  },
  remove: (id: number) =>
    write({ k: "delete", t: "call_logs", id }, () =>
      sDelete("call_logs", id), undefined
    ),
};


/** Project delivery and customer service share the same acknowledged, versioned record. */
export const work = {
  list: () => readCached<WorkItem[]>("work_items", () => sList<WorkItem>("work_items", [{ col: "updated_at", asc: false }]), []),
  save: async (input: WorkInput, id?: number, revision?: number): Promise<number> => {
    const row = validateWorkItem(input);
    const result = await online(async () => {
      for (const [table, linkedId] of [["crm_customers", row.customer_id], ["invoice_docs", row.invoice_id]] as const) {
        if (linkedId === null) continue;
        const { data, error } = await sb().from(table).select("id").eq("id", linkedId).single();
        if (error || !data) throw new Error("A linked customer or invoice is unavailable. Reload and select it again.");
      }
      const updated_at = new Date().toISOString();
      if (id === undefined) return sInsert("work_items", { ...row, revision: 1, updated_at });
      if (!Number.isSafeInteger(revision) || revision! < 1) throw new Error("Reload this record before saving.");
      const { data, error } = await sb().from("work_items").update({ ...row, revision: revision! + 1, updated_at }).eq("id", id).eq("revision", revision).eq("kind", row.kind).select("id").single();
      if (error || !data) throw new Error("This record changed or access was removed. Close and reopen it before applying your edits.");
      return Number(data.id);
    });
    markWrite(); notifyDataChanged();
    return result;
  },
};
