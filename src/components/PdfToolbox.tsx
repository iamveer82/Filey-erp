import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Combine,
  Scissors,
  Trash2,
  FileOutput,
  RotateCw,
  Image as ImageIcon,
  FileImage,
  Hash,
  Stamp,
  Minimize2,
  Shapes,
  PenTool,
  Gauge,
  FileText,
  Layers,
  Info,
  FileType,
  Table,
  Upload,
  Download,
  Loader2,
  X,
  CheckCircle2,
  ArrowDownUp,
  FilePlus,
  Columns2,
  Braces,
  FileJson,
  Search,
  SplitSquareHorizontal,
  AlignVerticalSpaceBetween,
  Shuffle,
  Crop,
  PanelTopOpen,
  CheckCircle,
  Eraser,
  Grid3X3,
  BookOpen,
  Ruler,
  Maximize,
  Zap,
  Shield,
  Eye,
  Contrast,
  Droplet,
  FileCode2,
  ListOrdered,
  GitCompare,
  Images,
  ImagePlus,
  Split,
  RotateCcw,
  Paperclip,
  FileDown,
  Grid2x2,
  PaintBucket,
  Wrench,
  ScanLine,
  Unlock,
  FileArchive,
  TableProperties,
  Lock,
  KeyRound,
  ShieldCheck,
  ScanText,
  FileType2,
  Presentation,
  Sheet,
  BookText,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as pdf from "../lib/pdfTools";
import type { OutFile } from "../lib/pdfTools";

/* ── Typed option schema ───────────────────────────────────────────────────
   Each tool declares its options as `fields`. A single <ToolFields> renderer
   turns them into proper controls (select / number / colour / slider / image
   upload) everywhere — workspace, modal runner and tool browser. ─────────── */
export type FieldType =
  | "text"
  | "number"
  | "select"
  | "color"
  | "toggle"
  | "range"
  | "image"
  | "password";

export interface FieldSpec {
  key: string;
  label: string;
  type: FieldType;
  default?: string;
  placeholder?: string;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  /** image fields only: accepted file types */
  accept?: string;
}

export type ToolCat =
  | "Organize"
  | "Edit"
  | "To PDF"
  | "From PDF"
  | "Optimize"
  | "Secure"
  | "Data";

export interface Tool {
  id: string;
  name: string;
  desc: string;
  icon: LucideIcon;
  cat: ToolCat;
  multi?: boolean;
  accept: string;
  fields: FieldSpec[];
  run: (files: File[], p: Record<string, string>) => Promise<OutFile[]>;
}

/* Reusable option lists */
const POS_6: FieldSpec["options"] = [
  { value: "bc", label: "Bottom centre" },
  { value: "br", label: "Bottom right" },
  { value: "bl", label: "Bottom left" },
  { value: "tc", label: "Top centre" },
  { value: "tr", label: "Top right" },
  { value: "tl", label: "Top left" },
];
const num = (v: string, d: number) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};
const flt = (v: string, d: number) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
};

