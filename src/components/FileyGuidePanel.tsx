import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, ExternalLink, Minus, Pause, Play, RotateCcw, X } from "lucide-react";
import { GUIDES } from "../lib/fileyGuides";
import { loadGuideProgress, saveGuideProgress } from "../lib/guideProgress";
import { agentStorageScope } from "../lib/agentStorage";
import { useModules } from "../lib/modules";
import HairlineGuideFigure from "./HairlineGuideFigure";

interface Props { id: string; scope: string | null; onClose: () => void; onMinimize: () => void; onChoose: (id: string) => void; onHighlight: (element: HTMLElement) => void }

export default function FileyGuidePanel({ id, scope, onClose, onMinimize, onChoose, onHighlight }: Props) {
  const guide = GUIDES.find(item => item.id === id);
  const { isEnabled } = useModules();
  const [progress, setProgress] = useState(() => {
    const saved = loadGuideProgress(scope)[id];
    return { step: Math.min(saved?.step ?? 0, Math.max(0, (guide?.steps.length ?? 1) - 1)), finished: saved?.finished ?? false };
  });
  const [playing, setPlaying] = useState(false);
  const [notice, setNotice] = useState("");
  const [allSteps, setAllSteps] = useState(false);
  const step = progress.step;
  const body = guide?.steps[step] ?? "";
  const save = (next: typeof progress) => {
    if (scope !== agentStorageScope()) { onClose(); return; }
    setProgress(next);
    if (!saveGuideProgress(scope, id, next)) setNotice("Reading progress could not be saved on this device. You can keep reading.");
    else setNotice("");
  };
  const move = (next: number) => {
    setPlaying(false);
    save({ step: Math.max(0, Math.min(next, (guide?.steps.length ?? 1) - 1)), finished: false });
  };
  useEffect(() => {
    const pause = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener("visibilitychange", pause);
    return () => document.removeEventListener("visibilitychange", pause);
  }, []);
  useEffect(() => {
    if (!playing || !guide) return;
    if (step >= guide.steps.length - 1) { setPlaying(false); return; }
    const timer = window.setTimeout(() => {
      if (document.hidden || scope !== agentStorageScope()) { setPlaying(false); return; }
      const next = { step: step + 1, finished: false };
      setProgress(next);
      if (!saveGuideProgress(scope, id, next)) setNotice("Reading progress could not be saved on this device. You can keep reading.");
    }, Math.min(20000, Math.max(6000, body.split(/\s+/).length * 300)));
    return () => window.clearTimeout(timer);
  }, [playing, guide, step, body, scope, id]);

  if (!guide) return <Dialog.Root open modal={false} onOpenChange={open => { if (!open) onClose(); }}><Dialog.Portal><Dialog.Content className="filey-guide-panel p-5" onCloseAutoFocus={event => event.preventDefault()} onInteractOutside={event => event.preventDefault()}>
    <Dialog.Title className="font-medium">Guide unavailable</Dialog.Title><Dialog.Description className="text-sm text-muted-foreground mt-2">Choose a section from the Help Center to start a guide.</Dialog.Description><Dialog.Close className="btn-secondary mt-4">Close</Dialog.Close>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;

  const available = !guide.moduleId || isEnabled(guide.moduleId);
  const showControl = () => {
    setPlaying(false);
    const target = guide.targets?.[step];
    if (!target || !/^[a-z][a-z0-9-]*$/.test(target)) return;
    const element = document.querySelector<HTMLElement>(`[data-guide="${target}"]`);
    if (!element || !element.getClientRects().length) {
      setNotice("Open this section's editor or the tab mentioned in the step to see this control."); return;
    }
    onHighlight(element);
    element.scrollIntoView({ block: "center", behavior: "auto" });
    onMinimize();
  };

  return <Dialog.Root open modal={false} onOpenChange={open => { if (!open) onClose(); }}>
    <Dialog.Portal><Dialog.Content className="filey-guide-panel" onCloseAutoFocus={event => event.preventDefault()} onInteractOutside={event => event.preventDefault()}
      onEscapeKeyDown={event => { if (event.target instanceof Element && event.target.closest(".filey-guide-figure")) event.preventDefault(); }}>
      <div className="flex items-center gap-2 px-5 pt-4 pb-2">
        <div className="flex-1 min-w-0"><p className="text-[11px] text-muted-foreground mb-1">FILEY GUIDES</p><Dialog.Title className="text-base font-semibold">{guide.title}</Dialog.Title></div>
        <button type="button" className="filey-guide-icon" aria-label="Minimize guide" onClick={onMinimize}><Minus size={18} /></button>
        <Dialog.Close className="filey-guide-icon" aria-label="Close guide"><X size={18} /></Dialog.Close>
      </div>
      <div className="filey-guide-body">
        <Dialog.Description className="text-sm text-muted-foreground leading-relaxed">{guide.summary}</Dialog.Description>
        <HairlineGuideFigure step={step} />
        <div className="flex items-center justify-between gap-2 mb-4">
          <span className="text-xs text-muted-foreground" aria-live="polite">{progress.finished ? "Guide reviewed" : `Step ${step + 1} of ${guide.steps.length}`}</span>
          <div className="flex items-center">
            <button className="filey-guide-icon" aria-label={playing ? "Pause guide" : "Play guide"} disabled={step === guide.steps.length - 1} onClick={() => setPlaying(current => !current)}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
            <button className="filey-guide-icon" aria-label="Replay guide" onClick={() => move(0)}><RotateCcw size={16} /></button>
          </div>
        </div>
        <div className="h-1 flex gap-1 mb-5" aria-hidden="true">{guide.steps.map((_, index) => <span key={index} className={`flex-1 rounded-full ${index <= step ? "bg-foreground" : "bg-muted"}`} />)}</div>
        <h3 className="font-medium text-[15px] mb-2">{guide.stepTitles?.[step] ?? `Step ${step + 1}`}</h3>
        <p className="text-sm leading-relaxed whitespace-pre-line">{body}</p>
        {notice && <p className="mt-3 text-xs text-muted-foreground" role="status">{notice}</p>}
        {progress.finished && <p className="mt-3 text-xs text-muted-foreground">You've reviewed the guide. Your document or setup is complete only after you save it and see Filey's confirmation.</p>}
        <div className="flex flex-wrap items-center gap-2 mt-4">
          {available && <Link className="btn-outline text-xs" to={guide.to} onClick={onMinimize}>Open section<ExternalLink size={13} /></Link>}
          {available && guide.targets?.[step] && <button className="btn-ghost text-xs" onClick={showControl}>Find this control</button>}
          {!available && <p className="text-xs text-muted-foreground">This section is unavailable in your workspace. You can still read its guide.</p>}
        </div>
        <details className="mt-6" open={allSteps} onToggle={event => setAllSteps(event.currentTarget.open)}><summary className="text-xs text-muted-foreground cursor-pointer">Read all steps</summary>
          <ol className="mt-3 space-y-3 list-decimal pl-4 text-sm leading-relaxed">{guide.steps.map((text, index) => <li key={index}>{text}</li>)}</ol>
        </details>
        <label className="block mt-6 text-xs text-muted-foreground">Explore another guide
          <select className="input mt-2 text-sm w-full" value={id} onChange={event => { setPlaying(false); onChoose(event.target.value); }}>
            {GUIDES.filter(item => item.id === id || !item.moduleId || isEnabled(item.moduleId)).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
        </label>
      </div>
      <div className="filey-guide-footer">
        <div className="flex items-center justify-between gap-2">
          <button className="btn-secondary" disabled={step === 0} onClick={() => move(step - 1)}><ArrowLeft size={15} />Back</button>
          {step < guide.steps.length - 1 ? <button className="btn-primary" onClick={() => move(step + 1)}>Next<ArrowRight size={15} /></button>
            : <button className="btn-primary" disabled={progress.finished} onClick={() => { setPlaying(false); save({ step, finished: true }); }}><Check size={15} />{progress.finished ? "Reviewed" : "Finish guide"}</button>}
        </div><p className="text-[11px] text-muted-foreground mt-3">Optional · Sample illustration · Reading progress stays on this device</p>
      </div>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
