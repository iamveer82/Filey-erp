import { FileySpinner as Loader2 } from "../components/FileySpinner";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CheckCircle2, ArrowRight, ArrowLeft, ArrowUp, ArrowDown,
  FileText, Upload, FolderPlus, Download, X, Plus, ShieldCheck, RotateCcw, FileArchive,
} from "lucide-react";
import ToolsCatalogue from "../components/ToolsCatalogue";
import { plural } from "../lib/format";
import { agentStorageScope, AGENT_STORAGE_EVENT } from "../lib/agentStorage";
import { isLocalMode } from "../lib/dataMode";
import { useUI } from "../lib/ui";
import { downloadFile, zipOutputs, fileFromOutput, type OutFile } from "../lib/pdfTools";
import { PDF_TOOLS, toolById, toolFlow, type Tool, ToolFields, defaultParams } from "../components/PdfToolbox";
import ToolCover from "../components/ToolCover";
import InlinePdfEditor, { type PdfEditorHandle } from "../components/InlinePdfEditor";
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
import "./PdfTools.css";

const LIVE_PREVIEW_TOOLS = new Set([
  "numbers", "watermark", "img-watermark", "nup", "crop",
  "remove-annots", "header-footer", "greyscale",
]);
export default function ToolsPage() {
  const [scope, setScope] = useState(agentStorageScope);
  useEffect(() => {
    const refresh = () => setScope(agentStorageScope());
    for (const event of [AGENT_STORAGE_EVENT, "storage", "filey:workspace-changed"]) window.addEventListener(event, refresh);
    return () => { for (const event of [AGENT_STORAGE_EVENT, "storage", "filey:workspace-changed"]) window.removeEventListener(event, refresh); };
  }, []);
  return <ToolsSession key={scope ?? "guest"} />;
}

function ToolsSession() {
  const [params, setParams] = useSearchParams();
  const active = toolById(params.get("tool") || "");
  const [handoff, setHandoff] = useState<{ tool: string; files: File[]; revision: string } | null>(null);
  const open = (tool: Tool, files: File[] = []) => {
    setHandoff({ tool: tool.id, files, revision: crypto.randomUUID() });
    setParams(previous => { const next = new URLSearchParams(previous); next.set("tool", tool.id); return next; });
  };
  const close = () => {
    setHandoff(null);
    setParams(previous => { const next = new URLSearchParams(previous); next.delete("tool"); return next; });
  };
  if (active) return <PdfToolWorkspace key={active.id + ":" + (handoff?.tool === active.id ? handoff.revision : "")} tool={active}
    initialFiles={handoff?.tool === active.id ? handoff.files : []} onBack={close} onContinue={open} />;
  return <>
    {params.get("tool") && <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 text-sm">
      <span>This tool could not be found. Choose one below.</span><button className="btn-ghost" onClick={close}>Dismiss</button>
    </div>}
    <ToolsCatalogue category={params.get("category") || "All tools"} query={params.get("q") || ""} onOpen={tool => open(tool)}
      onFilter={(category, query) => setParams(previous => {
        const next = new URLSearchParams(previous);
        next.delete("tool");
        if (category === "All tools") next.delete("category"); else next.set("category", category);
        if (query) next.set("q", query); else next.delete("q");
        return next;
      }, { replace: true })} />
  </>;
}

