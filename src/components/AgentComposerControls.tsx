import { useId, useState, type CSSProperties } from "react";
import { Check, ChevronDown, Gauge, Hand, RotateCcw, Shield, ShieldCheck, SlidersHorizontal, Zap, ClipboardList } from "lucide-react";
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
        className="composer-control composer-access max-w-[160px] text-foreground">
        <Icon size={18} className="shrink-0" /><span className="composer-detail truncate">{MODE_LABELS[mode]}</span>
      </button>
    </PopoverTrigger>
    <PopoverContent side="top" align="start" collisionPadding={12} className="max-h-[var(--radix-popover-content-available-height)] w-[340px] overflow-y-auto p-2" data-browser-overlay>
      <p className="px-2 py-2 text-xs font-medium text-muted-foreground">How should Filey approve actions?</p>
      <div role="radiogroup" aria-label="Approval mode" className="space-y-0.5">
        {(["manual", "accept_edits", "auto", "plan"] as const).map(id => {
          const ItemIcon = MODE_ICONS[id];
          return <button key={id} role="radio" aria-checked={mode === id} type="button"
            onClick={() => { onChange(id); setOpen(false); }}
            className={cn("flex w-full items-start gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring", mode === id && "bg-hover")}>
            <ItemIcon size={16} className="mt-0.5 shrink-0" />
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

export function AgentEffortControl(props: {
  config: AiConfig; value: AiEffort; disabled: boolean; onChange: (value: AiEffort) => void;
  reasoningEnabled?: boolean; onReasoningChange?: (enabled: boolean) => void;
}) {
  if (props.config.billing === "credits") return <AgentManagedEffortControl {...props} />;
  return <AgentProviderEffortControl {...props} />;
}

const MANAGED_LEVELS = ["auto", "low", "high", "max"] as const;
const MANAGED_LABELS = ["Fast", "Low", "High", "Maximum"] as const;

function AgentManagedEffortControl({ value, disabled, onChange, reasoningEnabled, onReasoningChange }: {
  value: AiEffort; disabled: boolean; onChange: (value: AiEffort) => void;
  reasoningEnabled?: boolean; onReasoningChange?: (enabled: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const advancedId = useId();
  const enabled = reasoningEnabled === true;
  const effort = value === "high" || value === "max" ? value : "low";
  const index = enabled ? MANAGED_LEVELS.indexOf(effort) : 0;
  const label = MANAGED_LABELS[index];
  const locked = disabled || !onReasoningChange;
  const selectLevel = (next: number) => {
    if (locked || !Number.isInteger(next) || next < 0 || next >= MANAGED_LEVELS.length) return;
    if (next > 0) onChange(MANAGED_LEVELS[next]);
    onReasoningChange?.(next > 0);
  };
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" disabled={locked} className="composer-control composer-effort min-w-0 max-w-full"
        aria-label={`Filey AI effort: ${label}`} title={enabled ? `Filey AI · ${label} reasoning` : "Filey AI · Fast · Reasoning off"}>
        <Gauge size={18} className="shrink-0" />
        <span className="composer-detail text-foreground">Filey AI</span>
        <span className="composer-detail text-muted-foreground">{label}</span>
        <ChevronDown size={12} className="composer-detail shrink-0 text-muted-foreground" />
      </button>
    </PopoverTrigger>
    <PopoverContent side="top" align="end" collisionPadding={12}
      className="effort-managed max-h-[var(--radix-popover-content-available-height)] w-[340px] overflow-y-auto p-4" data-browser-overlay>
      <div className="flex items-center justify-between gap-3">
        <div><p className="text-sm font-semibold">Filey AI</p><p aria-live="polite" className="mt-0.5 text-xs text-muted-foreground">{enabled ? `${label} reasoning` : "Fast · Reasoning off"}</p></div>
        <button type="button" disabled={locked || !enabled} onClick={() => selectLevel(0)} aria-label="Reset to fast mode"
          title="Turn reasoning off" className="effort-option-button rounded-full text-muted-foreground hover:bg-hover disabled:opacity-40"><RotateCcw size={16} /></button>
      </div>
      <div className="effort-slider mt-4" style={{ "--effort-fill": `${index / (MANAGED_LEVELS.length - 1) * 100}%` } as CSSProperties}>
        <div className="effort-track" aria-hidden="true"><div className="effort-fill" /></div>
        <div className="effort-stops" aria-hidden="true">{MANAGED_LEVELS.map(level => <span key={level} />)}</div>
        <input type="range" min={0} max={MANAGED_LEVELS.length - 1} step={1} value={index} disabled={locked}
          aria-label="Filey AI effort" aria-valuetext={enabled ? `${label} reasoning` : "Fast, reasoning off"}
          onChange={event => selectLevel(Number(event.target.value))} />
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted-foreground"><span>Fast</span><span>Maximum</span></div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{enabled ? "More reasoning can help with complex tasks and takes longer." : "Quick replies for everyday invoices and finance tasks."}</p>
      <button type="button" aria-expanded={advanced} aria-controls={advancedId} onClick={() => setAdvanced(!advanced)}
        className="mt-2 flex min-h-11 w-full items-center justify-between rounded-lg text-sm hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring">
        <span>Advanced</span><ChevronDown size={16} className={cn("transition-transform motion-reduce:transition-none", advanced && "rotate-180")} />
      </button>
      {advanced && <div id={advancedId} className="mt-1 divide-y divide-border rounded-xl border border-border px-3">
        <div className="flex min-h-11 items-center justify-between gap-3 text-sm"><span className="text-muted-foreground">Model</span><span>Filey AI</span></div>
        <div className="flex min-h-12 items-center justify-between gap-3 text-sm">
          <span>Reasoning</span>
          <button type="button" role="switch" aria-label="Reasoning" aria-checked={enabled} disabled={locked}
            onClick={() => { if (!locked) onReasoningChange?.(!enabled); }} className="effort-option-button inline-flex items-center gap-2 rounded-lg disabled:opacity-40">
            <span className="text-xs text-muted-foreground">{enabled ? "On" : "Off"}</span>
            <span aria-hidden="true" className={cn("relative h-5 w-9 rounded-full transition-colors motion-reduce:transition-none", enabled ? "bg-foreground" : "bg-muted-foreground/40")}>
              <span className={cn("absolute left-0 top-0.5 h-4 w-4 rounded-full bg-background transition-transform motion-reduce:transition-none", enabled ? "translate-x-[18px]" : "translate-x-0.5")} />
            </span>
          </button>
        </div>
        <label className="flex min-h-12 items-center justify-between gap-3 text-sm"><span className="text-muted-foreground">Reasoning effort</span>
          <select aria-label="Reasoning level" value={effort} disabled={locked || !enabled}
            onChange={event => {
              const next = event.target.value;
              if (!locked && enabled && (next === "low" || next === "high" || next === "max")) onChange(next);
            }}
            className="min-h-11 rounded-lg bg-transparent px-2 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">
            <option value="low">Low</option><option value="high">High</option><option value="max">Maximum</option>
          </select>
        </label>
      </div>}
    </PopoverContent>
  </Popover>;
}

function AgentProviderEffortControl({ config, value, disabled, onChange }: {
  config: AiConfig; value: AiEffort; disabled: boolean; onChange: (value: AiEffort) => void;
}) {
  const [open, setOpen] = useState(false);
  const levels = aiEffortLevels(config);
  const selected = levels.includes(value) ? value : "auto";
  const index = levels.indexOf(selected);
  const model = config.model.trim() || (config.billing ? "Choose a model" : "Select model in settings");
  const percent = levels.length > 1 ? index / (levels.length - 1) * 100 : 0;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" disabled={disabled} className="composer-control composer-effort min-w-0 max-w-full" aria-label={`Reasoning effort: ${EFFORT_LABELS[selected]}`} title={`${model} · ${EFFORT_LABELS[selected]} effort`}>
        <Zap key={selected} size={18} className="effort-change shrink-0" fill={selected === "auto" ? "none" : "currentColor"} />
        <span className="composer-detail max-w-[160px] truncate text-foreground">{model}</span>
        <span className="composer-detail shrink-0 text-muted-foreground">{EFFORT_LABELS[selected]}</span>
        <ChevronDown size={12} className="composer-detail shrink-0 text-muted-foreground" />
      </button>
    </PopoverTrigger>
    <PopoverContent side="top" align="end" collisionPadding={12} className="max-h-[var(--radix-popover-content-available-height)] w-[280px] overflow-y-auto p-4" data-browser-overlay>
      <div className="flex items-start justify-between gap-3">
        <Zap key={selected} size={19} className="effort-change mt-1 text-foreground" />
        <div className="min-w-0 flex-1 text-center"><p aria-live="polite" className="text-sm font-semibold">{EFFORT_LABELS[selected]}</p><p className="mt-0.5 truncate text-xs text-muted-foreground" title={model}>{model}</p></div>
        <button type="button" onClick={() => onChange("auto")} disabled={disabled || selected === "auto"} aria-label="Reset effort" title="Use the model default" className="rounded-full p-1 text-muted-foreground hover:bg-hover disabled:opacity-40"><RotateCcw size={15} /></button>
      </div>
      {levels.length > 1 ? <>
        <div className="effort-slider mt-5" style={{ "--effort-fill": `${percent}%` } as CSSProperties}>
          <div className="effort-track" aria-hidden="true"><div className="effort-fill" /></div>
          <input type="range" min={0} max={levels.length - 1} step={1} value={index} disabled={disabled} aria-label="Reasoning effort" aria-valuetext={EFFORT_LABELS[selected]} onChange={e => { if (!disabled) onChange(levels[Number(e.target.value)]); }} />
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-muted-foreground"><span>Default</span><span>{EFFORT_LABELS[levels[levels.length - 1]]}</span></div>
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">More effort can improve difficult answers and take longer.</p>
      </> : <p className="mt-4 text-xs leading-relaxed text-muted-foreground">This model uses its own default. A supported reasoning model enables the effort slider.</p>}
    </PopoverContent>
  </Popover>;
}
