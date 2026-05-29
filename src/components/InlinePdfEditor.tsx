import { useEffect, useRef, useState } from "react";
import {
  MousePointer2,
  Type as TypeIcon,
  Highlighter,
  Pen,
  Square,
  Crop,
  RotateCw,
  Trash2,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import { useUI } from "../lib/ui";
import { cn } from "../lib/format";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/* Inline PDF editor — same engine as PdfEditorModal but laid out as a
 * horizontal toolbar above the live preview, editing the page in place.
 * Coordinates are stored in display pixels relative to the stage and
 * converted to PDF points at save time using the measured stage width. */

const RENDER_W = 1100;

type Tool = "select" | "text" | "highlight" | "pen" | "rect" | "crop";
type Family = "Sans" | "Serif" | "Mono";

interface TextEdit {
  id: string; page: number; kind: "text";
  x: number; y: number; text: string;
  family: Family; size: number; color: string; weight: number; italic: boolean;
}
interface HighlightEdit {
  id: string; page: number; kind: "highlight";
  x: number; y: number; w: number; h: number; color: string;
}
interface RectEdit {
  id: string; page: number; kind: "rect";
  x: number; y: number; w: number; h: number; stroke: string;
}
interface InkEdit {
  id: string; page: number; kind: "ink";
  pts: { x: number; y: number }[]; color: string; width: number;
}
type Edit = TextEdit | HighlightEdit | RectEdit | InkEdit;
interface PageOp {
  rotate?: number;
  deleted?: boolean;
  crop?: { x: number; y: number; w: number; h: number };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  const f = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
  const n = parseInt(f, 16);
  return Number.isNaN(n)
    ? { r: 0, g: 0, b: 0 }
    : { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}
const uid = () => Math.random().toString(36).slice(2, 9);

export default function InlinePdfEditor({
  file,
  onApply,
}: {
  file: File;
  /** Called with the baked PDF when the user applies edits. */
  onApply: (file: File) => void;
}) {
  const { toast, prompt } = useUI();
  // toast is recreated on every UIProvider render, so it must NOT sit in the
  // render effect's deps — doing so turned a single error toast into an
  // infinite loop. Read it through a ref instead.
  const toastRef = useRef(toast);
  toastRef.current = toast;
  // Password for encrypted PDFs, persisted across page changes so we only
  // prompt once. Reset when the file changes.
  const pwdRef = useRef<string | undefined>(undefined);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(0);
  const [pageImg, setPageImg] = useState("");
  const [ptSize, setPtSize] = useState<Record<number, { w: number; h: number }>>({});
  const [tool, setTool] = useState<Tool>("select");
  const [edits, setEdits] = useState<Edit[]>([]);
  const [ops, setOps] = useState<Record<number, PageOp>>({});
  const [saving, setSaving] = useState(false);

  const [textOpt, setTextOpt] = useState({
    family: "Sans" as Family, size: 16, color: "#0a0a0a", weight: 400, italic: false,
  });
  const [penOpt, setPenOpt] = useState({ color: "#FFD600", width: 3 });
  const [rectOpt, setRectOpt] = useState({ stroke: "#0a0a0a" });
  const [hiOpt, setHiOpt] = useState({ color: "#FFE066" });

  const dragRef = useRef<{
    kind: "ink" | "highlight" | "rect" | "crop";
    start: { x: number; y: number };
    cur: { x: number; y: number };
    inkPts?: { x: number; y: number }[];
  } | null>(null);
  const [, force] = useState(0);
  const reflect = () => force((n) => n + 1);

  // Forget any cached password when a new file is loaded.
  useEffect(() => {
    pwdRef.current = undefined;
  }, [file]);

  // Render the chosen page on file/page change. Encrypted PDFs are handled by
  // prompting for a password (via pdfjs onPassword) rather than erroring.
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        const task = pdfjs.getDocument({ data, password: pwdRef.current });
        task.onPassword = (
          updatePassword: (pw: string) => void,
          reason: number
        ) => {
          // reason 2 = previous password was wrong, 1 = none supplied yet.
          prompt({
            title: reason === 2 ? "Incorrect password" : "Password required",
            label: "This PDF is encrypted. Enter its password to edit it.",
            placeholder: "Password",
          }).then((pw) => {
            if (dead) return;
            if (pw == null) {
              task.destroy();
              return;
            }
            pwdRef.current = pw;
            updatePassword(pw);
          });
        };
        const pdf = await task.promise;
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
        // A cancelled password prompt destroys the task — stay silent for that.
        const msg = e instanceof Error ? e.message : String(e);
        if (!/destroy|password/i.test(msg)) toastRef.current.error(msg);
      }
    })();
    return () => {
      dead = true;
    };
  }, [file, page, prompt]);

  const stage = useRef<HTMLDivElement>(null);
  const local = (e: React.PointerEvent) => {
    const r = stage.current?.getBoundingClientRect() ?? new DOMRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onDown = (e: React.PointerEvent) => {
    if (!pageImg || tool === "select") return;
    e.preventDefault();
    const p = local(e);
    if (tool === "text") {
      const id = uid();
      setEdits((arr) => [
        ...arr,
        { id, page, kind: "text", x: p.x, y: p.y, text: "Type here…", ...textOpt },
      ]);
      setTool("select");
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
      dragRef.current = { kind: "ink", start: p, cur: p, inkPts: [p] };
      reflect();
      return;
    }
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
          setEdits((arr) => [...arr, { id: uid(), page, kind: "highlight", x, y, w, h, color: hiOpt.color }]);
        else if (d.kind === "rect")
          setEdits((arr) => [...arr, { id: uid(), page, kind: "rect", x, y, w, h, stroke: rectOpt.stroke }]);
        else setOps((o) => ({ ...o, [page]: { ...(o[page] ?? {}), crop: { x, y, w, h } } }));
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
  const rotatePage = (deg: number) =>
    setPageOp(page, { rotate: ((ops[page]?.rotate ?? 0) + deg + 360) % 360 });
  const deletePage = () => {
    if (pages <= 1) return toast.error("A PDF must have at least one page.");
    setPageOp(page, { deleted: true });
    setPage((p) => Math.min(p + 1, pages - 1));
  };
  const clearPageEdits = () => {
    setEdits((arr) => arr.filter((e) => e.page !== page));
    setOps((o) => ({ ...o, [page]: { ...(o[page] ?? {}), crop: undefined } }));
  };

  const dirty =
    edits.length > 0 ||
    Object.values(ops).some((o) => o.rotate || o.deleted || o.crop);

  const apply = async () => {
    setSaving(true);
    try {
      const dispW = stage.current?.clientWidth || RENDER_W;
      const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
      const fontCache: Partial<Record<string, Awaited<ReturnType<typeof doc.embedFont>>>> = {};
      const stdFont = async (family: Family, weight: number, italic: boolean) => {
        const map: Record<Family, { reg: StandardFonts; bold: StandardFonts; ita: StandardFonts; bita: StandardFonts }> = {
          Sans: { reg: StandardFonts.Helvetica, bold: StandardFonts.HelveticaBold, ita: StandardFonts.HelveticaOblique, bita: StandardFonts.HelveticaBoldOblique },
          Serif: { reg: StandardFonts.TimesRoman, bold: StandardFonts.TimesRomanBold, ita: StandardFonts.TimesRomanItalic, bita: StandardFonts.TimesRomanBoldItalic },
          Mono: { reg: StandardFonts.Courier, bold: StandardFonts.CourierBold, ita: StandardFonts.CourierOblique, bita: StandardFonts.CourierBoldOblique },
        };
        const m = map[family];
        const which = weight >= 600 ? (italic ? m.bita : m.bold) : italic ? m.ita : m.reg;
        const key = String(which);
        if (!fontCache[key]) fontCache[key] = await doc.embedFont(which);
        return fontCache[key]!;
      };

      const pageList = doc.getPages();
      for (let i = 0; i < pageList.length; i++) {
        if (ops[i]?.deleted) continue;
        const p = pageList[i];
        const wPt = p.getWidth();
        const hPt = p.getHeight();
        const s = wPt / dispW; // display px → pt

        const rot = ops[i]?.rotate;
        if (rot) p.setRotation(degrees((p.getRotation().angle + rot) % 360));

        for (const e of edits.filter((x) => x.page === i)) {
          if (e.kind === "highlight") {
            const c = hexToRgb(e.color);
            p.drawRectangle({ x: e.x * s, y: hPt - (e.y + e.h) * s, width: e.w * s, height: e.h * s, color: rgb(c.r, c.g, c.b), opacity: 0.4, borderWidth: 0 });
          } else if (e.kind === "rect") {
            const c = hexToRgb(e.stroke);
            p.drawRectangle({ x: e.x * s, y: hPt - (e.y + e.h) * s, width: e.w * s, height: e.h * s, borderColor: rgb(c.r, c.g, c.b), borderWidth: 1.5 });
          } else if (e.kind === "ink") {
            const c = hexToRgb(e.color);
            for (let k = 1; k < e.pts.length; k++) {
              const a = e.pts[k - 1];
              const b = e.pts[k];
              p.drawLine({ start: { x: a.x * s, y: hPt - a.y * s }, end: { x: b.x * s, y: hPt - b.y * s }, thickness: e.width * s, color: rgb(c.r, c.g, c.b) });
            }
          } else if (e.kind === "text") {
            const font = await stdFont(e.family, e.weight, e.italic);
            const c = hexToRgb(e.color);
            const sizePt = e.size * s;
            p.drawText(e.text, { x: e.x * s, y: hPt - e.y * s - sizePt, size: sizePt, color: rgb(c.r, c.g, c.b), font });
          }
        }

        const cr = ops[i]?.crop;
        if (cr) p.setCropBox(cr.x * s, hPt - (cr.y + cr.h) * s, cr.w * s, cr.h * s);
      }
      for (let i = pageList.length - 1; i >= 0; i--) if (ops[i]?.deleted) doc.removePage(i);

      const name = file.name.replace(/\.pdf$/i, "") + "-edited.pdf";
      const bytes = await doc.save();
      onApply(new File([new Uint8Array(bytes)], name, { type: "application/pdf" }));
      toast.success("Edits applied.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const cursor =
    tool === "select" ? "default" : tool === "text" ? "text" : "crosshair";
  const pageOps = ops[page] ?? {};
  const pageEdits = edits.filter((e) => e.page === page);
  const drag = dragRef.current;

  const Tbtn = ({ id, label, Icon }: { id: Tool; label: string; Icon: typeof TypeIcon }) => (
    <button
      onClick={() => setTool(id)}
      title={label}
      className={cn(
        "grid h-8 w-8 place-items-center rounded-lg cursor-pointer transition-colors",
        tool === id ? "bg-primary-400 text-[#0A0A0A]" : "text-brand-500 hover:bg-brand-50 dark:hover:bg-white/5"
      )}
    >
      <Icon size={15} />
    </button>
  );
  const color = (v: string, on: (s: string) => void) => (
    <input type="color" value={v} onChange={(e) => on(e.target.value)} className="h-7 w-7 cursor-pointer rounded border border-brand-200 dark:border-[#3A3D45]" />
  );

  return (
    <div>
      {/* ── Horizontal toolbar ─────────────────────────────────────────── */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-brand-200 bg-white px-2 py-1.5 dark:border-[#3A3D45] dark:bg-[#1E2025]">
        <Tbtn id="select" label="Select" Icon={MousePointer2} />
        <Tbtn id="text" label="Text" Icon={TypeIcon} />
        <Tbtn id="highlight" label="Highlight" Icon={Highlighter} />
        <Tbtn id="pen" label="Pen" Icon={Pen} />
        <Tbtn id="rect" label="Rectangle" Icon={Square} />
        <Tbtn id="crop" label="Crop" Icon={Crop} />

        {/* contextual options */}
        {tool !== "select" && (
          <span className="mx-1 h-5 w-px bg-brand-200 dark:bg-[#3A3D45]" />
        )}
        {tool === "text" && (
          <div className="flex items-center gap-1.5">
            <select className="select h-7 !py-0 text-xs" value={textOpt.family} onChange={(e) => setTextOpt({ ...textOpt, family: e.target.value as Family })}>
              <option>Sans</option><option>Serif</option><option>Mono</option>
            </select>
            <select className="select h-7 !py-0 text-xs" value={textOpt.weight} onChange={(e) => setTextOpt({ ...textOpt, weight: Number(e.target.value) })}>
              <option value={400}>Normal</option><option value={700}>Bold</option>
            </select>
            <input type="range" min={8} max={64} value={textOpt.size} onChange={(e) => setTextOpt({ ...textOpt, size: Number(e.target.value) })} className="w-20 accent-primary-500" title={`${textOpt.size}px`} />
            {color(textOpt.color, (c) => setTextOpt({ ...textOpt, color: c }))}
          </div>
        )}
        {tool === "highlight" && color(hiOpt.color, (c) => setHiOpt({ color: c }))}
        {tool === "pen" && (
          <div className="flex items-center gap-1.5">
            {color(penOpt.color, (c) => setPenOpt({ ...penOpt, color: c }))}
            <input type="range" min={1} max={12} value={penOpt.width} onChange={(e) => setPenOpt({ ...penOpt, width: Number(e.target.value) })} className="w-20 accent-primary-500" title={`${penOpt.width}px`} />
          </div>
        )}
        {tool === "rect" && color(rectOpt.stroke, (c) => setRectOpt({ stroke: c }))}
        {tool === "crop" && pageOps.crop && (
          <button className="btn-ghost h-7 text-xs" onClick={() => setOps((o) => ({ ...o, [page]: { ...(o[page] ?? {}), crop: undefined } }))}>Clear crop</button>
        )}

        <span className="flex-1" />

        {/* page nav + page ops */}
        <button className="btn-ghost h-7 !px-1.5" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page <= 0}><ChevronLeft size={14} /></button>
        <span className="whitespace-nowrap text-xs font-semibold text-brand-500">{page + 1}/{pages || "…"}{pageOps.deleted ? " ✕" : ""}</span>
        <button className="btn-ghost h-7 !px-1.5" onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}><ChevronRight size={14} /></button>
        <button className="btn-ghost h-7 !px-1.5" title="Rotate left" onClick={() => rotatePage(-90)}><RotateCw size={13} className="-scale-x-100" /></button>
        <button className="btn-ghost h-7 !px-1.5" title="Rotate right" onClick={() => rotatePage(90)}><RotateCw size={13} /></button>
        <button className="btn-ghost h-7 !px-1.5" title="Delete page" onClick={deletePage}><Trash2 size={13} /></button>
        <button className="btn-ghost h-7 text-xs" onClick={clearPageEdits}>Clear</button>
        <button onClick={apply} disabled={saving || !dirty} className="btn-primary h-7 text-xs">
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Apply
        </button>
      </div>

      {/* ── Interactive stage ──────────────────────────────────────────── */}
      <div
        ref={stage}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
        className="relative mx-auto w-full max-w-3xl overflow-hidden rounded-xl border border-brand-200 bg-white dark:border-[#3A3D45]"
        style={{
          aspectRatio: ptSize[page] ? `${ptSize[page].w} / ${ptSize[page].h}` : undefined,
          cursor,
          touchAction: "none",
        }}
      >
        {pageImg ? (
          <img src={pageImg} alt={`page ${page + 1}`} className="block h-full w-full select-none" draggable={false} />
        ) : (
          <div className="grid h-full place-items-center text-sm text-brand-400"><Loader2 size={20} className="animate-spin" /></div>
        )}

        {pageEdits.map((e) => {
          if (e.kind === "highlight")
            return <div key={e.id} onDoubleClick={() => removeEdit(e.id)} style={{ left: e.x, top: e.y, width: e.w, height: e.h, background: e.color, opacity: 0.45 }} className="absolute" title="Double-click to delete" />;
          if (e.kind === "rect")
            return <div key={e.id} onDoubleClick={() => removeEdit(e.id)} style={{ left: e.x, top: e.y, width: e.w, height: e.h, border: `1.5px solid ${e.stroke}` }} className="absolute" title="Double-click to delete" />;
          if (e.kind === "ink")
            return (
              <svg key={e.id} className="pointer-events-none absolute inset-0 h-full w-full">
                <polyline fill="none" stroke={e.color} strokeWidth={e.width} strokeLinecap="round" strokeLinejoin="round" points={e.pts.map((p) => `${p.x},${p.y}`).join(" ")} />
              </svg>
            );
          return (
            <div
              key={e.id}
              data-edit={e.id}
              contentEditable
              suppressContentEditableWarning
              onBlur={(ev) => updateText(e.id, ev.currentTarget.textContent ?? "")}
              onDoubleClick={(ev) => ev.stopPropagation()}
              onKeyDown={(ev) => {
                if (ev.key === "Delete" && ev.ctrlKey) {
                  ev.preventDefault();
                  removeEdit(e.id);
                }
              }}
              style={{
                left: e.x,
                top: e.y,
                fontFamily: e.family === "Sans" ? "'Plus Jakarta Sans', sans-serif" : e.family === "Serif" ? "'Lora', serif" : "'IBM Plex Mono', monospace",
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
            <polyline fill="none" stroke={penOpt.color} strokeWidth={penOpt.width} strokeLinecap="round" strokeLinejoin="round" points={drag.inkPts.map((p) => `${p.x},${p.y}`).join(" ")} />
          </svg>
        )}
        {pageOps.crop && (
          <div style={{ left: pageOps.crop.x, top: pageOps.crop.y, width: pageOps.crop.w, height: pageOps.crop.h }} className="pointer-events-none absolute border-2 border-dashed border-primary-500" />
        )}
      </div>
      <p className="mt-2 text-center text-[11px] text-brand-400">
        Pick a tool, edit directly on the page, then <strong>Apply</strong>. Double-click a highlight/box to remove it.
      </p>
    </div>
  );
}
