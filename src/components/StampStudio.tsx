import { useEffect, useRef, useState } from "react";
import {
  Upload,
  Loader2,
  Check,
  ChevronLeft,
  ChevronRight,
  Stamp,
  Trash2,
} from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { placeStamp, type OutFile } from "../lib/pdfTools";
import { useUI } from "../lib/ui";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/* Interactive stamp / signature placer. Renders the page, lets the user drop
 * a stamp of any raster format (normalised to PNG so transparency survives),
 * drag and resize it live, set its opacity, then bake it onto one page or all
 * pages. Positions are kept as page fractions so they map cleanly to PDF
 * points regardless of the on-screen render size. */

const RENDER_W = 1100;
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, lo), hi);

interface StampImg {
  src: string; // PNG data URL
  ratio: number; // natural height / width
}

export default function StampStudio({
  file,
  onApply,
}: {
  file: File;
  onApply: (out: OutFile) => void;
}) {
  const { toast } = useUI();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const pwdRef = useRef<string | undefined>(undefined);

  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(0);
  const [pageImg, setPageImg] = useState("");
  const [aspect, setAspect] = useState<{ w: number; h: number } | null>(null);

  const [stamp, setStamp] = useState<StampImg | null>(null);
  const [pos, setPos] = useState({ x: 0.4, y: 0.4 }); // top-left fractions
  const [wFrac, setWFrac] = useState(0.25);
  const [opacity, setOpacity] = useState(1);
  const [allPages, setAllPages] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    pwdRef.current = undefined;
  }, [file]);

  // Render the chosen page (handles encrypted PDFs via a password prompt).
  const { prompt } = useUI();
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
          prompt({
            title: reason === 2 ? "Incorrect password" : "Password required",
            label: "This PDF is encrypted. Enter its password to stamp it.",
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
        setAspect({ w: pt.width, h: pt.height });
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
        const msg = e instanceof Error ? e.message : String(e);
        if (!/destroy|password/i.test(msg)) toastRef.current.error(msg);
      }
    })();
    return () => {
      dead = true;
    };
  }, [file, page, prompt]);

  // Normalise any uploaded image to a PNG data URL (keeps transparency).
  const pickStamp = (f: File | undefined) => {
    if (!f) return;
    const url = URL.createObjectURL(f);
    const im = new Image();
    im.onload = () => {
      const nw = im.naturalWidth || 300;
      const nh = im.naturalHeight || 150;
      const c = document.createElement("canvas");
      c.width = nw;
      c.height = nh;
      const ctx = c.getContext("2d");
      ctx?.drawImage(im, 0, 0, nw, nh);
      setStamp({ src: c.toDataURL("image/png"), ratio: nh / nw });
      setPos({ x: 0.4, y: 0.4 });
      setWFrac(0.25);
      URL.revokeObjectURL(url);
    };
    im.onerror = () => {
      URL.revokeObjectURL(url);
      toastRef.current.error("Could not read that image.");
    };
    im.src = url;
  };

  // ── Drag / resize ─────────────────────────────────────────────────────────
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    mode: "move" | "resize";
    sx: number;
    sy: number;
    ox: number;
    oy: number;
    ow: number;
  } | null>(null);

  const startMove = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    stageRef.current?.setPointerCapture(e.pointerId);
    dragRef.current = { mode: "move", sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y, ow: wFrac };
  };
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    stageRef.current?.setPointerCapture(e.pointerId);
    dragRef.current = { mode: "resize", sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y, ow: wFrac };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    const r = stageRef.current?.getBoundingClientRect();
    if (!d || !r || !stamp) return;
    const dxFrac = (e.clientX - d.sx) / r.width;
    const dyFrac = (e.clientY - d.sy) / r.height;
    if (d.mode === "move") {
      const hFrac = wFrac * stamp.ratio * (r.width / r.height);
      setPos({ x: clamp(d.ox + dxFrac, 0, 1 - wFrac), y: clamp(d.oy + dyFrac, 0, Math.max(0, 1 - hFrac)) });
    } else {
      setWFrac(clamp(d.ow + dxFrac, 0.05, 1 - pos.x));
    }
  };
  const endMove = () => {
    dragRef.current = null;
  };

  const apply = async () => {
    if (!stamp) {
      toastRef.current.error("Upload a stamp first.");
      return;
    }
    setSaving(true);
    try {
      const out = await placeStamp(file, stamp.src, {
        xFrac: pos.x,
        yFrac: pos.y,
        wFrac,
        opacity,
        pageIndex: allPages ? undefined : page,
      });
      onApply(out);
      toastRef.current.success(
        allPages ? "Stamp applied to all pages." : `Stamp applied to page ${page + 1}.`
      );
    } catch (e) {
      toastRef.current.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {/* ── Toolbar ───────────────────────────────────────────────────────── */}
      <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-white px-2 py-1.5 dark:border-[#3A3D45] dark:bg-[#1E2025]">
        <label className="btn-ghost h-8 cursor-pointer text-xs">
          <Upload size={13} /> {stamp ? "Change stamp" : "Upload stamp"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml"
            className="hidden"
            onChange={(e) => {
              pickStamp(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        {stamp && (
          <button className="btn-ghost h-8 text-xs" onClick={() => setStamp(null)} title="Remove stamp">
            <Trash2 size={13} /> Remove
          </button>
        )}

        <span className="mx-1 h-5 w-px bg-brand-200 dark:bg-[#3A3D45]" />

        <span className="text-xs font-semibold text-brand-500">Opacity</span>
        <input
          type="range"
          min={0.05}
          max={1}
          step={0.05}
          value={opacity}
          onChange={(e) => setOpacity(Number(e.target.value))}
          className="w-24 accent-primary-500"
          title={`${Math.round(opacity * 100)}%`}
        />
        <span className="w-9 text-right text-xs tabular-nums text-brand-500">
          {Math.round(opacity * 100)}%
        </span>

        <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-brand-500">
          <input
            type="checkbox"
            checked={allPages}
            onChange={(e) => setAllPages(e.target.checked)}
            className="accent-primary-500"
          />
          All pages
        </label>

        <span className="flex-1" />

        <button className="btn-ghost h-7 !px-1.5" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page <= 0}>
          <ChevronLeft size={14} />
        </button>
        <span className="whitespace-nowrap text-xs font-semibold text-brand-500">
          {page + 1}/{pages || "…"}
        </span>
        <button
          className="btn-ghost h-7 !px-1.5"
          onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
          disabled={page >= pages - 1}
        >
          <ChevronRight size={14} />
        </button>
        <button onClick={apply} disabled={saving || !stamp} className="btn-primary h-7 text-xs">
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Apply
        </button>
      </div>

      {/* ── Stage ─────────────────────────────────────────────────────────── */}
      <div
        ref={stageRef}
        onPointerMove={onMove}
        onPointerUp={endMove}
        className="relative mx-auto w-full max-w-3xl overflow-hidden rounded-xl border border-brand-200 bg-white dark:border-[#3A3D45]"
        style={{
          aspectRatio: aspect ? `${aspect.w} / ${aspect.h}` : undefined,
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

        {stamp && (
          <div
            onPointerDown={startMove}
            style={{
              left: `${pos.x * 100}%`,
              top: `${pos.y * 100}%`,
              width: `${wFrac * 100}%`,
              opacity,
            }}
            className="absolute cursor-move ring-1 ring-primary-500/70 ring-offset-1"
          >
            <img src={stamp.src} alt="stamp" className="block w-full select-none" draggable={false} />
            <span
              onPointerDown={startResize}
              className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-full border-2 border-white bg-primary-500 shadow"
              title="Drag to resize"
            />
          </div>
        )}
      </div>

      <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-[11px] text-brand-400">
        <Stamp size={12} /> Upload a stamp, drag to place and resize, then <strong>Apply</strong>.
        Toggle “All pages” to stamp the whole document.
      </p>
    </div>
  );
}
