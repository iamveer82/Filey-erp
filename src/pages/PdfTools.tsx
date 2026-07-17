import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CheckCircle2,
  LayoutGrid,
  Signature,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  FileText,
  Upload,
  Loader2,
  FolderPlus,
} from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
import { Card } from "../components/ui";
import FileCard from "../components/FileCard";
import { toolRuns } from "../lib/api";
import { useUI } from "../lib/ui";
import {
  uploadOutputs,
  ensureRoom,
} from "../lib/toolStorage";
import { downloadFile, type OutFile } from "../lib/pdfTools";
import {
  PDF_TOOLS,
  toolById,
  toolFlow,
  type Tool,
  ToolFields,
  defaultParams,
} from "../components/PdfToolbox";
import InlinePdfEditor from "../components/InlinePdfEditor";
import StampStudio from "../components/StampStudio";
import ESignStudio from "../components/ESignStudio";
import LivePreview from "../components/LivePreview";
import MergeStudio from "../components/MergeStudio";
import OrganizeStudio from "../components/OrganizeStudio";
import RedactStudio from "../components/RedactStudio";
import RotateStudio from "../components/RotateStudio";
import { useAuth } from "../lib/auth";
import { saveOutput } from "../lib/files";
import { isConfigured } from "../lib/supabase";

/** Page-visual, single-PDF tools whose effect can be shown live on page 1. */
const LIVE_PREVIEW_TOOLS = new Set([
  "numbers",
  "watermark",
  "img-watermark",
  "nup",
  "crop",
  "remove-annots",
  "header-footer",
  "greyscale",
]);

