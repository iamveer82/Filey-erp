import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CheckCircle2,
  LayoutGrid,
  Download,
  SquarePen,
  Eye,
  Signature,
  Sparkles,
  Wand2,
  Star,
  ChevronRight,
  ArrowRight,
  ArrowLeft,
  FileText,
  Upload,
  Loader2,
  X,
} from "lucide-react";
import { motion } from "framer-motion";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
import { PageHeader, InfoCard } from "../components/ui";
import FileCard from "../components/FileCard";
import ColorOrb from "../components/ColorOrb";
import { toolRuns } from "../lib/api";
import { useUI } from "../lib/ui";
import {
  uploadOutputs,
  downloadBytes,
  fileNameOf,
  ensureRoom,
  usedBytes,
  STORAGE_QUOTA_BYTES,
} from "../lib/toolStorage";
import { downloadFile, type OutFile } from "../lib/pdfTools";
import {
  PDF_TOOLS,
  toolById,
  type Tool,
  ToolFields,
  defaultParams,
} from "../components/PdfToolbox";
import PreviewModal from "../components/PreviewModal";
import EsignModal from "../components/EsignModal";
import InlinePdfEditor from "../components/InlinePdfEditor";
import StampStudio from "../components/StampStudio";
import LivePreview from "../components/LivePreview";
import MergeStudio from "../components/MergeStudio";
import OrganizeStudio from "../components/OrganizeStudio";
import RedactStudio from "../components/RedactStudio";
import { useAuth } from "../lib/auth";

/** Page-visual, single-PDF tools whose effect can be shown live on page 1. */
const LIVE_PREVIEW_TOOLS = new Set([
  "rotate",
  "numbers",
  "watermark",
  "img-watermark",
  "nup",
  "crop",
  "remove-annots",
  "header-footer",
  "greyscale",
]);

interface RunLog {
  id: number;
  toolId: string;
  toolName: string;
  file: string;
  paths: string[];
  ts: number;
}

