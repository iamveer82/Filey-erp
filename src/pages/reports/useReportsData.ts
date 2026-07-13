/* ── Shared data hook for all report tabs ──────────────────────────────────
 * Single fetch + live-sync so every tab shares the same snapshot. All
 * business calculations are preserved verbatim from the original Reports.tsx. */
import { useEffect, useMemo, useState } from "react";
import {
  erp,
  fin,
  billing,
  hr,
  pos,
  type Product,
  type FinanceReport,
  type InvoiceDocSummary,
  type Expense,
  type Payroll,
  type PoSummary,
  type Txn,
  type Account,
  computeVatReturn,
  computeTrialBalance,
  computeBalanceSheet,
  computeCashSummary,
} from "../../lib/api";
import { useLiveSync } from "../../lib/realtime";
import { localYmd } from "../../lib/format";

export interface ReportsData {
  products: Product[];
  report: FinanceReport | null;
  invoices: InvoiceDocSummary[];
  expenses: Expense[];
  payroll: Payroll[];
  posList: PoSummary[];
  txns: Txn[];
  accounts: Account[];
  loading: boolean;
  error: string;
  dateFrom: Date | undefined;
  dateTo: Date | undefined;
  setDateFrom: (d: Date | undefined) => void;
  setDateTo: (d: Date | undefined) => void;
}

export function useReportsData(): ReportsData {
  const [products, setProducts] = useState<Product[]>([]);
  const [report, setReport] = useState<FinanceReport | null>(null);
  const [invoices, setInvoices] = useState<InvoiceDocSummary[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [payroll, setPayroll] = useState<Payroll[]>([]);
  const [posList, setPosList] = useState<PoSummary[]>([]);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();

  const load = () => {
    setError("");
    return Promise.all([
      erp.products().then(setProducts),
      fin.report().then(setReport),
      billing.listDocs().then(setInvoices),
      fin.expenses().then(setExpenses),
      hr.payroll().then(setPayroll),
      pos.list().then(setPosList),
      fin.transactions().then(setTxns),
      fin.accounts().then(setAccounts),
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
    report,
    invoices,
    expenses,
    payroll,
    posList,
    txns,
    accounts,
    loading,
    error,
    dateFrom,
    dateTo,
    setDateFrom,
    setDateTo,
  };
}

/* ── Derived metrics (preserved from original Reports.tsx) ── */
export function useReportsMetrics(data: ReportsData) {
  const { invoices, expenses, payroll, posList, products, txns, accounts, dateFrom, dateTo } =
    data;

  const invoiceRevenue = useMemo(
    () =>
      invoices
        .filter((i) => i.status !== "draft")
        .reduce((s, i) => s + ((i.total || 0) - (i.balance ?? 0)), 0),
    [invoices]
  );
  const accountsReceivable = useMemo(
    () =>
      invoices
        .filter((i) => i.status !== "draft")
        .reduce((s, i) => s + (i.balance ?? 0), 0),
    [invoices]
  );
  const totalRevenue = invoiceRevenue + accountsReceivable;
  const totalExpenses = useMemo(
    () => expenses.reduce((s, e) => s + e.amount, 0),
    [expenses]
  );
  const monthExpenses = useMemo(() => {
    const now = new Date();
    return expenses
      .filter((e) => {
        const d = new Date(e.expense_date);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      })
      .reduce((s, e) => s + e.amount, 0);
  }, [expenses]);
  const payrollCost = useMemo(
    () => payroll.reduce((s, p) => s + p.net_pay, 0),
    [payroll]
  );
  const poValue = useMemo(
    () =>
      posList.filter((p) => p.status !== "cancelled").reduce((s, p) => s + p.total, 0),
    [posList]
  );
  const poReceived = useMemo(
    () => posList.filter((p) => p.status === "received").reduce((s, p) => s + p.total, 0),
    [posList]
  );
  const grossProfit = totalRevenue - totalExpenses - payrollCost;
  const invValue = products.reduce((s, p) => s + p.quantity * p.cost_price, 0);

  const expenseByCat = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of expenses) {
      const cat = e.category || "Uncategorized";
      m.set(cat, (m.get(cat) ?? 0) + e.amount);
    }
    return Array.from(m.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [expenses]);

  const monthly = useMemo(() => {
    const now = new Date();
    const buckets: { name: string; key: string; sales: number; expense: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({
        name: d.toLocaleString("en", { month: "short" }),
        key: `${d.getFullYear()}-${d.getMonth()}`,
        sales: 0,
        expense: 0,
      });
    }
    const byKey = new Map(buckets.map((b) => [b.key, b]));
    for (const inv of invoices) {
      if (inv.status === "draft" || !inv.issue_date) continue;
      const collected = (inv.total || 0) - (inv.balance ?? 0);
      if (collected <= 0) continue;
      const d = new Date(inv.issue_date);
      const b = byKey.get(`${d.getFullYear()}-${d.getMonth()}`);
      if (b) b.sales += collected;
    }
    for (const e of expenses) {
      if (!e.expense_date) continue;
      const d = new Date(e.expense_date);
      const b = byKey.get(`${d.getFullYear()}-${d.getMonth()}`);
      if (b) b.expense += e.amount;
    }
    return buckets.map(({ name, sales, expense }) => ({ name, sales, expense }));
  }, [invoices, expenses]);

  const invoiceTxns = useMemo(
    () =>
      invoices
        .filter((i) => i.status !== "draft")
        .sort((a, b) => (a.issue_date || "").localeCompare(b.issue_date || "")),
    [invoices]
  );
  const expenseTxns = useMemo(
    () =>
      [...expenses].sort((a, b) =>
        (a.expense_date || "").localeCompare(b.expense_date || "")
      ),
    [expenses]
  );
  const poTxns = useMemo(
    () =>
      [...posList]
        .filter((p) => p.status !== "cancelled")
        .sort((a, b) => (a.order_date || "").localeCompare(b.order_date || "")),
    [posList]
  );

  const vat = useMemo(
    () =>
      computeVatReturn(
        txns,
        5,
        dateFrom ? localYmd(dateFrom) : undefined,
        dateTo ? localYmd(dateTo) : undefined
      ),
    [txns, dateFrom, dateTo]
  );

  const trialBalance = useMemo(() => computeTrialBalance(accounts), [accounts]);
  const balanceSheet = useMemo(() => computeBalanceSheet(accounts), [accounts]);
  const cashSummary = useMemo(
    () =>
      computeCashSummary(
        txns,
        dateFrom ? localYmd(dateFrom) : undefined,
        dateTo ? localYmd(dateTo) : undefined
      ),
    [txns, dateFrom, dateTo]
  );

  return {
    invoiceRevenue,
    accountsReceivable,
    totalRevenue,
    totalExpenses,
    monthExpenses,
    payrollCost,
    poValue,
    poReceived,
    grossProfit,
    invValue,
    expenseByCat,
    monthly,
    invoiceTxns,
    expenseTxns,
    poTxns,
    vat,
    trialBalance,
    balanceSheet,
    cashSummary,
  };
}

export type ReportsMetrics = ReturnType<typeof useReportsMetrics>;