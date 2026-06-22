import { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  FolderOpen,
  Folder,
  Download,
  Trash2,
  Loader2,
  ArrowLeft,
  Pencil,
  Share2,
  ExternalLink,
  X,
  ChevronRight,
  UploadCloud,
} from "lucide-react";
import { FileIcon } from "../components/BrandIcon";
import PdfCanvas from "../components/PdfCanvas";
import {
  useFiles,
  fileObjectUrl,
  downloadUrl,
  shareFileLink,
  FILE_FOLDERS,
  folderOf,
  type SavedFile,
} from "../lib/files";
import { isConfigured } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { useUI } from "../lib/ui";

const fmtSize = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${(n / 1024).toFixed(0)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`;
const fmtDate = (t: number) =>
  new Date(t).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const folderMeta = (key: string) =>
  FILE_FOLDERS.find((f) => f.key === key) ?? {
    key: "other",
    label: "Other files",
    route: undefined as string | undefined,
  };

export default function MyFiles() {
  const { user } = useAuth();
  const { files, loading, remove, rename, upload } = useFiles();
  const { toast, confirm, prompt } = useUI();
  const navigate = useNavigate();

  const [openFolder, setOpenFolder] = useState<string | null>(null);
  const [preview, setPreview] = useState<SavedFile | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Group files into folders by document type.
  const folders = useMemo(() => {
    const counts = new Map<string, SavedFile[]>();
    for (const f of files) {
      const k = folderOf(f);
      const arr = counts.get(k) ?? [];
      arr.push(f);
      counts.set(k, arr);
    }
    const ordered = [
      ...FILE_FOLDERS.map((d) => d.key),
      ...(counts.has("other") ? ["other"] : []),
    ];
    return ordered
      .filter((k) => counts.has(k))
      .map((k) => ({ ...folderMeta(k), files: counts.get(k)! }));
  }, [files]);

  const folderFiles = useMemo(
    () => (openFolder ? files.filter((f) => folderOf(f) === openFolder) : []),
    [files, openFolder]
  );

  const doUpload = async (inputFiles: FileList | null) => {
    if (!inputFiles?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(inputFiles)) {
        await upload(file);
      }
      toast.success(`${inputFiles.length} file${inputFiles.length > 1 ? "s" : ""} uploaded.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  // If the open folder empties out (last file deleted), drop back to the grid.
  useEffect(() => {
    if (openFolder && folderFiles.length === 0) setOpenFolder(null);
  }, [openFolder, folderFiles.length]);

  const download = async (f: SavedFile) => {
    setBusyId(f.id);
    try {
      const url = await downloadUrl(f);
      if (!url) throw new Error("Could not create a download link.");
      const a = document.createElement("a");
      a.href = url;
      a.download = f.name;
      a.target = "_blank";
      a.rel = "noopener";
      a.click();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const del = async (f: SavedFile) => {
    const ok = await confirm({
      title: "Delete file?",
      message: `“${f.name}” will be permanently removed from your account.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await remove(f);
      if (preview?.id === f.id) setPreview(null);
      toast.success("File deleted.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const doRename = async (f: SavedFile) => {
    const base = f.name.replace(/\.[^.]+$/, "");
    const next = await prompt({
      title: "Rename file",
      label: "File name",
      defaultValue: base,
      confirmLabel: "Rename",
    });
    if (next == null || !next.trim() || next.trim() === base) return;
    try {
      const finalName = await rename(f, next);
      if (preview?.id === f.id) setPreview((p) => (p ? { ...p, name: finalName } : p));
      toast.success("File renamed.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const share = async (f: SavedFile) => {
    setBusyId(f.id);
    try {
      const url = await shareFileLink(f);
      if (!url) throw new Error("Could not create a share link.");
      await navigator.clipboard.writeText(url);
      toast.success("Share link copied — valid for 7 days.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const edit = (f: SavedFile) => {
    const route = folderMeta(folderOf(f)).route;
    if (!route) {
      toast.info("This file type has no editor.");
      return;
    }
    navigate(route);
  };

  /* ---------------- gates ---------------- */
  if (!isConfigured || !user) {
    return (
      <div className="animate-fade-up">
        <Header />
        <div className="card text-sm text-brand-500">
          Sign in to save and access your files across devices.
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="animate-fade-up">
        <Header />
        <div className="grid h-60 place-items-center">
          <Loader2 size={22} className="animate-spin text-brand-400" />
        </div>
      </div>
    );
  }

  /* ---------------- single-file preview (full page) ---------------- */
  if (preview) {
    return (
      <FilePreviewPage
        file={preview}
        onBack={() => setPreview(null)}
        onDownload={() => download(preview)}
        onShare={() => share(preview)}
        onRename={() => doRename(preview)}
        onDelete={() => del(preview)}
        onEdit={() => edit(preview)}
        editable={!!folderMeta(folderOf(preview)).route}
      />
    );
  }

  /* ---------------- folder contents (full page) ---------------- */
  if (openFolder) {
    return (
      <div className="animate-fade-up">
        <Header back={() => setOpenFolder(null)}>
          {<>
            <input
              ref={fileInputRef}
              type="file"
              id="folder-file-upload"
              multiple
              className="hidden"
              onChange={(e) => {
                doUpload(e.target.files);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            />
            <label
              htmlFor="folder-file-upload"
              className="btn-primary cursor-pointer inline-flex items-center gap-2"
            >
              {uploading ? <Loader2 size={15} className="animate-spin" /> : <UploadCloud size={15} />}
              Upload
            </label>
          </>}
        </Header>
        <div className="space-y-2">
          {folderFiles.map((f) => (
            <div
              key={f.id}
              className="card group flex items-center gap-3 py-3 cursor-pointer hover:border-primary-300 transition-colors"
              onClick={() => setPreview(f)}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand-100 text-brand-500 dark:bg-white/8">
                <FileIcon name={f.name} className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink" title={f.name}>
                  {f.name}
                </p>
                <p className="text-xs text-brand-400">
                  {fmtSize(f.size)} · {fmtDate(f.createdAt)}
                </p>
              </div>
              <div
                className="flex items-center gap-1"
                onClick={(e) => e.stopPropagation()}
              >
                <RowAction title="Open preview" onClick={() => setPreview(f)}>
                  <ChevronRight size={16} />
                </RowAction>
                <RowAction
                  title="Download"
                  onClick={() => download(f)}
                  busy={busyId === f.id}
                >
                  <Download size={15} />
                </RowAction>
                <RowAction title="Rename" onClick={() => doRename(f)}>
                  <Pencil size={15} />
                </RowAction>
                <RowAction title="Share link" onClick={() => share(f)}>
                  <Share2 size={15} />
                </RowAction>
                <RowAction title="Delete" tone="danger" onClick={() => del(f)}>
                  <Trash2 size={15} />
                </RowAction>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* ---------------- folder grid (home) ---------------- */
  return (
    <div className="animate-fade-up">
      <Header>
        {<>
          <input
            ref={fileInputRef}
            type="file"
            id="file-upload"
            multiple
            className="hidden"
            onChange={(e) => {
              doUpload(e.target.files);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
          />
          <label
            htmlFor="file-upload"
            className="btn-primary cursor-pointer inline-flex items-center gap-2"
          >
            {uploading ? <Loader2 size={15} className="animate-spin" /> : <UploadCloud size={15} />}
            Upload
          </label>
        </>}
      </Header>
      {!files.length ? (
        <div className="card grid place-items-center py-16 text-center">
          <FolderOpen size={28} className="mb-2 text-brand-300" />
          <p className="text-sm font-medium text-ink">No saved files yet</p>
          <p className="mt-1 text-xs text-brand-500">
            Generate an invoice, quotation or other document — a copy is filed here
            automatically.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {folders.map((d) => (
            <button
              key={d.key}
              onClick={() => setOpenFolder(d.key)}
              className="card group flex items-center gap-3 text-left hover:border-primary-300 transition-all cursor-pointer"
            >
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary-100 text-ink dark:bg-primary-400/15 dark:text-primary-300">
                <Folder size={22} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{d.label}</p>
                <p className="text-xs text-brand-400">
                  {d.files.length} document{d.files.length === 1 ? "" : "s"}
                </p>
              </div>
              <ChevronRight
                size={18}
                className="text-brand-300 group-hover:text-primary-500 transition-colors"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Header({ children, back }: { children?: React.ReactNode; back?: () => void }) {
  return (
    <div className="mb-5 flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-3">
        {back && (
          <button
            className="rounded-2xl p-2 text-brand-500 hover:bg-brand-100 transition-colors cursor-pointer"
            onClick={back}
            aria-label="Back"
          >
            <ArrowLeft size={18} />
          </button>
        )}
        <span className="grid h-11 w-11 place-items-center rounded-full bg-primary-100 text-ink dark:bg-primary-400/15 dark:text-primary-300">
          <FolderOpen size={20} />
        </span>
        <div>
          <p className="text-[10px] font-medium text-brand-400">Files</p>
          <h1 className="text-lg font-medium text-ink">My Files</h1>
          <p className="text-xs text-brand-500">Every document you generate, filed by type</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function RowAction({
  children,
  title,
  onClick,
  tone,
  busy,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  tone?: "danger";
  busy?: boolean;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      disabled={busy}
      onClick={onClick}
      className={`rounded-lg p-1.5 cursor-pointer transition-colors duration-200 ${
        tone === "danger"
          ? "text-danger hover:bg-danger/10"
          : "text-brand-500 hover:bg-brand-100 hover:text-ink dark:hover:bg-white/5"
      }`}
    >
      {busy ? <Loader2 size={15} className="animate-spin" /> : children}
    </button>
  );
}

/* ---------------- Full-page single-document preview ---------------- */

function FilePreviewPage({
  file,
  onBack,
  onDownload,
  onShare,
  onRename,
  onDelete,
  onEdit,
  editable,
}: {
  file: SavedFile;
  onBack: () => void;
  onDownload: () => void;
  onShare: () => void;
  onRename: () => void;
  onDelete: () => void;
  onEdit: () => void;
  editable: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let objUrl: string | null = null;
    setUrl(null);
    setErr(null);
    fileObjectUrl(file)
      .then((u) => {
        if (!alive) {
          if (u) URL.revokeObjectURL(u);
          return;
        }
        if (u) {
          objUrl = u;
          setUrl(u);
        } else setErr("This file is no longer available.");
      })
      .catch((e) => alive && setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [file.id]);

  const isPdf = file.mime === "application/pdf";
  const isImage = file.mime.startsWith("image/");

  return (
    <div className="animate-fade-up flex h-[calc(100vh-7rem)] flex-col">
      <div className="mb-3 flex items-center gap-3 flex-wrap">
        <button
          className="rounded-2xl p-2 text-brand-500 hover:bg-brand-100 transition-colors cursor-pointer"
          onClick={onBack}
          aria-label="Back"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-medium text-ink" title={file.name}>
            {file.name}
          </h1>
          <p className="text-xs text-brand-400">
            {fmtSize(file.size)} · {fmtDate(file.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {editable && (
            <button className="btn-ghost" onClick={onEdit} title="Open in its editor">
              <ExternalLink size={15} /> Edit
            </button>
          )}
          <button className="btn-ghost" onClick={onRename}>
            <Pencil size={15} /> Rename
          </button>
          <button className="btn-ghost" onClick={onShare}>
            <Share2 size={15} /> Share
          </button>
          <button className="btn-ghost" onClick={onDownload}>
            <Download size={15} /> Download
          </button>
          <button className="btn-ghost text-danger" onClick={onDelete}>
            <Trash2 size={15} /> Delete
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden rounded-2xl border border-brand-200 bg-brand-100 dark:border-[#2C2C2E] dark:bg-[#1B1C20]">
        {err ? (
          <div className="grid h-full place-items-center text-center px-6">
            <div>
              <X size={26} className="mx-auto mb-2 text-danger" />
              <p className="text-sm font-medium text-ink">Could not load a preview</p>
              <p className="mt-1 text-xs text-brand-500 max-w-sm">{err}</p>
              <button className="btn-ghost mt-3" onClick={onDownload}>
                <Download size={15} /> Download instead
              </button>
            </div>
          </div>
        ) : !url ? (
          <div className="grid h-full place-items-center">
            <Loader2 size={22} className="animate-spin text-brand-400" />
          </div>
        ) : isImage ? (
          <div className="grid h-full place-items-center overflow-auto p-4">
            <img
              src={url}
              alt={file.name}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        ) : isPdf ? (
          <PdfCanvas url={url} />
        ) : (
          <div className="grid h-full place-items-center text-center px-6">
            <div>
              <FileIcon
                name={file.name}
                className="mx-auto mb-2 h-7 w-7 text-brand-400"
              />
              <p className="text-sm font-medium text-ink">
                Preview not available for this file type
              </p>
              <button className="btn-ghost mt-3" onClick={onDownload}>
                <Download size={15} /> Download
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