export default function ToolsPage() {
  const [active, setActive] = useState<Tool | null>(null);
  const [showAll, setShowAll] = useState(false);
  // Reset to 8-tool view when switching category tabs.
  const [cat, setCat] = useState<string>("All Tools");
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
  }, [params, active]);
  const { toast } = useUI();

  const logRun = async (toolId: string, files: string[], outputs: OutFile[]) => {
    const t = toolById(toolId);
    try {
      const runId = await toolRuns.log(toolId, t?.name ?? toolId, files[0] ?? "file");
      if (typeof runId === "number" && runId > 0) {
        const total = outputs.reduce((s, o) => s + o.bytes.byteLength, 0);
        const room = await ensureRoom(total);
        if (room) {
          const paths = await uploadOutputs(runId, outputs);
          if (paths.length) await toolRuns.setPaths(runId, paths, total);
        } else {
          toast.info("Storage quota full â€” output downloaded but not archived.");
        }
      }
    } catch {
      // Output already downloaded locally; only the archive copy failed.
      if (isConfigured)
        toast.info("Output downloaded, but couldn't be archived to recent activity.");
    }
  };

  const openTool = (toolId: string) => {
    setParams({ tool: toolId });
  };

  const cats = ["All Tools", ...Array.from(new Set(PDF_TOOLS.map((t) => t.cat)))];
  // Full set per tab â€” the grid shows the first 8 and "View all" reveals the
  // rest. (Previously capped at 11, which silently hid most of the ~50 tools.)
  const filteredTools =
    cat === "All Tools"
      ? PDF_TOOLS
      : PDF_TOOLS.filter((t) => t.cat === cat);

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
      {/* â”€â”€ Page header â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold text-foreground tracking-tight">Tools</h1>
        <p className="mt-1 text-sm text-brand-500 dark:text-brand-400">
          Convert, merge, split &amp; edit your files â€” all on-device
        </p>
      </div>

      {/* CATEGORY TABS */}
      <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
        {cats.map((c) => (
          <button
            key={c}
            onClick={() => {
              setCat(c);
              setShowAll(false);
            }}
            className={`whitespace-nowrap rounded-full px-4 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
              cat === c
                ? "bg-brand-100 text-ink dark:bg-white/10 dark:text-white"
                : "text-brand-500 hover:text-ink hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-white/5 dark:hover:text-white"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* TOOLS GRID */}
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {cat === "All Tools" && (
          <ToolMiniCard
            name="E-sign PDF"
            desc="Draw, type or upload â€” place & download"
            Icon={Signature}
            badgeBg="bg-primary-400"
            badgeFg="text-white"
            flow={{ from: "PDF", to: "PDF" }}
            onUse={() => setParams({ tool: "esign" })}
          />
        )}
        {(showAll ? filteredTools : filteredTools.slice(0, 8)).map((t) => (
          <ToolMiniCard
            key={t.id}
            name={t.name}
            desc={t.desc}
            Icon={t.icon}
            badgeBg="bg-primary-100 dark:bg-primary-400/15"
            badgeFg="text-ink dark:text-primary-300"
            flow={toolFlow(t)}
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
      <Card className="mb-4 p-4">
        <p className="mb-3 text-sm font-semibold text-ink">Works with your files</p>
        <div className="flex flex-wrap gap-x-6 gap-y-4">
          {(["pdf", "doc", "xls", "csv", "ppt", "img", "txt", "json"] as const).map(
            (f) => (
              <FileCard key={f} formatFile={f} />
            )
          )}
        </div>
      </Card>

      <p className="flex items-center gap-1.5 text-[11px] text-brand-400">
        <CheckCircle2 size={12} className="text-success" />
        All processing happens locally â€” files never leave this device.
      </p>
    </div>
  );
}

function ToolMiniCard({
  name,
  desc,
  Icon,
  badgeBg,
  badgeFg,
  flow,
  onUse,
}: {
  name: string;
  desc: string;
  Icon: typeof Sparkles;
  badgeBg: string;
  badgeFg: string;
  /** Inputâ†’output formats shown as a chip, e.g. { from: "DOCX", to: "PDF" }. */
  flow?: { from: string; to: string };
  onUse: () => void;
}) {
  return (
    <Card
      onClick={onUse}
      className="group flex flex-col gap-2 p-4 transition-transform duration-200 hover:scale-[1.02]"
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl transition-colors ${badgeBg} ${badgeFg}`}
        >
          <Icon size={20} />
        </span>
        {flow && (
          <span
            className="inline-flex items-center gap-0.5 rounded-full bg-brand-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-brand-500 dark:bg-white/5 dark:text-brand-400"
            title={`${flow.from} to ${flow.to}`}
          >
            {flow.from}
            <ArrowRight size={9} className="text-primary-400" />
            {flow.to}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm font-semibold leading-tight text-ink">{name}</p>
      <p className="line-clamp-2 text-xs text-brand-500 dark:text-brand-400">{desc}</p>
      <div className="mt-auto flex items-center pt-1">
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-400 transition-colors group-hover:text-ink dark:group-hover:text-white">
          Use tool <ArrowRight size={11} />
        </span>
      </div>
    </Card>
  );
}

/* â”€â”€ Per-tool workspace: sticky back nav, tool card, upload, live preview,
 options panel, run button. Minimal + professional. â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
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
  const { user } = useAuth();
  const [files, setFiles] = useState<File[]>([]);
  const [params, setParams] = useState<Record<string, string>>(() => defaultParams(tool));
  const [running, setRunning] = useState(false);
  const [outs, setOuts] = useState<OutFile[]>([]);
  const [savingFiles, setSavingFiles] = useState(false);
  const canSave = isConfigured && !!user && outs.length > 0;

  const saveToMyFiles = async () => {
    setSavingFiles(true);
    try {
      for (const o of outs) await saveOutput(o, tool.name);
      toast.success(
        `Saved ${outs.length} file${outs.length > 1 ? "s" : ""} to My Files.`
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingFiles(false);
    }
  };
  const Icon = tool.icon;
  const first = files[0];
  const firstIsPdf =
    !!first && (first.type === "application/pdf" || /\.pdf$/i.test(first.name));
  const replaceFirstFile = (f: File) =>
    setFiles((prev) => (prev.length ? [f, ...prev.slice(1)] : [f]));

  const pickFiles = (list: FileList | null) => {
    if (!list) return;
    setFiles(Array.from(list));
    setOuts([]);
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
      toast.success(
        `Done â€” ${result.length} file${result.length > 1 ? "s" : ""} downloaded.`
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="animate-fade-up">
      <div className="sticky top-0 z-30 -mx-4 mb-4 flex items-center gap-3 border-b border-brand-200 bg-white px-4 py-3">
        <button onClick={onBack} className="btn-ghost h-9">
          <ArrowLeft size={14} /> All tools
        </button>
        <span className="hidden h-5 w-px bg-brand-200 sm:block" />
        <span className="truncate text-sm font-medium text-ink">{tool.name}</span>
        {canSave && (
          <button
            onClick={saveToMyFiles}
            disabled={savingFiles}
            className="btn-ghost ml-auto h-9 text-xs"
          >
            {savingFiles ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <FolderPlus size={14} />
            )}
            Save to My Files
          </button>
        )}
        <span
          className={`hidden text-xs text-brand-400 sm:inline ${canSave ? "" : "ml-auto"}`}
        >
          {tool.cat}
        </span>
      </div>

      <div className="card mb-4 flex flex-wrap items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-primary-100 text-ink dark:bg-primary-400/15 dark:text-primary-300">
          <Icon size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-base font-medium text-ink">{tool.name}</p>
            {(() => {
              const fl = toolFlow(tool);
              return (
                <span
                  className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-500 dark:bg-white/5"
                  title={`${fl.from} to ${fl.to}`}
                >
                  {fl.from}
                  <ArrowRight size={10} className="text-primary-400" />
                  {fl.to}
                </span>
              );
            })()}
          </div>
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

      {tool.interactive === "esign" ? (
        <div className="card min-h-[480px]">
          <ESignStudio
            file={files[0] ?? undefined}
            onApply={(out) => {
              setOuts([out]);
              downloadFile(out);
              onComplete(tool.id, tool.name, files[0]?.name ?? "document", [out]);
              toast.success("Signed document downloaded.");
            }}
          />
          {!!outs.length && (
            <div className="mt-3 rounded-full border border-success/30 bg-success/10 px-3 py-2 text-xs font-medium text-success">
              âœ“ Signed document downloaded.
            </div>
          )}
        </div>
      ) : !files.length ? (
        <label className="grid h-72 cursor-pointer place-items-center rounded-2xl border-2 border-dashed border-brand-300 bg-white text-center text-sm text-brand-400 hover:bg-brand-50 dark:hover:bg-white/5">
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
            action={
              tool.id === "split"
                ? "split"
                : tool.id === "extract"
                  ? "extract"
                  : "organize"
            }
            onApply={(outsList) => {
              setOuts(outsList);
              outsList.forEach(downloadFile);
              onComplete(tool.id, tool.name, files[0].name, outsList);
              toast.success(
                `${outsList.length} file${outsList.length > 1 ? "s" : ""} downloaded.`
              );
            }}
          />
        </div>
      ) : tool.interactive === "rotate" && firstIsPdf ? (
        <div className="card min-h-[480px]">
          <RotateStudio
            file={files[0]}
            onApply={(out) => {
              setOuts([out]);
              downloadFile(out);
              onComplete(tool.id, tool.name, files[0].name, [out]);
              toast.success("Rotated PDF downloaded.");
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
            onApply={(out) => {
              setOuts([out]);
              downloadFile(out);
              onComplete(tool.id, tool.name, files[0].name, [out]);
              toast.success("Stamped PDF downloaded.");
            }}
          />
          {!!outs.length && (
            <div className="mt-3 rounded-full border border-success/30 bg-success/10 px-3 py-2 text-xs font-medium text-success">
              âœ“ Stamped PDF downloaded.
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="card min-h-[480px]">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-brand-500">
                {firstIsPdf
                  ? LIVE_PREVIEW_TOOLS.has(tool.id)
                    ? "Live Preview"
                    : "Editor"
                  : "Preview"}
              </p>
              {!firstIsPdf && files.length > 1 && (
                <span className="text-[11px] text-brand-400">
                  +{files.length - 1} more file{files.length - 1 > 1 ? "s" : ""}
                </span>
              )}
            </div>
            {LIVE_PREVIEW_TOOLS.has(tool.id) && firstIsPdf ? (
              <LivePreview tool={tool} file={files[0]} params={params} />
            ) : firstIsPdf ? (
              <InlinePdfEditor
                file={files[0]}
                onApply={(f) => {
                  replaceFirstFile(f);
                  setOuts([]);
                }}
              />
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
            <p className="text-sm font-medium text-ink">Options</p>
            <ToolFields tool={tool} params={params} setParams={setParams} />
            <button onClick={run} disabled={running} className="btn-primary w-full">
              {running ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Sparkles size={15} />
              )}
              Run {tool.name}
            </button>
            {!!outs.length && (
              <div className="rounded-full border border-success/30 bg-success/10 px-3 py-2 text-xs font-medium text-success">
                âœ“ {outs.length} file{outs.length > 1 ? "s" : ""} downloaded.
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
        } else if (
          file.type.startsWith("text/") ||
          /\.(txt|csv|json|md)$/i.test(file.name)
        ) {
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
        className="mx-auto max-h-[640px] rounded-2xl border border-brand-200"
      />
    );
  if (text)
    return (
      <pre className="max-h-[640px] overflow-auto rounded-2xl border border-brand-200 bg-brand-50 p-3 text-xs text-brand-700 dark:bg-white/8">
        {text}
      </pre>
    );
  return (
    <div className="grid h-64 place-items-center text-sm text-brand-400">
      <div className="text-center">
        <FileText size={28} className="mx-auto text-brand-300" />
        <p className="mt-1 text-ink">{file.name}</p>
        <p className="text-xs">
          Preview not available for this format â€” Run will still process it.
        </p>
      </div>
    </div>
  );
}
