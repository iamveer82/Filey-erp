import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  BadgeCheck,
  CalendarDays,
  CircleDollarSign,
  Clock,
  FileText,
  Loader2,
  Mail,
  Phone,
  Wallet,
} from "lucide-react";
import {
  hr,
  type Attendance,
  type Employee,
  type Payroll,
} from "../lib/api";
import { aed, cn, errMsg, fmtDate, localYmd } from "../lib/format";
import { useUI } from "../lib/ui";
import CrmRecordPanel from "../components/CrmRecordPanel";

/* Employee record page — the HR counterpart to CustomerDetail.
 *
 * Answers the questions you actually ask about a person: when did they join,
 * what do they earn, has this month's salary gone out, and what does their
 * attendance look like. Payroll and attendance both live in their own tables
 * keyed by employee_id, so everything here is a filter on those. */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="mb-2 text-sm font-medium text-ink">{title}</h2>
      {children}
    </section>
  );
}

function Info({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Mail;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="truncate text-sm text-ink">{value || "—"}</p>
      </div>
    </div>
  );
}

/** Whole months between a start date and today — "2y 3m" reads better than a
 *  raw date when you want to know how long someone has been here. */
function tenure(hireDate?: string): string {
  if (!hireDate) return "—";
  const start = new Date(hireDate + "T00:00:00");
  if (Number.isNaN(+start)) return "—";
  const now = new Date();
  let months =
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months--;
  if (months < 0) return "—";
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y ? `${y}y` : "", m || !y ? `${m}m` : ""].filter(Boolean).join(" ");
}

const STATUS_PILL: Record<string, string> = {
  paid: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  pending: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
};

