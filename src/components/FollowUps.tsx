import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Plus, Trash2, AlarmClock } from "lucide-react";
import { followups, type FollowUp } from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { useUI } from "../lib/ui";
import { cn, fmtDate } from "../lib/format";
import { DateField } from "./DatePicker";

const todayISO = () => new Date().toISOString().slice(0, 10);

type CustomerOpt = { id: number; name: string; company?: string };

/** Follow-ups / reminders. Scoped to one customer when `customerId` is set,
 * otherwise global (pass `customers` to attach a reminder to one). */
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

  const load = () =>
    followups
      .list(customerId)
      .then(setItems)
      .catch((e) =>
        toast.error("Failed to load follow-ups: " + (e instanceof Error ? e.message : e))
      );
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);
  useLiveSync(load);

  const [hint, setHint] = useState(false);
  const add = async () => {
    if (!title.trim()) {
      setHint(true);
      return;
    }
    setBusy(true);
    try {
      const selected = customers?.find((c) => c.id === cust);
      await followups.create({
        title: title.trim(),
        due_date: due,
        customer_id: customerId ?? (cust === "" ? null : Number(cust)),
        customer_name: customerName ?? selected?.company ?? selected?.name ?? "",
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
    try {
      await followups.update(f.id, { done: !f.done });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const del = async (f: FollowUp) => {
    const ok = await confirm({
      title: "Delete reminder",
      message: `Delete "${f.title}"?`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await followups.remove(f.id);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
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
      className="flex items-center gap-3 border-b border-brand-100 py-2.5 last:border-0"
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
            "truncate text-sm font-medium text-ink",
            f.done && "text-brand-400 line-through"
          )}
        >
          {f.title}
        </p>
        <p className="text-[11px] text-brand-400">
          {f.customer_name ? `${f.customer_name} · ` : ""}
          {fmtDate(f.due_date)}
          {tone === "overdue" && (
            <span className="ml-1 font-medium text-danger">overdue</span>
          )}
          {tone === "today" && (
            <span className="ml-1 font-medium text-primary-700">today</span>
          )}
        </p>
      </div>
      <button
        aria-label="Delete reminder"
        onClick={() => del(f)}
        className="rounded-full p-1.5 text-brand-400 hover:bg-danger/10 hover:text-danger cursor-pointer"
      >
        <Trash2 size={14} />
      </button>
    </li>
  );

  return (
    <div className="card">
      <div className="mb-3 flex items-center gap-2">
        <AlarmClock size={16} className="text-primary-600" />
        <p className="font-medium text-ink">Follow-ups &amp; reminders</p>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <input
          className="input min-w-[180px] flex-1"
          placeholder="e.g. Ask Mr Sharma about the oil purchase"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setHint(false);
          }}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        {!customerId && customers && (
          <select
            className="select w-auto"
            value={cust}
            onChange={(e) => setCust(e.target.value === "" ? "" : Number(e.target.value))}
          >
            <option value="">No customer</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company || c.name}
              </option>
            ))}
          </select>
        )}
        <DateField
          className="w-44"
          value={due}
          onChange={setDue}
          clearable={false}
        />
        <button className="btn-primary" disabled={busy || !title.trim()} onClick={add}>
          <Plus size={16} /> Add
        </button>
      </div>

      {hint && (
        <p className="-mt-2 mb-3 text-[11px] text-danger">
          Type a note before adding.
        </p>
      )}

      {items.length === 0 && (
        <div className="empty-gradient rounded-3xl p-8 flex flex-col items-center gap-4 text-center">
          <svg
            width="100"
            height="80"
            viewBox="0 0 100 80"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="opacity-80"
          >
            <rect
              x="24"
              y="8"
              width="52"
              height="44"
              rx="5"
              fill="#FFF3C4"
              stroke="#E0AE00"
              strokeWidth="1.5"
            />
            <line
              x1="34"
              y1="20"
              x2="66"
              y2="20"
              stroke="#E0AE00"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <line
              x1="34"
              y1="28"
              x2="58"
              y2="28"
              stroke="#D4D4D8"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <line
              x1="34"
              y1="36"
              x2="50"
              y2="36"
              stroke="#D4D4D8"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <line
              x1="34"
              y1="44"
              x2="62"
              y2="44"
              stroke="#D4D4D8"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <circle
              cx="50"
              cy="68"
              r="7"
              fill="#FFFBEB"
              stroke="#E0AE00"
              strokeWidth="1.5"
            />
            <path
              d="M47.5 68l1.7 1.7 3.3-3.3"
              stroke="#B88C00"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div>
            <p className="text-sm font-medium text-brand-700">No reminders yet</p>
            <p className="text-xs text-brand-500 mt-1">
              Add a note with a date — we'll remind you that day.
            </p>
          </div>
        </div>
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
      <p className="mb-1 text-[10px] font-medium text-brand-400">{label}</p>
      <ul>{children}</ul>
    </div>
  );
}
