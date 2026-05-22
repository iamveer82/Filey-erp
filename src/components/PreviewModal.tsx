import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Upload, Loader2, FileText } from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { downloadBytes, fileNameOf } from "../lib/toolStorage";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type Kind = "pdf" | "image" | "text" | "none";

function kindOf(name: string, type: string): Kind {
  const n = name.toLowerCase();
  if (type === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|svg)$/.test(n))
    return "image";
  if (/\.(txt|md|csv|json|log|xml|html?)$/.test(n) || type.startsWith("text/"))
    return "text";
  return "none";
}

/** Document previewer — renders PDF (pdfjs), images, or text locally.
 *  Opens as an overlay panel with a close button. No upload to server. */
export default function PreviewModal({
  open,
  title,
  paths = [],
  onClose,
}: {
  open: boolean;
  title?: string;
  paths?: string[];
  onClose: () => void;
}) {
  const [name, setName] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [kind, setKind] = useState<Kind>("none");
  const [imgUrl, setImgUrl] = useState<string>("");
  const [text, setText] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [activePath, setActivePath] = useState<string>("");
  const canvasWrap = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgUrlRef = useRef<string>("");

  const reset = () => {
    setName("");
    setLoaded(false);
    setKind("none");
    if (imgUrlRef.current) URL.revokeObjectURL(imgUrlRef.current);
    imgUrlRef.current = "";
    setImgUrl("");
    setText("");
    setErr("");
    if (canvasWrap.current) canvasWrap.current.innerHTML = "";
  };

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  // On open: auto-load the first stored file, else show the picker.
  useEffect(() => {
    if (!open) return;
    reset();
    if (paths.length) {
      setActivePath(paths[0]);
      void loadFromPath(paths[0]);
    } else {
      setActivePath("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, paths.join("|")]);

  const renderBytes = async (
    fileName: string,
    type: string,
    bytes: Uint8Array
  ) => {
    if (imgUrlRef.current) URL.revokeObjectURL(imgUrlRef.current);
    imgUrlRef.current = "";
    setImgUrl("");
    setText("");
    if (canvasWrap.current) canvasWrap.current.innerHTML = "";
    const k = kindOf(fileName, type);
    setKind(k);
    setName(fileName);
    setLoaded(true);
    if (k === "image") {
      const url = URL.createObjectURL(new Blob([bytes.slice()], { type }));
      imgUrlRef.current = url;
      setImgUrl(url);
    } else if (k === "text") {
      setText(new TextDecoder().decode(bytes));
    } else if (k === "pdf") {
      const doc = await pdfjs.getDocument({ data: bytes }).promise;
      const wrap = canvasWrap.current;
      if (wrap) {
        wrap.innerHTML = "";
        const pages = Math.min(doc.numPages, 15);
        for (let n = 1; n <= pages; n++) {
          const page = await doc.getPage(n);
          const viewport = page.getViewport({ scale: 1.3 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className =
            "mx-auto mb-3 shadow rounded border border-brand-200 max-w-full";
          wrap.appendChild(canvas);
          const ctx = canvas.getContext("2d")!;
          await page.render({ canvasContext: ctx, viewport }).promise;
        }
        if (doc.numPages > pages) {
          const more = document.createElement("p");
          more.className = "text-center text-xs text-brand-400 py-2";
          more.textContent = `+ ${doc.numPages - pages} more page(s)`;
          wrap.appendChild(more);
        }
      }
    } else {
      setErr("Preview not supported for this file type.");
    }
  };

  const loadFromPath = async (path: string) => {
    setBusy(true);
    setErr("");
    setActivePath(path);
    try {
      const got = await downloadBytes(path);
      if (!got) throw new Error("Could not load the stored file.");
      await renderBytes(fileNameOf(path), got.type, got.bytes);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const load = async (f: File) => {
    setBusy(true);
    setErr("");
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      await renderBytes(f.name, f.type, bytes);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex justify-end"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl h-full bg-white dark:bg-[#201D16] shadow-bento-hover flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-brand-100 dark:border-[#2A261E] shrink-0">
          <div className="min-w-0">
            <p className="font-bold text-ink truncate">
              {name || title || "Preview"}
            </p>
            <p className="text-xs text-brand-400">
              {paths.length
                ? "Stored securely in your account"
                : "Rendered locally — nothing is uploaded"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="btn-ghost text-xs"
              onClick={() => fileRef.current?.click()}
            >
              <Upload size={14} /> {loaded ? "Change" : "Open file"}
            </button>
            <button
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-1.5 text-brand-500 hover:bg-brand-50 dark:hover:bg-white/5 cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) load(f);
              e.target.value = "";
            }}
          />
        </div>

        {/* multi-file tabs */}
        {paths.length > 1 && (
          <div className="flex gap-1 px-5 py-2 border-b border-brand-100 dark:border-[#2A261E] overflow-x-auto shrink-0">
            {paths.map((p) => (
              <button
                key={p}
                onClick={() => loadFromPath(p)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer ${
                  activePath === p
                    ? "bg-primary-100 text-primary-700"
                    : "text-brand-500 hover:bg-brand-50 dark:hover:bg-white/5"
                }`}
              >
                {fileNameOf(p)}
              </button>
            ))}
          </div>
        )}

        {/* body */}
        <div className="flex-1 overflow-auto bg-brand-50 dark:bg-[#17150F] p-5">
          {busy && (
            <div className="h-full grid place-items-center text-brand-400">
              <Loader2 size={28} className="animate-spin" />
            </div>
          )}
          {!busy && err && (
            <p className="text-sm text-danger bg-danger/10 rounded-lg px-3 py-2">
              {err}
            </p>
          )}
          {!busy && !err && !loaded && (
            <div className="h-full grid place-items-center text-center text-brand-400">
              <div>
                <FileText size={30} className="mx-auto mb-3 text-primary-500" />
                <p className="font-semibold text-ink">No document loaded</p>
                <p className="text-xs mt-1">
                  Click <span className="font-semibold">Open file</span> to
                  preview a PDF, image, or text document.
                </p>
                <button
                  className="btn-primary mt-4 mx-auto"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload size={15} /> Open file
                </button>
              </div>
            </div>
          )}
          {!busy && !err && loaded && kind === "pdf" && (
            <div ref={canvasWrap} />
          )}
          {!busy && !err && loaded && kind === "image" && imgUrl && (
            <img
              src={imgUrl}
              alt={name}
              className="mx-auto max-w-full rounded border border-brand-200 shadow"
            />
          )}
          {!busy && !err && loaded && kind === "text" && (
            <pre className="text-xs whitespace-pre-wrap break-words bg-white dark:bg-[#1B1812] rounded-xl border border-brand-200 dark:border-[#322E25] p-4 text-brand-700 dark:text-[#C9C0B0]">
              {text}
            </pre>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
