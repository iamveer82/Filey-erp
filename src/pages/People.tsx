import { useEffect, useState } from "react";
import { Plus, Users, UserCheck, CalendarOff, Wallet } from "lucide-react";
import { hr, Employee, HrSummary } from "../lib/api";
import { aed, num, fmtDate } from "../lib/format";
import {
  PageHeader,
  MetricCard,
  DataTable,
  Badge,
  statusTone,
  Modal,
  Field,
} from "../components/ui";

export default function People() {
  const [emps, setEmps] = useState<Employee[]>([]);
  const [sum, setSum] = useState<HrSummary | null>(null);
  const [open, setOpen] = useState(false);

  const load = () => {
    hr.employees().then(setEmps).catch(console.error);
    hr.summary().then(setSum).catch(console.error);
  };
  useEffect(load, []);

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
        ]}
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
            onChange={(e) => setF({ ...f, salary: +e.target.value })}
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
