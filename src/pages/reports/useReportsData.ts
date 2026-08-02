import { useEffect, useMemo, useState } from "react";
import { localYmd } from "../../lib/format";
import {
  erp,
  fin,
  crm,
  billing,
  receipts,
  suppliers,
  pos,
  Product,
  Order,
  Account,
  Txn,
  Expense,
  InvoiceDocSummary,
  CrmCustomer,
  ReceiptSummary,
  Supplier,
  PoSummary,
  computeVatReturn,
  computeTrialBalance,
  computeBalanceSheet,
  computeCashSummary,
  TrialBalance,
  BalanceSheet,
  VatReturn,
  CashSummary,
} from "../../lib/api";
import { useLiveSync } from "../../lib/realtime";

export interface ReportsData {
  products: Product[];
  orders: Order[];
  accounts: Account[];
  txns: Txn[];
  expenses: Expense[];
  invoices: InvoiceDocSummary[];
  customers: CrmCustomer[];
  receiptList: ReceiptSummary[];
  supplierList: Supplier[];
  poList: PoSummary[];
  /** Payments recorded against POs. Payables are PO total MINUS these — a PO
   *  keeps its full total until it is marked paid, so without them every
   *  payables figure here counts money that has already gone out. */
  poPayments: { po_id: number; amount: number }[];
  loading: boolean;
  error: string;
  reload: () => void;
}

export function useReportsData(): ReportsData {
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [invoices, setInvoices] = useState<InvoiceDocSummary[]>([]);
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [receiptList, setReceiptList] = useState<ReceiptSummary[]>([]);
  const [supplierList, setSupplierList] = useState<Supplier[]>([]);
  const [poList, setPoList] = useState<PoSummary[]>([]);
  const [poPayments, setPoPayments] = useState<{ po_id: number; amount: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setError("");
    return Promise.all([
      erp.products().then(setProducts),
      erp.orders().then(setOrders),
      fin.accounts().then(setAccounts),
      fin.transactions().then(setTxns),
      fin.expenses().then(setExpenses),
      billing.listDocs().then(setInvoices),
      crm.customers().then(setCustomers),
      receipts.list().then(setReceiptList),
      suppliers.list().then(setSupplierList),
      pos.list().then(setPoList),
      pos.allPayments().then(setPoPayments),
    ])
      .catch((e) =>
        setError(`Could not load reports: ${e instanceof Error ? e.message : e}`)
      )
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);
  useLiveSync(load);

  return {
    products,
    orders,
    accounts,
    txns,
    expenses,
    invoices,
    customers,
    receiptList,
    supplierList,
    poList,
    poPayments,
    loading,
    error,
    reload: load,
  };
}

/* ── Derived metrics (shared across tabs) ──────────────────────────────── */

export function useRevenueTotal(invoices: InvoiceDocSummary[]): number {
  return useMemo(
    () =>
      invoices
        .filter((i) => i.status !== "draft")
        .reduce((s, i) => s + (i.total || 0), 0),
    [invoices]
  );
}

export function useCashReceived(receiptList: ReceiptSummary[]): number {
  return useMemo(
    () => receiptList.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    [receiptList]
  );
}

export function useDeltas(
  invoices: InvoiceDocSummary[],
  receiptList: ReceiptSummary[],
  customers: CrmCustomer[],
  orders: Order[]
) {
  return useMemo(() => {
    const DAY = 86400000;
    const now = Date.now();
    const curStart = now - 30 * DAY;
    const prevStart = now - 60 * DAY;
    const pct = (cur: number, prev: number): number | null =>
      prev > 0 ? ((cur - prev) / prev) * 100 : null;

    let revCur = 0;
    let revPrev = 0;
    for (const i of invoices) {
      if (i.status === "draft" || !i.issue_date) continue;
      const t = +new Date(i.issue_date);
      if (t >= curStart) revCur += i.total || 0;
      else if (t >= prevStart) revPrev += i.total || 0;
    }

    let cashCur = 0;
    let cashPrev = 0;
    for (const r of receiptList) {
      if (!r.payment_date) continue;
      const t = +new Date(r.payment_date);
      const amt = Number(r.amount) || 0;
      if (t >= curStart) cashCur += amt;
      else if (t >= prevStart) cashPrev += amt;
    }

    let custCur = 0;
    let custPrev = 0;
    for (const cu of customers) {
      if (!cu.created_at) continue;
      const t = +new Date(cu.created_at);
      if (t >= curStart) custCur += 1;
      else if (t >= prevStart) custPrev += 1;
    }

    let ordCur = 0;
    let ordPrev = 0;
    for (const o of orders) {
      if (!o.created_at) continue;
      const t = +new Date(o.created_at);
      if (t >= curStart) ordCur += 1;
      else if (t >= prevStart) ordPrev += 1;
    }

    return {
      revenue: pct(revCur, revPrev),
      cash: pct(cashCur, cashPrev),
      customers: pct(custCur, custPrev),
      orders: pct(ordCur, ordPrev),
    };
  }, [invoices, receiptList, customers, orders]);
}

