// Fully local PDF toolkit — runs entirely in the Tauri webview.
// No network, no external service. pdf-lib (MIT) + pdfjs-dist (Apache-2.0).
import { PDFDocument, degrees, rgb, StandardFonts } from "pdf-lib";
import initVtracer, { to_svg as vtracerToSvg } from "vtracer-wasm";
import vtracerWasmUrl from "vtracer-wasm/vtracer.wasm?url";
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
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
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

export type TracePreset = "photo" | "logo" | "bw" | "pixel";

interface VtracerConfig {
  binary: boolean;
  mode: "spline" | "polygon" | "pixel";
  hierarchical: "stacked" | "cutout";
  cornerThreshold: number;
  lengthThreshold: number;
  maxIterations: number;
  spliceThreshold: number;
  filterSpeckle: number;
  colorPrecision: number;
  layerDifference: number;
  pathPrecision: number;
}

// Tuned VTracer configs. Defaults follow upstream vtracer; "logo"
// merges aggressively for clean flat art, "pixel" uses polygon mode
// for a faithful sharp trace, "bw" is binary line-art.
// NOTE: colorPrecision MUST stay ≤ 6 — visioncortex 0.8.8 panics
// (wasm `unreachable`) in colour clustering at higher precision.
const MAX_COLOR_PRECISION = 6;
const VTRACER_PRESET: Record<TracePreset, VtracerConfig> = {
  photo: {
    binary: false,
    mode: "spline",
    hierarchical: "stacked",
    cornerThreshold: 60,
    lengthThreshold: 4,
    maxIterations: 10,
    spliceThreshold: 45,
    filterSpeckle: 4,
    colorPrecision: 6,
    layerDifference: 8,
    pathPrecision: 8,
  },
  logo: {
    binary: false,
    mode: "spline",
    hierarchical: "stacked",
    cornerThreshold: 80,
    lengthThreshold: 4,
    maxIterations: 10,
    spliceThreshold: 45,
    filterSpeckle: 8,
    colorPrecision: 6,
    layerDifference: 24,
    pathPrecision: 6,
  },
  bw: {
    binary: true,
    mode: "spline",
    hierarchical: "stacked",
    cornerThreshold: 60,
    lengthThreshold: 4,
    maxIterations: 10,
    spliceThreshold: 45,
    filterSpeckle: 4,
    colorPrecision: 6,
    layerDifference: 16,
    pathPrecision: 8,
  },
  pixel: {
    binary: false,
    mode: "polygon",
    hierarchical: "stacked",
    cornerThreshold: 60,
    lengthThreshold: 4,
    maxIterations: 10,
    spliceThreshold: 45,
    filterSpeckle: 2,
    colorPrecision: 6,
    layerDifference: 8,
    pathPrecision: 8,
  },
};

let vtracerReady: Promise<unknown> | null = null;
const ensureVtracer = () =>
  (vtracerReady ??= initVtracer({ module_or_path: vtracerWasmUrl }));

/**
 * Professional raster → vector via VTracer (visioncortex, MIT) compiled
 * to WebAssembly — real colour-layered Bézier paths, not a bitmap
 * wrapped in an <svg>. Runs fully in the webview, no network.
 *
 * Note: logos & illustrations vectorise cleanly; photos still produce
 * many colour layers (large SVG) — that is inherent to raster→vector.
 */
