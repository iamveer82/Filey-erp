import { useEffect, useRef, useState } from "react";
import { Upload, Loader2, GripVertical, X, Combine } from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { mergePdfs, type OutFile } from "../lib/pdfTools";
import { useUI } from "../lib/ui";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

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
const fileKey = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;

async function toItem(file: File): Promise<Item> {
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data }).promise;
    const p = await pdf.getPage(1);
    const vp = p.getViewport({ scale: 0.4 });
    const c = document.createElement("canvas");
    c.width = vp.width;
    c.height = vp.height;
    const ctx = c.getContext("2d");
    if (ctx) await p.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise;
    return { id: uid(), file, thumb: ctx ? c.toDataURL("image/png") : "", pages: pdf.numPages };
  } catch {
    return { id: uid(), file, thumb: "", pages: 0 };
  }
}

export default function MergeStudio({
  files,
  onApply,
}: {
  files: File[];
  onApply: (out: OutFile) => void;
}) {
  const { toast } = useUI();
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const dragId = useRef<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  // Add any incoming file that isn't already in the list (preserve order).
  useEffect(() => {
    let dead = false;
    (async () => {
      const have = new Set(items.map((i) => fileKey(i.file)));
      const add = files.filter((f) => !have.has(fileKey(f)));
      if (!add.length) return;
      const built: Item[] = [];
      for (const f of add) built.push(await toItem(f));
      if (!dead) setItems((prev) => [...prev, ...built]);
    })();
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  const addMore = async (list: FileList | null) => {
    if (!list) return;
    const built: Item[] = [];
    for (const f of Array.from(list)) built.push(await toItem(f));
    setItems((prev) => [...prev, ...built]);
  };

  const reorder = (from: string, to: string) => {
    if (from === to) return;
    setItems((prev) => {
      const a = [...prev];
      const fi = a.findIndex((x) => x.id === from);
      const ti = a.findIndex((x) => x.id === to);
      if (fi < 0 || ti < 0) return prev;
      const [moved] = a.splice(fi, 1);
      a.splice(ti, 0, moved);
      return a;
    });
  };

  const merge = async () => {
    if (!items.length) {
      toast.error("Add at least one PDF.");
      return;
    }
    setBusy(true);
    try {
      const out = await mergePdfs(items.map((i) => i.file));
      onApply(out);
      toast.success(`Merged ${items.length} files & downloaded.`);
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
        <p className="text-xs font-semibold text-brand-500">
          {items.length} file{items.length === 1 ? "" : "s"} · {totalPages} page
          {totalPages === 1 ? "" : "s"} — drag to reorder
        </p>
        <label className="btn-ghost h-8 cursor-pointer text-xs">
          <Upload size={13} /> Add PDFs
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
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {items.map((it, i) => (
          <div
            key={it.id}
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
            className={`group relative cursor-grab rounded-xl border bg-white p-2 active:cursor-grabbing dark:bg-[#1E2025] ${
              overId === it.id
                ? "border-primary-400 ring-2 ring-primary-400/40"
                : "border-brand-200 dark:border-[#3A3D45]"
            }`}
          >
            <span className="absolute left-1.5 top-1.5 z-10 grid h-5 w-5 place-items-center rounded-full bg-primary-500 text-[11px] font-bold text-[#0A0A0A]">
              {i + 1}
            </span>
            <button
              onClick={() => setItems((prev) => prev.filter((x) => x.id !== it.id))}
              title="Remove"
              className="absolute right-1.5 top-1.5 z-10 hidden h-5 w-5 place-items-center rounded-full bg-danger text-white group-hover:grid"
            >
              <X size={11} />
            </button>
            <div className="grid h-32 place-items-center overflow-hidden rounded-lg bg-brand-50 dark:bg-black/20">
              {it.thumb ? (
                <img src={it.thumb} alt="" className="max-h-full max-w-full object-contain" />
              ) : (
                <Loader2 size={16} className="animate-spin text-brand-400" />
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-1">
              <GripVertical size={12} className="shrink-0 text-brand-400" />
              <span className="truncate text-[11px] text-brand-600 dark:text-[#C9CDD3]" title={it.file.name}>
                {it.file.name}
              </span>
            </div>
            <span className="text-[10px] text-brand-400">{it.pages || "?"} pages</span>
          </div>
        ))}
        {!items.length && (
          <label className="col-span-full grid h-40 cursor-pointer place-items-center rounded-xl border-2 border-dashed border-brand-300 text-sm text-brand-400 dark:border-[#3A3D45]">
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
        disabled={busy || items.length < 1}
        className="btn-primary mt-4 w-full"
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Combine size={15} />}
        Merge {items.length} file{items.length === 1 ? "" : "s"} & download
      </button>
    </div>
  );
}
