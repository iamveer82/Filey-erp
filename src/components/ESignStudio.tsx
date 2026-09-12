import { useEffect, useRef, useState, useCallback } from "react";
import {
  Upload,
  Download,
  Trash2,
  X,
  PenLine,
  Eraser,
  Loader2,
  Check,
  FileText,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
} from "lucide-react";
import * as safePdf from "../lib/pdfjsSafe";
import { useUI } from "../lib/ui";
import { ensurePdf, placeStamp, downloadFile, type OutFile } from "../lib/pdfTools";
import { SelectMenu } from "./ui-menu";


type Mode = "draw-only" | "upload-both" | "upload-draw";

interface DocPage {
  img: string; // data URL
  width: number;
  height: number;
}

export default function ESignStudio({
  file: initialFile,
  onApply,
}: {
  file?: File;
  onApply?: (out: OutFile) => void;
}) {
  const { toast } = useUI();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);

  const [mode, setMode] = useState<Mode>("draw-only");
  const [docPages, setDocPages] = useState<DocPage[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [docFile, setDocFile] = useState<File | null>(initialFile ?? null);
  const [signImg, setSignImg] = useState<string>(""); // data URL of uploaded sign
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const loadRevision = useRef(0);

  // Drawing state
  const [drawColor, setDrawColor] = useState("#000000");
  const [drawWidth, setDrawWidth] = useState(4);
  const [drawTool, setDrawTool] = useState<"pen" | "eraser">("pen");
  const [hasDrawing, setHasDrawing] = useState(false);
  const [drawingRevision, setDrawingRevision] = useState(0);

  // Position of signature on document (percentages)
  const [signX, setSignX] = useState(50);
  const [signY, setSignY] = useState(70);
  const [signScale, setSignScale] = useState(40); // % of page width
  const [dragging, setDragging] = useState(false);

  // Load initial file if provided
  useEffect(() => {
    if (initialFile) {
      setDocFile(initialFile);
      loadDocument(initialFile);
      setMode("upload-draw");
    }
  }, [initialFile]);

  // Drawing canvas setup
  useEffect(() => {
    if (mode !== "draw-only" && mode !== "upload-draw") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (canvas.width !== 600 || canvas.height !== 200) {
      canvas.width = 600;
      canvas.height = 200;
      setHasDrawing(false);
    }
    ctx.globalCompositeOperation = drawTool === "eraser" ? "destination-out" : "source-over";
    ctx.strokeStyle = drawColor;
    ctx.lineWidth = drawTool === "eraser" ? drawWidth * 3 : drawWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, [mode, drawColor, drawWidth, drawTool]);

  const getCanvasPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ("touches" in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    isDrawing.current = true;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const pos = getCanvasPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const moveDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!isDrawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const pos = getCanvasPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    setHasDrawing(true);
  };

  const endDraw = () => {
    if (isDrawing.current) setDrawingRevision((revision) => revision + 1);
    isDrawing.current = false;
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawing(false);
    setDrawingRevision((revision) => revision + 1);
  };

  const getDrawnSign = (): string => {
    return canvasRef.current?.toDataURL("image/png") ?? "";
  };

  // Load document (PDF or image)
  const loadDocument = async (file: File) => {
    const revision = ++loadRevision.current;
    setLoading(true);
    setDocPages([]);
    setDone(false);
    try {
      const pages: DocPage[] = [];
      const normalized = await ensurePdf(file);
      if (revision !== loadRevision.current) return;
      {
        const data = new Uint8Array(await normalized.arrayBuffer());
        const pdf = await safePdf.getDocument({ data }).promise;
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const vp = page.getViewport({ scale: 1.5 });
          const c = document.createElement("canvas");
          c.width = vp.width;
          c.height = vp.height;
          const ctx = c.getContext("2d");
          if (!ctx) throw new Error("Canvas is unavailable. Reopen this tool and try again.");
          await page.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise;
          pages.push({
            img: c.toDataURL("image/png"),
            width: vp.width,
            height: vp.height,
          });
        }
      }
      if (revision !== loadRevision.current) return;
      setDocFile(normalized);
      setDocPages(pages);
      setCurrentPage(0);
    } catch (e) {
      if (revision === loadRevision.current)
        toast.error(e instanceof Error ? e.message : "Failed to load document.");
    } finally {
      if (revision === loadRevision.current) setLoading(false);
    }
  };

  const handleDocUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setDocFile(f);
    loadDocument(f);
  };

  const handleSignUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => setSignImg(String(r.result));
    r.readAsDataURL(f);
  };

  // Combine document + signature
  const applySign = useCallback(async () => {
    // For draw-only mode: just download the drawn signature
    if (mode === "draw-only") {
      if (!hasDrawing || saving) return;
      setSaving(true);
      try {
        const out: OutFile = { name: "signature.png", bytes: dataURLtoBytes(getDrawnSign()) };
        if (onApply) onApply(out);
        else if (await downloadFile(out)) toast.success("Signature downloaded.");
        setDone(true);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not save this signature.");
      } finally {
        setSaving(false);
      }
      return;
    }

    if (!docFile || docPages.length === 0 || saving) return;
    const page = docPages[currentPage];

    // For upload-both and upload-draw: stamp sign onto document
    const signSrc = mode === "upload-draw" ? getDrawnSign() : signImg;
    if (!signSrc) {
      toast.error("No signature to apply.");
      return;
    }

    setSaving(true);
    try {
      const sign = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Could not read this signature image."));
        image.src = signSrc;
      });
      const width = page.width * signScale / 100;
      const height = width * sign.naturalHeight / sign.naturalWidth;
      let signature = signSrc;
      if (!/^data:image\/(png|jpeg);/i.test(signature)) {
        const canvas = document.createElement("canvas");
        canvas.width = sign.naturalWidth;
        canvas.height = sign.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas is unavailable. Try a PNG signature.");
        context.drawImage(sign, 0, 0);
        signature = canvas.toDataURL("image/png");
      }
      const stamped = await placeStamp(docFile, signature, {
        xFrac: (signX - signScale / 2) / 100,
        yFrac: signY / 100 - height / (2 * page.height),
        wFrac: signScale / 100,
        opacity: 1,
        pageIndex: currentPage,
      });
      const out = { ...stamped, name: `${docFile.name.replace(/\.pdf$/i, "")}-signed.pdf` };
      if (onApply) onApply(out);
      else if (await downloadFile(out)) toast.success("Signed document downloaded.");
      setDone(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not sign this document.");
    } finally {
      setSaving(false);
    }
  }, [
    docPages,
    currentPage,
    mode,
    signImg,
    signX,
    signY,
    signScale,
    docFile,
    onApply,
    toast,
    saving,
    hasDrawing,
  ]);

  // Auto-applied preview canvas: show a live composite on previewRef
  useEffect(() => {
    if (mode === "draw-only" || docPages.length === 0) return;
    const canvas = previewRef.current;
    if (!canvas) return;
    const page = docPages[currentPage];
    canvas.width = page.width;
    canvas.height = page.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, page.width, page.height);
      const signSrc = mode === "upload-draw" ? getDrawnSign() : signImg;
      if (!signSrc) return;
      const sign = new Image();
      sign.onload = () => {
        const sw = (page.width * signScale) / 100;
        const sh = (sign.naturalHeight / sign.naturalWidth) * sw;
        const sx = (page.width * signX) / 100 - sw / 2;
        const sy = (page.height * signY) / 100 - sh / 2;
        // Draw highlight box
        ctx.strokeStyle = "#b8860b";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(sx, sy, sw, sh);
        ctx.setLineDash([]);
        // Draw the sign
        ctx.globalAlpha = 0.6;
        ctx.drawImage(sign, sx, sy, sw, sh);
        ctx.globalAlpha = 1;
      };
      sign.src = signSrc;
    };
    img.src = page.img;
  }, [docPages, currentPage, mode, signImg, signX, signY, signScale, drawingRevision]);

  // Drag handling on preview
  const handlePreviewMouseDown = (e: React.MouseEvent) => {
    if (mode === "draw-only") return;
    setDragging(true);
    updateSignPos(e);
  };

  const updateSignPos = (e: React.MouseEvent) => {
    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setSignX(Math.max(0, Math.min(100, x)));
    setSignY(Math.max(0, Math.min(100, y)));
  };

  const handlePreviewMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    updateSignPos(e);
  };

  const reset = () => {
    setDocPages([]);
    setDocFile(null);
    setSignImg("");
    setDone(false);
    setHasDrawing(false);
    clearCanvas();
    setMode("draw-only");
  };

  // Resize preview canvas to fit container
  useEffect(() => {
    if (mode === "draw-only" || docPages.length === 0) return;
    const canvas = previewRef.current;
    if (!canvas) return;
    const container = canvas.parentElement;
    if (!container) return;
    const maxW = container.clientWidth - 32;
    const page = docPages[currentPage];
    const scale = Math.min(1, maxW / page.width);
    canvas.style.width = `${page.width * scale}px`;
    canvas.style.height = `${page.height * scale}px`;
  }, [docPages, currentPage, mode]);

  const needsDoc = mode === "upload-both" || mode === "upload-draw";

  return (
    <div className="space-y-4">
      {/* Mode selector */}
      <div className="flex flex-wrap gap-2">
        {[
          { id: "draw-only" as Mode, label: "Make a Sign", desc: "Draw your signature" },
          {
            id: "upload-both" as Mode,
            label: "Use a signature image",
            desc: "Combine document & signature",
          },
          {
            id: "upload-draw" as Mode,
            label: "Draw on a document",
            desc: "Draw sign on document",
          },
        ].map((m) => (
          <button
            key={m.id}
            onClick={() => {
              reset();
              setMode(m.id);
            }}
            className={`flex-1 min-w-[140px] rounded-xl border p-3 text-left transition-colors cursor-pointer ${
              mode === m.id
                ? "border-foreground bg-muted"
                : "border-border hover:border-foreground/50 bg-card"
            }`}
          >
            <p className="text-sm font-medium text-ink">{m.label}</p>
            <p className="text-[11px] text-brand-400">{m.desc}</p>
          </button>
        ))}
      </div>

      {/* Mode: Draw Only */}
      {mode === "draw-only" && (
        <div className="card space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1 rounded-xl bg-brand-100 p-1">
              <button
                aria-label="Draw signature"
                aria-pressed={drawTool === "pen"}
                onClick={() => setDrawTool("pen")}
                className="btn-ghost h-10 w-10 p-0 aria-pressed:bg-primary-100 aria-pressed:border-primary-400"
              >
                <PenLine size={16} />
              </button>
              <button
                aria-label="Erase signature"
                aria-pressed={drawTool === "eraser"}
                onClick={() => setDrawTool("eraser")}
                className="btn-ghost h-10 w-10 p-0 aria-pressed:bg-primary-100 aria-pressed:border-primary-400"
              >
                <Eraser size={16} />
              </button>
            </div>
            <input
              type="color"
              aria-label="Signature colour"
              value={drawColor}
              onChange={(e) => setDrawColor(e.target.value)}
              className="h-10 w-10 rounded-full border border-border cursor-pointer p-1"
              disabled={drawTool === "eraser"}
            />
            <SelectMenu
              ariaLabel="Signature line width"
              className="w-auto"
              value={String(drawWidth)}
              onChange={(v) => setDrawWidth(Number(v))}
              options={[
                { value: "2", label: "Thin" },
                { value: "4", label: "Medium" },
                { value: "7", label: "Thick" },
                { value: "10", label: "Heavy" },
              ]}
            />
            <button onClick={clearCanvas} className="btn-ghost text-xs">
              <RotateCcw size={14} /> Clear
            </button>
          </div>
          <div className="rounded-xl border-2 border-dashed border-brand-200 bg-white overflow-hidden">
            <canvas
              ref={canvasRef}
              onMouseDown={startDraw}
              onMouseMove={moveDraw}
              onMouseUp={endDraw}
              onMouseLeave={endDraw}
              onTouchStart={startDraw}
              onTouchMove={moveDraw}
              onTouchEnd={endDraw}
              className="w-full cursor-crosshair touch-none"
              style={{ maxWidth: 600, height: 200 }}
            />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={applySign} disabled={!hasDrawing || saving} className="btn-primary">
              <Download size={14} /> Download signature
            </button>
            {done && (
              <span className="flex items-center gap-1 text-xs font-medium text-success">
                <Check size={14} /> Done
              </span>
            )}
          </div>
        </div>
      )}

      {/* Modes needing a document */}
      {needsDoc && (
        <div className="card space-y-3">
          {/* Document upload */}
          {!docPages.length ? (
            <label className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand-200 p-10 cursor-pointer hover:border-brand-400 transition-colors">
              <Upload size={32} className="text-brand-400" />
              <p className="text-sm font-medium text-brand-500">Upload Document</p>
              <p className="text-xs text-brand-400">PDF or image (PNG, JPG, WebP)</p>
              <input
                type="file"
                accept="application/pdf,image/*,.docx,.xls,.xlsx,.pptx,.rtf,.txt,.csv"
                className="hidden"
                onChange={handleDocUpload}
              />
            </label>
          ) : loading ? (
            <div className="flex items-center justify-center py-10 gap-2 text-brand-400">
              <Loader2 size={20} className="animate-spin" /> Loading document...
            </div>
          ) : (
            <>
              {/* Document preview with signature overlay */}
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-ink flex items-center gap-2">
                  <FileText size={16} /> {docFile?.name ?? "Document"}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                    disabled={currentPage === 0}
                    className="btn-ghost p-1"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="text-xs text-brand-500">
                    {currentPage + 1} / {docPages.length}
                  </span>
                  <button
                    onClick={() =>
                      setCurrentPage((p) => Math.min(docPages.length - 1, p + 1))
                    }
                    disabled={currentPage >= docPages.length - 1}
                    className="btn-ghost p-1"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>

              {/* Preview canvas */}
              <div className="rounded-xl border border-brand-200 overflow-auto bg-gray-100 p-4 flex justify-center">
                <canvas
                  ref={previewRef}
                  onMouseDown={handlePreviewMouseDown}
                  onMouseMove={handlePreviewMouseMove}
                  onMouseUp={() => setDragging(false)}
                  onMouseLeave={() => setDragging(false)}
                  className="cursor-crosshair rounded"
                  style={{ maxWidth: "100%" }}
                />
              </div>

              <p className="text-[10px] text-brand-400 text-center">
                Click & drag on the document to position your signature
              </p>

              {/* Signature scale slider */}
              <label className="flex items-center gap-2 text-xs text-brand-500">
                Size
                <input
                  type="range"
                  min={10}
                  max={80}
                  value={signScale}
                  onChange={(e) => setSignScale(Number(e.target.value))}
                  className="flex-1 h-1 accent-brand-500 cursor-pointer"
                />
                <span className="font-mono text-brand-500 w-8 text-right">
                  {signScale}%
                </span>
              </label>

              {/* Signature source */}
              {mode === "upload-both" ? (
                <div>
                  {signImg ? (
                    <div className="flex items-center gap-2">
                      <img
                        src={signImg}
                        alt="Signature"
                        className="h-12 object-contain border rounded bg-white"
                      />
                      <button
                        onClick={() => {
                          setSignImg("");
                        }}
                        className="btn-ghost text-xs text-danger"
                      >
                        <X size={12} /> Remove
                      </button>
                    </div>
                  ) : (
                    <label className="btn-ghost cursor-pointer text-xs">
                      <Upload size={14} /> Upload Signature Image
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/bmp,image/gif,image/svg+xml"
                        className="hidden"
                        onChange={handleSignUpload}
                      />
                    </label>
                  )}
                </div>
              ) : (
                /* upload-draw: drawing canvas */
                <div className="space-y-2">
                  <p className="text-xs font-medium text-brand-500">
                    Draw your signature
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-1 rounded-xl bg-brand-100 p-1">
                      <button
                        aria-label="Draw signature"
                aria-pressed={drawTool === "pen"}
                onClick={() => setDrawTool("pen")}
                        className="btn-ghost h-10 w-10 p-0 aria-pressed:bg-primary-100 aria-pressed:border-primary-400"
                      >
                        <PenLine size={14} />
                      </button>
                      <button
                        aria-label="Erase signature"
                aria-pressed={drawTool === "eraser"}
                onClick={() => setDrawTool("eraser")}
                        className="btn-ghost h-10 w-10 p-0 aria-pressed:bg-primary-100 aria-pressed:border-primary-400"
                      >
                        <Eraser size={14} />
                      </button>
                    </div>
                    <input
                      type="color"
              aria-label="Signature colour"
                      value={drawColor}
                      onChange={(e) => setDrawColor(e.target.value)}
                      className="h-10 w-10 rounded-full border border-border cursor-pointer p-1"
                    />
                    <SelectMenu
                      ariaLabel="Signature line width"
                      className="w-auto"
                      value={String(drawWidth)}
                      onChange={(v) => setDrawWidth(Number(v))}
                      options={[
                        { value: "2", label: "Thin" },
                        { value: "4", label: "Medium" },
                        { value: "7", label: "Thick" },
                      ]}
                    />
                    <button onClick={clearCanvas} className="btn-ghost text-xs">
                      <RotateCcw size={14} /> Clear
                    </button>
                  </div>
                  <div className="rounded-xl border-2 border-dashed border-brand-200 bg-white overflow-hidden">
                    <canvas
                      ref={canvasRef}
                      onMouseDown={startDraw}
                      onMouseMove={moveDraw}
                      onMouseUp={endDraw}
                      onMouseLeave={endDraw}
                      onTouchStart={startDraw}
                      onTouchMove={moveDraw}
                      onTouchEnd={endDraw}
                      className="w-full cursor-crosshair touch-none"
                      style={{ maxWidth: 600, height: 150 }}
                    />
                  </div>
                </div>
              )}

              {/* Apply button */}
              <div className="flex items-center gap-2">
                <button
                  onClick={applySign}
                  disabled={
                    saving || loading ||
                    (mode === "upload-both" && !signImg) ||
                    (mode === "upload-draw" && !hasDrawing)
                  }
                  className="btn-primary"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  {saving ? "Signing…" : "Download signed PDF"}
                </button>
                {done && (
                  <span className="flex items-center gap-1 text-xs font-medium text-success">
                    <Check size={14} /> Done
                  </span>
                )}
              </div>

              {/* New document button */}
              <button onClick={reset} className="btn-ghost text-xs w-full">
                <Trash2 size={14} /> Start over with new document
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function dataURLtoBytes(dataURL: string): Uint8Array {
  const [, data] = dataURL.split(",");
  const bytes = atob(data);
  const buf = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
  return buf;
}