export async function imageToSvg(
  file: File,
  preset: TracePreset = "photo"
): Promise<OutFile> {
  const isRaster =
    /^image\/(png|jpe?g|webp)$/i.test(file.type) ||
    /\.(png|jpe?g|webp)$/i.test(file.name);
  if (!isRaster) throw new Error("Please choose a PNG, JPG or WebP image.");

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("Could not read this image."));
      im.src = url;
    });

    // Cap the working resolution: tracing cost grows with pixel count
    // and a multi-megapixel photo yields a huge, slow SVG with no
    // visible gain — pro vectorizers downsample similarly.
    const MAX = 1600;
    const ratio = Math.min(
      1,
      MAX / Math.max(img.naturalWidth || 1, img.naturalHeight || 1)
    );
    const w = Math.max(1, Math.round((img.naturalWidth || 1) * ratio));
    const h = Math.max(1, Math.round((img.naturalHeight || 1) * ratio));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available.");
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);

    await ensureVtracer();
    const cfg = VTRACER_PRESET[preset];
    const svg = vtracerToSvg(new Uint8Array(data.buffer), w, h, {
      ...cfg,
      colorPrecision: Math.min(MAX_COLOR_PRECISION, cfg.colorPrecision),
    });
    const stem = file.name.replace(/\.(png|jpe?g|webp)$/i, "");
    return { name: `${stem}.svg`, bytes: new TextEncoder().encode(svg) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const nameStem = (n: string) => n.replace(/\.[^./\\]+$/, "");
// pdf-lib's standard fonts are WinAnsi-only; drop anything they can't
// encode so drawText never throws on a stray glyph.
const ascii = (s: string) => s.replace(/[^\x20-\x7E]/g, "?");

export type ImgFormat = "keep" | "png" | "jpeg" | "webp";

/** Re-encode (and optionally resize) a raster image to shrink it. */
export async function compressImage(
  file: File,
  format: ImgFormat = "keep",
  quality = 80,
  maxW = 0
): Promise<OutFile> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("Could not read this image."));
      im.src = url;
    });
    const ow = img.naturalWidth || 1;
    const oh = img.naturalHeight || 1;
    const cap = Math.floor(Number(maxW));
    const ratio = cap > 0 && cap < ow ? cap / ow : 1;
    const w = Math.max(1, Math.round(ow * ratio));
    const h = Math.max(1, Math.round(oh * ratio));

    const out: ImgFormat =
      format === "keep"
        ? /png$/i.test(file.type || file.name)
          ? "png"
          : "jpeg"
        : format;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available.");
    if (out === "jpeg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(img, 0, 0, w, h);

    const q = Math.min(1, Math.max(0.05, (Number(quality) || 80) / 100));
    const mime = out === "jpeg" ? "image/jpeg" : `image/${out}`;
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Could not encode image."))),
        mime,
        out === "png" ? undefined : q
      )
    );
    const ext = out === "jpeg" ? "jpg" : out;
    return {
      name: `${nameStem(file.name)}-min.${ext}`,
      bytes: new Uint8Array(await blob.arrayBuffer()),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Extract the embedded text layer of a PDF to a .txt file. */
export async function pdfToText(file: File): Promise<OutFile> {
  const data = new Uint8Array(await readBuf(file));
  const pdf = await pdfjs.getDocument({ data }).promise;
  let text = "";
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const tc = await page.getTextContent();
    text += tc.items
      .map((it) => {
        const t = it as { str?: string; hasEOL?: boolean };
        return (t.str ?? "") + (t.hasEOL ? "\n" : "");
      })
      .join("");
    text += "\n\n";
  }
  return {
    name: `${nameStem(file.name)}.txt`,
    bytes: new TextEncoder().encode(text.trim() + "\n"),
  };
}

/**
 * Rasterize every page and rebuild the PDF from those images, so form
 * fields, layers and hidden/redacted content are baked flat. Optional
 * grayscale saves ink and size.
 */
export async function flattenPdf(
  file: File,
  scale = 2,
  grayscale = false
): Promise<OutFile> {
  const data = new Uint8Array(await readBuf(file));
  const pdf = await pdfjs.getDocument({ data }).promise;
  const out = await PDFDocument.create();
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const base1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = vp.width;
    canvas.height = vp.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
    if (grayscale) {
      const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = id.data;
      for (let i = 0; i < d.length; i += 4) {
        const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
        d[i] = d[i + 1] = d[i + 2] = g;
      }
      ctx.putImageData(id, 0, 0);
    }
    const blob: Blob = await new Promise((res, rej) =>
      canvas.toBlob(
        (b) => (b ? res(b) : rej(new Error("Render failed."))),
        "image/png"
      )
    );
    const png = await out.embedPng(await blob.arrayBuffer());
    const p = out.addPage([base1.width, base1.height]);
    p.drawImage(png, {
      x: 0,
      y: 0,
      width: base1.width,
      height: base1.height,
    });
  }
  return {
    name: `${base(file.name)}-flattened.pdf`,
    bytes: await out.save(),
  };
}

/** Set the PDF's Title / Author document metadata. */
export async function setPdfMeta(
  file: File,
  title: string,
  author: string
): Promise<OutFile> {
  const doc = await loadDoc(file);
  if (title.trim()) doc.setTitle(title.trim());
  if (author.trim()) doc.setAuthor(author.trim());
  doc.setModificationDate(new Date());
  return { name: `${base(file.name)}-info.pdf`, bytes: await doc.save() };
}

