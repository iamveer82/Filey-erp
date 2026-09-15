import { useState, type CSSProperties } from "react";
import { Check, ChevronDown, Hand, RotateCcw, Shield, ShieldCheck, SlidersHorizontal, Zap, ClipboardList } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";
import { AGENT_MODES, type AgentMode } from "../lib/agentMode";
import { aiEffortLevels, EFFORT_LABELS, type AiEffort } from "../lib/aiEndpoint";
import type { AiConfig } from "../lib/ai";
import { cn } from "../lib/format";
import "./AgentComposerControls.css";

const MODE_LABELS: Record<AgentMode, string> = { manual: "Ask for approval", accept_edits: "Approve for me", auto: "Full access", plan: "Plan only" };
const MODE_ICONS = { manual: Hand, accept_edits: ShieldCheck, auto: Shield, plan: ClipboardList };

export function AgentAccessControl({ mode, disabled, onChange, onCapabilities }: {
  mode: AgentMode; disabled: boolean; onChange: (mode: AgentMode) => void; onCapabilities: () => void;
}) {
  const [open, setOpen] = useState(false);
  const Icon = MODE_ICONS[mode];
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" disabled={disabled} aria-label="Agent access" title={MODE_LABELS[mode]}
        className={cn("composer-control max-w-[160px]", mode === "auto" && "text-amber-700 dark:text-amber-400")}>
        <Icon size={14} className="shrink-0" /><span className="truncate">{MODE_LABELS[mode]}</span>
      </button>
    </PopoverTrigger>
    <PopoverContent side="top" align="start" className="w-[340px] !rounded-2xl p-2" data-browser-overlay>
      <p className="px-2 py-2 text-xs font-medium text-muted-foreground">How should Filey approve actions?</p>
      <div role="radiogroup" aria-label="Approval mode" className="space-y-0.5">
        {(["manual", "accept_edits", "auto", "plan"] as const).map(id => {
          const ItemIcon = MODE_ICONS[id];
          return <button key={id} role="radio" aria-checked={mode === id} type="button"
            onClick={() => { onChange(id); setOpen(false); }}
            className={cn("flex w-full items-start gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring", mode === id && "bg-hover")}>
            <ItemIcon size={16} className={cn("mt-0.5 shrink-0", id === "auto" && "text-amber-700 dark:text-amber-400")} />
            <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium">{MODE_LABELS[id]}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{AGENT_MODES.find(m => m.id === id)?.description}</span></span>
            {mode === id && <Check size={14} className="mt-1 shrink-0" />}
          </button>;
        })}
      </div>
      <button type="button" onClick={() => { setOpen(false); onCapabilities(); }} className="mt-1 flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-xs text-muted-foreground hover:bg-hover">
        <SlidersHorizontal size={14} /> Manage action groups
      </button>
    </PopoverContent>
  </Popover>;
}

export function AgentEffortControl({ config, value, disabled, onChange }: {
  config: AiConfig; value: AiEffort; disabled: boolean; onChange: (value: AiEffort) => void;
}) {
  const [open, setOpen] = useState(false);
  const levels = aiEffortLevels(config);
  const selected = levels.includes(value) ? value : "auto";
  const index = levels.indexOf(selected);
  const model = config.model.trim() || "Select model in settings";
  const percent = levels.length > 1 ? index / (levels.length - 1) * 100 : 0;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" disabled={disabled} className="composer-control min-w-0 max-w-full" aria-label={`Reasoning effort: ${EFFORT_LABELS[selected]}`} title={`${model} · ${EFFORT_LABELS[selected]} effort`}>
        <Zap key={selected} size={14} className="effort-change shrink-0" fill={selected === "auto" ? "none" : "currentColor"} />
        <span className="max-w-[132px] truncate text-foreground">{model}</span>
        <span className="shrink-0 text-muted-foreground">{EFFORT_LABELS[selected]}</span>
        <ChevronDown size={12} className="shrink-0 text-muted-foreground" />
      </button>
    </PopoverTrigger>
    <PopoverContent side="top" align="end" className="w-[280px] !rounded-2xl p-4" data-browser-overlay>
      <div className="flex items-start justify-between gap-3">
        <Zap key={selected} size={19} className="effort-change mt-1 text-amber-700 dark:text-primary-400" />
        <div className="min-w-0 flex-1 text-center"><p aria-live="polite" className="text-sm font-semibold">{EFFORT_LABELS[selected]}</p><p className="mt-0.5 truncate text-xs text-muted-foreground" title={model}>{model}</p></div>
        <button type="button" onClick={() => onChange("auto")} disabled={selected === "auto"} aria-label="Reset effort" title="Use the model default" className="rounded-full p-1 text-muted-foreground hover:bg-hover disabled:opacity-40"><RotateCcw size={15} /></button>
      </div>
      {levels.length > 1 ? <>
        <div className="effort-slider mt-5" style={{ "--effort-fill": `${percent}%` } as CSSProperties}>
          <div className="effort-track" aria-hidden="true"><div className="effort-fill"><i /><i /><i /></div></div>
          <input type="range" min={0} max={levels.length - 1} step={1} value={index} aria-label="Reasoning effort" aria-valuetext={EFFORT_LABELS[selected]} onChange={e => onChange(levels[Number(e.target.value)])} />
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-muted-foreground"><span>Default</span><span>{EFFORT_LABELS[levels[levels.length - 1]]}</span></div>
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">More effort gives the model more room to reason. It can take longer and use more tokens.</p>
      </> : <p className="mt-4 text-xs leading-relaxed text-muted-foreground">This model uses its own default. A supported reasoning model enables the effort slider.</p>}
    </PopoverContent>
  </Popover>;
}
