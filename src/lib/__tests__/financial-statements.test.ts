import { describe, it, expect } from "vitest";
import {
  computeTrialBalance,
  computeBalanceSheet,
  computeCashSummary,
  Account,
} from "../api";

const acct = (code: string, name: string, account_type: string, balance: number): Account => ({
  id: Number(code) || 0,
  code,
  name,
  account_type,
  balance,
});

// A small but balanced set of books:
//  Assets: Cash 1200, AR 800           = 2000
//  Liabilities: AP 500, Output VAT 100 = 600
//  Equity: Capital 1000                = 1000
//  Revenue 900, Expense 500 -> profit  = 400
//  => Assets 2000 = Liab 600 + Equity (1000 + 400) = 2000  ✓
const books: Account[] = [
  acct("1000", "Cash", "asset", 1200),
  acct("1100", "Accounts Receivable", "asset", 800),
  acct("2000", "Accounts Payable", "liability", 500),
  acct("2100", "Output VAT", "liability", 100),
  acct("3000", "Capital", "equity", 1000),
  acct("4000", "Sales Revenue", "revenue", 900),
  acct("5000", "Cost of Goods Sold", "expense", 500),
];

describe("computeTrialBalance", () => {
  it("balances debits against credits", () => {
    const tb = computeTrialBalance(books);
    // Debits: Cash 1200 + AR 800 + COGS 500 = 2500
    // Credits: AP 500 + Output VAT 100 + Capital 1000 + Revenue 900 = 2500
    expect(tb.totalDebit).toBe(2500);
    expect(tb.totalCredit).toBe(2500);
    expect(tb.balanced).toBe(true);
  });

  it("flips a negative balance to the opposite column", () => {
    const tb = computeTrialBalance([acct("1000", "Cash", "asset", -300)]);
    expect(tb.rows[0]).toMatchObject({ debit: 0, credit: 300 });
  });

  it("omits zero-balance accounts", () => {
    const tb = computeTrialBalance([acct("9", "Empty", "asset", 0)]);
    expect(tb.rows).toHaveLength(0);
  });
});

describe("computeBalanceSheet", () => {
  it("folds current-period profit into equity so A = L + E", () => {
    const bs = computeBalanceSheet(books);
    expect(bs.totalAssets).toBe(2000);
    expect(bs.totalLiabilities).toBe(600);
    expect(bs.netProfit).toBe(400);
    expect(bs.totalEquity).toBe(1400); // capital 1000 + profit 400
    expect(bs.balanced).toBe(true);
  });
});

describe("computeCashSummary", () => {
  it("counts debits to cash/bank as inflow, credits as outflow, within range", () => {
    const txns = [
      { account_name: "Cash", txn_type: "debit", amount: 1000, txn_date: "2026-01-10" },
      { account_name: "Bank", txn_type: "credit", amount: 300, txn_date: "2026-01-20" },
      { account_name: "Sales Revenue", txn_type: "credit", amount: 999, txn_date: "2026-01-15" }, // not cash
      { account_name: "Cash", txn_type: "debit", amount: 500, txn_date: "2025-12-01" }, // out of range
    ];
    const cs = computeCashSummary(txns, "2026-01-01", "2026-03-31");
    expect(cs.inflow).toBe(1000);
    expect(cs.outflow).toBe(300);
    expect(cs.net).toBe(700);
  });
});
