import { useEffect, useState } from "react";
import {
  Plus,
  StickyNote,
  Phone,
  Mail,
  CalendarDays,
  CheckSquare,
  Square,
  Loader2,
} from "lucide-react";
import { crm, type Activity } from "../lib/api";
import { fmtDate } from "../lib/format";
import { useUI } from "../lib/ui";

/* Reusable chronological activity feed (notes / tasks / calls / emails /
 * meetings) for any CRM record. Activities link to the record through
 * Activity.related_to = the supplied key (deal title, customer name, …). */

const KINDS = [
  { id: "note", label: "Note", Icon: StickyNote },
  { id: "task", label: "Task", Icon: CheckSquare },
  { id: "call", label: "Call", Icon: Phone },
  { id: "email", label: "Email", Icon: Mail },
  { id: "meeting", label: "Meeting", Icon: CalendarDays },
];
const kindIcon = (k: string) => KINDS.find((x) => x.id === k)?.Icon ?? StickyNote;
const sortDesc = (a: Activity, b: Activity) =>
  +new Date(b.created_at) - +new Date(a.created_at);

export default function ActivityTimeline({ relatedTo }: { relatedTo: string }) {
  const { toast } = useUI();
  const [acts, setActs] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState("");
  const [kind, setKind] = useState("note");
  const [adding, setAdding] = useState(false);

  const reload = async () => {
    const all = await crm.activities();
    setActs(all.filter((a) => a.related_to === relatedTo).sort(sortDesc));
  };

  useEffect(() => {
    let dead = false;
    setLoading(true);
    setSubject("");
    crm
      .activities()
      .then((all) => {
        if (dead) return;
        setActs(all.filter((a) => a.related_to === relatedTo).sort(sortDesc));
      })
      .finally(() => !dead && setLoading(false));
    return () => {
      dead = true;
    };
  }, [relatedTo]);

  const add = async () => {
    if (!subject.trim()) return;
    setAdding(true);
    try {
      await crm.createActivity({ kind, subject: subject.trim(), related_to: relatedTo });
      setSubject("");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  };

  const toggle = async (a: Activity) => {
    try {
      await crm.toggleActivity(a.id);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Quick add */}
      <div className="mb-3 flex items-center gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="select h-9 !py-0 text-xs">
          {KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
        <input
          className="input h-9 flex-1 text-sm"
          placeholder="Add a note or task…"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button onClick={add} disabled={adding || !subject.trim()} className="btn-primary h-9 !px-3">
          {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {loading ? (
          <div className="grid h-24 place-items-center">
            <Loader2 size={18} className="animate-spin text-brand-400" />
          </div>
        ) : !acts.length ? (
          <p className="py-8 text-center text-xs text-brand-400">
            No activity yet. Add the first note above.
          </p>
        ) : (
          acts.map((a) => {
            const Icon = kindIcon(a.kind);
            const isTask = a.kind === "task";
            return (
              <div key={a.id} className="flex items-start gap-2.5 rounded-xl border border-brand-200 p-2.5 dark:border-[#3A3D45]">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-100 text-brand-500 dark:bg-white/5">
                  <Icon size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm text-ink ${a.done ? "text-brand-400 line-through" : ""}`}>{a.subject}</p>
                  <p className="text-[11px] text-brand-400">
                    {a.kind} · {fmtDate(a.created_at)}
                  </p>
                </div>
                {isTask && (
                  <button
                    onClick={() => toggle(a)}
                    title={a.done ? "Mark not done" : "Mark done"}
                    className="mt-0.5 text-brand-400 hover:text-primary-500"
                  >
                    {a.done ? <CheckSquare size={16} /> : <Square size={16} />}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
