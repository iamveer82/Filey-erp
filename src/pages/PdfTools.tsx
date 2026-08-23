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
import { Card, FilterChip, PageHeader, SearchInput } from "../components/ui";
import { plural } from "../lib/format";
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
import FormFillPanel from "../components/FormFillPanel";
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
  // 88 tools across 7 categories: chips alone meant scrolling to find one.
  const [query, setQuery] = useState("");
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
          toast.info("Storage quota full - output downloaded but not archived.");
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
  const needle = query.trim().toLowerCase();
  const filteredTools = PDF_TOOLS.filter((t) => {
    if (cat !== "All Tools" && t.cat !== cat) return false;
    if (!needle) return true;
    return (
      t.name.toLowerCase().includes(needle) ||
      t.desc.toLowerCase().includes(needle) ||
      t.cat.toLowerCase().includes(needle)
    );
  });

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
        subtitle="Convert, merge, split & edit your files, all on-device"
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search tools by name or what they do…"
          className="w-full max-w-sm"
        />
        <span className="text-[12.5px] text-muted-foreground">
          {plural(filteredTools.length, "tool")}
        </span>
      </div>

      {/* CATEGORY TABS */}
      <div className="mb-5 flex flex-wrap items-center gap-1.5">
        {cats.map((c) => (
          <FilterChip
            key={c}
            active={cat === c}
            onClick={() => {
              setCat(c);
              setShowAll(false);
            }}
          >
            {c}
          </FilterChip>
        ))}
      </div>

      {/* TOOLS GRID - joined quiet cards (DEMO parity): shared hairlines
          inside one rounded-xl border via .joined-kpis. */}
      <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 joined-kpis">
        {cat === "All Tools" && !needle && (
          <ToolMiniCard
            name="E-sign PDF"
            desc="Draw, type or upload - place & download"
            Icon={Signature}
            flow={{ from: "PDF", to: "PDF" }}
            onUse={() => setParams({ tool: "esign" })}
          />
        )}
        {/* A search is already a narrowing action, so don't re-hide its results
            behind "View all". */}
        {(showAll || needle ? filteredTools : filteredTools.slice(0, 8)).map((t) => (
          <ToolMiniCard
            key={t.id}
            name={t.name}
            desc={t.desc}
            Icon={t.icon}
            flow={toolFlow(t)}
            onUse={() => openTool(t.id)}
          />
        ))}
      </div>

      {filteredTools.length > 8 && !showAll && !needle && (
        <div className="mb-4 flex justify-center">
          <button onClick={() => setShowAll(true)} className="btn-ghost">
            <LayoutGrid size={14} /> View all {filteredTools.length} tools
          </button>
        </div>
      )}

      {needle && filteredTools.length === 0 && (
        <div className="mb-4 rounded-xl border border-border bg-card px-5 py-10 text-center">
          <p className="text-[13px] font-medium text-foreground">
            No tool matches “{query}”
          </p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Try a different word, or clear the search to browse all{" "}
            {PDF_TOOLS.length} tools.
          </p>
        </div>
      )}

      {/* Supported formats */}
      <Card className="mb-4 p-4">
        <p className="mb-3 text-sm font-semibold text-foreground">Works with your files</p>
        <div className="flex flex-wrap gap-x-6 gap-y-4">
          {(["pdf", "doc", "xls", "csv", "ppt", "img", "txt", "json"] as const).map(
            (f) => (
              <FileCard key={f} formatFile={f} />
            )
          )}
        </div>
      </Card>

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <CheckCircle2 size={12} className="text-success" />
        All processing happens locally - files never leave this device.
      </p>
    </div>
  );
}

