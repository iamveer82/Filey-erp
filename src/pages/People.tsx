import { useEffect, useState } from "react";
import {
  Plus,
  Users,
  UserCheck,
  CalendarOff,
  Wallet,
  MoreHorizontal,
  Sliders,
} from "lucide-react";
import { format } from "date-fns";
import { hr, Employee, HrSummary } from "../lib/api";
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setError("");
    return Promise.all([hr.employees().then(setEmps), hr.summary().then(setSum)])
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <MetricCard
          label="Headcount"
          value={num(sum?.headcount ?? emps.length)}
          icon={<Users size={20} />}
        />
        <MetricCard
          label="Present Today"
          value={num(sum?.present_today ?? 0)}
          icon={<UserCheck size={20} />}
          iconClass="bg-success/15 text-success"
        />
        <MetricCard
          label="On Leave"
          value={num(sum?.on_leave ?? 0)}
          icon={<CalendarOff size={20} />}
          iconClass="bg-secondary-400/20 text-secondary-600"
        />
        <MetricCard
          label="Monthly Payroll"
          value={aed(sum?.monthly_payroll ?? 0)}
          icon={<Wallet size={20} />}
          iconClass="bg-info/15 text-info"
        />
      </div>

      {!loading && emps.length === 0 && (
        <div className="empty-gradient rounded-3xl p-10 mb-4 flex flex-col items-center gap-4 text-center">
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
                    className="rounded-3xl p-1.5 text-brand-400 hover:bg-brand-50 hover:text-ink dark:hover:bg-white/5 dark:hover:text-[#F4F5F6] cursor-pointer transition-colors duration-200"
                  >
                    <MoreHorizontal size={16} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setLeaveFor(e)}>
                    <CalendarOff size={14} /> Mark leave days
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
    </div>
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
          <input
            type="date"
            className="input"
            value={f.hire_date}
            onChange={(e) => setF({ ...f, hire_date: e.target.value })}
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
