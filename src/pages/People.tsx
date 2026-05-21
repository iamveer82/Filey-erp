import { useEffect, useState } from "react";
import {
  Plus,
  Users,
  UserCheck,
  CalendarOff,
  Wallet,
  MoreHorizontal,
} from "lucide-react";
import { format } from "date-fns";
import { hr, Employee, HrSummary } from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { aed, num, fmtDate, numInput } from "../lib/format";
import {
  PageHeader,
  MetricCard,
  DataTable,
  Badge,
  statusTone,
  Modal,
  Field,
} from "../components/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/DropdownMenu";
import MultiDatePicker from "../components/MultiDatePicker";

export default function People() {
  const [emps, setEmps] = useState<Employee[]>([]);
  const [sum, setSum] = useState<HrSummary | null>(null);
  const [open, setOpen] = useState(false);
  const [leaveFor, setLeaveFor] = useState<Employee | null>(null);

  const load = () => {
    hr.employees().then(setEmps).catch(console.error);
    hr.summary().then(setSum).catch(console.error);
  };
  useEffect(load, []);
  useLiveSync(load);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="People"
        subtitle="Employees, attendance & payroll"
        action={
          <button className="btn-primary" onClick={() => setOpen(true)}>
            <Plus size={16} /> Add employee
          </button>
        }
      />

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

      <DataTable<Employee>
        rows={emps}
        empty="No employees yet"
        columns={[
          {
            key: "code",
            label: "Code",
            render: (e) => (
              <span className="font-mono text-xs text-brand-500">
                {e.employee_code}
              </span>
            ),
          },
          {
            key: "name",
            label: "Name",
            render: (e) => (
              <div>
                <p className="font-semibold text-ink">{e.name}</p>
                <p className="text-[11px] text-brand-400">
                  {e.email ?? "—"}
                </p>
              </div>
            ),
          },
          {
            key: "dept",
            label: "Department",
            render: (e) => e.department ?? "—",
          },
          {
            key: "pos",
            label: "Position",
            render: (e) => e.position ?? "—",
          },
          {
            key: "salary",
            label: "Salary",
            render: (e) => aed(e.salary),
          },
          {
            key: "hired",
            label: "Hired",
            render: (e) => fmtDate(e.hire_date),
          },
          {
            key: "status",
            label: "Status",
            render: (e) => (
              <button
                onClick={async () => {
                  await hr.setEmployeeStatus(
                    e.id,
                    e.status === "active" ? "inactive" : "active"
                  );
                  load();
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
                    className="rounded-lg p-1.5 text-brand-400 hover:bg-brand-50 hover:text-ink cursor-pointer transition-colors duration-200"
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
        <Field label="Full Name">
          <input
            className="input"
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
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
        <Field label="Salary (AED)">
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
        await hr.markAttendance(
          employee.id,
          format(d, "yyyy-MM-dd"),
          "leave"
        );
      }
      onSaved();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={!!employee}
      onClose={onClose}
      title={`Mark leave — ${employee.name}`}
    >
      <MultiDatePicker value={dates} onChange={setDates} onConfirm={save} />
      <p className="text-xs text-brand-400 mt-3">
        {dates.length === 0
          ? "Pick one or more days to record as leave."
          : `${dates.length} day${dates.length === 1 ? "" : "s"} will be saved as “leave”.`}
      </p>
      {busy && (
        <p className="text-xs font-semibold text-brand-500 mt-2">
          Saving attendance…
        </p>
      )}
    </Modal>
  );
}
