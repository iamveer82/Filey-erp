import { FileySpinner as Loader2 } from "./FileySpinner";
import { useEffect, useRef, useState } from "react";

import * as safePdf from "../lib/pdfjsSafe";
import { PDFDocument } from "pdf-lib";
import type { Tool } from "./PdfToolbox";


/* Live preview for page-visual PDF tools. Rather than re-implementing each
 * effect, it runs the *real* tool on a one-page copy of the uploaded file
 * (debounced on option changes) and renders the resulting first page — so the
 * preview is exactly what the tool will produce. If the tool throws (e.g. an
 * option isn't filled in yet) it falls back to the plain page. */

const RENDER_W = 900;

/** Keep only the source pages needed to preview the first output sheet. */
async function previewFile(file: File, pageLimit: number): Promise<File> {
  if (pageLimit === Infinity) return file;
  const src = await PDFDocument.load(await file.arrayBuffer(), {
    ignoreEncryption: true,
  });
  if (src.isEncrypted) throw new Error("This PDF is locked. Use Remove PDF Password first.");
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, Array.from({ length: Math.min(pageLimit, src.getPageCount()) }, (_, i) => i));
  pages.forEach(page => out.addPage(page));
  const bytes = await out.save();
  return new File([new Uint8Array(bytes)], file.name, { type: "application/pdf" });
}

/** Render the first page of PDF bytes to a PNG data URL. */
async function renderFirstPage(bytes: Uint8Array): Promise<string> {
  const task = safePdf.getDocument({ data: bytes });
  try {
  const pdf = await task.promise;
  const p = await pdf.getPage(1);
  const pt = p.getViewport({ scale: 1 });
  const scale = RENDER_W / pt.width;
  const vp = p.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = vp.width;
  canvas.height = vp.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("The document preview could not be created.");
  await p.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
  return canvas.toDataURL("image/png");
  } finally { await task.destroy().catch(() => {}); }
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
  const trimmedRef = useRef<{ source: File; pageLimit: number; file: Promise<File> } | null>(null);

  useEffect(() => {
    let dead = false;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        // N-up needs 2/4 input pages to show a real first sheet. Page numbers
        // need the original count for "1 of N"; their processing is vector-only.
        const pageLimit = tool.id === "numbers" ? Infinity : tool.id === "nup" ? params.n === "4" ? 4 : 2 : 1;
        if (trimmedRef.current?.source !== file || trimmedRef.current.pageLimit !== pageLimit)
          trimmedRef.current = { source: file, pageLimit, file: previewFile(file, pageLimit) };
        const tr = trimmedRef.current;
        if (!tr) return;
        const trimmed = await tr.file;
        if (dead) return;
        let bytes: Uint8Array;
        let fellBack = false;
        try {
          const outs = await tool.run([trimmed], params);
          const out = outs.find((o) => /\.pdf$/i.test(o.name)) ?? outs[0];
          if (!out || !/\.pdf$/i.test(out.name)) throw new Error("non-pdf");
          bytes = out.bytes;
        } catch (e) {
          // Options incomplete or not previewable — show the plain page.
          console.warn("Preview unavailable, showing plain page:", e);
          bytes = new Uint8Array(await trimmed.arrayBuffer());
          fellBack = true;
        }
        const url = await renderFirstPage(bytes.slice());
        if (dead) return;
        setImg(url);
        setNote(fellBack ? "Adjust the options to preview the effect." : "");
      } catch (e) {
        if (!dead) {
          setImg("");
          setNote(/locked|password|encrypted/i.test(String(e))
            ? "This PDF is locked. Use Remove PDF Password first."
            : "This file could not be previewed. Check that it is a readable PDF, then try again.");
        }
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
      <div className="relative mx-auto w-full max-w-3xl overflow-hidden rounded-xl border border-brand-200 bg-white">
        {img ? (
          <img
            src={img}
            alt="live preview"
            className="block w-full select-none"
            draggable={false}
          />
        ) : (
          <div className="grid h-72 place-items-center p-6 text-center text-sm text-muted-foreground">
            {busy ? <Loader2 size={20} className="animate-spin" /> : note || "Preview unavailable. Your file is still ready to process."}
          </div>
        )}
        {busy && img && (
          <div className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-white/90 dark:bg-card/90">
            <Loader2 size={14} className="animate-spin text-foreground" />
          </div>
        )}
        {!busy && img && (
          <span className="absolute left-2 top-2 rounded-full bg-card/90 px-2 py-0.5 text-[10px] font-medium text-foreground">
            LIVE PREVIEW
          </span>
        )}
      </div>
      <p className="mt-2 text-center text-[11px] text-brand-400">
        {note ||
          `Preview of the first ${tool.id === "nup" ? "output sheet" : "page"}. The complete file is included in your download.`}
      </p>
    </div>
  );
}
