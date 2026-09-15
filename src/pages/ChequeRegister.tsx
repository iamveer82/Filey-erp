import { useEffect, useMemo, useState, useRef } from "react";
import {
  Plus,
  Check,
  Paperclip,
} from "lucide-react";
import { useUI } from "../lib/ui";
import { nextLocalId } from "../lib/recordId";
import { aed, fmtDate, numInput, todayYmd, errMsg } from "../lib/format";
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
import { tools, getCacheScope } from "../lib/api";
import { assertWorkspaceCurrent, getDataMode } from "../lib/dataMode";
import { useLiveSync } from "../lib/realtime";
import { saveOutput, listFiles, fileObjectUrl } from "../lib/files";
import { SelectMenu } from "../components/ui-menu";

/* ------------------------------------------------------------------ */
/*  Cheque Register — issued & received cheques                        */
/* ------------------------------------------------------------------ */

const CHEQUE_KEY = "filey_cheques"; // device-local cache
const CHEQUE_SETTING_KEY = "cheque_register"; // app_settings - synced + backed up
const cacheKey = () => {
  try { assertWorkspaceCurrent(); } catch { return null; }
  const scope = getCacheScope();
  return scope ? `${CHEQUE_KEY}:${encodeURIComponent(`${getDataMode() ?? "cloud"}:${scope}`)}` : null;
};

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
  /** Scan or photo of the physical cheque, held in My Files and referenced by
   *  id. The register itself is a JSON app-setting that syncs between devices,
   *  so the image deliberately does not live inside the record — a few cheque
   *  photos inlined as data URLs would be carried on every sync. */
  attachment?: { id: string; name: string };
}

function loadCheques(): Cheque[] {
  try {
    const key = cacheKey();
    return key ? JSON.parse(localStorage.getItem(key) || "[]") : [];
  } catch (e) {
    console.warn("Failed to load cheques", e);
    return [];
  }
}
async function saveCheques(rows: Cheque[], expectedKey: string | null) {
  if (!expectedKey || cacheKey() !== expectedKey) throw new Error("Workspace changed. Reopen this section before saving.");
  await tools.setSetting(CHEQUE_SETTING_KEY, JSON.stringify(rows));
  if (cacheKey() !== expectedKey) throw new Error("Workspace changed while saving. Reopen this section to review the result.");
  // The durable store is authoritative. Failure of its disposable mirror does
  // not turn a completed write into a failed save.
  try { localStorage.setItem(expectedKey, JSON.stringify(rows)); }
  catch { /* Rebuilt from app_settings on the next load. */ }
}