export const PDF_TOOLS: Tool[] = [
  {
    id: "merge",
    name: "Merge PDF",
    desc: "Combine multiple PDFs into one document",
    icon: Combine,
    cat: "Organize",
    multi: true,
    accept: "application/pdf",
    fields: [],
    run: async (f) => [await pdf.mergePdfs(f)],
  },
  {
    id: "split",
    name: "Split PDF",
    desc: "Break a PDF into parts of N pages each",
    icon: Scissors,
    cat: "Organize",
    accept: "application/pdf",
    fields: [
      { key: "chunk", label: "Pages per file", type: "number", default: "1", min: 1 },
    ],
    run: (f, p) => pdf.splitEvery(f[0], num(p.chunk, 1)),
  },
  {
    id: "split-at",
    name: "Split at Pages",
    desc: "Cut into sections at chosen page boundaries",
    icon: Split,
    cat: "Organize",
    accept: "application/pdf",
    fields: [
      {
        key: "points",
        label: "Split before pages",
        type: "text",
        placeholder: "e.g. 4, 8, 12",
        hint: "1-based page numbers where each new file starts",
      },
    ],
    run: (f, p) => pdf.splitAtPages(f[0], p.points || ""),
  },
  {
    id: "extract",
    name: "Extract Pages",
    desc: "Pull selected pages into a new PDF",
    icon: FileOutput,
    cat: "Organize",
    accept: "application/pdf",
    fields: [
      { key: "ranges", label: "Pages", type: "text", placeholder: "e.g. 1-3,5,8-" },
    ],
    run: async (f, p) => [await pdf.extractPages(f[0], p.ranges || "")],
  },
  {
    id: "delete",
    name: "Delete Pages",
    desc: "Remove pages by range, e.g. 2-4,7",
    icon: Trash2,
    cat: "Organize",
    accept: "application/pdf",
    fields: [
      { key: "ranges", label: "Pages to remove", type: "text", placeholder: "e.g. 2-4,7" },
    ],
    run: async (f, p) => [await pdf.deletePages(f[0], p.ranges || "")],
  },
  {
    id: "reorder",
    name: "Reorder Pages",
    desc: "Rebuild the PDF in any page order you choose",
    icon: ListOrdered,
    cat: "Organize",
    accept: "application/pdf",
    fields: [
      {
        key: "order",
        label: "New page order",
        type: "text",
        placeholder: "e.g. 3,1,2,5-7",
        hint: "List every page once, in the order you want",
      },
    ],
    run: async (f, p) => [await pdf.reorderPages(f[0], p.order || "")],
  },
  {
    id: "rotate",
    name: "Rotate PDF",
    desc: "Rotate all or selected pages",
    icon: RotateCw,
    cat: "Edit",
    accept: "application/pdf",
    fields: [
      {
        key: "rotate",
        label: "Rotation",
        type: "select",
        default: "90",
        options: [
          { value: "90", label: "90° clockwise" },
          { value: "180", label: "180°" },
          { value: "270", label: "90° counter-clockwise" },
        ],
      },
      { key: "ranges", label: "Pages (optional)", type: "text", placeholder: "all pages" },
    ],
    run: async (f, p) => [
      await pdf.rotatePdf(f[0], num(p.rotate, 90), p.ranges || undefined),
    ],
  },
  {
    id: "img2pdf",
    name: "Images → PDF",
    desc: "Turn JPG / PNG / WebP / BMP / GIF images into a PDF",
    icon: ImageIcon,
    cat: "To PDF",
    multi: true,
    accept: "image/png,image/jpeg,image/webp,image/bmp,image/gif",
    fields: [],
    run: async (f) => [await pdf.imagesToPdfAny(f)],
  },
  {
    id: "pdf2img",
    name: "PDF → Images",
    desc: "Render every page to PNG / JPG / WebP / BMP",
    icon: FileImage,
    cat: "From PDF",
    accept: "application/pdf",
    fields: [
      {
        key: "imgOutFmt",
        label: "Image format",
        type: "select",
        default: "png",
        options: [
          { value: "png", label: "PNG (lossless, transparent)" },
          { value: "jpeg", label: "JPG (smallest, white bg)" },
          { value: "webp", label: "WebP" },
          { value: "bmp", label: "BMP" },
        ],
      },
    ],
    run: (f, p) =>
      pdf.pdfToImageFormat(
        f[0],
        (p.imgOutFmt as "png" | "jpeg" | "webp" | "bmp") || "png"
      ),
  },
  {
    id: "extract-images",
    name: "Extract Images",
    desc: "Pull every embedded raster image out as PNG",
    icon: Images,
    cat: "From PDF",
    accept: "application/pdf",
    fields: [],
    run: (f) => pdf.extractImages(f[0]),
  },
  {
    id: "svg2img",
    name: "SVG Converter",
    desc: "Convert SVG to PNG, JPG, WebP or PDF",
    icon: Shapes,
    cat: "Data",
    accept: "image/svg+xml,.svg",
    fields: [
      {
        key: "svgFormat",
        label: "Output format",
        type: "select",
        default: "png",
        options: [
          { value: "png", label: "PNG — transparent" },
          { value: "jpeg", label: "JPG — white background" },
          { value: "webp", label: "WebP" },
          { value: "pdf", label: "PDF" },
        ],
      },
      {
        key: "svgScale",
        label: "Scale (×) — higher = sharper",
        type: "number",
        default: "2",
        min: 1,
        max: 10,
        step: 1,
      },
    ],
    run: async (f, p) => [
      await pdf.svgToImage(
        f[0],
        (p.svgFormat as pdf.SvgFormat) || "png",
        flt(p.svgScale, 2)
      ),
    ],
  },
  {
    id: "img2svg",
    name: "Image → SVG (Vectorize)",
    desc: "High-quality VTracer raster → vector (PNG/JPG → SVG)",
    icon: PenTool,
    cat: "Data",
    accept: "image/png,image/jpeg,image/webp",
    fields: [
      {
        key: "tracePreset",
        label: "Vectorize style",
        type: "select",
        default: "photo",
        options: [
          { value: "photo", label: "Photo / detailed — full color" },
          { value: "logo", label: "Logo / flat art — clean" },
          { value: "bw", label: "Black & white — line art" },
          { value: "pixel", label: "Sharp — pixel-precise" },
        ],
        hint: "Logos & illustrations vectorize cleanly; photos make large SVGs.",
      },
    ],
    run: async (f, p) => [
      await pdf.imageToSvg(f[0], (p.tracePreset as pdf.TracePreset) || "photo"),
    ],
  },
  {
    id: "img-compress",
    name: "Image Compressor",
    desc: "Shrink & resize JPG / PNG / WebP in bulk",
    icon: Gauge,
    cat: "Optimize",
    multi: true,
    accept: "image/png,image/jpeg,image/webp",
    fields: [
      {
        key: "imgFormat",
        label: "Output format",
        type: "select",
        default: "keep",
        options: [
          { value: "keep", label: "Keep original" },
          { value: "jpeg", label: "JPG (smallest)" },
          { value: "webp", label: "WebP" },
          { value: "png", label: "PNG (lossless)" },
        ],
      },
      { key: "imgQuality", label: "Quality", type: "range", default: "80", min: 1, max: 100, step: 1 },
      { key: "imgMaxW", label: "Max width px (0 = keep)", type: "number", default: "0", min: 0 },
    ],
    run: (f, p) =>
      Promise.all(
        f.map((file) =>
          pdf.compressImage(
            file,
            (p.imgFormat as pdf.ImgFormat) || "keep",
            num(p.imgQuality, 80),
            num(p.imgMaxW, 0)
          )
        )
      ),
  },
  {
    id: "pdf2txt",
    name: "PDF → Text",
    desc: "Extract the text layer to a .txt file",
    icon: FileText,
    cat: "From PDF",
    accept: "application/pdf",
    fields: [],
    run: async (f) => [await pdf.pdfToText(f[0])],
  },
  {
    id: "txt2pdf",
    name: "Text → PDF",
    desc: "Lay a .txt / .md file out as an A4 PDF",
    icon: FileType,
    cat: "To PDF",
    accept: "text/plain,text/markdown,.txt,.md",
    fields: [],
    run: async (f) => [await pdf.textToPdf(f[0])],
  },
  {
    id: "csv2pdf",
    name: "CSV → PDF Table",
    desc: "Render a CSV as a printable table",
    icon: Table,
    cat: "To PDF",
    accept: "text/csv,.csv",
    fields: [],
    run: async (f) => [await pdf.csvToPdf(f[0])],
  },
  {
    id: "pdf-flatten",
    name: "Flatten PDF",
    desc: "Bake pages flat (forms, layers, redactions)",
    icon: Layers,
    cat: "Optimize",
    accept: "application/pdf",
    fields: [
      { key: "rasterScale", label: "Quality (× DPI) — 1–4", type: "number", default: "2", min: 1, max: 4, step: 1 },
      {
        key: "rasterGray",
        label: "Grayscale",
        type: "select",
        default: "no",
        options: [
          { value: "no", label: "No — keep colour" },
          { value: "yes", label: "Yes — smaller, ink-saving" },
        ],
      },
    ],
    run: async (f, p) => [
      await pdf.flattenPdf(f[0], num(p.rasterScale, 2), (p.rasterGray || "no") === "yes"),
    ],
  },
  {
    id: "pdf-meta",
    name: "Edit PDF Info",
    desc: "Set the document title & author",
    icon: Info,
    cat: "Edit",
    accept: "application/pdf",
    fields: [
      { key: "metaTitle", label: "Title", type: "text", placeholder: "Document title" },
      { key: "metaAuthor", label: "Author", type: "text", placeholder: "Author name" },
    ],
    run: async (f, p) => [
      await pdf.setPdfMeta(f[0], p.metaTitle || "", p.metaAuthor || ""),
    ],
  },
  {
    id: "numbers",
    name: "Page Numbers",
    desc: "Stamp page numbers — format, position, start & colour",
    icon: Hash,
    cat: "Edit",
    accept: "application/pdf",
    fields: [
      {
        key: "numFormat",
        label: "Format",
        type: "select",
        default: "n-of-N",
        options: [
          { value: "n-of-N", label: "1 / 10" },
          { value: "n", label: "1" },
          { value: "page-n", label: "Page 1" },
          { value: "page-n-of-N", label: "Page 1 of 10" },
        ],
      },
      { key: "numPos", label: "Position", type: "select", default: "bc", options: POS_6 },
      { key: "numStart", label: "Start at", type: "number", default: "1", min: 0 },
      { key: "numSize", label: "Font size", type: "number", default: "10", min: 6, max: 48 },
      { key: "numColor", label: "Colour", type: "color", default: "#595959" },
    ],
    run: async (f, p) => [
      await pdf.addPageNumbers(f[0], {
        format: (p.numFormat as pdf.PageNumFormat) || "n-of-N",
        position: (p.numPos as pdf.Anchor) || "bc",
        start: num(p.numStart, 1),
        size: num(p.numSize, 10),
        color: p.numColor,
      }),
    ],
  },
  {
    id: "watermark",
    name: "Watermark",
    desc: "Text watermark — layout, size, opacity & colour",
    icon: Stamp,
    cat: "Edit",
    accept: "application/pdf",
    fields: [
      { key: "text", label: "Watermark text", type: "text", default: "DRAFT", placeholder: "DRAFT" },
      {
        key: "wmLayout",
        label: "Layout",
        type: "select",
        default: "diagonal",
        options: [
          { value: "diagonal", label: "Diagonal (centre)" },
          { value: "horizontal", label: "Horizontal (centre)" },
          { value: "tile", label: "Tiled (repeat)" },
        ],
      },
      { key: "wmOpacity", label: "Opacity", type: "range", default: "0.18", min: 0.02, max: 1, step: 0.02 },
      { key: "wmSize", label: "Font size (0 = auto)", type: "number", default: "0", min: 0, max: 200 },
      { key: "wmColor", label: "Colour", type: "color", default: "#999999" },
    ],
    run: async (f, p) => [
      await pdf.addWatermark(f[0], {
        text: p.text || "DRAFT",
        layout: (p.wmLayout as pdf.WatermarkLayout) || "diagonal",
        opacity: flt(p.wmOpacity, 0.18),
        size: num(p.wmSize, 0),
        color: p.wmColor,
      }),
    ],
  },
  {
    id: "img-watermark",
    name: "Image Watermark",
    desc: "Stamp a logo or image onto every page",
    icon: ImagePlus,
    cat: "Edit",
    accept: "application/pdf",
    fields: [
      { key: "wmImage", label: "Watermark image", type: "image", accept: "image/png,image/jpeg" },
      {
        key: "iwLayout",
        label: "Layout",
        type: "select",
        default: "center",
        options: [
          { value: "center", label: "Centre" },
          { value: "corner", label: "Corner" },
          { value: "tile", label: "Tiled (repeat)" },
        ],
      },
      { key: "iwPos", label: "Corner position", type: "select", default: "br", options: POS_6 },
      { key: "iwScale", label: "Size (% of page width)", type: "range", default: "0.4", min: 0.05, max: 1, step: 0.05 },
      { key: "iwOpacity", label: "Opacity", type: "range", default: "0.25", min: 0.02, max: 1, step: 0.02 },
    ],
    run: async (f, p) => [
      await pdf.addImageWatermark(f[0], p.wmImage || "", {
        layout: (p.iwLayout as pdf.ImgWmLayout) || "center",
        position: (p.iwPos as pdf.Anchor) || "br",
        scale: flt(p.iwScale, 0.4),
        opacity: flt(p.iwOpacity, 0.25),
      }),
    ],
  },
  {
    id: "compress",
    name: "Compress PDF",
    desc: "Re-stream & slim the file",
    icon: Minimize2,
    cat: "Optimize",
    accept: "application/pdf",
    fields: [],
    run: async (f) => [await pdf.compressPdf(f[0])],
  },
  {
    id: "reverse",
    name: "Reverse Pages",
    desc: "Flip the page order — last page first",
    icon: ArrowDownUp,
    cat: "Organize",
    accept: "application/pdf",
    fields: [],
    run: async (f) => [await pdf.reversePdf(f[0])],
  },
  {
    id: "blank",
    name: "Add Blank Page",
    desc: "Append a blank page sized to match the last",
    icon: FilePlus,
    cat: "Organize",
    accept: "application/pdf",
    fields: [],
    run: async (f) => [await pdf.addBlankPage(f[0])],
  },
  {
    id: "nup",
    name: "Booklet (N-up)",
    desc: "Lay 2 or 4 pages on one landscape sheet",
    icon: Columns2,
    cat: "Organize",
    accept: "application/pdf",
    fields: [
      {
        key: "n",
        label: "Pages per sheet",
        type: "select",
        default: "2",
        options: [
          { value: "2", label: "2-up (booklet)" },
          { value: "4", label: "4-up (handout)" },
        ],
      },
    ],
    run: async (f, p) => [
      await pdf.nupPdf(f[0], (num(p.n, 2) === 4 ? 4 : 2) as 2 | 4),
    ],
  },
  {
    id: "pdf-info",
    name: "PDF Info",
    desc: "Dump page count, sizes & metadata to a .txt",
    icon: Search,
    cat: "From PDF",
    accept: "application/pdf",
    fields: [],
    run: async (f) => [await pdf.pdfInfo(f[0])],
  },
  {
    id: "compare",
    name: "Compare PDFs",
    desc: "Line-by-line text diff between two PDFs",
    icon: GitCompare,
    cat: "Data",
    multi: true,
    accept: "application/pdf",
    fields: [],
    run: (f) => pdf.comparePdfsText(f).then((o) => [o]),
  },
  {
    id: "csv2json",
    name: "CSV → JSON",
    desc: "Convert a CSV file to a JSON array",
    icon: Braces,
    cat: "Data",
    accept: "text/csv,.csv",
    fields: [],
    run: async (f) => [await pdf.csvToJson(f[0])],
  },
  {
    id: "json2csv",
    name: "JSON → CSV",
    desc: "Convert a JSON array of objects to CSV",
    icon: FileJson,
    cat: "Data",
    accept: "application/json,.json",
    fields: [],
    run: async (f) => [await pdf.jsonToCsv(f[0])],
  },
  // ===== Organize additions =====
  {
    id: "divide",
    name: "Divide Pages",
    desc: "Split each page horizontally or vertically into two",
    icon: SplitSquareHorizontal,
    cat: "Organize",
    accept: "application/pdf",
    fields: [
      {
        key: "axis",
        label: "Split direction",
        type: "select",
        default: "h",
        options: [
          { value: "h", label: "Horizontal (top / bottom)" },
          { value: "v", label: "Vertical (left / right)" },
        ],
      },
    ],
    run: async (f, p) => [await pdf.dividePages(f[0], (p.axis as "h" | "v") || "h")],
  },
  {
    id: "combine-single",
    name: "Combine to Single Page",
    desc: "Stitch every page into one tall continuous page",
    icon: AlignVerticalSpaceBetween,
    cat: "Organize",
    accept: "application/pdf",
    fields: [],
    run: async (f) => [await pdf.combineToSinglePage(f[0])],
  },
  {
    id: "alternate",
    name: "Alternate Merge",
    desc: "Interleave pages from multiple PDFs (A1,B1,A2,B2…)",
    icon: Shuffle,
    cat: "Organize",
    multi: true,
    accept: "application/pdf",
    fields: [],
    run: async (f) => [await pdf.alternateMerge(f)],
  },
  {
    id: "posterize",
    name: "Posterize",
    desc: "Tile each page into N×N printable sheets",
    icon: Grid3X3,
    cat: "Organize",
    accept: "application/pdf",
    fields: [
      {
        key: "tiles",
        label: "Tiles per side",
        type: "select",
        default: "2",
        options: [
          { value: "2", label: "2 × 2 (4 sheets)" },
          { value: "3", label: "3 × 3 (9 sheets)" },
          { value: "4", label: "4 × 4 (16 sheets)" },
        ],
      },
    ],
    run: async (f, p) => [
      await pdf.posterizePdf(f[0], (num(p.tiles, 2) as 2 | 3 | 4) || 2),
    ],
  },
  {
    id: "booklet",
    name: "PDF Booklet",
    desc: "Reorder for saddle-stitch booklet printing (2-up)",
    icon: BookOpen,
    cat: "Organize",
    accept: "application/pdf",
    fields: [],
    run: async (f) => [await pdf.bookletOrder(f[0])],
  },
  // ===== Edit additions =====
  {
    id: "crop",
    name: "Crop PDF",
    desc: "Trim a percentage off all sides via crop box",
    icon: Crop,
    cat: "Edit",
    accept: "application/pdf",
    fields: [
      { key: "marginPct", label: "Trim percent", type: "range", default: "5", min: 0, max: 40, step: 1 },
    ],
    run: async (f, p) => [await pdf.cropPdf(f[0], num(p.marginPct, 5))],
  },
  {
    id: "header-footer",
    name: "Header & Footer",
    desc: "Add running header and footer text on every page",
    icon: PanelTopOpen,
    cat: "Edit",
    accept: "application/pdf",
    fields: [
      { key: "header", label: "Header text", type: "text", placeholder: "Top of each page" },
      { key: "footer", label: "Footer text", type: "text", placeholder: "Bottom of each page" },
    ],
    run: async (f, p) => [await pdf.addHeaderFooter(f[0], p.header || "", p.footer || "")],
  },
  {
    id: "stamp",
    name: "Add Stamp",
    desc: "Apply Approved / Rejected / Paid / Draft / Confidential",
    icon: CheckCircle,
    cat: "Edit",
    accept: "application/pdf",
    fields: [
      {
        key: "stampKind",
        label: "Stamp",
        type: "select",
        default: "approved",
        options: [
          { value: "approved", label: "APPROVED — green" },
          { value: "rejected", label: "REJECTED — red" },
          { value: "draft", label: "DRAFT — grey" },
          { value: "confidential", label: "CONFIDENTIAL — red" },
          { value: "paid", label: "PAID — green" },
        ],
      },
      {
        key: "stampPos",
        label: "Position",
        type: "select",
        default: "mc",
        options: [
          { value: "mc", label: "Diagonal (centre)" },
          { value: "tr", label: "Top right" },
          { value: "tl", label: "Top left" },
          { value: "br", label: "Bottom right" },
          { value: "bl", label: "Bottom left" },
        ],
      },
      { key: "stampOpacity", label: "Opacity", type: "range", default: "0.45", min: 0.05, max: 1, step: 0.05 },
    ],
    run: async (f, p) => [
      await pdf.addStamp(f[0], (p.stampKind as pdf.StampKind) || "approved", {
        position: (p.stampPos as pdf.Anchor) || "mc",
        opacity: flt(p.stampOpacity, 0.45),
      }),
    ],
  },
  {
    id: "remove-annots",
    name: "Remove Annotations",
    desc: "Strip every annotation, highlight and comment",
    icon: Eraser,
    cat: "Edit",
    accept: "application/pdf",
    fields: [],
    run: async (f) => [await pdf.removeAnnotations(f[0])],
  },
  {
    id: "remove-blank",
    name: "Remove Blank Pages",
    desc: "Auto-detect and drop empty pages",
    icon: Eraser,
    cat: "Edit",
    accept: "application/pdf",
    fields: [],
    run: async (f) => [await pdf.removeBlankPages(f[0])],
  },
  {
    id: "greyscale",
    name: "PDF → Greyscale",
    desc: "Re-render every page in black and white",
    icon: Droplet,
    cat: "Edit",
    accept: "application/pdf",
    fields: [],
    run: async (f) => [await pdf.greyscalePdf(f[0])],
  },
  {
    id: "invert",
    name: "Invert Colors",
    desc: "Create a dark-mode style negative",
    icon: Contrast,
    cat: "Edit",
    accept: "application/pdf",
    fields: [],
    run: async (f) => [await pdf.invertColors(f[0])],
  },
  // ===== To PDF additions =====
  {
    id: "json2pdf",
    name: "JSON → PDF",
    desc: "Pretty-print JSON onto an A4 PDF",
    icon: FileCode2,
    cat: "To PDF",
    accept: "application/json,.json",
    fields: [],
    run: async (f) => [await pdf.jsonToPdf(f[0])],
  },
  {
    id: "md2pdf",
    name: "Markdown → PDF",
    desc: "Lay a Markdown file out as a plain A4 PDF",
    icon: FileType,
    cat: "To PDF",
    accept: "text/markdown,.md",
    fields: [],
    run: async (f) => [await pdf.markdownToPdf(f[0])],
  },
  // ===== From PDF additions =====
  {
    id: "pdf2json",
    name: "PDF → JSON",
    desc: "Extract per-page text and metadata as JSON",
    icon: Braces,
    cat: "From PDF",
    accept: "application/pdf",
    fields: [],
    run: async (f) => [await pdf.pdfToJsonText(f[0])],
  },
  {
    id: "page-dims",
    name: "Page Dimensions",
    desc: "List every page's width × height (.txt report)",
    icon: Ruler,
    cat: "From PDF",
    accept: "application/pdf",
    fields: [],
    run: async (f) => [await pdf.pageDimensionsText(f[0])],
  },
  // ===== Optimize additions =====
  {
    id: "fix-a4",
    name: "Fix Page Size (A4)",
    desc: "Resize every page to A4 portrait / landscape",
    icon: Maximize,
    cat: "Optimize",
    accept: "application/pdf",
    fields: [],
    run: async (f) => [await pdf.fixPageSizeA4(f[0])],
  },
  {
    id: "linearize",
    name: "Linearize PDF",
    desc: "Re-save without object streams for fast web view",
    icon: Zap,
    cat: "Optimize",
    accept: "application/pdf",
    fields: [],
    run: async (f) => [await pdf.linearizePdf(f[0])],
  },
  // ===== Secure =====
  {
    id: "sanitize",
    name: "Sanitize PDF",
    desc: "Strip annotations, metadata and embedded scripts",
    icon: Shield,
    cat: "Secure",
    accept: "application/pdf",
    fields: [],
    run: async (f) => [await pdf.sanitizePdf(f[0])],
  },
  {
    id: "remove-meta",
    name: "Remove Metadata",
    desc: "Erase title, author, dates and producer info",
    icon: Eye,
    cat: "Secure",
    accept: "application/pdf",
    fields: [],
    run: async (f) => [await pdf.removeMetadata(f[0])],
  },
  // ===== PDFCraft-parity additions =====
  {
    id: "rotate-custom",
    name: "Rotate Custom Degrees",
    desc: "Rotate pages by any angle — page resizes to fit",
    icon: RotateCcw,
    cat: "Edit",
    accept: "application/pdf",
    fields: [
      { key: "deg", label: "Angle (degrees)", type: "number", default: "45", min: -360, max: 360 },
      { key: "ranges", label: "Pages (optional)", type: "text", placeholder: "all pages" },
    ],
    run: async (f, p) => [
      await pdf.rotateCustom(f[0], num(p.deg, 45), p.ranges || undefined),
    ],
  },
  {
    id: "add-attach",
    name: "Add Attachments",
    desc: "Embed files inside a PDF (first file = PDF, rest = attachments)",
    icon: Paperclip,
    cat: "Organize",
    multi: true,
    accept: "application/pdf,*/*",
    fields: [],
    run: async (f) => [await pdf.addAttachments(f)],
  },
  {
    id: "extract-attach",
    name: "Extract Attachments",
    desc: "Pull every embedded file out of a PDF",
    icon: FileDown,
    cat: "Organize",
    accept: "application/pdf",
    fields: [],
    run: (f) => pdf.extractAttachments(f[0]),
  },
  {
    id: "grid",
    name: "Grid Combine",
    desc: "Lay multiple pages onto sheets in a custom grid",
    icon: Grid2x2,
    cat: "Organize",
    accept: "application/pdf",
    fields: [
      { key: "cols", label: "Columns", type: "number", default: "2", min: 1, max: 6 },
      { key: "rows", label: "Rows", type: "number", default: "2", min: 1, max: 6 },
    ],
    run: async (f, p) => [await pdf.gridCombine(f[0], num(p.cols, 2), num(p.rows, 2))],
  },
  {
    id: "pdf2zip",
    name: "PDF → ZIP",
    desc: "Render every page to an image and bundle as a .zip",
    icon: FileArchive,
    cat: "Organize",
    accept: "application/pdf",
    fields: [
      {
        key: "zipFmt",
        label: "Image format",
        type: "select",
        default: "png",
        options: [
          { value: "png", label: "PNG (lossless)" },
          { value: "jpeg", label: "JPG (smallest)" },
        ],
      },
    ],
    run: async (f, p) => [
      await pdf.pdfToZip(f[0], (p.zipFmt as "png" | "jpeg") || "png"),
    ],
  },
  {
    id: "bg-color",
    name: "Background Color",
    desc: "Paint a solid colour behind every page",
    icon: PaintBucket,
    cat: "Edit",
    accept: "application/pdf",
    fields: [{ key: "bg", label: "Background colour", type: "color", default: "#FFF8E1" }],
    run: async (f, p) => [await pdf.backgroundColor(f[0], p.bg || "#ffffff")],
  },
  {
    id: "extract-tables",
    name: "Extract Tables",
    desc: "Detect tabular text by position and export to CSV",
    icon: TableProperties,
    cat: "From PDF",
    accept: "application/pdf",
    fields: [],
    run: async (f) => [await pdf.extractTablesCsv(f[0])],
  },
  {
    id: "repair",
    name: "Repair PDF",
    desc: "Reload tolerantly and rewrite a clean structure",
    icon: Wrench,
    cat: "Optimize",
    accept: "application/pdf",
    fields: [],
    run: async (f) => [await pdf.repairPdf(f[0])],
  },
  {
    id: "rasterize",
    name: "Rasterize PDF",
    desc: "Render each page to an image at a chosen DPI",
    icon: ScanLine,
    cat: "Optimize",
    accept: "application/pdf",
    fields: [
      { key: "rScale", label: "Quality (× DPI) — 1–4", type: "number", default: "2", min: 1, max: 4, step: 1 },
    ],
    run: async (f, p) => [await pdf.rasterizePdf(f[0], num(p.rScale, 2))],
  },
  {
    id: "remove-restrictions",
    name: "Remove Restrictions",
    desc: "Strip owner-password permission limits",
    icon: Unlock,
    cat: "Secure",
    accept: "application/pdf",
    fields: [],
    run: async (f) => [await pdf.removeRestrictions(f[0])],
  },
  // ===== Office → PDF =====
  {
    id: "word2pdf",
    name: "Word → PDF",
    desc: "Convert a .docx document to PDF (text & structure)",
    icon: FileType2,
    cat: "To PDF",
    accept: ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    fields: [],
    run: async (f) => [await pdf.wordToPdf(f[0])],
  },
  {
    id: "excel2pdf",
    name: "Excel → PDF",
    desc: "Convert a .xlsx / .xls spreadsheet to a PDF table",
    icon: Sheet,
    cat: "To PDF",
    accept: ".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel",
    fields: [],
    run: async (f) => [await pdf.excelToPdf(f[0])],
  },
  {
    id: "ppt2pdf",
    name: "PowerPoint → PDF",
    desc: "Convert a .pptx deck to PDF (slide text)",
    icon: Presentation,
    cat: "To PDF",
    accept: ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation",
    fields: [],
    run: async (f) => [await pdf.pptToPdf(f[0])],
  },
  // ===== PDF → Office =====
  {
    id: "pdf2docx",
    name: "PDF → Word",
    desc: "Export the PDF's text to an editable .docx",
    icon: FileType2,
    cat: "From PDF",
    accept: "application/pdf",
    fields: [],
    run: async (f) => [await pdf.pdfToDocx(f[0])],
  },
  {
    id: "pdf2xlsx",
    name: "PDF → Excel",
    desc: "Export reconstructed tables to .xlsx (one sheet per page)",
    icon: Sheet,
    cat: "From PDF",
    accept: "application/pdf",
    fields: [],
    run: async (f) => [await pdf.pdfToExcel(f[0])],
  },
  {
    id: "pdf2pptx",
    name: "PDF → PowerPoint",
    desc: "One slide per page as a full-bleed image (.pptx)",
    icon: Presentation,
    cat: "From PDF",
    accept: "application/pdf",
    fields: [],
    run: async (f) => [await pdf.pdfToPptx(f[0])],
  },
  // ===== Light parsers =====
  {
    id: "cbz2pdf",
    name: "CBZ → PDF",
    desc: "Convert a comic-book archive (zipped images) to PDF",
    icon: BookText,
    cat: "To PDF",
    accept: ".cbz,.zip,application/zip,application/x-cbz",
    fields: [],
    run: async (f) => [await pdf.cbzToPdf(f[0])],
  },
  {
    id: "rtf2pdf",
    name: "RTF → PDF",
    desc: "Convert a Rich Text Format document to PDF",
    icon: FileType2,
    cat: "To PDF",
    accept: ".rtf,application/rtf,text/rtf",
    fields: [],
    run: async (f) => [await pdf.rtfToPdf(f[0])],
  },
  {
    id: "tiff2pdf",
    name: "TIFF → PDF",
    desc: "Convert single or multi-page TIFF images to PDF",
    icon: FileImage,
    cat: "To PDF",
    accept: ".tif,.tiff,image/tiff",
    fields: [],
    run: async (f) => [await pdf.tiffToPdf(f[0])],
  },
  {
    id: "pdf2tiff",
    name: "PDF → TIFF",
    desc: "Render every page to a .tiff image",
    icon: FileImage,
    cat: "From PDF",
    accept: "application/pdf",
    fields: [],
    run: (f) => pdf.pdfToTiff(f[0]),
  },
  // ===== OCR =====
  {
    id: "ocr-pdf",
    name: "OCR PDF",
    desc: "Make a scanned PDF searchable (adds an invisible text layer)",
    icon: ScanText,
    cat: "Edit",
    accept: "application/pdf",
    fields: [],
    run: async (f) => [await pdf.ocrSearchablePdf(f[0])],
  },
  {
    id: "ocr-text",
    name: "OCR → Text",
    desc: "Extract text from a scanned PDF (image-only) to .txt",
    icon: ScanText,
    cat: "From PDF",
    accept: "application/pdf",
    fields: [],
    run: async (f) => [await pdf.ocrToText(f[0])],
  },
  // ===== Secure: encryption =====
  {
    id: "encrypt",
    name: "Encrypt PDF",
    desc: "Password-protect with AES encryption",
    icon: Lock,
    cat: "Secure",
    accept: "application/pdf",
    fields: [
      { key: "userPassword", label: "Open password", type: "password", placeholder: "required to open" },
      { key: "ownerPassword", label: "Owner password (optional)", type: "password", placeholder: "for full control" },
    ],
    run: async (f, p) => [
      await pdf.encryptPdf(f[0], {
        userPassword: p.userPassword,
        ownerPassword: p.ownerPassword,
      }),
    ],
  },
  {
    id: "decrypt",
    name: "Decrypt PDF",
    desc: "Unlock a password-protected PDF (supply the password)",
    icon: KeyRound,
    cat: "Secure",
    accept: "application/pdf",
    fields: [
      { key: "password", label: "Password", type: "password", placeholder: "current password" },
    ],
    run: async (f, p) => [await pdf.decryptPdf(f[0], p.password || "")],
  },
  {
    id: "permissions",
    name: "Change Permissions",
    desc: "Lock printing / copying / editing with an owner password",
    icon: ShieldCheck,
    cat: "Secure",
    accept: "application/pdf",
    fields: [
      { key: "ownerPassword", label: "Owner password", type: "password", placeholder: "required" },
      { key: "allowPrint", label: "Allow printing", type: "toggle", default: "yes" },
      { key: "allowCopy", label: "Allow copying text", type: "toggle", default: "yes" },
      { key: "allowModify", label: "Allow editing", type: "toggle", default: "no" },
      { key: "allowAnnotate", label: "Allow annotating", type: "toggle", default: "no" },
    ],
    run: async (f, p) => [
      await pdf.encryptPdf(f[0], {
        ownerPassword: p.ownerPassword,
        printing: p.allowPrint !== "no",
        copying: p.allowCopy !== "no",
        modifying: p.allowModify === "yes",
        annotating: p.allowAnnotate === "yes",
      }),
    ],
  },
];

