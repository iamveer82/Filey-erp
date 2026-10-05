import { useEffect, useRef, useState } from "react";
import { BookOpen } from "lucide-react";
import { mountGuideFigure, type FigureHandle } from "../lib/hairline/host";

export default function HairlineGuideFigure({ step }: { step: number }) {
  const stage = useRef<HTMLDivElement>(null);
  const handle = useRef<FigureHandle | null>(null);
  const chapter = useRef(step);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    if (!stage.current) return;
    void mountGuideFigure(stage.current, { textContent: null }, controller.signal).then(value => {
      if (!active) { value.destroy(); return; }
      handle.current = value; value.choose(chapter.current);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; controller.abort(); handle.current?.destroy(); handle.current = null; };
  }, []);
  useEffect(() => { chapter.current = step; handle.current?.choose(step); }, [step]);
  if (failed) return <div className="my-5 flex items-center justify-center gap-2 text-xs text-muted-foreground"><BookOpen size={18} aria-hidden="true" />Illustration unavailable. The steps below still work.</div>;
  return <div ref={stage} className="filey-guide-figure" />;
}