/** Lay a plain-text / markdown file out as a paginated A4 PDF. */
export async function textToPdf(file: File): Promise<OutFile> {
  const raw = (await file.text()).replace(/\r\n?/g, "\n");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const size = 11;
  const lh = 16;
  const margin = 56;
  const pw = 595.28;
  const ph = 841.89; // A4 in points
  const maxW = pw - margin * 2;

  const wrap = (line: string): string[] => {
    let cur = "";
    const lines: string[] = [];
    for (const tok of ascii(line).split(/(\s+)/)) {
      if (font.widthOfTextAtSize(cur + tok, size) > maxW && cur) {
        lines.push(cur.replace(/\s+$/, ""));
        cur = tok.replace(/^\s+/, "");
      } else {
        cur += tok;
      }
      while (font.widthOfTextAtSize(cur, size) > maxW && cur.length > 1) {
        let cut = cur.length;
        while (cut > 1 && font.widthOfTextAtSize(cur.slice(0, cut), size) > maxW)
          cut--;
        lines.push(cur.slice(0, cut));
        cur = cur.slice(cut);
      }
    }
    lines.push(cur);
    return lines;
  };

  const all = raw.split("\n").flatMap(wrap);
  let page = doc.addPage([pw, ph]);
  let y = ph - margin;
  for (const ln of all) {
    if (y < margin) {
      page = doc.addPage([pw, ph]);
      y = ph - margin;
    }
    if (ln) page.drawText(ln, { x: margin, y, size, font, color: rgb(0.1, 0.1, 0.1) });
    y -= lh;
  }
  return { name: `${nameStem(file.name)}.pdf`, bytes: await doc.save() };
}

function parseCsv(text: string): string[][] {
  const s = text.replace(/\r\n?/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cur);
      cur = "";
    } else if (c === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += c;
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** Render a CSV as a simple paginated table PDF (landscape A4). */
export async function csvToPdf(file: File): Promise<OutFile> {
  const rows = parseCsv(await file.text()).slice(0, 5000);
  if (!rows.length) throw new Error("That CSV file looks empty.");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pw = 841.89;
  const ph = 595.28; // A4 landscape
  const margin = 28;
  const size = 8;
  const rh = 16;
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const cw = (pw - margin * 2) / cols;

  const fit = (txt: string, f: typeof font) => {
    let t = ascii(txt);
    if (f.widthOfTextAtSize(t, size) <= cw - 6) return t;
    while (t.length > 1 && f.widthOfTextAtSize(t + "…", size) > cw - 6)
      t = t.slice(0, -1);
    return t + "…";
  };

  let page = doc.addPage([pw, ph]);
  let y = ph - margin;
  rows.forEach((r, ri) => {
    if (y < margin + rh) {
      page = doc.addPage([pw, ph]);
      y = ph - margin;
    }
    const head = ri === 0;
    if (head) {
      page.drawRectangle({
        x: margin,
        y: y - rh + 4,
        width: pw - margin * 2,
        height: rh,
        color: rgb(0.96, 0.9, 0.55),
      });
    }
    for (let c = 0; c < cols; c++) {
      page.drawText(fit(r[c] ?? "", head ? bold : font), {
        x: margin + c * cw + 3,
        y: y - rh + 9,
        size,
        font: head ? bold : font,
        color: rgb(0.13, 0.13, 0.13),
      });
    }
    page.drawLine({
      start: { x: margin, y: y - rh + 2 },
      end: { x: pw - margin, y: y - rh + 2 },
      thickness: 0.5,
      color: rgb(0.8, 0.8, 0.8),
    });
    y -= rh;
  });
  return { name: `${nameStem(file.name)}.pdf`, bytes: await doc.save() };
}

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
};

/** Reverse the page order of a PDF. */
export async function reversePdf(file: File): Promise<OutFile> {
  const src = await loadDoc(file);
  const idx = src.getPageIndices().slice().reverse();
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, idx);
  pages.forEach((p) => out.addPage(p));
  return {
    name: `${base(file.name)}-reversed.pdf`,
    bytes: await out.save(),
  };
}

/** Append a blank page sized to the last page (or A4 if empty). */
export async function addBlankPage(file: File): Promise<OutFile> {
  const doc = await loadDoc(file);
  const count = doc.getPageCount();
  if (count > 0) {
    const last = doc.getPage(count - 1);
    doc.addPage([last.getWidth(), last.getHeight()]);
  } else {
    doc.addPage([595.28, 841.89]);
  }
  return { name: `${base(file.name)}-blank.pdf`, bytes: await doc.save() };
}