function ToolMiniCard({
  name,
  desc,
  Icon,
  flow,
  onUse,
}: {
  name: string;
  desc: string;
  Icon: typeof Sparkles;
  /** Input→output formats shown as a chip, e.g. { from: "DOCX", to: "PDF" }. */
  flow?: { from: string; to: string };
  onUse: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onUse}
      className="cursor-pointer bg-card p-5 text-left transition-colors hover:bg-hover"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border bg-hover text-foreground">
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </span>
        {flow && (
          <span
            className="inline-flex items-center gap-0.5 rounded-full border border-border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground"
            title={`${flow.from} to ${flow.to}`}
          >
            {flow.from}
            <ArrowRight size={9} className="text-primary-400" />
            {flow.to}
          </span>
        )}
      </div>
      <div className="text-[14px] font-semibold text-foreground">{name}</div>
      <div className="mt-1 line-clamp-2 text-[12.5px] text-muted-foreground">{desc}</div>
    </button>
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
        `Done - ${result.length} file${result.length > 1 ? "s" : ""} downloaded.`
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="animate-fade-up">
      {/* One header, not two. The tool name used to appear in a sticky bar and
          again in a card 90px below it, with the category floating unanchored in
          the top-right corner. Everything identifying the tool now sits on one
          row, and it stays sticky so Upload stays reachable while scrolling. */}
      <div className="sticky top-0 z-30 -mx-4 mb-4 border-b border-border bg-page px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button onClick={onBack} className="btn-ghost shrink-0">
            <ArrowLeft size={14} /> All tools
          </button>
          <span className="hidden h-8 w-px bg-border sm:block" />
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground">
            <Icon size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-[15px] font-medium text-ink">{tool.name}</p>
              <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {tool.cat}
              </span>
              {(() => {
                const fl = toolFlow(tool);
                return fl.from === fl.to ? null : (
                  <span
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                    title={`${fl.from} to ${fl.to}`}
                  >
                    {fl.from}
                    <ArrowRight size={10} className="text-primary-400" />
                    {fl.to}
                  </span>
                );
              })()}
            </div>
            <p className="truncate text-xs text-brand-500">{tool.desc}</p>
          </div>
          {canSave && (
            <button onClick={saveToMyFiles} disabled={savingFiles} className="btn-ghost">
              {savingFiles ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <FolderPlus size={14} />
              )}
              Save to My Files
            </button>
          )}
          <label className="btn-primary cursor-pointer">
            <Upload size={14} /> {files.length ? plural(files.length, "file") : "Upload"}
            <input
              type="file"
              accept={tool.accept}
              multiple={tool.multi}
              className="hidden"
              onChange={(e) => pickFiles(e.target.files)}
            />
          </label>
        </div>
      </div>

      {tool.interactive === "fill-form" ? (
        <div className="card">
          <FormFillPanel
            file={files[0] ?? undefined}
            onDone={(out) => {
              setOuts([out]);
              downloadFile(out);
              onComplete(tool.id, tool.name, files[0]?.name ?? "document", [out]);
              toast.success("Filled form downloaded.");
            }}
          />
        </div>
      ) : tool.interactive === "esign" ? (
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
              ✓ Signed document downloaded.
            </div>
          )}
        </div>
      ) : !files.length ? (
        <label className="grid h-72 cursor-pointer place-items-center rounded-xl border-2 border-dashed border-border bg-card text-center text-sm text-muted-foreground hover:bg-hover">
          <div>
            <Upload size={22} className="mx-auto mb-1 text-muted-foreground" />
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
              ✓ Stamped PDF downloaded.
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
        className="mx-auto max-h-[640px] rounded-xl border border-border"
      />
    );
  if (text)
    return (
      <pre className="max-h-[640px] overflow-auto rounded-xl border border-border bg-muted p-3 text-xs text-foreground">
        {text}
      </pre>
    );
  return (
    <div className="grid h-64 place-items-center text-sm text-muted-foreground">
      <div className="text-center">
        <FileText size={28} className="mx-auto text-muted-foreground" />
        <p className="mt-1 text-ink">{file.name}</p>
        <p className="text-xs">
          Preview not available for this format - Run will still process it.
        </p>
      </div>
    </div>
  );
}
