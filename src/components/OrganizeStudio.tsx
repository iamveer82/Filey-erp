import { useEffect, useRef, useState } from "react";
import {
  Loader2,
  RotateCw,
  Trash2,
  Scissors,
  Check,
  GripVertical,
  Undo2,
  ChevronLeft,
  ChevronRight,
  Grid3X3,
} from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { organizePages, splitAtPoints, type OutFile } from "../lib/pdfTools";
import { useUI } from "../lib/ui";
import { cn } from "../lib/format";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/* Visual page editor for the "techy" page tools. Dual mode:
 * grid → all pages as thumbnails with per-page actions
 * focus → single large page with nav (prev/next), rotate, delete/restore
 */

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
  const [focusPage, setFocusPage] = useState<number | null>(null);
  const [fullImgs, setFullImgs] = useState<Record<number, string>>({});

  const dragIdx = useRef<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  // Render all page thumbnails and full-size previews.
  useEffect(() => {
    let dead = false;
    setLoading(true);
    (async () => {
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        const pdf = await pdfjs.getDocument({ data }).promise;
        const out: Thumb[] = [];
        const fulls: Record<number, string> = {};
        for (let n = 1; n <= pdf.numPages; n++) {
          if (dead) return;
          const p = await pdf.getPage(n);
          // thumbnail
          const tvp = p.getViewport({ scale: 0.35 });
          const tc = document.createElement("canvas");
          tc.width = tvp.width;
          tc.height = tvp.height;
          const tctx = tc.getContext("2d");
          if (tctx)
            await p.render({ canvas: tc, canvasContext: tctx, viewport: tvp }).promise;
          out.push({ index: n - 1, thumb: tctx ? tc.toDataURL("image/png") : "" });
          // full preview
          const fvp = p.getViewport({ scale: 1.2 });
          const fc = document.createElement("canvas");
          fc.width = fvp.width;
          fc.height = fvp.height;
          const fctx = fc.getContext("2d");
          if (fctx)
            await p.render({ canvas: fc, canvasContext: fctx, viewport: fvp }).promise;
          fulls[n - 1] = fctx ? fc.toDataURL("image/png") : "";
        }
        if (dead) return;
        setThumbs(out);
        setFullImgs(fulls);
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
  const fullFor = (i: number) => fullImgs[i] ?? "";
  const rotate = (i: number) =>
    setRotated((r) => ({ ...r, [i]: ((r[i] ?? 0) + 90) % 360 }));

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

  const toggleDelete = (i: number) => {
    setDeleted((d) => toggle(d, i));
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
        outs = [
          await organizePages(
            file,
            sel.map((i) => ({ index: i, rotate: rotated[i] }))
          ),
        ];
      } else {
        const kept = order.filter((i) => !deleted.has(i));
        if (!kept.length) throw new Error("That would remove every page.");
        outs = [
          await organizePages(
            file,
            kept.map((i) => ({ index: i, rotate: rotated[i] }))
          ),
        ];
      }
      onApply(outs);
      toast.success(
        `Done - ${outs.length} file${outs.length > 1 ? "s" : ""} downloaded.`
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const display = action === "organize" ? order : thumbs.map((t) => t.index);
  const keptCount = order.filter((i) => !deleted.has(i)).length;
  const parts = cuts.size + 1;

  const hint =
    action === "split"
      ? `Click the scissors after a page to cut. ${parts} part${parts > 1 ? "s" : ""}.`
      : action === "extract"
        ? `Click pages to select. ${selected.size} selected.`
        : `Drag to reorder · rotate · delete · click a page to focus. ${keptCount} page${keptCount === 1 ? "" : "s"} kept.`;

  const applyLabel =
    action === "split"
      ? `Split into ${parts} files & download`
      : action === "extract"
        ? `Extract ${selected.size} page${selected.size === 1 ? "" : "s"} & download`
        : "Apply & download";

  const focusIdx = focusPage != null ? display.indexOf(focusPage) : -1;

  // Focus mode: single page with nav
  if (focusPage != null && !loading) {
    const i = focusPage;
    const isDel = deleted.has(i);
    const deg = rotated[i] ?? 0;
    const total = display.length;
    const canPrev = focusIdx > 0;
    const canNext = focusIdx < total - 1;

    const navTo = (dir: -1 | 1) => {
      const idx = focusIdx + dir;
      if (idx >= 0 && idx < total) setFocusPage(display[idx]);
    };

    return (
      <div className="flex flex-col gap-3">
        {/* Top bar: back to grid + page info */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => setFocusPage(null)}
            className="btn-ghost h-8 text-xs"
            aria-label="View all pages"
          >
            <Grid3X3 size={13} /> All pages
          </button>
          <span className="text-xs font-medium text-brand-500">
            {focusIdx + 1} / {total}
            {isDel && <span className="ml-1 text-danger">· Deleted</span>}
          </span>
        </div>

        {/* Page preview */}
        <div className="relative mx-auto w-full max-w-2xl overflow-hidden rounded-xl border border-brand-200 bg-white">
          {fullFor(i) ? (
            <img
              src={fullFor(i)}
              alt={`page ${i + 1}`}
              className="mx-auto block max-h-[70vh] w-auto object-contain transition-transform"
              style={{ transform: `rotate(${deg}deg)`, opacity: isDel ? 0.4 : 1 }}
              draggable={false}
            />
          ) : (
            <div className="grid h-64 place-items-center">
              <Loader2 size={20} className="animate-spin text-brand-400" />
            </div>
          )}
          {isDel && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="rounded-full bg-danger/20 px-4 py-2 text-lg font-medium text-danger">
                DELETED
              </span>
            </div>
          )}
        </div>

        {/* Navigation bar */}
        <div className="mx-auto flex items-center gap-3 rounded-xl border border-brand-200 bg-white px-4 py-2.5">
          <button
            onClick={() => navTo(-1)}
            disabled={!canPrev}
            className="btn-ghost h-9 !px-3 text-xs disabled:opacity-30"
            aria-label="Previous page"
          >
            <ChevronLeft size={16} /> Prev
          </button>

          <span className="min-w-[60px] text-center text-sm font-medium text-ink tabular-nums">
            {focusIdx + 1} / {total}
          </span>

          <button
            onClick={() => navTo(1)}
            disabled={!canNext}
            className="btn-ghost h-9 !px-3 text-xs disabled:opacity-30"
            aria-label="Next page"
          >
            Next <ChevronRight size={16} />
          </button>

          <span className="mx-1 h-6 w-px bg-brand-200" />

          <button
            onClick={() => rotate(i)}
            title="Rotate 90°"
            aria-label="Rotate page"
            className="btn-ghost h-9 w-9 !px-0"
          >
            <RotateCw size={15} />
          </button>

          <button
            onClick={() => toggleDelete(i)}
            title={isDel ? "Restore page" : "Delete page"}
            aria-label={isDel ? "Restore page" : "Delete page"}
            className={cn(
              "btn-ghost h-9 !px-3 text-xs",
              isDel ? "text-success" : "text-danger"
            )}
          >
            {isDel ? <Undo2 size={15} /> : <Trash2 size={15} />}
            {isDel ? "Restore" : "Delete"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-3 text-xs font-medium text-brand-500">{hint}</p>

      {loading ? (
        <div className="grid h-72 place-items-center text-sm text-brand-400">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
          {display.map((i, pos) => {
            const isDel = deleted.has(i);
            const isSel = selected.has(i);
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
                    else if (action === "organize") setFocusPage(i);
                  }}
                  className={cn(
                    "group relative w-full overflow-hidden rounded-lg border bg-white p-1 transition-all duration-150",
                    action === "organize"
                      ? "cursor-pointer hover:ring-2 hover:ring-primary-400/40"
                      : "",
                    action === "extract" ? "cursor-pointer" : "",
                    overIdx === i ? "border-primary-400 ring-2 ring-primary-400/40" : "",
                    isSel ? "border-primary-500 ring-2 ring-primary-500/50" : "",
                    isDel
                      ? "opacity-40 ring-2 ring-danger/30"
                      : "border-brand-200"
                  )}
                >
                  <span
                    className={cn(
                      "absolute left-1 top-1 z-10 grid h-5 min-w-5 place-items-center rounded-full px-1 text-[10px] font-bold",
                      isDel ? "bg-danger text-white" : "bg-primary-500 text-[#0A0A0A]"
                    )}
                  >
                    {action === "organize" ? pos + 1 : i + 1}
                  </span>
                  {isDel && (
                    <span className="absolute inset-0 z-10 flex items-center justify-center">
                      <Trash2 size={20} className="text-danger drop-shadow" />
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
                        aria-label="Rotate 90°"
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
                        aria-label={isDel ? "Restore page" : "Delete page"}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleDelete(i);
                        }}
                        title={isDel ? "Restore page" : "Delete page"}
                        className={cn(
                          "grid h-6 w-6 place-items-center rounded hover:bg-brand-100 dark:hover:bg-white/10",
                          isDel ? "text-success" : "text-danger"
                        )}
                      >
                        {isDel ? <Undo2 size={13} /> : <Trash2 size={13} />}
                      </button>
                      <GripVertical size={13} className="text-brand-300" />
                    </div>
                  )}
                </div>

                {action === "split" && pos < display.length - 1 && (
                  <button
                    onClick={() => setCuts((c) => toggle(c, i))}
                    title="Toggle split here"
                    aria-label="Split at page"
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

      <button
        onClick={apply}
        disabled={busy || loading}
        className="btn-primary mt-4 w-full"
        aria-label="Apply changes and download"
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
        {applyLabel}
      </button>
    </div>
  );
}
