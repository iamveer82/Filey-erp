import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  TrendingUp,
  Wallet,
  Receipt,
  Banknote,
  Sparkles,
  Pencil,
  Trash2,
} from "lucide-react";
import { fin, Account, Txn, FinanceReport } from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { useUI } from "../lib/ui";
import ExpenseScanModal from "../components/ExpenseScanModal";
import { aed, fmtDate, numInput, cn, getDisplayCurrency } from "../lib/format";
import {
  PageHeader,
  MetricCard,
  DataTable,
  Badge,
  Modal,
  Field,
  ErrorBanner,
} from "../components/ui";

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

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Accounting"
        subtitle="Chart of accounts, journal entries & financial position"
        action={
          <div className="flex gap-2">
            <button
              className="btn-ghost"
              aria-label="Scan receipt"
              onClick={() => setScanOpen(true)}
            >
              <Sparkles size={15} /> Scan receipt
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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <MetricCard
          label="Net Profit"
          value={aed(report?.net_profit ?? 0)}
          icon={<TrendingUp size={20} />}
          iconClass="bg-success/15 text-success"
        />
        <MetricCard
          label="Revenue"
          value={aed(report?.total_revenue ?? 0)}
          icon={<Banknote size={20} />}
        />
        <MetricCard
          label="Expenses"
          value={aed(report?.total_expenses ?? 0)}
          icon={<Receipt size={20} />}
          iconClass="bg-danger/15 text-danger"
        />
        <MetricCard
          label="Cash Position"
          value={aed(report?.cash_position ?? 0)}
          icon={<Wallet size={20} />}
          iconClass="bg-info/15 text-info"
        />
      </div>

      <div className="flex gap-2 mb-4">
        {(["journal", "accounts"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`chip ${tab === t ? "chip-active" : ""} capitalize`}
          >
            {t === "journal" ? "Journal" : "Chart of Accounts"}
          </button>
        ))}
      </div>

      {tab === "journal" ? (
        <DataTable<Txn>
          rows={txns}
          loading={loading}
          empty="No journal entries yet"
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
              label: "",
              render: (t) => (
                <div className="flex items-center justify-end gap-1" data-no-row-click>
                  <button
                    className="btn-ghost h-8 px-2.5 text-xs"
                    title="Edit description"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingTxn(t);
                    }}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className="btn-danger h-8 px-2.5 text-xs"
                    title="Delete entry"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (
                        await confirm({
                          title: "Delete journal entry",
                          message: `Delete ${t.description || "this entry"}? This will restore the account balance.`,
                          confirmLabel: "Delete",
                          danger: true,
                        })
                      ) {
                        try {
                          await fin.deleteTransaction(t.id);
                          load();
                          toast.success("Entry deleted");
                        } catch (e: any) {
                          toast.error(e?.message || "Failed to delete entry");
                        }
                      }
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ),
            },
          ]}
        />
      ) : (
        <DataTable<Account>
          rows={accounts}
          loading={loading}
          empty="No accounts — add your first chart-of-accounts entry"
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
              label: "",
              render: (a) => (
                <div className="flex items-center justify-end gap-1" data-no-row-click>
                  <button
                    className="btn-ghost h-8 px-2.5 text-xs"
                    title="Edit account"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingAccount(a);
                    }}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className="btn-danger h-8 px-2.5 text-xs"
                    title="Delete account"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (
                        await confirm({
                          title: "Delete account",
                          message: `Delete "${a.name}"? Any balance will be zeroed out with an offsetting entry.`,
                          confirmLabel: "Delete",
                          danger: true,
                        })
                      ) {
                        try {
                          await fin.deleteAccount(a.id);
                          load();
                          toast.success("Account deleted");
                        } catch (e: any) {
                          toast.error(e?.message || "Failed to delete account");
                        }
                      }
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ),
            },
          ]}
        />
      )}

      <AccountModal
        open={acctOpen}
        editing={editingAccount}
        onClose={() => {
          setAcctOpen(false);
          setEditingAccount(null);
        }}
        onSaved={() => {
          setAcctOpen(false);
          setEditingAccount(null);
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
  onClose,
  onSaved,
}: {
  open: boolean;
  editing?: Account | null;
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
      } else {
        setF({ code: "", name: "", account_type: "asset", balance: 0 });
      }
      setTouched(false);
    }
  }, [open, editing]);
  const codeErr = !f.code.trim();
  const nameErr = !f.name.trim();
  const valid = !codeErr && !nameErr;
  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "Edit Account" : "New Account"}>
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
            <select
              className="select"
              value={f.account_type}
              onChange={(e) => setF({ ...f, account_type: e.target.value })}
            >
              {ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
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
    txn_date: new Date().toISOString().slice(0, 10),
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
          txn_date: new Date().toISOString().slice(0, 10),
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
          <select
            className="select"
            value={f.account_id}
            disabled={isEdit}
            onChange={(e) => setF({ ...f, account_id: numInput(e.target.value) })}
          >
            {accounts.length === 0 && <option value={0}>No accounts</option>}
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <select
              className="select"
              value={f.txn_type}
              disabled={isEdit}
              onChange={(e) => setF({ ...f, txn_type: e.target.value })}
            >
              <option value="debit">Debit</option>
              <option value="credit">Credit</option>
            </select>
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
          <input
            type="date"
            className="input"
            value={f.txn_date}
            onChange={(e) => setF({ ...f, txn_date: e.target.value })}
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