/** Lay every N source pages onto one landscape sheet (2-up or 4-up). */
export async function nupPdf(file: File, n: 2 | 4): Promise<OutFile> {
  const src = await loadDoc(file);
  const out = await PDFDocument.create();
  const total = src.getPageCount();
  // A4 landscape sheet
  const sw = 841.89;
  const sh = 595.28;
  const cols = n === 2 ? 2 : 2;
  const rows = n === 2 ? 1 : 2;
  const cellW = sw / cols;
  const cellH = sh / rows;
  for (let i = 0; i < total; i += n) {
    const slice = src.getPageIndices().slice(i, i + n);
    const embedded = await out.embedPages(slice.map((j) => src.getPage(j)));
    const sheet = out.addPage([sw, sh]);
    embedded.forEach((emb, k) => {
      const c = k % cols;
      const r = Math.floor(k / cols);
      const pw = emb.width;
      const ph = emb.height;
      const scale = Math.min(cellW / pw, cellH / ph) * 0.95;
      const drawW = pw * scale;
      const drawH = ph * scale;
      const x = c * cellW + (cellW - drawW) / 2;
      const y = sh - (r + 1) * cellH + (cellH - drawH) / 2;
      sheet.drawPage(emb, { x, y, xScale: scale, yScale: scale });
    });
  }
  return {
    name: `${base(file.name)}-${n}up.pdf`,
    bytes: await out.save(),
  };
}

/** Dump basic PDF info (page count, size, metadata) to a .txt file. */
export async function pdfInfo(file: File): Promise<OutFile> {
  const doc = await loadDoc(file);
  const count = doc.getPageCount();
  const sizes = doc.getPages().map((p) => {
    return `${Math.round(p.getWidth())} × ${Math.round(p.getHeight())} pt`;
  });
  const unique = Array.from(new Set(sizes));
  const lines: string[] = [];
  lines.push(`File: ${file.name}`);
  lines.push(`Size: ${(file.size / 1024).toFixed(1)} KB`);
  lines.push(`Pages: ${count}`);
  lines.push(`Page sizes: ${unique.join(", ")}`);
  lines.push(`Title: ${doc.getTitle() ?? "—"}`);
  lines.push(`Author: ${doc.getAuthor() ?? "—"}`);
  lines.push(`Subject: ${doc.getSubject() ?? "—"}`);
  lines.push(`Keywords: ${(doc.getKeywords() ?? "—").toString()}`);
  lines.push(`Producer: ${doc.getProducer() ?? "—"}`);
  lines.push(`Creator: ${doc.getCreator() ?? "—"}`);
  lines.push(
    `Created: ${doc.getCreationDate()?.toISOString() ?? "—"}`
  );
  lines.push(
    `Modified: ${doc.getModificationDate()?.toISOString() ?? "—"}`
  );
  const text = lines.join("\n");
  return {
    name: `${base(file.name)}-info.txt`,
    bytes: new TextEncoder().encode(text),
  };
}

/** Convert a CSV file to a JSON array of row objects. */
export async function csvToJson(file: File): Promise<OutFile> {
  const rows = parseCsv(await file.text());
  if (rows.length < 1) throw new Error("That CSV file looks empty.");
  const header = rows[0].map((h) => h.trim() || "_");
  const body = rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    header.forEach((k, i) => (obj[k] = r[i] ?? ""));
    return obj;
  });
  const json = JSON.stringify(body, null, 2);
  return {
    name: `${nameStem(file.name)}.json`,
    bytes: new TextEncoder().encode(json),
  };
}

