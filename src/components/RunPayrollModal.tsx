import { useEffect, useMemo, useState } from "react";
import { billing, hr, tools, type Employee, type Payroll } from "../lib/api";
import { aed, getDisplayCurrency, numInput, todayYmd } from "../lib/format";
import { useUI } from "../lib/ui";
import { Modal } from "./ui";
import { SelectMenu } from "./ui-menu";
import { daysInMonth, leaveDeduction } from "../lib/payroll";
import { companyCountry } from "../lib/companyCountry";
import {
  DEFAULT_INDIA_PAYROLL, INDIA_PAYROLL_KEY, PT_STATES, breakdownKey, parseIndiaPayroll, saveBreakdowns, statutoryDeductions,
  type DeductionBreakdown, type IndiaPayrollSettings, type StatutoryKey,
} from "../lib/indiaPayroll";

interface Row {
  basic: number; allowances: number; deductions: number; unpaidDays: number; include: boolean;
  /** This month's PF / ESI / PT when changed by hand; undefined = worked out from the settings. */
  pf?: number; esi?: number; pt?: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const daysIn = daysInMonth;
const STAT: [StatutoryKey, string][] = [["pf", "PF"], ["esi", "ESI"], ["pt", "PT"]];

/** One month's payroll for every active employee: each line can be changed for this
 *  month only, and anyone already recorded for the month is skipped. Indian businesses
 *  also get EPF, ESI and professional tax worked out per employee. */
export default function RunPayrollModal({ open, onClose, employees, onDone }: {
  open: boolean; onClose: () => void; employees: Employee[]; onDone: () => void;
}) {
  const { toast, confirm } = useUI();
  const [month, setMonth] = useState(() => todayYmd().slice(0, 7));
  const [recorded, setRecorded] = useState<Payroll[]>([]);
  const [rows, setRows] = useState<Record<number, Row>>({});
  const [busy, setBusy] = useState(false);
  const [india, setIndia] = useState(false);
  const [stat, setStat] = useState<IndiaPayrollSettings>(DEFAULT_INDIA_PAYROLL);
  const active = useMemo(() => employees.filter((e) => (e.status || "active") === "active"), [employees]);

  useEffect(() => {
    if (!open) return;
    setRows(Object.fromEntries(active.map((e) => [e.id, { basic: e.salary || 0, allowances: 0, deductions: 0, unpaidDays: 0, include: true }])));
    hr.payroll().then(setRecorded).catch(() => setRecorded([]));
    billing.getCompany().then((c) => setIndia(!!c && companyCountry(c) === "IN")).catch(() => setIndia(false));
    tools.settings().then((s) => setStat(parseIndiaPayroll(s.find((r) => r.key === INDIA_PAYROLL_KEY)?.value))).catch(() => {});
  }, [open, active]);

  const saveStat = (next: IndiaPayrollSettings) => {
    setStat(next);
    tools.setSetting(INDIA_PAYROLL_KEY, JSON.stringify(next)).catch((e) => toast.error(e instanceof Error ? e.message : String(e)));
  };

  const done = (id: number) => recorded.some((p) => Number(p.employee_id) === id && p.period === month);
  const lines = active.map((e) => {
    const row = rows[e.id] ?? { basic: e.salary || 0, allowances: 0, deductions: 0, unpaidDays: 0, include: true };
    const leave = leaveDeduction(row.basic, row.unpaidDays, month);
    const auto = statutoryDeductions({ employeeId: e.id, basic: r2(row.basic - leave), gross: r2(row.basic - leave + row.allowances), month, settings: stat });
    const s = india ? { pf: row.pf ?? auto.pf, esi: row.esi ?? auto.esi, pt: row.pt ?? auto.pt } : { pf: 0, esi: 0, pt: 0 };
    const deductions = r2(row.deductions + leave + s.pf + s.esi + s.pt);
    return { e, row, leave, s, auto, deductions, net: r2(row.basic + row.allowances - deductions), paid: done(e.id) };
  });
  const toRun = lines.filter((l) => l.row.include && !l.paid);
  const total = r2(toRun.reduce((s, l) => s + l.net, 0));
  const employerPf = toRun.reduce((s, l) => s + (l.row.pf === undefined ? l.auto.employerPf : l.s.pf), 0);
  const employerEsi = toRun.reduce((s, l) => s + (l.s.esi ? l.auto.employerEsi : 0), 0);
  const set = (id: number, patch: Partial<Row>) => setRows({ ...rows, [id]: { ...rows[id], ...patch } });

  const run = async () => {
    if (!toRun.length || busy) return;
    const ok = await confirm({
      title: `Run payroll for ${month}?`,
      message: `${toRun.length} employee${toRun.length === 1 ? "" : "s"}, net ${aed(total)}. Each one posts to your accounts as a salary expense, like a saved payslip.`,
      confirmLabel: "Run payroll",
    });
    if (!ok) return;
    setBusy(true);
    const failed: string[] = [];
    const splits: Record<string, DeductionBreakdown> = {};
    for (const l of toRun) {
      try {
        await hr.runPayroll(l.e.id, month, l.row.basic, l.row.allowances, l.deductions);
        if (india) splits[breakdownKey(l.e.id, month)] = { ...l.s, leave: l.leave, other: l.row.deductions };
      } catch (err) { failed.push(`${l.e.name}: ${err instanceof Error ? err.message : err}`); }
    }
    // The split only labels payslip lines; losing it never changes the recorded totals.
    void saveBreakdowns(splits).catch(() => {});
    setBusy(false);
    if (failed.length) toast.error(`Recorded ${toRun.length - failed.length} of ${toRun.length}. ${failed.join("; ")}`);
    else toast.success(`Payroll recorded for ${toRun.length} employee${toRun.length === 1 ? "" : "s"}.`);
    onDone();
    if (!failed.length) onClose();
  };

  const cur = getDisplayCurrency();
  const money = (id: number, key: "basic" | "allowances" | "deductions", value: number, label: string, disabled: boolean) =>
    <input aria-label={label} type="number" min="0" step="any" className="input h-9 w-28 text-right" disabled={disabled || busy}
      value={value || ""} onChange={(ev) => set(id, { [key]: numInput(ev.target.value) })} />;
  const toggleSkip = (id: number, key: StatutoryKey) => {
    const list = new Set(stat.skip[String(id)] ?? []);
    if (list.has(key)) list.delete(key); else list.add(key);
    saveStat({ ...stat, skip: { ...stat.skip, [String(id)]: [...list] } });
  };

  return <Modal open={open} onClose={onClose} title="Run payroll" size="3xl">
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div>
        <label htmlFor="payroll-month" className="label">Month</label>
        <input id="payroll-month" type="month" className="input w-44" value={month} disabled={busy} onChange={(e) => setMonth(e.target.value)} />
      </div>
      <p className="max-w-md text-xs text-muted-foreground">Changes here are for this month only; saved salaries stay as they are. Unpaid days come off the basic pro rata ({daysIn(month)} days this month).</p>
    </div>
    {india && <details className="mb-3 rounded-xl border border-border p-3 text-sm">
      <summary className="cursor-pointer font-medium">PF, ESI and professional tax</summary>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={stat.pf} onChange={(e) => saveStat({ ...stat, pf: e.target.checked })} /> Deduct EPF (12%)</label>
        <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={stat.pfCeiling} disabled={!stat.pf} onChange={(e) => saveStat({ ...stat, pfCeiling: e.target.checked })} /> On wages up to ₹15,000 only</label>
        <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={stat.esi} onChange={(e) => saveStat({ ...stat, esi: e.target.checked })} /> Deduct ESI (0.75%, gross up to ₹21,000)</label>
        <div className="w-52"><SelectMenu ariaLabel="Professional tax state" value={stat.ptState} onChange={(v) => saveStat({ ...stat, ptState: v })}
          options={[{ value: "", label: "No professional tax" }, ...PT_STATES.map((s) => ({ value: s, label: `PT: ${s}` }))]} /></div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Slabs change from time to time: check them with your state, and change any amount in the table. Leave someone out of a deduction below (for example women earning up to ₹25,000 in Maharashtra pay no PT).</p>
      {active.length > 0 && <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">{active.map((e) => <span key={e.id} className="text-xs">
        <span className="font-medium text-ink">{e.name}:</span>{STAT.map(([k, label]) => <label key={k} className="ml-2 inline-flex items-center gap-1">
          <input type="checkbox" aria-label={`Deduct ${label} for ${e.name}`} checked={!(stat.skip[String(e.id)] ?? []).includes(k)} onChange={() => toggleSkip(e.id, k)} />{label}</label>)}
      </span>)}</div>}
    </details>}
    {active.length === 0 ? <p className="text-sm text-muted-foreground">No active employees.</p> :
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className={`w-full text-sm ${india ? "min-w-[1080px]" : "min-w-[820px]"}`}>
          <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-medium">Pay</th><th className="px-3 py-2 font-medium">Employee</th>
            <th className="px-3 py-2 text-right font-medium">Basic ({cur})</th><th className="px-3 py-2 text-right font-medium">Allowances</th>
            <th className="px-3 py-2 text-right font-medium">{india ? "Other deductions" : "Deductions"}</th><th className="px-3 py-2 text-right font-medium">Unpaid days</th>
            {india && STAT.map(([k, label]) => <th key={k} className="px-3 py-2 text-right font-medium">{label}</th>)}
            <th className="px-3 py-2 text-right font-medium">Net pay</th>
          </tr></thead>
          <tbody>{lines.map(({ e, row, s, deductions, net, paid }) => <tr key={e.id} className="border-b border-border last:border-0">
            <td className="px-3 py-2"><input type="checkbox" className="h-4 w-4" aria-label={`Pay ${e.name}`} checked={row.include && !paid} disabled={paid || busy}
              onChange={(ev) => set(e.id, { include: ev.target.checked })} /></td>
            <td className="px-3 py-2"><span className="font-medium text-ink">{e.name}</span>{paid && <span className="ml-2 text-xs text-success">Already recorded</span>}</td>
            <td className="px-3 py-2 text-right">{money(e.id, "basic", row.basic, `Basic for ${e.name}`, paid)}</td>
            <td className="px-3 py-2 text-right">{money(e.id, "allowances", row.allowances, `Allowances for ${e.name}`, paid)}</td>
            <td className="px-3 py-2 text-right">{money(e.id, "deductions", row.deductions, `Deductions for ${e.name}`, paid)}
              {deductions !== row.deductions && <p className="text-[11px] text-muted-foreground">{aed(deductions)} in all</p>}</td>
            <td className="px-3 py-2 text-right"><input aria-label={`Unpaid days for ${e.name}`} type="number" min="0" max={daysIn(month)} step="0.5"
              className="input h-9 w-20 text-right" disabled={paid || busy} value={row.unpaidDays || ""} onChange={(ev) => set(e.id, { unpaidDays: numInput(ev.target.value) })} /></td>
            {india && STAT.map(([k, label]) => <td key={k} className="px-3 py-2 text-right">
              <input aria-label={`${label} for ${e.name}`} type="number" min="0" step="any" className="input h-9 w-20 text-right" disabled={paid || busy}
                value={s[k] || ""} onChange={(ev) => set(e.id, { [k]: numInput(ev.target.value) })} /></td>)}
            <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink">{aed(net)}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
      <div>
        <p className="text-sm text-muted-foreground">{toRun.length} to pay · total net <span className="font-semibold text-ink">{aed(total)}</span></p>
        {india && (employerPf > 0 || employerEsi > 0) && <p className="text-xs text-muted-foreground">Employer share to deposit as well (not taken from pay): EPF {aed(employerPf)} · ESI {aed(employerEsi)}</p>}
      </div>
      <div className="flex gap-2">
        <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn-primary" onClick={() => { void run(); }} disabled={busy || !toRun.length}>{busy ? "Recording…" : "Run payroll"}</button>
      </div>
    </div>
  </Modal>;
}
