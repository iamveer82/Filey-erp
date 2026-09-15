import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Paperclip } from "lucide-react";
import { Link } from "react-router-dom";
import { fin, type Expense } from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { aed, fmtDate, num, errMsg } from "../lib/format";
import { PageHeader, Badge, ErrorBanner, MetricCard } from "../components/ui";
import { useUI } from "../lib/ui";

export default function Purchase() {
  const { toast, confirm } = useUI();
  const [removing, setRemoving] = useState<number | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
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

  const avgEntry = expenses.length ? totalSpend / expenses.length : 0;

  const remove = async (id: number) => {
    if (removing !== null || !await confirm({ title: "Delete this expense?", message: "This also reverses its accounting entries. The receipt remains in My Files.", confirmLabel: "Delete expense", danger: true })) return;
    setRemoving(id);
    try {
      await fin.deleteExpense(id);
      toast.success("Expense deleted");
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally { setRemoving(null); }
  };

  return (
    <div className="">
      <PageHeader
        title="Purchase"
        subtitle="Log and track company expenses"
        action={
          <Link className="btn-primary" to="/purchase/new">
            <Plus size={16} /> Log expense
          </Link>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      {/* KPI cards — same quiet strip as Invoicing */}
      <div className="grid grid-cols-2 lg:grid-cols-4 joined-kpis mb-4">
        <MetricCard
          label="Total expenses"
          value={aed(totalSpend)}
          change={`${num(expenses.length)} entries`}
          changeTone="up"
        />
        <MetricCard
          label="This month"
          value={aed(thisMonth)}
          change="Current period"
          changeTone="up"
        />
        <MetricCard
          label="Avg per entry"
          value={aed(avgEntry)}
          change="Across all"
          changeTone="up"
        />
        <MetricCard
          label="Categories"
          value={num(byCategory.length)}
          change="Unique types"
          changeTone="up"
        />
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
                      <Link className="font-medium text-foreground hover:underline" to={`/purchase/${e.id}`}>{e.details?.vendor || e.description || e.category}</Link>
                      {e.details?.receipt && <Paperclip size={13} className="ml-2 inline" aria-label="Receipt attached" />}
                    </td>
                    <td className="px-5 py-3 text-right text-foreground tabular-nums font-medium">
                      {aed(Number(e.amount) || 0)}
                    </td>
                    <td className="px-5 py-3">
                      <button
                        onClick={() => void remove(e.id)}
                        disabled={removing !== null}
                        aria-label={`Delete ${e.category} expense from ${fmtDate(e.expense_date)}`}
                        className="btn-ghost w-10 !px-0 text-danger"
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


    </div>
  );
}
