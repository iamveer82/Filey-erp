import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Plus, Trash2, AlarmClock } from "lucide-react";
import { followups, type FollowUp } from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { useUI } from "../lib/ui";
import { cn, fmtDate } from "../lib/format";

const todayISO = () => new Date().toISOString().slice(0, 10);

type CustomerOpt = { id: number; name: string; company?: string };

/** Follow-ups / reminders. Scoped to one customer when `customerId` is set,
 *  otherwise global (pass `customers` to attach a reminder to one). */
export default function FollowUps({
  customerId,
  customerName,
  customers,
}: {
  customerId?: number;
  customerName?: string;
  customers?: CustomerOpt[];
}) {
  const { toast, confirm } = useUI();
  const [items, setItems] = useState<FollowUp[]>([]);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(todayISO());
  const [cust, setCust] = useState<number | "">("");
  const [busy, setBusy] = useState(false);

  const load = () => followups.list(customerId).then(setItems).catch(() => {});
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);
  useLiveSync(load);

  const add = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const selected = customers?.find((c) => c.id === cust);
      await followups.create({
        title: title.trim(),
        due_date: due,
        customer_id: customerId ?? (cust === "" ? null : Number(cust)),
        customer_name:
          customerName ?? selected?.company ?? selected?.name ?? "",
      });
      setTitle("");
      setDue(todayISO());
      setCust("");
      load();
      toast.success("Reminder added — we'll surface it when it's due.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (f: FollowUp) => {
    await followups.update(f.id, { done: !f.done });
    load();
  };
  const del = async (f: FollowUp) => {
    const ok = await confirm({
      title: "Delete reminder",
      message: `Delete "${f.title}"?`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await followups.remove(f.id);
    load();
  };

  const today = todayISO();
  const groups = useMemo(() => {
    const open = items.filter((f) => !f.done);
    return {
      overdue: open.filter((f) => f.due_date < today),
      today: open.filter((f) => f.due_date === today),
      upcoming: open.filter((f) => f.due_date > today),
      done: items.filter((f) => f.done),
    };
  }, [items, today]);

  const Row = (f: FollowUp, tone?: "overdue" | "today") => (
    <li
      key={f.id}
      className="flex items-center gap-3 border-b border-brand-100 dark:border-[#2A2C33] py-2.5 last:border-0"
    >
      <input
        type="checkbox"
        checked={f.done}
        onChange={() => toggle(f)}
        aria-label="Mark done"
        className="cursor-pointer"
      />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate text-sm font-semibold text-ink",
            f.done && "text-brand-400 line-through"
          )}
        >
          {f.title}
        </p>
        <p className="text-[11px] text-brand-400">
          {f.customer_name ? `${f.customer_name} · ` : ""}
          {fmtDate(f.due_date)}
          {tone === "overdue" && (
            <span className="ml-1 font-semibold text-danger">overdue</span>
          )}
          {tone === "today" && (
            <span className="ml-1 font-semibold text-primary-700">today</span>
          )}
        </p>
      </div>
      <button
        aria-label="Delete reminder"
        onClick={() => del(f)}
        className="rounded-lg p-1.5 text-brand-400 hover:bg-danger/10 hover:text-danger cursor-pointer"
      >
        <Trash2 size={14} />
      </button>
    </li>
  );

  return (
    <div className="card">
      <div className="mb-3 flex items-center gap-2">
        <AlarmClock size={16} className="text-primary-600" />
        <p className="font-bold text-ink">Follow-ups &amp; reminders</p>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <input
          className="input min-w-[180px] flex-1"
          placeholder="e.g. Ask Mr Sharma about the oil purchase"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        {!customerId && customers && (
          <select
            className="select w-auto"
            value={cust}
            onChange={(e) =>
              setCust(e.target.value === "" ? "" : Number(e.target.value))
            }
          >
            <option value="">No customer</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company || c.name}
              </option>
            ))}
          </select>
        )}
        <input
          type="date"
          className="input w-auto"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
        <button className="btn-primary" disabled={busy || !title.trim()} onClick={add}>
          <Plus size={16} /> Add
        </button>
      </div>

      {items.length === 0 && (
        <p className="py-2 text-sm text-brand-400">
          No reminders yet. Add a note with a date — we'll remind you that day.
        </p>
      )}

      {groups.overdue.length > 0 && (
        <Section label="Overdue">{groups.overdue.map((f) => Row(f, "overdue"))}</Section>
      )}
      {groups.today.length > 0 && (
        <Section label="Today">{groups.today.map((f) => Row(f, "today"))}</Section>
      )}
      {groups.upcoming.length > 0 && (
        <Section label="Upcoming">{groups.upcoming.map((f) => Row(f))}</Section>
      )}
      {groups.done.length > 0 && (
        <Section label="Done">{groups.done.map((f) => Row(f))}</Section>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-brand-400">
        {label}
      </p>
      <ul>{children}</ul>
    </div>
  );
}
