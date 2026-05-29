// Fully local PDF toolkit — runs entirely in the Tauri webview.
// No network, no external service. pdf-lib (MIT) + pdfjs-dist (Apache-2.0).
import {
  PDFDocument,
  degrees,
  rgb,
  StandardFonts,
  PDFName,
  PDFDict,
  PDFArray,
  PDFHexString,
  PDFString,
  PDFNumber,
  PDFRef,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFRadioGroup,
  PDFOptionList,
} from "pdf-lib";
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

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

/** Parse "#rrggbb" (or "rrggbb") to a pdf-lib rgb colour; fallback on bad input. */
function hexRgb(
  hex: string | undefined,
  fallback: [number, number, number] = [0.6, 0.6, 0.6]
) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((hex ?? "").trim());
  if (!m) return rgb(fallback[0], fallback[1], fallback[2]);
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export type Anchor =
  | "tl" | "tc" | "tr"
  | "ml" | "mc" | "mr"
  | "bl" | "bc" | "br";

/** Bottom-left (x,y) for a `tw`×`th` box anchored on a `w`×`h` page. */
function anchorXY(
  w: number,
  h: number,
  tw: number,
  th: number,
  anchor: Anchor,
  margin = 24
): { x: number; y: number } {
  const v = anchor[0];
  const hh = anchor[1];
  const x =
    hh === "l" ? margin : hh === "r" ? w - tw - margin : (w - tw) / 2;
  const y =
    v === "b" ? margin : v === "t" ? h - th - margin : (h - th) / 2;
  return { x, y };
}

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

export type PageNumFormat = "n" | "n-of-N" | "page-n" | "page-n-of-N";
export interface PageNumberOpts {
  format?: PageNumFormat;
  position?: Anchor;
  start?: number;
  size?: number;
  color?: string;
}
export async function addPageNumbers(
  file: File,
  opts: PageNumberOpts = {}
): Promise<OutFile> {
  const doc = await loadDoc(file);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const total = doc.getPageCount();
  const fmt = opts.format ?? "n-of-N";
  const pos = opts.position ?? "bc";
  const start = Number.isFinite(opts.start) ? (opts.start as number) : 1;
  const size = opts.size && opts.size > 0 ? opts.size : 10;
  const color = hexRgb(opts.color, [0.35, 0.35, 0.35]);
  doc.getPages().forEach((p, i) => {
    const { width, height } = p.getSize();
    const n = start + i;
    const N = start + total - 1;
    const label =
      fmt === "n" ? `${n}` :
      fmt === "page-n" ? `Page ${n}` :
      fmt === "page-n-of-N" ? `Page ${n} of ${N}` :
      `${n} / ${N}`;
    const tw = font.widthOfTextAtSize(label, size);
    const { x, y } = anchorXY(width, height, tw, size, pos, 22);
    p.drawText(label, { x, y, size, font, color });
  });
  return { name: `${base(file.name)}-numbered.pdf`, bytes: await doc.save() };
}

