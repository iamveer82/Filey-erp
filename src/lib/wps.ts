// UAE Wage Protection System (WPS) — Salary Information File (SIF).
//
// A SIF is a plain CSV the employer uploads to their bank (or exchange house),
// which forwards it to MOHRE. It carries one EDR line per employee and a single
// SCR summary line. Getting a field wrong doesn't fail loudly — the bank rejects
// the whole file, or worse, pays the wrong amount — so everything here validates
// before it serialises, and refuses to emit a file it knows is malformed.
//
// ⚠️ Field order and column count vary slightly between banks and WPS versions.
// This implements the standard MOHRE layout. Check one generated file against a
// sample your bank accepts BEFORE the first live payroll run.

export interface WpsEmployer {
  /** MOHRE establishment ID (13 digits) — the employer's WPS identity. */
  molEstablishmentId: string;
  /** Employer's bank/exchange routing code (9 digits), from the bank. */
  bankCode: string;
}

export interface WpsEmployee {
  /** Shown in errors so the user knows which row to fix. */
  name: string;
  /** Labour card / personal number (14 digits) — the employee's WPS identity. */
  labourCardNo: string;
  /** Salary account IBAN. UAE IBANs are 23 characters, "AE" + 21 digits. */
  iban: string;
  /** Employee's bank/exchange routing code (9 digits). */
  bankCode: string;
  /** Basic pay for the period. */
  fixedAmount: number;
  /** Allowances, overtime, anything variable. */
  variableAmount?: number;
  /** Calendar days covered — normally the length of the salary month. */
  daysInPeriod: number;
  /** Unpaid leave days within the period. */
  leaveDays?: number;
}

export interface WpsInput {
  employer: WpsEmployer;
  employees: WpsEmployee[];
  /** Salary period, inclusive. ISO yyyy-mm-dd. */
  periodStart: string;
  periodEnd: string;
  /** When the file was produced — injectable so tests are not clock-dependent. */
  createdAt?: Date;
}

export interface WpsFile {
  filename: string;
  content: string;
  employeeCount: number;
  totalAmount: number;
}

export class WpsError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join("\n"));
  }
}

/** UAE IBAN: "AE" + 2 check digits + 19 digits = 23 characters. Validated with
 *  the ISO 7064 mod-97 check, so a transposed pair is caught here rather than by
 *  the bank three days later. */
export function isValidUaeIban(raw: string): boolean {
  const iban = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^AE\d{21}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  // "A"→10, "E"→14; everything else is already a digit.
  const expanded = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let remainder = 0;
  for (const ch of expanded) remainder = (remainder * 10 + Number(ch)) % 97;
  return remainder === 1;
}

/** WPS dates are DDMMYYYY with no separators. */
function wpsDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) throw new WpsError([`Date must be yyyy-mm-dd, got "${iso}"`]);
  return `${m[3]}${m[2]}${m[1]}`;
}

const pad = (n: number, w: number) => String(n).padStart(w, "0");
/** Amounts are plain decimals with exactly two places — no thousands separator,
 *  no currency symbol. */
const amount = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

/** Everything that would make a bank reject the file, collected in one pass so
 *  the user fixes all of it at once instead of one row per upload attempt. */
