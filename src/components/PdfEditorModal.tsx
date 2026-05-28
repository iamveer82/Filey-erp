import { useEffect, useRef, useState } from "react";
import {
  Upload,
  MousePointer2,
  Type as TypeIcon,
  Highlighter,
  Pen,
  Square,
  Crop,
  RotateCw,
  Trash2,
  Save,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import { Modal } from "./ui";
import { useUI } from "../lib/ui";
import { downloadFile } from "../lib/pdfTools";
import { cn } from "../lib/format";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/* In-browser PDF editor — text / highlight / pen / rectangle / crop / rotate
 * / delete page. Coordinates are kept in display pixels (page rendered at a
 * fixed width) and converted to PDF points at save time using each page's
 * own width in points, so per-page rendering isn't required for baking. */

const RENDER_W = 760;

type Tool = "select" | "text" | "highlight" | "pen" | "rect" | "crop";

type Family = "Sans" | "Serif" | "Mono";

interface TextEdit {
  id: string;
  page: number;
  kind: "text";
  x: number;
  y: number;
  text: string;
  family: Family;
  size: number;
  color: string;
  weight: number;
  italic: boolean;
}
interface HighlightEdit {
  id: string;
  page: number;
  kind: "highlight";
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}
interface RectEdit {
  id: string;
  page: number;
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  stroke: string;
}
interface InkEdit {
  id: string;
  page: number;
  kind: "ink";
  pts: { x: number; y: number }[];
  color: string;
  width: number;
}
type Edit = TextEdit | HighlightEdit | RectEdit | InkEdit;
interface PageOp {
  rotate?: number;
  deleted?: boolean;
  crop?: { x: number; y: number; w: number; h: number };
}

const FAMILY_PT: Record<Family, "Sans" | "Serif" | "Mono"> = {
  Sans: "Sans",
  Serif: "Serif",
  Mono: "Mono",
};

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  const f = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
  const n = parseInt(f, 16);
  return Number.isNaN(n)
    ? { r: 0, g: 0, b: 0 }
    : { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}
const uid = () => Math.random().toString(36).slice(2, 9);

export default function PdfEditorModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useUI();
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(0);
  const [pageImg, setPageImg] = useState("");
  const [ptSize, setPtSize] = useState<Record<number, { w: number; h: number }>>({});
  const [tool, setTool] = useState<Tool>("select");
  const [edits, setEdits] = useState<Edit[]>([]);
  const [ops, setOps] = useState<Record<number, PageOp>>({});
  const [saving, setSaving] = useState(false);

  // Tool options
  const [textOpt, setTextOpt] = useState<{
    family: Family;
    size: number;
    color: string;
    weight: number;
    italic: boolean;
  }>({ family: "Sans", size: 16, color: "#0a0a0a", weight: 400, italic: false });
  const [penOpt, setPenOpt] = useState({ color: "#FFD600", width: 3 });
  const [rectOpt, setRectOpt] = useState({ stroke: "#0a0a0a" });
  const [hiOpt, setHiOpt] = useState({ color: "#FFE066" });

  // Drag state for new highlight/rect/crop + ink draw
  const dragRef = useRef<{
    kind: "ink" | "highlight" | "rect" | "crop";
    start: { x: number; y: number };
    cur: { x: number; y: number };
    inkPts?: { x: number; y: number }[];
  } | null>(null);
  const [, force] = useState(0);
  const reflect = () => force((n) => n + 1);

  const reset = () => {
    setFile(null);
    setPages(0);
    setPage(0);
    setPageImg("");
    setPtSize({});
    setTool("select");
    setEdits([]);
    setOps({});
    setSaving(false);
  };

  // Render the chosen page on file/page change.
  useEffect(() => {
    if (!file) return;
    let dead = false;
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
        setPtSize((s) => ({ ...s, [idx]: { w: pt.width, h: pt.height } }));
        const scale = RENDER_W / pt.width;
        const vp = p.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = vp.width;
        canvas.height = vp.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        await p.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
        if (dead) return;
        setPageImg(canvas.toDataURL("image/png"));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      dead = true;
    };
  }, [file, page, toast]);

  const stage = useRef<HTMLDivElement>(null);
  const local = (e: React.PointerEvent | React.MouseEvent) => {
    const r = stage.current?.getBoundingClientRect() ?? new DOMRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // Pointer handlers
  const onDown = (e: React.PointerEvent) => {
    if (!pageImg) return;
    if (tool === "select") return;
    e.preventDefault();
    const p = local(e);
    if (tool === "text") {
      const id = uid();
      setEdits((arr) => [
        ...arr,
        {
          id,
          page,
          kind: "text",
          x: p.x,
          y: p.y,
          text: "Type here…",
          ...textOpt,
        },
      ]);
      setTool("select");
      // focus the new node on next tick
      setTimeout(() => {
        const el = document.querySelector<HTMLElement>(`[data-edit="${id}"]`);
        el?.focus();
        if (el && document.createRange) {
          const range = document.createRange();
          range.selectNodeContents(el);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
      }, 0);
      return;
    }
    if (tool === "pen") {
      dragRef.current = {
        kind: "ink",
        start: p,
        cur: p,
        inkPts: [p],
      };
      reflect();
      return;
    }
    // highlight / rect / crop -> drag rectangle
    dragRef.current = { kind: tool, start: p, cur: p };
    reflect();
  };
  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const p = local(e);
    d.cur = p;
    if (d.kind === "ink") d.inkPts?.push(p);
    reflect();
  };
  const onUp = () => {
    const d = dragRef.current;
    if (!d) return;
    const { start, cur } = d;
    if (d.kind === "ink" && d.inkPts && d.inkPts.length > 1) {
      setEdits((arr) => [
        ...arr,
        { id: uid(), page, kind: "ink", pts: d.inkPts!, color: penOpt.color, width: penOpt.width },
      ]);
    } else if (d.kind === "highlight" || d.kind === "rect" || d.kind === "crop") {
      const x = Math.min(start.x, cur.x);
      const y = Math.min(start.y, cur.y);
      const w = Math.abs(cur.x - start.x);
      const h = Math.abs(cur.y - start.y);
      if (w > 4 && h > 4) {
        if (d.kind === "highlight")
          setEdits((arr) => [
            ...arr,
            { id: uid(), page, kind: "highlight", x, y, w, h, color: hiOpt.color },
          ]);
        else if (d.kind === "rect")
          setEdits((arr) => [
            ...arr,
            { id: uid(), page, kind: "rect", x, y, w, h, stroke: rectOpt.stroke },
          ]);
        else
          setOps((o) => ({ ...o, [page]: { ...(o[page] ?? {}), crop: { x, y, w, h } } }));
      }
    }
    dragRef.current = null;
    reflect();
  };

  const removeEdit = (id: string) => setEdits((arr) => arr.filter((e) => e.id !== id));
  const updateText = (id: string, text: string) =>
    setEdits((arr) => arr.map((e) => (e.id === id && e.kind === "text" ? { ...e, text } : e)));

  const setPageOp = (i: number, patch: Partial<PageOp>) =>
    setOps((o) => ({ ...o, [i]: { ...(o[i] ?? {}), ...patch } }));

  const rotatePage = (deg: number) => {
    const cur = ops[page]?.rotate ?? 0;
    setPageOp(page, { rotate: (cur + deg + 360) % 360 });
  };
  const deletePage = () => {
    if (pages <= 1) return toast.error("A PDF must have at least one page.");
    setPageOp(page, { deleted: true });
    // jump to next visible
    setPage((p) => Math.min(p + 1, pages - 1));
  };
  const clearPageEdits = () => {
    setEdits((arr) => arr.filter((e) => e.page !== page));
    setOps((o) => ({ ...o, [page]: { ...(o[page] ?? {}), crop: undefined } }));
  };

  // ── Save: bake edits + page ops via pdf-lib ──
  const save = async () => {
    if (!file) return;
    setSaving(true);
    try {
      const doc = await PDFDocument.load(await file.arrayBuffer(), {
        ignoreEncryption: true,
      });
      // Embed standard fonts up front (lazily on demand below).
      const fontCache: Partial<Record<string, Awaited<ReturnType<typeof doc.embedFont>>>> = {};
      const stdFont = async (family: Family, weight: number, italic: boolean) => {
        const map: Record<Family, { reg: StandardFonts; bold: StandardFonts; ita: StandardFonts; bita: StandardFonts }> = {
          Sans: {
            reg: StandardFonts.Helvetica,
            bold: StandardFonts.HelveticaBold,
            ita: StandardFonts.HelveticaOblique,
            bita: StandardFonts.HelveticaBoldOblique,
          },
          Serif: {
            reg: StandardFonts.TimesRoman,
            bold: StandardFonts.TimesRomanBold,
            ita: StandardFonts.TimesRomanItalic,
            bita: StandardFonts.TimesRomanBoldItalic,
          },
          Mono: {
            reg: StandardFonts.Courier,
            bold: StandardFonts.CourierBold,
            ita: StandardFonts.CourierOblique,
            bita: StandardFonts.CourierBoldOblique,
          },
        };
        const m = map[family];
        const which = weight >= 600
          ? italic ? m.bita : m.bold
          : italic ? m.ita : m.reg;
        const key = String(which);
        if (!fontCache[key]) fontCache[key] = await doc.embedFont(which);
        return fontCache[key]!;
      };

      const pageList = doc.getPages();
      // Process each (still-existing) page; pdf-lib indices shift after removals,
      // so do destructive ops in a second pass, after baking edits.
      for (let i = 0; i < pageList.length; i++) {
        if (ops[i]?.deleted) continue;
        const p = pageList[i];
        const wPt = p.getWidth();
        const hPt = p.getHeight();
        const s = wPt / RENDER_W; // display px → pt

        // rotate
        const rot = ops[i]?.rotate;
        if (rot) {
          const cur = p.getRotation().angle;
          p.setRotation(degrees((cur + rot) % 360));
        }

        // edits for this page
        for (const e of edits.filter((x) => x.page === i)) {
          if (e.kind === "highlight") {
            const c = hexToRgb(e.color);
            p.drawRectangle({
              x: e.x * s,
              y: hPt - (e.y + e.h) * s,
              width: e.w * s,
              height: e.h * s,
              color: rgb(c.r, c.g, c.b),
              opacity: 0.4,
              borderWidth: 0,
            });
          } else if (e.kind === "rect") {
            const c = hexToRgb(e.stroke);
            p.drawRectangle({
              x: e.x * s,
              y: hPt - (e.y + e.h) * s,
              width: e.w * s,
              height: e.h * s,
              borderColor: rgb(c.r, c.g, c.b),
              borderWidth: 1.5,
            });
          } else if (e.kind === "ink") {
            const c = hexToRgb(e.color);
            for (let k = 1; k < e.pts.length; k++) {
              const a = e.pts[k - 1];
              const b = e.pts[k];
              p.drawLine({
                start: { x: a.x * s, y: hPt - a.y * s },
                end: { x: b.x * s, y: hPt - b.y * s },
                thickness: e.width * s,
                color: rgb(c.r, c.g, c.b),
              });
            }
          } else if (e.kind === "text") {
            const font = await stdFont(e.family, e.weight, e.italic);
            const c = hexToRgb(e.color);
            const sizePt = e.size * s;
            p.drawText(e.text, {
              x: e.x * s,
              y: hPt - e.y * s - sizePt, // baseline-from-top adjustment
              size: sizePt,
              color: rgb(c.r, c.g, c.b),
              font,
            });
          }
        }

        // crop
        const cr = ops[i]?.crop;
        if (cr) {
          p.setCropBox(cr.x * s, hPt - (cr.y + cr.h) * s, cr.w * s, cr.h * s);
        }
      }
      // remove deleted pages from the back so indices stay stable
      for (let i = pageList.length - 1; i >= 0; i--) {
        if (ops[i]?.deleted) doc.removePage(i);
      }

      const name = file.name.replace(/\.pdf$/i, "") + "-edited.pdf";
      const bytes = await doc.save();
      downloadFile({ name, bytes });
      toast.success("Edited PDF downloaded.");
      onClose();
      reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // ── render helpers ──
  const cursor = (() => {
    if (tool === "select") return "default";
    if (tool === "text") return "text";
    if (tool === "pen") return "crosshair";
    return "crosshair";
  })();
  const pageOps = ops[page] ?? {};
  const pageEdits = edits.filter((e) => e.page === page);
  const drag = dragRef.current;

  const Tbtn = ({
    id,
    label,
    Icon,
  }: {
    id: Tool;
    label: string;
    Icon: typeof TypeIcon;
  }) => (
    <button
      onClick={() => setTool(id)}
      title={label}
      className={cn(
        "grid h-9 w-9 place-items-center rounded-lg cursor-pointer",
        tool === id ? "bg-primary-400 text-[#0A0A0A]" : "text-brand-500 hover:bg-brand-50 dark:hover:bg-white/5"
      )}
    >
      <Icon size={16} />
    </button>
  );

  return (
    <Modal open={open} onClose={() => { onClose(); reset(); }} title="Edit PDF">
      {!file ? (
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand-300 px-6 py-10 text-center transition-colors hover:bg-brand-50 dark:hover:bg-white/5">
          <Upload size={26} className="text-brand-400" />
          <span className="text-sm font-semibold text-ink">Upload a PDF to edit</span>
          <span className="text-xs text-brand-400">Text, highlight, pen, rectangle, crop, rotate, delete page — all on-device.</span>
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
      ) : (
        <div className="grid gap-3 md:grid-cols-[60px_1fr_280px]">
          {/* Left toolbar */}
          <div className="flex flex-row md:flex-col gap-1 rounded-xl border border-brand-200 p-1 dark:border-[#3A3D45]">
            <Tbtn id="select" label="Select" Icon={MousePointer2} />
            <Tbtn id="text" label="Text" Icon={TypeIcon} />
            <Tbtn id="highlight" label="Highlight" Icon={Highlighter} />
            <Tbtn id="pen" label="Pen" Icon={Pen} />
            <Tbtn id="rect" label="Rectangle" Icon={Square} />
            <Tbtn id="crop" label="Crop page" Icon={Crop} />
          </div>

          {/* Page stage */}
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <button className="btn-ghost h-8 !px-2" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page <= 0}>
                  <ChevronLeft size={14} />
                </button>
                <span className="text-xs font-semibold text-brand-500">
                  Page {page + 1} / {pages || "…"}{pageOps.deleted ? " (will be deleted)" : ""}
                </span>
                <button className="btn-ghost h-8 !px-2" onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}>
                  <ChevronRight size={14} />
                </button>
              </div>
              <div className="flex items-center gap-1">
                <button className="btn-ghost h-8 text-xs" onClick={() => rotatePage(-90)}><RotateCw size={13} className="-scale-x-100" /> Left</button>
                <button className="btn-ghost h-8 text-xs" onClick={() => rotatePage(90)}><RotateCw size={13} /> Right</button>
                <button className="btn-ghost h-8 text-xs" onClick={deletePage}><Trash2 size={13} /> Delete</button>
                <button className="btn-ghost h-8 text-xs" onClick={clearPageEdits}>Clear edits</button>
              </div>
            </div>

            <div
              ref={stage}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerLeave={onUp}
              className="relative w-full overflow-hidden rounded-xl border border-brand-200 bg-white dark:border-[#3A3D45]"
              style={{
                aspectRatio: ptSize[page] ? `${ptSize[page].w} / ${ptSize[page].h}` : undefined,
                cursor,
                touchAction: "none",
              }}
            >
              {pageImg ? (
                <img src={pageImg} alt={`page ${page + 1}`} className="block h-full w-full select-none" draggable={false} />
              ) : (
                <div className="grid h-full place-items-center text-sm text-brand-400">
                  <Loader2 size={20} className="animate-spin" />
                </div>
              )}

              {/* edits overlay */}
              {pageEdits.map((e) => {
                if (e.kind === "highlight")
                  return (
                    <div key={e.id} onDoubleClick={() => removeEdit(e.id)} style={{ left: e.x, top: e.y, width: e.w, height: e.h, background: e.color, opacity: 0.45 }} className="absolute" title="Double-click to delete" />
                  );
                if (e.kind === "rect")
                  return (
                    <div key={e.id} onDoubleClick={() => removeEdit(e.id)} style={{ left: e.x, top: e.y, width: e.w, height: e.h, border: `1.5px solid ${e.stroke}` }} className="absolute" title="Double-click to delete" />
                  );
                if (e.kind === "ink")
                  return (
                    <svg key={e.id} className="pointer-events-none absolute inset-0 h-full w-full">
                      <polyline fill="none" stroke={e.color} strokeWidth={e.width} strokeLinecap="round" strokeLinejoin="round"
                        points={e.pts.map((p) => `${p.x},${p.y}`).join(" ")} />
                    </svg>
                  );
                // text
                return (
                  <div
                    key={e.id}
                    data-edit={e.id}
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(ev) => updateText(e.id, ev.currentTarget.textContent ?? "")}
                    onDoubleClick={(ev) => ev.stopPropagation()}
                    onKeyDown={(ev) => {
                      if (ev.key === "Delete" && (ev as React.KeyboardEvent).ctrlKey) {
                        ev.preventDefault();
                        removeEdit(e.id);
                      }
                    }}
                    style={{
                      left: e.x,
                      top: e.y,
                      fontFamily: e.family === "Sans" ? "'Plus Jakarta Sans', sans-serif"
                        : e.family === "Serif" ? "'Lora', serif"
                        : "'IBM Plex Mono', monospace",
                      fontSize: e.size,
                      color: e.color,
                      fontWeight: e.weight,
                      fontStyle: e.italic ? "italic" : "normal",
                      whiteSpace: "pre",
                    }}
                    className="absolute outline-none focus:ring-1 focus:ring-primary-500"
                  >
                    {e.text}
                  </div>
                );
              })}

              {/* live drag preview */}
              {drag && drag.kind !== "ink" && (
                <div
                  style={{
                    left: Math.min(drag.start.x, drag.cur.x),
                    top: Math.min(drag.start.y, drag.cur.y),
                    width: Math.abs(drag.cur.x - drag.start.x),
                    height: Math.abs(drag.cur.y - drag.start.y),
                    background: drag.kind === "highlight" ? hiOpt.color : "transparent",
                    opacity: drag.kind === "highlight" ? 0.35 : 1,
                    border: drag.kind === "rect" ? `1.5px solid ${rectOpt.stroke}` : drag.kind === "crop" ? "2px dashed #FFD600" : undefined,
                  }}
                  className="pointer-events-none absolute"
                />
              )}
              {drag && drag.kind === "ink" && drag.inkPts && (
                <svg className="pointer-events-none absolute inset-0 h-full w-full">
                  <polyline fill="none" stroke={penOpt.color} strokeWidth={penOpt.width} strokeLinecap="round" strokeLinejoin="round"
                    points={drag.inkPts.map((p) => `${p.x},${p.y}`).join(" ")} />
                </svg>
              )}

              {/* persisted crop preview */}
              {pageOps.crop && (
                <div
                  style={{
                    left: pageOps.crop.x,
                    top: pageOps.crop.y,
                    width: pageOps.crop.w,
                    height: pageOps.crop.h,
                  }}
                  className="pointer-events-none absolute border-2 border-dashed border-primary-500"
                />
              )}
            </div>
          </div>

          {/* Right options panel */}
          <div className="space-y-3 text-sm">
            {tool === "text" && (
              <div className="space-y-2">
                <p className="text-xs font-bold text-ink">Text</p>
                <div className="grid grid-cols-2 gap-2">
                  <select className="select h-9 text-xs" value={textOpt.family} onChange={(ev) => setTextOpt({ ...textOpt, family: ev.target.value as Family })}>
                    {Object.keys(FAMILY_PT).map((f) => <option key={f}>{f}</option>)}
                  </select>
                  <select className="select h-9 text-xs" value={textOpt.weight} onChange={(ev) => setTextOpt({ ...textOpt, weight: Number(ev.target.value) })}>
                    <option value={400}>Normal</option>
                    <option value={700}>Bold</option>
                  </select>
                </div>
                <label className="flex items-center justify-between gap-2 text-xs font-semibold text-brand-500">
                  Size · {textOpt.size}px
                  <input type="range" min={8} max={64} step={1} value={textOpt.size} onChange={(ev) => setTextOpt({ ...textOpt, size: Number(ev.target.value) })} className="w-1/2 accent-primary-500" />
                </label>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-500">
                    Colour
                    <input type="color" value={textOpt.color} onChange={(ev) => setTextOpt({ ...textOpt, color: ev.target.value })} className="h-7 w-8 cursor-pointer rounded border border-brand-200 dark:border-[#3A3D45]" />
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-500">
                    <input type="checkbox" checked={textOpt.italic} onChange={(ev) => setTextOpt({ ...textOpt, italic: ev.target.checked })} />
                    Italic
                  </label>
                </div>
                <p className="text-[11px] text-brand-400">Click on the page to drop text. Type to edit. Ctrl/Cmd + Delete removes a node.</p>
              </div>
            )}
            {tool === "highlight" && (
              <div className="space-y-2">
                <p className="text-xs font-bold text-ink">Highlight</p>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-500">
                  Colour
                  <input type="color" value={hiOpt.color} onChange={(ev) => setHiOpt({ color: ev.target.value })} className="h-7 w-8 cursor-pointer rounded border border-brand-200 dark:border-[#3A3D45]" />
                </label>
                <p className="text-[11px] text-brand-400">Drag on the page to highlight an area. Double-click a highlight to delete it.</p>
              </div>
            )}
            {tool === "pen" && (
              <div className="space-y-2">
                <p className="text-xs font-bold text-ink">Pen</p>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-500">
                  Colour
                  <input type="color" value={penOpt.color} onChange={(ev) => setPenOpt({ ...penOpt, color: ev.target.value })} className="h-7 w-8 cursor-pointer rounded border border-brand-200 dark:border-[#3A3D45]" />
                </label>
                <label className="flex items-center justify-between gap-2 text-xs font-semibold text-brand-500">
                  Width · {penOpt.width}px
                  <input type="range" min={1} max={12} step={1} value={penOpt.width} onChange={(ev) => setPenOpt({ ...penOpt, width: Number(ev.target.value) })} className="w-1/2 accent-primary-500" />
                </label>
              </div>
            )}
            {tool === "rect" && (
              <div className="space-y-2">
                <p className="text-xs font-bold text-ink">Rectangle</p>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-500">
                  Border
                  <input type="color" value={rectOpt.stroke} onChange={(ev) => setRectOpt({ stroke: ev.target.value })} className="h-7 w-8 cursor-pointer rounded border border-brand-200 dark:border-[#3A3D45]" />
                </label>
              </div>
            )}
            {tool === "crop" && (
              <div className="space-y-2">
                <p className="text-xs font-bold text-ink">Crop</p>
                <p className="text-[11px] text-brand-400">Drag a rectangle on the page; the crop will be applied to this page on Save. One crop per page.</p>
                {pageOps.crop && (
                  <button className="btn-ghost h-8 text-xs" onClick={() => setOps((o) => ({ ...o, [page]: { ...(o[page] ?? {}), crop: undefined } }))}>
                    Clear crop
                  </button>
                )}
              </div>
            )}
            {tool === "select" && (
              <p className="text-xs text-brand-400">Pick a tool on the left to start editing. Double-click any highlight / rectangle to delete it.</p>
            )}

            <button onClick={save} disabled={saving} className="btn-primary w-full">
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              Save &amp; download
            </button>
            <button onClick={reset} className="btn-ghost w-full">
              Start over
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
