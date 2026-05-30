import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Trash2,
  Plus,
  StickyNote,
  Phone,
  Mail,
  CalendarDays,
  CheckSquare,
  Square,
  Loader2,
  Building2,
} from "lucide-react";
import { crm, type Opportunity, type Activity } from "../lib/api";
import { aed, fmtDate } from "../lib/format";
import { useUI } from "../lib/ui";

/* Twenty-style record drawer for a deal: summary + a chronological activity
 * timeline (notes / tasks / calls / emails). Activities are linked to the deal
 * through Activity.related_to = the deal title (no schema change needed). */

const STAGES = [
  { id: "qualification", label: "Qualification" },
  { id: "proposal", label: "Proposal" },
  { id: "negotiation", label: "Negotiation" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
];

const KINDS = [
  { id: "note", label: "Note", Icon: StickyNote },
  { id: "task", label: "Task", Icon: CheckSquare },
  { id: "call", label: "Call", Icon: Phone },
  { id: "email", label: "Email", Icon: Mail },
  { id: "meeting", label: "Meeting", Icon: CalendarDays },
];
const kindIcon = (k: string) => (KINDS.find((x) => x.id === k)?.Icon ?? StickyNote);

export default function DealDrawer({
  opp,
  onClose,
  onChange,
}: {
  opp: Opportunity | null;
  onClose: () => void;
  /** Called after a change that affects the board (stage move, delete). */
  onChange: () => void;
}) {
  const { toast, confirm } = useUI();
  const [acts, setActs] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState("");
  const [kind, setKind] = useState("note");
  const [adding, setAdding] = useState(false);

  const relatedKey = opp?.title ?? "";

  useEffect(() => {
    if (!opp) return;
    let dead = false;
    setLoading(true);
    setSubject("");
    crm
      .activities()
      .then((all) => {
        if (dead) return;
        setActs(
          all
            .filter((a) => a.related_to === relatedKey)
            .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
        );
      })
      .finally(() => !dead && setLoading(false));
    return () => {
      dead = true;
    };
  }, [opp, relatedKey]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  if (!opp) return null;

  const reloadActs = async () => {
    const all = await crm.activities();
    setActs(
      all
        .filter((a) => a.related_to === relatedKey)
        .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
    );
  };

  const add = async () => {
    if (!subject.trim()) return;
    setAdding(true);
    try {
      await crm.createActivity({ kind, subject: subject.trim(), related_to: relatedKey });
      setSubject("");
      await reloadActs();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  };

  const toggle = async (a: Activity) => {
    try {
      await crm.toggleActivity(a.id);
      await reloadActs();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const moveStage = async (stage: string) => {
    if (stage === opp.stage) return;
    try {
      await crm.setOppStage(opp.id, stage);
      onChange();
      toast.success(`Moved to ${STAGES.find((s) => s.id === stage)?.label ?? stage}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const del = async () => {
    const ok = await confirm({
      title: "Delete deal?",
      message: `“${opp.title}” will be permanently removed.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await crm.deleteOpportunity(opp.id);
      onChange();
      onClose();
      toast.success("Deal deleted.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col bg-white shadow-bento-hover dark:bg-[#1E2025] animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-brand-200 p-4 dark:border-[#3A3D45]">
          <div className="min-w-0">
            <p className="truncate text-base font-bold text-ink">{opp.title}</p>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-brand-500">
              <Building2 size={12} /> {opp.customer_name || "—"}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-brand-400 hover:bg-brand-50 dark:hover:bg-white/5" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 gap-3 border-b border-brand-200 p-4 dark:border-[#3A3D45]">
          <Field label="Value" value={aed(opp.value)} />
          <Field label="Probability" value={`${opp.probability}%`} />
          {opp.expected_close && <Field label="Expected close" value={fmtDate(opp.expected_close)} />}
          {opp.owner && <Field label="Owner" value={opp.owner} />}
        </div>

        {/* Stage mover */}
        <div className="border-b border-brand-200 p-4 dark:border-[#3A3D45]">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-brand-400">Stage</p>
          <div className="flex flex-wrap gap-1.5">
            {STAGES.map((s) => (
              <button
                key={s.id}
                onClick={() => moveStage(s.id)}
                className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
                  s.id === opp.stage
                    ? "bg-primary-500 text-[#0A0A0A]"
                    : "bg-brand-100 text-brand-600 hover:bg-brand-200 dark:bg-white/5 dark:text-[#C9CDD3] dark:hover:bg-white/10"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Timeline */}
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-brand-400">Timeline</p>

          {/* Quick add */}
          <div className="mb-3 flex items-center gap-2">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="select h-9 !py-0 text-xs"
            >
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
                      <p className={`text-sm text-ink ${a.done ? "text-brand-400 line-through" : ""}`}>
                        {a.subject}
                      </p>
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

        {/* Footer */}
        <div className="border-t border-brand-200 p-3 dark:border-[#3A3D45]">
          <button onClick={del} className="btn-ghost w-full text-danger">
            <Trash2 size={14} /> Delete deal
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-400">{label}</p>
      <p className="text-sm font-bold text-ink">{value}</p>
    </div>
  );
}
