import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { fin, type Expense } from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { aed, fmtDate, num, cn, errMsg, todayYmd } from "../lib/format";
import { PageHeader, Badge, ErrorBanner, Modal, Field } from "../components/ui";
import { useUI } from "../lib/ui";

const CATEGORIES = [
  "Rent", "Utilities", "Salaries", "Office Supplies", "Travel",
  "Marketing", "Maintenance", "Fuel", "Logistics", "Insurance",
  "Professional Fees", "Bank Charges", "Miscellaneous",
];

export default function Purchase() {
  const { toast } = useUI();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    category: "Rent",
    description: "",
    amount: "",
    expense_date: todayYmd(),
  });
  const [saving, setSaving] = useState(false);

  const load = () => {
    setError("");
    return fin
      .expenses()
      .then(setExpenses)
      .catch((e) => setError(`Could not load expenses: ${errMsg(e)}`))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, []);
  useLiveSync(load);

  const totalSpend = useMemo(
    () => expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0),
    [expenses]
  );

  const thisMonth = useMemo(() => {
    const now = new Date();
    return expenses
      .filter((e) => {
        const d = new Date(e.expense_date);
        return (
          !isNaN(d.getTime()) &&
          d.getMonth() === now.getMonth() &&
          d.getFullYear() === now.getFullYear()
        );
      })
      .reduce((s, e) => s + (Number(e.amount) || 0), 0);
  }, [expenses]);

  const byCategory = useMemo(() => {
    const g = new Map<string, number>();
    for (const e of expenses) {
      g.set(e.category, (g.get(e.category) ?? 0) + (Number(e.amount) || 0));
    }
    return Array.from(g.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [expenses]);

  const maxCat = byCategory[0]?.[1] || 1;

  const kpis = [
    { label: "Total expenses", value: aed(totalSpend), hint: `${num(expenses.length)} entries` },
    { label: "This month", value: aed(thisMonth), hint: "current period" },
    { label: "Avg per entry", value: expenses.length ? aed(totalSpend / expenses.length) : aed(0), hint: "across all" },
    { label: "Categories", value: num(byCategory.length), hint: "unique types" },
  ];

  const save = async () => {
    const amt = Number(form.amount);
    if (!amt || amt <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    setSaving(true);
    try {
      await fin.createExpense(
        form.category,
        form.description || null,
        amt,
        form.expense_date,
        null
      );
      toast.success("Expense logged");
      setOpen(false);
      setForm({
        category: "Rent",
        description: "",
        amount: "",
        expense_date: todayYmd(),
      });
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await fin.deleteExpense(id);
      toast.success("Expense deleted");
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Purchase"
        subtitle="Log and track company expenses"
        action={
          <button className="btn-primary" onClick={() => setOpen(true)}>
            <Plus size={16} /> Log Expense
          </button>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-border rounded-xl overflow-hidden bg-card">
        {kpis.map((k, i) => (
          <div
            key={k.label}
            className={cn(
              "p-5 border-b lg:border-b-0 border-border",
              i < 3 && "lg:border-r",
              i % 2 === 0 && "sm:border-r lg:border-r"
            )}
          >
            <div className="text-[13px] text-muted-foreground">{k.label}</div>
            <div className="mt-3 text-[26px] font-semibold text-foreground leading-tight tracking-tight tabular-nums">
              {k.value}
            </div>
            <div className="mt-2 text-[11.5px] text-muted-foreground">{k.hint}</div>
          </div>
        ))}
      </div>

      {/* Category breakdown + expense table */}
      <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 border border-border rounded-xl overflow-hidden bg-card">
        {/* Category breakdown */}
        <div className="p-5 border-b lg:border-b-0 lg:border-r border-border">
          <div className="text-[14px] font-semibold text-foreground">By category</div>
          <div className="text-[12.5px] text-muted-foreground mt-0.5">
            Top spend categories
          </div>
          {byCategory.length === 0 ? (
            <div className="h-[200px] mt-3 grid place-items-center text-[12.5px] text-muted-foreground">
              No expenses recorded
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {byCategory.map(([name, amount]) => (
                <div key={name}>
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="text-foreground">{name}</span>
                    <span className="text-muted-foreground tabular-nums">{aed(amount)}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-foreground"
                      style={{ width: `${(amount / maxCat) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Expense table */}
        <div className="lg:col-span-2">
          <div className="px-5 pt-4 pb-3">
            <div className="text-[14px] font-semibold text-foreground">Recent expenses</div>
            <div className="text-[12.5px] text-muted-foreground mt-0.5">
              All logged company expenses
            </div>
          </div>
          <div className="overflow-x-auto overflow-y-auto">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-card">
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="px-5 py-2.5 font-medium text-[12px]">Date</th>
                  <th className="px-5 py-2.5 font-medium text-[12px]">Category</th>
                  <th className="px-5 py-2.5 font-medium text-[12px]">Description</th>
                  <th className="px-5 py-2.5 font-medium text-[12px] text-right">Amount</th>
                  <th className="px-5 py-2.5 font-medium text-[12px]"></th>
                </tr>
              </thead>
              <tbody>
                {loading && expenses.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                      Loading…
                    </td>
                  </tr>
                )}
                {!loading && expenses.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                      No expenses logged yet
                    </td>
                  </tr>
                )}
                {expenses.map((e) => (
                  <tr
                    key={e.id}
                    className="border-b border-border last:border-0 hover:bg-hover transition-colors"
                  >
                    <td className="px-5 py-3 text-muted-foreground whitespace-nowrap">
                      {fmtDate(e.expense_date)}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone="info">{e.category}</Badge>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground truncate max-w-[200px]">
                      {e.description || "—"}
                    </td>
                    <td className="px-5 py-3 text-right text-foreground tabular-nums font-medium">
                      {aed(Number(e.amount) || 0)}
                    </td>
                    <td className="px-5 py-3">
                      <button
                        onClick={() => remove(e.id)}
                        className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-danger hover:bg-hover"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Add expense modal */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Log expense"
      >
        <div className="space-y-4">
          <Field label="Category">
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="input"
            >
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Description">
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Optional note"
              className="input"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (AED)">
              <input
                type="number"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="0.00"
                className="input"
              />
            </Field>
            <Field label="Date">
              <input
                type="date"
                value={form.expense_date}
                onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
                className="input"
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={save}
              disabled={saving}
            >
              {saving ? "Saving…" : "Log expense"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}