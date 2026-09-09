import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  CheckCircle2, Sparkles, ArrowRight, ArrowLeft, ArrowUp, ArrowDown,
  FileText, Upload, Loader2, FolderPlus, Download, X, Plus, Search, ShieldCheck,
} from "lucide-react";
import * as safePdf from "../lib/pdfjsSafe";
import { FilterChip, PageHeader, SearchInput } from "../components/ui";
import { plural } from "../lib/format";
import { toolRuns } from "../lib/api";
import { useUI } from "../lib/ui";
import { uploadOutputs, ensureRoom } from "../lib/toolStorage";
import { downloadFile, type OutFile } from "../lib/pdfTools";
import { PDF_TOOLS, toolById, toolFlow, type Tool, ToolFields, defaultParams } from "../components/PdfToolbox";
import ToolCover from "../components/ToolCover";
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
import "./PdfTools.css";

const LIVE_PREVIEW_TOOLS = new Set([
  "numbers", "watermark", "img-watermark", "nup", "crop",
  "remove-annots", "header-footer", "greyscale",
]);
const POPULAR_TOOLS = ["merge", "img2pdf", "compress", "esign", "pdf2img", "watermark", "split", "csv2json"];

export default function ToolsPage() {
  const [cat, setCat] = useState("Popular");
  const [query, setQuery] = useState("");
  const [params, setParams] = useSearchParams();
  const active = toolById(params.get("tool") || "");
  const { toast } = useUI();
  const closeActive = () => setParams({});
  const logRun = async (toolId: string, files: string[], outputs: OutFile[]) => {
    try {
      const runId = await toolRuns.log(toolId, toolById(toolId)?.name ?? toolId, files[0] ?? "file");
      if (typeof runId === "number" && runId > 0) {
        const total = outputs.reduce((sum, out) => sum + out.bytes.byteLength, 0);
        if (await ensureRoom(total)) {
          const paths = await uploadOutputs(runId, outputs);
          if (paths.length) await toolRuns.setPaths(runId, paths, total);
        } else toast.info("Storage quota full — output is ready but was not archived.");
      }
    } catch {
      if (isConfigured) toast.info("Output is ready, but could not be archived to recent activity.");
    }
  };
  const categories = [...new Set(PDF_TOOLS.map(tool => tool.cat))];
  const popular = POPULAR_TOOLS.map(id => toolById(id)).filter((tool): tool is Tool => !!tool);
  const needle = query.trim().toLowerCase();
  const filtered = (cat === "Popular" && !needle ? (popular.length ? popular : PDF_TOOLS.slice(0, 8)) : PDF_TOOLS).filter(tool =>
    (cat === "Popular" || cat === "All tools" || tool.cat === cat) &&
    (!needle || (tool.name + " " + tool.desc + " " + tool.cat).toLowerCase().includes(needle))
  );
  if (active) return <PdfToolWorkspace key={active.id} tool={active} onBack={closeActive}
    onComplete={(id, _name, file, outputs) => { void logRun(id, [file], outputs); }} />;
  return <div className="tools-page">
    <PageHeader title="Tools" subtitle="A little help for every file. Convert, organise, edit and share."
      action={<Link to="/files" className="btn-ghost"><FolderPlus size={15} /> My Files</Link>} />
    {params.get("tool") && <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 text-sm">
      <span>This tool could not be found. Choose one below.</span><button className="btn-ghost" onClick={closeActive}>Dismiss</button>
    </div>}
    <div className="tools-toolbar">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchInput value={query} onChange={setQuery} placeholder="Search tools by name or what they do…" className="w-full max-w-md" />
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck size={15} /> Processed on this device</span>
      </div>
      <nav className="tools-categories" aria-label="Tool categories">
        {["Popular", "All tools", ...categories].map(category =>
          <FilterChip key={category} active={cat === category} onClick={() => setCat(category)}>
            {category}{category === "All tools" ? " · " + PDF_TOOLS.length : ""}
          </FilterChip>
        )}
      </nav>
    </div>
    <div className="mb-4 mt-2 flex items-baseline justify-between gap-3">
      <h2 className="text-sm font-semibold text-foreground">{needle ? "Search results" : cat === "Popular" ? "Everyday essentials" : cat}</h2>
      <span className="text-xs text-muted-foreground" aria-live="polite">{plural(filtered.length, "tool")}</span>
    </div>
    {filtered.length ? <div className="tools-grid">
      {filtered.map(tool => <button type="button" key={tool.id} aria-label={"Open " + tool.name} className="tool-card"
        onClick={() => setParams({ tool: tool.id })}>
        <ToolCover tool={tool} />
        <div className="tool-card-copy">
          <span className="tool-card-title">{tool.name}<ArrowRight size={16} className="shrink-0" /></span>
          <p>{tool.desc}</p>
          <span className="tool-card-action"><span>{tool.cat}</span><span>{tool.interactive ? "Open workspace" : "Choose file"}</span></span>
        </div>
      </button>)}
    </div> : <div className="rounded-xl border border-dashed border-border bg-card px-5 py-12 text-center">
      <Search size={24} className="mx-auto mb-3 text-muted-foreground" />
      <h3 className="text-sm font-semibold text-foreground">No matching tools</h3>
      <p className="mt-1 text-sm text-muted-foreground">Try a file type such as PDF or an action such as merge.</p>
      <button className="btn-ghost mt-4" onClick={() => { setQuery(""); setCat("All tools"); }}>Clear filters</button>
    </div>}
    {cat === "Popular" && !needle && <div className="mt-6 flex justify-center">
      <button className="btn-ghost" onClick={() => setCat("All tools")}>Explore all {PDF_TOOLS.length} tools <ArrowRight size={15} /></button>
    </div>}
    <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-xs text-muted-foreground">
      <p className="flex items-center gap-2"><CheckCircle2 size={14} /> Your original files stay unchanged.</p>
      <p>PDF · Images · Word · Excel · PowerPoint · Text · Data</p>
    </div>
  </div>;
}

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
  const [fileRevision, setFileRevision] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const canSave = isConfigured && !!user && outs.length > 0;

  const saveToMyFiles = async () => {
    if (savingFiles || running || !outs.length) return;
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
  const updateFiles = (next: File[]) => {
    setFiles(next);
    setFileRevision(value => value + 1);
    setOuts([]);
    setError("");
  };
  const replaceFirstFile = (file: File) => updateFiles([file, ...files.slice(1)]);
  const pickFiles = (list: FileList | File[] | null) => {
    if (!list?.length || running || savingFiles) return;
    const incoming = Array.from(list);
    const invalid = incoming.find(file => !acceptsFile(file, tool.accept));
    if (invalid) { setError(`${invalid.name} is not supported by ${tool.name}. Choose ${toolFlow(tool).from} files.`); return; }
    if (!tool.multi && incoming.length > 1) { setError("This tool works with one file at a time. Choose one file to continue."); return; }
    if (incoming.some(file => file.size === 0)) { setError("One of these files is empty. Choose a file with content."); return; }
    updateFiles(tool.multi ? [...files, ...incoming] : incoming);
  };
  const run = async () => {
    if (busy.current || running || savingFiles) return;
    if (!files.length) {
      toast.error("Upload a file first.");
      return;
    }
    setRunning(true);
    busy.current = true;
    setError("");
    setOuts([]);
    try {
      const result = await tool.run(files, params);
      await finishOutputs(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      busy.current = false;
    }
  };

  const downloadOutputs = async (outputs: OutFile[]) => {
    setRunning(true);
    try {
      let saved = 0;
      for (const output of outputs) {
        if (await downloadFile(output)) saved += 1;
      }
      if (saved === outputs.length) {
        toast.success(`Downloaded ${saved} file${saved === 1 ? "" : "s"}.`);
      } else {
        toast.info("Save canceled. Your output is ready; use Download results to try again.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the output. Try Download results again.");
    } finally {
      setRunning(false);
    }
  };
  const finishOutputs = async (outputs: OutFile[]) => {
    if (!outputs.length) throw new Error("No output was generated. Check the file and tool options.");
    setOuts(outputs);
    onComplete(tool.id, tool.name, files[0]?.name ?? "document", outputs);
    await downloadOutputs(outputs);
  };
  const acceptOutputs = async (outputs: OutFile[]) => {
    if (busy.current || running || savingFiles) return;
    busy.current = true;
    setRunning(true);
    setError("");
    try { await finishOutputs(outputs); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { busy.current = false; setRunning(false); }
  };

  return (
    <div className="tools-page">
      {/* One header, not two. The tool name used to appear in a sticky bar and
          again in a card 90px below it, with the category floating unanchored in
          the top-right corner. Everything identifying the tool now sits on one
          row, and it stays sticky so Upload stays reachable while scrolling. */}
      <div className="sticky top-0 z-30 -mx-4 mb-4 border-b border-border bg-page px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button onClick={onBack} disabled={running || savingFiles} className="btn-ghost shrink-0">
            <ArrowLeft size={14} /> All tools
          </button>
          <span className="hidden h-8 w-px bg-border sm:block" />
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground">
            <Icon size={18} />
          </span>
          <div className="min-w-0 flex-1">
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
          {!!outs.length && (
            <button onClick={() => void downloadOutputs(outs)} disabled={running || savingFiles} className="btn-ghost">
              Download results
            </button>
          )}
          {canSave && (
            <button onClick={saveToMyFiles} disabled={savingFiles || running} className="btn-ghost">
              {savingFiles ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <FolderPlus size={14} />
              )}
              Save to My Files
            </button>
          )}
          {(files.length > 0 || tool.interactive === "esign") && <button type="button" className="btn-ghost" disabled={running || savingFiles} onClick={() => fileInput.current?.click()}>
            {tool.multi && files.length ? <Plus size={14} /> : <Upload size={14} />} {files.length ? tool.multi ? "Add files" : "Replace file" : "Choose file"}
          </button>}
            <input
              ref={fileInput}
              aria-label="Choose files for this tool"
              type="file"
              accept={tool.accept}
              multiple={tool.multi}
              disabled={running || savingFiles}
              className="hidden"
              onChange={(e) => { pickFiles(e.target.files); e.target.value = ""; }}
            />
        </div>
      </div>

      <ol className="tool-steps" aria-label="Tool progress">
        {[tool.interactive === "esign" ? "Create or upload" : "Choose files", "Make it yours", "Download"].map((label, index) => {
          const step = outs.length ? 2 : files.length || tool.interactive === "esign" ? 1 : 0;
          return <li key={label} aria-current={index === step ? "step" : undefined}><span className="tool-step-number">{index < step ? <CheckCircle2 size={14} /> : index + 1}</span>{label}</li>;
        })}
      </ol>
      {error && <div role="alert" className="mb-4 flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger"><span className="flex-1">{error}</span><button type="button" aria-label="Dismiss error" className="btn-ghost h-10 w-10 shrink-0 p-0" onClick={() => setError("")}><X size={16} /></button></div>}
      {!!outs.length && <section className="tool-results" aria-label="Your results">
        <div className="mb-3 flex items-center gap-2"><CheckCircle2 size={18} className="text-success" /><h2 className="text-sm font-semibold">{plural(outs.length, "file")} ready</h2></div>
        <div className="divide-y divide-border">{outs.map((output, index) => <div key={index} className="flex items-center gap-3 py-2"><FileText size={18} className="shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{output.name}</p><p className="text-xs text-muted-foreground">{fileSize(output.bytes.byteLength)}</p></div><button type="button" className="btn-ghost" disabled={running || savingFiles} aria-label={"Download " + output.name} onClick={() => void downloadOutputs([output])}><Download size={15} /><span className="hidden sm:inline">Download</span></button></div>)}</div>
      </section>}
      {!!files.length && <div className="tool-file-list" aria-label="Selected files">
        {files.map((file, index) => <div className="tool-file-row" key={index}>
          <FileText size={17} className="shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium" title={file.name}>{file.name}</p><p className="text-xs text-muted-foreground">{fileSize(file.size)}</p></div>
          {files.length > 1 && <><button type="button" className="btn-ghost h-10 w-10 shrink-0 p-0" aria-label={"Move " + file.name + " up"} disabled={running || savingFiles || index === 0} onClick={() => { const next = [...files]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; updateFiles(next); }}><ArrowUp size={14} /></button><button type="button" className="btn-ghost h-10 w-10 shrink-0 p-0" aria-label={"Move " + file.name + " down"} disabled={running || savingFiles || index === files.length - 1} onClick={() => { const next = [...files]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; updateFiles(next); }}><ArrowDown size={14} /></button></>}
          <button type="button" className="btn-ghost h-10 w-10 shrink-0 p-0" aria-label={"Remove " + file.name} disabled={running || savingFiles} onClick={() => updateFiles(files.filter((_, i) => i !== index))}><X size={15} /></button>
        </div>)}
      </div>}
      {running && <p role="status" className="mb-4 flex items-center gap-2 text-sm"><Loader2 size={16} className="animate-spin" />Preparing your results. Keep this tool open.</p>}
      <fieldset key={fileRevision} disabled={running || savingFiles} className="min-w-0">
      {!files.length && tool.interactive !== "esign" ? (
        <div className="tool-dropzone" data-dragging={dragging} onDragOver={event => { event.preventDefault(); if (!running && !savingFiles) setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); pickFiles(event.dataTransfer.files); }}>
          <ToolCover tool={tool} />
          <div className="tool-upload-copy"><h2 className="text-lg font-semibold text-foreground">{dragging ? "Drop your files here" : "Start with your " + toolFlow(tool).from + " file"}</h2><p className="max-w-sm text-sm text-muted-foreground">Drag {tool.multi ? "your files" : "a file"} here, or choose {tool.multi ? "them" : "one"} from your device.</p><button type="button" className="btn-primary" onClick={() => fileInput.current?.click()}><Upload size={16} />Choose {tool.multi ? "files" : "file"}</button><p className="text-xs text-muted-foreground">{tool.multi ? "Add multiple files, then arrange them in the order you want." : "One file at a time. Your original stays unchanged."}</p></div>
        </div>
      ) : tool.interactive === "fill-form" ? (
        <div className="card">
          <FormFillPanel
            file={files[0] ?? undefined}
            onDone={(out) => { void acceptOutputs([out]); }}
          />
        </div>
      ) : tool.interactive === "esign" ? (
        <div className="card min-h-[480px]">
          <ESignStudio
            file={files[0] ?? undefined}
            onApply={(out) => { void acceptOutputs([out]); }}
          />
        </div>
      ) : tool.interactive === "merge" ? (
        <div className="card min-h-[480px]">
          <MergeStudio
            files={files}
            onApply={(out) => { void acceptOutputs([out]); }}
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
            onApply={(outputs) => { void acceptOutputs(outputs); }}
          />
        </div>
      ) : tool.interactive === "rotate" && firstIsPdf ? (
        <div className="card min-h-[480px]">
          <RotateStudio
            file={files[0]}
            onApply={(out) => { void acceptOutputs([out]); }}
          />
        </div>
      ) : tool.interactive === "redact" && firstIsPdf ? (
        <div className="card min-h-[480px]">
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
            onApply={(out) => { void acceptOutputs([out]); }}
          />
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
            <fieldset disabled={running || savingFiles}>
              <ToolFields tool={tool} params={params} setParams={(next) => { setParams(next); setOuts([]); }} />
            </fieldset>
            <button onClick={run} disabled={running || savingFiles} className="btn-primary w-full">
              {running ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Sparkles size={15} />
              )}
              Run {tool.name}
            </button>
            <button onClick={() => updateFiles([])} disabled={running || savingFiles} className="btn-ghost w-full">
              Choose another file
            </button>
          </aside>
        </div>
      )}
      </fieldset>
    </div>
  );
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
  useEffect(() => {
    let dead = false;
    setImg("");
    setText("");
    (async () => {
      try {
        if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
          const data = new Uint8Array(await file.arrayBuffer());
          const pdf = await safePdf.getDocument({ data }).promise;
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
