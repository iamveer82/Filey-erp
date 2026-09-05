import { describe, it, expect } from "vitest";
import { parseStatementCsv, matchStatement, BookTxn } from "../bankRecon";

describe("parseStatementCsv", () => {
  it("parses a single signed-amount statement, normalising day-first dates", () => {
    const csv = [
      "Date,Description,Amount",
      "15/01/2026,Payment from ACME,\"1,000.00\"",
      "18/01/2026,Bank charge,(25.00)",
    ].join("\n");
    const lines = parseStatementCsv(csv);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ date: "2026-01-15", description: "Payment from ACME", amount: 1000 });
    expect(lines[1].amount).toBe(-25);
  });

  it("supports separate Credit/Debit columns", () => {
    const csv = [
      "Date,Narration,Debit,Credit",
      "2026-02-01,Salary,,5000",
      "2026-02-03,Rent,3000,",
    ].join("\n");
    const lines = parseStatementCsv(csv);
    expect(lines[0].amount).toBe(5000); // credit - debit
    expect(lines[1].amount).toBe(-3000);
  });

  it("skips rows without a parseable date", () => {
    const csv = ["Date,Amount", "Opening balance,,", "2026-03-01,100"].join("\n");
    expect(parseStatementCsv(csv)).toHaveLength(1);
  });
});

describe("matchStatement", () => {
  const txns: BookTxn[] = [
    { id: 1, description: "ACME invoice payment", date: "2026-01-16", amount: 1000 }, // ledger debit to cash
    { id: 2, description: "Office rent", date: "2026-02-03", amount: 3000 },
    { id: 3, description: "Stale entry", date: "2026-05-01", amount: 999 },
  ];

  it("matches by absolute amount within the date tolerance, sign-agnostic", () => {
    const lines = [
      { date: "2026-01-15", description: "from ACME", amount: 1000 }, // +1000 vs ledger +1000, 1 day apart
      { date: "2026-02-03", description: "rent", amount: -3000 }, // -3000 vs ledger +3000, same day
    ];
    const r = matchStatement(lines, txns);
    expect(r.matched.map((m) => m.txnId).sort()).toEqual([1, 2]);
    expect(r.unmatchedLines).toHaveLength(0);
    expect(r.unmatchedTxns.map((t) => t.id)).toEqual([3]); // stale book entry not on statement
  });

  it("leaves a line unmatched when no amount is close enough in time", () => {
    const lines = [{ date: "2026-01-01", description: "x", amount: 999 }]; // id 3 is 4 months away
    const r = matchStatement(lines, txns);
    expect(r.matched).toHaveLength(0);
    expect(r.unmatchedLines).toHaveLength(1);
  });

  it("does not match one txn to two lines", () => {
    const lines = [
      { date: "2026-01-15", description: "a", amount: 1000 },
      { date: "2026-01-16", description: "b", amount: 1000 },
    ];
    const r = matchStatement(lines, txns);
    expect(r.matched).toHaveLength(1); // only one ledger txn of 1000
    expect(r.unmatchedLines).toHaveLength(1);
  });
});

describe("direction-aware matching", () => {
  // The ledger stores every amount as a positive number with the direction in
  // txn_type, so a 500 payment and a 500 receipt are indistinguishable by
  // amount alone. Reconciling the wrong one stamps reconciled_at on both.
  const sameDay: BookTxn[] = [
    { id: 1, description: "Refund paid out", date: "2026-03-02", amount: 500, direction: "out" },
    { id: 2, description: "Customer receipt", date: "2026-03-03", amount: 500, direction: "in" },
  ];

  it("prefers the entry going the same way, even when it is further off in date", () => {
    const lines = [{ date: "2026-03-02", description: "Deposit", amount: 500 }];
    const r = matchStatement(lines, sameDay);
    // id 1 is the same-day candidate but money went the other way.
    expect(r.matched[0].txnId).toBe(2);
  });

  it("still matches the nearest date when directions agree", () => {
    const lines = [{ date: "2026-03-02", description: "Paid out", amount: -500 }];
    const r = matchStatement(lines, sameDay);
    expect(r.matched[0].txnId).toBe(1);
  });

  it("falls back to an opposite-direction entry rather than matching nothing", () => {
    const onlyOut: BookTxn[] = [
      { id: 9, description: "Paid out", date: "2026-03-02", amount: 500, direction: "out" },
    ];
    const lines = [{ date: "2026-03-02", description: "Deposit", amount: 500 }];
    // Statements that state every amount as a positive are common; refusing
    // these outright would reconcile nothing at all.
    expect(matchStatement(lines, onlyOut).matched[0].txnId).toBe(9);
  });
});

describe("num parsing", () => {
  it("reads a trailing minus as negative", () => {
    const csv = ["Date,Description,Amount", "2026-04-01,SAP export,\"1,234.56-\""].join("\n");
    expect(parseStatementCsv(csv)[0].amount).toBe(-1234.56);
  });

  it("leaves an ordinary amount positive", () => {
    const csv = ["Date,Description,Amount", "2026-04-01,Deposit,\"1,234.56\""].join("\n");
    expect(parseStatementCsv(csv)[0].amount).toBe(1234.56);
  });
});