function PdfToolWorkspace({
  tool,
  onBack,
  initialFiles,
  onContinue,
}: {
  tool: Tool;
  onBack: () => void;
  initialFiles: File[];
  onContinue: (tool: Tool, files: File[]) => void;
}) {
  const { toast } = useUI();
  const { user } = useAuth();
  const [files, setFiles] = useState<File[]>(initialFiles);
  const [params, setParams] = useState<Record<string, string>>(() => defaultParams(tool));
  const [running, setRunning] = useState(false);
  const [outs, setOuts] = useState<OutFile[]>([]);
  const [savingFiles, setSavingFiles] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [nextTool, setNextTool] = useState("");
  const mounted = useRef(true);
  const scope = useRef(agentStorageScope());
  const [fileRevision, setFileRevision] = useState(0);
  const inputRevision = useRef(0);
  const resultsRef = useRef<HTMLElement>(null);
  useEffect(() => { if (outs.length) resultsRef.current?.focus(); }, [outs]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const operation = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState("");
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.abort(); }; }, []);
  const editorRef = useRef<PdfEditorHandle>(null);
  const actionLabel = toolAction(tool);
  const canSave = !isLocalMode() && isConfigured && !!user && outs.length > 0;
  const locked = running || savingFiles || downloading;
  const checkScope = () => {
    if (!mounted.current || scope.current !== agentStorageScope()) throw new Error("Workspace changed. Open this tool again before saving output.");
  };
  const outputFiles = useMemo(() => outs.map(fileFromOutput), [outs]);
  const compatible = PDF_TOOLS.filter(candidate => candidate.id !== tool.id && (candidate.id !== "add-attach" || outputFiles[0]?.type === "application/pdf") && (candidate.multi || outs.length === 1) && outputFiles.length > 0 && outputFiles.every(file => acceptsFile(file, candidate.accept)));

  const saveToMyFiles = async () => {
    if (busy.current || locked || !outs.length) return;
    busy.current = true;
    setSavingFiles(true);
    try {
      checkScope();
      for (const o of outs) { checkScope(); await saveOutput(o, tool.name); }
      checkScope();
      toast.success(
        `Saved ${outs.length} file${outs.length > 1 ? "s" : ""} to My Files.`
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingFiles(false);
      busy.current = false;
    }
  };
  const Icon = tool.icon;
  const first = files[0];
  const firstIsPdf =
    !!first && (first.type === "application/pdf" || /\.pdf$/i.test(first.name));
  const updateFiles = (next: File[]) => {
    setFiles(next);
    inputRevision.current += 1;
    setFileRevision(inputRevision.current);
    setProgress("");
    setOuts([]);
    setNextTool("");
    setError("");
  };
  const replaceFirstFile = (file: File) => updateFiles([file, ...files.slice(1)]);
  const pickFiles = (list: FileList | File[] | null) => {
    if (!list?.length || running || savingFiles || downloading) return;
    const incoming = Array.from(list);
    const invalid = incoming.find(file => !acceptsFile(file, tool.accept));
    if (invalid) { setError(`${invalid.name} is not supported by ${tool.name}. Choose ${toolFlow(tool).from} files.`); return; }
    if (!tool.multi && incoming.length > 1) { setError("This tool works with one file at a time. Choose one file to continue."); return; }
    if (incoming.some(file => file.size === 0)) { setError("One of these files is empty. Choose a file with content."); return; }
    updateFiles(tool.multi ? [...files, ...incoming] : incoming);
  };
  const run = async () => {
    if (busy.current || running || savingFiles || downloading) return;
    if (!files.length) {
      toast.error("Upload a file first.");
      return;
    }
    const controller = new AbortController();
    operation.current = controller;
    const scope = agentStorageScope();
    setProgress("Preparing file…");
    setRunning(true);
    busy.current = true;
    setError("");
    setOuts([]);
    try {
      const edited = await editorRef.current?.prepare();
      controller.signal.throwIfAborted();
      const result = await tool.run(edited ? [edited, ...files.slice(1)] : files, params, {signal:controller.signal,onProgress:setProgress});
      controller.signal.throwIfAborted();
      if(scope !== agentStorageScope()) throw new Error("Workspace changed. Open this tool again before saving output.");
      operation.current = null;
      setProgress("Conversion complete. Results ready.");
      await finishOutputs(result);
      if (tool.id === "compress" && result[0]?.bytes.length >= (edited || files[0]).size)
        setProgress("This PDF is already optimized. The original size and quality have been preserved.");
    } catch (e) {
      if(controller.signal.aborted) setProgress("Conversion cancelled. Original files are unchanged.");
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      operation.current = null;
      setRunning(false);
      busy.current = false;
    }
  };

  const downloadOutputs = async (outputs: OutFile[], bundle = false) => {
    if (busy.current || locked) return;
    busy.current = true;
    setDownloading(true);
    try {
      checkScope();
      const downloads = bundle ? [zipOutputs(outputs)] : outputs;
      let saved = 0;
      for (const output of downloads) {
        checkScope();
        if (await downloadFile(output)) saved += 1;
      }
      if (saved === downloads.length) {
        toast.success(`Downloaded ${saved} file${saved === 1 ? "" : "s"}.`);
      } else {
        toast.info("Save canceled. Your output is ready; use Download results to try again.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the output. Try Download results again.");
    } finally {
      setDownloading(false);
      busy.current = false;
    }
  };
  const finishOutputs = async (outputs: OutFile[]) => {
    if (!outputs.length) throw new Error("No output was generated. Check the file and tool options.");
    checkScope();
    setOuts(outputs);
    setNextTool("");
    setProgress("Your results are ready. Download or continue with another tool.");
  };
  const acceptOutputs = async (outputs: OutFile[]) => {
    if (inputRevision.current !== fileRevision || !mounted.current) return;
    if (busy.current || running || savingFiles || downloading) return;
    busy.current = true;
    setRunning(true);
    setError("");
    try { await finishOutputs(outputs); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { busy.current = false; setRunning(false); }
  };

  return (
    <div className="tools-page">
      <div className="tool-workspace-header">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button onClick={onBack} disabled={running || savingFiles || downloading} className="btn-ghost shrink-0">
            <ArrowLeft size={14} /> All tools
          </button>
          <span className="hidden h-8 w-px bg-border sm:block" />
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground">
            <Icon size={18} />
          </span>
          <div className="tool-workspace-title min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[18px] font-semibold text-foreground">{tool.name}</h1>
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
            <p className="mt-1 max-w-prose text-xs text-muted-foreground">{tool.desc}</p>
          </div>
          {(files.length > 0 || tool.interactive === "esign") && <button type="button" className="btn-ghost" disabled={running || savingFiles || downloading} onClick={() => fileInput.current?.click()}>
            {tool.multi && files.length ? <Plus size={14} /> : <Upload size={14} />} {files.length ? tool.multi ? "Add files" : "Replace file" : "Choose file"}
          </button>}
            <input
              ref={fileInput}
              aria-label="Choose files for this tool"
              type="file"
              accept={tool.accept}
              multiple={tool.multi}
              disabled={running || savingFiles || downloading}
              className="hidden"
              onChange={(e) => { pickFiles(e.target.files); e.target.value = ""; }}
            />
        </div>
      </div>

      <ol className="tool-steps" aria-label="Tool progress">
        {[tool.interactive === "esign" ? "Create or upload" : "Choose files", "Edit & adjust", "Download"].map((label, index) => {
          const step = outs.length ? 2 : files.length || tool.interactive === "esign" ? 1 : 0;
          return <li key={label} aria-current={index === step ? "step" : undefined}><span className="tool-step-number">{index < step ? <CheckCircle2 size={14} /> : index + 1}</span>{label}</li>;
        })}
      </ol>
      {error && <div role="alert" className="mb-4 flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger"><span className="flex-1">{error}</span><button type="button" aria-label="Dismiss error" className="btn-ghost h-10 w-10 shrink-0 p-0" onClick={() => setError("")}><X size={16} /></button></div>}
      {!!outs.length && <section className="tool-results" aria-label="Your results" ref={resultsRef} tabIndex={-1}>
        {tool.id === "compress" && <p role="status" className="mb-4 text-sm text-muted-foreground">{outs[0].bytes.length < files[0].size ? `${fileSize(files[0].size)} → ${fileSize(outs[0].bytes.length)} · ${Math.round((1 - outs[0].bytes.length / files[0].size) * 100)}% smaller` : progress}</p>}
        <div className="tool-results-heading"><span className="tool-result-check"><CheckCircle2 size={24} /></span><div><h2>Your files are ready</h2><p>{plural(outs.length, "file")} · {fileSize(outs.reduce((sum, output) => sum + output.bytes.byteLength, 0))} · Original files unchanged</p></div>
          <button type="button" className="btn-primary" disabled={locked} onClick={() => void downloadOutputs(outs, outs.length > 1)}>{downloading ? <Loader2 size={16} className="animate-spin" /> : outs.length > 1 ? <FileArchive size={16} /> : <Download size={16} />}{outs.length > 1 ? "Download all as ZIP" : "Download results"}</button>
        </div>
        <div className="tool-result-files">{outs.map((output, index) => <div key={index} className="flex items-center gap-3 py-3"><FileText size={18} className="shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{output.name}</p><p className="text-xs text-muted-foreground">{fileSize(output.bytes.byteLength)}</p></div><button type="button" className="btn-ghost" disabled={locked} aria-label={"Download " + output.name} onClick={() => void downloadOutputs([output])}><Download size={15} /><span className="hidden sm:inline">Download</span></button></div>)}</div>
        {compatible.length > 0 && <div className="tool-continue"><div><h3>Keep working on these files</h3><p>Pass your results straight to the next tool.</p></div><label className="sr-only" htmlFor="next-file-tool">Next tool</label><select id="next-file-tool" className="select" value={nextTool} disabled={locked} onChange={event => setNextTool(event.target.value)}><option value="">Choose next tool…</option>{compatible.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select><button type="button" className="btn-ghost" disabled={locked || !nextTool} onClick={() => { const next = compatible.find(candidate => candidate.id === nextTool); if (next) onContinue(next, outputFiles); }}>Continue <ArrowRight size={15} /></button></div>}
        <div className="tool-result-actions"><button type="button" className="btn-ghost" disabled={locked} onClick={() => { setOuts([]); setProgress(""); }}>Adjust again</button><button type="button" className="btn-ghost" disabled={locked} onClick={() => updateFiles([])}><RotateCcw size={15} />Start again</button>{canSave && <button type="button" className="btn-ghost" disabled={locked} onClick={saveToMyFiles}>{savingFiles ? <Loader2 size={15} className="animate-spin" /> : <FolderPlus size={15} />}Save to My Files</button>}<span>{canSave ? "Save to My Files uploads a copy to your cloud workspace." : "Results stay here until you leave this tool."}</span></div>
      </section>}
      {!outs.length && !!files.length && tool.interactive !== "merge" && <div className="tool-file-list" aria-label="Selected files">
        {files.map((file, index) => <div className="tool-file-row" key={index}>
          <FileText size={17} className="shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium" title={file.name}>{file.name}</p><p className="text-xs text-muted-foreground">{fileSize(file.size)}</p></div>
          {files.length > 1 && <><button type="button" className="btn-ghost h-10 w-10 shrink-0 p-0" aria-label={"Move " + file.name + " up"} disabled={running || savingFiles || downloading || index === 0} onClick={() => { const next = [...files]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; updateFiles(next); }}><ArrowUp size={14} /></button><button type="button" className="btn-ghost h-10 w-10 shrink-0 p-0" aria-label={"Move " + file.name + " down"} disabled={running || savingFiles || downloading || index === files.length - 1} onClick={() => { const next = [...files]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; updateFiles(next); }}><ArrowDown size={14} /></button></>}
          <button type="button" className="btn-ghost h-10 w-10 shrink-0 p-0" aria-label={"Remove " + file.name} disabled={running || savingFiles || downloading} onClick={() => updateFiles(files.filter((_, i) => i !== index))}><X size={15} /></button>
        </div>)}
      </div>}
      {downloading && <p role="status" className="mb-4 text-sm text-muted-foreground">Saving your download…</p>}
      {running && <p role="status" className="mb-4 flex items-center gap-2 text-sm"><Loader2 size={16} className="animate-spin" />Preparing your results. Keep this tool open.</p>}
      {progress && !outs.length && <div className="mb-4 flex flex-wrap items-center justify-between gap-3" role="status"><p className="text-sm text-muted-foreground">{progress}</p>{operation.current && <button className="btn-ghost" onClick={() => {operation.current?.abort();setProgress("Cancelling… finishing the current conversion step before releasing the files.");}}>Cancel conversion</button>}</div>}
      <fieldset hidden={outs.length > 0} key={tool.interactive === "merge" ? tool.id : fileRevision} inert={running || savingFiles || downloading} disabled={running || savingFiles || downloading} className="min-w-0">
      {!files.length && tool.interactive !== "esign" ? (
        <div className="tool-dropzone" data-dragging={dragging} onDragOver={event => { event.preventDefault(); if (!locked) setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); pickFiles(event.dataTransfer.files); }}>
          <div className="tool-upload-summary"><ToolCover tool={tool} /><h2>{tool.name}</h2><p>{tool.desc}</p><span><ShieldCheck size={14} /> Free, on-device processing</span></div>
          <div className="tool-upload-copy"><span className="tool-upload-icon"><Upload size={24} /></span><h2 className="text-lg font-semibold text-foreground">{dragging ? "Drop your files here" : "Add your " + toolFlow(tool).from + (tool.multi ? " files" : " file")}</h2><p className="max-w-sm text-sm text-muted-foreground">Drag {tool.multi ? "your files" : "a file"} here, or choose {tool.multi ? "them" : "one"} from your device.</p><button type="button" className="btn-primary" onClick={() => fileInput.current?.click()}><Upload size={16} />Choose {tool.multi ? "files" : "file"}</button><p className="text-xs text-muted-foreground">{tool.multi ? "Add multiple files, then arrange them in the order you want." : "Processed on your device. Your original stays unchanged."}</p></div>
        </div>
      ) : tool.interactive === "fill-form" ? (
        <div className="card">
          <FormFillPanel
            file={files[0] ?? undefined}
            onDone={(out) => { void acceptOutputs([out]); }}
          />
        </div>
      ) : tool.interactive === "esign" ? (
        <div className="tool-studio">
          <ESignStudio
            file={files[0] ?? undefined}
            onApply={(out) => { void acceptOutputs([out]); }}
          />
        </div>
      ) : tool.interactive === "merge" ? (
        <div className="tool-studio">
          <MergeStudio
            files={files}
            onFilesChange={updateFiles}
            onApply={(out) => { void acceptOutputs([out]); }}
          />
        </div>
      ) : tool.interactive === "organize" && firstIsPdf ? (
        <div className="tool-studio">
          <OrganizeStudio
            file={files[0]}
            action={
              tool.id === "split"
                ? "split"
                : tool.id === "extract"
                  ? "extract"
                  : "organize"
            }
            onApply={(outputs) => { void acceptOutputs(outputs); }}
          />
        </div>
      ) : tool.interactive === "rotate" && firstIsPdf ? (
        <div className="tool-studio">
          <RotateStudio
            file={files[0]}
            onApply={(out) => { void acceptOutputs([out]); }}
          />
        </div>
      ) : tool.interactive === "redact" && firstIsPdf ? (
        <div className="tool-studio">
          <RedactStudio
            file={files[0]}
            onApply={(out) => { void acceptOutputs([out]); }}
          />
        </div>
      ) : (tool.interactive === "stamp" ||
          tool.interactive === "text-stamp" ||
          tool.interactive === "image-watermark" ||
          tool.interactive === "logo" ||
          tool.interactive === "background") &&
        firstIsPdf ? (
        <div className="tool-studio">
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
            onApply={(out) => { void acceptOutputs([out]); }}
          />
        </div>
      ) : (
        <div className="tool-working-layout">
          <div className="tool-studio">
            <div className="tool-preview-heading">
              <p className="text-sm font-semibold text-foreground">
                {firstIsPdf
                  ? LIVE_PREVIEW_TOOLS.has(tool.id)
                    ? "Document preview"
                    : "Edit document"
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
                editorRef={editorRef}
                disabled={running || savingFiles || downloading}
                onDirtyChange={() => { setOuts([]); setProgress(""); }}
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
          <aside className="tool-options-panel">
            <div><h2 className="text-sm font-semibold text-foreground">Tool settings</h2><p className="mt-1 text-xs text-muted-foreground">Adjust your options, then create the result.</p></div>
            <fieldset disabled={running || savingFiles || downloading}>
              <ToolFields tool={tool} params={params} setParams={(next) => { setParams(next); setOuts([]); setNextTool(""); setProgress(""); }} />
            </fieldset>
            <button onClick={run} disabled={running || savingFiles || downloading} className="btn-primary w-full">
              {running ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Download size={15} />
              )}
              {running ? "Preparing file…" : actionLabel}
            </button>
            <p className="text-xs text-muted-foreground">Includes your edits. Creates a new copy.</p>
          </aside>
        </div>
      )}
      </fieldset>
    </div>
  );
}

function toolAction(tool: Tool) {
  const flow = toolFlow(tool);
  if (["To PDF", "From PDF", "Data"].includes(tool.cat) && flow.from !== flow.to && !["Report", "Export", "Data"].includes(flow.to)) return "Convert to " + flow.to;
  const labels: Record<string, string> = { nup: "Arrange pages", "pdf-info": "Export PDF details", "page-dims": "Export page sizes", "ocr-pdf": "Make searchable", "ocr-text": "Extract text", "pdf-to-pdfa": "Add archival metadata", "bg-color": "Apply background", greyscale: "Make greyscale", invert: "Invert colours", "pdf-meta": "Save PDF details", grid: "Add grid", posterize: "Create poster", booklet: "Create booklet", "pdf2zip": "Create ZIP", "pdf-flatten": "Flatten PDF" };
  return labels[tool.id] || tool.name;
}

function fileSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function acceptsFile(file: File, accept: string) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const mime: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", bmp: "image/bmp" };
  const type = file.type.toLowerCase() || mime[extension] || "";
  return !accept || accept.split(",").some(value => {
    const rule = value.trim().toLowerCase();
    return rule === "*/*" || (rule.startsWith(".") ? file.name.toLowerCase().endsWith(rule) : rule.endsWith("/*") ? type.startsWith(rule.slice(0, -1)) : type === rule);
  });
}

function FilePreview({ file }: { file: File }) {
  const [img, setImg] = useState<string>("");
  const [text, setText] = useState<string>("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let dead = false;
    setImg("");
    setText("");
    setLoading(true);
    (async () => {
      try {
        if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)) {
          const image = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          });
          if (!dead) setImg(image);
        } else if (
          file.type.startsWith("text/") ||
          /\.(txt|csv|json|md)$/i.test(file.name)
        ) {
          const t = await file.text();
          if (!dead) setText(t.slice(0, 4000));
        }
      } catch {
        /* Some formats have no browser preview. */
      } finally { if (!dead) setLoading(false); }
    })();
    return () => {
      dead = true;
    };
  }, [file]);
  if (loading) return <p role="status" className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 size={18} className="animate-spin" />Loading preview…</p>;
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
          This format has no preview. Your file is ready to convert.
        </p>
      </div>
    </div>
  );
}