/** Convert a JSON array of flat objects to CSV. */
export async function jsonToCsv(file: File): Promise<OutFile> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch (e) {
    throw new Error(
      `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  if (!Array.isArray(parsed) || !parsed.length)
    throw new Error("JSON must be a non-empty array of objects.");
  const keys = Array.from(
    new Set(
      parsed.flatMap((r) =>
        r && typeof r === "object" ? Object.keys(r as object) : []
      )
    )
  );
  if (!keys.length)
    throw new Error("JSON entries must be objects with at least one field.");
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [keys.join(",")];
  for (const row of parsed) {
    const r = row as Record<string, unknown>;
    lines.push(keys.map((k) => esc(r?.[k])).join(","));
  }
  return {
    name: `${nameStem(file.name)}.csv`,
    bytes: new TextEncoder().encode(lines.join("\n")),
  };
}

/** Split each page horizontally or vertically into two pages. */
export async function dividePages(
  file: File,
  axis: "h" | "v"
): Promise<OutFile> {
  const src = await loadDoc(file);
  const out = await PDFDocument.create();
  const embedded = await out.embedPages(src.getPages());
  embedded.forEach((emb) => {
    const w = emb.width;
    const h = emb.height;
    if (axis === "h") {
      // top half + bottom half
      const top = out.addPage([w, h / 2]);
      top.drawPage(emb, { x: 0, y: -h / 2, xScale: 1, yScale: 1 });
      const bot = out.addPage([w, h / 2]);
      bot.drawPage(emb, { x: 0, y: 0, xScale: 1, yScale: 1 });
    } else {
      // left half + right half
      const left = out.addPage([w / 2, h]);
      left.drawPage(emb, { x: 0, y: 0, xScale: 1, yScale: 1 });
      const right = out.addPage([w / 2, h]);
      right.drawPage(emb, { x: -w / 2, y: 0, xScale: 1, yScale: 1 });
    }
  });
  return {
    name: `${base(file.name)}-divided.pdf`,
    bytes: await out.save(),
  };
}

/** Stitch every page into one tall page (preserves widest width). */
export async function combineToSinglePage(file: File): Promise<OutFile> {
  const src = await loadDoc(file);
  const out = await PDFDocument.create();
  const embedded = await out.embedPages(src.getPages());
  const width = Math.max(...embedded.map((e) => e.width));
  const totalH = embedded.reduce((s, e) => s + e.height, 0);
  const sheet = out.addPage([width, totalH]);
  let y = totalH;
  for (const emb of embedded) {
    y -= emb.height;
    sheet.drawPage(emb, { x: (width - emb.width) / 2, y });
  }
  return {
    name: `${base(file.name)}-single.pdf`,
    bytes: await out.save(),
  };
}

/** Interleave pages from multiple PDFs (A1,B1,C1,A2,B2,…). */
export async function alternateMerge(files: File[]): Promise<OutFile> {
  if (!files.length) throw new Error("Add at least one PDF.");
  const docs = await Promise.all(files.map(loadDoc));
  const out = await PDFDocument.create();
  const max = Math.max(...docs.map((d) => d.getPageCount()));
  for (let i = 0; i < max; i++) {
    for (const d of docs) {
      if (i < d.getPageCount()) {
        const [p] = await out.copyPages(d, [i]);
        out.addPage(p);
      }
    }
  }
  return { name: `interleaved.pdf`, bytes: await out.save() };
}

/** Crop margins by an inset percentage (0–40). */
export async function cropPdf(
  file: File,
  marginPct: number
): Promise<OutFile> {
  const doc = await loadDoc(file);
  const pct = Math.max(0, Math.min(40, marginPct)) / 100;
  doc.getPages().forEach((p) => {
    const w = p.getWidth();
    const h = p.getHeight();
    const dx = w * pct;
    const dy = h * pct;
    p.setCropBox(dx, dy, w - dx * 2, h - dy * 2);
  });
  return {
    name: `${base(file.name)}-cropped.pdf`,
    bytes: await doc.save(),
  };
}

/** Strip every annotation from every page. */
export async function removeAnnotations(file: File): Promise<OutFile> {
  const doc = await loadDoc(file);
  const { PDFName } = await import("pdf-lib");
  doc.getPages().forEach((p) => {
    p.node.delete(PDFName.of("Annots"));
  });
  return {
    name: `${base(file.name)}-clean.pdf`,
    bytes: await doc.save(),
  };
}

/** Add header / footer text on every page. */
export async function addHeaderFooter(
  file: File,
  header: string,
  footer: string
): Promise<OutFile> {
  const doc = await loadDoc(file);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const size = 9;
  doc.getPages().forEach((p) => {
    const w = p.getWidth();
    const h = p.getHeight();
    if (header.trim()) {
      const tw = font.widthOfTextAtSize(header, size);
      p.drawText(header, {
        x: w / 2 - tw / 2,
        y: h - 18,
        size,
        font,
        color: rgb(0.35, 0.35, 0.35),
      });
    }
    if (footer.trim()) {
      const tw = font.widthOfTextAtSize(footer, size);
      p.drawText(footer, {
        x: w / 2 - tw / 2,
        y: 10,
        size,
        font,
        color: rgb(0.35, 0.35, 0.35),
      });
    }
  });
  return {
    name: `${base(file.name)}-headed.pdf`,
    bytes: await doc.save(),
  };
}

export type StampKind = "approved" | "rejected" | "draft" | "confidential" | "paid";
const STAMP_COLOR: Record<StampKind, [number, number, number]> = {
  approved: [0.2, 0.6, 0.2],
  rejected: [0.85, 0.18, 0.18],
  draft: [0.45, 0.45, 0.45],
  confidential: [0.85, 0.18, 0.18],
  paid: [0.2, 0.55, 0.4],
};
/** Diagonal coloured stamp ("APPROVED", "REJECTED", etc.) on every page. */
export async function addStamp(file: File, kind: StampKind): Promise<OutFile> {
  const doc = await loadDoc(file);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const label = kind.toUpperCase();
  const [r, g, b] = STAMP_COLOR[kind] ?? [0.5, 0.5, 0.5];
  doc.getPages().forEach((p) => {
    const w = p.getWidth();
    const h = p.getHeight();
    const diag = Math.hypot(w, h);
    let size = 80;
    while (size > 14 && font.widthOfTextAtSize(label, size) > diag * 0.6)
      size -= 4;
    const tw = font.widthOfTextAtSize(label, size);
    const rad = (30 * Math.PI) / 180;
    p.drawText(label, {
      x: w / 2 - (tw / 2) * Math.cos(rad),
      y: h / 2 - (tw / 2) * Math.sin(rad),
      size,
      font,
      color: rgb(r, g, b),
      rotate: degrees(30),
      opacity: 0.45,
    });
  });
  return {
    name: `${base(file.name)}-${kind}.pdf`,
    bytes: await doc.save(),
  };
}

/** Embed a signature image (PNG/JPG data URL) at bottom-right of last page. */
export async function signPdf(
  file: File,
  signatureDataUrl: string
): Promise<OutFile> {
  if (!signatureDataUrl) throw new Error("Provide a signature image.");
  const doc = await loadDoc(file);
  const pages = doc.getPages();
  if (!pages.length) throw new Error("PDF has no pages.");
  const isPng = signatureDataUrl.startsWith("data:image/png");
  const b64 = signatureDataUrl.split(",")[1] ?? "";
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const img = isPng ? await doc.embedPng(raw) : await doc.embedJpg(raw);
  const target = pages[pages.length - 1];
  const w = Math.min(180, target.getWidth() * 0.3);
  const h = (w / img.width) * img.height;
  target.drawImage(img, {
    x: target.getWidth() - w - 40,
    y: 40,
    width: w,
    height: h,
  });
  return {
    name: `${base(file.name)}-signed.pdf`,
    bytes: await doc.save(),
  };
}

/** Strip Title/Author/Subject/Keywords/Producer/Creator metadata. */
export async function removeMetadata(file: File): Promise<OutFile> {
  const doc = await loadDoc(file);
  doc.setTitle("");
  doc.setAuthor("");
  doc.setSubject("");
  doc.setKeywords([]);
  doc.setProducer("");
  doc.setCreator("");
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date());
  return {
    name: `${base(file.name)}-nometa.pdf`,
    bytes: await doc.save(),
  };
}

/** Sanitize: strip metadata + annotations + clear document outline. */
export async function sanitizePdf(file: File): Promise<OutFile> {
  const cleaned = await removeAnnotations(file);
  const noMetaFile = new File([cleaned.bytes.slice()], file.name, {
    type: "application/pdf",
  });
  return removeMetadata(noMetaFile);
}

/** Resize every page to A4 portrait (or landscape if originally landscape). */
export async function fixPageSizeA4(file: File): Promise<OutFile> {
  const src = await loadDoc(file);
  const out = await PDFDocument.create();
  const A4 = { w: 595.28, h: 841.89 };
  const embedded = await out.embedPages(src.getPages());
  embedded.forEach((emb) => {
    const isLand = emb.width > emb.height;
    const tw = isLand ? A4.h : A4.w;
    const th = isLand ? A4.w : A4.h;
    const scale = Math.min(tw / emb.width, th / emb.height);
    const dw = emb.width * scale;
    const dh = emb.height * scale;
    const page = out.addPage([tw, th]);
    page.drawPage(emb, {
      x: (tw - dw) / 2,
      y: (th - dh) / 2,
      xScale: scale,
      yScale: scale,
    });
  });
  return {
    name: `${base(file.name)}-a4.pdf`,
    bytes: await out.save(),
  };
}

/** Re-save without object streams — closer to legacy "linearized" output. */
export async function linearizePdf(file: File): Promise<OutFile> {
  const doc = await loadDoc(file);
  return {
    name: `${base(file.name)}-linear.pdf`,
    bytes: await doc.save({ useObjectStreams: false }),
  };
}

/** Pretty-print JSON as a paginated PDF. */
export async function jsonToPdf(file: File): Promise<OutFile> {
  const text = await file.text();
  let pretty: string;
  try {
    pretty = JSON.stringify(JSON.parse(text), null, 2);
  } catch (e) {
    throw new Error(
      `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  const blob = new Blob([pretty], { type: "text/plain" });
  const stub = new File([blob], `${nameStem(file.name)}.txt`, {
    type: "text/plain",
  });
  return textToPdf(stub);
}

/** Markdown → PDF (plain-text rendering; preserves structure visually). */
export async function markdownToPdf(file: File): Promise<OutFile> {
  return textToPdf(file);
}

/** Extract every page's text + basic metadata as JSON. */
export async function pdfToJsonText(file: File): Promise<OutFile> {
  const data = new Uint8Array(await readBuf(file));
  const pdf = await pdfjs.getDocument({ data }).promise;
  const doc = await loadDoc(file);
  const pages: { page: number; text: string }[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const tc = await page.getTextContent();
    const txt = tc.items
      .map((it: any) => ("str" in it ? it.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pages.push({ page: n, text: txt });
  }
  const payload = {
    file: file.name,
    pages: pdf.numPages,
    title: doc.getTitle() ?? null,
    author: doc.getAuthor() ?? null,
    subject: doc.getSubject() ?? null,
    keywords: doc.getKeywords() ?? null,
    content: pages,
  };
  return {
    name: `${nameStem(file.name)}.json`,
    bytes: new TextEncoder().encode(JSON.stringify(payload, null, 2)),
  };
}

/** Render each page to an image format (JPG/PNG/WebP/BMP). */
export async function pdfToImageFormat(
  file: File,
  format: "png" | "jpeg" | "webp" | "bmp",
  scale = 2
): Promise<OutFile[]> {
  const data = new Uint8Array(await readBuf(file));
  const pdf = await pdfjs.getDocument({ data }).promise;
  const out: OutFile[] = [];
  const mime =
    format === "bmp" ? "image/bmp" :
    format === "jpeg" ? "image/jpeg" : `image/${format}`;
  const ext = format === "jpeg" ? "jpg" : format;
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    if (format === "jpeg" || format === "bmp") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    const blob: Blob | null = await new Promise((res) =>
      canvas.toBlob((b) => res(b), mime, format === "jpeg" ? 0.92 : undefined)
    );
    if (!blob) throw new Error(`Browser cannot encode ${format}.`);
    out.push({
      name: `${base(file.name)}-p${n}.${ext}`,
      bytes: new Uint8Array(await blob.arrayBuffer()),
    });
  }
  return out;
}

/** Render every page through a canvas filter (greyscale or invert). */
async function rasterTransform(
  file: File,
  mode: "grey" | "invert",
  scale = 2
): Promise<OutFile> {
  const data = new Uint8Array(await readBuf(file));
  const pdf = await pdfjs.getDocument({ data }).promise;
  const out = await PDFDocument.create();
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = img.data;
    if (mode === "grey") {
      for (let i = 0; i < px.length; i += 4) {
        const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        px[i] = px[i + 1] = px[i + 2] = g;
      }
    } else {
      for (let i = 0; i < px.length; i += 4) {
        px[i] = 255 - px[i];
        px[i + 1] = 255 - px[i + 1];
        px[i + 2] = 255 - px[i + 2];
      }
    }
    ctx.putImageData(img, 0, 0);
    const blob: Blob = await new Promise((res) =>
      canvas.toBlob((b) => res(b!), "image/png")
    );
    const buf = await blob.arrayBuffer();
    const embedded = await out.embedPng(buf);
    const ow = viewport.width / scale;
    const oh = viewport.height / scale;
    const sheet = out.addPage([ow, oh]);
    sheet.drawImage(embedded, { x: 0, y: 0, width: ow, height: oh });
  }
  return {
    name: `${base(file.name)}-${mode === "grey" ? "grey" : "inverted"}.pdf`,
    bytes: await out.save(),
  };
}

export const greyscalePdf = (file: File) => rasterTransform(file, "grey");
export const invertColors = (file: File) => rasterTransform(file, "invert");

/** Remove pages with effectively no text and near-blank pixel content. */
export async function removeBlankPages(file: File): Promise<OutFile> {
  const data = new Uint8Array(await readBuf(file));
  const pdf = await pdfjs.getDocument({ data }).promise;
  const keep: number[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const tc = await page.getTextContent();
    const txt = tc.items
      .map((it: any) => ("str" in it ? it.str : ""))
      .join("")
      .trim();
    if (txt.length > 0) {
      keep.push(n - 1);
      continue;
    }
    const viewport = page.getViewport({ scale: 0.5 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let inked = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] + px[i + 1] + px[i + 2] < 720) inked++;
      if (inked > 200) break;
    }
    if (inked > 200) keep.push(n - 1);
  }
  if (!keep.length) throw new Error("Every page looks blank.");
  const src = await loadDoc(file);
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, keep);
  copied.forEach((p) => out.addPage(p));
  return {
    name: `${base(file.name)}-trimmed.pdf`,
    bytes: await out.save(),
  };
}