export type WatermarkLayout = "diagonal" | "horizontal" | "tile";
export interface WatermarkOpts {
  text?: string;
  opacity?: number; // 0..1
  size?: number; // font size; 0/undefined = auto
  color?: string; // hex
  layout?: WatermarkLayout;
}
export async function addWatermark(
  file: File,
  opts: WatermarkOpts = {}
): Promise<OutFile> {
  const doc = await loadDoc(file);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const label = ascii(opts.text || "DRAFT").slice(0, 40);
  const layout = opts.layout ?? "diagonal";
  const opacity = clamp(opts.opacity ?? 0.18, 0.02, 1);
  const color = hexRgb(opts.color, [0.6, 0.6, 0.6]);
  const angle = layout === "diagonal" ? 45 : 0;
  doc.getPages().forEach((p) => {
    const { width, height } = p.getSize();
    const diag = Math.hypot(width, height);
    let size = opts.size && opts.size > 0 ? opts.size : 56;
    if (!(opts.size && opts.size > 0)) {
      const fit = layout === "tile" ? width * 0.4 : diag * 0.7;
      while (size > 10 && font.widthOfTextAtSize(label, size) > fit) size -= 4;
    }
    const tw = font.widthOfTextAtSize(label, size);
    if (layout === "tile") {
      const stepX = tw + size * 3;
      const stepY = size * 4;
      for (let y = size; y < height; y += stepY) {
        for (let x = 0; x < width; x += stepX) {
          p.drawText(label, {
            x,
            y,
            size,
            font,
            color,
            rotate: degrees(30),
            opacity,
          });
        }
      }
      return;
    }
    const rad = (angle * Math.PI) / 180;
    p.drawText(label, {
      x: width / 2 - (tw / 2) * Math.cos(rad),
      y: height / 2 - (tw / 2) * Math.sin(rad),
      size,
      font,
      color,
      rotate: degrees(angle),
      opacity,
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
  zip: "application/zip",
  bmp: "image/bmp",
  gif: "image/gif",
  tiff: "image/tiff",
  tif: "image/tiff",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
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
export interface StampOpts {
  position?: Anchor; // "mc" = diagonal centre (default), else upright corner
  opacity?: number;
}
/** Coloured stamp ("APPROVED", "REJECTED", etc.) on every page. */
export async function addStamp(
  file: File,
  kind: StampKind,
  opts: StampOpts = {}
): Promise<OutFile> {
  const doc = await loadDoc(file);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const label = kind.toUpperCase();
  const [r, g, b] = STAMP_COLOR[kind] ?? [0.5, 0.5, 0.5];
  const pos = opts.position ?? "mc";
  const opacity = clamp(opts.opacity ?? 0.45, 0.05, 1);
  const diagonal = pos === "mc";
  doc.getPages().forEach((p) => {
    const w = p.getWidth();
    const h = p.getHeight();
    const diag = Math.hypot(w, h);
    let size = diagonal ? 80 : 36;
    const fit = diagonal ? diag * 0.6 : w * 0.4;
    while (size > 14 && font.widthOfTextAtSize(label, size) > fit) size -= 4;
    const tw = font.widthOfTextAtSize(label, size);
    if (diagonal) {
      const rad = (30 * Math.PI) / 180;
      p.drawText(label, {
        x: w / 2 - (tw / 2) * Math.cos(rad),
        y: h / 2 - (tw / 2) * Math.sin(rad),
        size,
        font,
        color: rgb(r, g, b),
        rotate: degrees(30),
        opacity,
      });
    } else {
      const { x, y } = anchorXY(w, h, tw, size, pos, 28);
      p.drawText(label, { x, y, size, font, color: rgb(r, g, b), opacity });
    }
  });
  return {
    name: `${base(file.name)}-${kind}.pdf`,
    bytes: await doc.save(),
  };
}

/** Embed a signature image (PNG/JPG data URL) at bottom-right of last page. */
/** Place a signature image at a precise position (PDF points; origin
 *  bottom-left) on a specific page. `widthPt` controls the rendered width;
 *  height keeps the image's aspect ratio. */
export async function signPdfAt(
  file: File,
  signatureDataUrl: string,
  pageIndex: number,
  xPt: number,
  yPt: number,
  widthPt: number
): Promise<OutFile> {
  if (!signatureDataUrl) throw new Error("Provide a signature image.");
  const doc = await loadDoc(file);
  const pages = doc.getPages();
  if (pageIndex < 0 || pageIndex >= pages.length)
    throw new Error("Page out of range.");
  const isPng = signatureDataUrl.startsWith("data:image/png");
  const b64 = signatureDataUrl.split(",")[1] ?? "";
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const img = isPng ? await doc.embedPng(raw) : await doc.embedJpg(raw);
  const target = pages[pageIndex];
  const w = Math.max(20, widthPt);
  const h = (w / img.width) * img.height;
  target.drawImage(img, { x: xPt, y: yPt, width: w, height: h });
  return {
    name: `${base(file.name)}-signed.pdf`,
    bytes: await doc.save(),
  };
}

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

/* ───────────────────────── New high-value tools ───────────────────────── */

export type ImgWmLayout = "center" | "tile" | "corner";
export interface ImageWatermarkOpts {
  opacity?: number; // 0..1
  scale?: number; // fraction of page width for one stamp (0.05..1)
  layout?: ImgWmLayout;
  position?: Anchor; // used when layout === "corner"
}
/** Stamp an uploaded image (logo / signature / watermark) onto every page. */
export async function addImageWatermark(
  file: File,
  imageDataUrl: string,
  opts: ImageWatermarkOpts = {}
): Promise<OutFile> {
  if (!imageDataUrl) throw new Error("Upload a watermark image first.");
  const doc = await loadDoc(file);
  const isPng = imageDataUrl.startsWith("data:image/png");
  const b64 = imageDataUrl.split(",")[1] ?? "";
  if (!b64) throw new Error("That image could not be read.");
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const img = isPng ? await doc.embedPng(raw) : await doc.embedJpg(raw);
  const opacity = clamp(opts.opacity ?? 0.25, 0.02, 1);
  const scale = clamp(opts.scale ?? 0.4, 0.05, 1);
  const layout = opts.layout ?? "center";
  doc.getPages().forEach((p) => {
    const w = p.getWidth();
    const h = p.getHeight();
    const dw = w * scale;
    const dh = (dw / img.width) * img.height;
    if (layout === "tile") {
      const stepX = dw * 1.5;
      const stepY = dh * 1.8;
      for (let y = 0; y < h; y += stepY)
        for (let x = 0; x < w; x += stepX)
          p.drawImage(img, { x, y, width: dw, height: dh, opacity });
      return;
    }
    const { x, y } =
      layout === "corner"
        ? anchorXY(w, h, dw, dh, opts.position ?? "br", 28)
        : { x: (w - dw) / 2, y: (h - dh) / 2 };
    p.drawImage(img, { x, y, width: dw, height: dh, opacity });
  });
  return { name: `${base(file.name)}-stamped.pdf`, bytes: await doc.save() };
}

export interface PlaceStampOpts {
  /** Left edge of the stamp as a fraction of page width (top-left origin). */
  xFrac: number;
  /** Top edge of the stamp as a fraction of page height (top-left origin). */
  yFrac: number;
  /** Stamp width as a fraction of page width; height follows image aspect. */
  wFrac: number;
  opacity: number;
  /** Page to stamp (0-based). Omit to stamp every page. */
  pageIndex?: number;
}
/** Place an uploaded stamp/signature at an exact position chosen in the UI. */
export async function placeStamp(
  file: File,
  imageDataUrl: string,
  opts: PlaceStampOpts
): Promise<OutFile> {
  if (!imageDataUrl) throw new Error("Upload a stamp image first.");
  const b64 = imageDataUrl.split(",")[1] ?? "";
  if (!b64) throw new Error("That image could not be read.");
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const doc = await loadDoc(file);
  const img = imageDataUrl.startsWith("data:image/png")
    ? await doc.embedPng(raw)
    : await doc.embedJpg(raw);
  const opacity = clamp(opts.opacity ?? 1, 0.02, 1);
  const wFrac = clamp(opts.wFrac ?? 0.3, 0.02, 1);
  const pages = doc.getPages();
  const targets =
    opts.pageIndex == null
      ? pages.map((_, i) => i)
      : [Math.min(Math.max(0, opts.pageIndex), pages.length - 1)];
  for (const i of targets) {
    const p = pages[i];
    const w = p.getWidth();
    const h = p.getHeight();
    const dw = w * wFrac;
    const dh = (dw / img.width) * img.height;
    const x = w * clamp(opts.xFrac ?? 0, 0, 1);
    const y = h - h * clamp(opts.yFrac ?? 0, 0, 1) - dh; // top-left → bottom-left
    p.drawImage(img, { x, y, width: dw, height: dh, opacity });
  }
  return { name: `${base(file.name)}-stamped.pdf`, bytes: await doc.save() };
}

/** Rebuild a PDF in an arbitrary page order, e.g. "3,1,2,5-7". */
export async function reorderPages(
  file: File,
  order: string
): Promise<OutFile> {
  const src = await loadDoc(file);
  const idx = parseRanges(order, src.getPageCount());
  if (!idx.length)
    throw new Error('Enter a page order, e.g. "3,1,2" or "1,4-2".');
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, idx);
  pages.forEach((p) => out.addPage(p));
  return { name: `${base(file.name)}-reordered.pdf`, bytes: await out.save() };
}

/** Split a PDF at 1-based page boundaries, e.g. "4,8" → [1-3][4-7][8-end]. */
export async function splitAtPages(
  file: File,
  points: string
): Promise<OutFile[]> {
  const src = await loadDoc(file);
  const total = src.getPageCount();
  const cuts = Array.from(
    new Set(
      (points || "")
        .split(/[,\s]+/)
        .map((s) => parseInt(s, 10))
        .filter((n) => Number.isFinite(n) && n > 1 && n <= total)
    )
  ).sort((a, b) => a - b);
  if (!cuts.length)
    throw new Error('Enter split points, e.g. "4, 8" (1-based page numbers).');
  const bounds = [1, ...cuts, total + 1];
  const out: OutFile[] = [];
  for (let s = 0; s < bounds.length - 1; s++) {
    const from = bounds[s];
    const to = bounds[s + 1] - 1;
    const idx: number[] = [];
    for (let i = from; i <= to; i++) idx.push(i - 1);
    const doc = await PDFDocument.create();
    const pages = await doc.copyPages(src, idx);
    pages.forEach((p) => doc.addPage(p));
    out.push({
      name: `${base(file.name)}-part${s + 1}.pdf`,
      bytes: await doc.save(),
    });
  }
  return out;
}

async function extractText(file: File): Promise<string[]> {
  const data = new Uint8Array(await readBuf(file));
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const tc = await page.getTextContent();
    pages.push(
      tc.items
        .map((it) => {
          const t = it as { str?: string; hasEOL?: boolean };
          return (t.str ?? "") + (t.hasEOL ? "\n" : " ");
        })
        .join("")
        .replace(/[ \t]+/g, " ")
    );
  }
  return pages;
}

/** Line-level diff (longest-common-subsequence) of two PDFs' text → .txt report. */
export async function comparePdfsText(files: File[]): Promise<OutFile> {
  if (files.length < 2)
    throw new Error("Select two PDFs to compare (oldest first).");
  const [aPages, bPages] = await Promise.all([
    extractText(files[0]).then((p) => p.join("\n").split("\n")),
    extractText(files[1]).then((p) => p.join("\n").split("\n")),
  ]);
  const a = aPages.map((l) => l.trim());
  const b = bPages.map((l) => l.trim());
  // LCS table
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  );
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const lines: string[] = [];
  let i = 0;
  let j = 0;
  let adds = 0;
  let dels = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      if (a[i]) {
        lines.push(`- ${a[i]}`);
        dels++;
      }
      i++;
    } else {
      if (b[j]) {
        lines.push(`+ ${b[j]}`);
        adds++;
      }
      j++;
    }
  }
  for (; i < m; i++) if (a[i]) { lines.push(`- ${a[i]}`); dels++; }
  for (; j < n; j++) if (b[j]) { lines.push(`+ ${b[j]}`); adds++; }
  const header = [
    `Compared: ${files[0].name}  →  ${files[1].name}`,
    `Removed lines: ${dels}   Added lines: ${adds}`,
    dels + adds === 0 ? "No textual differences found." : "",
    "─".repeat(48),
    "",
  ].filter(Boolean);
  return {
    name: `compare-${base(files[0].name)}.txt`,
    bytes: new TextEncoder().encode(header.concat(lines).join("\n") + "\n"),
  };
}

