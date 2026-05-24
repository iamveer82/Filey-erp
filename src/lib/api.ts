import { invoke } from "@tauri-apps/api/core";
import { sb, isConfigured } from "./supabase";
import { quotationTotals } from "./money";

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
  address?: string;
  trn?: string;
  segment?: string;
  shared?: boolean;
  created_at: string;
}
export interface Opportunity {
  id: number;
  title: string;
  customer_name: string;
  stage: string;
  value: number;
  probability: number;
  owner?: string;
  expected_close?: string;
  created_at: string;
}
export interface Activity {
  id: number;
  kind: string;
  subject: string;
  related_to?: string;
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
  description: string;
  qty: number;
  unit_price: number;
  product_id?: number;
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
  template: string;
  accent: string;
  currency: string;
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
  tax_rate: number;
  discount: number;
  quotation_id?: number;
  created_at: string;
  updated_at: string;
  items: InvoiceItem[];
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
    flushOutbox().catch(() => {});
  });
}

/** Read-through cache. Online → fetch + mirror; else → cached snapshot. */
async function readCached<T>(
  key: string,
  run: () => Promise<T>,
  empty: T
): Promise<T> {
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
  select = "*"
): Promise<T[]> {
  let q: any = sb().from(table).select(select);
  for (const o of order ?? []) q = q.order(o.col, { ascending: o.asc });
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as T[];
}
async function sInsert(
  table: string,
  row: Record<string, unknown>
): Promise<number> {
  const { data, error } = await sb()
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
  patch: Record<string, unknown>
): Promise<void> {
  const { error } = await sb().from(table).update(patch).eq("id", id);
  if (error) throw error;
}
async function sDelete(table: string, id: number): Promise<void> {
  const { error } = await sb().from(table).delete().eq("id", id);
  if (error) throw error;
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

// ===== ERP Core =====
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
  updateStock: (productId: number, delta: number) =>
    online(async () => {
      const { data, error } = await sb()
        .from("products")
        .select("quantity")
        .eq("id", productId)
        .single();
      if (error) throw error;
      await sUpdate("products", productId, {
        quantity: ((data as { quantity: number }).quantity ?? 0) + delta,
      });
    }),
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
          const { data, error } = await sb()
            .from("products")
            .select("quantity")
            .eq("id", l.product_id)
            .single();
          if (error) throw error;
          await sUpdate("products", l.product_id, {
            quantity: Math.max(
              0,
              ((data as { quantity: number }).quantity ?? 0) - l.quantity
            ),
          });
        }
      }
      return orderId;
    }),
  setOrderStatus: (orderId: number, status: string) =>
    write({ k: "update", t: "orders", id: orderId, row: { status } }, () =>
      sUpdate("orders", orderId, { status }), undefined
    ),
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
        })) as Payroll[];
      },
      []
    ),
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
    if (accountId == null) {
      return write({ k: "insert", t: "payroll", row }, () =>
        sInsert("payroll", row), -1
      );
    }
    return online(async () => {
      const id = await sInsert("payroll", row);
      await sInsert("transactions", {
        account_id: accountId,
        txn_type: "debit",
        amount: net,
        description: `Payroll ${period}`,
        txn_date: new Date().toISOString().slice(0, 10),
      });
      const { data, error } = await sb()
        .from("accounts")
        .select("balance")
        .eq("id", accountId)
        .single();
      if (error) throw error;
      await sUpdate("accounts", accountId, {
        balance:
          Number((data as { balance: number }).balance ?? 0) - net,
      });
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
    if (accountId == null) {
      return write({ k: "insert", t: "expenses", row }, () =>
        sInsert("expenses", row), -1
      );
    }
    return online(async () => {
      const id = await sInsert("expenses", row);
      await sInsert("transactions", {
        account_id: accountId,
        txn_type: "debit",
        amount,
        description: description ?? category,
        txn_date: expenseDate,
      });
      const { data, error } = await sb()
        .from("accounts")
        .select("balance")
        .eq("id", accountId)
        .single();
      if (error) throw error;
      await sUpdate("accounts", accountId, {
        balance:
          Number((data as { balance: number }).balance ?? 0) - amount,
      });
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
        return rows.map((r) => ({
          id: r.id,
          account_id: r.account_id,
          account_name: r.accounts?.name ?? "—",
          txn_type: r.txn_type,
          amount: r.amount,
          description: r.description ?? undefined,
          txn_date: r.txn_date,
        })) as Txn[];
      },
      []
    ),
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
    return write({ k: "insert", t: "transactions", row }, () =>
      sInsert("transactions", row), -1
    );
  },
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
      if (data) await sUpdate("app_settings", (data as any).id, { value });
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
};

