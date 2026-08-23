import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Plus, Trash2, BookOpen } from "lucide-react";
import {
  loadSkills,
  addSkill,
  updateSkill,
  removeSkill,
  type Skill,
} from "../lib/agentSkills";
import { useUI } from "../lib/ui";
import { cn } from "../lib/format";

/* Manage reusable agent skills. The agent sees enabled skills' names +
 * descriptions in its prompt and pulls full instructions via the use_skill
 * tool when relevant. */
export default function SkillsDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const ui = useUI();
  const toastRef = useRef(ui.toast);
  toastRef.current = ui.toast;

  const [skills, setSkills] = useState<Skill[]>([]);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [instructions, setInstructions] = useState("");

  const refresh = () => setSkills(loadSkills());
  useEffect(() => {
    if (open) refresh();
  }, [open]);

  if (!open) return null;

  const create = () => {
    if (!name.trim() || !instructions.trim()) {
      toastRef.current?.error("A skill needs a name and instructions.");
      return;
    }
    addSkill({
      name: name.trim(),
      description: desc.trim() || name.trim(),
      instructions: instructions.trim(),
    });
    setName("");
    setDesc("");
    setInstructions("");
    refresh();
    toastRef.current?.success("Skill added");
  };

  // Mounted from the AgentChat page, i.e. inside <main>, which scrolls. On the
  // desktop build WebView2 composites a `fixed` overlay into its scrolling
  // ancestor's layer and repaints only part of it, so the drawer has to leave
  // that subtree via a portal.
  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/40"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="absolute right-0 top-0 flex h-full w-[26rem] max-w-[90vw] flex-col bg-white shadow-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-brand-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <BookOpen size={18} className="text-primary-500" />
            <p className="font-semibold text-ink">Skills</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-brand-400 hover:text-ink">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          <div className="rounded-xl border border-brand-200 p-3">
            <p className="label">New skill</p>
            <input
              className="input mb-2"
              placeholder="Name, e.g. 'Monthly VAT report'"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="input mb-2"
              placeholder="One-line description (when to use it)"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
            <textarea
              className="textarea mb-2 min-h-[96px]"
              placeholder="Step-by-step instructions the agent should follow when using this skill…"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
            <button className="btn-primary h-9 w-full text-sm" onClick={create}>
              <Plus size={14} /> Add skill
            </button>
          </div>

          <div className="mt-4 space-y-2">
            {skills.length === 0 ? (
              <p className="py-6 text-center text-sm text-brand-500">
                No skills yet. Teach the agent a reusable procedure above.
              </p>
            ) : (
              skills.map((s) => (
                <div
                  key={s.id}
                  className="rounded-xl border border-brand-200 p-3"
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{s.name}</p>
                      <p className="truncate text-xs text-brand-400">{s.description}</p>
                    </div>
                    <button
                      onClick={() => {
                        updateSkill(s.id, { enabled: !s.enabled });
                        refresh();
                      }}
                      title={s.enabled ? "Enabled - click to disable" : "Disabled - click to enable"}
                      className={cn(
                        "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                        s.enabled ? "bg-primary-400" : "bg-brand-300"
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all",
                          s.enabled ? "left-[18px]" : "left-0.5"
                        )}
                      />
                    </button>
                  </div>
                  <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap text-[11px] text-brand-500">
                    {s.instructions}
                  </p>
                  <button
                    onClick={() => {
                      removeSkill(s.id);
                      refresh();
                    }}
                    className="mt-2 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-brand-400 hover:text-danger"
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <p className="border-t border-brand-200 px-4 py-2.5 text-[11px] text-brand-400">
          Enabled skills appear to the agent by name; it loads the full steps
          on demand with the use_skill tool.
        </p>
      </div>
    </div>,
    document.body
  );
}