/** Last 8 days invoiced vs received — real data only, no filler. */
export function useTrend(
  invoices: InvoiceDocSummary[],
  receiptList: ReceiptSummary[]
) {
  return useMemo(() => {
    const byDay = new Map<string, { invoiced: number; received: number }>();
    for (const i of invoices) {
      if (i.status === "draft" || !i.issue_date) continue;
      const key = i.issue_date.slice(0, 10);
      const row = byDay.get(key) || { invoiced: 0, received: 0 };
      row.invoiced += i.total || 0;
      byDay.set(key, row);
    }
    for (const r of receiptList) {
      if (!r.payment_date) continue;
      const key = r.payment_date.slice(0, 10);
      const row = byDay.get(key) || { invoiced: 0, received: 0 };
      row.received += Number(r.amount) || 0;
      byDay.set(key, row);
    }
    const series: { d: string; invoiced: number; received: number }[] = [];
    const now = new Date();
    for (let i = 7; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      // Local key: byDay is built from issue_date/payment_date calendar days.
      const key = localYmd(d);
      const label = d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      const row = byDay.get(key);
      series.push({
        d: label,
        invoiced: row?.invoiced || 0,
        received: row?.received || 0,
      });
    }
    return series;
  }, [invoices, receiptList]);
}

/** Inventory value by category: stock × unit price. */
export function useCategoryBars(products: Product[]) {
  return useMemo(() => {
    const g = new Map<string, number>();
    for (const p of products) {
      const key = p.category || "Other";
      g.set(
        key,
        (g.get(key) ?? 0) +
          (Number(p.unit_price) || 0) * (Number(p.quantity) || 0)
      );
    }
    return Array.from(g.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [products]);
}

/** Invoice status distribution with status-colored slices. */
export function useStatusPie(
  invoices: InvoiceDocSummary[],
  accent: string,
  primary: string,
  tertiary: string
) {
  return useMemo(() => {
    const s = new Map<string, number>();
    for (const i of invoices) {
      const key = i.status || "draft";
      s.set(key, (s.get(key) ?? 0) + 1);
    }
    const colorFor = (status: string): string => {
      switch (status) {
        case "paid":
          return accent;
        case "overdue":
          return "#10b981";
        case "draft":
          return tertiary;
        case "cancelled":
          return "#f43f5e";
        default:
          return primary;
      }
    };
    return Array.from(s.entries()).map(([name, value]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      value,
      color: colorFor(name),
    }));
  }, [invoices, accent, primary, tertiary]);
}

/** Derived financial computations. */
export function useFinancials(
  accounts: Account[],
  txns: Txn[],
  invoices: InvoiceDocSummary[] = []
) {
  return useMemo(() => {
    const trialBalance: TrialBalance = computeTrialBalance(accounts);
    const balanceSheet: BalanceSheet = computeBalanceSheet(accounts);
    // Invoices carry the zero-rated/exempt boxes; those supplies post no VAT,
    // so the ledger alone reports them as nothing at all.
    const vatReturn: VatReturn = computeVatReturn(
      txns,
      5,
      undefined,
      undefined,
      invoices
    );
    const cashSummary: CashSummary = computeCashSummary(txns);
    const revenue = accounts
      .filter((a) => a.account_type === "revenue")
      .reduce((s, a) => s + (Number(a.balance) || 0), 0);
    const expensesTotal = accounts
      .filter((a) => a.account_type === "expense")
      .reduce((s, a) => s + (Number(a.balance) || 0), 0);
    const netProfit = revenue - expensesTotal;
    return { trialBalance, balanceSheet, vatReturn, cashSummary, revenue, expensesTotal, netProfit };
  }, [accounts, txns, invoices]);
}

/** Top customers by invoice revenue. */
export function useTopCustomers(
  invoices: InvoiceDocSummary[],
  customers: CrmCustomer[]
) {
  return useMemo(() => {
    const g = new Map<string, { name: string; total: number; count: number }>();
    for (const i of invoices) {
      if (i.status === "draft") continue;
      const name = i.customer_name || "—";
      const row = g.get(name) || { name, total: 0, count: 0 };
      row.total += i.total || 0;
      row.count += 1;
      g.set(name, row);
    }
    return Array.from(g.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [invoices, customers]);
}

/** Receivables aging — outstanding invoices grouped by age bucket. */
export function useReceivablesAging(invoices: InvoiceDocSummary[]) {
  return useMemo(() => {
    const now = Date.now();
    const DAY = 86400000;
    const buckets = { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0 };
    for (const i of invoices) {
      if (i.status === "paid" || i.status === "draft" || i.status === "cancelled") continue;
      const balance = i.balance ?? i.total ?? 0;
      if (balance <= 0) continue;
      const due = i.due_date ? +new Date(i.due_date) : 0;
      if (!due) {
        buckets.current += balance;
        continue;
      }
      const age = Math.floor((now - due) / DAY);
      if (age <= 0) buckets.current += balance;
      else if (age <= 30) buckets.d30 += balance;
      else if (age <= 60) buckets.d60 += balance;
      else if (age <= 90) buckets.d90 += balance;
      else buckets.d90p += balance;
    }
    return buckets;
  }, [invoices]);
}

/** Top suppliers by PO total. */
export function useTopSuppliers(poList: PoSummary[], supplierList: Supplier[]) {
  return useMemo(() => {
    const g = new Map<string, { name: string; total: number; count: number }>();
    for (const p of poList) {
      const name = p.supplier_name || "—";
      const row = g.get(name) || { name, total: 0, count: 0 };
      row.total += p.total || 0;
      row.count += 1;
      g.set(name, row);
    }
    return Array.from(g.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [poList, supplierList]);
}

/** Sum of payments recorded against each PO. */
export function paidByPo(
  poPayments: { po_id: number; amount: number }[]
): Map<number, number> {
  const m = new Map<number, number>();
  for (const p of poPayments)
    m.set(p.po_id, (m.get(p.po_id) ?? 0) + (Number(p.amount) || 0));
  return m;
}

/** Payables aging — open POs grouped by age bucket, net of payments made.
 *  A partly paid PO keeps its full total and its non-paid status, so counting
 *  p.total here billed the whole order as still owed. The Suppliers page and
 *  supplier detail have always netted payments off; this now agrees with them. */
export function usePayablesAging(
  poList: PoSummary[],
  poPayments: { po_id: number; amount: number }[] = []
) {
  return useMemo(() => {
    const now = Date.now();
    const DAY = 86400000;
    const paid = paidByPo(poPayments);
    const buckets = { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0 };
    for (const p of poList) {
      if (p.status === "paid" || p.status === "cancelled" || p.status === "draft") continue;
      const open = (p.total || 0) - (paid.get(p.id) ?? 0);
      if (open <= 0) continue;
      const due = p.expected_date ? +new Date(p.expected_date) : 0;
      if (!due) {
        buckets.current += open;
        continue;
      }
      const age = Math.floor((now - due) / DAY);
      if (age <= 0) buckets.current += open;
      else if (age <= 30) buckets.d30 += open;
      else if (age <= 60) buckets.d60 += open;
      else if (age <= 90) buckets.d90 += open;
      else buckets.d90p += open;
    }
    return buckets;
  }, [poList, poPayments]);
}