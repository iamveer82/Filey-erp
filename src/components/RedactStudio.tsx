import { useEffect, useRef, useState } from "react";
import { Loader2, Check, ChevronLeft, ChevronRight, Eraser } from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { redactBoxes, type RedactBox, type OutFile } from "../lib/pdfTools";
import { useUI } from "../lib/ui";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/* Draw opaque redaction boxes over a page and bake them in. Multiple boxes,
 * across pages, free width/height (unlike the aspect-locked image stamps).
 * Boxes are stored as page fractions so they map to PDF points exactly. */

const RENDER_W = 1100;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const uid = () => Math.random().toString(36).slice(2, 9);

interface Box extends RedactBox {
  id: string;
}

export default function RedactStudio({
  file,
  onApply,
}: {
  file: File;
  onApply: (out: OutFile) => void;
}) {
  const { toast } = useUI();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(0);
  const [pageImg, setPageImg] = useState("");
  const [aspect, setAspect] = useState<{ w: number; h: number } | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let dead = false;
    setPageImg("");
    (async () => {
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        const pdf = await pdfjs.getDocument({ data }).promise;
        if (dead) return;
        setPages(pdf.numPages);
        const idx = Math.min(Math.max(0, page), pdf.numPages - 1);
        const p = await pdf.getPage(idx + 1);
        const pt = p.getViewport({ scale: 1 });
        if (dead) return;
        setAspect({ w: pt.width, h: pt.height });
        const scale = RENDER_W / pt.width;
        const vp = p.getViewport({ scale });
        const c = document.createElement("canvas");
        c.width = vp.width;
        c.height = vp.height;
        const ctx = c.getContext("2d");
        if (!ctx) return;
        await p.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise;
        if (dead) return;
        setPageImg(c.toDataURL("image/png"));
      } catch (e) {
        if (!dead) toastRef.current.error(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      dead = true;
    };
  }, [file, page]);

  const stageRef = useRef<HTMLDivElement>(null);
  const drawRef = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const frac = (e: React.PointerEvent) => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) };
  };
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    stageRef.current?.setPointerCapture(e.pointerId);
    const p = frac(e);
    drawRef.current = p;
    setDraft({ x: p.x, y: p.y, w: 0, h: 0 });
  };
  const move = (e: React.PointerEvent) => {
    const s = drawRef.current;
    if (!s) return;
    const p = frac(e);
    setDraft({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
  };
  const up = () => {
    const d = draft;
    drawRef.current = null;
    setDraft(null);
    if (d && d.w > 0.01 && d.h > 0.01)
      setBoxes((b) => [...b, { id: uid(), page, xFrac: d.x, yFrac: d.y, wFrac: d.w, hFrac: d.h }]);
  };

  const pageBoxes = boxes.filter((b) => b.page === page);

  const apply = async () => {
    if (!boxes.length) {
      toastRef.current.error("Draw at least one redaction box.");
      return;
    }
    setSaving(true);
    try {
      const out = await redactBoxes(
        file,
        boxes.map(({ page, xFrac, yFrac, wFrac, hFrac }) => ({ page, xFrac, yFrac, wFrac, hFrac }))
      );
      onApply(out);
      toast.success(`${boxes.length} area${boxes.length > 1 ? "s" : ""} redacted & downloaded.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-white px-2 py-1.5 dark:border-[#3A3D45] dark:bg-[#1E2025]">
        <span className="flex items-center gap-1 text-xs font-semibold text-brand-500">
          <Eraser size={13} /> Drag to cover · {boxes.length} box{boxes.length === 1 ? "" : "es"}
        </span>
        <button className="btn-ghost h-7 text-xs" onClick={() => setBoxes((b) => b.filter((x) => x.page !== page))} disabled={!pageBoxes.length}>
          Clear page
        </button>
        <span className="flex-1" />
        <button className="btn-ghost h-7 !px-1.5" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page <= 0}>
          <ChevronLeft size={14} />
        </button>
        <span className="whitespace-nowrap text-xs font-semibold text-brand-500">{page + 1}/{pages || "…"}</span>
        <button className="btn-ghost h-7 !px-1.5" onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}>
          <ChevronRight size={14} />
        </button>
        <button onClick={apply} disabled={saving || !boxes.length} className="btn-primary h-7 text-xs">
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Apply
        </button>
      </div>

      <div
        ref={stageRef}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        className="relative mx-auto w-full max-w-3xl overflow-hidden rounded-xl border border-brand-200 bg-white dark:border-[#3A3D45]"
        style={{ aspectRatio: aspect ? `${aspect.w} / ${aspect.h}` : undefined, touchAction: "none", cursor: "crosshair" }}
      >
        {pageImg ? (
          <img src={pageImg} alt={`page ${page + 1}`} className="block h-full w-full select-none" draggable={false} />
        ) : (
          <div className="grid h-full place-items-center"><Loader2 size={20} className="animate-spin text-brand-400" /></div>
        )}

        {pageBoxes.map((b) => (
          <div
            key={b.id}
            onDoubleClick={() => setBoxes((arr) => arr.filter((x) => x.id !== b.id))}
            title="Double-click to remove"
            style={{ left: `${b.xFrac * 100}%`, top: `${b.yFrac * 100}%`, width: `${b.wFrac * 100}%`, height: `${b.hFrac * 100}%` }}
            className="absolute bg-black"
          />
        ))}
        {draft && (
          <div
            style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.w * 100}%`, height: `${draft.h * 100}%` }}
            className="pointer-events-none absolute bg-black/70"
          />
        )}
      </div>
      <p className="mt-2 text-center text-[11px] text-brand-400">
        Drag to draw black boxes over anything to hide. Double-click a box to remove it, then <strong>Apply</strong>.
      </p>
    </div>
  );
}
