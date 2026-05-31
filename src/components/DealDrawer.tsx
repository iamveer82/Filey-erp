import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Trash2, Building2 } from "lucide-react";
import { crm, type Opportunity } from "../lib/api";
import { aed, fmtDate } from "../lib/format";
import { useUI } from "../lib/ui";
import ActivityTimeline from "./ActivityTimeline";

/* Twenty-style record drawer for a deal: summary, one-tap stage move, and a
 * chronological activity timeline (shared with customer records). */

const STAGES = [
  { id: "qualification", label: "Qualification" },
  { id: "proposal", label: "Proposal" },
  { id: "negotiation", label: "Negotiation" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
];

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

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  if (!opp) return null;

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
        role="dialog"
        aria-modal="true"
        aria-label={`Deal: ${opp.title}`}
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
          <ActivityTimeline relatedTo={opp.title} />
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
