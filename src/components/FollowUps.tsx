import { useEffect, useState, type ReactNode } from "react";
import { Plus, Trash2, AlarmClock, Repeat, Check } from "lucide-react";
import {
  followups,
  nextFollowUpDate,
  type FollowUp,
  type FollowUpRepeat,
} from "../lib/api";
import { Badge } from "./ui";
import { useLiveSync } from "../lib/realtime";
import { useUI } from "../lib/ui";
import { cn, fmtDate } from "../lib/format";
import { DateField } from "./DatePicker";

const todayISO = () => new Date().toISOString().slice(0, 10);

/** Relative label for a date-only (yyyy-mm-dd) due date. */
const relDue = (d: string): string => {
  const today = todayISO();
  if (d === today) return "Today";
  const DAY_MS = 24 * 60 * 60 * 1000;
  // Append T00:00:00Z so both parse as UTC — no timezone drift on date-only strings.
  const diff = Math.round(
    (Date.parse(d + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / DAY_MS
  );
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff < -1) return `Overdue by ${-diff}d`;
  return fmtDate(d);
};

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
  const [repeat, setRepeat] = useState<FollowUpRepeat>("none");
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
        repeat,
      });
      setTitle("");
      setDue(todayISO());
      setCust("");
      setRepeat("none");
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
      if (!f.done && f.repeat && f.repeat !== "none") {
        await followups.complete(f);
        toast.success(
          `Done — next ${f.repeat} reminder on ${fmtDate(nextFollowUpDate(f.due_date, f.repeat))}.`
        );
      } else {
        await followups.update(f.id, { done: !f.done });
      }
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

  type RowStatus = "overdue" | "today" | "upcoming" | "done";
  const statusPill: Record<RowStatus, ReactNode> = {
    overdue: <Badge tone="danger">Overdue</Badge>,
    today: <Badge tone="warn">Today</Badge>,
    upcoming: <Badge tone="neutral">Upcoming</Badge>,
    done: <Badge tone="success">Done</Badge>,
  };

  const statusOf = (f: FollowUp): RowStatus => {
    if (f.done) return "done";
    if (f.due_date < today) return "overdue";
    if (f.due_date === today) return "today";
    return "upcoming";
  };

  const Row = (f: FollowUp, status: RowStatus) => (
    <li
      key={f.id}
      className="-mx-2 flex items-center gap-3 rounded-md border-b border-border px-2 py-3 transition-colors last:border-0 hover:bg-hover"
    >
      <button
        onClick={() => toggle(f)}
        aria-label={f.done ? "Mark not done" : "Mark done"}
        className={cn(
          "grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded-full border transition-colors",
          f.done
            ? "border-primary-400 bg-primary-400 text-neutral-900"
            : "border-border text-transparent hover:text-muted-foreground"
        )}
      >
        <Check size={12} strokeWidth={3} />
      </button>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate text-[13.5px] font-semibold text-foreground",
            f.done && "text-muted-foreground line-through"
          )}
        >
          {f.title}
        </p>
        <p className="text-[11.5px] text-muted-foreground">
          {f.customer_name ? `${f.customer_name} · ` : ""}
          {relDue(f.due_date)}
          {f.repeat && f.repeat !== "none" && (
            <span className="ml-1 inline-flex items-center gap-0.5">
              <Repeat size={10} /> {f.repeat}
            </span>
          )}
        </p>
      </div>
      {statusPill[status]}
      <button
        aria-label="Delete reminder"
        onClick={() => del(f)}
        className="grid h-8 w-8 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-danger"
      >
        <Trash2 size={16} />
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
        <select
          className="select w-auto"
          aria-label="Repeat"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value as FollowUpRepeat)}
        >
          <option value="none">No repeat</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
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
        <div className="empty-gradient rounded-xl p-8 flex flex-col items-center gap-4 text-center">
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
              fill="#f59e0b"
              fill-opacity="0.12"
              stroke="#f59e0b"
              strokeWidth="1.5"
            />
            <line
              x1="34"
              y1="20"
              x2="66"
              y2="20"
              stroke="#f59e0b"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <line
              x1="34"
              y1="28"
              x2="58"
              y2="28"
              stroke="#71717a"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <line
              x1="34"
              y1="36"
              x2="50"
              y2="36"
              stroke="#71717a"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <line
              x1="34"
              y1="44"
              x2="62"
              y2="44"
              stroke="#71717a"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <circle
              cx="50"
              cy="68"
              r="7"
              fill="#f59e0b"
              fill-opacity="0.12"
              stroke="#f59e0b"
              strokeWidth="1.5"
            />
            <path
              d="M47.5 68l1.7 1.7 3.3-3.3"
              stroke="#f59e0b"
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

      {items.length > 0 && <ul>{items.map((f) => Row(f, statusOf(f)))}</ul>}
    </div>
  );
}
