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
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
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
