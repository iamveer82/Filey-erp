// Fully local PDF toolkit — runs entirely in the Tauri webview.
// No network, no external service. pdf-lib (MIT) + pdfjs-dist (Apache-2.0).
import { PDFDocument, degrees, rgb, StandardFonts } from "pdf-lib";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { parseRanges } from "./ranges";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { parseRanges };

export interface OutFile {
  name: string;
  bytes: Uint8Array;
}

const readBuf = (f: File) => f.arrayBuffer();
const base = (n: string) => n.replace(/\.pdf$/i, "");

// Many real-world PDFs carry an empty-owner-password encryption dict.
// Loading with ignoreEncryption lets the toolkit handle them instead of
// hard-failing on otherwise-readable files.
const loadDoc = async (f: File) =>
  PDFDocument.load(await readBuf(f), { ignoreEncryption: true });

export async function pageCount(file: File): Promise<number> {
  const doc = await loadDoc(file);
  return doc.getPageCount();
}

export async function mergePdfs(files: File[]): Promise<OutFile> {
  const merged = await PDFDocument.create();
  for (const f of files) {
    const src = await loadDoc(f);
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
  }
  return { name: "merged.pdf", bytes: await merged.save() };
}

export async function extractPages(
  file: File,
  ranges: string
): Promise<OutFile> {
  const src = await loadDoc(file);
  const idx = parseRanges(ranges, src.getPageCount());
  if (!idx.length) throw new Error("No valid pages in that range.");
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, idx);
  pages.forEach((p) => out.addPage(p));
  return { name: `${base(file.name)}-extract.pdf`, bytes: await out.save() };
}

export async function deletePages(
  file: File,
  ranges: string
): Promise<OutFile> {
  const src = await loadDoc(file);
  const remove = new Set(parseRanges(ranges, src.getPageCount()));
  const keep = src
    .getPageIndices()
    .filter((i) => !remove.has(i));
  if (!keep.length) throw new Error("That would delete every page.");
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, keep);
  pages.forEach((p) => out.addPage(p));
  return { name: `${base(file.name)}-trimmed.pdf`, bytes: await out.save() };
}

export async function splitEvery(
  file: File,
  size: number
): Promise<OutFile[]> {
  const src = await loadDoc(file);
  const total = src.getPageCount();
  // Guard against NaN / 0 / negative / fractional input — an invalid
  // chunk size here would otherwise spin the page loop forever.
  const n = Math.floor(Number(size));
  const chunk = Number.isFinite(n) && n > 0 ? n : 1;
  const results: OutFile[] = [];
  for (let start = 0, part = 1; start < total; start += chunk, part++) {
    const idx = [];
    for (let i = start; i < Math.min(start + chunk, total); i++) idx.push(i);
    const out = await PDFDocument.create();
    const pages = await out.copyPages(src, idx);
    pages.forEach((p) => out.addPage(p));
    results.push({
      name: `${base(file.name)}-part${part}.pdf`,
      bytes: await out.save(),
    });
  }
  return results;
}

export async function rotatePdf(
  file: File,
  deg: number,
  ranges?: string
): Promise<OutFile> {
  const doc = await loadDoc(file);
  const target = ranges
    ? new Set(parseRanges(ranges, doc.getPageCount()))
    : null;
  doc.getPages().forEach((p, i) => {
    if (!target || target.has(i)) {
      const cur = p.getRotation().angle;
      p.setRotation(degrees((cur + deg) % 360));
    }
  });
  return { name: `${base(file.name)}-rotated.pdf`, bytes: await doc.save() };
}