/** Pull cheques saved on the user's other devices; remote wins when present. */
async function syncCheques(): Promise<Cheque[]> {
  const key = cacheKey();
  if (!key) return [];
  try {
    const settings = await tools.settings();
    if (cacheKey() !== key) return [];
    const row = settings.find((s) => s.key === CHEQUE_SETTING_KEY);
    if (row?.value) {
      const remote: Cheque[] = JSON.parse(row.value);
      localStorage.setItem(key, JSON.stringify(remote));
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
  const [screenScope] = useState(cacheKey);
  const writing = useRef(false);
  const [saving, setSaving] = useState(false);
  const persist = async (next: Cheque[], message: string): Promise<boolean> => {
    if (writing.current) return false;
    writing.current = true; setSaving(true);
    try {
      await saveCheques(next, screenScope);
      setCheques(next); toast.success(message); return true;
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); return false; }
    finally { writing.current = false; setSaving(false); }
  };
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Cheque | null>(null);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [quickView, setQuickView] = useState<Cheque | null>(null);

  useEffect(() => {
    setCheques(loadCheques()); // instant paint from the local cache…
    syncCheques().then(setCheques); // …then reconcile with other devices
  }, []);
  useLiveSync(() => { void syncCheques().then(setCheques); });

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
    void persist(next, "Deleted.");
  };

  const markCleared = (c: Cheque) => {
    const next = cheques.map((x) =>
      x.id === c.id ? { ...x, status: "cleared" as const } : x
    );
    void persist(next, "Marked as cleared.");
  };

  const editCheque = (c: Cheque) => {
    setEdit(c);
    setOpen(true);
  };

  const duplicate = (c: Cheque) => {
    const copy: Cheque = {
      ...c,
      id: nextLocalId(cheques),
      created_at: new Date().toISOString(),
    };
    const next = [...cheques, copy];
    void persist(next, "Cheque duplicated.");
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
    <div className="">
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
            <Plus size={16} /> New cheque
          </button>
        }
      />
      <div className="grid grid-cols-1 sm:grid-cols-3 joined-kpis mb-6">
        <MetricCard
          label="Pending Issued"
          value={aed(totals.issued)}
          change={totals.issued > 0 ? "Not yet cleared" : "None outstanding"}
          changeTone={totals.issued > 0 ? "warn" : "up"}
        />
        <MetricCard
          label="Pending Received"
          value={aed(totals.received)}
          change={totals.received > 0 ? "Awaiting deposit" : "None outstanding"}
          changeTone={totals.received > 0 ? "warn" : "up"}
        />
        <MetricCard
          label="Cleared"
          value={aed(totals.cleared)}
          change={totals.cleared > 0 ? "Settled at the bank" : "None yet"}
          changeTone="up"
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
        pageSize={10}
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
                    className="btn-ghost w-10 p-0 text-success hover:bg-success/10"
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
          saving={saving}
          onClose={() => { if (!saving) setOpen(false); }}
          onSaved={async (c) => {
            const next = edit
              ? cheques.map((x) => (x.id === c.id ? c : x))
              : [
                  ...cheques,
                  { ...c, id: nextLocalId(cheques), created_at: new Date().toISOString() },
                ];
            if (await persist(next, edit ? "Updated." : "Cheque added.")) setOpen(false);
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
  saving,
}: {
  open: boolean;
  edit: Cheque | null;
  onClose: () => void | Promise<void>;
  saving: boolean;
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
    <Modal open={open} onClose={onClose} title={edit ? "Edit Cheque" : "New cheque"}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Cheque Number *">
          <input
            className="input"
            value={f.cheque_no}
            onChange={(e) => setF({ ...f, cheque_no: e.target.value })}
          />
        </Field>
        <Field label="Type">
          <SelectMenu
            ariaLabel="Type"
            value={f.type}
            onChange={(type) => setF({ ...f, type: type as any })}
            options={[
              { value: "issued", label: "Issued" },
              { value: "received", label: "Received" },
            ]}
          />
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
          <SelectMenu
            ariaLabel="Status"
            value={f.status}
            onChange={(status) => setF({ ...f, status: status as any })}
            options={[
              { value: "pending", label: "Pending" },
              { value: "cleared", label: "Cleared" },
              { value: "bounced", label: "Bounced" },
              { value: "cancelled", label: "Cancelled" },
            ]}
          />
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

      <ChequeAttachment
        value={f.attachment}
        chequeNo={f.cheque_no}
        onChange={(attachment) => setF({ ...f, attachment })}
      />
      <div className="flex flex-wrap justify-end gap-2 mt-5 border-t border-border pt-4">
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn-primary"
          disabled={!valid || saving}
          onClick={() => void onSaved(f as Cheque)}
        >
          {saving ? "Saving…" : edit ? "Save changes" : "Create cheque"}
        </button>
      </div>
    </Modal>
  );
}

/** Upload and preview the cheque's scan.
 *
 *  The file goes to My Files (the same store the PDF tools and generated
 *  documents use, which works in both cloud and offline mode), and the record
 *  keeps only its id. Accepts a photo or a scanned PDF, which is what actually
 *  arrives — a phone picture of a cheque, or a bank's PDF advice. */
function ChequeAttachment({
  value,
  chequeNo,
  onChange,
}: {
  value?: { id: string; name: string };
  chequeNo: string;
  onChange: (v: { id: string; name: string } | undefined) => void;
}) {
  const { toast } = useUI();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  // Resolve the stored id to a viewable URL. Storage links are signed and
  // short-lived, so this resolves on open rather than being persisted.
  useEffect(() => {
    let alive = true;
    setPreview(null);
    if (!value?.id) return;
    void (async () => {
      try {
        const file = (await listFiles()).find((x) => x.id === value.id);
        const url = file ? await fileObjectUrl(file) : null;
        if (alive) setPreview(url);
      } catch {
        /* the link is a convenience — the record is still attached */
      }
    })();
    return () => {
      alive = false;
    };
  }, [value?.id]);

  const pick = async (file: File) => {
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const ext = file.name.split(".").pop() || "jpg";
      const name = `cheque-${(chequeNo || "scan").replace(/[^\w-]+/g, "")}-${Date.now()}.${ext}`;
      const id = await saveOutput({ name, bytes }, "Cheque");
      onChange({ id, name });
      toast.success("Cheque scan attached.");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3">
      <span className="label">Cheque scan (image or PDF)</span>
      {value ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3">
          {preview ? (
            <a href={preview} target="_blank" rel="noreferrer" aria-label="View cheque scan" className="shrink-0">
              <img
                src={preview}
                alt=""
                className="h-12 w-16 rounded object-cover border border-border"
                // A PDF has no thumbnail; fall back to the file chip alone.
                onError={(e) => (e.currentTarget.style.display = "none")}
              />
            </a>
          ) : null}
          <span className="flex-1 min-w-0 truncate text-[13px] text-foreground">
            {value.name}
          </span>
          {preview && (
            <a href={preview} target="_blank" rel="noreferrer" className="btn-ghost">
              View
            </a>
          )}
          <button
            className="btn-ghost text-danger"
            onClick={() => onChange(undefined)}
          >
            Remove
          </button>
        </div>
      ) : (
        <label className="relative flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-[13px] text-muted-foreground hover:border-brand-300 hover:text-foreground focus-within:ring-2 focus-within:ring-ring">
          <Paperclip size={15} />
          {busy ? "Uploading…" : "Attach a photo or PDF of the cheque"}
          <input
            type="file"
            accept="image/*,application/pdf"
            className="sr-only"
            aria-label="Attach cheque scan"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void pick(file);
              e.target.value = "";
            }}
          />
        </label>
      )}
    </div>
  );
}
