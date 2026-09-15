import { todayYmd } from "../../lib/format";
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
  purchaseInvoices: InvoiceDocSummary[];
  /** Dated customer invoice payments in AED, separate from receipt documents. */
  invoicePayments: InvoicePayment[];
  customers: CrmCustomer[];
  receiptList: ReceiptSummary[];
  supplierList: Supplier[];
  poList: PoSummary[];
  /** PO payments belong to commitments/accruals, separate from supplier bills. */
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
  const [purchaseInvoices, setPurchaseInvoices] = useState<InvoiceDocSummary[]>([]);
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
      const [p, o, a, t, e, i, c, r, su, po, pay, invoicePay, rates, bills] = await Promise.all([
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
        billing.listDocs("purchase"),
      ]);
      const invoices = i.map((row) =>
        reportMoney(row, ["total", "paid", "balance"], rates)
      );
      const purchaseInvoices = bills.map(row => reportMoney(row, ["total", "paid", "balance"], rates));
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
      setPurchaseInvoices(purchaseInvoices);
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
    // Intentionally invalidate the latest request counter on unmount; this is not a DOM ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    purchaseInvoices,
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
export function useTopCustomers(invoices: InvoiceDocSummary[]) {
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
  }, [invoices]);
}

/** Outstanding posted documents, aged by due date in calendar days. Input
 * amounts have already been normalized with the document's frozen FX rate. */
export function invoiceAging(invoices: InvoiceDocSummary[], today = todayYmd()) {
  const now = Date.parse(today + "T00:00:00Z");
  const buckets = { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0 };
  for (const invoice of invoices) {
    if (!isPostedStatus(invoice.status) || invoice.status === "paid") continue;
    const balance = Math.max(0,invoice.balance ?? (invoice.total - (invoice.paid || 0)));
    if (!balance) continue;
    const due = invoice.due_date ? Date.parse(invoice.due_date.slice(0,10) + "T00:00:00Z") : NaN;
    const age = Number.isFinite(due) ? Math.floor((now-due)/86400000) : 0;
    const bucket = age <= 0 ? "current" : age <= 30 ? "d30" : age <= 60 ? "d60" : age <= 90 ? "d90" : "d90p";
    buckets[bucket] += balance;
  }
  return buckets;
}
export function useReceivablesAging(invoices: InvoiceDocSummary[]) {
  return useMemo(() => invoiceAging(invoices), [invoices]);
}
export const usePayablesAging = useReceivablesAging;

export function supplierBillBalances(bills: InvoiceDocSummary[]) {
  const balances = new Map<string,{name:string;open:number;billCount:number}>();
  for (const bill of bills) {
    if (!isPostedStatus(bill.status) || bill.status === "paid" || !(Number(bill.balance) > 0)) continue;
    const name = bill.customer_name || "Unnamed supplier";
    const key = bill.customer_id ? "id:" + bill.customer_id : name.trim().toLowerCase();
    const row = balances.get(key) || {name,open:0,billCount:0};
    row.open += bill.balance!; row.billCount++; balances.set(key,row);
  }
  return [...balances.values()].sort((a,b)=>b.open-a.open);
}

/** Top suppliers by PO total. */
export function useTopSuppliers(poList: PoSummary[]) {
  return useMemo(() => {
    const g = new Map<string, { name: string; total: number; count: number }>();
    for (const p of poList) {
      if (["draft","cancelled"].includes(p.status)) continue;
      const name = p.supplier_name || "—";
      const row = g.get(name) || { name, total: 0, count: 0 };
      row.total += p.total || 0;
      row.count += 1;
      g.set(name, row);
    }
    return Array.from(g.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [poList]);
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
