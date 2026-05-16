import { useRef, useState } from "react";
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
  Upload,
  Download,
  Loader2,
  X,
  CheckCircle2,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as pdf from "../lib/pdfTools";
import type { OutFile } from "../lib/pdfTools";

type Param = "ranges" | "chunk" | "rotate" | "text";

interface Tool {
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

const TOOLS: Tool[] = [
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

const CATS = ["Organize", "Edit", "Convert", "Optimize"] as const;

export default function PdfToolbox() {
  const [active, setActive] = useState<Tool | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [params, setParams] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [results, setResults] = useState<OutFile[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const open = (t: Tool) => {
    setActive(t);
    setFiles([]);
    setResults([]);
    setErr("");
    setParams(
      t.id === "rotate"
        ? { rotate: "90" }
        : t.id === "split"
        ? { chunk: "1" }
        : {}
    );
  };

  const run = async () => {
    if (!active || !files.length) {
      setErr("Add at least one file first.");
      return;
    }
    setBusy(true);
    setErr("");
    setResults([]);
    try {
      setResults(await active.run(files, params));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="card mb-4 flex items-start gap-3">
        <div className="rounded-xl bg-primary-100 text-primary-700 p-2.5">
          <ShieldCheck size={20} />
        </div>
        <div>
          <p className="font-bold text-ink">Local PDF Tools</p>
          <p className="text-sm text-brand-500 mt-0.5">
            Every tool runs 100% on this device — files never leave the
            desktop app. Inspired by the open-source PDFCraft toolkit.
          </p>
        </div>
      </div>

      {CATS.map((cat) => (
        <div key={cat} className="mb-5">
          <p className="text-xs font-bold uppercase tracking-wider text-brand-400 mb-2.5">
            {cat}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {TOOLS.filter((t) => t.cat === cat).map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => open(t)}
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
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4"
          onClick={() => setActive(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white shadow-bento-hover p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="rounded-xl bg-primary-100 text-primary-700 p-2">
                  <active.icon size={18} />
                </div>
                <h2 className="text-lg font-bold text-ink">{active.name}</h2>
              </div>
              <button
                onClick={() => setActive(null)}
                aria-label="Close"
                className="rounded-lg p-1.5 text-brand-400 hover:bg-brand-50 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-sm text-brand-500 mb-4">{active.desc}</p>

            <label className="btn-ghost w-full justify-center mb-3">
              <Upload size={15} />
              {active.multi ? "Select files" : "Select file"}
              <input
                ref={fileRef}
                type="file"
                accept={active.accept}
                multiple={active.multi}
                className="hidden"
                onChange={(e) =>
                  setFiles(Array.from(e.target.files ?? []))
                }
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
              {active.params.includes("ranges") && (
                <div>
                  <label className="label">
                    Pages {active.id === "rotate" && "(optional)"}
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
              {active.params.includes("chunk") && (
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
              {active.params.includes("rotate") && (
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
              {active.params.includes("text") && (
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
              <button
                className="btn-ghost"
                onClick={() => setActive(null)}
              >
                Close
              </button>
              <button
                className="btn-primary"
                disabled={busy}
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
      )}
    </div>
  );
}