/** Extract embedded raster images from every page as PNG files. */
export async function extractImages(file: File): Promise<OutFile[]> {
  const data = new Uint8Array(await readBuf(file));
  const pdf = await pdfjs.getDocument({ data }).promise;
  const { OPS } = pdfjs;
  const out: OutFile[] = [];
  const seen = new Set<string>();
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const ops = await page.getOperatorList();
    for (let k = 0; k < ops.fnArray.length; k++) {
      const fn = ops.fnArray[k];
      if (fn !== OPS.paintImageXObject && fn !== OPS.paintImageXObjectRepeat)
        continue;
      const name = ops.argsArray[k]?.[0];
      if (typeof name !== "string" || seen.has(`${n}:${name}`)) continue;
      seen.add(`${n}:${name}`);
      try {
        const obj: any = await new Promise((res) => {
          try {
            page.objs.get(name, res);
          } catch {
            res(null);
          }
        });
        if (!obj) continue;
        const iw = obj.width;
        const ih = obj.height;
        if (!iw || !ih) continue;
        const canvas = document.createElement("canvas");
        canvas.width = iw;
        canvas.height = ih;
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        if (obj.bitmap) {
          ctx.drawImage(obj.bitmap, 0, 0);
        } else if (obj.data) {
          const src: Uint8ClampedArray = obj.data;
          const rgba = new Uint8ClampedArray(iw * ih * 4);
          const channels = src.length / (iw * ih);
          if (channels === 4) {
            rgba.set(src);
          } else if (channels === 3) {
            for (let s = 0, d = 0; s < src.length; s += 3, d += 4) {
              rgba[d] = src[s];
              rgba[d + 1] = src[s + 1];
              rgba[d + 2] = src[s + 2];
              rgba[d + 3] = 255;
            }
          } else if (channels === 1) {
            for (let s = 0, d = 0; s < src.length; s += 1, d += 4) {
              rgba[d] = rgba[d + 1] = rgba[d + 2] = src[s];
              rgba[d + 3] = 255;
            }
          } else continue;
          ctx.putImageData(new ImageData(rgba, iw, ih), 0, 0);
        } else continue;
        const blob: Blob | null = await new Promise((res) =>
          canvas.toBlob((b) => res(b), "image/png")
        );
        if (!blob) continue;
        out.push({
          name: `${base(file.name)}-img${out.length + 1}.png`,
          bytes: new Uint8Array(await blob.arrayBuffer()),
        });
      } catch {
        /* skip images that can't be decoded */
      }
    }
  }
  if (!out.length)
    throw new Error("No extractable raster images found in this PDF.");
  return out;
}

/* ───────────────────── PDFCraft-parity tools (local) ──────────────────── */

/** Rotate every (or selected) page by an arbitrary angle, resizing the page
 *  to fit the rotated content. */
