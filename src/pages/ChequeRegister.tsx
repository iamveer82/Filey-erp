import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Check,
  ArrowUpRight,
  ArrowDownLeft,
  CheckCircle2,
} from "lucide-react";
import { useUI } from "../lib/ui";
import { aed, fmtDate, numInput, todayYmd } from "../lib/format";
import {
  PageHeader,
  MetricCard,
  DataTable,
  Badge,
  Modal,
  Field,
  SearchInput,
  FilterChip,
} from "../components/ui";
import {
  RowActions,
  QuickViewModal,
  shareVia,
  type ShareKind,
} from "../components/RowActions";
import { DateField } from "../components/DatePicker";
import { tools } from "../lib/api";

/* ------------------------------------------------------------------ */
/*  Cheque Register — issued & received cheques                        */
/* ------------------------------------------------------------------ */

const CHEQUE_KEY = "filey_cheques"; // device-local cache
const CHEQUE_SETTING_KEY = "cheque_register"; // app_settings — synced + backed up

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
    try { return JSON.parse(localStorage.getItem(CHEQUE_KEY) || "[]"); } catch { return []; }
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
  // Write-through to app_settings: bare localStorage never syncs across
  // devices and the desktop backup doesn't include it (same as challans).
  void tools.setSetting(CHEQUE_SETTING_KEY, JSON.stringify(c)).catch(() => {});
}

/** Pull cheques saved on the user's other devices; remote wins when present. */
async function syncCheques(): Promise<Cheque[]> {
  try {
    const settings = await tools.settings();
    const row = settings.find((s) => s.key === CHEQUE_SETTING_KEY);
    if (row?.value) {
      const remote: Cheque[] = JSON.parse(row.value);
      localStorage.setItem(CHEQUE_KEY, JSON.stringify(remote));
      return remote;
    }
  } catch (e) {
    console.warn("Failed to sync cheques from server", e);
  }
  return loadCheques();
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
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [quickView, setQuickView] = useState<Cheque | null>(null);

  useEffect(() => {
    setCheques(loadCheques()); // instant paint from the local cache…
    syncCheques().then(setCheques); // …then reconcile with other devices
  }, []);

  const filtered = useMemo(
    () =>
      cheques.filter(
        (c) =>
          (statusFilter === "all" || c.status === statusFilter) &&
          (c.cheque_no.toLowerCase().includes(q.toLowerCase()) ||
            c.party.toLowerCase().includes(q.toLowerCase()) ||
            c.bank.toLowerCase().includes(q.toLowerCase()))
      ),
    [cheques, q, statusFilter]
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

  const editCheque = (c: Cheque) => {
    setEdit(c);
    setOpen(true);
  };

  const duplicate = (c: Cheque) => {
    const copy: Cheque = {
      ...c,
      id: Date.now(),
      created_at: new Date().toISOString(),
    };
    const next = [...cheques, copy];
    setCheques(next);
    saveCheques(next);
    toast.success("Cheque duplicated.");
  };

  // Cheques are device-local records with no public link or stored contact,
  // so sharing sends a plain-text summary (no copy-link).
  const shareCheque = (kind: Exclude<ShareKind, "copyLink">, c: Cheque) => {
    const text = `Cheque #${c.cheque_no} (${c.type})\nParty: ${c.party}\nBank: ${
      c.bank || "—"
    }\nAmount: ${aed(c.amount)}\nDue: ${fmtDate(c.due_date)}\nStatus: ${c.status}`;
    shareVia(kind, { text, url: `Cheque #${c.cheque_no}` });
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
      <div className="grid grid-cols-1 sm:grid-cols-3 joined-kpis mb-6">
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
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <SearchInput
          value={q}
          onChange={setQ}
          placeholder="Search cheques…"
          className="w-full max-w-xs"
        />
        <div className="flex items-center gap-1.5 flex-wrap">
          {(["all", "pending", "cleared", "bounced", "cancelled"] as const).map(
            (s) => (
              <FilterChip
                key={s}
                active={statusFilter === s}
                onClick={() => setStatusFilter(s)}
                count={
                  s === "all"
                    ? cheques.length
                    : cheques.filter((c) => c.status === s).length
                }
              >
                {s === "all" ? "All" : s[0].toUpperCase() + s.slice(1)}
              </FilterChip>
            )
          )}
        </div>
      </div>
      <DataTable<Cheque>
        rows={filtered}
        empty={
          q || statusFilter !== "all"
            ? "No cheques match your filter"
            : "No cheques recorded yet"
        }
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
                !!c.due_date &&
                c.due_date < todayYmd();
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
            label: "Actions",
            render: (c) => (
              <div className="flex items-center justify-end gap-1.5">
                {c.status === "pending" && (
                  <button
                    aria-label={`Mark cheque ${c.cheque_no} cleared`}
                    title="Mark cleared"
                    className="h-7 w-7 grid place-items-center rounded-md text-success hover:bg-success/10 cursor-pointer transition-colors duration-200"
                    onClick={() => markCleared(c)}
                  >
                    <Check size={15} />
                  </button>
                )}
                <RowActions
                  onView={() => setQuickView(c)}
                  onEdit={() => editCheque(c)}
                  onCopy={() => duplicate(c)}
                  onDelete={() => del(c)}
                  onSend={{
                    whatsapp: () => shareCheque("whatsapp", c),
                    email: () => shareCheque("email", c),
                    sms: () => shareCheque("sms", c),
                  }}
                />
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
      <QuickViewModal
        open={!!quickView}
        onClose={() => setQuickView(null)}
        onEdit={
          quickView
            ? () => {
                const c = quickView;
                setQuickView(null);
                editCheque(c);
              }
            : undefined
        }
        data={
          quickView
            ? {
                title: `Cheque #${quickView.cheque_no}`,
                subtitle: quickView.party,
                badge: (
                  <Badge tone={statusTone(quickView.status)}>
                    {quickView.status}
                  </Badge>
                ),
                meta: [
                  {
                    label: "Type",
                    value:
                      quickView.type[0].toUpperCase() + quickView.type.slice(1),
                  },
                  { label: "Party", value: quickView.party },
                  { label: "Bank", value: quickView.bank || "—" },
                  { label: "Issue date", value: fmtDate(quickView.issue_date) },
                  { label: "Due date", value: fmtDate(quickView.due_date) },
                  {
                    label: "Recorded",
                    value: fmtDate((quickView.created_at || "").slice(0, 10)),
                  },
                ],
                total: quickView.amount,
                currency: "AED",
                notes: quickView.notes || undefined,
              }
            : null
        }
      />
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
      issue_date: todayYmd(),
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
          <DateField
            value={f.issue_date}
            onChange={(v) => setF({ ...f, issue_date: v })}
            clearable={false}
          />
        </Field>
        <Field label="Due Date">
          <DateField
            value={f.due_date}
            onChange={(v) => setF({ ...f, due_date: v })}
            clearable={false}
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
