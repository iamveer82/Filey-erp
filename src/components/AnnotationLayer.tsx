import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  Pencil,
  Eraser,
  Type as TypeIcon,
  Trash2,
  Undo2,
  Redo2,
  Save,
  MousePointer,
  X,
} from "lucide-react";
import { cn } from "../lib/format";

type Point = { x: number; y: number };
type Stroke = { color: string; size: number; pts: Point[] };
type TextNote = { id: string; x: number; y: number; color: string; size: number; text: string };

type Tool = "select" | "pen" | "eraser" | "text";

type Annotations = { strokes: Stroke[]; texts: TextNote[] };

const EMPTY: Annotations = { strokes: [], texts: [] };
const COLORS = ["#222222", "#FFD600", "#E5484D", "#3FB984", "#0EA5E9", "#FFFFFF"];

const storageKey = (id: string) => `filey:annot:${id}`;

function load(id: string): Annotations {
  try {
    const raw = localStorage.getItem(storageKey(id));
    if (!raw) return { ...EMPTY, strokes: [], texts: [] };
    const v = JSON.parse(raw);
    return {
      strokes: Array.isArray(v.strokes) ? v.strokes : [],
      texts: Array.isArray(v.texts) ? v.texts : [],
    };
  } catch {
    return { ...EMPTY, strokes: [], texts: [] };
  }
}

function save(id: string, a: Annotations) {
  try {
    localStorage.setItem(storageKey(id), JSON.stringify(a));
    window.dispatchEvent(
      new CustomEvent("filey:annot", { detail: id })
    );
  } catch {
    /* ignore quota errors */
  }
}

/** Annotation layer: free-hand pen, eraser, color/size picker, draggable
 *  text notes, undo, clear. Sits absolutely on top of an invoice or quote
 *  inside `.invoice-print` so it prints with the doc. Toolbar is no-print.
 *  Per-doc state in localStorage — no schema change. When `editable` is
 *  false the layer is passive: shows existing strokes/texts (still
 *  prints), no toolbar, no pointer capture. */
type Op =
  | { kind: "stroke"; item: Stroke }
  | { kind: "text"; item: TextNote };

