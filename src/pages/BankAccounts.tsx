import { useEffect, useState } from "react";
import { Plus, FileCheck2 } from "lucide-react";
import { useUI } from "../lib/ui";
import { log } from "../lib/log";
import { aed, fmtDate, money, numInput } from "../lib/format";
import {
  PageHeader,
  MetricCard,
  DataTable,
  Modal,
  Field,
  Badge,
  Spinner,
  ErrorBanner,
  SearchInput,
} from "../components/ui";
import {
  RowActions,
  QuickViewModal,
  shareVia,
  type ShareKind,
} from "../components/RowActions";
import { fin, tools } from "../lib/api";
import { SelectMenu } from "../components/ui-menu";
import {
  parseStatementCsv,
  matchStatement,
  type BookTxn,
  type ReconResult,
} from "../lib/bankRecon";

const BANK_KEY = "filey_bank_accounts"; // device-local cache
const BANK_SETTING_KEY = "bank_accounts"; // app_settings - synced + backed up

interface BankAccount {
  id: number;
  bank_name: string;
  account_name: string;
  account_number: string;
  iban: string;
  currency: string;
  opening_balance: number;
  current_balance: number;
  created_at: string;
}

function load(): BankAccount[] {
  try {
    try { return JSON.parse(localStorage.getItem(BANK_KEY) || "[]"); } catch { return []; }
  } catch (e) {
    console.warn("Failed to load bank accounts", e);
    return [];
  }
}
function save(a: BankAccount[]) {
  try {
    localStorage.setItem(BANK_KEY, JSON.stringify(a));
  } catch (e) {
    console.warn("Failed to save bank accounts", e);
  }
  // Write-through to app_settings: bare localStorage never syncs across
  // devices and the desktop backup doesn't include it (same as challans).
  void tools.setSetting(BANK_SETTING_KEY, JSON.stringify(a)).catch((e) =>
    // Local storage already holds it, so nothing is lost here — but a failed
    // write-through means other devices never see it. Surface that in
    // Settings -> Diagnostics instead of dropping it on the floor.
    log.warn("sync", "bank accounts did not reach app_settings", e)
  );
}

/** Pull accounts saved on the user's other devices; remote wins when present. */
async function syncBankAccounts(): Promise<BankAccount[]> {
  try {
    const settings = await tools.settings();
    const row = settings.find((s) => s.key === BANK_SETTING_KEY);
    if (row?.value) {
      const remote: BankAccount[] = JSON.parse(row.value);
      localStorage.setItem(BANK_KEY, JSON.stringify(remote));
      return remote;
    }
  } catch (e) {
    console.warn("Failed to sync bank accounts from server", e);
  }
  return load();
}

