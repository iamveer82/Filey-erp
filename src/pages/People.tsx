import { useEffect, useRef, useState } from "react";
import {
  Plus,
  Users,
  UserCheck,
  CalendarOff,
  Wallet,
  MoreHorizontal,
  Sliders,
  FileText,
} from "lucide-react";
import { format } from "date-fns";
import { hr, billing, Employee, HrSummary, CompanyProfile } from "../lib/api";
import { downloadElementAsPdf } from "../lib/pdfTools";
import { useLiveSync } from "../lib/realtime";
import { useUI } from "../lib/ui";
import { aed, num, fmtDate, numInput, cn, getDisplayCurrency } from "../lib/format";
import { CustomFieldsManager } from "../components/CustomFieldsManager";
import {
  PageHeader,
  MetricCard,
  DataTable,
  Badge,
  statusTone,
  Modal,
  Field,
  ErrorBanner,
} from "../components/ui";
import { DateField } from "../components/DatePicker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/DropdownMenu";
import MultiDatePicker from "../components/MultiDatePicker";

export default function People() {
  const { toast } = useUI();
  const [emps, setEmps] = useState<Employee[]>([]);
  const [sum, setSum] = useState<HrSummary | null>(null);
  const [open, setOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [leaveFor, setLeaveFor] = useState<Employee | null>(null);
  const [payslipFor, setPayslipFor] = useState<Employee | null>(null);
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setError("");
    return Promise.all([
      hr.employees().then(setEmps),
      hr.summary().then(setSum),
      billing.getCompany().then(setCompany).catch(() => {}),
    ])
      .catch((e) =>
        setError(`Could not load people: ${e instanceof Error ? e.message : e}`)
      )
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, []);
  useLiveSync(load);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="People"
        subtitle="Employees, attendance & payroll"
        action={
          <div className="flex gap-2 flex-wrap">
            <button className="btn-ghost" onClick={() => setManageOpen(true)}>
              <Sliders size={15} /> Customize fields
            </button>
            <button className="btn-primary" onClick={() => setOpen(true)}>
              <Plus size={16} /> Add employee
            </button>
          </div>
        }
      />
      <CustomFieldsManager
        open={manageOpen}
        onOpenChange={setManageOpen}
        module="employees"
        sampleValues={{ visa_status: "Active", emirates_id: "784-..." }}
      />

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 joined-kpis mb-4">
        <MetricCard
          label="Headcount"
          value={num(sum?.headcount ?? emps.length)}
          icon={<Users size={20} />}
          iconClass="bg-primary-100 text-ink"
          change={`${emps.filter((e) => e.status === "active").length} active`}
          changeTone="up"
        />
        <MetricCard
          label="Present Today"
          value={num(sum?.present_today ?? 0)}
          icon={<UserCheck size={20} />}
          iconClass="bg-success/15 text-success"
          change={sum?.present_today ? "Checked in" : "None yet"}
          changeTone={sum?.present_today ? "up" : "warn"}
        />
        <MetricCard
          label="On Leave"
          value={num(sum?.on_leave ?? 0)}
          icon={<CalendarOff size={20} />}
          iconClass="bg-secondary-400/20 text-secondary-600"
          change={sum?.on_leave ? "Absent" : "All present"}
          changeTone={sum?.on_leave ? "warn" : "up"}
        />
        <MetricCard
          label="Monthly Payroll"
          value={aed(sum?.monthly_payroll ?? 0)}
          icon={<Wallet size={20} />}
          iconClass="bg-info/15 text-info"
          change="Total cost"
          changeTone="up"
        />
      </div>

      {!loading && emps.length === 0 && (
        <div className="empty-gradient rounded-xl p-10 mb-4 flex flex-col items-center gap-4 text-center">
          <svg
            width="100"
            height="80"
            viewBox="0 0 100 80"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="opacity-70"
          >
            <circle
              cx="36"
              cy="28"
              r="12"
              fill="#FFF3C4"
              stroke="#E0AE00"
              strokeWidth="1.5"
            />
            <circle cx="34" cy="26" r="3" fill="#B88C00" />
            <path
              d="M18 52c0-6.6 5.4-12 12-12h8c6.6 0 12 5.4 12 12v2H18v-2z"
              fill="#FFF3C4"
              stroke="#E0AE00"
              strokeWidth="1.5"
            />
            <circle
              cx="64"
              cy="28"
              r="12"
              fill="#FFF3C4"
              stroke="#E0AE00"
              strokeWidth="1.5"
            />
            <circle cx="62" cy="26" r="3" fill="#B88C00" />
            <path
              d="M46 52c0-6.6 5.4-12 12-12h8c6.6 0 12 5.4 12 12v2H46v-2z"
              fill="#FFF3C4"
              stroke="#E0AE00"
              strokeWidth="1.5"
            />
            <circle
              cx="50"
              cy="68"
              r="7"
              fill="#FFFBEB"
              stroke="#E0AE00"
              strokeWidth="1.5"
            />
            <path
              d="M47.5 68l1.7 1.7 3.3-3.3"
              stroke="#B88C00"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div>
            <p className="text-sm font-medium text-brand-700">No employees yet</p>
            <p className="text-xs text-brand-500 mt-1">
              Add your first team member to start tracking attendance and payroll.
            </p>
          </div>
        </div>
      )}

      <DataTable<Employee>
        rows={emps}
        loading={loading}
        empty="No employees yet"
        columns={[
          {
            key: "code",
            label: "Code",
            sortValue: (e) => e.employee_code,
            render: (e) => (
              <span className="font-mono text-xs text-brand-500">{e.employee_code}</span>
            ),
          },
          {
            key: "name",
            label: "Name",
            sortValue: (e) => e.name,
            render: (e) => (
              <div>
                <p className="font-medium text-ink">{e.name}</p>
                <p className="text-[11px] text-brand-400">{e.email ?? "—"}</p>
              </div>
            ),
          },
          {
            key: "dept",
            label: "Department",
            sortValue: (e) => e.department ?? "",
            render: (e) => e.department ?? "—",
          },
          {
            key: "pos",
            label: "Position",
            sortValue: (e) => e.position ?? "",
            render: (e) => e.position ?? "—",
          },
          {
            key: "salary",
            label: "Salary",
            sortValue: (e) => e.salary,
            render: (e) => aed(e.salary),
          },
          {
            key: "hired",
            label: "Hired",
            sortValue: (e) => e.hire_date ?? "",
            render: (e) => fmtDate(e.hire_date),
          },
          {
            key: "status",
            label: "Status",
            sortValue: (e) => e.status ?? "",
            render: (e) => (
              <button
                onClick={async () => {
                  try {
                    await hr.setEmployeeStatus(
                      e.id,
                      e.status === "active" ? "inactive" : "active"
                    );
                    load();
                  } catch (err: any) {
                    toast.error(err?.message || "Failed to toggle status");
                  }
                }}
                title="Toggle status"
                className="cursor-pointer"
              >
                <Badge tone={statusTone(e.status)}>{e.status}</Badge>
              </button>
            ),
          },
          {
            key: "act",
            label: "",
            render: (e) => (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label={`Actions for ${e.name}`}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-hover hover:text-foreground cursor-pointer transition-colors duration-200"
                  >
                    <MoreHorizontal size={16} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setLeaveFor(e)}>
                    <CalendarOff size={14} /> Mark leave days
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setPayslipFor(e)}>
                    <FileText size={14} /> Payslip
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ),
          },
        ]}
      />

      <LeaveModal
        employee={leaveFor}
        onClose={() => setLeaveFor(null)}
        onSaved={() => {
          setLeaveFor(null);
          load();
        }}
      />

      <EmployeeModal
        open={open}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          load();
        }}
      />

      <PayslipModal
        employee={payslipFor}
        company={company}
        onClose={() => setPayslipFor(null)}
      />
    </div>
  );
}

