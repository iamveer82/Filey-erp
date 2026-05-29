import { useEffect, useRef, useState } from "react";
import {
  Loader2,
  RotateCw,
  Trash2,
  Scissors,
  Check,
  GripVertical,
  Undo2,
} from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { organizePages, splitAtPoints, type OutFile } from "../lib/pdfTools";
import { useUI } from "../lib/ui";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/* Visual page editor for the "techy" page tools. Shows every page as a
 * thumbnail and supports, by action:
 *   organize → drag to reorder, rotate, delete pages → one PDF
 *   extract  → click to select pages → one PDF of the selection
 *   split    → mark cut points → several PDFs
 * No comma-separated page-range strings required. */

type Action = "organize" | "extract" | "split";

interface Thumb {
  index: number;
  thumb: string;
}

export default function OrganizeStudio({
  file,
  action,
  onApply,
}: {
  file: File;
  action: Action;
  onApply: (outs: OutFile[]) => void;
}) {
  const { toast } = useUI();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [thumbs, setThumbs] = useState<Thumb[]>([]);
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<number[]>([]);
  const [rotated, setRotated] = useState<Record<number, number>>({});
  const [deleted, setDeleted] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [cuts, setCuts] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const dragIdx = useRef<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  // Render every page thumbnail once.
  useEffect(() => {
    let dead = false;
    setLoading(true);
    (async () => {
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        const pdf = await pdfjs.getDocument({ data }).promise;
        const out: Thumb[] = [];
        for (let n = 1; n <= pdf.numPages; n++) {
          if (dead) return;
          const p = await pdf.getPage(n);
          const vp = p.getViewport({ scale: 0.35 });
          const c = document.createElement("canvas");
          c.width = vp.width;
          c.height = vp.height;
          const ctx = c.getContext("2d");
          if (ctx) await p.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise;
          out.push({ index: n - 1, thumb: ctx ? c.toDataURL("image/png") : "" });
        }
        if (dead) return;
        setThumbs(out);
        setOrder(out.map((t) => t.index));
      } catch (e) {
        toastRef.current.error(e instanceof Error ? e.message : String(e));
      } finally {
        if (!dead) setLoading(false);
      }
    })();
    return () => {
      dead = true;
    };
  }, [file]);

  const thumbFor = (i: number) => thumbs.find((t) => t.index === i)?.thumb ?? "";
  const rotate = (i: number) => setRotated((r) => ({ ...r, [i]: ((r[i] ?? 0) + 90) % 360 }));
  const toggle = (set: Set<number>, i: number) => {
    const next = new Set(set);
    next.has(i) ? next.delete(i) : next.add(i);
    return next;
  };

  const reorder = (from: number, to: number) => {
    if (from === to) return;
    setOrder((prev) => {
      const a = [...prev];
      const fi = a.indexOf(from);
      const ti = a.indexOf(to);
      if (fi < 0 || ti < 0) return prev;
      const [m] = a.splice(fi, 1);
      a.splice(ti, 0, m);
      return a;
    });
  };

  const apply = async () => {
    setBusy(true);
    try {
      let outs: OutFile[];
      if (action === "split") {
        outs = await splitAtPoints(file, [...cuts]);
      } else if (action === "extract") {
        const sel = [...selected].sort((a, b) => a - b);
        if (!sel.length) throw new Error("Select at least one page to extract.");
        outs = [await organizePages(file, sel.map((i) => ({ index: i, rotate: rotated[i] })))];
      } else {
        const kept = order.filter((i) => !deleted.has(i));
        if (!kept.length) throw new Error("That would remove every page.");
        outs = [await organizePages(file, kept.map((i) => ({ index: i, rotate: rotated[i] })))];
      }
      onApply(outs);
      toast.success(`Done — ${outs.length} file${outs.length > 1 ? "s" : ""} downloaded.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Display order: organize respects drag order; others use document order.
  const display = action === "organize" ? order : thumbs.map((t) => t.index);
  const keptCount = order.filter((i) => !deleted.has(i)).length;
  const parts = cuts.size + 1;

  const hint =
    action === "split"
      ? `Click the scissors after a page to cut. ${parts} part${parts > 1 ? "s" : ""}.`
      : action === "extract"
      ? `Click pages to select. ${selected.size} selected.`
      : "Drag to reorder · rotate · delete. " + `${keptCount} page${keptCount === 1 ? "" : "s"} kept.`;

  const applyLabel =
    action === "split"
      ? `Split into ${parts} files & download`
      : action === "extract"
      ? `Extract ${selected.size} page${selected.size === 1 ? "" : "s"} & download`
      : "Apply & download";

  return (
    <div>
      <p className="mb-3 text-xs font-semibold text-brand-500">{hint}</p>

      {loading ? (
        <div className="grid h-72 place-items-center text-sm text-brand-400">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
          {display.map((i, pos) => {
            const isDeleted = deleted.has(i);
            const isSelected = selected.has(i);
            const deg = rotated[i] ?? 0;
            return (
              <div key={i} className="flex flex-col items-center gap-1">
                <div
                  draggable={action === "organize"}
                  onDragStart={() => (dragIdx.current = i)}
                  onDragOver={(e) => {
                    if (action !== "organize") return;
                    e.preventDefault();
                    setOverIdx(i);
                  }}
                  onDragLeave={() => setOverIdx((o) => (o === i ? null : o))}
                  onDrop={() => {
                    if (dragIdx.current != null) reorder(dragIdx.current, i);
                    dragIdx.current = null;
                    setOverIdx(null);
                  }}
                  onClick={() => {
                    if (action === "extract") setSelected((s) => toggle(s, i));
                  }}
                  className={`group relative w-full overflow-hidden rounded-lg border bg-white p-1 dark:bg-[#1E2025] ${
                    action === "organize" ? "cursor-grab active:cursor-grabbing" : ""
                  } ${action === "extract" ? "cursor-pointer" : ""} ${
                    overIdx === i
                      ? "border-primary-400 ring-2 ring-primary-400/40"
                      : isSelected
                      ? "border-primary-500 ring-2 ring-primary-500/50"
                      : "border-brand-200 dark:border-[#3A3D45]"
                  } ${isDeleted ? "opacity-40" : ""}`}
                >
                  <span className="absolute left-1 top-1 z-10 grid h-5 min-w-5 place-items-center rounded-full bg-primary-500 px-1 text-[10px] font-bold text-[#0A0A0A]">
                    {action === "organize" ? pos + 1 : i + 1}
                  </span>
                  {isSelected && (
                    <span className="absolute right-1 top-1 z-10 grid h-5 w-5 place-items-center rounded-full bg-primary-500 text-[#0A0A0A]">
                      <Check size={12} />
                    </span>
                  )}
                  <div className="grid h-28 place-items-center">
                    {thumbFor(i) ? (
                      <img
                        src={thumbFor(i)}
                        alt={`page ${i + 1}`}
                        className="max-h-full max-w-full object-contain transition-transform"
                        style={{ transform: `rotate(${deg}deg)` }}
                        draggable={false}
                      />
                    ) : (
                      <Loader2 size={14} className="animate-spin text-brand-400" />
                    )}
                  </div>

                  {action === "organize" && (
                    <div className="mt-1 flex items-center justify-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          rotate(i);
                        }}
                        title="Rotate 90°"
                        className="grid h-6 w-6 place-items-center rounded text-brand-500 hover:bg-brand-100 dark:hover:bg-white/10"
                      >
                        <RotateCw size={13} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleted((d) => toggle(d, i));
                        }}
                        title={isDeleted ? "Restore page" : "Delete page"}
                        className={`grid h-6 w-6 place-items-center rounded hover:bg-brand-100 dark:hover:bg-white/10 ${
                          isDeleted ? "text-success" : "text-danger"
                        }`}
                      >
                        {isDeleted ? <Undo2 size={13} /> : <Trash2 size={13} />}
                      </button>
                      <GripVertical size={13} className="text-brand-300" />
                    </div>
                  )}
                </div>

                {action === "split" && pos < display.length - 1 && (
                  <button
                    onClick={() => setCuts((c) => toggle(c, i))}
                    title="Toggle split here"
                    className={`flex h-6 w-full items-center justify-center gap-1 rounded text-[10px] font-semibold ${
                      cuts.has(i)
                        ? "bg-primary-500 text-[#0A0A0A]"
                        : "text-brand-400 hover:bg-brand-100 dark:hover:bg-white/10"
                    }`}
                  >
                    <Scissors size={11} /> {cuts.has(i) ? "Cut" : "Split"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <button onClick={apply} disabled={busy || loading} className="btn-primary mt-4 w-full">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
        {applyLabel}
      </button>
    </div>
  );
}