export function validateWps(input: WpsInput): string[] {
  const problems: string[] = [];
  const { employer, employees } = input;

  if (!/^\d{13}$/.test(employer.molEstablishmentId.trim()))
    problems.push(
      "Employer MOHRE establishment ID must be 13 digits (Settings → Company)."
    );
  if (!/^\d{9}$/.test(employer.bankCode.trim()))
    problems.push("Employer bank routing code must be 9 digits (Settings → Company).");

  if (!employees.length) problems.push("No employees to pay in this period.");

  const seen = new Set<string>();
  for (const e of employees) {
    const who = e.name || e.labourCardNo || "(unnamed)";
    if (!/^\d{14}$/.test(e.labourCardNo.trim()))
      problems.push(`${who}: labour card number must be 14 digits.`);
    else if (seen.has(e.labourCardNo.trim()))
      problems.push(`${who}: labour card number appears twice in this file.`);
    else seen.add(e.labourCardNo.trim());

    if (!isValidUaeIban(e.iban))
      problems.push(`${who}: IBAN is not a valid UAE IBAN (AE + 21 digits).`);
    if (!/^\d{9}$/.test(e.bankCode.trim()))
      problems.push(`${who}: bank routing code must be 9 digits.`);
    if (!(e.fixedAmount >= 0) || !Number.isFinite(e.fixedAmount))
      problems.push(`${who}: fixed amount must be zero or more.`);
    if (e.variableAmount != null && !(e.variableAmount >= 0))
      problems.push(`${who}: variable amount cannot be negative.`);
    if (!Number.isInteger(e.daysInPeriod) || e.daysInPeriod < 1 || e.daysInPeriod > 31)
      problems.push(`${who}: days in period must be between 1 and 31.`);
    if (e.leaveDays != null && (e.leaveDays < 0 || e.leaveDays > e.daysInPeriod))
      problems.push(`${who}: leave days cannot exceed the days in the period.`);
    if (e.fixedAmount + (e.variableAmount ?? 0) <= 0)
      problems.push(`${who}: total pay is zero — remove them from this run instead.`);
  }

  if (input.periodEnd < input.periodStart)
    problems.push("Period end is before period start.");

  return problems;
}

/**
 * Build the SIF. Throws `WpsError` with every problem listed rather than
 * emitting a file the bank will bounce.
 *
 * EDR: EDR, employee ID, agent ID, account, start, end, days, fixed, variable, leave
 * SCR: SCR, employer ID, agent ID, file date, file time, salary month, records,
 *      total, currency
 */
export function buildSif(input: WpsInput): WpsFile {
  const problems = validateWps(input);
  if (problems.length) throw new WpsError(problems);

  const { employer, employees } = input;
  const start = wpsDate(input.periodStart);
  const end = wpsDate(input.periodEnd);
  const now = input.createdAt ?? new Date();

  const rows = employees.map((e) =>
    [
      "EDR",
      e.labourCardNo.trim(),
      e.bankCode.trim(),
      e.iban.replace(/\s+/g, "").toUpperCase(),
      start,
      end,
      String(e.daysInPeriod),
      amount(e.fixedAmount),
      amount(e.variableAmount ?? 0),
      String(e.leaveDays ?? 0),
    ].join(",")
  );

  const total = employees.reduce(
    (s, e) => s + e.fixedAmount + (e.variableAmount ?? 0),
    0
  );
  // Salary month is taken from the period END: a run covering 26 Jan–25 Feb is
  // February's salary, which is how MOHRE reads it.
  const [, endMonth, endYear] = /^(\d{4})-(\d{2})-\d{2}$/.exec(input.periodEnd)
    ? [null, input.periodEnd.slice(5, 7), input.periodEnd.slice(0, 4)]
    : [null, "", ""];

  const scr = [
    "SCR",
    employer.molEstablishmentId.trim(),
    employer.bankCode.trim(),
    `${pad(now.getDate(), 2)}${pad(now.getMonth() + 1, 2)}${now.getFullYear()}`,
    `${pad(now.getHours(), 2)}${pad(now.getMinutes(), 2)}`,
    `${endMonth}${endYear}`,
    String(employees.length),
    amount(total),
    "AED",
  ].join(",");

  // Banks expect CRLF and a trailing newline; a lone LF has been known to fail
  // validation at the bank's end.
  const content = `${[...rows, scr].join("\r\n")}\r\n`;

  return {
    // Convention: establishment ID + salary month + sequence, .SIF extension.
    filename: `${employer.molEstablishmentId.trim()}${endMonth}${endYear}01.SIF`,
    content,
    employeeCount: employees.length,
    totalAmount: Math.round(total * 100) / 100,
  };
}
