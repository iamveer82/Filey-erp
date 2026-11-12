import { expect, it } from "vitest";
import { deductionLines, parseIndiaPayroll, professionalTax, statutoryDeductions } from "../indiaPayroll";

const on = { pf: true, pfCeiling: true, esi: true, ptState: "Maharashtra", skip: {} };

it("caps EPF at the Rs 15,000 wage ceiling unless paid on the full basic", () => {
  expect(statutoryDeductions({ employeeId: 1, basic: 30000, gross: 40000, month: "2026-09", settings: on }).pf).toBe(1800);
  expect(statutoryDeductions({ employeeId: 1, basic: 30000, gross: 40000, month: "2026-09", settings: { ...on, pfCeiling: false } }).pf).toBe(3600);
});

it("charges ESI only up to Rs 21,000 gross, rounded up", () => {
  const low = statutoryDeductions({ employeeId: 1, basic: 15000, gross: 18001, month: "2026-09", settings: on });
  expect(low.esi).toBe(136); // 135.0075 → next rupee
  expect(low.employerEsi).toBe(586);
  expect(statutoryDeductions({ employeeId: 1, basic: 15000, gross: 21001, month: "2026-09", settings: on }).esi).toBe(0);
});

it("uses state slabs, with Maharashtra's February top-up", () => {
  expect(professionalTax("Maharashtra", 7000, "2026-09")).toBe(0);
  expect(professionalTax("Maharashtra", 9000, "2026-09")).toBe(175);
  expect(professionalTax("Maharashtra", 30000, "2026-09")).toBe(200);
  expect(professionalTax("Maharashtra", 30000, "2027-02")).toBe(300);
  expect(professionalTax("Maharashtra", 9000, "2027-02")).toBe(175);
  expect(professionalTax("Karnataka", 24000, "2026-09")).toBe(0);
  expect(professionalTax("Karnataka", 25000, "2026-09")).toBe(200);
  expect(professionalTax("West Bengal", 20000, "2026-09")).toBe(130);
  expect(professionalTax("Nowhere", 90000, "2026-09")).toBe(0);
});

it("leaves skipped employees out and ignores bad settings", () => {
  const s = statutoryDeductions({ employeeId: 7, basic: 12000, gross: 12000, month: "2026-09", settings: { ...on, skip: { 7: ["pf", "pt"] } } });
  expect(s).toMatchObject({ pf: 0, pt: 0, esi: 90 });
  expect(parseIndiaPayroll("not json")).toMatchObject({ pf: false, ptState: "" });
  expect(parseIndiaPayroll(JSON.stringify({ pf: true, ptState: "Atlantis" }))).toMatchObject({ pf: true, pfCeiling: true, ptState: "" });
});

it("splits payslip lines and keeps the rest as other deductions", () => {
  expect(deductionLines(500)).toEqual([["Deductions", 500]]);
  expect(deductionLines(2300, { pf: 1800, pt: 200, other: 300 })).toEqual([
    ["Provident fund (EPF)", 1800], ["Professional tax", 200], ["Other deductions", 300],
  ]);
});
