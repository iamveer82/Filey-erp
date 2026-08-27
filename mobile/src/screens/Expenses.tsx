import { useEffect, useState } from "react";

import { Plus, Wallet } from "lucide-react";
import { fin, type Expense } from "@shared/api";
import { aed, num, todayYmd } from "@shared/format";
import {
  Screen,
  MetricCard,
  ListRow,
  SearchHeader,
  EmptyState,
  Loading,
  Sheet,
  Field,
} from "@mobile/components/ui";

const CATEGORIES = [
  "Rent", "Utilities", "Salaries", "Office Supplies", "Travel",
  "Marketing", "Maintenance", "Fuel", "Logistics", "Insurance",
  "Professional Fees", "Bank Charges", "Miscellaneous",
];

export default function Expenses() {
  const [rows, setRows] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const load = () => {
    fin
      .expenses()
      .then(setRows)
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return rows;
    return rows.filter((r) =>
      `${r.category} ${r.description || ""}`.toLowerCase().includes(n)
    );
  }, [rows, q]);

  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const month = new Date().toISOString().slice(0, 7);
  const thisMonth = rows.filter(
    (r) => (r.expense_date || "").slice(0, 7) === month
  );

  return (
    <Screen title="Expenses" subtitle={`${rows.length} logged`}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2.5">
          <MetricCard label="Total" value={aed(total)} change={`${num(rows.length)} entries`} />
          <MetricCard
            label="This month"
            value={aed(thisMonth.reduce((s, r) => s + (Number(r.amount) || 0), 0))}
            change={`${thisMonth.length} entries`}
            tone={thisMonth.length > 0 ? "up" : "warn"}
          />
        </div>

        <SearchHeader value={q} onChange={setQ} placeholder="Search category or description…" />

        {loading ? (
          <Loading />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Wallet size={22} />}
            title={rows.length === 0 ? "No expenses yet" : "No matches"}
            hint={rows.length === 0 ? "Tap + to log your first expense." : undefined}
          />
        ) : (
          <div className="space-y-2">
            {filtered.map((r) => (
              <ListRow
                key={r.id}
                title={r.category}
                subtitle={r.description || r.expense_date}
                amount={aed(Number(r.amount) || 0)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Floating add button */}
      <button
        aria-label="Log expense"
        onClick={() => setOpen(true)}
        className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+5.2rem)] right-4 z-40 grid h-14 w-14 place-items-center rounded-full text-background shadow-lg transition-transform active:scale-95"
        style={{ background: "hsl(var(--foreground))", color: "hsl(var(--background))" }}
      >
        <Plus size={22} />
      </button>

      <AddExpense open={open} onClose={() => { setOpen(false); load(); }} />    </Screen>
  );
}

function AddExpense({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayYmd());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) return setErr("Enter a valid amount.");
    setBusy(true);
    setErr(null);
    try {
      await fin.createExpense(category, description || null, amt, date, null);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Log expense">
      <div className="space-y-3">
        <Field label="Category">
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Amount (AED)">
          <input
            className="input"
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
          />
        </Field>
        <Field label="Date">
          <input
            className="input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Description (optional)">
          <input
            className="input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What was it for?"
          />
        </Field>
        {err && <p className="text-[12.5px] font-medium text-danger">{err}</p>}
        <button
          className="btn-primary w-full"
          disabled={busy}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save expense"}
        </button>
      </div>
    </Sheet>
  );
}
