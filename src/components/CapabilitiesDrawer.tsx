import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, SlidersHorizontal } from "lucide-react";
import {
  CAPABILITIES,
  isCapabilityEnabled,
  setCapabilityEnabled,
} from "../lib/capabilities";
import { cn } from "../lib/format";

/* Toggle which action groups the agent may use. Read-only tools (search,
 * stats, lists, navigation, memory, skills) are always allowed. */
export default function CapabilitiesDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [state, setState] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open) return;
    const next: Record<string, boolean> = {};
    for (const c of CAPABILITIES) next[c.id] = isCapabilityEnabled(c.id);
    setState(next);
  }, [open]);

  if (!open) return null;

  const toggle = (id: string) => {
    const v = !(state[id] ?? true);
    setCapabilityEnabled(id, v);
    setState((p) => ({ ...p, [id]: v }));
  };

  // Portaled out of <main>: see SkillsDrawer — WebView2 half-paints a `fixed`
  // overlay that sits inside a scrolling ancestor.
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
            <SlidersHorizontal size={18} className="text-primary-500" />
            <p className="font-semibold text-ink">Capabilities</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-brand-400 hover:text-ink">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 space-y-2 overflow-auto p-4">
          {CAPABILITIES.map((c) => {
            const on = state[c.id] ?? true;
            return (
              <div
                key={c.id}
                className="flex items-start gap-3 rounded-xl border border-brand-200 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{c.name}</p>
                  <p className="text-xs text-brand-400">{c.description}</p>
                </div>
                <button
                  onClick={() => toggle(c.id)}
                  role="switch"
                  aria-checked={on}
                  aria-label={`${c.name} ${on ? "enabled" : "disabled"}`}
                  className={cn(
                    "relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors",
                    on ? "bg-primary-400" : "bg-brand-300"
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all",
                      on ? "left-[18px]" : "left-0.5"
                    )}
                  />
                </button>
              </div>
            );
          })}
        </div>

        <p className="border-t border-brand-200 px-4 py-2.5 text-[11px] text-brand-400">
          Turning a group off blocks those actions for the agent. Reading data,
          navigation, memory and skills are always allowed.
        </p>
      </div>
    </div>,
    document.body
  );
}