function PayslipModal({
  employee,
  company,
  onClose,
}: {
  employee: Employee | null;
  company: CompanyProfile | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [allowances, setAllowances] = useState(0);
  const [deductions, setDeductions] = useState(0);
  useEffect(() => {
    if (employee) {
      setAllowances(0);
      setDeductions(0);
      setMonth(new Date().toISOString().slice(0, 7));
    }
  }, [employee]);
  if (!employee) return null;

  const basic = employee.salary || 0;
  const net = basic + allowances - deductions;
  const periodLabel = new Date(month + "-01").toLocaleDateString("en", {
    month: "long",
    year: "numeric",
  });
  const download = () => {
    const el = ref.current?.querySelector(".invoice-print") as HTMLElement | null;
    if (el) downloadElementAsPdf(el, `Payslip-${employee.name}-${month}`);
    else window.print();
  };

  return (
    <Modal open={!!employee} onClose={onClose} title={`Payslip — ${employee.name}`}>
      <div className="grid grid-cols-3 joined-kpis mb-4 no-print">
        <Field label="Month">
          <input
            type="month"
            className="input"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </Field>
        <Field label={`Allowances (${getDisplayCurrency()})`}>
          <input
            type="number"
            className="input"
            value={allowances || ""}
            onChange={(e) => setAllowances(numInput(e.target.value))}
          />
        </Field>
        <Field label={`Deductions (${getDisplayCurrency()})`}>
          <input
            type="number"
            className="input"
            value={deductions || ""}
            onChange={(e) => setDeductions(numInput(e.target.value))}
          />
        </Field>
      </div>

      <div ref={ref}>
        <div className="invoice-print bg-white text-black rounded-xl border border-brand-200 p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              {company?.logo && (
                <img src={company.logo} alt="" className="h-10 mb-2 object-contain" />
              )}
              <p className="font-semibold text-lg">{company?.name || "Company"}</p>
              {company?.address && (
                <p className="text-xs text-gray-500">{company.address}</p>
              )}
              {company?.trn && <p className="text-xs text-gray-500">TRN: {company.trn}</p>}
            </div>
            <div className="text-right">
              <p className="font-semibold tracking-wide">PAYSLIP</p>
              <p className="text-xs text-gray-500">{periodLabel}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1 text-sm border-t border-b border-gray-200 py-3 mb-3">
            <div>
              <span className="text-gray-500">Employee: </span>
              {employee.name}
            </div>
            <div>
              <span className="text-gray-500">Code: </span>
              {employee.employee_code || "—"}
            </div>
            <div>
              <span className="text-gray-500">Department: </span>
              {employee.department || "—"}
            </div>
            <div>
              <span className="text-gray-500">Position: </span>
              {employee.position || "—"}
            </div>
          </div>
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-gray-100">
                <td className="py-1.5">Basic Salary</td>
                <td className="py-1.5 text-right tabular-nums">{aed(basic)}</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-1.5">Allowances</td>
                <td className="py-1.5 text-right tabular-nums">{aed(allowances)}</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-1.5">Deductions</td>
                <td className="py-1.5 text-right tabular-nums">{aed(-deductions)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="py-2">Net Pay</td>
                <td className="py-2 text-right tabular-nums">{aed(net)}</td>
              </tr>
            </tfoot>
          </table>
          <p className="text-[11px] text-gray-400 mt-6">
            Computer-generated payslip — no signature required.
          </p>
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-4 no-print">
        <button className="btn-ghost" onClick={onClose}>
          Close
        </button>
        <button className="btn-primary" onClick={download}>
          <FileText size={15} /> Download PDF
        </button>
      </div>
    </Modal>
  );
}

function EmployeeModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useUI();
  const [f, setF] = useState({
    employee_code: "",
    name: "",
    email: "",
    phone: "",
    department: "",
    position: "",
    salary: 0,
    hire_date: new Date().toISOString().slice(0, 10),
  });
  useEffect(() => {
    if (open)
      setF({
        employee_code: "",
        name: "",
        email: "",
        phone: "",
        department: "",
        position: "",
        salary: 0,
        hire_date: new Date().toISOString().slice(0, 10),
      });
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="Add Employee">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Employee Code">
          <input
            className="input"
            value={f.employee_code}
            onChange={(e) => setF({ ...f, employee_code: e.target.value })}
          />
        </Field>
        <Field label="Full Name *">
          <input
            className={cn("input", !f.name.trim() && "border-danger")}
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
          {!f.name.trim() && (
            <p className="text-[11px] text-danger mt-1">Name is required.</p>
          )}
        </Field>
        <Field label="Email">
          <input
            className="input"
            value={f.email}
            onChange={(e) => setF({ ...f, email: e.target.value })}
          />
        </Field>
        <Field label="Phone">
          <input
            className="input"
            value={f.phone}
            onChange={(e) => setF({ ...f, phone: e.target.value })}
          />
        </Field>
        <Field label="Department">
          <input
            className="input"
            value={f.department}
            onChange={(e) => setF({ ...f, department: e.target.value })}
          />
        </Field>
        <Field label="Position">
          <input
            className="input"
            value={f.position}
            onChange={(e) => setF({ ...f, position: e.target.value })}
          />
        </Field>
        <Field label={`Salary (${getDisplayCurrency()})`}>
          <input
            type="number"
            className="input"
            placeholder="0"
            value={f.salary || ""}
            onChange={(e) => setF({ ...f, salary: numInput(e.target.value) })}
          />
        </Field>
        <Field label="Hire Date">
          <DateField
            value={f.hire_date}
            onChange={(v) => setF({ ...f, hire_date: v })}
            clearable={false}
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn-primary"
          disabled={!f.name.trim()}
          onClick={async () => {
            try {
              await hr.createEmployee({
                employee_code: f.employee_code,
                name: f.name,
                email: f.email || undefined,
                phone: f.phone || undefined,
                department: f.department || undefined,
                position: f.position || undefined,
                salary: f.salary,
                hire_date: f.hire_date || undefined,
              } as Omit<Employee, "id" | "status">);
              onSaved();
            } catch (e: any) {
              toast.error(e?.message || "Failed to create employee");
            }
          }}
        >
          Save Employee
        </button>
      </div>
    </Modal>
  );
}

function LeaveModal({
  employee,
  onClose,
  onSaved,
}: {
  employee: Employee | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [dates, setDates] = useState<Date[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (employee) setDates([]);
  }, [employee]);
  if (!employee) return null;
  const save = async () => {
    setBusy(true);
    try {
      for (const d of dates) {
        await hr.markAttendance(employee.id, format(d, "yyyy-MM-dd"), "leave");
      }
      onSaved();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={!!employee} onClose={onClose} title={`Mark leave — ${employee.name}`}>
      <MultiDatePicker value={dates} onChange={setDates} onConfirm={save} />
      <p className="text-xs text-brand-400 mt-3">
        {dates.length === 0
          ? "Pick one or more days to record as leave."
          : `${dates.length} day${dates.length === 1 ? "" : "s"} will be saved as “leave”.`}
      </p>
      {busy && (
        <p className="text-xs font-medium text-brand-500 mt-2">Saving attendance…</p>
      )}
    </Modal>
  );
}
