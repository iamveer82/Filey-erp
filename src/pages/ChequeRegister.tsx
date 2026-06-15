import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Trash2,
  Check,
  Search,
  ArrowUpRight,
  ArrowDownLeft,
  CheckCircle2,
} from "lucide-react";
import { useUI } from "../lib/ui";
import { aed, fmtDate, numInput } from "../lib/format";
import { PageHeader, MetricCard, DataTable, Badge, Modal, Field } from "../components/ui";

/* ------------------------------------------------------------------ */
/*  Cheque Register — issued & received cheques                        */
/* ------------------------------------------------------------------ */

const CHEQUE_KEY = "filey_cheques";

interface Cheque {
  id: number;
  cheque_no: string;
  type: "issued" | "received";
  party: string;
  bank: string;
  amount: number;
  issue_date: string;
  due_date: string;
  status: "pending" | "cleared" | "bounced" | "cancelled";
  notes: string;
  created_at: string;
}

function loadCheques(): Cheque[] {
  try {
    return JSON.parse(localStorage.getItem(CHEQUE_KEY) || "[]");
  } catch (e) {
    console.warn("Failed to load cheques", e);
    return [];
  }
}
function saveCheques(c: Cheque[]) {
  try {
    localStorage.setItem(CHEQUE_KEY, JSON.stringify(c));
  } catch (e) {
    console.warn("Failed to save cheques", e);
  }
}

const statusTone = (s: string) => {
  if (s === "cleared") return "success";
  if (s === "bounced") return "danger";
  if (s === "cancelled") return "neutral";
  return "info";
};