export async function rotateCustom(
  file: File,
  deg: number,
  ranges?: string
): Promise<OutFile> {
  const src = await loadDoc(file);
  const target = ranges
    ? new Set(parseRanges(ranges, src.getPageCount()))
    : null;
  const out = await PDFDocument.create();
  const embedded = await out.embedPages(src.getPages());
  const theta = ((deg % 360) + 360) % 360;
  const rad = (theta * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  embedded.forEach((emb, i) => {
    const w = emb.width;
    const h = emb.height;
    if (target && !target.has(i)) {
      const p = out.addPage([w, h]);
      p.drawPage(emb, { x: 0, y: 0 });
      return;
    }
    const W = Math.abs(w * cos) + Math.abs(h * sin);
    const H = Math.abs(w * sin) + Math.abs(h * cos);
    const page = out.addPage([W, H]);
    // Map source centre (w/2,h/2) → new centre (W/2,H/2) after rotation.
    const cx = w / 2;
    const cy = h / 2;
    const x = W / 2 - (cos * cx - sin * cy);
    const y = H / 2 - (sin * cx + cos * cy);
    page.drawPage(emb, { x, y, rotate: degrees(theta) });
  });
  return { name: `${base(file.name)}-rotated.pdf`, bytes: await out.save() };
}

/** Embed extra files as PDF attachments. files[0] = PDF, rest = attachments. */
export async function addAttachments(files: File[]): Promise<OutFile> {
  if (files.length < 2)
    throw new Error("Upload the PDF first, then one or more files to attach.");
  const [pdfFile, ...rest] = files;
  const doc = await loadDoc(pdfFile);
  for (const f of rest) {
    const bytes = new Uint8Array(await readBuf(f));
    await doc.attach(bytes, f.name, {
      mimeType: f.type || "application/octet-stream",
      creationDate: new Date(),
      modificationDate: new Date(),
    });
  }
  return {
    name: `${base(pdfFile.name)}-attached.pdf`,
    bytes: await doc.save(),
  };
}

/** Pull every embedded file out of a PDF. */
export async function extractAttachments(file: File): Promise<OutFile[]> {
  const data = new Uint8Array(await readBuf(file));
  const pdf = await pdfjs.getDocument({ data }).promise;
  const att = (await pdf.getAttachments()) as Record<
    string,
    { filename: string; content: Uint8Array }
  > | null;
  if (!att) throw new Error("This PDF has no embedded attachments.");
  const out: OutFile[] = [];
  for (const key of Object.keys(att)) {
    const a = att[key];
    if (a?.content)
      out.push({ name: a.filename || key, bytes: new Uint8Array(a.content) });
  }
  if (!out.length) throw new Error("This PDF has no embedded attachments.");
  return out;
}

/** Lay source pages onto sheets in a cols×rows grid (configurable N-up). */
export async function gridCombine(
  file: File,
  cols: number,
  rows: number
): Promise<OutFile> {
  const c = clamp(Math.floor(cols), 1, 6);
  const r = clamp(Math.floor(rows), 1, 6);
  const per = c * r;
  const src = await loadDoc(file);
  const out = await PDFDocument.create();
  const total = src.getPageCount();
  const sw = 841.89; // A4 landscape
  const sh = 595.28;
  const cellW = sw / c;
  const cellH = sh / r;
  for (let i = 0; i < total; i += per) {
    const slice = src.getPageIndices().slice(i, i + per);
    const embedded = await out.embedPages(slice.map((j) => src.getPage(j)));
    const sheet = out.addPage([sw, sh]);
    embedded.forEach((emb, k) => {
      const col = k % c;
      const row = Math.floor(k / c);
      const scale = Math.min(cellW / emb.width, cellH / emb.height) * 0.95;
      const dw = emb.width * scale;
      const dh = emb.height * scale;
      const x = col * cellW + (cellW - dw) / 2;
      const y = sh - (row + 1) * cellH + (cellH - dh) / 2;
      sheet.drawPage(emb, { x, y, xScale: scale, yScale: scale });
    });
  }
  return { name: `${base(file.name)}-grid.pdf`, bytes: await out.save() };
}

/** Paint a solid background colour behind every page's content. */
export async function backgroundColor(
  file: File,
  hex: string
): Promise<OutFile> {
  const src = await loadDoc(file);
  const out = await PDFDocument.create();
  const color = hexRgb(hex, [1, 1, 1]);
  const embedded = await out.embedPages(src.getPages());
  embedded.forEach((emb) => {
    const w = emb.width;
    const h = emb.height;
    const page = out.addPage([w, h]);
    page.drawRectangle({ x: 0, y: 0, width: w, height: h, color });
    page.drawPage(emb, { x: 0, y: 0 });
  });
  return { name: `${base(file.name)}-bg.pdf`, bytes: await out.save() };
}

/** Decode any browser-renderable image (PNG/JPG/WebP/BMP/GIF) and build a PDF. */
export async function imagesToPdfAny(files: File[]): Promise<OutFile> {
  if (!files.length) throw new Error("No images provided.");
  const doc = await PDFDocument.create();
  for (const f of files) {
    const url = URL.createObjectURL(f);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error(`Could not read ${f.name}.`));
        im.src = url;
      });
      const w = img.naturalWidth || 1;
      const h = img.naturalHeight || 1;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas is not available.");
      ctx.drawImage(img, 0, 0);
      const blob: Blob = await new Promise((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error("Encode failed."))), "image/png")
      );
      const embedded = await doc.embedPng(await blob.arrayBuffer());
      const page = doc.addPage([w, h]);
      page.drawImage(embedded, { x: 0, y: 0, width: w, height: h });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return { name: "images.pdf", bytes: await doc.save() };
}

/** Heuristic table reconstruction: cluster text by Y (rows) then X (columns). */
async function pdfTables(
  file: File
): Promise<{ page: number; rows: string[][] }[]> {
  const data = new Uint8Array(await readBuf(file));
  const pdf = await pdfjs.getDocument({ data }).promise;
  const result: { page: number; rows: string[][] }[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const tc = await page.getTextContent();
    type Item = { x: number; y: number; s: string };
    const items: Item[] = tc.items
      .map((it) => {
        const t = it as { str?: string; transform?: number[] };
        return {
          x: t.transform?.[4] ?? 0,
          y: Math.round(t.transform?.[5] ?? 0),
          s: (t.str ?? "").trim(),
        };
      })
      .filter((i) => i.s.length);
    if (!items.length) continue;
    const rowsMap = new Map<number, Item[]>();
    for (const it of items) {
      let key = it.y;
      for (const k of rowsMap.keys())
        if (Math.abs(k - it.y) <= 3) {
          key = k;
          break;
        }
      (rowsMap.get(key) ?? rowsMap.set(key, []).get(key)!).push(it);
    }
    const ordered = [...rowsMap.entries()].sort((a, b) => b[0] - a[0]);
    const rows: string[][] = [];
    for (const [, cells] of ordered) {
      cells.sort((a, b) => a.x - b.x);
      const cols: string[] = [];
      let cur = "";
      let lastX = -Infinity;
      for (const cell of cells) {
        if (cell.x - lastX > 24 && cur) {
          cols.push(cur.trim());
          cur = "";
        }
        cur += (cur ? " " : "") + cell.s;
        lastX = cell.x;
      }
      if (cur) cols.push(cur.trim());
      rows.push(cols);
    }
    result.push({ page: n, rows });
  }
  return result;
}

/** Heuristic table extraction → CSV. */
export async function extractTablesCsv(file: File): Promise<OutFile> {
  const tables = await pdfTables(file);
  if (!tables.length) throw new Error("No extractable text/tables found.");
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines: string[] = [];
  tables.forEach((t, i) => {
    for (const row of t.rows) lines.push(row.map(esc).join(","));
    if (i < tables.length - 1) lines.push("");
  });
  return {
    name: `${base(file.name)}-tables.csv`,
    bytes: new TextEncoder().encode(lines.join("\n") + "\n"),
  };
}

/** Repair: reload tolerantly and re-save a clean PDF structure. */
export async function repairPdf(file: File): Promise<OutFile> {
  const doc = await PDFDocument.load(await readBuf(file), {
    ignoreEncryption: true,
    throwOnInvalidObject: false,
    updateMetadata: false,
  });
  return {
    name: `${base(file.name)}-repaired.pdf`,
    bytes: await doc.save({ useObjectStreams: false }),
  };
}

