import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Search,
  Upload,
  Loader2,
  Download,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import * as pdf from "../lib/pdfTools";
import type { OutFile } from "../lib/pdfTools";
import { PDF_TOOLS, type Tool, ToolFields, defaultParams } from "./PdfToolbox";

/** Searchable tool browser â€” left list with smart suggestions, right
 *  pane with the selected tool's upload form + params + run. */
export default function ToolBrowserModal({
  open,
  onClose,
  onComplete,
}: {
  open: boolean;
  onClose: () => void;
  onComplete?: (toolId: string, files: string[], outputs: OutFile[]) => void;
}) {
  const [q, setQ] = useState("");
  const [tool, setTool] = useState<Tool | null>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setTool(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  const scored = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s)
      return PDF_TOOLS.map((t) => ({ tool: t, score: 0 })).sort((a, b) =>
        a.tool.name.localeCompare(b.tool.name)
      );
    const terms = s.split(/\s+/).filter(Boolean);
    const hit = (txt: string, weight: number) => {
      const lower = txt.toLowerCase();
      let n = 0;
      for (const t of terms) if (lower.includes(t)) n += weight;
      return n;
    };
    return PDF_TOOLS.map((t) => ({
      tool: t,
      score:
        hit(t.name, 5) +
        hit(t.id, 4) +
        hit(t.desc, 2) +
        hit(t.cat, 1),
    }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);
  }, [q]);

  const best = scored[0]?.tool;

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-6xl h-[85vh] rounded-2xl bg-white dark:bg-[#24262C] shadow-bento-hover flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-brand-100 dark:border-[#2A2C33]">
          <div>
            <p className="font-bold text-ink">All tools</p>
            <p className="text-xs text-brand-400">
              {PDF_TOOLS.length} local tools â€” files never leave this device
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-brand-500 hover:bg-brand-50 dark:hover:bg-white/5 cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* body */}
        <div className="flex flex-1 min-h-0">
          {/* left: search + list */}
          <div className="w-[340px] shrink-0 border-r border-brand-100 dark:border-[#2A2C33] flex flex-col min-h-0">
            <div className="p-3 border-b border-brand-100 dark:border-[#2A2C33]">
              <div className="relative">
                <Search
                  size={15}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-400"
                />
                <input
                  autoFocus
                  className="input pl-9"
                  placeholder="Search or describe what you needâ€¦"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
              {q.trim() && best && (
                <button
                  onClick={() => setTool(best)}
                  className="mt-2 w-full flex items-center gap-2 rounded-xl bg-primary-100 text-primary-700 px-3 py-2 text-left cursor-pointer hover:bg-primary-200 transition-colors"
                >
                  <Sparkles size={14} />
                  <span className="text-xs font-bold uppercase tracking-wider">
                    Best match
                  </span>
                  <span className="ml-auto text-sm font-semibold truncate">
                    {best.name}
                  </span>
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {scored.length === 0 ? (
                <p className="text-sm text-brand-400 px-3 py-6 text-center">
                  No tool matches "{q}"
                </p>
              ) : (
                <ul className="space-y-1">
                  {scored.map(({ tool: t }) => {
                    const Icon = t.icon;
                    const isActive = tool?.id === t.id;
                    return (
                      <li key={t.id}>
                        <button
                          onClick={() => setTool(t)}
                          className={`w-full flex items-start gap-2.5 rounded-xl px-2.5 py-2 text-left cursor-pointer transition-colors ${
                            isActive
                              ? "bg-primary-100 text-primary-700"
                              : "hover:bg-brand-50 dark:hover:bg-white/5"
                          }`}
                        >
                          <span
                            className={`rounded-lg p-1.5 shrink-0 ${
                              isActive
                                ? "bg-white text-primary-700"
                                : "bg-primary-100 text-primary-700"
                            }`}
                          >
                            <Icon size={15} />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-ink truncate">
                              {t.name}
                            </span>
                            <span className="block text-[11px] text-brand-500 leading-snug line-clamp-2">
                              {t.desc}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* right: selected tool detail */}
          <div className="flex-1 min-w-0 overflow-y-auto p-6">
            {tool ? (
              <ToolPane tool={tool} onComplete={onComplete} />
            ) : (
              <div className="h-full grid place-items-center text-center text-brand-400 text-sm">
                <div>
                  <Sparkles
                    size={28}
                    className="mx-auto mb-3 text-primary-500"
                  />
                  <p className="font-semibold text-ink">Pick a tool</p>
                  <p className="text-xs mt-1">
                    Use the search on the left or type what you need â€”
                    the best match is highlighted automatically.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function ToolPane({
  tool,
  onComplete,
}: {
  tool: Tool;
  onComplete?: (toolId: string, files: string[], outputs: OutFile[]) => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [params, setParams] = useState<Record<string, string>>(
    defaultParams(tool)
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [results, setResults] = useState<OutFile[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setFiles([]);
    setParams(defaultParams(tool));
    setResults([]);
    setErr("");
  }, [tool.id]);

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
      onComplete?.(tool.id, files.map((f) => f.name), out);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const Icon = tool.icon;

  return (
    <div className="max-w-xl">
      <div className="flex items-start gap-3 mb-4">
        <div className="rounded-2xl bg-primary-100 text-primary-700 p-3 shrink-0">
          <Icon size={22} />
        </div>
        <div>
          <p className="font-bold text-ink text-lg">{tool.name}</p>
          <p className="text-sm text-brand-500 mt-0.5">{tool.desc}</p>
          <span className="pill bg-brand-50 dark:bg-white/5 text-brand-600 dark:text-[#DDE0E4] mt-2 inline-block">
            {tool.cat}
          </span>
        </div>
      </div>

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
              className="text-xs text-brand-600 bg-brand-50 dark:bg-white/5 dark:text-[#DDE0E4] rounded-lg px-3 py-2 truncate"
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

      <div className="flex justify-end">
        <button
          className="btn-primary"
          disabled={busy || files.length === 0}
          onClick={run}
        >
          {busy ? (
            <>
              <Loader2 size={15} className="animate-spin" /> Workingâ€¦
            </>
          ) : (
            "Run tool"
          )}
        </button>
      </div>
    </div>
  );
}
