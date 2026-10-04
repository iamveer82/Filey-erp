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
    expect(lines[0]).toEqual({ date: "2026-01-15", description: "Payment from ACME", amount: 1000, direction: "in" });
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

  it("preserves multiline quoted descriptions and escaped quotes in one transaction", () => {
    const escaped = 'Date,Description,Amount\r\n2026-03-01,"Payment for ""Acme""\r\nsecond line",125';
    expect(parseStatementCsv(escaped)).toEqual([{ date: "2026-03-01", description: 'Payment for "Acme"\nsecond line', amount: 125 }]);
    for (const row of ['2026-03-01,"unfinished,125', '2026-03-01,"closed"extra,125'])
      expect(() => parseStatementCsv("Date,Description,Amount\n" + row)).toThrow(/CSV/);
  });

  it("rejects impossible statement dates instead of reconciling a rolled-over day", () => {
    const csv = 'Date,Amount\n2026-02-31,100\n31/04/2026,200\n2026-13-01,300\n29/02/2024,400';
    expect(parseStatementCsv(csv)).toEqual([{ date: "2024-02-29", description: "", amount: 400 }]);
  });

  it("does not shorten malformed numbers or scientific notation into a different amount", () => {
    expect(parseStatementCsv('Date,Amount\n2026-03-01,1.2.3\n2026-03-01,1e3\n2026-03-01,AED 123.45')).toEqual([
      { date: "2026-03-01", description: "", amount: 123.45 },
    ]);
  });

  it("uses explicit debit/credit columns even when the export also has an unsigned amount", () => {
    const [line] = parseStatementCsv('Date,Description,Amount,Debit,Credit\n2026-03-01,Rent,500,500,');
    expect(line.amount).toBe(-500);
    expect(line.direction).toBe("out");
    const result = matchStatement([line], [{ id: 3, description: "Receipt", date: "2026-03-01", amount: 500, direction: "in" }]);
    expect(result.matched).toHaveLength(0);
  });

  it("leaves an explicit credit unmatched when only an equal payment exists", () => {
    const lines = parseStatementCsv('Date,Debit,Credit\n2026-03-01,,500');
    const result = matchStatement(lines, [{ id: 3, description: "Payment", date: "2026-03-01", amount: 500, direction: "out" }]);
    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedLines).toHaveLength(1);
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

  it("does not reconcile invalid book dates or nonfinite amounts", () => {
    const result = matchStatement([{ date: "2026-03-03", description: "x", amount: 100 }], [
      { id: 4, description: "Rolled date", date: "2026-02-31", amount: 100 },
      { id: 5, description: "Corrupt amount", date: "2026-03-03", amount: NaN },
    ]);
    expect(result.matched).toHaveLength(0);
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