/** Remove owner/permission restrictions by re-saving without encryption. */
export async function removeRestrictions(file: File): Promise<OutFile> {
  const doc = await PDFDocument.load(await readBuf(file), {
    ignoreEncryption: true,
  });
  return {
    name: `${base(file.name)}-unrestricted.pdf`,
    bytes: await doc.save(),
  };
}

/** Rasterize: render every page to an image at the chosen DPI and rebuild. */
export async function rasterizePdf(file: File, scale = 2): Promise<OutFile> {
  const out = await flattenPdf(file, scale, false);
  return { name: `${base(file.name)}-rasterized.pdf`, bytes: out.bytes };
}

/* ── Minimal store-only ZIP writer (no deps) ────────────────────────────── */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipStore(entries: { name: string; bytes: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (n: number) => new Uint8Array([n & 255, (n >> 8) & 255]);
  const u32 = (n: number) =>
    new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]);
  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const crc = crc32(e.bytes);
    const size = e.bytes.length;
    const local = concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0),
      nameBytes, e.bytes,
    ]);
    chunks.push(local);
    central.push(
      concat([
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(size), u32(size), u16(nameBytes.length),
        u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes,
      ])
    );
    offset += local.length;
  }
  const cd = concat(central);
  const end = concat([
    u32(0x06054b50), u16(0), u16(0),
    u16(entries.length), u16(entries.length),
    u32(cd.length), u32(offset), u16(0),
  ]);
  return concat([...chunks, cd, end]);
}
function concat(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Render every page to an image and bundle them into a single .zip. */
export async function pdfToZip(
  file: File,
  format: "png" | "jpeg" = "png"
): Promise<OutFile> {
  const images = await pdfToImageFormat(file, format);
  const zip = zipStore(images.map((i) => ({ name: i.name, bytes: i.bytes })));
  return { name: `${base(file.name)}.zip`, bytes: zip };
}

/* ───────────────── Security: encrypt / decrypt / permissions ──────────── */

export interface EncryptOpts {
  userPassword?: string;
  ownerPassword?: string;
  printing?: boolean;
  copying?: boolean;
  modifying?: boolean;
  annotating?: boolean;
}
/** Password-protect a PDF (AES) with optional permission restrictions. */
export async function encryptPdf(
  file: File,
  opts: EncryptOpts
): Promise<OutFile> {
  if (!opts.userPassword && !opts.ownerPassword)
    throw new Error("Enter at least one password.");
  const { PDFDocument: CPDF } = await import("@cantoo/pdf-lib");
  const doc = await CPDF.load(await readBuf(file), { ignoreEncryption: true });
  doc.encrypt({
    userPassword: opts.userPassword || undefined,
    ownerPassword:
      opts.ownerPassword || opts.userPassword || undefined,
    permissions: {
      printing: opts.printing === false ? undefined : "highResolution",
      copying: opts.copying !== false,
      modifying: opts.modifying !== false,
      annotating: opts.annotating !== false,
    },
  });
  return { name: `${base(file.name)}-encrypted.pdf`, bytes: await doc.save() };
}

/** Decrypt a password-protected PDF — supply the password, get an open copy. */
export async function decryptPdf(
  file: File,
  password: string
): Promise<OutFile> {
  const data = new Uint8Array(await readBuf(file));
  let pdf;
  try {
    pdf = await pdfjs.getDocument({ data, password }).promise;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      /password/i.test(msg) ? "Wrong or missing password." : msg
    );
  }
  const out = await PDFDocument.create();
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const base1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = vp.width;
    canvas.height = vp.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
    const blob: Blob = await new Promise((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error("Render failed."))), "image/png")
    );
    const png = await out.embedPng(await blob.arrayBuffer());
    const p = out.addPage([base1.width, base1.height]);
    p.drawImage(png, { x: 0, y: 0, width: base1.width, height: base1.height });
  }
  return { name: `${base(file.name)}-decrypted.pdf`, bytes: await out.save() };
}

/* ───────────────────────────── OCR (tesseract.js) ─────────────────────── */

interface OcrWord {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

/** Flatten tesseract.js v5 block→paragraph→line→word tree into a word list. */
function flattenOcrWords(res: any): OcrWord[] {
  const out: OcrWord[] = [];
  for (const b of res?.blocks ?? [])
    for (const par of b?.paragraphs ?? [])
      for (const ln of par?.lines ?? [])
        for (const w of ln?.words ?? [])
          if (w?.text && w.bbox) out.push({ text: w.text, bbox: w.bbox });
  if (!out.length)
    for (const w of res?.words ?? [])
      if (w?.text && w.bbox) out.push({ text: w.text, bbox: w.bbox });
  return out;
}

/** Render every page, OCR it, and return text + word boxes per page. */
async function ocrPages(
  file: File,
  scale: number,
  onProgress?: (page: number, total: number) => void
): Promise<{ width: number; height: number; words: OcrWord[]; text: string }[]> {
  const { createWorker } = await import("tesseract.js");
  const data = new Uint8Array(await readBuf(file));
  const pdf = await pdfjs.getDocument({ data }).promise;
  const worker = await createWorker("eng");
  const pages: { width: number; height: number; words: OcrWord[]; text: string }[] = [];
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      onProgress?.(n, pdf.numPages);
      const page = await pdf.getPage(n);
      const base1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = vp.width;
      canvas.height = vp.height;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
      const { data: res } = await worker.recognize(canvas, {}, { blocks: true });
      pages.push({
        width: base1.width,
        height: base1.height,
        words: flattenOcrWords(res),
        text: res.text,
      });
    }
  } finally {
    await worker.terminate();
  }
  return pages;
}

/** OCR a scanned PDF and return the recognised plain text. */
export async function ocrToText(file: File): Promise<OutFile> {
  const pages = await ocrPages(file, 2);
  const text = pages.map((p) => p.text.trim()).join("\n\n");
  return {
    name: `${base(file.name)}-ocr.txt`,
    bytes: new TextEncoder().encode(text + "\n"),
  };
}

/** OCR a scanned PDF into a searchable PDF — page image with an invisible
 *  selectable text layer positioned over each recognised word. */
export async function ocrSearchablePdf(file: File): Promise<OutFile> {
  const scale = 2;
  const { createWorker } = await import("tesseract.js");
  const data = new Uint8Array(await readBuf(file));
  const pdf = await pdfjs.getDocument({ data }).promise;
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const worker = await createWorker("eng");
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const base1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = vp.width;
      canvas.height = vp.height;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
      const blob: Blob = await new Promise((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error("Render failed."))), "image/png")
      );
      const png = await out.embedPng(await blob.arrayBuffer());
      const pw = base1.width;
      const ph = base1.height;
      const p = out.addPage([pw, ph]);
      p.drawImage(png, { x: 0, y: 0, width: pw, height: ph });
      const { data: res } = await worker.recognize(canvas, {}, { blocks: true });
      const words = flattenOcrWords(res);
      for (const w of words) {
        const txt = ascii(w.text || "").trim();
        if (!txt) continue;
        const x = w.bbox.x0 / scale;
        const h = (w.bbox.y1 - w.bbox.y0) / scale;
        const y = ph - w.bbox.y1 / scale;
        const size = clamp(h, 4, 72);
        p.drawText(txt, { x, y, size, font, opacity: 0 });
      }
    }
  } finally {
    await worker.terminate();
  }
  return { name: `${base(file.name)}-ocr.pdf`, bytes: await out.save() };
}

