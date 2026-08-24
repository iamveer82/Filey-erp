import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Sparkles,
  Download,
  Wrench,
} from "lucide-react";
import { fin, Account, Txn, FinanceReport } from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { useUI } from "../lib/ui";
import ExpenseScanModal from "../components/ExpenseScanModal";
import { SelectMenu } from "../components/ui-menu";
import { aed, fmtDate, numInput, cn, getDisplayCurrency, todayYmd } from "../lib/format";
import {
  PageHeader,
  MetricCard,
  DataTable,
  Badge,
  Modal,
  Field,
  ErrorBanner,
  SearchInput,
  FilterChip,
} from "../components/ui";
import { DateField } from "../components/DatePicker";
import {
  RowActions,
  QuickViewModal,
  shareVia,
  type ShareKind,
} from "../components/RowActions";
import { downloadCsv } from "../lib/csv";

const ACCOUNT_TYPES = ["asset", "liability", "equity", "revenue", "expense"];

export default function Accounting() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [report, setReport] = useState<FinanceReport | null>(null);
  const [acctOpen, setAcctOpen] = useState(false);
  const [jOpen, setJOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [tab, setTab] = useState<"journal" | "accounts">("journal");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [editingTxn, setEditingTxn] = useState<Txn | null>(null);
  const [dupAccount, setDupAccount] = useState<Account | null>(null);
  const [quickView, setQuickView] = useState<
    { kind: "txn"; txn: Txn } | { kind: "account"; account: Account } | null
  >(null);
  const [search, setSearch] = useState("");
  const [txnFilter, setTxnFilter] = useState<"all" | "debit" | "credit">("all");
  const [acctFilter, setAcctFilter] = useState<string>("all");
  const { confirm, toast } = useUI();

  const load = () => {
    setError("");
    return Promise.all([
      fin.accounts().then(setAccounts),
      fin.transactions().then(setTxns),
      fin.report().then(setReport),
    ])
      .catch((e) =>
        setError(`Could not load accounting: ${e instanceof Error ? e.message : e}`)
      )
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, []);
  useLiveSync(load);

  const doRepair = async () => {
    const ok = await confirm({
      title: "Repair ledger?",
      message:
        "Removes duplicate journal entries and recomputes every account balance from what's left. Your invoices, expenses and accounts are untouched.",
      confirmLabel: "Repair",
    });
    if (!ok) return;
    try {
      const { removed } = await fin.repairLedger();
      toast.success(
        removed > 0
          ? `Removed ${removed} duplicate entr${removed === 1 ? "y" : "ies"} and recomputed balances.`
          : "No duplicates found - balances recomputed."
      );
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  // ---- List-page filtering (DEMO parity: search + status chips) ----
  const q = search.trim().toLowerCase();
  const filteredTxns = useMemo(
    () =>
      txns.filter(
        (t) =>
          (txnFilter === "all" || t.txn_type === txnFilter) &&
          (!q ||
            (t.description ?? "").toLowerCase().includes(q) ||
            t.account_name.toLowerCase().includes(q))
      ),
    [txns, txnFilter, q]
  );
  const filteredAccounts = useMemo(
    () =>
      accounts.filter(
        (a) =>
          (acctFilter === "all" || a.account_type === acctFilter) &&
          (!q ||
            a.name.toLowerCase().includes(q) ||
            a.code.toLowerCase().includes(q))
      ),
    [accounts, acctFilter, q]
  );
  const acctTypesPresent = useMemo(
    () => ACCOUNT_TYPES.filter((t) => accounts.some((a) => a.account_type === t)),
    [accounts]
  );

  // ---- Row actions (DEMO parity) — all wired to real fin operations ----
  const deleteTxn = async (t: Txn) => {
    if (
      !(await confirm({
        title: "Delete journal entry",
        message: `Delete ${t.description || "this entry"}? This will restore the account balance.`,
        confirmLabel: "Delete",
        danger: true,
      }))
    )
      return;
    try {
      await fin.deleteTransaction(t.id);
      load();
      toast.success("Entry deleted");
    } catch (e: any) {
      toast.error(e?.message || "Failed to delete entry");
    }
  };

  const duplicateTxn = async (t: Txn) => {
    try {
      await fin.postTransaction(
        t.account_id,
        t.txn_type,
        t.amount,
        t.description ?? null
      );
      load();
      toast.success("Entry duplicated as a new posting");
    } catch (e: any) {
      toast.error(e?.message || "Failed to duplicate entry");
    }
  };

  const deleteAccountRow = async (a: Account) => {
    if (
      !(await confirm({
        title: "Delete account",
        message: `Delete "${a.name}"? Any balance will be zeroed out with an offsetting entry.`,
        confirmLabel: "Delete",
        danger: true,
      }))
    )
      return;
    try {
      await fin.deleteAccount(a.id);
      load();
      toast.success("Account deleted");
    } catch (e: any) {
      toast.error(e?.message || "Failed to delete account");
    }
  };

  const shareTxn = (kind: ShareKind, t: Txn) => {
    const text = `Journal entry #${t.id} - ${t.account_name}: ${t.txn_type} ${aed(
      t.amount
    )} on ${fmtDate(t.txn_date)}${t.description ? `. ${t.description}` : ""}`;
    shareVia(kind, {
      text,
      url: `${location.origin}${location.pathname}#/accounting`,
    });
    if (kind === "copyLink") toast.success("Accounting link copied");
  };

  const exportCsv = () => {
    if (tab === "journal") {
      downloadCsv(
        "journal-entries",
        filteredTxns.map((t) => ({
          date: t.txn_date,
          account: t.account_name,
          type: t.txn_type,
          description: t.description ?? "",
          amount: t.amount,
        })),
        [
          { key: "date", label: "Date" },
          { key: "account", label: "Account" },
          { key: "type", label: "Type" },
          { key: "description", label: "Description" },
          { key: "amount", label: `Amount (${getDisplayCurrency()})` },
        ]
      );
    } else {
      downloadCsv(
        "chart-of-accounts",
        filteredAccounts.map((a) => ({
          code: a.code,
          name: a.name,
          type: a.account_type,
          balance: a.balance,
        })),
        [
          { key: "code", label: "Code" },
          { key: "name", label: "Account" },
          { key: "type", label: "Type" },
          { key: "balance", label: `Balance (${getDisplayCurrency()})` },
        ]
      );
    }
    toast.success("Exported to CSV");
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Accounting"
        subtitle="Chart of accounts, journal entries & financial position"
        action={
          <div className="flex gap-2">
            <button
              className="btn-ghost"
              aria-label="Export CSV"
              title="Export the current view to CSV"
              onClick={exportCsv}
            >
              <Download size={15} /> Export
            </button>
            <button
              className="btn-ghost"
              aria-label="Scan receipt"
              onClick={() => setScanOpen(true)}
            >
              <Sparkles size={15} /> Scan receipt
            </button>
            <button
              className="btn-ghost"
              aria-label="Repair ledger"
              title="Remove duplicate entries & recompute balances"
              onClick={doRepair}
            >
              <Wrench size={15} /> Repair
            </button>
            <button
              className="btn-ghost"
              aria-label="Account"
              onClick={() => setAcctOpen(true)}
            >
              <Plus size={15} /> Account
            </button>
            <button className="btn-primary" onClick={() => setJOpen(true)}>
              <Plus size={16} /> Journal entry
            </button>
          </div>
        }
      />

      <ExpenseScanModal
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onSaved={load}
      />

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 joined-kpis mb-4">
        <MetricCard
          label="Net Profit"
          value={aed(report?.net_profit ?? 0)}
          change={(report?.net_profit ?? 0) >= 0 ? "Revenue minus expenses" : "Loss this period"}
          changeTone={(report?.net_profit ?? 0) >= 0 ? "up" : "down"}
        />
        <MetricCard
          label="Revenue"
          value={aed(report?.total_revenue ?? 0)}
          change="All income"
          changeTone="up"
        />
        <MetricCard
          label="Expenses"
          value={aed(report?.total_expenses ?? 0)}
          change="All spending"
          changeTone={(report?.total_expenses ?? 0) > 0 ? "warn" : "up"}
        />
        <MetricCard
          label="Cash Position"
          value={aed(report?.cash_position ?? 0)}
          change="Across bank accounts"
          changeTone="up"
        />
      </div>

      <div className="flex gap-2 mb-4">
        {(["journal", "accounts"] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              setSearch("");
            }}
            className={`chip ${tab === t ? "chip-active" : ""} capitalize`}
          >
            {t === "journal" ? "Journal" : "Chart of Accounts"}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={
            tab === "journal"
              ? "Search entries by description or account…"
              : "Search accounts by name or code…"
          }
          className="max-w-xs flex-1 min-w-[220px]"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          {tab === "journal" ? (
            <>
              <FilterChip
                active={txnFilter === "all"}
                onClick={() => setTxnFilter("all")}
                count={txns.length}
              >
                All
              </FilterChip>
              <FilterChip
                active={txnFilter === "debit"}
                onClick={() => setTxnFilter("debit")}
                tone="info"
                count={txns.filter((t) => t.txn_type === "debit").length}
              >
                Debit
              </FilterChip>
              <FilterChip
                active={txnFilter === "credit"}
                onClick={() => setTxnFilter("credit")}
                tone="success"
                count={txns.filter((t) => t.txn_type === "credit").length}
              >
                Credit
              </FilterChip>
            </>
          ) : (
            <>
              <FilterChip
                active={acctFilter === "all"}
                onClick={() => setAcctFilter("all")}
                count={accounts.length}
              >
                All
              </FilterChip>
              {acctTypesPresent.map((tp) => (
                <FilterChip
                  key={tp}
                  active={acctFilter === tp}
                  onClick={() => setAcctFilter(tp)}
                  count={accounts.filter((a) => a.account_type === tp).length}
                >
                  <span className="capitalize">{tp}</span>
                </FilterChip>
              ))}
            </>
          )}
        </div>
      </div>

      {tab === "journal" ? (
        <DataTable<Txn>
          pageSize={10}
          rows={filteredTxns}
          loading={loading}
          empty={
            search || txnFilter !== "all"
              ? "No journal entries match your filters"
              : "No journal entries yet"
          }
          columns={[
            {
              key: "d",
              label: "Date",
              sortValue: (t) => t.txn_date,
              render: (t) => fmtDate(t.txn_date),
            },
            {
              key: "acct",
              label: "Account",
              sortValue: (t) => t.account_name,
              render: (t) => (
                <span className="font-medium text-ink">{t.account_name}</span>
              ),
            },
            {
              key: "type",
              label: "Type",
              sortValue: (t) => t.txn_type,
              render: (t) => (
                <Badge tone={t.txn_type === "credit" ? "success" : "info"}>
                  {t.txn_type}
                </Badge>
              ),
            },
            {
              key: "desc",
              label: "Description",
              sortValue: (t) => t.description ?? "",
              editable: {
                value: (t) => t.description ?? "",
                onSave: async (t, v) => {
                  await fin.updateTransaction(t.id, { description: v });
                  load();
                },
              },
              render: (t) => t.description ?? "—",
            },
            {
              key: "amt",
              label: "Amount",
              sortValue: (t) => t.amount,
              render: (t) => <span className="font-medium">{aed(t.amount)}</span>,
            },
            {
              key: "actions",
              label: "Actions",
              render: (t) => (
                <RowActions
                  onView={() => setQuickView({ kind: "txn", txn: t })}
                  onEdit={() => setEditingTxn(t)}
                  onCopy={() => duplicateTxn(t)}
                  onDelete={() => deleteTxn(t)}
                  onSend={{
                    whatsapp: () => shareTxn("whatsapp", t),
                    email: () => shareTxn("email", t),
                    sms: () => shareTxn("sms", t),
                    copyLink: () => shareTxn("copyLink", t),
                  }}
                />
              ),
            },
          ]}
        />
      ) : (
        <DataTable<Account>
          pageSize={10}
          rows={filteredAccounts}
          loading={loading}
          empty={
            search || acctFilter !== "all"
              ? "No accounts match your filters"
              : "No accounts - add your first chart-of-accounts entry"
          }
          columns={[
            {
              key: "code",
              label: "Code",
              sortValue: (a) => a.code,
              editable: {
                value: (a) => a.code,
                onSave: async (a, v) => {
                  await fin.updateAccount(a.id, { code: v });
                  load();
                },
              },
              render: (a) => (
                <span className="font-mono text-xs text-brand-500">{a.code}</span>
              ),
            },
            {
              key: "name",
              label: "Account",
              sortValue: (a) => a.name,
              editable: {
                value: (a) => a.name,
                onSave: async (a, v) => {
                  await fin.updateAccount(a.id, { name: v });
                  load();
                },
              },
              render: (a) => <span className="font-medium text-ink">{a.name}</span>,
            },
            {
              key: "type",
              label: "Type",
              sortValue: (a) => a.account_type,
              render: (a) => <Badge tone="neutral">{a.account_type}</Badge>,
            },
            {
              key: "bal",
              label: "Balance",
              sortValue: (a) => a.balance,
              render: (a) => <span className="font-medium">{aed(a.balance)}</span>,
            },
            {
              key: "actions",
              label: "Actions",
              render: (a) => (
                <RowActions
                  onView={() => setQuickView({ kind: "account", account: a })}
                  onEdit={() => setEditingAccount(a)}
                  onCopy={() => {
                    setDupAccount(a);
                    setAcctOpen(true);
                  }}
                  onDelete={() => deleteAccountRow(a)}
                />
              ),
            },
          ]}
        />
      )}

      <QuickViewModal
        open={!!quickView}
        onClose={() => setQuickView(null)}
        onEdit={
          quickView
            ? () => {
                const qv = quickView;
                setQuickView(null);
                if (qv.kind === "txn") setEditingTxn(qv.txn);
                else setEditingAccount(qv.account);
              }
            : undefined
        }
        data={
          quickView
            ? quickView.kind === "txn"
              ? {
                  title: `Journal entry #${quickView.txn.id}`,
                  subtitle: quickView.txn.account_name,
                  badge: (
                    <Badge
                      tone={
                        quickView.txn.txn_type === "credit" ? "success" : "info"
                      }
                    >
                      {quickView.txn.txn_type}
                    </Badge>
                  ),
                  meta: [
                    { label: "Date", value: fmtDate(quickView.txn.txn_date) },
                    { label: "Account", value: quickView.txn.account_name },
                    { label: "Type", value: quickView.txn.txn_type },
                    { label: "Amount", value: aed(quickView.txn.amount) },
                    ...(quickView.txn.reconciled_at
                      ? [
                          {
                            label: "Reconciled",
                            value: fmtDate(quickView.txn.reconciled_at),
                          },
                        ]
                      : []),
                  ],
                  total: quickView.txn.amount,
                  currency: getDisplayCurrency(),
                  notes: quickView.txn.description || undefined,
                }
              : {
                  title: quickView.account.name,
                  subtitle: `Code ${quickView.account.code}`,
                  badge: <Badge tone="neutral">{quickView.account.account_type}</Badge>,
                  meta: [
                    { label: "Code", value: quickView.account.code },
                    { label: "Type", value: quickView.account.account_type },
                    {
                      label: "Journal entries",
                      value: txns.filter(
                        (t) => t.account_id === quickView.account.id
                      ).length,
                    },
                  ],
                  total: quickView.account.balance,
                  currency: getDisplayCurrency(),
                }
            : null
        }
      />

      <AccountModal
        open={acctOpen}
        editing={editingAccount}
        prefill={dupAccount}
        onClose={() => {
          setAcctOpen(false);
          setEditingAccount(null);
          setDupAccount(null);
        }}
        onSaved={() => {
          setAcctOpen(false);
          setEditingAccount(null);
          setDupAccount(null);
          load();
        }}
      />
      <JournalModal
        open={jOpen || !!editingTxn}
        txn={editingTxn}
        accounts={accounts}
        onClose={() => {
          setJOpen(false);
          setEditingTxn(null);
        }}
        onSaved={() => {
          setJOpen(false);
          setEditingTxn(null);
          load();
        }}
      />
    </div>
  );
}

function AccountModal({
  open,
  editing,
  prefill,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing?: Account | null;
  /** Duplicate source — pre-fills the new-account form (fresh code/balance). */
  prefill?: Account | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useUI();
  const [f, setF] = useState({
    code: "",
    name: "",
    account_type: "asset",
    balance: 0,
  });
  const [touched, setTouched] = useState(false);
  const isEdit = !!editing;
  useEffect(() => {
    if (open) {
      if (editing) {
        setF({
          code: editing.code,
          name: editing.name,
          account_type: editing.account_type,
          balance: editing.balance,
        });
      } else if (prefill) {
        setF({
          code: "",
          name: `${prefill.name} (copy)`,
          account_type: prefill.account_type,
          balance: 0,
        });
      } else {
        setF({ code: "", name: "", account_type: "asset", balance: 0 });
      }
      setTouched(false);
    }
  }, [open, editing, prefill]);
  const codeErr = !f.code.trim();
  const nameErr = !f.name.trim();
  const valid = !codeErr && !nameErr;
  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "Edit Account" : prefill ? "Duplicate Account" : "New Account"}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code *">
            <input
              className={cn("input", touched && codeErr && "border-danger")}
              placeholder="1000"
              value={f.code}
              onChange={(e) => setF({ ...f, code: e.target.value })}
            />
            {touched && codeErr && (
              <p className="text-[11px] text-danger mt-1">Code is required.</p>
            )}
          </Field>
          <Field label="Type">
            <SelectMenu
              ariaLabel="Type"
              value={f.account_type}
              onChange={(account_type) => setF({ ...f, account_type })}
              options={ACCOUNT_TYPES.map((t) => ({ value: t, label: t }))}
            />
          </Field>
        </div>
        <Field label="Account Name *">
          <input
            className={cn("input", touched && nameErr && "border-danger")}
            placeholder="Cash at Bank"
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
          {touched && nameErr && (
            <p className="text-[11px] text-danger mt-1">Name is required.</p>
          )}
        </Field>
        <Field label={`Opening Balance (${getDisplayCurrency()})`}>
          <input
            type="number"
            className="input"
            placeholder="0"
            value={f.balance || ""}
            onChange={(e) => setF({ ...f, balance: numInput(e.target.value) })}
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn-primary"
          disabled={touched && !valid}
          onClick={async () => {
            setTouched(true);
            if (!valid) return;
            try {
              if (isEdit && editing) {
                await fin.updateAccount(editing.id, {
                  code: f.code,
                  name: f.name,
                  account_type: f.account_type,
                });
              } else {
                await fin.createAccount({
                  code: f.code,
                  name: f.name,
                  account_type: f.account_type,
                  balance: f.balance,
                } as Omit<Account, "id">);
              }
              onSaved();
            } catch (e: any) {
              toast.error(e?.message || "Failed to save account");
            }
          }}
        >
          Save Account
        </button>
      </div>
    </Modal>
  );
}

function JournalModal({
  open,
  txn,
  accounts,
  onClose,
  onSaved,
}: {
  open: boolean;
  txn?: Txn | null;
  accounts: Account[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useUI();
  const isEdit = !!txn;
  const [f, setF] = useState({
    account_id: 0,
    txn_type: "debit",
    amount: 0,
    description: "",
    txn_date: todayYmd(),
  });
  const firstAcct = useMemo(() => accounts[0]?.id ?? 0, [accounts]);
  useEffect(() => {
    if (open) {
      if (txn) {
        setF({
          account_id: txn.account_id,
          txn_type: txn.txn_type as "debit" | "credit",
          amount: txn.amount,
          description: txn.description ?? "",
          txn_date: txn.txn_date,
        });
      } else {
        setF({
          account_id: firstAcct,
          txn_type: "debit",
          amount: 0,
          description: "",
          txn_date: todayYmd(),
        });
      }
    }
  }, [open, txn, firstAcct]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Edit Journal Entry" : "New Journal Entry"}
    >
      <div className="space-y-3">
        <Field label="Account">
          <SelectMenu
            ariaLabel="Account"
            value={String(f.account_id)}
            disabled={isEdit}
            onChange={(v) => setF({ ...f, account_id: numInput(v) })}
            options={
              accounts.length === 0
                ? [{ value: "0", label: "No accounts" }]
                : accounts.map((a) => ({
                    value: String(a.id),
                    label: `${a.code} · ${a.name}`,
                  }))
            }
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <SelectMenu
              ariaLabel="Type"
              value={f.txn_type}
              disabled={isEdit}
              onChange={(txn_type) => setF({ ...f, txn_type })}
              options={[
                { value: "debit", label: "Debit" },
                { value: "credit", label: "Credit" },
              ]}
            />
          </Field>
          <Field label={`Amount (${getDisplayCurrency()})`}>
            <input
              type="number"
              className="input"
              placeholder="0"
              disabled={isEdit}
              value={f.amount || ""}
              onChange={(e) => setF({ ...f, amount: numInput(e.target.value) })}
            />
          </Field>
        </div>
        <Field label="Description">
          <input
            className="input"
            value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })}
          />
        </Field>
        <Field label="Date">
          <DateField
            value={f.txn_date}
            onChange={(v) => setF({ ...f, txn_date: v })}
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
          disabled={!f.account_id || !f.amount}
          onClick={async () => {
            try {
              if (isEdit && txn) {
                await fin.updateTransaction(txn.id, {
                  description: f.description,
                  txn_date: f.txn_date,
                });
              } else {
                await fin.postTransaction(
                  f.account_id,
                  f.txn_type,
                  f.amount,
                  f.description || null
                );
              }
              onSaved();
            } catch (e: any) {
              toast.error(e?.message || "Failed to post journal entry");
            }
          }}
        >
          {isEdit ? "Save Changes" : "Post Entry"}
        </button>
      </div>
    </Modal>
  );
}
