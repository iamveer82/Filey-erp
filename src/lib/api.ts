import { invoke } from "@tauri-apps/api/core";
import { sb, isConfigured } from "./supabase";

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
  created_at: string;
}
export interface Order {
  id: number;
  order_number: string;
  customer_name: string;
  status: string;
  total: number;
  created_at: string;
}
export interface Invoice {
  id: number;
  invoice_number: string;
  customer_name: string;
  amount: number;
  status: string;
  due_date?: string;
  created_at: string;
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
  segment?: string;
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
}
export interface InvoiceDocSummary {
  id: number;
  number: string;
  customer_name: string;
  status: string;
  template: string;
  total: number;
  issue_date?: string;
  updated_at: string;
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
  address?: string;
  trn?: string;
  email?: string;
  phone?: string;
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
  if (!isConfigured) return (await cacheGet<T>(key)) ?? empty;
  if (onLine()) {
    try {
      await flushOutbox();
      const data = await run();
      await cacheSet(key, data);
      return data;
    } catch {
      return (await cacheGet<T>(key)) ?? empty;
    }
  }
  return (await cacheGet<T>(key)) ?? empty;
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
  setOrderStatus: (orderId: number, status: string) =>
    write({ k: "update", t: "orders", id: orderId, row: { status } }, () =>
      sUpdate("orders", orderId, { status }), undefined
    ),
  invoices: () =>
    readCached<Invoice[]>(
      "erp_invoices",
      () => sList<Invoice>("invoices", [{ col: "id", asc: false }]),
      []
    ),
  createInvoice: (
    invoiceNumber: string,
    customerName: string,
    amount: number,
    dueDate?: string
  ) => {
    const row = {
      invoice_number: invoiceNumber,
      customer_name: customerName,
      amount,
      status: "unpaid",
      due_date: dueDate ?? null,
    };
    return write({ k: "insert", t: "invoices", row }, () =>
      sInsert("invoices", row), -1
    );
  },
  markInvoicePaid: (invoiceId: number) =>
    write(
      { k: "update", t: "invoices", id: invoiceId, row: { status: "paid" } },
      () => sUpdate("invoices", invoiceId, { status: "paid" }),
      undefined
    ),
  summary: () =>
    readCached<ErpSummary>(
      "erp_summary",
      async () => {
        const [products, orders, invoices] = await Promise.all([
          sList<Product>("products"),
          sList<Order>("orders"),
          sList<Invoice>("invoices"),
        ]);
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
          unpaid_invoices: invoices
            .filter((i) => i.status === "unpaid")
            .reduce((s, i) => s + i.amount, 0),
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
    deductions: number
  ) => {
    const row = {
      employee_id: employeeId,
      period,
      basic,
      allowances,
      deductions,
      net_pay: basic + allowances - deductions,
      status: "pending",
    };
    return write({ k: "insert", t: "payroll", row }, () =>
      sInsert("payroll", row), -1
    );
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
    return write({ k: "insert", t: "expenses", row }, () =>
      sInsert("expenses", row), -1
    );
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
        const [docs, items] = await Promise.all([
          sList<any>("invoice_docs", [{ col: "updated_at", asc: false }]),
          sList<any>("invoice_doc_items"),
        ]);
        const byDoc = new Map<number, any[]>();
        for (const it of items) {
          const a = byDoc.get(it.invoice_id) ?? [];
          a.push(it);
          byDoc.set(it.invoice_id, a);
        }
        return docs.map((d) => ({
          id: d.id,
          number: d.number,
          customer_name: d.customer_name,
          status: d.status,
          template: d.template,
          total: docTotal(d, byDoc.get(d.id) ?? []),
          issue_date: d.issue_date ?? undefined,
          updated_at: d.updated_at,
        })) as InvoiceDocSummary[];
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
  getCompany: () =>
    readCached<CompanyProfile>(
      "company_profile",
      async () => {
        const { data } = await sb()
          .from("company_profile")
          .select("*")
          .maybeSingle();
        if (data) {
          const c = data as any;
          return {
            name: c.name,
            address: c.address ?? undefined,
            trn: c.trn ?? undefined,
            email: c.email ?? undefined,
            phone: c.phone ?? undefined,
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
          default_accent: "#222222",
          default_template: "minimal",
        };
      },
      {
        name: "My Company",
        default_accent: "#222222",
        default_template: "minimal",
      }
    ),
  saveCompany: (input: CompanyProfile) =>
    online(async () => {
      const { data } = await sb()
        .from("company_profile")
        .select("id")
        .maybeSingle();
      const row = clean(input as unknown as Record<string, unknown>);
      if (data) await sUpdate("company_profile", (data as any).id, row);
      else await sInsert("company_profile", row);
    }),
};

// ===== Quoting =====
export interface QuotationItem {
  id?: number;
  product: string;
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
  created_at: string;
}

function quoteTotal(items: QuotationItem[]) {
  let subtotal = 0;
  let discount = 0;
  let tax = 0;
  for (const i of items) {
    const gross = i.qty * i.rate;
    const disc = gross * ((i.discount || 0) / 100);
    subtotal += gross;
    discount += disc;
    tax += (gross - disc) * ((i.tax || 0) / 100);
  }
  return subtotal - discount + tax;
}

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
};
