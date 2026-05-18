import { useEffect, useRef, useState } from "react";
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
  | "metaAuthor";

export interface Tool {
  id: string;
  name: string;
  desc: string;
  icon: LucideIcon;
  cat: "Organize" | "Convert" | "Edit" | "Optimize";
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
    cat: "Convert",
    multi: true,
    accept: "image/png,image/jpeg",
    params: [],
    run: async (f) => [await pdf.imagesToPdf(f)],
  },
  {
    id: "pdf2img",
    name: "PDF → Images",
    desc: "Render every page to a PNG image",
    icon: FileImage,
    cat: "Convert",
    accept: "application/pdf",
    params: [],
    run: (f) => pdf.pdfToImages(f[0]),
  },
  {
    id: "svg2img",
    name: "SVG Converter",
    desc: "Convert SVG to PNG, JPG, WebP or PDF",
    icon: Shapes,
    cat: "Convert",
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
    cat: "Convert",
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
    cat: "Convert",
    accept: "application/pdf",
    params: [],
    run: async (f) => [await pdf.pdfToText(f[0])],
  },
  {
    id: "txt2pdf",
    name: "Text → PDF",
    desc: "Lay a .txt / .md file out as an A4 PDF",
    icon: FileType,
    cat: "Convert",
    accept: "text/plain,text/markdown,.txt,.md",
    params: [],
    run: async (f) => [await pdf.textToPdf(f[0])],
  },
  {
    id: "csv2pdf",
    name: "CSV → PDF Table",
    desc: "Render a CSV as a printable table",
    icon: Table,
    cat: "Convert",
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
];

export const PDF_CATS = ["Organize", "Edit", "Convert", "Optimize"] as const;

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
  onComplete?: (toolId: string, files: string[]) => void;
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
        files.map((f) => f.name)
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white shadow-bento-hover p-6"
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
            className="rounded-lg p-1.5 text-brand-400 hover:bg-brand-50 cursor-pointer"
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
                className="text-xs text-brand-600 bg-brand-50 rounded-lg px-3 py-2 truncate"
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
                className="input"
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
                className="input"
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
                className="input"
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
                className="input"
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
                className="input"
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
                  className="w-full flex items-center justify-between bg-brand-50 hover:bg-brand-100 rounded-lg px-3 py-2 text-xs font-semibold text-brand-700 cursor-pointer transition-colors"
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
    </div>
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
