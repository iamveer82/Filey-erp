import { useEffect, useState } from "react";
import { Plus, Trash2, Building2, Wallet, Coins } from "lucide-react";
import { useUI } from "../lib/ui";
import { aed, numInput } from "../lib/format";
import { PageHeader, MetricCard, DataTable, Modal, Field, Badge } from "../components/ui";

const BANK_KEY = "filey_bank_accounts";

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
    return JSON.parse(localStorage.getItem(BANK_KEY) || "[]");
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
}

export default function BankAccounts() {
  const { toast, confirm } = useUI();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<BankAccount | null>(null);
  useEffect(() => {
    setAccounts(load());
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

  const total = accounts.reduce((s, a) => s + a.current_balance, 0);
  const currencies = new Set(accounts.map((a) => a.currency)).size;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Bank Accounts"
        subtitle="Manage your company bank accounts & balances"
        action={
          <button
            className="btn-primary"
            onClick={() => {
              setEdit(null);
              setOpen(true);
            }}
          >
            <Plus size={16} /> Add Account
          </button>
        }
      />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <MetricCard
          label="Accounts"
          value={String(accounts.length)}
          icon={<Building2 size={20} />}
        />
        <MetricCard
          label="Total Balance"
          value={aed(total)}
          icon={<Wallet size={20} />}
          iconClass="bg-success/15 text-success"
        />
        <MetricCard
          label="Currencies"
          value={String(currencies)}
          icon={<Coins size={20} />}
          iconClass="bg-secondary/20 text-ink"
        />
      </div>
      <DataTable<BankAccount>
        rows={accounts}
        empty="No bank accounts added yet"
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
              <span className="text-sm text-brand-600">{a.account_name}</span>
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
            label: "",
            render: (a) => (
              <button
                aria-label={`Delete ${a.bank_name} account`}
                className="text-danger hover:bg-danger/10 rounded-3xl p-1.5 cursor-pointer transition-colors duration-200"
                onClick={() => del(a)}
              >
                <Trash2 size={15} />
              </button>
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
          <select
            className="select"
            value={f.currency}
            onChange={(e) => setF({ ...f, currency: e.target.value })}
          >
            <option value="AED">AED</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
          </select>
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
          {edit ? "Update" : "Add Account"}
        </button>
      </div>
    </Modal>
  );
}
