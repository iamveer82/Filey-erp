import { useEffect, useMemo, useState } from "react";
import { Plus, TrendingUp, Wallet, Receipt, Banknote } from "lucide-react";
import { fin, Account, Txn, FinanceReport } from "../lib/api";
import { useLiveSync } from "../lib/realtime";
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

const ACCOUNT_TYPES = [
  "asset",
  "liability",
  "equity",
  "revenue",
  "expense",
];

export default function Accounting() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [report, setReport] = useState<FinanceReport | null>(null);
  const [acctOpen, setAcctOpen] = useState(false);
  const [jOpen, setJOpen] = useState(false);
  const [tab, setTab] = useState<"journal" | "accounts">("journal");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
  useEffect(() => { load(); }, []);
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
            { key: "d", label: "Date", render: (t) => fmtDate(t.txn_date) },
            {
              key: "acct",
              label: "Account",
              render: (t) => (
                <span className="font-semibold text-ink">
                  {t.account_name}
                </span>
              ),
            },
            {
              key: "type",
              label: "Type",
              render: (t) => (
                <Badge tone={t.txn_type === "credit" ? "success" : "info"}>
                  {t.txn_type}
                </Badge>
              ),
            },
            {
              key: "desc",
              label: "Description",
              render: (t) => t.description ?? "—",
            },
            {
              key: "amt",
              label: "Amount",
              render: (t) => (
                <span className="font-semibold">{aed(t.amount)}</span>
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
              render: (a) => (
                <span className="font-mono text-xs text-brand-500">
                  {a.code}
                </span>
              ),
            },
            {
              key: "name",
              label: "Account",
              render: (a) => (
                <span className="font-semibold text-ink">{a.name}</span>
              ),
            },
            {
              key: "type",
              label: "Type",
              render: (a) => (
                <Badge tone="neutral">{a.account_type}</Badge>
              ),
            },
            {
              key: "bal",
              label: "Balance",
              render: (a) => (
                <span className="font-semibold">{aed(a.balance)}</span>
              ),
            },
          ]}
        />
      )}

      <AccountModal
        open={acctOpen}
        onClose={() => setAcctOpen(false)}
        onSaved={() => {
          setAcctOpen(false);
          load();
        }}
      />
      <JournalModal
        open={jOpen}
        accounts={accounts}
        onClose={() => setJOpen(false)}
        onSaved={() => {
          setJOpen(false);
          load();
        }}
      />
    </div>
  );
}

function AccountModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    code: "",
    name: "",
    account_type: "asset",
    balance: 0,
  });
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (open) {
      setF({ code: "", name: "", account_type: "asset", balance: 0 });
      setTouched(false);
    }
  }, [open]);
  const codeErr = !f.code.trim();
  const nameErr = !f.name.trim();
  const valid = !codeErr && !nameErr;
  return (
    <Modal open={open} onClose={onClose} title="New Account">
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
              onChange={(e) =>
                setF({ ...f, account_type: e.target.value })
              }
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
            await fin.createAccount({
              code: f.code,
              name: f.name,
              account_type: f.account_type,
              balance: f.balance,
            } as Omit<Account, "id">);
            onSaved();
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
  accounts,
  onClose,
  onSaved,
}: {
  open: boolean;
  accounts: Account[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    account_id: 0,
    txn_type: "debit",
    amount: 0,
    description: "",
  });
  const firstAcct = useMemo(() => accounts[0]?.id ?? 0, [accounts]);
  useEffect(() => {
    if (open)
      setF({
        account_id: firstAcct,
        txn_type: "debit",
        amount: 0,
        description: "",
      });
  }, [open, firstAcct]);
  return (
    <Modal open={open} onClose={onClose} title="New Journal Entry">
      <div className="space-y-3">
        <Field label="Account">
          <select
            className="select"
            value={f.account_id}
            onChange={(e) =>
              setF({ ...f, account_id: numInput(e.target.value) })
            }
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
              value={f.amount || ""}
              onChange={(e) => setF({ ...f, amount: numInput(e.target.value) })}
            />
          </Field>
        </div>
        <Field label="Description">
          <input
            className="input"
            value={f.description}
            onChange={(e) =>
              setF({ ...f, description: e.target.value })
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
          disabled={!f.account_id || !f.amount}
          onClick={async () => {
            await fin.postTransaction(
              f.account_id,
              f.txn_type,
              f.amount,
              f.description || null
            );
            onSaved();
          }}
        >
          Post Entry
        </button>
      </div>
    </Modal>
  );
}