// ===== Follow-ups / reminders =====
export interface FollowUp {
  id: number;
  customer_id?: number | null;
  customer_name?: string;
  title: string;
  due_date: string; // YYYY-MM-DD
  done: boolean;
  created_at: string;
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
  }) => {
    const row = clean(input as Record<string, unknown>);
    return write({ k: "insert", t: "follow_ups", row }, () =>
      sInsert("follow_ups", row), -1
    );
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
  d: { tax_rate: number; discount: number },
  items: { qty: number; unit_price: number }[]
) {
  const subtotal = items.reduce((s, i) => s + i.qty * i.unit_price, 0);
  return (subtotal - d.discount) * (1 + d.tax_rate / 100);
}

export const billing = {
  listDocs: () =>
    readCached<InvoiceDocSummary[]>(
      "billing_docs",
      async () => {
        const [docs, items, payments] = await Promise.all([
          sList<any>("invoice_docs", [{ col: "updated_at", asc: false }]),
          sList<any>("invoice_doc_items"),
          sList<any>("invoice_payments"),
        ]);
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
          ...(d as any),
          items: items
            .filter((i) => i.invoice_id === docId)
            .map((i) => ({
              id: i.id,
              description: i.description,
              qty: i.qty,
              unit_price: i.unit_price,
            })),
        } as InvoiceDoc;
      },
      null as unknown as InvoiceDoc
    ),
  saveDoc: (input: InvoiceDocInput) =>
    online(async () => {
      const { items, id, ...docFields } = input;
      const row = clean(docFields as Record<string, unknown>);
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
              position: i,
            }))
          );
        if (error) throw error;
      }
      return docId;
    }),
  deleteDoc: (docId: number) =>
    write({ k: "delete", t: "invoice_docs", id: docId }, () =>
      sDelete("invoice_docs", docId), undefined
    ),
  setStatus: (docId: number, status: string) =>
    write(
      { k: "update", t: "invoice_docs", id: docId, row: { status } },
      () => sUpdate("invoice_docs", docId, { status }),
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
      await sInsert("invoice_payments", {
        invoice_id: invoiceId,
        amount,
        method: method ?? null,
        paid_at: paidAt,
      });
      // Auto-mark the invoice paid once the balance is cleared.
      const [{ data: doc }, items, { data: pays }] = await Promise.all([
        sb().from("invoice_docs").select("*").eq("id", invoiceId).single(),
        sList<any>("invoice_doc_items"),
        sb()
          .from("invoice_payments")
          .select("amount")
          .eq("invoice_id", invoiceId),
      ]);
      const total = docTotal(
        doc as any,
        (items as any[]).filter((i) => i.invoice_id === invoiceId)
      );
      const paid = ((pays as any[]) ?? []).reduce(
        (s, p) => s + Number(p.amount),
        0
      );
      const status =
        paid >= total - 0.005 ? "paid" : (doc as any).status === "paid" ? "sent" : (doc as any).status;
      if (status !== (doc as any).status)
        await sUpdate("invoice_docs", invoiceId, { status });
    }),
  removePayment: (id: number) =>
    online(() => sDelete("invoice_payments", id)),
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
          const c = data as any;
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
    if (!onLine())
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
        .eq("id", (data as any).id)
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
}
export interface QuotationSummary {
  id: number;
  number: string;
  customer_name: string;
  status: string;
  template: string;
  total: number;
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
  created_at: string;
  updated_at: string;
  items: QuotationItem[];
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

const quoteTotal = (items: QuotationItem[]) =>
  quotationTotals(items).total;

export const quotes = {
  listDocs: () =>
    readCached<QuotationSummary[]>(
      "quotation_docs",
      async () => {
        const [docs, items] = await Promise.all([
          sList<any>("quotations", [{ col: "updated_at", asc: false }]),
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
          total: quoteTotal(byDoc.get(d.id) ?? []),
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
          ...(d as any),
          items: items
            .filter((i) => i.quotation_id === docId)
            .map((i) => ({
              id: i.id,
              product: i.product,
              sku: i.sku ?? undefined,
              qty: i.qty,
              rate: i.rate,
              discount: i.discount,
              tax: i.tax,
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
              qty: it.qty,
              rate: it.rate,
              discount: it.discount,
              tax: it.tax,
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
  convertToInvoice: (quotationId: number) =>
    online(async () => {
      const { data: q, error } = await sb()
        .from("quotations")
        .select("*")
        .eq("id", quotationId)
        .single();
      if (error) throw error;
      const qd = q as any;
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
}
export interface PoSummary {
  id: number;
  po_number: string;
  supplier_id?: number;
  supplier_name: string;
  status: string;
  total: number;
  order_date: string;
  expected_date?: string;
  updated_at: string;
}
export interface PurchaseOrder {
  id: number;
  po_number: string;
  supplier_id?: number;
  status: string;
  total: number;
  order_date: string;
  expected_date?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
  items: PoItem[];
}
export type PoInput = Omit<
  PurchaseOrder,
  "id" | "created_at" | "updated_at"
> & { id?: number };

export const pos = {
  list: () =>
    readCached<PoSummary[]>(
      "purchase_orders",
      async () => {
        const [rows, supRows] = await Promise.all([
          sList<any>("purchase_orders", [{ col: "updated_at", asc: false }]),
          sList<Supplier>("suppliers"),
        ]);
        const byId = new Map(supRows.map((s) => [s.id, s]));
        return rows.map((r) => ({
          id: r.id,
          po_number: r.po_number,
          supplier_id: r.supplier_id ?? undefined,
          supplier_name: byId.get(r.supplier_id)?.name ?? "—",
          status: r.status,
          total: Number(r.total),
          order_date: r.order_date,
          expected_date: r.expected_date ?? undefined,
          updated_at: r.updated_at,
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
          }));
        const d = data as any;
        return {
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
      const total = items.reduce(
        (s, it) => s + it.quantity * it.unit_cost,
        0
      );
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
              position: i,
            }))
          );
        if (error) throw error;
      }
      return poId;
    }),
  setStatus: (poId: number, status: string) =>
    write(
      { k: "update", t: "purchase_orders", id: poId, row: { status } },
      () => sUpdate("purchase_orders", poId, { status }),
      undefined
    ),
  /** Receive items into stock: increments products.quantity by each line. */
  receive: (poId: number) =>
    online(async () => {
      const po = await pos.get(poId);
      for (const it of po.items) {
        if (!it.product_id) continue;
        const { data, error } = await sb()
          .from("products")
          .select("quantity")
          .eq("id", it.product_id)
          .single();
        if (error) throw error;
        await sUpdate("products", it.product_id, {
          quantity:
            Number((data as { quantity: number }).quantity ?? 0) +
            it.quantity,
        });
      }
      await sUpdate("purchase_orders", poId, { status: "received" });
    }),
  remove: (poId: number) =>
    write({ k: "delete", t: "purchase_orders", id: poId }, () =>
      sDelete("purchase_orders", poId), undefined
    ),
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
        const rows = await sList<Organization>("organizations");
        return rows[0] ?? null;
      },
      null
    ),
  members: () =>
    readCached<OrgMember[]>(
      "org_members",
      async () => {
        const [mems, profs] = await Promise.all([
          sList<any>("org_members", [{ col: "id", asc: true }]),
          sList<any>("profiles"),
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
      const id = await sInsert("organizations", { name });
      await sInsert("org_members", {
        org_id: String(id),
        role: "owner",
      });
      return String(id);
    }),
  setRole: (memberId: number, role: string) =>
    write(
      { k: "update", t: "org_members", id: memberId, row: { role } },
      () => sUpdate("org_members", memberId, { role }),
      undefined
    ),
  setMemberModules: (memberId: number, modules: string[] | null) =>
    write(
      { k: "update", t: "org_members", id: memberId, row: { modules } },
      () => sUpdate("org_members", memberId, { modules }),
      undefined
    ),
  remove: (memberId: number) =>
    write({ k: "delete", t: "org_members", id: memberId }, () =>
      sDelete("org_members", memberId), undefined
    ),
  // ----- invitations -----
  invites: () =>
    readCached<Invitation[]>(
      "invitations",
      () => sList<Invitation>("invitations", [{ col: "created_at", asc: false }]),
      []
    ),
  invite: (email: string, role: string, modules: string[] | null) =>
    online(() =>
      sInsert("invitations", {
        email: email.trim().toLowerCase(),
        role,
        modules,
      }).then(() => undefined)
    ),
  revokeInvite: (id: string) =>
    online(async () => {
      const { error } = await sb().from("invitations").delete().eq("id", id);
      if (error) throw error;
    }),
  /** Pending invitations addressed to the signed-in user's email. */
  myInvites: () =>
    online(async () => {
      const { data, error } = await sb()
        .from("invitations")
        .select("*")
        .eq("status", "pending");
      if (error) throw error;
      return (data ?? []) as Invitation[];
    }),
  acceptInvite: (id: string) =>
    online(async () => {
      const { error } = await sb().rpc("accept_invitation", { invite: id });
      if (error) throw error;
    }),
};
