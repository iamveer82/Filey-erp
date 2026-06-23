import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, X, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { fileBytes, type SavedFile } from "../lib/files";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/* Renders every page of a PDF to canvases with pdf.js (not WebView2's native
 * viewer). Bytes come from fileBytes (download → arrayBuffer), avoiding a
 * fetch(blobURL) the webview CSP blocks. zoom=1 fits the whole page to the
 * panel; +/- re-render crisply at the new scale. */
export default function PdfCanvas({ file }: { file: SavedFile }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [zoom, setZoom] = useState(1);

  // Load the document once per file.
  useEffect(() => {
    let dead = false;
    setLoading(true);
    setErr("");
    setPdf(null);
    setZoom(1);
    (async () => {
      try {
        const bytes = await fileBytes(file);
        if (dead) return;
        if (!bytes) {
          setErr("File not found.");
          setLoading(false);
          return;
        }
        const doc = await pdfjs.getDocument({ data: bytes }).promise;
        if (dead) return;
        setPdf(doc);
      } catch (e) {
        if (!dead) {
          setErr(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      dead = true;
    };
  }, [file.id]);

  // (Re)render the pages whenever the document or zoom changes.
  useEffect(() => {
    if (!pdf) return;
    let dead = false;
    (async () => {
      const host = pagesRef.current;
      const wrap = wrapRef.current;
      if (!host || !wrap) return;
      const dpr = window.devicePixelRatio || 1;
      // Fit the whole first page to the panel at zoom 1; scale by zoom from there.
      const maxW = wrap.clientWidth - 32;
      const maxH = wrap.clientHeight - 32;
      const canvases: HTMLCanvasElement[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        if (dead) return;
        const page = await pdf.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const fit = Math.min(maxW / base.width, maxH / base.height);
        const scale = fit * zoom;
        const vp = page.getViewport({ scale: scale * dpr });
        const canvas = document.createElement("canvas");
        canvas.width = vp.width;
        canvas.height = vp.height;
        canvas.style.width = `${base.width * scale}px`;
        canvas.style.height = `${base.height * scale}px`;
        canvas.className = "mx-auto mb-4 rounded-lg bg-white shadow-bento";
        const ctx = canvas.getContext("2d");
        if (ctx) await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
        if (dead) return;
        canvases.push(canvas);
      }
      if (dead) return;
      host.replaceChildren(...canvases);
      setLoading(false);
    })();
    return () => {
      dead = true;
    };
  }, [pdf, zoom]);

  const zoomBy = useCallback((d: number) => setZoom((z) => clampZoom(z + d)), []);

  // Ctrl/Cmd + wheel to zoom, like a normal viewer.
  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 0.15 : -0.15);
  };

  return (
    <div className="relative h-full w-full">
      <div ref={wrapRef} onWheel={onWheel} className="h-full w-full overflow-auto p-4">
        {err ? (
          <div className="grid h-full place-items-center text-center">
            <div>
              <X size={24} className="mx-auto mb-2 text-danger" />
              <p className="text-sm font-medium text-ink">Could not render this PDF</p>
              <p className="mt-1 text-xs text-brand-500">{err}</p>
            </div>
          </div>
        ) : (
          <>
            {loading && (
              <div className="grid h-full place-items-center">
                <Loader2 size={22} className="animate-spin text-brand-400" />
              </div>
            )}
            <div ref={pagesRef} />
          </>
        )}
      </div>

      {!err && (
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-brand-200 bg-white/95 px-1.5 py-1 shadow-bento-hover backdrop-blur dark:border-[#2C2C2E] dark:bg-[#1C1C1E]/95">
          <button
            onClick={() => zoomBy(-0.25)}
            disabled={zoom <= MIN_ZOOM}
            aria-label="Zoom out"
            className="grid h-8 w-8 place-items-center rounded-full text-brand-500 hover:bg-brand-50 disabled:opacity-40 dark:hover:bg-white/10"
          >
            <ZoomOut size={16} />
          </button>
          <button
            onClick={() => setZoom(1)}
            aria-label="Reset zoom"
            title="Fit to page"
            className="min-w-[3.25rem] rounded-full px-2 text-xs font-medium tabular-nums text-ink hover:bg-brand-50 dark:hover:bg-white/10"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            onClick={() => zoomBy(0.25)}
            disabled={zoom >= MAX_ZOOM}
            aria-label="Zoom in"
            className="grid h-8 w-8 place-items-center rounded-full text-brand-500 hover:bg-brand-50 disabled:opacity-40 dark:hover:bg-white/10"
          >
            <ZoomIn size={16} />
          </button>
          <button
            onClick={() => setZoom(1)}
            aria-label="Fit to page"
            className="grid h-8 w-8 place-items-center rounded-full text-brand-500 hover:bg-brand-50 dark:hover:bg-white/10"
          >
            <Maximize2 size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