export default function AnnotationLayer({
  id,
  editable = true,
  onSave,
}: {
  id: string;
  editable?: boolean;
  onSave?: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<Annotations>(load(id));
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);

  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState("#222222");
  const [size, setSize] = useState(3);
  const drawing = useRef<Stroke | null>(null);
  const draggingText = useRef<{ id: string; dx: number; dy: number } | null>(
    null
  );
  /** Interleaved op log so undo/redo respect actual order of edits.
   *  Reset on id change (initial guess: strokes then texts). */
  const opsRef = useRef<Op["kind"][]>([]);
  const undoneRef = useRef<Op[]>([]);

  // Re-hydrate when id changes
  useEffect(() => {
    stateRef.current = load(id);
    opsRef.current = [
      ...stateRef.current.strokes.map((): Op["kind"] => "stroke"),
      ...stateRef.current.texts.map((): Op["kind"] => "text"),
    ];
    undoneRef.current = [];
    redraw();
    rerender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Read-only layers reload from storage when an editor saves under
  // the same id (the editable layer dispatches "filey:annot").
  useEffect(() => {
    if (editable) return;
    const onSync = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail !== id) return;
      stateRef.current = load(id);
      redraw();
      rerender();
    };
    window.addEventListener("filey:annot", onSync);
    return () => window.removeEventListener("filey:annot", onSync);
  }, [editable, id]);

  // Match canvas pixel size to its CSS size for crisp lines
  useEffect(() => {
    const c = canvasRef.current;
    const w = wrapRef.current;
    if (!c || !w) return;
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = w.getBoundingClientRect();
      c.width = Math.max(1, Math.round(rect.width * dpr));
      c.height = Math.max(1, Math.round(rect.height * dpr));
      c.style.width = rect.width + "px";
      c.style.height = rect.height + "px";
      const ctx = c.getContext("2d");
      if (ctx) ctx.scale(dpr, dpr);
      redraw();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(w);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function redraw() {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const s of stateRef.current.strokes) {
      if (s.pts.length === 0) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.size;
      ctx.beginPath();
      ctx.moveTo(s.pts[0].x, s.pts[0].y);
      for (let i = 1; i < s.pts.length; i++)
        ctx.lineTo(s.pts[i].x, s.pts[i].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function persist() {
    save(id, stateRef.current);
  }

  function localPoint(e: PointerEvent<HTMLDivElement>): Point {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (tool === "select") return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = localPoint(e);
    if (tool === "pen" || tool === "eraser") {
      drawing.current = {
        color: tool === "eraser" ? "#FFFFFF" : color,
        size: tool === "eraser" ? size * 3 : size,
        pts: [p],
      };
    } else if (tool === "text") {
      const text = window.prompt("Text:");
      if (text && text.trim()) {
        stateRef.current.texts.push({
          id: crypto.randomUUID(),
          x: p.x,
          y: p.y,
          color,
          size: Math.max(12, size * 4),
          text: text.trim(),
        });
        opsRef.current.push("text");
        undoneRef.current = [];
        persist();
        rerender();
      }
      setTool("select");
    }
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!drawing.current) return;
    const p = localPoint(e);
    drawing.current.pts.push(p);
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx && drawing.current.pts.length >= 2) {
      ctx.strokeStyle = drawing.current.color;
      ctx.lineWidth = drawing.current.size;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const a = drawing.current.pts[drawing.current.pts.length - 2];
      const b = drawing.current.pts[drawing.current.pts.length - 1];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  function onPointerUp() {
    if (drawing.current) {
      stateRef.current.strokes.push(drawing.current);
      opsRef.current.push("stroke");
      undoneRef.current = [];
      drawing.current = null;
      persist();
      redraw();
      rerender();
    }
  }

  function undo() {
    const op = opsRef.current.pop();
    if (!op) return;
    if (op === "stroke") {
      const removed = stateRef.current.strokes.pop();
      if (removed) undoneRef.current.push({ kind: "stroke", item: removed });
    } else {
      const removed = stateRef.current.texts.pop();
      if (removed) undoneRef.current.push({ kind: "text", item: removed });
    }
    persist();
    redraw();
    rerender();
  }

  function redo() {
    const op = undoneRef.current.pop();
    if (!op) return;
    if (op.kind === "stroke") {
      stateRef.current.strokes.push(op.item);
      opsRef.current.push("stroke");
    } else {
      stateRef.current.texts.push(op.item);
      opsRef.current.push("text");
    }
    persist();
    redraw();
    rerender();
  }

  function clearAll() {
    if (!confirm("Clear all annotations on this doc?")) return;
    stateRef.current = { strokes: [], texts: [] };
    opsRef.current = [];
    undoneRef.current = [];
    persist();
    redraw();
    rerender();
  }

  function removeText(tid: string) {
    stateRef.current.texts = stateRef.current.texts.filter((t) => t.id !== tid);
    persist();
    rerender();
  }

  function startDragText(e: PointerEvent, tid: string) {
    if (tool !== "select") return;
    const t = stateRef.current.texts.find((x) => x.id === tid);
    if (!t) return;
    const r = wrapRef.current!.getBoundingClientRect();
    draggingText.current = {
      id: tid,
      dx: e.clientX - r.left - t.x,
      dy: e.clientY - r.top - t.y,
    };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }
  function moveDragText(e: PointerEvent) {
    const d = draggingText.current;
    if (!d) return;
    const r = wrapRef.current!.getBoundingClientRect();
    const t = stateRef.current.texts.find((x) => x.id === d.id);
    if (!t) return;
    t.x = e.clientX - r.left - d.dx;
    t.y = e.clientY - r.top - d.dy;
    rerender();
  }
  function endDragText() {
    if (draggingText.current) {
      persist();
      draggingText.current = null;
    }
  }

  const hasContent =
    stateRef.current.strokes.length + stateRef.current.texts.length > 0;

  const cursor =
    tool === "pen" || tool === "eraser"
      ? "crosshair"
      : tool === "text"
      ? "text"
      : "default";

  return (
    <div
      ref={wrapRef}
      className="absolute inset-0"
      style={{
        pointerEvents: !editable || tool === "select" ? "none" : "auto",
        cursor: editable ? cursor : "default",
      }}
      onPointerDown={editable ? onPointerDown : undefined}
      onPointerMove={
        editable
          ? (e) => {
              onPointerMove(e);
              moveDragText(e);
            }
          : undefined
      }
      onPointerUp={
        editable
          ? () => {
              onPointerUp();
              endDragText();
            }
          : undefined
      }
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ pointerEvents: "none" }}
      />

      {stateRef.current.texts.map((t) => (
        <div
          key={t.id}
          onPointerDown={
            editable
              ? (e) => {
                  e.stopPropagation();
                  startDragText(e, t.id);
                }
              : undefined
          }
          className="group absolute select-none"
          style={{
            left: t.x,
            top: t.y,
            color: t.color,
            fontSize: t.size,
            lineHeight: 1.1,
            fontWeight: 600,
            pointerEvents: editable ? "auto" : "none",
            cursor: editable && tool === "select" ? "grab" : "default",
          }}
        >
          <span>{t.text}</span>
          {editable && (
            <button
              type="button"
              aria-label="Remove text"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => removeText(t.id)}
              className="no-print ml-1 align-middle opacity-0 group-hover:opacity-100 transition-opacity rounded-full bg-white border border-brand-200 text-brand-500 hover:text-danger w-4 h-4 inline-grid place-items-center cursor-pointer"
            >
              <X size={10} />
            </button>
          )}
        </div>
      ))}

      {editable && (
      /* Top toolbar — Microsoft-ribbon style, full width on top of the
         doc area; never prints. */
      <div className="no-print absolute top-0 left-0 right-0 z-10 flex flex-wrap items-center gap-1 rounded-t-2xl bg-white/95 border-b border-brand-200 shadow-sm p-2 backdrop-blur">
        {(
          [
            { t: "select", icon: MousePointer, label: "Select" },
            { t: "pen", icon: Pencil, label: "Pen" },
            { t: "eraser", icon: Eraser, label: "Eraser" },
            { t: "text", icon: TypeIcon, label: "Text" },
          ] as { t: Tool; icon: typeof Pencil; label: string }[]
        ).map(({ t, icon: Icon, label }) => (
          <button
            key={t}
            type="button"
            aria-label={label}
            title={label}
            onClick={() => setTool(t)}
            className={cn(
              "h-8 w-8 grid place-items-center rounded-lg transition-colors cursor-pointer",
              tool === t
                ? "bg-primary-400 text-ink"
                : "text-brand-500 hover:bg-brand-50 hover:text-ink"
            )}
          >
            <Icon size={15} />
          </button>
        ))}

        <span className="mx-1 h-6 w-px bg-brand-200" />

        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Color ${c}`}
            onClick={() => setColor(c)}
            className={cn(
              "h-6 w-6 rounded-full border transition-transform cursor-pointer",
              color === c ? "border-ink scale-110" : "border-brand-200"
            )}
            style={{ background: c }}
          />
        ))}

        <span className="mx-1 h-6 w-px bg-brand-200" />

        <input
          type="range"
          aria-label="Brush size"
          min={1}
          max={20}
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
          className="w-20 accent-primary-400"
        />

        <span className="mx-1 h-6 w-px bg-brand-200" />

        <button
          type="button"
          aria-label="Undo"
          title="Undo"
          onClick={undo}
          disabled={opsRef.current.length === 0}
          className="h-8 w-8 grid place-items-center rounded-lg text-brand-500 hover:bg-brand-50 hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          <Undo2 size={15} />
        </button>
        <button
          type="button"
          aria-label="Redo"
          title="Redo"
          onClick={redo}
          disabled={undoneRef.current.length === 0}
          className="h-8 w-8 grid place-items-center rounded-lg text-brand-500 hover:bg-brand-50 hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          <Redo2 size={15} />
        </button>
        <button
          type="button"
          aria-label="Clear all"
          title="Clear all"
          onClick={clearAll}
          disabled={!hasContent}
          className="h-8 w-8 grid place-items-center rounded-lg text-brand-500 hover:bg-danger/10 hover:text-danger disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          <Trash2 size={15} />
        </button>

        {onSave && (
          <>
            <span className="mx-1 h-6 w-px bg-brand-200" />
            <button
              type="button"
              onClick={onSave}
              className="btn-primary h-8 px-3 text-xs"
            >
              <Save size={14} /> Save
            </button>
          </>
        )}
      </div>
      )}
    </div>
  );
}
