import { useEffect, useState } from "react";

// A document can appear in the editor, export sheet and template browser at
// once. Share a bounded raster cache, without saving or uploading the PDF.
const renderedPdfs = new Map<string, Promise<string>>();
function pdfBackground(data: string): Promise<string> {
  const cached = renderedPdfs.get(data);
  if (cached) return cached;
  const render = (async () => {
    const { getDocument } = await import("../lib/pdfjsSafe");
    const raw = data.split(",")[1];
    if (!raw) throw new Error("The uploaded PDF has no readable data.");
    const bytes = Uint8Array.from(atob(raw), (character) => character.charCodeAt(0));
    const task = getDocument({ data: bytes });
    try {
      const document = await task.promise;
      const page = await document.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2, 2400 / Math.max(base.width, base.height)) });
      const canvas = window.document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("The PDF background could not be drawn.");
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      return canvas.toDataURL("image/png");
    } finally { await task.destroy(); }
  })();
  if (renderedPdfs.size >= 4) renderedPdfs.delete(renderedPdfs.keys().next().value!);
  renderedPdfs.set(data, render);
  void render.catch(() => { renderedPdfs.delete(data); });
  return render;
}

/** PDF backgrounds become ordinary images so the existing PDF exporter can
 * capture them. Loading/errors remain visible and are marked for export guards. */
export default function TemplateBackground({ data, type, className = "absolute inset-0 h-full w-full", onReady }: {
  data: string;
  type: "image" | "pdf";
  className?: string;
  onReady?: (ready: boolean) => void;
}) {
  const [result, setResult] = useState({ data: "", url: "", error: "", ready: false });
  useEffect(() => {
    let active = true;
    if (!data) {
      setResult({ data, url: "", error: "No template background was found.", ready: false });
      return;
    }
    setResult({ data, url: type === "image" ? data : "", error: "", ready: false });
    if (type === "pdf") pdfBackground(data).then((url) => {
      if (active) setResult({ data, url, error: "", ready: false });
    }).catch((error: unknown) => {
      if (active) setResult({ data, url: "", error: error instanceof Error ? error.message : "Could not read the PDF.", ready: false });
    });
    return () => { active = false; };
  }, [data, type]);
  const current = result.data === data ? result : { url: "", error: "", ready: false };
  useEffect(() => { onReady?.(current.ready); }, [current.ready, onReady]);
  return (
    <div className={className} data-template-background-status={current.error ? "error" : current.ready ? "ready" : "loading"}>
      {current.url && <img src={current.url} alt="Template background" className="absolute inset-0 h-full w-full object-contain pointer-events-none"
        onLoad={() => setResult((value) => ({ ...value, ready: true }))}
        onError={() => setResult((value) => ({ ...value, ready: false, error: "The template image could not be loaded." }))} />}
      {!current.ready && <div role={current.error ? "alert" : "status"} className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-white/95 p-4 text-center text-neutral-700">
        <p className="text-sm font-medium">{current.error ? "Template background unavailable" : "Loading template background…"}</p>
        {current.error && <p className="max-w-sm text-xs">{current.error} Reopen the document or choose another template.</p>}
      </div>}
    </div>
  );
}