export const PDF_CATS = [
  "Organize",
  "Edit",
  "To PDF",
  "From PDF",
  "Optimize",
  "Secure",
  "Data",
] as const;

export function toolById(id: string) {
  return PDF_TOOLS.find((t) => t.id === id);
}

/** Initial param map for a tool, built from each field's `default`. */
export function defaultParams(tool: Tool): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of tool.fields) if (f.default != null) out[f.key] = f.default;
  return out;
}

/* ── Shared field renderer ─────────────────────────────────────────────── */
function FieldControl({
  f,
  value,
  onChange,
}: {
  f: FieldSpec;
  value: string;
  onChange: (v: string) => void;
}) {
  if (f.type === "select") {
    return (
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {f.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (f.type === "color") {
    return (
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value || "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded-lg border border-brand-200 bg-white p-0.5 dark:border-[#3A3D45] dark:bg-[#24262C]"
        />
        <input
          className="input flex-1"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
        />
      </div>
    );
  }
  if (f.type === "range") {
    return (
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={f.min}
          max={f.max}
          step={f.step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 accent-primary-500 cursor-pointer"
        />
        <span className="w-12 shrink-0 text-right text-xs font-semibold tabular-nums text-brand-500">
          {(f.max ?? 1) <= 1 ? `${Math.round(parseFloat(value || "0") * 100)}%` : value}
        </span>
      </div>
    );
  }
  if (f.type === "toggle") {
    const on = value === "yes" || value === "true";
    return (
      <button
        type="button"
        onClick={() => onChange(on ? "no" : "yes")}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          on ? "bg-primary-500" : "bg-brand-300 dark:bg-[#3A3D45]"
        }`}
        aria-pressed={on}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            on ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </button>
    );
  }
  if (f.type === "password") {
    return (
      <input
        type="password"
        className="input"
        value={value}
        placeholder={f.placeholder}
        autoComplete="new-password"
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (f.type === "image") {
    return (
      <label className="btn-ghost w-full cursor-pointer justify-center">
        <Upload size={14} /> {value ? "Change image" : "Choose image"}
        <input
          type="file"
          accept={f.accept || "image/*"}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const r = new FileReader();
            r.onload = () => onChange(String(r.result || ""));
            r.readAsDataURL(file);
            e.target.value = "";
          }}
        />
        {value && (
          <img src={value} alt="" className="ml-2 h-6 w-6 rounded object-contain" />
        )}
      </label>
    );
  }
  return (
    <input
      type={f.type === "number" ? "number" : "text"}
      className="input"
      min={f.min}
      max={f.max}
      step={f.step}
      value={value}
      placeholder={f.placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** Renders every option of a tool as a labelled control. */
export function ToolFields({
  tool,
  params,
  setParams,
}: {
  tool: Tool;
  params: Record<string, string>;
  setParams: (p: Record<string, string>) => void;
}) {
  if (!tool.fields.length)
    return <p className="text-xs text-brand-400">No options for this tool.</p>;
  // Hide the corner-position field unless the layout that uses it is selected.
  const visible = tool.fields.filter((f) => {
    if (f.key === "iwPos") return params.iwLayout === "corner";
    return true;
  });
  return (
    <div className="space-y-3">
      {visible.map((f) => (
        <div key={f.key}>
          <label className="label">{f.label}</label>
          <FieldControl
            f={f}
            value={params[f.key] ?? f.default ?? ""}
            onChange={(v) => setParams({ ...params, [f.key]: v })}
          />
          {f.hint && <p className="mt-1 text-[11px] text-brand-400">{f.hint}</p>}
        </div>
      ))}
    </div>
  );
}

/** Standalone tool dialog — local processing, downloadable results. */
export function ToolRunner({
  tool,
  onClose,
  onComplete,
}: {
  tool: Tool;
  onClose: () => void;
  onComplete?: (toolId: string, files: string[], outputs: OutFile[]) => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [params, setParams] = useState<Record<string, string>>(defaultParams(tool));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [results, setResults] = useState<OutFile[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const run = async () => {
    if (!files.length) {
      setErr("Add at least one file first.");
      return;
    }
    setBusy(true);
    setErr("");
    setResults([]);
    try {
      const out = await tool.run(files, params);
      setResults(out);
      onComplete?.(
        tool.id,
        files.map((f) => f.name),
        out
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#24262C] shadow-bento-hover p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="rounded-xl bg-primary-100 text-primary-700 p-2">
              <tool.icon size={18} />
            </div>
            <h2 className="text-lg font-bold text-ink">{tool.name}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-brand-400 hover:bg-brand-50 dark:hover:bg-white/5 cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <p className="text-sm text-brand-500 mb-4">{tool.desc}</p>

        <label className="btn-ghost w-full justify-center mb-3">
          <Upload size={15} />
          {tool.multi ? "Select files" : "Select file"}
          <input
            ref={fileRef}
            type="file"
            accept={tool.accept}
            multiple={tool.multi}
            className="hidden"
            onChange={(e) => {
              setFiles(Array.from(e.target.files ?? []));
              setResults([]);
              setErr("");
              e.target.value = "";
            }}
          />
        </label>

        {files.length > 0 && (
          <ul className="mb-3 space-y-1">
            {files.map((f, i) => (
              <li
                key={i}
                className="text-xs text-brand-600 dark:text-[#DDE0E4] bg-brand-50 dark:bg-white/5 rounded-lg px-3 py-2 truncate"
              >
                {f.name}
              </li>
            ))}
          </ul>
        )}

        <div className="mb-4">
          <ToolFields tool={tool} params={params} setParams={setParams} />
        </div>

        {err && (
          <p className="text-sm text-danger bg-danger/10 rounded-lg px-3 py-2 mb-3">
            {err}
          </p>
        )}

        {results.length > 0 && (
          <div className="mb-4">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-success mb-2">
              <CheckCircle2 size={15} /> {results.length} file
              {results.length > 1 ? "s" : ""} ready
            </p>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {results.map((r, i) => (
                <button
                  key={i}
                  onClick={() => pdf.downloadFile(r)}
                  className="w-full flex items-center justify-between bg-brand-50 hover:bg-brand-100 dark:bg-white/5 dark:hover:bg-white/10 rounded-lg px-3 py-2 text-xs font-semibold text-brand-700 dark:text-[#DDE0E4] cursor-pointer transition-colors"
                >
                  <span className="truncate">{r.name}</span>
                  <Download size={14} />
                </button>
              ))}
            </div>
            {results.length > 1 && (
              <button
                onClick={() => results.forEach(pdf.downloadFile)}
                className="btn-secondary w-full justify-center mt-2 text-xs"
              >
                <Download size={14} /> Download all
              </button>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Close
          </button>
          <button
            className="btn-primary"
            disabled={busy || files.length === 0}
            onClick={run}
          >
            {busy ? (
              <>
                <Loader2 size={15} className="animate-spin" /> Working…
              </>
            ) : (
              "Run tool"
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Categorized grid of every local PDF tool. */
export default function PdfToolbox({
  filter,
  onComplete,
}: {
  filter?: string;
  onComplete?: (toolId: string, files: string[]) => void;
}) {
  const [active, setActive] = useState<Tool | null>(null);
  const cats = filter ? PDF_CATS.filter((c) => c === filter) : PDF_CATS;

  return (
    <div>
      {cats.map((cat) => (
        <div key={cat} className="mb-5">
          <p className="text-xs font-bold uppercase tracking-wider text-brand-400 mb-2.5">
            {cat}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {PDF_TOOLS.filter((t) => t.cat === cat).map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setActive(t)}
                  className="card card-hover text-left flex items-start gap-3"
                >
                  <div className="rounded-xl bg-primary-100 text-primary-700 p-2.5 shrink-0">
                    <Icon size={20} />
                  </div>
                  <div>
                    <p className="font-bold text-ink text-sm">{t.name}</p>
                    <p className="text-xs text-brand-500 mt-0.5">{t.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {active && (
        <ToolRunner
          tool={active}
          onClose={() => setActive(null)}
          onComplete={onComplete}
        />
      )}
    </div>
  );
}