function mb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ago(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function ToolsPage() {
  const [active, setActive] = useState<Tool | null>(null);
  const [runs, setRuns] = useState<RunLog[]>([]);
  const [showAll, setShowAll] = useState(false);
  // Reset to 8-tool view when switching category tabs.
  const [esignOpen, setEsignOpen] = useState(false);
  const [cat, setCat] = useState<string>("All Tools");
  const { profile } = useAuth();
  const firstName = profile?.name?.split(" ")[0] || "there";
  const [params, setParams] = useSearchParams();
  const closeActive = () => setParams({});

  // Each tool gets its own URL (?tool=<id>) so links are shareable and the
  // browser Back button returns to the dashboard.
  useEffect(() => {
    const id = params.get("tool");
    if (!id) {
      if (active) setActive(null);
      return;
    }
    if (active?.id !== id) {
      const t = toolById(id);
      if (t) setActive(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);
  const [preview, setPreview] = useState<RunLog | null>(null);
  const [used, setUsed] = useState(0);
  const { toast } = useUI();

  const refreshRuns = () => {
    toolRuns
      .list()
      .then((rows) =>
        setRuns(
          rows.slice(0, 20).map((r) => ({
            id: r.id,
            toolId: r.tool,
            toolName: r.tool_name,
            file: r.file_name,
            paths: r.storage_paths ?? [],
            ts: new Date(r.created_at).getTime(),
          }))
        )
      )
      .catch(() => {});
    usedBytes().then(setUsed).catch(() => {});
  };

  useEffect(() => {
    refreshRuns();
  }, []);

  const logRun = async (
    toolId: string,
    files: string[],
    outputs: OutFile[]
  ) => {
    const t = toolById(toolId);
    try {
      const runId = await toolRuns.log(
        toolId,
        t?.name ?? toolId,
        files[0] ?? "file"
      );
      if (typeof runId === "number" && runId > 0) {
        const total = outputs.reduce((s, o) => s + o.bytes.byteLength, 0);
        const room = await ensureRoom(total);
        if (room) {
          const paths = await uploadOutputs(runId, outputs);
          if (paths.length) await toolRuns.setPaths(runId, paths, total);
        }
      }
    } catch {
      /* offline / storage unavailable — log still recorded */
    }
    refreshRuns();
  };

  const openTool = (toolId: string) => {
    setParams({ tool: toolId });
  };

  const downloadRun = async (r: RunLog) => {
    if (!r.paths.length) {
      openTool(r.toolId);
      return;
    }
    try {
      for (const p of r.paths) {
        const got = await downloadBytes(p);
        if (got) downloadFile({ name: fileNameOf(p), bytes: got.bytes });
      }
    } catch (e) {
      toast.error(
        `Could not download: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  };

  const cats = ["All Tools", ...Array.from(new Set(PDF_TOOLS.map((t) => t.cat)))];
  const filteredTools =
    cat === "All Tools"
      ? PDF_TOOLS.slice(0, 11)
      : PDF_TOOLS.filter((t) => t.cat === cat).slice(0, 11);
  const askFiley = () => window.dispatchEvent(new Event("filey:copilot:open"));

  if (active) {
    return (
      <PdfToolWorkspace
        tool={active}
        onBack={closeActive}
        onComplete={(toolId, _toolName, file, outs) => logRun(toolId, [file], outs)}
      />
    );
  }

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Tools"
        subtitle="An AI workspace assistant that helps manage files intelligently"
      />

      <div className="grid lg:grid-cols-[1fr_340px] gap-5 items-start">
        {/* ── Main column ─────────────────────────────────────────────────── */}
        <main className="min-w-0">
          {/* CATEGORY TABS */}
          <div className="mb-4 flex gap-1 overflow-x-auto border-b border-brand-200/60 dark:border-[#3A3D45]">
            {cats.map((c) => (
              <button
                key={c}
                onClick={() => {
                  setCat(c);
                  setShowAll(false);
                }}
                className={`relative whitespace-nowrap px-3 py-2 text-sm font-semibold transition-colors cursor-pointer ${
                  cat === c ? "text-ink" : "text-brand-500 hover:text-ink"
                }`}
              >
                {c}
                {cat === c && (
                  <motion.span
                    layoutId="tools-tab-underline"
                    className="absolute -bottom-px left-0 right-0 h-0.5 rounded bg-primary-400"
                  />
                )}
              </button>
            ))}
          </div>

          {/* TOOLS GRID */}
          <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {cat === "All Tools" && (
              <ToolMiniCard
                name="E-sign PDF"
                desc="Draw, type or upload — place &amp; download"
                Icon={Signature}
                badgeBg="bg-primary-400"
                badgeFg="text-[#0A0A0A]"
                onUse={() => setEsignOpen(true)}
              />
            )}
            {(showAll ? filteredTools : filteredTools.slice(0, 8)).map((t) => (
              <ToolMiniCard
                key={t.id}
                name={t.name}
                desc={t.desc}
                Icon={t.icon}
                badgeBg="bg-primary-100 dark:bg-primary-400/15"
                badgeFg="text-primary-700 dark:text-primary-300"
                onUse={() => openTool(t.id)}
              />
            ))}
          </div>

          {filteredTools.length > 8 && !showAll && (
            <div className="mb-4 flex justify-center">
              <button onClick={() => setShowAll(true)} className="btn-ghost">
                <LayoutGrid size={14} /> View all {filteredTools.length} tools
              </button>
            </div>
          )}

          {/* Supported formats */}
          <InfoCard title="Works with your files" className="mb-4">
            <p className="-mt-3 mb-5 text-xs text-brand-400">
              Convert, merge, split &amp; export across formats — all on-device
            </p>
            <div className="flex flex-wrap gap-x-6 gap-y-4">
              {(["pdf", "doc", "xls", "csv", "ppt", "img", "txt", "json"] as const).map(
                (f) => (
                  <FileCard key={f} formatFile={f} />
                )
              )}
            </div>
          </InfoCard>

          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-brand-400">
            <CheckCircle2 size={12} className="text-success" />
            All processing happens locally — files never leave this device.
          </p>
        </main>

        {/* ── Right AI panel ──────────────────────────────────────────────── */}
        <aside className="space-y-4 self-start lg:sticky lg:top-4">
          {/* Filey Assistant chat */}
          <div className="rounded-[28px] border border-black/[0.04] bg-white p-4 shadow-bento dark:border-white/[0.06] dark:bg-[#1E2025]">
            <div className="mb-3 flex items-center gap-2">
              <ColorOrb dimension="22px" />
              <span className="text-sm font-bold text-ink">Filey Assistant</span>
              <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" /> Online
              </span>
            </div>
            <div className="rounded-2xl bg-brand-50 px-3 py-2 text-sm leading-snug text-ink dark:bg-white/5">
              Hi {firstName} 👋
              <br />
              What would you like to do today?
            </div>
            <div className="mt-3 space-y-1.5">
              {[
                "Merge multiple PDFs",
                "Extract invoice data",
                "Organize documents",
                "Summarize long PDFs",
              ].map((s) => (
                <button
                  key={s}
                  onClick={askFiley}
                  className="flex w-full items-center justify-between rounded-xl border border-brand-200 bg-white px-3 py-2 text-xs font-semibold text-brand-600 transition hover:border-primary-300 hover:text-ink dark:border-[#3A3D45] dark:bg-[#24262C] dark:text-[#DDE0E4] dark:hover:text-[#F4F5F6] cursor-pointer"
                >
                  {s} <ChevronRight size={12} />
                </button>
              ))}
            </div>
            <motion.button
              whileHover={{ scale: 1.02 }}
              onClick={askFiley}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold text-white cursor-pointer"
              style={{ background: "linear-gradient(135deg,#8B5CF6,#7C4DFF)" }}
            >
              Ask Filey Anything <ArrowRight size={14} />
            </motion.button>
          </div>

          {/* Smart recommendations */}
          <div className="rounded-[28px] border border-black/[0.04] bg-white p-4 shadow-bento dark:border-white/[0.06] dark:bg-[#1E2025]">
            <p className="mb-3 text-sm font-bold text-ink">Smart suggestions</p>
            <div className="space-y-1.5">
              {[
                {
                  Icon: Wand2,
                  color: "#8B5CF6",
                  title: "Extract tables from invoices",
                  desc: "Turn PDF tables into a spreadsheet",
                  onClick: askFiley,
                },
                {
                  Icon: FileText,
                  color: "#FFD600",
                  title: "Compress large reports",
                  desc: "Shrink heavy PDFs in seconds",
                  onClick: () => openTool("compress"),
                },
                {
                  Icon: LayoutGrid,
                  color: "#2CADF6",
                  title: "Merge multiple PDFs",
                  desc: "Combine into one document",
                  onClick: () => openTool("merge"),
                },
              ].map((r) => (
                <button
                  key={r.title}
                  onClick={r.onClick}
                  className="flex w-full items-center gap-3 rounded-2xl p-2.5 text-left transition hover:bg-brand-50 dark:hover:bg-white/5 cursor-pointer"
                >
                  <span
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
                    style={{ background: r.color + "22", color: r.color }}
                  >
                    <r.Icon size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-bold text-ink">{r.title}</span>
                    <span className="block truncate text-[11px] text-brand-400">{r.desc}</span>
                  </span>
                  <ChevronRight size={14} className="shrink-0 text-brand-300" />
                </button>
              ))}
            </div>
          </div>

          {/* Recent activity */}
          <div className="rounded-[28px] border border-black/[0.04] bg-white p-4 shadow-bento dark:border-white/[0.06] dark:bg-[#1E2025]">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-bold text-ink">Recent activity</p>
              <span className="text-[10px] font-semibold text-brand-400">
                {mb(used)} / {mb(STORAGE_QUOTA_BYTES)}
              </span>
            </div>
            {runs.length === 0 ? (
              <p className="text-xs text-brand-400">
                Nothing yet — processed files will appear here.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {runs.slice(0, 5).map((r) => (
                  <li key={r.id} className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-ink">
                        {r.toolName}
                      </span>
                      <span className="block truncate text-[10px] text-brand-400">
                        {r.file} · {ago(r.ts)}
                      </span>
                    </span>
                    <button
                      onClick={() => setPreview(r)}
                      aria-label="Preview"
                      className="cursor-pointer text-brand-400 hover:text-ink"
                    >
                      <Eye size={13} />
                    </button>
                    <button
                      onClick={() => downloadRun(r)}
                      aria-label="Download"
                      className="cursor-pointer text-brand-400 hover:text-ink"
                    >
                      <Download size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Feedback */}
          <div className="rounded-[28px] border border-black/[0.04] p-4 text-center shadow-bento dark:border-white/[0.06]"
            style={{ background: "linear-gradient(135deg,#FFF9E6,#FFFDF2)" }}
          >
            <p className="text-sm font-bold text-ink">Love Filey Tools?</p>
            <div className="mt-2 flex justify-center gap-1">
              {[1, 2, 3, 4, 5].map((i) => (
                <button
                  key={i}
                  aria-label={`${i} star`}
                  className="cursor-pointer text-primary-500 transition hover:scale-110"
                >
                  <Star size={18} fill="currentColor" />
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-brand-400">Tap to rate</p>
          </div>
        </aside>
      </div>

      {/* modals (workspace renders as a full page above when active) */}
      <EsignModal open={esignOpen} onClose={() => setEsignOpen(false)} />
      <PreviewModal
        open={!!preview}
        title={preview?.file}
        paths={preview?.paths ?? []}
        onClose={() => setPreview(null)}
      />
    </div>
  );
}

function ToolMiniCard({
  name,
  desc,
  Icon,
  badgeBg,
  badgeFg,
  onUse,
}: {
  name: string;
  desc: string;
  Icon: typeof Sparkles;
  badgeBg: string;
  badgeFg: string;
  onUse: () => void;
}) {
  return (
    <motion.button
      onClick={onUse}
      whileHover={{ y: -3 }}
      className="group flex flex-col gap-2 rounded-3xl border border-black/[0.04] bg-white p-4 text-left shadow-bento transition-shadow hover:shadow-bento-hover dark:border-white/[0.06] dark:bg-[#1E2025] cursor-pointer"
    >
      <span
        className={`grid h-12 w-12 place-items-center rounded-2xl transition-colors ${badgeBg} ${badgeFg}`}
      >
        <Icon size={22} />
      </span>
      <p className="mt-1 text-[15px] font-bold leading-tight text-ink">{name}</p>
      <p className="line-clamp-2 text-xs text-brand-500">{desc}</p>
      <div className="mt-auto flex items-center justify-between pt-2">
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-400">
          Use tool <ArrowRight size={11} />
        </span>
        <Star
          size={13}
          className="cursor-pointer text-brand-300 hover:text-primary-500"
          onClick={(e) => {
            e.stopPropagation();
          }}
        />
      </div>
    </motion.button>
  );
}

/* ── Per-tool workspace: sticky back nav, tool card, upload, live preview,
   options panel, run button. Minimal + professional. ───────────────────── */
function PdfToolWorkspace({
  tool,
  onBack,
  onComplete,
}: {
  tool: Tool;
  onBack: () => void;
  onComplete: (toolId: string, toolName: string, file: string, outs: OutFile[]) => void;
}) {
  const { toast } = useUI();
  const [files, setFiles] = useState<File[]>([]);
  const [params, setParams] = useState<Record<string, string>>(() =>
    defaultParams(tool)
  );
  const [running, setRunning] = useState(false);
  const [outs, setOuts] = useState<OutFile[]>([]);
  const [editing, setEditing] = useState(false);
  const Icon = tool.icon;
  const first = files[0];
  const firstIsPdf = !!first && (first.type === "application/pdf" || /\.pdf$/i.test(first.name));
  const replaceFirstFile = (f: File) =>
    setFiles((prev) => (prev.length ? [f, ...prev.slice(1)] : [f]));

  const pickFiles = (list: FileList | null) => {
    if (!list) return;
    setFiles(Array.from(list));
    setOuts([]);
    setEditing(false);
  };
  const run = async () => {
    if (!files.length) {
      toast.error("Upload a file first.");
      return;
    }
    setRunning(true);
    try {
      const result = await tool.run(files, params);
      setOuts(result);
      for (const o of result) downloadFile(o);
      onComplete(tool.id, tool.name, files[0].name, result);
      toast.success(`Done — ${result.length} file${result.length > 1 ? "s" : ""} downloaded.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="animate-fade-up">
      <div className="sticky top-0 z-30 -mx-4 mb-4 flex items-center gap-3 border-b border-brand-200 bg-white/85 px-4 py-3 backdrop-blur-md dark:border-[#3A3D45] dark:bg-[#15161A]/85">
        <button onClick={onBack} className="btn-ghost h-9">
          <ArrowLeft size={14} /> All tools
        </button>
        <span className="hidden h-5 w-px bg-brand-200 dark:bg-[#3A3D45] sm:block" />
        <span className="truncate text-sm font-bold text-ink">{tool.name}</span>
        <span className="ml-auto hidden text-xs text-brand-400 sm:inline">{tool.cat}</span>
      </div>

      <div className="card mb-4 flex flex-wrap items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary-100 text-primary-700 dark:bg-primary-400/15 dark:text-primary-300">
          <Icon size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold text-ink">{tool.name}</p>
          <p className="line-clamp-2 text-xs text-brand-500">{tool.desc}</p>
        </div>
        <label className="btn-primary cursor-pointer">
          <Upload size={14} />{" "}
          {files.length ? `${files.length} file${files.length > 1 ? "s" : ""}` : "Upload"}
          <input
            type="file"
            accept={tool.accept}
            multiple={tool.multi}
            className="hidden"
            onChange={(e) => pickFiles(e.target.files)}
          />
        </label>
      </div>

      {!files.length ? (
        <label className="grid h-72 cursor-pointer place-items-center rounded-2xl border-2 border-dashed border-brand-300 bg-white text-center text-sm text-brand-400 hover:bg-brand-50 dark:border-[#3A3D45] dark:bg-[#1E2025] dark:hover:bg-white/5">
          <div>
            <Upload size={22} className="mx-auto mb-1 text-brand-300" />
            Drop or choose {tool.multi ? "files" : "a file"} to preview here
            <input
              type="file"
              accept={tool.accept}
              multiple={tool.multi}
              className="hidden"
              onChange={(e) => pickFiles(e.target.files)}
            />
          </div>
        </label>
      ) : tool.interactive === "merge" ? (
        <div className="card min-h-[480px]">
          <MergeStudio
            files={files}
            onApply={(out) => {
              setOuts([out]);
              downloadFile(out);
              onComplete(tool.id, tool.name, files[0]?.name ?? "merge", [out]);
              toast.success("Merged PDF downloaded.");
            }}
          />
        </div>
      ) : tool.interactive === "organize" && firstIsPdf ? (
        <div className="card min-h-[480px]">
          <OrganizeStudio
            file={files[0]}
            action={tool.id === "split" ? "split" : tool.id === "extract" ? "extract" : "organize"}
            onApply={(outsList) => {
              setOuts(outsList);
              outsList.forEach(downloadFile);
              onComplete(tool.id, tool.name, files[0].name, outsList);
              toast.success(`${outsList.length} file${outsList.length > 1 ? "s" : ""} downloaded.`);
            }}
          />
        </div>
      ) : tool.interactive === "redact" && firstIsPdf ? (
        <div className="card min-h-[480px]">
          <RedactStudio
            file={files[0]}
            onApply={(out) => {
              setOuts([out]);
              downloadFile(out);
              onComplete(tool.id, tool.name, files[0].name, [out]);
              toast.success("Redacted PDF downloaded.");
            }}
          />
        </div>
      ) : (tool.interactive === "stamp" ||
          tool.interactive === "text-stamp" ||
          tool.interactive === "image-watermark" ||
          tool.interactive === "esign" ||
          tool.interactive === "logo" ||
          tool.interactive === "background") &&
        firstIsPdf ? (
        <div className="card min-h-[480px]">
          <StampStudio
            file={files[0]}
            mode={tool.interactive === "text-stamp" ? "text" : "image"}
            variant={
              tool.interactive === "image-watermark"
                ? "watermark"
                : tool.interactive === "logo"
                ? "logo"
                : tool.interactive === "background"
                ? "background"
                : "stamp"
            }
            allowDraw={tool.interactive === "esign"}
            onApply={(out) => {
              setOuts([out]);
              downloadFile(out);
              onComplete(tool.id, tool.name, files[0].name, [out]);
              toast.success("Stamped PDF downloaded.");
            }}
          />
          {!!outs.length && (
            <div className="mt-3 rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-xs font-semibold text-success">
              ✓ Stamped PDF downloaded.
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="card min-h-[480px]">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-brand-500">
                {editing ? "Editing" : "Preview"}
              </p>
              {firstIsPdf && (
                <button
                  onClick={() => setEditing((v) => !v)}
                  className="btn-ghost h-8 text-xs"
                  title={
                    editing
                      ? "Exit edit mode"
                      : "Add text, highlight, draw, crop, rotate or delete pages before running the tool"
                  }
                >
                  {editing ? (
                    <>
                      <X size={13} /> Close
                    </>
                  ) : (
                    <>
                      <SquarePen size={13} /> Edit PDF
                    </>
                  )}
                </button>
              )}
            </div>
            {editing && firstIsPdf ? (
              <InlinePdfEditor
                file={files[0]}
                onApply={(f) => {
                  replaceFirstFile(f);
                  setOuts([]);
                  setEditing(false);
                }}
              />
            ) : LIVE_PREVIEW_TOOLS.has(tool.id) && firstIsPdf ? (
              <LivePreview tool={tool} file={files[0]} params={params} />
            ) : (
              <>
                <FilePreview file={files[0]} />
                {files.length > 1 && (
                  <p className="mt-2 text-[11px] text-brand-400">
                    +{files.length - 1} more file{files.length - 1 > 1 ? "s" : ""}
                  </p>
                )}
              </>
            )}
          </div>
          <aside className="card space-y-3 self-start lg:sticky lg:top-20">
            <p className="text-sm font-bold text-ink">Options</p>
            <ToolFields tool={tool} params={params} setParams={setParams} />
            <button onClick={run} disabled={running} className="btn-primary w-full">
              {running ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              Run {tool.name}
            </button>
            {!!outs.length && (
              <div className="rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-xs font-semibold text-success">
                ✓ {outs.length} file{outs.length > 1 ? "s" : ""} downloaded.
              </div>
            )}
            <button onClick={() => setFiles([])} className="btn-ghost w-full">
              Choose another file
            </button>
          </aside>
        </div>
      )}

    </div>
  );
}

function FilePreview({ file }: { file: File }) {
  const [img, setImg] = useState<string>("");
  const [text, setText] = useState<string>("");
  useEffect(() => {
    let dead = false;
    setImg("");
    setText("");
    (async () => {
      try {
        if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
          const data = new Uint8Array(await file.arrayBuffer());
          const pdf = await pdfjs.getDocument({ data }).promise;
          const p = await pdf.getPage(1);
          const vp = p.getViewport({ scale: 1.4 });
          const c = document.createElement("canvas");
          c.width = vp.width;
          c.height = vp.height;
          const ctx = c.getContext("2d");
          if (!ctx) return;
          await p.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise;
          if (!dead) setImg(c.toDataURL("image/png"));
        } else if (file.type.startsWith("image/")) {
          const r = new FileReader();
          r.onload = () => !dead && setImg(String(r.result || ""));
          r.readAsDataURL(file);
        } else if (file.type.startsWith("text/") || /\.(txt|csv|json|md)$/i.test(file.name)) {
          const t = await file.text();
          if (!dead) setText(t.slice(0, 4000));
        }
      } catch {
        /* preview unavailable */
      }
    })();
    return () => {
      dead = true;
    };
  }, [file]);
  if (img)
    return (
      <img
        src={img}
        alt={file.name}
        className="mx-auto max-h-[640px] rounded-lg border border-brand-200 dark:border-[#3A3D45]"
      />
    );
  if (text)
    return (
      <pre className="max-h-[640px] overflow-auto rounded-lg border border-brand-200 bg-brand-50 p-3 text-xs text-brand-700 dark:border-[#3A3D45] dark:bg-white/5 dark:text-[#DDE0E4]">
        {text}
      </pre>
    );
  return (
    <div className="grid h-64 place-items-center text-sm text-brand-400">
      <div className="text-center">
        <FileText size={28} className="mx-auto text-brand-300" />
        <p className="mt-1 font-semibold text-ink">{file.name}</p>
        <p className="text-xs">Preview not available for this format — Run will still process it.</p>
      </div>
    </div>
  );
}

