import { FileySpinner as Loader2 } from "./FileySpinner";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
  type PointerEvent,
} from "react";
import {
  MousePointer2,
  Type,
  Highlighter,
  Paintbrush,
  Square,
  Crop,
  Eraser,
  Undo2,
  Redo2,
  RotateCw,
  Trash2,
  Check,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import * as safePdf from "../lib/pdfjsSafe";
import {
  savePdfAnnotations,
  type Annotation,
  type PageChange,
  type Point,
} from "../lib/pdfAnnotations";
import { useUI } from "../lib/ui";

export type PdfEditorHandle = { prepare: () => Promise<File> };
type Tool = "select" | "text" | "highlight" | "ink" | "rect" | "crop" | "erase";
type Snapshot = { marks: Annotation[]; changes: Record<number, PageChange> };
const EMPTY: Snapshot = { marks: [], changes: {} };
const TOOLS = [
  {
    id: "select",
    name: "Select",
    icon: MousePointer2,
    hint: "Select a mark to move it or change its text. Arrow keys move a selected mark.",
  },
  {
    id: "ink",
    name: "Brush",
    icon: Paintbrush,
    hint: "Draw on the page with your mouse, pen or finger.",
  },
  {
    id: "text",
    name: "Text",
    icon: Type,
    hint: "Click the page to add text. Edit the wording in the text field above.",
  },
  {
    id: "highlight",
    name: "Highlight",
    icon: Highlighter,
    hint: "Drag across the area you want to highlight.",
  },
  { id: "rect", name: "Shape", icon: Square, hint: "Drag to draw a rectangle." },
  {
    id: "erase",
    name: "Eraser",
    icon: Eraser,
    hint: "Click an added mark to remove it. Original PDF content stays unchanged.",
  },
  {
    id: "crop",
    name: "Crop",
    icon: Crop,
    hint: "Drag to choose the visible page area. Cropping does not redact hidden content.",
  },
] as const;
const moveMark = (mark: Annotation, dx: number, dy: number): Annotation =>
  mark.kind === "ink"
    ? { ...mark, points: mark.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
    : { ...mark, x: mark.x + dx, y: mark.y + dy };

export default function InlinePdfEditor({
  file,
  onApply,
  editorRef,
  onDirtyChange,
  disabled = false,
}: {
  file: File;
  onApply: (file: File) => void;
  editorRef?: Ref<PdfEditorHandle>;
  onDirtyChange?: (dirty: boolean) => void;
  disabled?: boolean;
}) {
  const { toast } = useUI();
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [preview, setPreview] = useState<{
    src: string;
    width: number;
    height: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [tool, setTool] = useState<Tool>("select");
  const [history, setHistory] = useState<{ entries: Snapshot[]; index: number }>({
    entries: [EMPTY],
    index: 0,
  });
  const snapshot = history.entries[history.index];
  const { marks, changes } = snapshot;
  const [selected, setSelected] = useState<string | null>(null);
  const [color, setColor] = useState("#172b4d");
  const [width, setWidth] = useState(3);
  const [text, setText] = useState("Your text");
  const [size, setSize] = useState(16);
  const [bold, setBold] = useState(false);
  const [family, setFamily] = useState<"Sans" | "Serif" | "Mono">("Sans");
  const [zoom, setZoom] = useState(100);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Annotation | null>(null);
  const [cropDraft, setCropDraft] = useState<PageChange["crop"]>();
  const stage = useRef<SVGSVGElement>(null);
  const gesture = useRef<{ start: Point; points: Point[]; original?: Annotation } | null>(
    null
  );
  const dirty =
    marks.length > 0 ||
    Object.values(changes).some((p) => p.deleted || p.crop || p.rotation);
  const locked = disabled || saving;
  const active = marks.find((mark) => mark.id === selected);
  const changeCallback = useRef(onDirtyChange);
  changeCallback.current = onDirtyChange;
  useEffect(() => {
    changeCallback.current?.(dirty);
  }, [snapshot, dirty]);
  useEffect(() => {
    setHistory({ entries: [EMPTY], index: 0 });
    setPage(0);
    setSelected(null);
  }, [file]);
  const commit = (next: Snapshot) =>
    setHistory((prev) => ({
      entries: [...prev.entries.slice(0, prev.index + 1), next],
      index: prev.index + 1,
    }));
  const undo = () => {
    setHistory((prev) => ({ ...prev, index: Math.max(0, prev.index - 1) }));
    setSelected(null);
  };
  const redo = () => {
    setHistory((prev) => ({
      ...prev,
      index: Math.min(prev.entries.length - 1, prev.index + 1),
    }));
    setSelected(null);
  };
  const remove = (id: string) => {
    commit({ ...snapshot, marks: marks.filter((mark) => mark.id !== id) });
    setSelected(null);
  };
  const updateMark = (next: Annotation) =>
    commit({
      ...snapshot,
      marks: marks.map((mark) => (mark.id === next.id ? next : mark)),
    });
  const updatePage = (patch: PageChange) =>
    commit({
      ...snapshot,
      changes: { ...changes, [page]: { ...changes[page], ...patch } },
    });

  useEffect(() => {
    let dead = false;
    let task: ReturnType<typeof safePdf.getDocument> | undefined;
    setPreview(null);
    setError("");
    setSelected(null);
    (async () => {
      try {
        task = safePdf.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
        const pdf = await task.promise;
        if (dead) return;
        setPageCount(pdf.numPages);
        const p = await pdf.getPage(Math.min(page + 1, pdf.numPages));
        const base = p.getViewport({ scale: 1 });
        const viewport = p.getViewport({ scale: 1400 / base.width });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("The document preview could not be created.");
        await p.render({ canvas, canvasContext: ctx, viewport }).promise;
        if (!dead)
          setPreview({
            src: canvas.toDataURL("image/png"),
            width: base.width,
            height: base.height,
          });
      } catch (failure) {
        if (!dead)
          setError(
            /password|encrypted/i.test(String(failure))
              ? "This PDF is locked. Use Unlock PDF first, then open the unlocked copy here."
              : "Could not preview this PDF. Try another file."
          );
      } finally {
        if (task) void task.destroy().catch(() => {});
      }
    })();
    return () => {
      dead = true;
      if (task) void task.destroy().catch(() => {});
    };
  }, [file, page]);

  const prepare = () =>
    dirty ? savePdfAnnotations(file, marks, changes) : Promise.resolve(file);
  useImperativeHandle(editorRef, () => ({ prepare }));
  const apply = async () => {
    setSaving(true);
    try {
      onApply(await prepare());
      toast.success("Edits saved to your working copy.");
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(false);
    }
  };
  const rotation = changes[page]?.rotation || 0;
  const baseW = preview?.width || 595,
    baseH = preview?.height || 842;
  const quarter = rotation === 90 || rotation === 270;
  const viewW = quarter ? baseH : baseW,
    viewH = quarter ? baseW : baseH;
  const transform =
    rotation === 90
      ? `translate(${baseH} 0) rotate(90)`
      : rotation === 180
        ? `translate(${baseW} ${baseH}) rotate(180)`
        : rotation === 270
          ? `translate(0 ${baseW}) rotate(270)`
          : undefined;
  const local = (event: PointerEvent): Point => {
    const rect = stage.current!.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * viewW,
      y = ((event.clientY - rect.top) / rect.height) * viewH;
    const p =
      rotation === 90
        ? { x: y, y: baseH - x }
        : rotation === 180
          ? { x: baseW - x, y: baseH - y }
          : rotation === 270
            ? { x: baseW - y, y: x }
            : { x, y };
    return { x: Math.max(0, Math.min(baseW, p.x)), y: Math.max(0, Math.min(baseH, p.y)) };
  };
  const down = (event: PointerEvent<SVGSVGElement>) => {
    if (locked || !preview || changes[page]?.deleted || event.button !== 0) return;
    const id = (event.target as Element)
      .closest("[data-annotation]")
      ?.getAttribute("data-annotation");
    const hit = marks.find((mark) => mark.id === id);
    if (tool === "erase") {
      if (hit) remove(hit.id);
      return;
    }
    const point = local(event);
    if (tool === "select" && !hit) {
      setSelected(null);
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "text") {
      const mark: Annotation = {
        id: crypto.randomUUID(),
        page,
        kind: "text",
        ...point,
        text,
        color,
        size,
        bold,
        family,
      };
      commit({ ...snapshot, marks: [...marks, mark] });
      setSelected(mark.id);
      setTool("select");
      return;
    }
    if (hit && tool === "select") setSelected(hit.id);
    gesture.current = {
      start: point,
      points: [point],
      original: tool === "select" ? hit : undefined,
    };
    if (tool === "ink")
      setDraft({
        id: crypto.randomUUID(),
        page,
        kind: "ink",
        points: [point],
        color,
        width,
      });
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (!g || locked) return;
    const point = local(event);
    if (g.original) {
      setDraft(moveMark(g.original, point.x - g.start.x, point.y - g.start.y));
      return;
    }
    if (tool === "ink") {
      g.points.push(point);
      setDraft({ id: "drawing", page, kind: "ink", points: [...g.points], color, width });
    } else {
      const box = {
        x: Math.min(g.start.x, point.x),
        y: Math.min(g.start.y, point.y),
        w: Math.abs(point.x - g.start.x),
        h: Math.abs(point.y - g.start.y),
      };
      if (tool === "crop") setCropDraft(box);
      else if (tool === "highlight" || tool === "rect")
        setDraft({
          id: "drawing",
          page,
          kind: tool,
          ...box,
          color: tool === "highlight" ? "#faca1a" : color,
        });
    }
  };
  const up = () => {
    if (!gesture.current) return;
    if (draft) {
      if (gesture.current.original) updateMark(draft);
      else if (draft.kind === "ink" || ("w" in draft && draft.w > 2 && draft.h > 2))
        commit({ ...snapshot, marks: [...marks, { ...draft, id: crypto.randomUUID() }] });
    } else if (cropDraft && cropDraft.w > 4 && cropDraft.h > 4)
      updatePage({ crop: cropDraft });
    gesture.current = null;
    setDraft(null);
    setCropDraft(undefined);
  };
  const selectedText = active?.kind === "text" ? active : null;
  const choosePage = (value: number) => {
    gesture.current = null;
    setDraft(null);
    setCropDraft(undefined);
    setPage(value);
  };

  return (
    <div
      className="pdf-editor"
      onKeyDown={(event) => {
        if (locked || /INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement).tagName))
          return;
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
          event.preventDefault();
          event.shiftKey ? redo() : undo();
        }
        if (active && (event.key === "Delete" || event.key === "Backspace")) {
          event.preventDefault();
          remove(active.id);
        }
        if (
          active &&
          ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
        ) {
          event.preventDefault();
          const step = event.shiftKey ? 10 : 1;
          updateMark(
            moveMark(
              active,
              event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0,
              event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0
            )
          );
        }
      }}
    >
      <div className="pdf-editor-toolbar" role="group" aria-label="Editing tools">
        {TOOLS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="btn-ghost pdf-editor-tool"
            aria-pressed={tool === item.id}
            disabled={locked}
            onClick={() => {
              setTool(item.id);
              setSelected(null);
            }}
          >
            <item.icon size={16} />
            {item.name}
          </button>
        ))}
        <span className="flex-1" />
        <button
          type="button"
          className="btn-ghost pdf-editor-icon"
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
          disabled={locked || history.index === 0}
          onClick={undo}
        >
          <Undo2 size={16} />
        </button>
        <button
          type="button"
          className="btn-ghost pdf-editor-icon"
          title="Redo (Ctrl+Shift+Z)"
          aria-label="Redo"
          disabled={locked || history.index === history.entries.length - 1}
          onClick={redo}
        >
          <Redo2 size={16} />
        </button>
      </div>
      <fieldset disabled={locked} className="pdf-editor-options">
        {(tool === "ink" || tool === "text" || tool === "rect" || !!active) && (
          <label className="flex items-center gap-2 text-xs">
            Colour
            <input
              type="color"
              aria-label="Drawing colour"
              value={active?.color || color}
              onChange={(event) => {
                setColor(event.target.value);
                if (active) updateMark({ ...active, color: event.target.value });
              }}
              className="h-10 w-10 cursor-pointer rounded-full border border-border bg-card p-1"
            />
          </label>
        )}
        {tool === "ink" && (
          <label className="flex items-center gap-2 text-xs">
            Brush size
            <input
              type="range"
              min="1"
              max="18"
              value={width}
              onChange={(event) => setWidth(Number(event.target.value))}
              className="w-24 accent-primary-500"
            />
            <span className="w-9 tabular-nums">{width} pt</span>
          </label>
        )}
        {(tool === "text" || selectedText) && (
          <>
            <label className="sr-only" htmlFor="annotation-text">
              Text content
            </label>
            <input
              id="annotation-text"
              className="input min-w-0 flex-1"
              value={selectedText?.text ?? text}
              onChange={(event) => {
                setText(event.target.value);
                if (selectedText)
                  updateMark({ ...selectedText, text: event.target.value });
              }}
            />
            <select
              aria-label="Text font"
              className="select w-24"
              value={selectedText?.family ?? family}
              onChange={(event) => {
                const value = event.target.value as typeof family;
                setFamily(value);
                if (selectedText) updateMark({ ...selectedText, family: value });
              }}
            >
              <option>Sans</option>
              <option>Serif</option>
              <option>Mono</option>
            </select>
            <input
              type="number"
              aria-label="Text size"
              min="8"
              max="72"
              className="input w-20"
              value={selectedText?.size ?? size}
              onChange={(event) => {
                const value = Math.max(8, Math.min(72, Number(event.target.value)));
                setSize(value);
                if (selectedText) updateMark({ ...selectedText, size: value });
              }}
            />
            <button
              type="button"
              className="btn-ghost"
              aria-pressed={selectedText?.bold ?? bold}
              onClick={() => {
                const value = !(selectedText?.bold ?? bold);
                setBold(value);
                if (selectedText) updateMark({ ...selectedText, bold: value });
              }}
            >
              Bold
            </button>
          </>
        )}
        {active && (
          <button type="button" className="btn-ghost" onClick={() => remove(active.id)}>
            <Trash2 size={15} />
            Remove mark
          </button>
        )}
        {tool === "crop" && changes[page]?.crop && (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => updatePage({ crop: undefined })}
          >
            Reset crop
          </button>
        )}
        <p className="text-xs text-muted-foreground">
          {TOOLS.find((item) => item.id === tool)?.hint}
        </p>
      </fieldset>
      <div className="pdf-editor-viewbar">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="btn-ghost pdf-editor-icon"
            aria-label="Previous page"
            disabled={locked || page === 0}
            onClick={() => choosePage(page - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <span className="px-2 text-xs tabular-nums">
            Page {page + 1} of {pageCount || "…"}
          </span>
          <button
            type="button"
            className="btn-ghost pdf-editor-icon"
            aria-label="Next page"
            disabled={locked || page >= pageCount - 1}
            onClick={() => choosePage(page + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            className="btn-ghost pdf-editor-icon"
            aria-label="Rotate page right"
            disabled={locked || !preview}
            onClick={() => updatePage({ rotation: (rotation + 90) % 360 })}
          >
            <RotateCw size={16} />
          </button>
          <button
            type="button"
            className="btn-ghost pdf-editor-icon"
            aria-label={changes[page]?.deleted ? "Restore page" : "Remove page"}
            disabled={
              locked ||
              (!changes[page]?.deleted &&
                pageCount - Object.values(changes).filter((p) => p.deleted).length <= 1)
            }
            onClick={() => updatePage({ deleted: !changes[page]?.deleted })}
          >
            <Trash2 size={16} />
          </button>
          <span className="mx-1 h-5 w-px bg-border" />
          <button
            type="button"
            className="btn-ghost pdf-editor-icon"
            aria-label="Zoom out"
            disabled={zoom <= 50}
            onClick={() => setZoom(Math.max(50, zoom - 25))}
          >
            <ZoomOut size={16} />
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setZoom(100)}
            title="Fit page width"
          >
            {zoom === 100 ? "Fit" : zoom + "%"}
          </button>
          <button
            type="button"
            className="btn-ghost pdf-editor-icon"
            aria-label="Zoom in"
            disabled={zoom >= 200}
            onClick={() => setZoom(Math.min(200, zoom + 25))}
          >
            <ZoomIn size={16} />
          </button>
        </div>
      </div>
      <div className="pdf-editor-canvas">
        {error ? (
          <div role="alert" className="p-8 text-sm text-danger">
            {error}
          </div>
        ) : !preview ? (
          <div
            role="status"
            className="grid min-h-80 place-items-center text-muted-foreground"
          >
            <Loader2 size={22} className="animate-spin" />
            <span>Loading page…</span>
          </div>
        ) : (
          <>
            {changes[page]?.deleted && (
              <p role="status" className="mb-3 text-center text-sm">
                This page will be removed. Use Restore page or Undo to keep it.
              </p>
            )}
            <svg
              ref={stage}
              viewBox={`0 0 ${viewW} ${viewH}`}
              className="pdf-editor-paper"
              role="group"
              aria-label={`Editable PDF page ${page + 1}`}
              tabIndex={0}
              style={{
                width: `${zoom}%`,
                maxWidth: "none",
                opacity: changes[page]?.deleted ? 0.35 : 1,
                cursor:
                  tool === "select" ? "default" : tool === "text" ? "text" : "crosshair",
                touchAction: tool === "select" && !active ? "pan-y" : "none",
              }}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={() => {
                gesture.current = null;
                setDraft(null);
                setCropDraft(undefined);
              }}
            >
              <g transform={transform}>
                <image href={preview.src} width={baseW} height={baseH} />
                {[
                  ...marks.filter((mark) => mark.page === page && mark.id !== draft?.id),
                  ...(draft ? [draft] : []),
                ].map((mark) => (
                  <g
                    key={mark.id}
                    data-annotation={mark.id}
                    role="button"
                    aria-label={`${mark.kind === "ink" ? "Brush stroke" : mark.kind === "rect" ? "Rectangle" : mark.kind === "text" ? "Text: " + mark.text : "Highlight"}`}
                    tabIndex={locked ? -1 : 0}
                    onFocus={() => setSelected(mark.id)}
                    onKeyDown={(event) => {
                      if (!locked && (event.key === "Enter" || event.key === " ")) {
                        event.preventDefault();
                        tool === "erase" ? remove(mark.id) : setSelected(mark.id);
                      }
                    }}
                    style={{
                      cursor:
                        tool === "erase"
                          ? "crosshair"
                          : tool === "select"
                            ? "move"
                            : undefined,
                    }}
                  >
                    {mark.kind === "ink" ? (
                      mark.points.length === 1 ? (
                        <circle
                          cx={mark.points[0].x}
                          cy={mark.points[0].y}
                          r={mark.width / 2}
                          fill={mark.color}
                        />
                      ) : (
                        <polyline
                          points={mark.points.map((p) => `${p.x},${p.y}`).join(" ")}
                          stroke={mark.color}
                          strokeWidth={mark.width}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          fill="none"
                          pointerEvents="stroke"
                        />
                      )
                    ) : mark.kind === "text" ? (
                      <text
                        x={mark.x}
                        y={mark.y + mark.size}
                        fontSize={mark.size}
                        fontFamily={
                          mark.family === "Serif"
                            ? "Times New Roman, serif"
                            : mark.family === "Mono"
                              ? "Courier New, monospace"
                              : "Arial, sans-serif"
                        }
                        fontWeight={mark.bold ? 700 : 400}
                        fill={mark.color}
                      >
                        {mark.text}
                      </text>
                    ) : (
                      <rect
                        x={mark.x}
                        y={mark.y}
                        width={mark.w}
                        height={mark.h}
                        fill={mark.kind === "highlight" ? mark.color : "transparent"}
                        fillOpacity={mark.kind === "highlight" ? 0.35 : 1}
                        stroke={mark.kind === "rect" ? mark.color : "none"}
                        strokeWidth={1.5}
                      />
                    )}
                    {selected === mark.id && (
                      <title>Selected. Drag to move, or press Delete to remove.</title>
                    )}
                  </g>
                ))}
                {(cropDraft || changes[page]?.crop) &&
                  (() => {
                    const box = cropDraft || changes[page]!.crop!;
                    return (
                      <rect
                        {...{ x: box.x, y: box.y, width: box.w, height: box.h }}
                        fill="none"
                        stroke="#172b4d"
                        strokeWidth={2}
                        strokeDasharray="6 4"
                        pointerEvents="none"
                      />
                    );
                  })()}
              </g>
            </svg>
          </>
        )}
      </div>
      <div className="pdf-editor-footer">
        <span role="status" className="text-xs text-muted-foreground">
          {dirty
            ? "Edits will be included when you create your file."
            : "Your original file stays unchanged."}
        </span>
        <button
          type="button"
          className="btn-ghost"
          disabled={locked || !dirty}
          onClick={() => void apply()}
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
          Save edits
        </button>
      </div>
    </div>
  );
}