export async function imagesToPdf(files: File[]): Promise<OutFile> {
  const doc = await PDFDocument.create();
  for (const f of files) {
    const buf = await readBuf(f);
    const img = /png$/i.test(f.type || f.name)
      ? await doc.embedPng(buf)
      : await doc.embedJpg(buf);
    const page = doc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  if (doc.getPageCount() === 0) throw new Error("No images provided.");
  return { name: "images.pdf", bytes: await doc.save() };
}

export async function pdfToImages(
  file: File,
  scale = 2
): Promise<OutFile[]> {
  const data = new Uint8Array(await readBuf(file));
  const pdf = await pdfjs.getDocument({ data }).promise;
  const out: OutFile[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob: Blob = await new Promise((res) =>
      canvas.toBlob((b) => res(b!), "image/png")
    );
    out.push({
      name: `${base(file.name)}-p${n}.png`,
      bytes: new Uint8Array(await blob.arrayBuffer()),
    });
  }
  return out;
}

export async function addPageNumbers(file: File): Promise<OutFile> {
  const doc = await loadDoc(file);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.getPages().forEach((p, i) => {
    const { width } = p.getSize();
    const label = `${i + 1} / ${doc.getPageCount()}`;
    const w = font.widthOfTextAtSize(label, 10);
    p.drawText(label, {
      x: width / 2 - w / 2,
      y: 24,
      size: 10,
      font,
      color: rgb(0.35, 0.35, 0.35),
    });
  });
  return { name: `${base(file.name)}-numbered.pdf`, bytes: await doc.save() };
}

export async function addWatermark(
  file: File,
  text: string
): Promise<OutFile> {
  const doc = await loadDoc(file);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const label = (text || "DRAFT").slice(0, 40);
  doc.getPages().forEach((p) => {
    const { width, height } = p.getSize();
    // Auto-size so the rotated text always fits the page diagonal.
    const diag = Math.hypot(width, height);
    let size = 56;
    while (size > 12 && font.widthOfTextAtSize(label, size) > diag * 0.7)
      size -= 4;
    const tw = font.widthOfTextAtSize(label, size);
    const rad = (45 * Math.PI) / 180;
    p.drawText(label, {
      x: width / 2 - (tw / 2) * Math.cos(rad),
      y: height / 2 - (tw / 2) * Math.sin(rad),
      size,
      font,
      color: rgb(0.6, 0.6, 0.6),
      rotate: degrees(45),
      opacity: 0.18,
    });
  });
  return { name: `${base(file.name)}-watermark.pdf`, bytes: await doc.save() };
}

/** Lightweight re-save: strips redundant objects and re-streams. */
export async function compressPdf(file: File): Promise<OutFile> {
  const doc = await loadDoc(file);
  const bytes = await doc.save({ useObjectStreams: true });
  return { name: `${base(file.name)}-compressed.pdf`, bytes };
}

export type SvgFormat = "png" | "jpeg" | "webp" | "pdf";

// Resolve the SVG's intrinsic pixel size: explicit width/height first,
// then the viewBox (preserving aspect ratio), with a sane fallback for
// size-less icons so the raster is never 0×0 or the engine's 300×150.
function svgPixelSize(svgText: string): { w: number; h: number } {
  const root = new DOMParser().parseFromString(
    svgText,
    "image/svg+xml"
  ).documentElement;
  const len = (v: string | null) => {
    const m = v && /^\s*([\d.]+)\s*(px)?\s*$/i.exec(v);
    return m ? parseFloat(m[1]) : 0;
  };
  let w = len(root.getAttribute("width"));
  let h = len(root.getAttribute("height"));
  const vb = (root.getAttribute("viewBox") || "")
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    if (!w && !h) {
      w = vb[2];
      h = vb[3];
    } else if (!w) {
      w = (h * vb[2]) / vb[3];
    } else if (!h) {
      h = (w * vb[3]) / vb[2];
    }
  }
  return { w: w || 512, h: h || 512 };
}

/**
 * Convert an SVG to a raster image (PNG/JPEG/WebP) or a PDF, entirely
 * in the webview via Canvas + pdf-lib. No network, no native deps —
 * the same approach as svg2png/CairoSVG but offline and dependency-free.
 */
export async function svgToImage(
  file: File,
  format: SvgFormat = "png",
  scale = 2
): Promise<OutFile> {
  const text = await file.text();
  if (!/<svg[\s>]/i.test(text)) throw new Error("That isn't a valid SVG file.");

  const sNum = Number(scale);
  const s = Number.isFinite(sNum) && sNum > 0 ? Math.min(sNum, 10) : 1;
  const { w, h } = svgPixelSize(text);
  const cw = Math.max(1, Math.round(w * s));
  const ch = Math.max(1, Math.round(h * s));
  const stem = file.name.replace(/\.svg$/i, "");

  const url = URL.createObjectURL(
    new Blob([text], { type: "image/svg+xml;charset=utf-8" })
  );
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("Could not render this SVG."));
      im.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available.");
    // JPEG/PDF have no alpha channel — flatten onto white.
    if (format === "jpeg" || format === "pdf") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, cw, ch);
    }
    ctx.drawImage(img, 0, 0, cw, ch);

    const toBlob = (type: string, q?: number) =>
      new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) =>
            b
              ? resolve(b)
              : reject(
                  new Error(
                    "This SVG can't be rasterized — it may reference external resources."
                  )
                ),
          type,
          q
        )
      );

    if (format === "pdf") {
      const png = await toBlob("image/png");
      const doc = await PDFDocument.create();
      const embedded = await doc.embedPng(await png.arrayBuffer());
      const page = doc.addPage([w, h]);
      page.drawImage(embedded, { x: 0, y: 0, width: w, height: h });
      return { name: `${stem}.pdf`, bytes: await doc.save() };
    }

    const mime = format === "jpeg" ? "image/jpeg" : `image/${format}`;
    const blob = await toBlob(mime, format === "png" ? undefined : 0.92);
    const ext = format === "jpeg" ? "jpg" : format;
    return {
      name: `${stem}.${ext}`,
      bytes: new Uint8Array(await blob.arrayBuffer()),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
};

export function downloadFile(f: OutFile) {
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  // Copy into a fresh ArrayBuffer so Blob gets a clean BlobPart.
  const buf = f.bytes.slice();
  const blob = new Blob([buf], {
    type: MIME[ext] ?? "application/octet-stream",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = f.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
