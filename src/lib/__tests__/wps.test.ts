import { describe, it, expect } from "vitest";
import { buildSif, validateWps, isValidUaeIban, WpsError, type WpsInput } from "../wps";

// A structurally valid UAE IBAN (mod-97 check passes).
const IBAN_A = "AE070331234567890123456";
const IBAN_B = "AE460090000000123456789";

const input = (over: Partial<WpsInput> = {}): WpsInput => ({
  employer: { molEstablishmentId: "1234567890123", bankCode: "033112345" },
  employees: [
    {
      name: "Asha Rahman",
      labourCardNo: "12345678901234",
      iban: IBAN_A,
      bankCode: "033112345",
      fixedAmount: 5000,
      variableAmount: 500,
      daysInPeriod: 30,
    },
  ],
  periodStart: "2026-07-01",
  periodEnd: "2026-07-31",
  createdAt: new Date(2026, 7, 2, 9, 5), // 2 Aug 2026, 09:05 local
  ...over,
});

describe("isValidUaeIban", () => {
  it("accepts a well-formed UAE IBAN, with or without spaces", () => {
    expect(isValidUaeIban(IBAN_A)).toBe(true);
    expect(isValidUaeIban("AE07 0331 2345 6789 0123 456")).toBe(true);
  });

  it("rejects wrong country, wrong length and a bad check digit", () => {
    expect(isValidUaeIban("GB33BUKB20201555555555")).toBe(false);
    expect(isValidUaeIban("AE07033123456789012345")).toBe(false); // 22 chars
    expect(isValidUaeIban("AE080331234567890123456")).toBe(false); // check digit off
  });

  it("catches a transposed digit pair", () => {
    const swapped = IBAN_A.slice(0, 8) + IBAN_A[9] + IBAN_A[8] + IBAN_A.slice(10);
    expect(swapped).not.toBe(IBAN_A);
    expect(isValidUaeIban(swapped)).toBe(false);
  });
});

describe("buildSif", () => {
  it("writes one EDR per employee and a single SCR summary", () => {
    const file = buildSif(
      input({
        employees: [
          ...input().employees,
          {
            name: "Omar Said",
            labourCardNo: "99999999999999",
            iban: IBAN_B,
            bankCode: "009000000",
            fixedAmount: 3000,
            daysInPeriod: 30,
          },
        ],
      })
    );

    const lines = file.content.trimEnd().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      `EDR,12345678901234,033112345,${IBAN_A},01072026,31072026,30,5000.00,500.00,0`
    );
    expect(lines[1]).toBe(
      `EDR,99999999999999,009000000,${IBAN_B},01072026,31072026,30,3000.00,0.00,0`
    );
    // file date 02082026, time 0905, salary month 072026, 2 records, total
    expect(lines[2]).toBe("SCR,1234567890123,033112345,02082026,0905,072026,2,8500.00,AED");

    expect(file.employeeCount).toBe(2);
    expect(file.totalAmount).toBe(8500);
    expect(file.filename).toBe("1234567890123072026" + "01.SIF");
  });

  it("ends every line with CRLF, including the last", () => {
    expect(buildSif(input()).content.endsWith("\r\n")).toBe(true);
    expect(buildSif(input()).content).not.toMatch(/[^\r]\n/);
  });

  it("takes the salary month from the period end, not the start", () => {
    // A 26 Jan – 25 Feb run is February's salary.
    const file = buildSif(
      input({ periodStart: "2026-01-26", periodEnd: "2026-02-25" })
    );
    expect(file.content).toContain(",022026,");
  });

  it("refuses to emit a file the bank would reject, listing every problem", () => {
    let err: WpsError | undefined;
    try {
      buildSif(
        input({
          employer: { molEstablishmentId: "123", bankCode: "abc" },
          employees: [
            {
              name: "Bad Row",
              labourCardNo: "123",
              iban: "AE000000000000000000000",
              bankCode: "1",
              fixedAmount: 1000,
              daysInPeriod: 40,
            },
          ],
        })
      );
    } catch (e) {
      err = e as WpsError;
    }
    expect(err).toBeInstanceOf(WpsError);
    const all = err!.problems.join("\n");
    expect(all).toMatch(/establishment ID must be 13 digits/);
    expect(all).toMatch(/Employer bank routing code/);
    expect(all).toMatch(/Bad Row: labour card number must be 14 digits/);
    expect(all).toMatch(/Bad Row: IBAN is not a valid UAE IBAN/);
    expect(all).toMatch(/Bad Row: bank routing code must be 9 digits/);
    expect(all).toMatch(/Bad Row: days in period must be between 1 and 31/);
  });

  it("catches the same labour card twice — a duplicate pays someone twice", () => {
    const dup = input().employees[0];
    const problems = validateWps(input({ employees: [dup, { ...dup, name: "Copy" }] }));
    expect(problems.join(" ")).toMatch(/appears twice/);
  });

  it("rejects a zero-pay row rather than filing an empty payment", () => {
    const problems = validateWps(
      input({
        employees: [
          { ...input().employees[0], fixedAmount: 0, variableAmount: 0 },
        ],
      })
    );
    expect(problems.join(" ")).toMatch(/total pay is zero/);
  });

  it("rejects leave days longer than the period, and a backwards period", () => {
    expect(
      validateWps(
        input({ employees: [{ ...input().employees[0], leaveDays: 45 }] })
      ).join(" ")
    ).toMatch(/leave days cannot exceed/i);

    expect(
      validateWps(input({ periodStart: "2026-07-31", periodEnd: "2026-07-01" })).join(" ")
    ).toMatch(/before period start/i);
  });

  it("rounds amounts to exactly two decimals", () => {
    const file = buildSif(
      input({
        employees: [{ ...input().employees[0], fixedAmount: 1234.567, variableAmount: 0 }],
      })
    );
    expect(file.content).toContain(",1234.57,0.00,");
  });
});
