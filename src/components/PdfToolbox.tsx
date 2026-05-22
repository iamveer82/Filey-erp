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
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as pdf from "../lib/pdfTools";
import type { OutFile } from "../lib/pdfTools";

type Param =
  | "ranges"
  | "chunk"
  | "rotate"
  | "text"
  | "svgFormat"
  | "svgScale"
  | "tracePreset"
  | "imgFormat"
  | "imgQuality"
  | "imgMaxW"
  | "rasterScale"
  | "rasterGray"
  | "metaTitle"
  | "metaAuthor"
  | "n"
  | "axis"
  | "marginPct"
  | "header"
  | "footer"
  | "stampKind"
  | "tiles"
  | "imgOutFmt";

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
  params: Param[];
  run: (files: File[], p: Record<string, string>) => Promise<OutFile[]>;
}

export const PDF_TOOLS: Tool[] = [
  {
    id: "merge",
    name: "Merge PDF",
    desc: "Combine multiple PDFs into one document",
    icon: Combine,
    cat: "Organize",
    multi: true,
    accept: "application/pdf",
    params: [],
    run: async (f) => [await pdf.mergePdfs(f)],
  },
  {
    id: "split",
    name: "Split PDF",
    desc: "Break a PDF into parts of N pages each",
    icon: Scissors,
    cat: "Organize",
    accept: "application/pdf",
    params: ["chunk"],
    run: (f, p) => pdf.splitEvery(f[0], parseInt(p.chunk || "1", 10)),
  },
  {
    id: "extract",
    name: "Extract Pages",
    desc: "Pull selected pages into a new PDF",
    icon: FileOutput,
    cat: "Organize",
    accept: "application/pdf",
    params: ["ranges"],
    run: async (f, p) => [await pdf.extractPages(f[0], p.ranges || "")],
  },
  {
    id: "delete",
    name: "Delete Pages",
    desc: "Remove pages by range, e.g. 2-4,7",
    icon: Trash2,
    cat: "Organize",
    accept: "application/pdf",
    params: ["ranges"],
    run: async (f, p) => [await pdf.deletePages(f[0], p.ranges || "")],
  },
  {
    id: "rotate",
    name: "Rotate PDF",
    desc: "Rotate all or selected pages",
    icon: RotateCw,
    cat: "Edit",
    accept: "application/pdf",
    params: ["rotate", "ranges"],
    run: async (f, p) => [
      await pdf.rotatePdf(
        f[0],
        parseInt(p.rotate || "90", 10),
        p.ranges || undefined
      ),
    ],
  },
  {
    id: "img2pdf",
    name: "Images → PDF",
    desc: "Turn JPG / PNG images into a PDF",
    icon: ImageIcon,
    cat: "To PDF",
    multi: true,
    accept: "image/png,image/jpeg",
    params: [],
    run: async (f) => [await pdf.imagesToPdf(f)],
  },
  {
    id: "pdf2img",
    name: "PDF → Images",
    desc: "Render every page to PNG / JPG / WebP / BMP",
    icon: FileImage,
    cat: "From PDF",
    accept: "application/pdf",
    params: ["imgOutFmt"],
    run: (f, p) =>
      pdf.pdfToImageFormat(
        f[0],
        (p.imgOutFmt as "png" | "jpeg" | "webp" | "bmp") || "png"
      ),
  },
  {
    id: "svg2img",
    name: "SVG Converter",
    desc: "Convert SVG to PNG, JPG, WebP or PDF",
    icon: Shapes,
    cat: "Data",
    accept: "image/svg+xml,.svg",
    params: ["svgFormat", "svgScale"],
    run: async (f, p) => [
      await pdf.svgToImage(
        f[0],
        (p.svgFormat as pdf.SvgFormat) || "png",
        parseFloat(p.svgScale || "2")
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
    params: ["tracePreset"],
    run: async (f, p) => [
      await pdf.imageToSvg(f[0], (p.tracePreset as pdf.TracePreset) || "detailed"),
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
    params: ["imgFormat", "imgQuality", "imgMaxW"],
    run: (f, p) =>
      Promise.all(
        f.map((file) =>
          pdf.compressImage(
            file,
            (p.imgFormat as pdf.ImgFormat) || "keep",
            parseInt(p.imgQuality || "80", 10),
            parseInt(p.imgMaxW || "0", 10)
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
    params: [],
    run: async (f) => [await pdf.pdfToText(f[0])],
  },
  {
    id: "txt2pdf",
    name: "Text → PDF",
    desc: "Lay a .txt / .md file out as an A4 PDF",
    icon: FileType,
    cat: "To PDF",
    accept: "text/plain,text/markdown,.txt,.md",
    params: [],
    run: async (f) => [await pdf.textToPdf(f[0])],
  },
  {
    id: "csv2pdf",
    name: "CSV → PDF Table",
    desc: "Render a CSV as a printable table",
    icon: Table,
    cat: "To PDF",
    accept: "text/csv,.csv",
    params: [],
    run: async (f) => [await pdf.csvToPdf(f[0])],
  },
  {
    id: "pdf-flatten",
    name: "Flatten PDF",
    desc: "Bake pages flat (forms, layers, redactions)",
    icon: Layers,
    cat: "Optimize",
    accept: "application/pdf",
    params: ["rasterScale", "rasterGray"],
    run: async (f, p) => [
      await pdf.flattenPdf(
        f[0],
        parseInt(p.rasterScale || "2", 10),
        (p.rasterGray || "no") === "yes"
      ),
    ],
  },
  {
    id: "pdf-meta",
    name: "Edit PDF Info",
    desc: "Set the document title & author",
    icon: Info,
    cat: "Edit",
    accept: "application/pdf",
    params: ["metaTitle", "metaAuthor"],
    run: async (f, p) => [
      await pdf.setPdfMeta(f[0], p.metaTitle || "", p.metaAuthor || ""),
    ],
  },
  {
    id: "numbers",
    name: "Page Numbers",
    desc: "Stamp “1 / N” on every page",
    icon: Hash,
    cat: "Edit",
    accept: "application/pdf",
    params: [],
    run: async (f) => [await pdf.addPageNumbers(f[0])],
  },
  {
    id: "watermark",
    name: "Watermark",
    desc: "Add a diagonal text watermark",
    icon: Stamp,
    cat: "Edit",
    accept: "application/pdf",
    params: ["text"],
    run: async (f, p) => [await pdf.addWatermark(f[0], p.text || "DRAFT")],
  },
  {
    id: "compress",
    name: "Compress PDF",
    desc: "Re-stream & slim the file",
    icon: Minimize2,
    cat: "Optimize",
    accept: "application/pdf",
    params: [],
    run: async (f) => [await pdf.compressPdf(f[0])],
  },
  {
    id: "reverse",
    name: "Reverse Pages",
    desc: "Flip the page order — last page first",
    icon: ArrowDownUp,
    cat: "Organize",
    accept: "application/pdf",
    params: [],
    run: async (f) => [await pdf.reversePdf(f[0])],
  },
  {
    id: "blank",
    name: "Add Blank Page",
    desc: "Append a blank page sized to match the last",
    icon: FilePlus,
    cat: "Organize",
    accept: "application/pdf",
    params: [],
    run: async (f) => [await pdf.addBlankPage(f[0])],
  },
  {
    id: "nup",
    name: "Booklet (N-up)",
    desc: "Lay 2 or 4 pages on one landscape sheet",
    icon: Columns2,
    cat: "Organize",
    accept: "application/pdf",
    params: ["n"],
    run: async (f, p) => [
      await pdf.nupPdf(f[0], (parseInt(p.n || "2", 10) === 4 ? 4 : 2) as 2 | 4),
    ],
  },
  {
    id: "pdf-info",
    name: "PDF Info",
    desc: "Dump page count, sizes & metadata to a .txt",
    icon: Search,
    cat: "From PDF",
    accept: "application/pdf",
    params: [],
    run: async (f) => [await pdf.pdfInfo(f[0])],
  },
  {
    id: "csv2json",
    name: "CSV → JSON",
    desc: "Convert a CSV file to a JSON array",
    icon: Braces,
    cat: "Data",
    accept: "text/csv,.csv",
    params: [],
    run: async (f) => [await pdf.csvToJson(f[0])],
  },
  {
    id: "json2csv",
    name: "JSON → CSV",
    desc: "Convert a JSON array of objects to CSV",
    icon: FileJson,
    cat: "Data",
    accept: "application/json,.json",
    params: [],
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
    params: ["axis"],
    run: async (f, p) => [
      await pdf.dividePages(f[0], (p.axis as "h" | "v") || "h"),
    ],
  },
  {
    id: "combine-single",
    name: "Combine to Single Page",
    desc: "Stitch every page into one tall continuous page",
    icon: AlignVerticalSpaceBetween,
    cat: "Organize",
    accept: "application/pdf",
    params: [],
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
    params: [],
    run: async (f) => [await pdf.alternateMerge(f)],
  },
  {
    id: "posterize",
    name: "Posterize",
    desc: "Tile each page into N×N printable sheets",
    icon: Grid3X3,
    cat: "Organize",
    accept: "application/pdf",
    params: ["tiles"],
    run: async (f, p) => [
      await pdf.posterizePdf(
        f[0],
        (parseInt(p.tiles || "2", 10) as 2 | 3 | 4) || 2
      ),
    ],
  },
  {
    id: "booklet",
    name: "PDF Booklet",
    desc: "Reorder for saddle-stitch booklet printing (2-up)",
    icon: BookOpen,
    cat: "Organize",
    accept: "application/pdf",
    params: [],
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
    params: ["marginPct"],
    run: async (f, p) => [
      await pdf.cropPdf(f[0], parseInt(p.marginPct || "5", 10)),
    ],
  },
  {
    id: "header-footer",
    name: "Header & Footer",
    desc: "Add running header and footer text on every page",
    icon: PanelTopOpen,
    cat: "Edit",
    accept: "application/pdf",
    params: ["header", "footer"],
    run: async (f, p) => [
      await pdf.addHeaderFooter(f[0], p.header || "", p.footer || ""),
    ],
  },
  {
    id: "stamp",
    name: "Add Stamp",
    desc: "Apply Approved / Rejected / Paid / Draft / Confidential",
    icon: CheckCircle,
    cat: "Edit",
    accept: "application/pdf",
    params: ["stampKind"],
    run: async (f, p) => [
      await pdf.addStamp(
        f[0],
        (p.stampKind as pdf.StampKind) || "approved"
      ),
    ],
  },
  {
    id: "remove-annots",
    name: "Remove Annotations",
    desc: "Strip every annotation, highlight and comment",
    icon: Eraser,
    cat: "Edit",
    accept: "application/pdf",
    params: [],
    run: async (f) => [await pdf.removeAnnotations(f[0])],
  },
  {
    id: "remove-blank",
    name: "Remove Blank Pages",
    desc: "Auto-detect and drop empty pages",
    icon: Eraser,
    cat: "Edit",
    accept: "application/pdf",
    params: [],
    run: async (f) => [await pdf.removeBlankPages(f[0])],
  },
  {
    id: "greyscale",
    name: "PDF → Greyscale",
    desc: "Re-render every page in black and white",
    icon: Droplet,
    cat: "Edit",
    accept: "application/pdf",
    params: [],
    run: async (f) => [await pdf.greyscalePdf(f[0])],
  },
  {
    id: "invert",
    name: "Invert Colors",
    desc: "Create a dark-mode style negative",
    icon: Contrast,
    cat: "Edit",
    accept: "application/pdf",
    params: [],
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
    params: [],
    run: async (f) => [await pdf.jsonToPdf(f[0])],
  },
  {
    id: "md2pdf",
    name: "Markdown → PDF",
    desc: "Lay a Markdown file out as a plain A4 PDF",
    icon: FileType,
    cat: "To PDF",
    accept: "text/markdown,.md",
    params: [],
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
    params: [],
    run: async (f) => [await pdf.pdfToJsonText(f[0])],
  },
  {
    id: "page-dims",
    name: "Page Dimensions",
    desc: "List every page's width × height (.txt report)",
    icon: Ruler,
    cat: "From PDF",
    accept: "application/pdf",
    params: [],
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
    params: [],
    run: async (f) => [await pdf.fixPageSizeA4(f[0])],
  },
  {
    id: "linearize",
    name: "Linearize PDF",
    desc: "Re-save without object streams for fast web view",
    icon: Zap,
    cat: "Optimize",
    accept: "application/pdf",
    params: [],
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
    params: [],
    run: async (f) => [await pdf.sanitizePdf(f[0])],
  },
  {
    id: "remove-meta",
    name: "Remove Metadata",
    desc: "Erase title, author, dates and producer info",
    icon: Eye,
    cat: "Secure",
    accept: "application/pdf",
    params: [],
    run: async (f) => [await pdf.removeMetadata(f[0])],
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
  const [params, setParams] = useState<Record<string, string>>(
    tool.id === "rotate"
      ? { rotate: "90" }
      : tool.id === "split"
      ? { chunk: "1" }
      : tool.id === "svg2img"
      ? { svgFormat: "png", svgScale: "2" }
      : tool.id === "img2svg"
      ? { tracePreset: "photo" }
      : tool.id === "img-compress"
      ? { imgFormat: "keep", imgQuality: "80", imgMaxW: "0" }
      : tool.id === "pdf-flatten"
      ? { rasterScale: "2", rasterGray: "no" }
      : tool.id === "nup"
      ? { n: "2" }
      : tool.id === "divide"
      ? { axis: "h" }
      : tool.id === "crop"
      ? { marginPct: "5" }
      : tool.id === "stamp"
      ? { stampKind: "approved" }
      : tool.id === "posterize"
      ? { tiles: "2" }
      : tool.id === "pdf2img"
      ? { imgOutFmt: "png" }
      : {}
  );
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
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#201D16] shadow-bento-hover p-6"
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
                className="text-xs text-brand-600 dark:text-[#C9C0B0] bg-brand-50 dark:bg-white/5 rounded-lg px-3 py-2 truncate"
              >
                {f.name}
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-3 mb-4">
          {tool.params.includes("ranges") && (
            <div>
              <label className="label">
                Pages {tool.id === "rotate" && "(optional)"}
              </label>
              <input
                className="input"
                placeholder="e.g. 1-3,5,8-"
                value={params.ranges ?? ""}
                onChange={(e) =>
                  setParams({ ...params, ranges: e.target.value })
                }
              />
            </div>
          )}
          {tool.params.includes("chunk") && (
            <div>
              <label className="label">Pages per file</label>
              <input
                type="number"
                min={1}
                className="input"
                value={params.chunk ?? "1"}
                onChange={(e) =>
                  setParams({ ...params, chunk: e.target.value })
                }
              />
            </div>
          )}
          {tool.params.includes("rotate") && (
            <div>
              <label className="label">Rotation</label>
              <select
                className="select"
                value={params.rotate ?? "90"}
                onChange={(e) =>
                  setParams({ ...params, rotate: e.target.value })
                }
              >
                <option value="90">90° clockwise</option>
                <option value="180">180°</option>
                <option value="270">90° counter-clockwise</option>
              </select>
            </div>
          )}
          {tool.params.includes("text") && (
            <div>
              <label className="label">Watermark text</label>
              <input
                className="input"
                placeholder="DRAFT"
                value={params.text ?? ""}
                onChange={(e) =>
                  setParams({ ...params, text: e.target.value })
                }
              />
            </div>
          )}
          {tool.params.includes("svgFormat") && (
            <div>
              <label className="label">Output format</label>
              <select
                className="select"
                value={params.svgFormat ?? "png"}
                onChange={(e) =>
                  setParams({ ...params, svgFormat: e.target.value })
                }
              >
                <option value="png">PNG — transparent</option>
                <option value="jpeg">JPG — white background</option>
                <option value="webp">WebP</option>
                <option value="pdf">PDF</option>
              </select>
            </div>
          )}
          {tool.params.includes("svgScale") && (
            <div>
              <label className="label">Scale (×) — higher = sharper</label>
              <input
                type="number"
                min={1}
                max={10}
                step={1}
                className="input"
                value={params.svgScale ?? "2"}
                onChange={(e) =>
                  setParams({ ...params, svgScale: e.target.value })
                }
              />
            </div>
          )}
          {tool.params.includes("tracePreset") && (
            <div>
              <label className="label">Vectorize style</label>
              <select
                className="select"
                value={params.tracePreset ?? "detailed"}
                onChange={(e) =>
                  setParams({ ...params, tracePreset: e.target.value })
                }
              >
                <option value="photo">Photo / detailed — full color</option>
                <option value="logo">Logo / flat art — clean</option>
                <option value="bw">Black &amp; white — line art</option>
                <option value="pixel">Sharp — pixel-precise</option>
              </select>
              <p className="text-[11px] text-brand-400 mt-1">
                Logos &amp; illustrations vectorize cleanly; photos still
                produce many color layers (large SVG).
              </p>
            </div>
          )}
          {tool.params.includes("imgFormat") && (
            <div>
              <label className="label">Output format</label>
              <select
                className="select"
                value={params.imgFormat ?? "keep"}
                onChange={(e) =>
                  setParams({ ...params, imgFormat: e.target.value })
                }
              >
                <option value="keep">Keep original</option>
                <option value="jpeg">JPG (smallest)</option>
                <option value="webp">WebP</option>
                <option value="png">PNG (lossless)</option>
              </select>
            </div>
          )}
          {tool.params.includes("imgQuality") && (
            <div>
              <label className="label">Quality (1–100)</label>
              <input
                type="number"
                min={1}
                max={100}
                className="input"
                value={params.imgQuality ?? "80"}
                onChange={(e) =>
                  setParams({ ...params, imgQuality: e.target.value })
                }
              />
            </div>
          )}
          {tool.params.includes("imgMaxW") && (
            <div>
              <label className="label">Max width px (0 = keep)</label>
              <input
                type="number"
                min={0}
                className="input"
                value={params.imgMaxW ?? "0"}
                onChange={(e) =>
                  setParams({ ...params, imgMaxW: e.target.value })
                }
              />
            </div>
          )}
          {tool.params.includes("rasterScale") && (
            <div>
              <label className="label">Quality (× DPI) — 1–4</label>
              <input
                type="number"
                min={1}
                max={4}
                step={1}
                className="input"
                value={params.rasterScale ?? "2"}
                onChange={(e) =>
                  setParams({ ...params, rasterScale: e.target.value })
                }
              />
            </div>
          )}
          {tool.params.includes("rasterGray") && (
            <div>
              <label className="label">Grayscale</label>
              <select
                className="select"
                value={params.rasterGray ?? "no"}
                onChange={(e) =>
                  setParams({ ...params, rasterGray: e.target.value })
                }
              >
                <option value="no">No — keep colour</option>
                <option value="yes">Yes — smaller, ink-saving</option>
              </select>
            </div>
          )}
          {tool.params.includes("metaTitle") && (
            <div>
              <label className="label">Title</label>
              <input
                className="input"
                placeholder="Document title"
                value={params.metaTitle ?? ""}
                onChange={(e) =>
                  setParams({ ...params, metaTitle: e.target.value })
                }
              />
            </div>
          )}
          {tool.params.includes("metaAuthor") && (
            <div>
              <label className="label">Author</label>
              <input
                className="input"
                placeholder="Author name"
                value={params.metaAuthor ?? ""}
                onChange={(e) =>
                  setParams({ ...params, metaAuthor: e.target.value })
                }
              />
            </div>
          )}
          {tool.params.includes("n") && (
            <div>
              <label className="label">Pages per sheet</label>
              <select
                className="select"
                value={params.n ?? "2"}
                onChange={(e) =>
                  setParams({ ...params, n: e.target.value })
                }
              >
                <option value="2">2-up (booklet)</option>
                <option value="4">4-up (handout)</option>
              </select>
            </div>
          )}
          {tool.params.includes("axis") && (
            <div>
              <label className="label">Split direction</label>
              <select
                className="select"
                value={params.axis ?? "h"}
                onChange={(e) =>
                  setParams({ ...params, axis: e.target.value })
                }
              >
                <option value="h">Horizontal (top / bottom)</option>
                <option value="v">Vertical (left / right)</option>
              </select>
            </div>
          )}
          {tool.params.includes("marginPct") && (
            <div>
              <label className="label">Trim percent (0–40)</label>
              <input
                type="number"
                min={0}
                max={40}
                className="input"
                value={params.marginPct ?? "5"}
                onChange={(e) =>
                  setParams({ ...params, marginPct: e.target.value })
                }
              />
            </div>
          )}
          {tool.params.includes("header") && (
            <div>
              <label className="label">Header text</label>
              <input
                className="input"
                placeholder="Top of each page"
                value={params.header ?? ""}
                onChange={(e) =>
                  setParams({ ...params, header: e.target.value })
                }
              />
            </div>
          )}
          {tool.params.includes("footer") && (
            <div>
              <label className="label">Footer text</label>
              <input
                className="input"
                placeholder="Bottom of each page"
                value={params.footer ?? ""}
                onChange={(e) =>
                  setParams({ ...params, footer: e.target.value })
                }
              />
            </div>
          )}
          {tool.params.includes("stampKind") && (
            <div>
              <label className="label">Stamp</label>
              <select
                className="select"
                value={params.stampKind ?? "approved"}
                onChange={(e) =>
                  setParams({ ...params, stampKind: e.target.value })
                }
              >
                <option value="approved">APPROVED — green</option>
                <option value="rejected">REJECTED — red</option>
                <option value="draft">DRAFT — grey</option>
                <option value="confidential">CONFIDENTIAL — red</option>
                <option value="paid">PAID — green</option>
              </select>
            </div>
          )}
          {tool.params.includes("tiles") && (
            <div>
              <label className="label">Tiles per side</label>
              <select
                className="select"
                value={params.tiles ?? "2"}
                onChange={(e) =>
                  setParams({ ...params, tiles: e.target.value })
                }
              >
                <option value="2">2 × 2 (4 sheets)</option>
                <option value="3">3 × 3 (9 sheets)</option>
                <option value="4">4 × 4 (16 sheets)</option>
              </select>
            </div>
          )}
          {tool.params.includes("imgOutFmt") && (
            <div>
              <label className="label">Image format</label>
              <select
                className="select"
                value={params.imgOutFmt ?? "png"}
                onChange={(e) =>
                  setParams({ ...params, imgOutFmt: e.target.value })
                }
              >
                <option value="png">PNG (lossless, transparent)</option>
                <option value="jpeg">JPG (smallest, white bg)</option>
                <option value="webp">WebP</option>
                <option value="bmp">BMP</option>
              </select>
            </div>
          )}
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
                  className="w-full flex items-center justify-between bg-brand-50 hover:bg-brand-100 dark:bg-white/5 dark:hover:bg-white/10 rounded-lg px-3 py-2 text-xs font-semibold text-brand-700 dark:text-[#C9C0B0] cursor-pointer transition-colors"
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
  const cats = filter
    ? PDF_CATS.filter((c) => c === filter)
    : PDF_CATS;

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
