import { useEffect, useRef, useState } from "react";
import {
  Upload,
  Pen,
  Type as TypeIcon,
  Image as ImageIcon,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Save,
  Loader2,
} from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Modal } from "./ui";
import { useUI } from "../lib/ui";
import { signPdfAt, downloadFile } from "../lib/pdfTools";
import { cn } from "../lib/format";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/* Web e-sign tool — draw / type / upload a signature, pick a page, click on
 * the page preview to place it, save. 100% in-browser via pdfjs + pdf-lib. */

const PREVIEW_W = 720;
type Mode = "draw" | "type" | "upload";

export default function EsignModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useUI();
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageImg, setPageImg] = useState("");
  const [pagePt, setPagePt] = useState({ w: 0, h: 0 });

  const [mode, setMode] = useState<Mode>("draw");
  const [typed, setTyped] = useState("");
  const [sigUrl, setSigUrl] = useState("");

  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [widthPt, setWidthPt] = useState(160);
  const [saving, setSaving] = useState(false);

  const drawRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  const reset = () => {
    setFile(null);
    setPageCount(0);
    setPageIndex(0);
    setPageImg("");
    setPagePt({ w: 0, h: 0 });
    setMode("draw");
    setTyped("");
    setSigUrl("");
    setPos(null);
    setWidthPt(160);
    setSaving(false);
  };

  // Render the chosen page on file/pageIndex change.
  useEffect(() => {
    if (!file) return;
    let dead = false;
    (async () => {
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        const pdf = await pdfjs.getDocument({ data }).promise;
        if (dead) return;
        setPageCount(pdf.numPages);
        const idx = Math.min(Math.max(0, pageIndex), pdf.numPages - 1);
        const page = await pdf.getPage(idx + 1);
        const pt = page.getViewport({ scale: 1 });
        if (dead) return;
        setPagePt({ w: pt.width, h: pt.height });
        const scale = PREVIEW_W / pt.width;
        const vp = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = vp.width;
        canvas.height = vp.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
        if (dead) return;
        setPageImg(canvas.toDataURL("image/png"));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      dead = true;
    };
  }, [file, pageIndex, toast]);

  // Drawing pad
  const padCtx = () => drawRef.current?.getContext("2d") ?? null;
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = drawRef.current;
    const ctx = padCtx();
    if (!c || !ctx) return;
    const r = c.getBoundingClientRect();
    const x = ((e.clientX - r.left) * c.width) / r.width;
    const y = ((e.clientY - r.top) * c.height) / r.height;
    drawing.current = true;
    last.current = { x, y };
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0A0A0A";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.1, y + 0.1);
    ctx.stroke();
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const c = drawRef.current;
    const ctx = padCtx();
    if (!c || !ctx) return;
    const r = c.getBoundingClientRect();
    const x = ((e.clientX - r.left) * c.width) / r.width;
    const y = ((e.clientY - r.top) * c.height) / r.height;
    const p = last.current;
    if (p) {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    last.current = { x, y };
  };
  const onUp = () => {
    drawing.current = false;
    last.current = null;
    const c = drawRef.current;
    if (c) setSigUrl(c.toDataURL("image/png"));
  };
  const clearPad = () => {
    const c = drawRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    ctx?.clearRect(0, 0, c.width, c.height);
    setSigUrl("");
  };

  // Type → render to canvas
  useEffect(() => {
    if (mode !== "type") return;
    const txt = typed.trim();
    if (!txt) {
      setSigUrl("");
      return;
    }
    const canvas = document.createElement("canvas");
    const W = 600;
    const H = 180;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0A0A0A";
    ctx.font = `italic 96px "Brush Script MT", "Lucida Handwriting", cursive`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(txt, W / 2, H / 2);
    setSigUrl(canvas.toDataURL("image/png"));
  }, [mode, typed]);

  // Upload an image as signature
  const onUploadSig = (f?: File | null) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setSigUrl(String(reader.result || ""));
    reader.readAsDataURL(f);
  };

  // Click on the page preview → place the signature
  const onPlace = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!sigUrl) return;
    const r = e.currentTarget.getBoundingClientRect();
    setPos({
      x: (e.clientX - r.left) / r.width,
      y: (e.clientY - r.top) / r.height,
    });
  };

  const save = async () => {
    if (!file) return toast.error("Upload a PDF first.");
    if (!sigUrl) return toast.error("Draw, type or upload a signature.");
    if (!pos) return toast.error("Click on the page to place the signature.");
    setSaving(true);
    try {
      // Aspect from the sig image so we know its height in pt.
      const aspect = await new Promise<number>((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im.naturalHeight / im.naturalWidth);
        im.onerror = () => reject(new Error("Could not read signature."));
        im.src = sigUrl;
      });
      const sigHeightPt = widthPt * aspect;
      const xPt = pos.x * pagePt.w;
      const yTopPt = pos.y * pagePt.h;
      const yBottomPt = Math.max(0, pagePt.h - yTopPt - sigHeightPt);
      const out = await signPdfAt(
        file,
        sigUrl,
        pageIndex,
        xPt,
        yBottomPt,
        widthPt
      );
      downloadFile(out);
      toast.success("Signed PDF downloaded.");
      onClose();
      reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // Overlay dimensions (preview)
  const overlayStyle = () => {
    if (!pos) return undefined;
    const wPct = (widthPt / pagePt.w) * 100;
    return {
      left: `${pos.x * 100}%`,
      top: `${pos.y * 100}%`,
      width: `${wPct}%`,
    } as React.CSSProperties;
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        onClose();
        reset();
      }}
      title="E-sign PDF"
    >
      {!file ? (
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand-300 px-6 py-10 text-center transition-colors hover:bg-brand-50 dark:hover:bg-white/5">
          <Upload size={26} className="text-brand-400" />
          <span className="text-sm font-semibold text-ink">Upload a PDF to sign</span>
          <span className="text-xs text-brand-400">
            Everything runs locally on this device.
          </span>
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
      ) : (
        <div className="grid gap-4 md:grid-cols-[1fr_320px]">
          {/* Page preview */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-1">
                <button
                  className="btn-ghost h-8 !px-2"
                  onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
                  disabled={pageIndex <= 0}
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="text-xs font-semibold text-brand-500">
                  Page {pageIndex + 1} / {pageCount || "…"}
                </span>
                <button
                  className="btn-ghost h-8 !px-2"
                  onClick={() => setPageIndex((i) => Math.min(pageCount - 1, i + 1))}
                  disabled={pageIndex >= pageCount - 1}
                >
                  <ChevronRight size={14} />
                </button>
              </div>
              <span className="text-[11px] text-brand-400">
                Click on the page to place your signature
              </span>
            </div>

            <div
              onClick={onPlace}
              className={cn(
                "relative w-full overflow-hidden rounded-xl border border-brand-200 bg-white dark:border-[#3A3D45]",
                sigUrl ? "cursor-crosshair" : "cursor-default"
              )}
              style={{ aspectRatio: pagePt.w && pagePt.h ? `${pagePt.w} / ${pagePt.h}` : undefined }}
            >
              {pageImg ? (
                <img src={pageImg} alt="page" className="block h-full w-full select-none" draggable={false} />
              ) : (
                <div className="grid h-full place-items-center text-sm text-brand-400">
                  <Loader2 size={20} className="animate-spin" />
                </div>
              )}
              {pos && sigUrl && (
                <img
                  src={sigUrl}
                  alt="signature"
                  className="pointer-events-none absolute select-none"
                  style={overlayStyle()}
                  draggable={false}
                />
              )}
            </div>
          </div>

          {/* Signature builder */}
          <div className="space-y-3">
            <div className="flex gap-1 rounded-xl border border-brand-200 p-1 dark:border-[#3A3D45]">
              {(
                [
                  { id: "draw", label: "Draw", icon: Pen },
                  { id: "type", label: "Type", icon: TypeIcon },
                  { id: "upload", label: "Upload", icon: ImageIcon },
                ] as { id: Mode; label: string; icon: typeof Pen }[]
              ).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setMode(t.id)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold cursor-pointer",
                    mode === t.id
                      ? "bg-primary-400 text-[#0A0A0A]"
                      : "text-brand-500 hover:bg-brand-50 dark:hover:bg-white/5"
                  )}
                >
                  <t.icon size={13} /> {t.label}
                </button>
              ))}
            </div>

            {mode === "draw" && (
              <div>
                <canvas
                  ref={drawRef}
                  width={600}
                  height={180}
                  onPointerDown={onDown}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  onPointerLeave={onUp}
                  className="block w-full touch-none rounded-xl border border-dashed border-brand-300 bg-white dark:border-[#3A3D45]"
                  style={{ aspectRatio: "600 / 180" }}
                />
                <div className="mt-1.5 flex justify-end">
                  <button onClick={clearPad} className="btn-ghost h-8 text-xs">
                    <Trash2 size={13} /> Clear
                  </button>
                </div>
              </div>
            )}

            {mode === "type" && (
              <div>
                <input
                  className="input"
                  placeholder="Your name"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                />
                {sigUrl && (
                  <div className="mt-2 rounded-xl border border-brand-200 bg-white p-2 dark:border-[#3A3D45]">
                    <img src={sigUrl} alt="preview" className="mx-auto h-16" />
                  </div>
                )}
              </div>
            )}

            {mode === "upload" && (
              <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-brand-300 p-4 text-center hover:bg-brand-50 dark:hover:bg-white/5">
                <Upload size={18} className="text-brand-400" />
                <span className="text-xs font-semibold text-ink">Upload signature image</span>
                <span className="text-[11px] text-brand-400">PNG with transparent background works best</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => onUploadSig(e.target.files?.[0])}
                />
                {sigUrl && <img src={sigUrl} alt="preview" className="mt-2 h-14" />}
              </label>
            )}

            <div>
              <p className="label">Size · {Math.round(widthPt)}pt</p>
              <input
                type="range"
                min={60}
                max={320}
                step={10}
                value={widthPt}
                onChange={(e) => setWidthPt(Number(e.target.value))}
                className="w-full accent-primary-500"
              />
            </div>

            <button
              onClick={save}
              disabled={saving || !sigUrl || !pos}
              className="btn-primary w-full"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              Sign &amp; download
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
