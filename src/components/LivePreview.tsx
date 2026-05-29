import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PDFDocument } from "pdf-lib";
import type { Tool } from "./PdfToolbox";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/* Live preview for page-visual PDF tools. Rather than re-implementing each
 * effect, it runs the *real* tool on a one-page copy of the uploaded file
 * (debounced on option changes) and renders the resulting first page — so the
 * preview is exactly what the tool will produce. If the tool throws (e.g. an
 * option isn't filled in yet) it falls back to the plain page. */

const RENDER_W = 900;

/** Build a one-page PDF File from the first page of the source. */
async function firstPageFile(file: File): Promise<File> {
  const src = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const [pg] = await out.copyPages(src, [0]);
  out.addPage(pg);
  const bytes = await out.save();
  return new File([new Uint8Array(bytes)], file.name, { type: "application/pdf" });
}

/** Render the first page of PDF bytes to a PNG data URL. */
async function renderFirstPage(bytes: Uint8Array): Promise<string> {
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  const p = await pdf.getPage(1);
  const pt = p.getViewport({ scale: 1 });
  const scale = RENDER_W / pt.width;
  const vp = p.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = vp.width;
  canvas.height = vp.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  await p.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
  return canvas.toDataURL("image/png");
}

export default function LivePreview({
  tool,
  file,
  params,
}: {
  tool: Tool;
  file: File;
  params: Record<string, string>;
}) {
  const [img, setImg] = useState("");
  const [busy, setBusy] = useState(true);
  const [note, setNote] = useState("");
  // Cache the one-page copy so we only rebuild it when the file changes.
  const trimmedRef = useRef<{ key: string; file: Promise<File> } | null>(null);

  useEffect(() => {
    let dead = false;
    setBusy(true);
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (trimmedRef.current?.key !== key)
      trimmedRef.current = { key, file: firstPageFile(file) };

    const t = setTimeout(async () => {
      try {
        const trimmed = await trimmedRef.current!.file;
        if (dead) return;
        let bytes: Uint8Array;
        let fellBack = false;
        try {
          const outs = await tool.run([trimmed], params);
          const out = outs.find((o) => /\.pdf$/i.test(o.name)) ?? outs[0];
          if (!out || !/\.pdf$/i.test(out.name)) throw new Error("non-pdf");
          bytes = out.bytes;
        } catch {
          // Options incomplete or not previewable — show the plain page.
          bytes = new Uint8Array(await trimmed.arrayBuffer());
          fellBack = true;
        }
        const url = await renderFirstPage(bytes.slice());
        if (dead) return;
        setImg(url);
        setNote(fellBack ? "Adjust the options to preview the effect." : "");
      } catch (e) {
        if (!dead) setNote(e instanceof Error ? e.message : String(e));
      } finally {
        if (!dead) setBusy(false);
      }
    }, 400);

    return () => {
      dead = true;
      clearTimeout(t);
    };
  }, [tool, file, params]);

  return (
    <div>
      <div className="relative mx-auto w-full max-w-3xl overflow-hidden rounded-xl border border-brand-200 bg-white dark:border-[#3A3D45]">
        {img ? (
          <img src={img} alt="live preview" className="block w-full select-none" draggable={false} />
        ) : (
          <div className="grid h-72 place-items-center text-sm text-brand-400">
            <Loader2 size={20} className="animate-spin" />
          </div>
        )}
        {busy && img && (
          <div className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-white/90 shadow dark:bg-[#1E2025]/90">
            <Loader2 size={14} className="animate-spin text-primary-500" />
          </div>
        )}
        {!busy && (
          <span className="absolute left-2 top-2 rounded-full bg-primary-500/90 px-2 py-0.5 text-[10px] font-bold text-[#0A0A0A]">
            LIVE PREVIEW
          </span>
        )}
      </div>
      <p className="mt-2 text-center text-[11px] text-brand-400">
        {note || `Live preview of “${tool.name}” on page 1 — Run to apply to every page and download.`}
      </p>
    </div>
  );
}