/* ───────────────────── ZIP reader + base64 helpers ────────────────────── */
async function inflateRaw(comp: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([comp.slice()]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
/** Minimal ZIP extractor (stored + deflate) via the central directory. */
async function unzip(buf: Uint8Array): Promise<{ name: string; bytes: Uint8Array }[]> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eo = -1;
  for (let i = buf.length - 22; i >= 0; i--)
    if (dv.getUint32(i, true) === 0x06054b50) {
      eo = i;
      break;
    }
  if (eo < 0) throw new Error("Not a valid ZIP archive.");
  const count = dv.getUint16(eo + 10, true);
  let off = dv.getUint32(eo + 16, true);
  const dec = new TextDecoder();
  const out: { name: string; bytes: Uint8Array }[] = [];
  for (let e = 0; e < count; e++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const compSize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    const name = dec.decode(buf.subarray(off + 46, off + 46 + nameLen));
    const lNameLen = dv.getUint16(lho + 26, true);
    const lExtraLen = dv.getUint16(lho + 28, true);
    const dataStart = lho + 30 + lNameLen + lExtraLen;
    const comp = buf.subarray(dataStart, dataStart + compSize);
    off += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    try {
      const bytes = method === 0 ? comp : method === 8 ? await inflateRaw(comp) : null;
      if (bytes) out.push({ name, bytes });
    } catch {
      /* skip undecodable entry */
    }
  }
  return out;
}
function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk)
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}
const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/* ─────────────────────────── Office → PDF ─────────────────────────────── */

/** Word (.docx) → PDF via mammoth raw-text extraction (layout is simplified). */
export async function wordToPdf(file: File): Promise<OutFile> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({
    arrayBuffer: await readBuf(file),
  });
  if (!value.trim()) throw new Error("No readable text found in this document.");
  const stub = new File([value], `${nameStem(file.name)}.txt`, { type: "text/plain" });
  return textToPdf(stub);
}

/* SheetJS is loaded from the official CDN rather than npm: the npm `xlsx`
 * package carries a known high-severity prototype-pollution / ReDoS advisory,
 * and SheetJS ships fixes only through their CDN. The module is cached after
 * first load so each tool fetches it at most once. */
const XLSX_CDN_URL = "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";
interface XlsxLib {
  read(data: Uint8Array, opts: { type: string }): {
    SheetNames: string[];
    Sheets: Record<string, unknown>;
  };
  utils: {
    sheet_to_csv(ws: unknown): string;
    book_new(): unknown;
    aoa_to_sheet(rows: unknown[][]): unknown;
    book_append_sheet(wb: unknown, ws: unknown, name: string): void;
  };
  write(wb: unknown, opts: { type: string; bookType: string }): ArrayBuffer;
}
let xlsxPromise: Promise<XlsxLib> | null = null;
function loadXlsx(): Promise<XlsxLib> {
  return (xlsxPromise ??= import(/* @vite-ignore */ XLSX_CDN_URL) as Promise<XlsxLib>);
}

/** Excel (.xlsx/.xls) → PDF table (one section per sheet). */
export async function excelToPdf(file: File): Promise<OutFile> {
  const XLSX = await loadXlsx();
  const wb = XLSX.read(new Uint8Array(await readBuf(file)), { type: "array" });
  let csv = "";
  for (const name of wb.SheetNames)
    csv += `=== ${name} ===\n${XLSX.utils.sheet_to_csv(wb.Sheets[name])}\n\n`;
  if (!csv.trim()) throw new Error("This spreadsheet looks empty.");
  const stub = new File([csv], `${nameStem(file.name)}.csv`, { type: "text/csv" });
  return csvToPdf(stub);
}

/** PowerPoint (.pptx) → PDF (extracts slide text, one section per slide). */
export async function pptToPdf(file: File): Promise<OutFile> {
  const entries = await unzip(new Uint8Array(await readBuf(file)));
  const slides = entries
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.name))
    .sort((a, b) => {
      const na = parseInt(a.name.match(/slide(\d+)/)?.[1] ?? "0", 10);
      const nb = parseInt(b.name.match(/slide(\d+)/)?.[1] ?? "0", 10);
      return na - nb;
    });
  if (!slides.length) throw new Error("No slides found in this presentation.");
  const dec = new TextDecoder();
  let text = "";
  slides.forEach((s, i) => {
    const xml = dec.decode(s.bytes);
    const parts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeXml(m[1]));
    text += `--- Slide ${i + 1} ---\n${parts.join("\n")}\n\n`;
  });
  const stub = new File([text], `${nameStem(file.name)}.txt`, { type: "text/plain" });
  return textToPdf(stub);
}

/* ─────────────────────────── PDF → Office ─────────────────────────────── */

/** PDF → Word (.docx): one paragraph per text line, page breaks between pages. */
export async function pdfToDocx(file: File): Promise<OutFile> {
  const pages = await extractText(file);
  const { Document, Packer, Paragraph } = await import("docx");
  const children: InstanceType<typeof Paragraph>[] = [];
  pages.forEach((pageText, i) => {
    for (const line of pageText.split(/\n+/))
      children.push(new Paragraph(line.trim()));
    if (i < pages.length - 1)
      children.push(new Paragraph({ text: "", pageBreakBefore: true }));
  });
  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  return {
    name: `${base(file.name)}.docx`,
    bytes: new Uint8Array(await blob.arrayBuffer()),
  };
}

/** PDF → Excel (.xlsx): one sheet per page from reconstructed tables. */
export async function pdfToExcel(file: File): Promise<OutFile> {
  const XLSX = await loadXlsx();
  const tables = await pdfTables(file);
  if (!tables.length) throw new Error("No extractable text found.");
  const wb = XLSX.utils.book_new();
  for (const t of tables)
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet(t.rows.length ? t.rows : [[""]]),
      `Page ${t.page}`.slice(0, 31)
    );
  const arr = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return { name: `${base(file.name)}.xlsx`, bytes: new Uint8Array(arr) };
}