/** Reorder pages for saddle-stitch booklet (4-up imposition). */
export async function bookletOrder(file: File): Promise<OutFile> {
  const src = await loadDoc(file);
  const total = src.getPageCount();
  if (total < 2) throw new Error("Need at least 2 pages for a booklet.");
  // Pad page count to multiple of 4 with blank pages, then impose.
  const padded = total + ((4 - (total % 4)) % 4);
  const order: number[] = [];
  let left = 0;
  let right = padded - 1;
  while (left < right) {
    order.push(right, left, left + 1, right - 1);
    left += 2;
    right -= 2;
  }
  const out = await PDFDocument.create();
  // Build the padded source (real pages then blanks at the end).
  const padDoc = await PDFDocument.create();
  const firstSize = src.getPage(0);
  const pw = firstSize.getWidth();
  const ph = firstSize.getHeight();
  const realCopied = await padDoc.copyPages(src, src.getPageIndices());
  realCopied.forEach((p) => padDoc.addPage(p));
  for (let i = total; i < padded; i++) padDoc.addPage([pw, ph]);
  // 2-up onto landscape sheets following the imposition order.
  const sw = ph; // landscape
  const sh = pw;
  for (let i = 0; i < order.length; i += 2) {
    const pages = order.slice(i, i + 2).map((idx) => padDoc.getPage(idx));
    const embedded = await out.embedPages(pages);
    const sheet = out.addPage([sw * 1, sh * 1]);
    // pdf-lib swap not needed: use real values
    embedded.forEach((emb, k) => {
      const scale = Math.min((sw / 2) / emb.width, sh / emb.height) * 0.96;
      const drawW = emb.width * scale;
      const drawH = emb.height * scale;
      const x = k * (sw / 2) + (sw / 2 - drawW) / 2;
      const y = (sh - drawH) / 2;
      sheet.drawPage(emb, { x, y, xScale: scale, yScale: scale });
    });
  }
  return {
    name: `${base(file.name)}-booklet.pdf`,
    bytes: await out.save(),
  };
}