export default function BankAccounts() {
  const { toast, confirm } = useUI();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<BankAccount | null>(null);
  const [reconOpen, setReconOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [quickView, setQuickView] = useState<BankAccount | null>(null);
  const [syncing, setSyncing] = useState(true);
  useEffect(() => {
    setAccounts(load()); // instant paint from the local cache…
    syncBankAccounts()
      .then(setAccounts) // …then reconcile with other devices
      .finally(() => setSyncing(false));
  }, []);

  const del = async (a: BankAccount) => {
    const ok = await confirm({
      title: "Delete account",
      message: `Delete ${a.bank_name} - ${a.account_name}?`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    const next = accounts.filter((x) => x.id !== a.id);
    setAccounts(next);
    save(next);
    toast.success("Deleted.");
  };

  const dup = (a: BankAccount) => {
    const next = [
      ...accounts,
      {
        ...a,
        id: Date.now(),
        account_name: `${a.account_name} copy`,
        created_at: new Date().toISOString(),
      },
    ];
    setAccounts(next);
    save(next);
    toast.success("Duplicated.");
  };

  const openEdit = (a: BankAccount) => {
    setEdit(a);
    setOpen(true);
  };

  // Bank details are meant to be shared (customers pay into these accounts);
  // shareVia just opens the channel with the details prefilled.
  const shareAccount = (kind: ShareKind, a: BankAccount) => {
    const text = [
      `Bank details - ${a.bank_name}`,
      `Account: ${a.account_name}`,
      a.account_number ? `Account #: ${a.account_number}` : null,
      a.iban ? `IBAN: ${a.iban}` : null,
      `Currency: ${a.currency}`,
    ]
      .filter(Boolean)
      .join("\n");
    shareVia(kind, { text, url: `Bank details - ${a.bank_name}` });
  };

  const q = search.trim().toLowerCase();
  const filtered = q
    ? accounts.filter((a) =>
        [a.bank_name, a.account_name, a.account_number, a.iban].some((v) =>
          v.toLowerCase().includes(q)
        )
      )
    : accounts;

  const total = accounts.reduce((s, a) => s + a.current_balance, 0);
  const currencies = new Set(accounts.map((a) => a.currency)).size;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Bank Accounts"
        subtitle="Manage your company bank accounts & balances"
        action={
          <div className="flex gap-2 flex-wrap">
            <button className="btn-ghost" onClick={() => setReconOpen(true)}>
              <FileCheck2 size={16} /> Reconcile
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                setEdit(null);
                setOpen(true);
              }}
            >
              <Plus size={16} /> Add account
            </button>
          </div>
        }
      />
      <div className="grid grid-cols-1 sm:grid-cols-3 joined-kpis mb-6">
        <MetricCard
          label="Accounts"
          value={String(accounts.length)}
          change={accounts.length > 0 ? "Connected" : "None yet"}
          changeTone={accounts.length > 0 ? "up" : "warn"}
        />
        <MetricCard
          label="Total Balance"
          value={aed(total)}
          change="Across all accounts"
          changeTone="up"
        />
        <MetricCard
          label="Currencies"
          value={String(currencies)}
          change={currencies > 1 ? "Multi-currency" : "Single currency"}
          changeTone="up"
        />
      </div>
      <div className="mb-4">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search by bank, account, number or IBAN…"
          className="max-w-xs"
        />
      </div>
      <DataTable<BankAccount>
        pageSize={10}
        rows={filtered}
        loading={syncing}
        onRowClick={setQuickView}
        empty={
          search
            ? "No bank accounts match your search"
            : "No bank accounts added yet"
        }
        columns={[
          {
            key: "bank",
            label: "Bank",
            sortValue: (a) => a.bank_name,
            render: (a) => <span className="font-medium text-ink">{a.bank_name}</span>,
          },
          {
            key: "acct",
            label: "Account",
            render: (a) => (
              <span className="text-sm text-brand-500">{a.account_name}</span>
            ),
          },
          {
            key: "no",
            label: "Account #",
            render: (a) => (
              <span className="font-mono text-xs text-brand-500">
                {a.account_number || "—"}
              </span>
            ),
          },
          {
            key: "iban",
            label: "IBAN",
            render: (a) => (
              <span className="font-mono text-xs text-brand-500">{a.iban || "—"}</span>
            ),
          },
          {
            key: "cur",
            label: "Currency",
            render: (a) => <Badge tone="info">{a.currency}</Badge>,
          },
          {
            key: "bal",
            label: "Balance",
            sortValue: (a) => a.current_balance,
            render: (a) => (
              <span className="font-medium text-ink tabular-nums">
                {aed(a.current_balance)}
              </span>
            ),
          },
          {
            key: "act",
            label: "Actions",
            render: (a) => (
              <RowActions
                onView={() => setQuickView(a)}
                onEdit={() => openEdit(a)}
                onCopy={() => dup(a)}
                onDelete={() => del(a)}
                onSend={{
                  whatsapp: () => shareAccount("whatsapp", a),
                  email: () => shareAccount("email", a),
                  sms: () => shareAccount("sms", a),
                }}
              />
            ),
          },
        ]}
      />
      {open && (
        <BankModal
          open={open}
          edit={edit}
          onClose={() => setOpen(false)}
          onSaved={(a) => {
            const next = edit
              ? accounts.map((x) => (x.id === a.id ? a : x))
              : [
                  ...accounts,
                  { ...a, id: Date.now(), created_at: new Date().toISOString() },
                ];
            setAccounts(next);
            save(next);
            setOpen(false);
            toast.success(edit ? "Updated." : "Account added.");
          }}
        />
      )}
      {reconOpen && (
        <ReconcileModal open={reconOpen} onClose={() => setReconOpen(false)} />
      )}
      <QuickViewModal
        open={!!quickView}
        onClose={() => setQuickView(null)}
        onEdit={
          quickView
            ? () => {
                const a = quickView;
                setQuickView(null);
                openEdit(a);
              }
            : undefined
        }
        data={
          quickView
            ? {
                title: `${quickView.bank_name} - ${quickView.account_name}`,
                subtitle: "Company bank account",
                badge: <Badge tone="info">{quickView.currency}</Badge>,
                meta: [
                  {
                    label: "Account number",
                    value: quickView.account_number || "—",
                  },
                  { label: "IBAN", value: quickView.iban || "—" },
                  { label: "Currency", value: quickView.currency },
                  {
                    label: "Opening balance",
                    value: money(quickView.opening_balance, quickView.currency),
                  },
                  { label: "Added", value: fmtDate(quickView.created_at) },
                ],
                total: quickView.current_balance,
                currency: quickView.currency,
              }
            : null
        }
      />
    </div>
  );
}

function ReconcileModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useUI();
  const [result, setResult] = useState<ReconResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [recorded, setRecorded] = useState<Set<number>>(new Set());

  const onFile = async (file: File) => {
    setErr("");
    setBusy(true);
    setResult(null);
    setConfirmed(false);
    setRecorded(new Set());
    try {
      const lines = parseStatementCsv(await file.text());
      if (!lines.length) {
        setErr(
          "No statement rows found. Expected columns like Date, Description and Amount (or Debit/Credit)."
        );
        return;
      }
      const txns = await fin.transactions();
      const book: BookTxn[] = txns
        // Entries confirmed in an earlier reconciliation stay out of the pool
        // so they can't soak up this statement's lines.
        .filter((t) => /cash|bank/i.test(t.account_name) && !t.reconciled_at)
        .map((t) => ({
          id: t.id,
          description: t.description || t.account_name,
          date: t.txn_date,
          amount: Number(t.amount),
        }));
      setResult(matchStatement(lines, book));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmMatches = async () => {
    if (!result?.matched.length) return;
    setBusy(true);
    try {
      await fin.markReconciled(result.matched.map((m) => m.txnId));
      setConfirmed(true);
      toast.success(
        `${result.matched.length} entr${result.matched.length === 1 ? "y" : "ies"} marked reconciled.`
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const recordExpense = async (i: number) => {
    const line = result?.unmatchedLines[i];
    if (!line || line.amount >= 0) return;
    setBusy(true);
    try {
      await fin.createExpense(
        "Bank import",
        line.description || "Bank statement entry",
        Math.abs(line.amount),
        line.date,
        null
      );
      setRecorded((s) => new Set(s).add(i));
      toast.success("Expense recorded and posted to the ledger.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const Stat = ({ n, label, tone }: { n: number; label: string; tone: string }) => (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className={`text-[22px] font-semibold tabular-nums tracking-tight ${tone}`}>{n}</p>
      <p className="text-[11px] text-muted-foreground mt-0.5 font-medium">{label}</p>
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} title="Reconcile bank statement">
      <input
        type="file"
        accept=".csv,text/csv"
        className="input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
      <p className="text-xs text-brand-500 mt-1.5">
        Upload a statement CSV (Date, Description, Amount - or Debit/Credit
        columns). Lines are matched to your cash/bank ledger by amount and date
        (±4 days).
      </p>
      {busy && (
        <div className="mt-3">
          <Spinner label="Matching…" />
        </div>
      )}
      {err && (
        <div className="mt-3">
          <ErrorBanner message={err} />
        </div>
      )}
      {result && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat n={result.matched.length} label="Matched" tone="text-success" />
            <Stat n={result.unmatchedLines.length} label="On statement only" tone="text-ink" />
            <Stat n={result.unmatchedTxns.length} label="In books only" tone="text-ink" />
          </div>
          {result.matched.length > 0 && (
            <button
              className="btn-primary w-full"
              disabled={busy || confirmed}
              onClick={confirmMatches}
            >
              <FileCheck2 size={15} />
              {confirmed
                ? "Matches reconciled ✓"
                : `Mark ${result.matched.length} matched entr${result.matched.length === 1 ? "y" : "ies"} as reconciled`}
            </button>
          )}
          {result.unmatchedLines.length > 0 && (
            <ReconList
              title="On the statement, not in your books"
              hint="Money out can be recorded as an expense here; money in usually belongs to an invoice payment - record it there."
              rows={result.unmatchedLines.map((l, i) => ({
                date: l.date,
                desc: l.description,
                amount: l.amount,
                action:
                  l.amount < 0 && !recorded.has(i)
                    ? { label: "Record expense", onClick: () => recordExpense(i) }
                    : recorded.has(i)
                      ? { label: "Recorded ✓" }
                      : undefined,
              }))}
            />
          )}
          {result.unmatchedTxns.length > 0 && (
            <ReconList
              title="In your books, not on the statement"
              hint="Not yet cleared, or a duplicate/error."
              rows={result.unmatchedTxns.map((t) => ({
                date: t.date,
                desc: t.description,
                amount: t.amount,
              }))}
            />
          )}
        </div>
      )}
    </Modal>
  );
}

function ReconList({
  title,
  hint,
  rows,
}: {
  title: string;
  hint: string;
  rows: {
    date: string;
    desc: string;
    amount: number;
    action?: { label: string; onClick?: () => void };
  }[];
}) {
  return (
    <div>
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="text-xs text-brand-500 mb-1">{hint}</p>
      <div className="max-h-40 overflow-y-auto rounded-xl border border-brand-200 divide-y divide-brand-100">
        {rows.map((r, i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm"
          >
            <span className="text-xs text-brand-500 tabular-nums w-20 shrink-0">
              {r.date}
            </span>
            <span className="flex-1 truncate text-ink/80">{r.desc || "—"}</span>
            <span className="tabular-nums font-medium">{aed(r.amount)}</span>
            {r.action &&
              (r.action.onClick ? (
                <button
                  className="btn-ghost h-7 shrink-0 text-xs"
                  onClick={r.action.onClick}
                >
                  {r.action.label}
                </button>
              ) : (
                <span className="shrink-0 text-xs text-success">{r.action.label}</span>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function BankModal({
  open,
  edit,
  onClose,
  onSaved,
}: {
  open: boolean;
  edit: BankAccount | null;
  onClose: () => void;
  onSaved: (a: BankAccount) => void;
}) {
  const [f, setF] = useState(
    edit ||
      ({
        bank_name: "",
        account_name: "",
        account_number: "",
        iban: "",
        currency: "AED",
        opening_balance: 0,
        current_balance: 0,
      } as Omit<BankAccount, "id" | "created_at">)
  );
  const valid = f.bank_name.trim() && f.account_name.trim();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={edit ? "Edit Account" : "Add Bank Account"}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Bank Name *">
          <input
            className="input"
            value={f.bank_name}
            onChange={(e) => setF({ ...f, bank_name: e.target.value })}
            placeholder="Emirates NBD"
          />
        </Field>
        <Field label="Account Name *">
          <input
            className="input"
            value={f.account_name}
            onChange={(e) => setF({ ...f, account_name: e.target.value })}
            placeholder="Current Account"
          />
        </Field>
        <Field label="Account Number">
          <input
            className="input"
            value={f.account_number}
            onChange={(e) => setF({ ...f, account_number: e.target.value })}
          />
        </Field>
        <Field label="IBAN">
          <input
            className="input"
            value={f.iban}
            onChange={(e) => setF({ ...f, iban: e.target.value })}
          />
        </Field>
        <Field label="Currency">
          <SelectMenu
            ariaLabel="Currency"
            value={f.currency}
            onChange={(currency) => setF({ ...f, currency })}
            options={[
              { value: "AED", label: "AED" },
              { value: "USD", label: "USD" },
              { value: "EUR", label: "EUR" },
              { value: "GBP", label: "GBP" },
            ]}
          />
        </Field>
        <Field label="Opening Balance">
          <input
            type="number"
            className="input"
            value={f.opening_balance || ""}
            onChange={(e) =>
              setF({
                ...f,
                opening_balance: numInput(e.target.value),
                current_balance: numInput(e.target.value),
              })
            }
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
          onClick={() => onSaved(f as BankAccount)}
        >
          {edit ? "Update" : "Add account"}
        </button>
      </div>
    </Modal>
  );
}