/** PDF → PowerPoint (.pptx): one slide per page (rendered image, full-bleed). */
export async function pdfToPptx(file: File): Promise<OutFile> {
  const pptxgen = (await import("pptxgenjs")).default;
  const images = await pdfToImageFormat(file, "png", 2);
  const deck = new pptxgen();
  for (const im of images) {
    const slide = deck.addSlide();
    slide.addImage({
      data: `image/png;base64,${bytesToBase64(im.bytes)}`,
      x: 0,
      y: 0,
      w: "100%",
      h: "100%",
    });
  }
  const arr = (await deck.write({ outputType: "arraybuffer" })) as ArrayBuffer;
  return { name: `${base(file.name)}.pptx`, bytes: new Uint8Array(arr) };
}

/* ──────────────────── Light parsers: CBZ / RTF / TIFF ─────────────────── */

/** Comic-book archive (.cbz / zipped images) → PDF, one image per page. */
export async function cbzToPdf(file: File): Promise<OutFile> {
  const entries = await unzip(new Uint8Array(await readBuf(file)));
  const imgs = entries
    .filter((e) => /\.(png|jpe?g|webp|bmp|gif)$/i.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (!imgs.length) throw new Error("No images found in this archive.");
  const files = imgs.map(
    (e) => new File([e.bytes.slice()], e.name.split("/").pop() || e.name)
  );
  const out = await imagesToPdfAny(files);
  return { name: `${base(file.name)}.pdf`, bytes: out.bytes };
}

/** Strip RTF control words to plain text. */
function rtfToText(rtf: string): string {
  let s = rtf;
  s = s.replace(/\\par[d]?\b/g, "\n").replace(/\\line\b/g, "\n").replace(/\\tab\b/g, "\t");
  s = s.replace(/\\u(-?\d+)\??/g, (_, n) => String.fromCharCode(((+n % 65536) + 65536) % 65536));
  s = s.replace(/\\'[0-9a-fA-F]{2}/g, (m) => String.fromCharCode(parseInt(m.slice(2), 16)));
  s = s.replace(/\\[a-zA-Z]+-?\d* ?/g, "");
  s = s.replace(/[{}]/g, "");
  s = s.replace(/\\([\\{}])/g, "$1");
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

/** Rich Text Format (.rtf) → PDF. */
export async function rtfToPdf(file: File): Promise<OutFile> {
  const text = rtfToText(await file.text());
  if (!text) throw new Error("No readable text found in this RTF file.");
  const stub = new File([text], `${nameStem(file.name)}.txt`, { type: "text/plain" });
  return textToPdf(stub);
}

/** TIFF (single or multi-page) → PDF. */
export async function tiffToPdf(file: File): Promise<OutFile> {
  const UTIF = (await import("utif")).default;
  const buf = new Uint8Array(await readBuf(file));
  const ifds = UTIF.decode(buf);
  if (!ifds.length) throw new Error("Could not read this TIFF file.");
  const doc = await PDFDocument.create();
  for (const ifd of ifds) {
    UTIF.decodeImage(buf, ifd);
    const rgba = UTIF.toRGBA8(ifd);
    const w = ifd.width;
    const h = ifd.height;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available.");
    const clamped = new Uint8ClampedArray(rgba.length);
    clamped.set(rgba);
    ctx.putImageData(new ImageData(clamped, w, h), 0, 0);
    const blob: Blob = await new Promise((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error("Encode failed."))), "image/png")
    );
    const png = await doc.embedPng(await blob.arrayBuffer());
    const page = doc.addPage([w, h]);
    page.drawImage(png, { x: 0, y: 0, width: w, height: h });
  }
  return { name: `${nameStem(file.name)}.pdf`, bytes: await doc.save() };
}

/** PDF → TIFF (one .tiff file per page). */
export async function pdfToTiff(file: File): Promise<OutFile[]> {
  const UTIF = (await import("utif")).default;
  const data = new Uint8Array(await readBuf(file));
  const pdf = await pdfjs.getDocument({ data }).promise;
  const out: OutFile[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = vp.width;
    canvas.height = vp.height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
    const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const tiff = UTIF.encodeImage(id.data.buffer, canvas.width, canvas.height);
    out.push({
      name: `${base(file.name)}-p${n}.tiff`,
      bytes: new Uint8Array(tiff),
    });
  }
  return out;
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

/* ═══════════════════════════ Bookmarks / TOC ═══════════════════════════════
   pdf-lib has no high-level outline API, so we build the /Outlines object tree
   by hand with the low-level context. Indentation in the spec defines nesting;
   `Title | page` sets the 1-based target page (defaults to 1). ─────────────── */

interface OutlineNode {
  title: string;
  page: number; // 0-based, clamped at save time
  children: OutlineNode[];
}

/** Parse an indented `Title | page` outline spec into a nested tree. */
function parseOutlineSpec(spec: string): OutlineNode[] {
  const roots: OutlineNode[] = [];
  // Stack of [indentWidth, node] to resolve nesting by leading whitespace.
  const stack: { indent: number; node: OutlineNode }[] = [];
  for (const raw of spec.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const indent = raw.length - raw.replace(/^[\t ]+/, "").length;
    const body = raw.trim();
    const m = body.match(/^(.*?)(?:\s*\|\s*(\d+))?$/);
    const title = (m?.[1] ?? body).trim();
    if (!title) continue;
    const page = Math.max(0, (parseInt(m?.[2] ?? "1", 10) || 1) - 1);
    const node: OutlineNode = { title, page, children: [] };
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    if (stack.length) stack[stack.length - 1].node.children.push(node);
    else roots.push(node);
    stack.push({ indent, node });
  }
  return roots;
}

/** Apply a bookmark/TOC tree to a PDF, replacing any existing outline. */
export async function setBookmarks(file: File, spec: string): Promise<OutFile> {
  const roots = parseOutlineSpec(spec);
  if (!roots.length)
    throw new Error('No bookmarks parsed. Use lines like "Chapter 1 | 1".');
  const doc = await PDFDocument.load(await readBuf(file), { ignoreEncryption: true });
  const ctx = doc.context;
  const pages = doc.getPages();
  const pageRef = (i: number) => pages[Math.min(Math.max(0, i), pages.length - 1)].ref;
  const pageTop = (i: number) =>
    pages[Math.min(Math.max(0, i), pages.length - 1)].getHeight();

  // Reserve a ref per node so siblings/children can cross-reference.
  type Reserved = { node: OutlineNode; ref: PDFRef; kids: Reserved[] };
  const reserve = (nodes: OutlineNode[]): Reserved[] =>
    nodes.map((node) => ({ node, ref: ctx.nextRef(), kids: reserve(node.children) }));
  const descendants = (nodes: Reserved[]): number =>
    nodes.reduce((c, n) => c + 1 + descendants(n.kids), 0);

  const build = (nodes: Reserved[], parent: PDFRef) => {
    nodes.forEach((n, i) => {
      const dict = ctx.obj({}) as PDFDict;
      dict.set(PDFName.of("Title"), PDFHexString.fromText(n.node.title));
      dict.set(PDFName.of("Parent"), parent);
      if (i > 0) dict.set(PDFName.of("Prev"), nodes[i - 1].ref);
      if (i < nodes.length - 1) dict.set(PDFName.of("Next"), nodes[i + 1].ref);
      dict.set(
        PDFName.of("Dest"),
        ctx.obj([pageRef(n.node.page), PDFName.of("XYZ"), null, pageTop(n.node.page), null])
      );
      if (n.kids.length) {
        dict.set(PDFName.of("First"), n.kids[0].ref);
        dict.set(PDFName.of("Last"), n.kids[n.kids.length - 1].ref);
        // Negative count = collapsed by default.
        dict.set(PDFName.of("Count"), PDFNumber.of(-descendants(n.kids)));
        build(n.kids, n.ref);
      }
      ctx.assign(n.ref, dict);
    });
  };

  const tree = reserve(roots);
  const outlinesRef = ctx.nextRef();
  build(tree, outlinesRef);
  const outlines = ctx.obj({}) as PDFDict;
  outlines.set(PDFName.of("Type"), PDFName.of("Outlines"));
  outlines.set(PDFName.of("First"), tree[0].ref);
  outlines.set(PDFName.of("Last"), tree[tree.length - 1].ref);
  outlines.set(PDFName.of("Count"), PDFNumber.of(descendants(tree)));
  ctx.assign(outlinesRef, outlines);
  doc.catalog.set(PDFName.of("Outlines"), outlinesRef);
  doc.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));

  const bytes = await doc.save();
  return { name: `${base(file.name)}-bookmarked.pdf`, bytes: new Uint8Array(bytes) };
}

