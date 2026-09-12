import { useEffect, useRef, useState } from "react";
import { Upload, Loader2, GripVertical, X, Combine, ArrowLeft, ArrowRight } from "lucide-react";
import * as safePdf from "../lib/pdfjsSafe";
import { mergePdfs, type OutFile } from "../lib/pdfTools";
import { useUI } from "../lib/ui";


/* Interactive merge: each PDF shows as a card with a page-1 thumbnail. Drag
 * cards to set the order, remove or add more, then merge — no comma-separated
 * page strings, friendly for non-technical users. */

interface Item {
  id: string;
  file: File;
  thumb: string;
  pages: number;
}

const uid = () => Math.random().toString(36).slice(2, 9);

async function toItem(file: File): Promise<Item> {
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await safePdf.getDocument({ data }).promise;
    const p = await pdf.getPage(1);
    const vp = p.getViewport({ scale: 0.4 });
    const c = document.createElement("canvas");
    c.width = vp.width;
    c.height = vp.height;
    const ctx = c.getContext("2d");
    if (ctx) await p.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise;
    return {
      id: uid(),
      file,
      thumb: ctx ? c.toDataURL("image/png") : "",
      pages: pdf.numPages,
    };
  } catch (e) {
    console.warn("Failed to load PDF:", e);
    return { id: uid(), file, thumb: "", pages: 0 };
  }
}

export default function MergeStudio({
  files,
  onFilesChange,
  onApply,
}: {
  files: File[];
  onFilesChange: (files: File[]) => void;
  onApply: (out: OutFile) => void;
}) {
  const { toast } = useUI();
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const dragId = useRef<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  // The workspace owns the file order, so adding a file preserves prior rearrangements.
  useEffect(() => {
    let dead = false;
    setLoading(true);
    Promise.all(files.map(file => items.find(item => item.file === file) || toItem(file)))
      .then(next => { if (!dead) setItems(next); })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
    // Preview cache is read only when the selected files change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  const addMore = async (list: FileList | null) => {
    if (!list || busy || loading) return;
    const incoming = Array.from(list);
    if (incoming.some(file => !file.size || (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)))) {
      toast.error("Choose PDF files with content."); return;
    }
    onFilesChange([...files, ...incoming]);
  };
  const reorder = (from: string, to: string) => {
    if (busy || loading || from === to) return;
    const next = [...items];
    const source = next.findIndex(item => item.id === from), target = next.findIndex(item => item.id === to);
    if (source < 0 || target < 0) return;
    next.splice(target, 0, next.splice(source, 1)[0]);
    onFilesChange(next.map(item => item.file));
  };

  const merge = async () => {
    if (busy || loading) return;
    if (!items.length) {
      toast.error("Add at least one PDF.");
      return;
    }
    setBusy(true);
    try {
      const out = await mergePdfs(items.map((i) => i.file));
      onApply(out);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const totalPages = items.reduce((n, i) => n + i.pages, 0);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-brand-500">
          {items.length} file{items.length === 1 ? "" : "s"} · {totalPages} page
          {totalPages === 1 ? "" : "s"} - drag to reorder
        </p>
        <label className="btn-ghost cursor-pointer" aria-label="Add PDFs">
          <Upload size={13} /> Add PDFs
          <input
            type="file"
            accept="application/pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              (async () => {
                try {
                  await addMore(e.target.files);
                } catch (e) {
                  console.warn("Failed to add PDF:", e);
                }
              })();
              e.target.value = "";
            }}
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {items.map((it, i) => (
          <div
            key={it.id}
            role="listitem"
            aria-label="PDF page"
            draggable
            onDragStart={() => (dragId.current = it.id)}
            onDragOver={(e) => {
              e.preventDefault();
              setOverId(it.id);
            }}
            onDragLeave={() => setOverId((o) => (o === it.id ? null : o))}
            onDrop={() => {
              if (dragId.current) reorder(dragId.current, it.id);
              dragId.current = null;
              setOverId(null);
            }}
            className={`group relative cursor-grab rounded-xl border bg-card p-2 active:cursor-grabbing ${
              overId === it.id
                ? "border-primary-400 ring-2 ring-primary-400/40"
                : "border-brand-200"
            }`}
          >
            <span className="absolute left-1.5 top-1.5 z-10 grid h-5 w-5 place-items-center rounded-full bg-primary-500 text-[11px] font-medium text-[#0A0A0A]">
              {i + 1}
            </span>
            <button
              aria-label={"Remove " + it.file.name}
              onClick={() => onFilesChange(items.filter(x => x.id !== it.id).map(x => x.file))}
              disabled={busy || loading}
              title="Remove"
              className="absolute right-1.5 top-1.5 z-10 grid h-10 w-10 place-items-center rounded-full bg-danger text-white"
            >
              <X size={11} />
            </button>
            <div className="grid h-32 place-items-center overflow-hidden rounded-xl bg-brand-50 dark:bg-black/20">
              {it.thumb ? (
                <img
                  src={it.thumb}
                  alt={`Page thumbnail`}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <Loader2 size={16} className="animate-spin text-brand-400" />
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-1">
              <GripVertical size={12} className="shrink-0 text-brand-400" />
              <span
                className="truncate text-[11px] text-brand-600"
                title={it.file.name}
              >
                {it.file.name}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{it.pages || "?"} pages</span><div className="flex gap-1"><button type="button" className="btn-ghost h-10 w-10 p-0" aria-label={"Move " + it.file.name + " earlier"} disabled={busy || loading || i === 0} onClick={() => reorder(it.id, items[i - 1].id)}><ArrowLeft size={14} /></button><button type="button" className="btn-ghost h-10 w-10 p-0" aria-label={"Move " + it.file.name + " later"} disabled={busy || loading || i === items.length - 1} onClick={() => reorder(it.id, items[i + 1].id)}><ArrowRight size={14} /></button></div></div>
          </div>
        ))}
        {!items.length && (
          <label className="col-span-full grid h-40 cursor-pointer place-items-center rounded-xl border-2 border-dashed border-brand-300 text-sm text-brand-400">
            <span>
              <Upload size={18} className="mx-auto mb-1" /> Add PDFs to merge
            </span>
            <input
              type="file"
              accept="application/pdf"
              multiple
              className="hidden"
              onChange={(e) => {
                addMore(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        )}
      </div>

      <button
        onClick={merge}
        disabled={busy || loading || items.length < 1}
        className="btn-primary mt-4 w-full"
        aria-label="Merge and download PDF"
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Combine size={15} />}
        {loading ? "Preparing files…" : `Merge ${items.length} file${items.length === 1 ? "" : "s"}`}
      </button>
    </div>
  );
}
