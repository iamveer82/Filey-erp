import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { fileBytes, type SavedFile } from "../lib/files";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/* Renders every page of a PDF to canvases, full page fitted to the panel and
 * stacked vertically. Used for the My Files preview instead of an <iframe>,
 * which relied on WebView2's native PDF viewer (inconsistent, ignored
 * view=Fit). Reads bytes via fileBytes (download → arrayBuffer) rather than
 * fetch(blobURL), which the webview CSP blocks on connect-src. */
export default function PdfCanvas({ file }: { file: SavedFile }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let dead = false;
    setLoading(true);
    setErr("");

    (async () => {
      try {
        const bytes = await fileBytes(file);
        if (dead) return;
        if (!bytes) {
          setErr("File not found.");
          setLoading(false);
          return;
        }
        const pdf = await pdfjs.getDocument({ data: bytes }).promise;
        const host = pagesRef.current;
        const wrap = wrapRef.current;
        if (!host || !wrap || dead) return;
        host.replaceChildren();

        const dpr = window.devicePixelRatio || 1;
        // Fit each WHOLE page inside the panel (width AND height) so a single
        // page is fully visible with no scroll; multipage docs scroll one full
        // page at a time.
        const maxW = wrap.clientWidth - 32;
        const maxH = wrap.clientHeight - 32;

        for (let i = 1; i <= pdf.numPages; i++) {
          if (dead) return;
          const page = await pdf.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const scale = Math.min(maxW / base.width, maxH / base.height);
          const vp = page.getViewport({ scale: scale * dpr });

          const canvas = document.createElement("canvas");
          canvas.width = vp.width;
          canvas.height = vp.height;
          canvas.style.width = `${base.width * scale}px`;
          canvas.style.height = `${base.height * scale}px`;
          canvas.className =
            "mx-auto mb-4 max-w-full rounded-lg bg-white shadow-bento";
          const ctx = canvas.getContext("2d");
          if (ctx) await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
          if (dead) return;
          host.appendChild(canvas);
        }
        setLoading(false);
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

  return (
    <div ref={wrapRef} className="h-full w-full overflow-auto p-4">
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
  );
}