/** Extract an existing outline to an indented `Title | page` text file. */
export async function extractBookmarks(file: File): Promise<OutFile> {
  const doc = await PDFDocument.load(await readBuf(file), { ignoreEncryption: true });
  const pages = doc.getPages();
  const refIndex = (ref: PDFRef | undefined) =>
    !ref
      ? -1
      : pages.findIndex(
          (p) =>
            p.ref.objectNumber === ref.objectNumber &&
            p.ref.generationNumber === ref.generationNumber
        );

  const out: string[] = [];
  const walk = (node: PDFDict | undefined, depth: number) => {
    let cur = node?.lookupMaybe(PDFName.of("First"), PDFDict);
    while (cur) {
      const titleObj = cur.lookup(PDFName.of("Title"));
      const title =
        titleObj instanceof PDFHexString || titleObj instanceof PDFString
          ? titleObj.decodeText()
          : "";
      let pageNo = "";
      const dest = cur.lookupMaybe(PDFName.of("Dest"), PDFArray);
      const first = dest?.get(0);
      if (first instanceof PDFRef) {
        const idx = refIndex(first);
        if (idx >= 0) pageNo = String(idx + 1);
      }
      out.push(`${"  ".repeat(depth)}${title}${pageNo ? ` | ${pageNo}` : ""}`);
      walk(cur.lookupMaybe(PDFName.of("First"), PDFDict), depth + 1);
      cur = cur.lookupMaybe(PDFName.of("Next"), PDFDict);
    }
  };
  const root = doc.catalog.lookupMaybe(PDFName.of("Outlines"), PDFDict);
  walk(root, 0);
  const txt = out.length ? out.join("\n") : "(this PDF has no bookmarks)";
  return { name: `${base(file.name)}-bookmarks.txt`, bytes: new TextEncoder().encode(txt) };
}

/* ═══════════════════════════ Forms ═════════════════════════════════════════
   List, fill and flatten AcroForm fields with pdf-lib's form API. ─────────── */

function fieldKind(f: unknown): string {
  if (f instanceof PDFTextField) return "Text";
  if (f instanceof PDFCheckBox) return "CheckBox";
  if (f instanceof PDFDropdown) return "Dropdown";
  if (f instanceof PDFRadioGroup) return "RadioGroup";
  if (f instanceof PDFOptionList) return "OptionList";
  return "Field";
}

/** List every form field as `name <tab> type [<tab> options]` text. */
export async function listFormFields(file: File): Promise<OutFile> {
  const doc = await PDFDocument.load(await readBuf(file), { ignoreEncryption: true });
  const fields = doc.getForm().getFields();
  const lines = fields.map((f) => {
    let extra = "";
    if (f instanceof PDFDropdown || f instanceof PDFOptionList || f instanceof PDFRadioGroup)
      extra = `\t[${f.getOptions().join(", ")}]`;
    return `${f.getName()}\t${fieldKind(f)}${extra}`;
  });
  const txt = lines.length
    ? `# name\ttype\t[options]\n${lines.join("\n")}`
    : "(this PDF has no form fields)";
  return { name: `${base(file.name)}-fields.txt`, bytes: new TextEncoder().encode(txt) };
}

const TRUTHY = new Set(["true", "yes", "on", "1", "checked", "x"]);

/** Fill form fields from a JSON object of `{ "Field Name": value }`. */
export async function fillForm(file: File, dataJson: string): Promise<OutFile> {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(dataJson || "{}");
  } catch {
    throw new Error('Field data must be valid JSON, e.g. {"Name": "Ada", "Agree": true}.');
  }
  const doc = await PDFDocument.load(await readBuf(file), { ignoreEncryption: true });
  const form = doc.getForm();
  let filled = 0;
  for (const [key, value] of Object.entries(data)) {
    let field;
    try {
      field = form.getField(key);
    } catch {
      continue; // unknown field name — skip rather than abort
    }
    const v = String(value);
    if (field instanceof PDFTextField) field.setText(v);
    else if (field instanceof PDFCheckBox)
      TRUTHY.has(v.toLowerCase()) ? field.check() : field.uncheck();
    else if (field instanceof PDFDropdown || field instanceof PDFOptionList) field.select(v);
    else if (field instanceof PDFRadioGroup) field.select(v);
    else continue;
    filled++;
  }
  if (!filled) throw new Error("No matching fields filled. Run “List form fields” first.");
  const bytes = await doc.save();
  return { name: `${base(file.name)}-filled.pdf`, bytes: new Uint8Array(bytes) };
}

/** Flatten form fields into static page content (no longer editable). */
export async function flattenForm(file: File): Promise<OutFile> {
  const doc = await PDFDocument.load(await readBuf(file), { ignoreEncryption: true });
  const form = doc.getForm();
  if (!form.getFields().length) throw new Error("This PDF has no form fields to flatten.");
  form.flatten();
  const bytes = await doc.save();
  return { name: `${base(file.name)}-flattened.pdf`, bytes: new Uint8Array(bytes) };
}
