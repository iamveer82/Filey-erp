/* Indian statutory payroll deductions: EPF, ESI and professional tax.
 *
 * EPF: 12% of basic, on wages up to Rs 15,000 unless the business pays on the full basic.
 * ESI: 0.75% employee / 3.25% employer of gross wages, only while gross is Rs 21,000 or less,
 *      rounded up to the next rupee as ESIC does.
 * Professional tax: state slabs on monthly gross. Slabs change; every figure stays editable. */

import { tools } from "./api";

const r2 = (n: number) => Math.round(n * 100) / 100;

export const INDIA_PAYROLL_KEY = "india_payroll";
export const PAYROLL_BREAKDOWN_KEY = "payroll_breakdown";

export type StatutoryKey = "pf" | "esi" | "pt";

export interface IndiaPayrollSettings {
  pf: boolean;
  /** EPF on wages up to the Rs 15,000 ceiling. Off = 12% of the full basic. */
  pfCeiling: boolean;
  esi: boolean;
  /** State whose professional tax slabs apply; "" = none. */
  ptState: string;
  /** Employees left out of a deduction, by employee id. */
  skip: Record<string, StatutoryKey[]>;
}

export const DEFAULT_INDIA_PAYROLL: IndiaPayrollSettings = { pf: false, pfCeiling: true, esi: false, ptState: "", skip: {} };

export function parseIndiaPayroll(raw?: string | null): IndiaPayrollSettings {
  try {
    const v = raw ? JSON.parse(raw) : {};
    if (!v || typeof v !== "object") return DEFAULT_INDIA_PAYROLL;
    return {
      pf: v.pf === true, pfCeiling: v.pfCeiling !== false, esi: v.esi === true,
      ptState: typeof v.ptState === "string" && PT_SLABS[v.ptState] ? v.ptState : "",
      skip: v.skip && typeof v.skip === "object" ? v.skip : {},
    };
  } catch {
    return DEFAULT_INDIA_PAYROLL;
  }
}

export const PF_WAGE_CEILING = 15000;
export const ESI_WAGE_LIMIT = 21000;

/** [highest monthly gross in the slab, tax]. `february` replaces the top slab's tax in February. */
const PT_SLABS: Record<string, { slabs: [number, number][]; february?: number }> = {
  "Andhra Pradesh": { slabs: [[15000, 0], [20000, 150], [Infinity, 200]] },
  Gujarat: { slabs: [[12000, 0], [Infinity, 200]] },
  // ponytail: exemption raised to Rs 25,000 from April 2025; older months use the same slab.
  Karnataka: { slabs: [[24999.99, 0], [Infinity, 200]], february: 300 },
  // Men's slab. Women earning up to Rs 25,000 are exempt: skip PT for them.
  Maharashtra: { slabs: [[7500, 0], [10000, 175], [Infinity, 200]], february: 300 },
  Telangana: { slabs: [[15000, 0], [20000, 150], [Infinity, 200]] },
  "West Bengal": { slabs: [[10000, 0], [15000, 110], [25000, 130], [40000, 150], [Infinity, 200]] },
};
export const PT_STATES = Object.keys(PT_SLABS);

export function professionalTax(state: string, gross: number, month: string): number {
  const table = PT_SLABS[state];
  if (!table || !(gross > 0)) return 0;
  const index = table.slabs.findIndex(([upTo]) => gross <= upTo);
  const tax = table.slabs[index][1];
  return table.february && month.slice(5, 7) === "02" && index === table.slabs.length - 1 ? table.february : tax;
}

export interface Statutory { pf: number; esi: number; pt: number; employerPf: number; employerEsi: number }

/** `basic` is the basic actually earned this month (after unpaid leave); `gross` adds allowances. */
export function statutoryDeductions({ employeeId, basic, gross, month, settings }: {
  employeeId: number; basic: number; gross: number; month: string; settings: IndiaPayrollSettings;
}): Statutory {
  const skip = new Set(settings.skip[String(employeeId)] ?? []);
  const pfWage = Math.max(0, settings.pfCeiling ? Math.min(basic, PF_WAGE_CEILING) : basic);
  const pf = settings.pf && !skip.has("pf") ? Math.round(pfWage * 0.12) : 0;
  const esiDue = settings.esi && !skip.has("esi") && gross > 0 && gross <= ESI_WAGE_LIMIT;
  return {
    pf, employerPf: pf,
    esi: esiDue ? Math.ceil(r2(gross * 0.0075)) : 0,
    employerEsi: esiDue ? Math.ceil(r2(gross * 0.0325)) : 0,
    pt: settings.ptState && !skip.has("pt") ? professionalTax(settings.ptState, gross, month) : 0,
  };
}

/** How one recorded payslip's deductions add up. The payroll row keeps only the total. */
export interface DeductionBreakdown { pf?: number; esi?: number; pt?: number; leave?: number; other?: number }

export const breakdownKey = (employeeId: number, period: string) => `${employeeId}:${period}`;

export function parseBreakdowns(raw?: string | null): Record<string, DeductionBreakdown> {
  try {
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** Merge new splits into the stored map. Run after the payroll rows are recorded. */
export async function saveBreakdowns(entries: Record<string, DeductionBreakdown>) {
  if (!Object.keys(entries).length) return;
  const rows = await tools.settings();
  const current = parseBreakdowns(rows.find((r) => r.key === PAYROLL_BREAKDOWN_KEY)?.value);
  await tools.setSetting(PAYROLL_BREAKDOWN_KEY, JSON.stringify({ ...current, ...entries }));
}

/** Payslip lines for a deduction total: the saved split when there is one, else one line. */
export function deductionLines(total: number, split?: DeductionBreakdown | null): [string, number][] {
  if (!split) return [["Deductions", total]];
  const lines: [string, number][] = [
    ["Provident fund (EPF)", split.pf ?? 0], ["ESI", split.esi ?? 0], ["Professional tax", split.pt ?? 0],
    ["Unpaid leave", split.leave ?? 0],
  ];
  const known = lines.reduce((s, [, v]) => s + v, 0);
  lines.push(["Other deductions", r2(total - known)]);
  return lines.filter(([, v]) => Math.abs(v) >= 0.005);
}
