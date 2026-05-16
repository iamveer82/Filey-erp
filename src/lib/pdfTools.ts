// Fully local PDF toolkit — runs entirely in the Tauri webview.
// No network, no external service. pdf-lib (MIT) + pdfjs-dist (Apache-2.0).
import { PDFDocument, degrees, rgb, StandardFonts } from "pdf-lib";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface OutFile {
  name: string;
  bytes: Uint8Array;
}

const readBuf = (f: File) => f.arrayBuffer();
const base = (n: string) => n.replace(/\.pdf$/i, "");

/** Parse "1-3,5,8-" (1-based) into a sorted unique 0-based index list. */
export function parseRanges(input: string, pageCount: number): number[] {
  const out = new Set<number>();
  for (const part of input.split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)?\s*-\s*(\d+)?$/);
    if (m) {
      const a = m[1] ? parseInt(m[1], 10) : 1;
      const b = m[2] ? parseInt(m[2], 10) : pageCount;
      for (let i = a; i <= b; i++)
        if (i >= 1 && i <= pageCount) out.add(i - 1);
    } else if (/^\d+$/.test(part)) {
      const i = parseInt(part, 10);
      if (i >= 1 && i <= pageCount) out.add(i - 1);
    }
  }
  return [...out].sort((x, y) => x - y);
}

export async function pageCount(file: File): Promise<number> {
  const doc = await PDFDocument.load(await readBuf(file));
  return doc.getPageCount();
}

export async function mergePdfs(files: File[]): Promise<OutFile> {
  const merged = await PDFDocument.create();
  for (const f of files) {
    const src = await PDFDocument.load(await readBuf(f));
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
  }
  return { name: "merged.pdf", bytes: await merged.save() };
}

export async function extractPages(
  file: File,
  ranges: string
): Promise<OutFile> {
  const src = await PDFDocument.load(await readBuf(file));
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
  const src = await PDFDocument.load(await readBuf(file));
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
  const src = await PDFDocument.load(await readBuf(file));
  const total = src.getPageCount();
  const chunk = Math.max(1, size);
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
  const doc = await PDFDocument.load(await readBuf(file));
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
  const doc = await PDFDocument.load(await readBuf(file));
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
  const doc = await PDFDocument.load(await readBuf(file));
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.getPages().forEach((p) => {
    const { width, height } = p.getSize();
    p.drawText(text || "DRAFT", {
      x: width / 2 - text.length * 12,
      y: height / 2,
      size: 56,
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
  const doc = await PDFDocument.load(await readBuf(file));
  const bytes = await doc.save({ useObjectStreams: true });
  return { name: `${base(file.name)}-compressed.pdf`, bytes };
}

export function downloadFile(f: OutFile) {
  const isPng = f.name.endsWith(".png");
  // Copy into a fresh ArrayBuffer so Blob gets a clean BlobPart.
  const buf = f.bytes.slice();
  const blob = new Blob([buf], {
    type: isPng ? "image/png" : "application/pdf",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = f.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