export default function ChequeRegister() {
  const { toast, confirm } = useUI();
  const [cheques, setCheques] = useState<Cheque[]>([]);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Cheque | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    setCheques(loadCheques());
  }, []);

  const filtered = useMemo(
    () =>
      cheques.filter(
        (c) =>
          c.cheque_no.toLowerCase().includes(q.toLowerCase()) ||
          c.party.toLowerCase().includes(q.toLowerCase()) ||
          c.bank.toLowerCase().includes(q.toLowerCase())
      ),
    [cheques, q]
  );

  const totals = useMemo(
    () => ({
      issued: cheques
        .filter((c) => c.type === "issued" && c.status === "pending")
        .reduce((s, c) => s + c.amount, 0),
      received: cheques
        .filter((c) => c.type === "received" && c.status === "pending")
        .reduce((s, c) => s + c.amount, 0),
      cleared: cheques
        .filter((c) => c.status === "cleared")
        .reduce((s, c) => s + c.amount, 0),
    }),
    [cheques]
  );

  const del = async (c: Cheque) => {
    const ok = await confirm({
      title: "Delete cheque",
      message: `Delete cheque #${c.cheque_no}?`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    const next = cheques.filter((x) => x.id !== c.id);
    setCheques(next);
    saveCheques(next);
    toast.success("Deleted.");
  };

  const markCleared = (c: Cheque) => {
    const next = cheques.map((x) =>
      x.id === c.id ? { ...x, status: "cleared" as const } : x
    );
    setCheques(next);
    saveCheques(next);
    toast.success("Marked as cleared.");
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Cheque Register"
        subtitle="Track issued & received cheques"
        action={
          <button
            className="btn-primary"
            onClick={() => {
              setEdit(null);
              setOpen(true);
            }}
          >
            <Plus size={16} /> New Cheque
          </button>
        }
      />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <MetricCard
          label="Pending Issued"
          value={aed(totals.issued)}
          icon={<ArrowUpRight size={20} />}
          iconClass="bg-secondary/20 text-ink"
        />
        <MetricCard
          label="Pending Received"
          value={aed(totals.received)}
          icon={<ArrowDownLeft size={20} />}
          iconClass="bg-info/15 text-info"
        />
        <MetricCard
          label="Cleared"
          value={aed(totals.cleared)}
          icon={<CheckCircle2 size={20} />}
          iconClass="bg-success/15 text-success"
        />
      </div>
      <div className="mb-4">
        <div className="relative w-full max-w-xs">
          <Search
            size={16}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-400"
          />
          <input
            className="input pl-10"
            placeholder="Search cheques…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>
      <DataTable<Cheque>
        rows={filtered}
        empty="No cheques recorded yet"
        columns={[
          {
            key: "no",
            label: "Cheque #",
            sortValue: (c) => c.cheque_no,
            render: (c) => (
              <span className="font-mono text-xs font-medium">{c.cheque_no}</span>
            ),
          },
          {
            key: "type",
            label: "Type",
            sortValue: (c) => c.type,
            render: (c) => (
              <Badge tone={c.type === "issued" ? "warn" : "info"}>{c.type}</Badge>
            ),
          },
          {
            key: "party",
            label: "Party",
            sortValue: (c) => c.party,
            render: (c) => <span className="font-medium">{c.party}</span>,
          },
          {
            key: "bank",
            label: "Bank",
            sortValue: (c) => c.bank,
            render: (c) => <span className="text-brand-500 text-sm">{c.bank}</span>,
          },
          {
            key: "amt",
            label: "Amount",
            sortValue: (c) => c.amount,
            render: (c) => (
              <span className="font-medium tabular-nums">{aed(c.amount)}</span>
            ),
          },
          {
            key: "due",
            label: "Due Date",
            sortValue: (c) => c.due_date,
            render: (c) => {
              const overdue =
                c.status === "pending" &&
                c.due_date < new Date().toISOString().slice(0, 10);
              return (
                <span className={overdue ? "text-danger font-semibold" : ""}>
                  {fmtDate(c.due_date)}
                </span>
              );
            },
          },
          {
            key: "status",
            label: "Status",
            sortValue: (c) => c.status,
            render: (c) => <Badge tone={statusTone(c.status)}>{c.status}</Badge>,
          },
          {
            key: "act",
            label: "",
            render: (c) => (
              <div className="flex items-center gap-1">
                {c.status === "pending" && (
                  <button
                    aria-label={`Mark cheque ${c.cheque_no} cleared`}
                    className="text-success hover:bg-success/10 rounded-lg p-1.5 cursor-pointer transition-colors duration-200"
                    onClick={() => markCleared(c)}
                  >
                    <Check size={15} />
                  </button>
                )}
                <button
                  aria-label={`Delete cheque ${c.cheque_no}`}
                  className="text-danger hover:bg-danger/10 rounded-lg p-1.5 cursor-pointer transition-colors duration-200"
                  onClick={() => del(c)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ),
          },
        ]}
      />
      {open && (
        <ChequeModal
          open={open}
          edit={edit}
          onClose={() => setOpen(false)}
          onSaved={(c) => {
            const next = edit
              ? cheques.map((x) => (x.id === c.id ? c : x))
              : [
                  ...cheques,
                  { ...c, id: Date.now(), created_at: new Date().toISOString() },
                ];
            setCheques(next);
            saveCheques(next);
            setOpen(false);
            toast.success(edit ? "Updated." : "Cheque added.");
          }}
        />
      )}
    </div>
  );
}

function ChequeModal({
  open,
  edit,
  onClose,
  onSaved,
}: {
  open: boolean;
  edit: Cheque | null;
  onClose: () => void;
  onSaved: (c: Cheque) => void;
}) {
  const [f, setF] = useState<Omit<Cheque, "id" | "created_at">>(
    edit || {
      cheque_no: "",
      type: "received",
      party: "",
      bank: "",
      amount: 0,
      issue_date: new Date().toISOString().slice(0, 10),
      due_date: "",
      status: "pending",
      notes: "",
    }
  );
  const valid = f.cheque_no.trim() && f.party.trim() && f.amount > 0;
  return (
    <Modal open={open} onClose={onClose} title={edit ? "Edit Cheque" : "New Cheque"}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Cheque Number *">
          <input
            className="input"
            value={f.cheque_no}
            onChange={(e) => setF({ ...f, cheque_no: e.target.value })}
          />
        </Field>
        <Field label="Type">
          <select
            className="select"
            value={f.type}
            onChange={(e) => setF({ ...f, type: e.target.value as any })}
          >
            <option value="issued">Issued</option>
            <option value="received">Received</option>
          </select>
        </Field>
        <Field label="Party *">
          <input
            className="input"
            value={f.party}
            onChange={(e) => setF({ ...f, party: e.target.value })}
          />
        </Field>
        <Field label="Bank">
          <input
            className="input"
            value={f.bank}
            onChange={(e) => setF({ ...f, bank: e.target.value })}
          />
        </Field>
        <Field label="Amount *">
          <input
            type="number"
            className="input"
            value={f.amount || ""}
            onChange={(e) => setF({ ...f, amount: numInput(e.target.value) })}
          />
        </Field>
        <Field label="Status">
          <select
            className="select"
            value={f.status}
            onChange={(e) => setF({ ...f, status: e.target.value as any })}
          >
            <option value="pending">Pending</option>
            <option value="cleared">Cleared</option>
            <option value="bounced">Bounced</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </Field>
        <Field label="Issue Date">
          <input
            type="date"
            className="input"
            value={f.issue_date}
            onChange={(e) => setF({ ...f, issue_date: e.target.value })}
          />
        </Field>
        <Field label="Due Date">
          <input
            type="date"
            className="input"
            value={f.due_date}
            onChange={(e) => setF({ ...f, due_date: e.target.value })}
          />
        </Field>
      </div>
      <div>
        <Field label="Notes">
          <textarea
            className="textarea"
            rows={2}
            value={f.notes}
            onChange={(e) => setF({ ...f, notes: e.target.value })}
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn-primary"
          disabled={!valid}
          onClick={() => onSaved(f as Cheque)}
        >
          {edit ? "Update" : "Add Cheque"}
        </button>
      </div>
    </Modal>
  );
}
