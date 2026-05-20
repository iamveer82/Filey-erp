import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, ShoppingCart, Wallet, Receipt } from "lucide-react";
import { fin, Expense, Account } from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { aed, fmtDate, num } from "../lib/format";
import {
  PageHeader,
  MetricCard,
  DataTable,
  InfoCard,
  Badge,
  Modal,
  Field,
} from "../components/ui";

export default function Purchase() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [open, setOpen] = useState(false);

  const load = () => fin.expenses().then(setExpenses).catch(console.error);
  useEffect(() => {
    load();
  }, []);
  useLiveSync(load);

  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const byCat = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of expenses)
      m.set(e.category, (m.get(e.category) ?? 0) + e.amount);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [expenses]);
  const thisMonth = expenses
    .filter(
      (e) =>
        new Date(e.expense_date).getMonth() === new Date().getMonth()
    )
    .reduce((s, e) => s + e.amount, 0);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Purchase"
        subtitle="Purchase spend & expense tracking"
        action={
          <button className="btn-primary" onClick={() => setOpen(true)}>
            <Plus size={16} /> New purchase
          </button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <MetricCard
          label="Total Spend"
          value={aed(total)}
          icon={<ShoppingCart size={20} />}
        />
        <MetricCard
          label="This Month"
          value={aed(thisMonth)}
          icon={<Wallet size={20} />}
          iconClass="bg-secondary-400/20 text-secondary-600"
        />
        <MetricCard
          label="Purchases"
          value={num(expenses.length)}
          icon={<Receipt size={20} />}
          iconClass="bg-info/15 text-info"
        />
        <MetricCard
          label="Categories"
          value={num(byCat.length)}
          icon={<ShoppingCart size={20} />}
          iconClass="bg-primary-100 text-primary-700"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <InfoCard title="Spend by category">
          <ul className="space-y-3">
            {byCat.slice(0, 6).map(([c, v]) => {
              const pct = total ? Math.round((v / total) * 100) : 0;
              return (
                <li key={c}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-brand-600 font-medium">{c}</span>
                    <span className="font-bold text-ink">{aed(v)}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-brand-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary-400"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
            {byCat.length === 0 && (
              <li className="text-sm text-brand-400">No purchases yet.</li>
            )}
          </ul>
        </InfoCard>

        <div className="lg:col-span-2">
          <DataTable<Expense>
            rows={expenses}
            empty="No purchases recorded"
            columns={[
              {
                key: "cat",
                label: "Category",
                render: (e) => (
                  <Badge tone="info">{e.category}</Badge>
                ),
              },
              {
                key: "desc",
                label: "Description",
                render: (e) => (
                  <span className="text-ink">{e.description ?? "—"}</span>
                ),
              },
              {
                key: "amt",
                label: "Amount",
                render: (e) => (
                  <span className="font-semibold">{aed(e.amount)}</span>
                ),
              },
              {
                key: "date",
                label: "Date",
                render: (e) => fmtDate(e.expense_date),
              },
              {
                key: "act",
                label: "",
                render: (e) => (
                  <button
                    aria-label="Delete purchase"
                    className="text-danger hover:bg-danger/10 rounded-lg p-1.5 cursor-pointer transition-colors duration-200"
                    onClick={async () => {
                      await fin.deleteExpense(e.id);
                      load();
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                ),
              },
            ]}
          />
        </div>
      </div>

      <PurchaseModal
        open={open}
        onClose={() => setOpen(false)}
        onSaved={load}
      />
    </div>
  );
}

function PurchaseModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    category: "",
    description: "",
    amount: 0,
    expense_date: new Date().toISOString().slice(0, 10),
    account_id: "" as string,
  });
  const [accounts, setAccounts] = useState<Account[]>([]);
  useEffect(() => {
    if (open) fin.accounts().then(setAccounts).catch(() => setAccounts([]));
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="New Purchase">
      <div className="space-y-3">
        <Field label="Category">
          <input
            className="input"
            value={f.category}
            onChange={(e) => setF({ ...f, category: e.target.value })}
            placeholder="Raw materials"
          />
        </Field>
        <Field label="Description">
          <input
            className="input"
            value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })}
          />
        </Field>
        <Field label="Amount (AED)">
          <input
            type="number"
            className="input"
            placeholder="0"
            value={f.amount || ""}
            onChange={(e) => setF({ ...f, amount: +e.target.value })}
          />
        </Field>
        <Field label="Date">
          <input
            type="date"
            className="input"
            value={f.expense_date}
            onChange={(e) => setF({ ...f, expense_date: e.target.value })}
          />
        </Field>
        <Field label="Pay from account (posts to ledger)">
          <select
            className="select"
            value={f.account_id}
            onChange={(e) => setF({ ...f, account_id: e.target.value })}
          >
            <option value="">Not linked (no ledger post)</option>
            {accounts.map((a) => (
              <option key={a.id} value={String(a.id)}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn-primary"
          onClick={async () => {
            try {
              await fin.createExpense(
                f.category,
                f.description || null,
                f.amount,
                f.expense_date,
                f.account_id ? Number(f.account_id) : null
              );
              onSaved();
              onClose();
            } catch (e) {
              alert(
                `Could not save purchase: ${
                  e instanceof Error ? e.message : String(e)
                }`
              );
            }
          }}
        >
          Save Purchase
        </button>
      </div>
    </Modal>
  );
}