/** Split each page into N×N tiles for poster printing. */
export async function posterizePdf(
  file: File,
  tiles: 2 | 3 | 4 = 2
): Promise<OutFile> {
  const src = await loadDoc(file);
  const out = await PDFDocument.create();
  const embedded = await out.embedPages(src.getPages());
  for (const emb of embedded) {
    const w = emb.width;
    const h = emb.height;
    const tw = w / tiles;
    const th = h / tiles;
    for (let r = tiles - 1; r >= 0; r--) {
      for (let c = 0; c < tiles; c++) {
        const tile = out.addPage([tw, th]);
        tile.drawPage(emb, { x: -c * tw, y: -r * th });
      }
    }
  }
  return {
    name: `${base(file.name)}-poster.pdf`,
    bytes: await out.save(),
  };
}

/** Page dimensions report (.txt). */
export async function pageDimensionsText(file: File): Promise<OutFile> {
  const doc = await loadDoc(file);
  const lines: string[] = [`File: ${file.name}`, ""];
  doc.getPages().forEach((p, i) => {
    lines.push(
      `Page ${i + 1}: ${Math.round(p.getWidth())} × ${Math.round(
        p.getHeight()
      )} pt`
    );
  });
  return {
    name: `${base(file.name)}-pages.txt`,
    bytes: new TextEncoder().encode(lines.join("\n")),
  };
}

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
