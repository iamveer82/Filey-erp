import { reportMoney } from "../../lib/reportMoney";
import { getExchangeRates } from "../../lib/exchange-rates";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoicePaymentsInAed, overviewDeltas, overviewTrend } from "../overviewData";
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
  InvoicePayment,
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
  isPostedStatus,
} from "../../lib/api";
import { useLiveSync } from "../../lib/realtime";

export interface ReportsData {
  products: Product[];
  orders: Order[];
  accounts: Account[];
  txns: Txn[];
  expenses: Expense[];
  invoices: InvoiceDocSummary[];
  /** Dated customer invoice payments in AED, separate from receipt documents. */
  invoicePayments: InvoicePayment[];
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
  const [invoicePayments, setInvoicePayments] = useState<InvoicePayment[]>([]);
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [receiptList, setReceiptList] = useState<ReceiptSummary[]>([]);
  const [supplierList, setSupplierList] = useState<Supplier[]>([]);
  const [poList, setPoList] = useState<PoSummary[]>([]);
  const [poPayments, setPoPayments] = useState<{ po_id: number; amount: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const request = useRef(0);

  const load = useCallback(async () => {
    const version = ++request.current;
    setError("");
    setLoading(true);
    try {
      const [p, o, a, t, e, i, c, r, su, po, pay, invoicePay, rates] = await Promise.all([
        erp.products(),
        erp.orders(),
        fin.accounts(),
        fin.transactions(),
        fin.expenses(),
        billing.listDocs(),
        crm.customers(),
        receipts.list(),
        suppliers.list(),
        pos.list(),
        pos.allPayments(),
        billing.allPayments(),
        getExchangeRates(),
      ]);
      const invoices = i.map((row) =>
        reportMoney(row, ["total", "paid", "balance"], rates)
      );
      const receiptRows = r.filter(row => row.status === "paid").map((row) => reportMoney(row, ["amount"], rates));
      const invoicePaymentRows = invoicePaymentsInAed(invoicePay, i, rates);
      const purchaseRows = po.map((row) => reportMoney(row, ["total"], rates));
      const payments = pay.map((row) => {
        const parent = po.find((doc) => doc.id === row.po_id);
        return {
          ...row,
          amount: reportMoney(
            { amount: row.amount, currency: parent?.currency, fx_rate: parent?.fx_rate },
            ["amount"],
            rates
          ).amount,
        };
      });
      // Commit one coherent snapshot, rather than mixing successful and failed reads.
      if (version !== request.current) return;
      setProducts(p);
      setOrders(o);
      setAccounts(a);
      setTxns(t);
      setExpenses(e);
      setInvoices(invoices);
      setInvoicePayments(invoicePaymentRows);
      setCustomers(c);
      setReceiptList(receiptRows);
      setSupplierList(su);
      setPoList(purchaseRows);
      setPoPayments(payments);
    } catch (error) {
      if (version !== request.current) return;
      setError(
        `Could not load reports: ${error instanceof Error ? error.message : (error as { message?: string })?.message || String(error)}`
      );
    } finally {
      if (version === request.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => { request.current++; };
  }, [load]);
  useLiveSync(load);

  return {
    products,
    orders,
    accounts,
    txns,
    expenses,
    invoices,
    invoicePayments,
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
        .filter((i) => isPostedStatus(i.status))
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
  return useMemo(() => overviewDeltas(invoices, receiptList, customers, orders), [invoices, receiptList, customers, orders]);
}

/** Same seven-day invoice/payment/receipt series as the Overview. */
export function useTrend(invoices: InvoiceDocSummary[], receiptList: ReceiptSummary[], invoicePayments: InvoicePayment[] = []) {
  return useMemo(() => overviewTrend(invoices, receiptList, [], 7, new Date(), invoicePayments), [invoices, receiptList, invoicePayments]);
}

/** Inventory value by category uses acquisition cost. */
export function useCategoryBars(products: Product[]) {
  return useMemo(() => {
    const g = new Map<string, number>();
    for (const p of products) {
      const key = p.category || "Other";
      g.set(
        key,
        (g.get(key) ?? 0) + (Number(p.cost_price) || 0) * (Number(p.quantity) || 0)
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
    return {
      trialBalance,
      balanceSheet,
      vatReturn,
      cashSummary,
      revenue,
      expensesTotal,
      netProfit,
    };
  }, [accounts, txns, invoices]);
}

/** Top customers by invoice revenue. */
export function useTopCustomers(invoices: InvoiceDocSummary[], customers: CrmCustomer[]) {
  return useMemo(() => {
    const g = new Map<string, { name: string; total: number; count: number }>();
    for (const i of invoices) {
      if (!isPostedStatus(i.status)) continue;
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
      if (i.status === "paid" || i.status === "draft" || i.status === "cancelled")
        continue;
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
      if (p.status === "paid" || p.status === "cancelled" || p.status === "draft")
        continue;
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