export default function EmployeeDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { toast, confirm } = useUI();

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [payroll, setPayroll] = useState<Payroll[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  const empId = Number(id);

  const load = useCallback(async () => {
    try {
      const [emps, pay, att] = await Promise.all([
        hr.employees(),
        hr.payroll(),
        hr.attendance(),
      ]);
      setEmployee(emps.find((e) => e.id === empId) ?? null);
      setPayroll(pay.filter((p) => Number(p.employee_id) === empId));
      setAttendance(att.filter((a) => Number(a.employee_id) === empId));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setLoading(false);
    }
    // toast identity changes every render — including it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empId]);

  useEffect(() => {
    load();
  }, [load]);

  const sortedPayroll = useMemo(
    // period is YYYY-MM, so a plain string sort is chronological.
    () => [...payroll].sort((a, b) => (a.period < b.period ? 1 : -1)),
    [payroll]
  );

  const totals = useMemo(() => {
    const paid = payroll.filter((p) => p.status === "paid");
    return {
      paidCount: paid.length,
      paidTotal: paid.reduce((s, p) => s + Number(p.net_pay || 0), 0),
      pending: payroll.filter((p) => p.status !== "paid"),
    };
  }, [payroll]);

  const recentAttendance = useMemo(
    () => [...attendance].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 30),
    [attendance]
  );

  const attendanceMix = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of attendance) m[a.status] = (m[a.status] ?? 0) + 1;
    return m;
  }, [attendance]);

  const markPaid = async (p: Payroll) => {
    const paid = p.status !== "paid";
    if (paid) {
      const ok = await confirm({
        title: `Mark ${p.period} salary as paid?`,
        message: `${aed(p.net_pay)} for ${employee?.name ?? "this employee"}, dated ${fmtDate(localYmd(new Date()))}.`,
        confirmLabel: "Mark paid",
      });
      if (!ok) return;
    }
    setBusyId(p.id);
    try {
      await hr.setPayrollPaid(p.id, paid);
      await load();
      toast.success(paid ? "Salary marked paid." : "Moved back to pending.");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading employee…
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="p-6">
        <button
          type="button"
          onClick={() => nav("/people")}
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" /> People
        </button>
        <p className="text-sm text-ink">That employee no longer exists.</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <button
        type="button"
        onClick={() => nav("/people")}
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-transform hover:text-ink active:scale-[0.97]"
      >
        <ArrowLeft className="h-4 w-4" /> People
      </button>

      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold text-ink">{employee.name}</h1>
          <p className="text-sm text-muted-foreground">
            {[employee.position, employee.department].filter(Boolean).join(" · ") ||
              "No role set"}
            {employee.employee_code ? ` · ${employee.employee_code}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-xs",
              employee.status === "active"
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-muted text-muted-foreground"
            )}
          >
            {employee.status}
          </span>
          <Link
            to={`/people/${employee.id}/payslip`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm text-ink transition-transform active:scale-[0.97]"
          >
            <FileText className="h-4 w-4" /> Payslip
          </Link>
        </div>
      </header>

      <div className="mb-5 grid grid-cols-2 gap-3 rounded-xl border border-line bg-card p-4 sm:grid-cols-4">
        <Info icon={CalendarDays} label="Joined" value={fmtDate(employee.hire_date)} />
        <Info icon={Clock} label="Tenure" value={tenure(employee.hire_date)} />
        <Info icon={Wallet} label="Monthly salary" value={aed(employee.salary)} />
        <Info
          icon={CircleDollarSign}
          label="Paid to date"
          value={`${aed(totals.paidTotal)} · ${totals.paidCount} run${totals.paidCount === 1 ? "" : "s"}`}
        />
        <Info icon={Mail} label="Email" value={employee.email} />
        <Info icon={Phone} label="Phone" value={employee.phone} />
        <Info
          icon={BadgeCheck}
          label="Attendance logged"
          value={`${attendance.length} day${attendance.length === 1 ? "" : "s"}`}
        />
        <Info
          icon={Clock}
          label="Salary pending"
          value={
            totals.pending.length
              ? `${totals.pending.length} run${totals.pending.length === 1 ? "" : "s"}`
              : "None"
          }
        />
      </div>

      <Section title="Salary history">
        {sortedPayroll.length === 0 ? (
          <p className="rounded-xl border border-line bg-card p-4 text-sm text-muted-foreground">
            No payroll runs for {employee.name} yet. Run payroll from the People
            page and it will show up here.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line bg-card">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Period</th>
                  <th className="px-3 py-2 text-right font-medium">Basic</th>
                  <th className="px-3 py-2 text-right font-medium">Allowances</th>
                  <th className="px-3 py-2 text-right font-medium">Deductions</th>
                  <th className="px-3 py-2 text-right font-medium">Net pay</th>
                  <th className="px-3 py-2 font-medium">Paid on</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {sortedPayroll.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2 text-ink">{p.period}</td>
                    <td className="px-3 py-2 text-right text-ink">{aed(p.basic)}</td>
                    <td className="px-3 py-2 text-right text-ink">{aed(p.allowances)}</td>
                    <td className="px-3 py-2 text-right text-ink">{aed(p.deductions)}</td>
                    <td className="px-3 py-2 text-right font-medium text-ink">
                      {aed(p.net_pay)}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {p.paid_on ? fmtDate(p.paid_on) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => markPaid(p)}
                        disabled={busyId === p.id}
                        title={
                          p.status === "paid"
                            ? "Move back to pending"
                            : "Mark this salary paid"
                        }
                        className={cn(
                          "rounded-full px-2.5 py-1 text-xs transition-transform active:scale-[0.97] disabled:opacity-50",
                          STATUS_PILL[p.status] ?? "bg-muted text-muted-foreground"
                        )}
                      >
                        {busyId === p.id ? "…" : p.status}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Notes & tasks">
        <CrmRecordPanel targetType="employee" targetId={employee.id} />
      </Section>

      <Section title="Attendance">
        {attendance.length === 0 ? (
          <p className="rounded-xl border border-line bg-card p-4 text-sm text-muted-foreground">
            No attendance recorded yet.
          </p>
        ) : (
          <div className="rounded-xl border border-line bg-card p-4">
            <div className="mb-3 flex flex-wrap gap-2">
              {Object.entries(attendanceMix).map(([status, n]) => (
                <span
                  key={status}
                  className="rounded-full bg-bg px-2.5 py-1 text-xs text-muted-foreground"
                >
                  {status}: <span className="text-ink">{n}</span>
                </span>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">In</th>
                    <th className="px-3 py-2 font-medium">Out</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentAttendance.map((a) => (
                    <tr key={a.id} className="border-b border-line last:border-0">
                      <td className="px-3 py-2 text-ink">{fmtDate(a.date)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{a.check_in || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{a.check_out || "—"}</td>
                      <td className="px-3 py-2 text-ink">{a.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {attendance.length > recentAttendance.length && (
              <p className="mt-2 text-xs text-muted-foreground">
                Showing the latest {recentAttendance.length} of {attendance.length} days.
              </p>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
