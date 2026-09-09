import { useEffect, useState } from "react";
import { Modal, ErrorBanner } from "./ui";
import {
  CAPABILITIES,
  isCapabilityEnabled,
  setCapabilityEnabled,
} from "../lib/capabilities";
import { AGENT_MODES, getAgentMode, setAgentMode, type AgentMode } from "../lib/agentMode";
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
  const [mode, setMode] = useState<AgentMode>("accept_edits");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const next: Record<string, boolean> = {};
    for (const c of CAPABILITIES) next[c.id] = isCapabilityEnabled(c.id);
    setState(next);
    setMode(getAgentMode());
    setError("");
  }, [open]);

  if (!open) return null;

  const toggle = (id: string) => {
    const v = !(state[id] ?? true);
    try {
      setCapabilityEnabled(id, v);
      setState((p) => ({ ...p, [id]: v }));
      setError("");
    } catch {
      setError("Could not save this access setting. Your previous selection is unchanged.");
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Agent access" size="lg">
      <p className="mb-5 text-[13px] leading-relaxed text-muted-foreground">Choose when Filey asks for approval and which groups of actions it may use. These settings are saved for this account, workspace and storage mode on this device.</p>
      {error && <ErrorBanner message={error} />}
      <fieldset>
        <legend className="mb-3 text-sm font-semibold text-foreground">Approval mode</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {AGENT_MODES.map((m) => {
              const on = mode === m.id;
              return (
                <label
                  key={m.id}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors focus-within:ring-2 focus-within:ring-ring",
                    on
                      ? "border-primary-400/60 bg-primary-400/10"
                      : "border-border bg-card hover:bg-hover"
                  )}
                >
                  <input type="radio" name="agent-approval-mode" value={m.id} checked={on} aria-label={m.name} aria-describedby={`agent-mode-${m.id}`} className="mt-0.5 h-4 w-4 shrink-0 accent-primary-400" onChange={() => { setAgentMode(m.id); setMode(getAgentMode()); }} />
                  <span className="min-w-0"><span className="block text-[13px] font-medium text-foreground">{m.name}</span><span id={`agent-mode-${m.id}`} className="mt-1 block text-xs leading-relaxed text-muted-foreground">{m.description}</span></span>
                </label>
              );
            })}
          </div>
      </fieldset>
      <section className="mt-6" aria-labelledby="agent-action-groups">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h3 id="agent-action-groups" className="text-sm font-semibold text-foreground">Action groups</h3>
          <span className="text-xs tabular-nums text-muted-foreground">{CAPABILITIES.filter((c) => state[c.id] ?? true).length} of {CAPABILITIES.length} enabled</span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">Turning a group off blocks its tools. Enabling one gives permission; external services still need a working connection.</p>
        <div className="divide-y divide-border">
          {CAPABILITIES.map((c) => {
            const on = state[c.id] ?? true;
            return (
              <div
                key={c.id}
                className="flex items-center gap-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-foreground">{c.name}</p>
                  <p id={`agent-capability-${c.id}`} className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{c.description}</p>
                </div>
                <button
                  onClick={() => toggle(c.id)}
                  role="switch"
                  aria-checked={on}
                  aria-label={`${c.name} ${on ? "enabled" : "disabled"}`}
                  aria-describedby={`agent-capability-${c.id}`}
                  className={cn(
                    "btn-ghost min-w-[76px] shrink-0",
                    on && "!border-primary-400/50 !bg-primary-400/15"
                  )}
                >
                  {on ? "Enabled" : "Disabled"}
                </button>
              </div>
            );
          })}
        </div>
      </section>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="max-w-md text-xs leading-relaxed text-muted-foreground">Other lookups and navigation remain available. Autonomous runs follow the same approval mode and action groups.</p>
        <button type="button" className="btn-ghost" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}
