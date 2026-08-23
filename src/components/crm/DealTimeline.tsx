import { useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  CheckSquare,
  Loader2,
  Mail,
  PhoneCall,
  Plus,
  Square,
  StickyNote,
} from "lucide-react";
import { crm, type Activity } from "../../lib/api";
import { fmtDate } from "../../lib/format";
import { useUI } from "../../lib/ui";
import { SelectMenu } from "../ui-menu";

/** Deal record-panel timeline: quick-add composer plus a chronological feed
 *  of notes / tasks / calls / emails / meetings, each with its typed icon.
 *  Ordered oldest-first (newest LAST at the bottom, like a conversation) and
 *  auto-scrolled there. Same related_to contract as ActivityTimeline —
 *  activities link to the deal through Activity.related_to = deal title. */

const KINDS = [
  { id: "note", label: "Note", Icon: StickyNote },
  { id: "task", label: "Task", Icon: CheckSquare },
  { id: "call", label: "Call", Icon: PhoneCall },
  { id: "email", label: "Email", Icon: Mail },
  { id: "meeting", label: "Meeting", Icon: CalendarDays },
];
const kindIcon = (k: string) =>
  KINDS.find((x) => x.id === k)?.Icon ?? StickyNote;
const sortAsc = (a: Activity, b: Activity) =>
  +new Date(a.created_at) - +new Date(b.created_at);

export default function DealTimeline({ relatedTo }: { relatedTo: string }) {
  const { toast } = useUI();
  const [acts, setActs] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState("");
  const [kind, setKind] = useState("note");
  const [adding, setAdding] = useState(false);
  // Newest lands at the bottom — keep the viewport pinned to it.
  const scrollRef = useRef<HTMLDivElement>(null);

  const reload = async () => {
    const all = await crm.activities();
    setActs(all.filter((a) => a.related_to === relatedTo).sort(sortAsc));
  };

  useEffect(() => {
    let dead = false;
    setLoading(true);
    setSubject("");
    crm
      .activities()
      .then((all) => {
        if (dead) return;
        setActs(all.filter((a) => a.related_to === relatedTo).sort(sortAsc));
      })
      .finally(() => !dead && setLoading(false));
    return () => {
      dead = true;
    };
  }, [relatedTo]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [acts, loading]);

  const add = async () => {
    if (!subject.trim()) return;
    setAdding(true);
    try {
      await crm.createActivity({
        kind,
        subject: subject.trim(),
        related_to: relatedTo,
      });
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
        <SelectMenu
          size="sm"
          ariaLabel="Activity type"
          value={kind}
          onChange={(v) => setKind(v)}
          options={KINDS.map((k) => ({ value: k.id, label: k.label }))}
        />
        <input
          className="input h-8 flex-1 text-[13px]"
          placeholder="Add a note or task…"
          aria-label="New activity"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button
          type="button"
          onClick={add}
          disabled={adding || !subject.trim()}
          aria-label="Add activity"
          className="btn-primary h-8 !px-2.5"
        >
          {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
        </button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {loading ? (
          <div className="grid h-24 place-items-center">
            <Loader2 size={18} className="animate-spin text-muted-foreground" />
          </div>
        ) : !acts.length ? (
          <p className="py-8 text-center text-xs text-muted-foreground">
            No activity yet. Add the first note above.
          </p>
        ) : (
          acts.map((a) => {
            const Icon = kindIcon(a.kind);
            const isTask = a.kind === "task";
            return (
              <div
                key={a.id}
                className="flex items-start gap-2.5 rounded-md border border-border bg-background p-2.5"
              >
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                  <Icon size={14} strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-[13px] text-foreground ${
                      a.done ? "text-muted-foreground line-through" : ""
                    }`}
                  >
                    {a.subject}
                  </p>
                  <p className="text-[11px] text-muted-foreground tabular-nums">
                    {a.kind} · {fmtDate(a.created_at)}
                  </p>
                </div>
                {isTask && (
                  <button
                    type="button"
                    onClick={() => toggle(a)}
                    aria-label={a.done ? "Mark not done" : "Mark done"}
                    className="mt-0.5 text-muted-foreground transition-colors hover:text-primary-500"
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
