// Bank reconciliation: parse a bank-statement CSV and match its lines against
// the ledger's cash/bank transactions. Pure + testable — the UI (BankAccounts)
// just feeds it text + transactions and renders the buckets.

import { parseCsvMatrix } from "./csv";

export interface StatementLine {
  date: string; // normalised yyyy-mm-dd
  description: string;
  amount: number; // signed: credit (+) / debit (-) where derivable
  /** Explicit statement direction; unsigned exports can leave it unknown. */
  direction?: "in" | "out";
}
export interface BookTxn {
  id: number;
  description: string;
  date: string;
  amount: number;
  /** Which way the money went, when the caller knows. The ledger stores every
   *  amount as a positive number with the direction in txn_type, so without
   *  this the matcher cannot tell a 500 receipt from a 500 payment. Optional:
   *  a caller that doesn't know leaves it off and matching behaves as before. */
  direction?: "in" | "out";
}
export interface ReconMatch {
  line: StatementLine;
  txnId: number;
  txnDesc: string;
  txnDate: string;
}
export interface ReconResult {
  matched: ReconMatch[];
  unmatchedLines: StatementLine[]; // on the statement, not in the books
  unmatchedTxns: BookTxn[]; // in the books, not on the statement
}

/** Parse a money cell: strips commas/currency, treats (x) and a TRAILING minus
 *  as negative. The trailing form ("1,234.56-") comes out of mainframe and SAP
 *  exports; parseFloat reads it as positive and the sign is simply lost, which
 *  turns a payment into a deposit with nothing to show for it. */
function num(s: string): number {
  if (!s) return NaN;
  const cleaned = s.replace(/,/g, "").replace(/[^0-9.\-]/g, "");
  // Never turn malformed decimals or scientific notation into a different
  // amount through parseFloat/character stripping (e.g. 1e3 became 13).
  if (/\d[eE][+-]?\d/.test(s)) return NaN;
  const numeric = cleaned.replace(/-$/, "");
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(numeric)) return NaN;
  let v = Number(numeric);
  if (!isFinite(v)) return NaN;
  if (/\(.*\)/.test(s) || /-\s*$/.test(s.trim())) v = -Math.abs(v);
  return v;
}

/** Normalise a date cell to yyyy-mm-dd. Assumes day-first (UAE/EU) for
 *  ambiguous d/m/y; falls back to Date.parse. */
function normalizeDate(s: string): string {
  s = (s || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}(?:$|[ T])/.test(s)) return validYmd(s.slice(0, 10)) ? s.slice(0, 10) : "";
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})(?:$|\s)/);
  if (m) {
    const [, d, mo] = m;
    let y = m[3];
    if (y.length === 2) y = "20" + y;
    const day = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    return validYmd(day) ? day : "";
  }
  const t = Date.parse(s);
  if (isNaN(t)) return "";
  // Local calendar day, not toISOString(): a format like "5 Jul 2026" parses to
  // LOCAL midnight, which UTC pushes back to the 4th in Dubai — a statement line
  // landing on the wrong day defeats the whole point of matching by date.
  // ponytail: inlined rather than importing format.ts, which would drag clsx +
  // tailwind-merge into this deliberately dependency-free parser.
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function validYmd(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const parsed = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}

/** Parse a bank-statement CSV into statement lines. Detects a header row and
 *  supports either a single signed Amount column or separate Credit/Debit
 *  columns. Rows without a parseable date+amount are skipped. */
export function parseStatementCsv(text: string): StatementLine[] {
  const rows = parseCsvMatrix(text).map(row => row.map(cell => cell.trim()))
    .filter(row => row.some(Boolean));
  if (!rows.length) return [];

  let headerIdx = rows.findIndex(
    (r) =>
      r.some((c) => /date/i.test(c)) &&
      r.some((c) => /amount|amt|value|credit|debit/i.test(c))
  );
  if (headerIdx < 0) headerIdx = 0;
  const header = rows[headerIdx].map((h) => h.toLowerCase());
  const find = (re: RegExp) => header.findIndex((h) => re.test(h));
  const di = find(/date/);
  const desi = find(/desc|narration|details|reference|particular|remit/);
  const ai = find(/amount|amt|value/);
  const ci = find(/credit|deposit|cr$/);
  const dbi = find(/debit|withdraw|dr$/);
  const signedAmounts = ai >= 0 && rows.slice(headerIdx + 1).some(row => num(row[ai] ?? "") < 0);

  const out: StatementLine[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const date = normalizeDate(di >= 0 ? r[di] : "");
    if (!date) continue;
    let amount = ai >= 0 ? num(r[ai] ?? "") : NaN;
    let direction: StatementLine["direction"];
    if (ci >= 0 || dbi >= 0) {
      const cr = ci >= 0 ? num(r[ci] || "0") : 0;
      const dr = dbi >= 0 ? num(r[dbi] || "0") : 0;
      if (isFinite(cr) && isFinite(dr) && (cr !== 0 || dr !== 0 || !isFinite(amount))) {
        amount = cr - dr;
        direction = amount < 0 ? "out" : "in";
      }
    }
    if (!isFinite(amount)) continue;
    if (!direction && (amount < 0 || signedAmounts)) direction = amount < 0 ? "out" : "in";
    out.push({ date, description: (desi >= 0 ? r[desi] : "") || "", amount, ...(direction ? { direction } : {}) });
  }
  return out;
}

function daysBetween(a: string, b: string): number {
  if (!validYmd(a) || !validYmd(b)) return Infinity;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (isNaN(ta) || isNaN(tb)) return Infinity;
  return Math.abs(ta - tb) / 86400000;
}

/** Match statement lines to book transactions by absolute amount (sign-agnostic
 *  — a deposit and its ledger debit-to-cash carry opposite signs) and date
 *  proximity. Greedy 1:1; among equal-amount candidates the nearest date wins. */
export function matchStatement(
  lines: StatementLine[],
  txns: BookTxn[],
  toleranceDays = 4
): ReconResult {
  const used = new Set<number>();
  const matched: ReconMatch[] = [];
  const unmatchedLines: StatementLine[] = [];
  for (const line of lines) {
    if (!Number.isFinite(line.amount)) { unmatchedLines.push(line); continue; }
    const target = Math.round(Math.abs(line.amount) * 100);
    const lineDir = line.amount < 0 ? "out" : "in";
    let best: BookTxn | undefined;
    let bestD = Infinity;
    let bestAgrees = false;
    for (const t of txns) {
      if (used.has(t.id)) continue;
      if (!Number.isFinite(t.amount)) continue;
      if (line.direction && t.direction && line.direction !== t.direction) continue;
      if (Math.round(Math.abs(t.amount) * 100) !== target) continue;
      const dd = daysBetween(line.date, t.date);
      if (dd > toleranceDays) continue;
      // Explicit signed/debit-credit exports cannot match the other direction.
      // For older unsigned exports, direction remains a preference: those
      // statements can report payments and receipts as positive amounts.
      const agrees = t.direction === undefined || t.direction === lineDir;
      if (bestAgrees && !agrees) continue;
      if (agrees && !bestAgrees) {
        best = t;
        bestD = dd;
        bestAgrees = true;
        continue;
      }
      if (dd < bestD) {
        best = t;
        bestD = dd;
        bestAgrees = agrees;
      }
    }
    if (best) {
      used.add(best.id);
      matched.push({ line, txnId: best.id, txnDesc: best.description, txnDate: best.date });
    } else unmatchedLines.push(line);
  }
  return { matched, unmatchedLines, unmatchedTxns: txns.filter((t) => !used.has(t.id)) };
}
