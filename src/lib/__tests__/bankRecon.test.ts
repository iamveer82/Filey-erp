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
