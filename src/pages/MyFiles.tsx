import { useState } from "react";
import { FolderOpen, Download, Trash2, Loader2, FileText } from "lucide-react";
import { useFiles, fileUrl, type SavedFile } from "../lib/files";
import { isConfigured } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { useUI } from "../lib/ui";

const fmtSize = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
const fmtDate = (t: number) =>
  new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export default function MyFiles() {
  const { user } = useAuth();
  const { files, loading, remove } = useFiles();
  const { toast, confirm } = useUI();
  const [busyId, setBusyId] = useState<string | null>(null);

  const download = async (f: SavedFile) => {
    setBusyId(f.id);
    try {
      const url = await fileUrl(f);
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
      toast.success("File deleted.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="animate-fade-up">
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-primary-100 text-primary-700 dark:bg-primary-400/15 dark:text-primary-300">
          <FolderOpen size={20} />
        </span>
        <div>
          <h1 className="text-lg font-bold text-ink">My Files</h1>
          <p className="text-xs text-brand-500">Tool outputs you've saved to your account</p>
        </div>
      </div>

      {!isConfigured || !user ? (
        <div className="card text-sm text-brand-500">
          Sign in to save and access your files across devices.
        </div>
      ) : loading ? (
        <div className="grid h-60 place-items-center">
          <Loader2 size={22} className="animate-spin text-brand-400" />
        </div>
      ) : !files.length ? (
        <div className="card grid place-items-center py-16 text-center">
          <FolderOpen size={28} className="mb-2 text-brand-300" />
          <p className="text-sm font-semibold text-ink">No saved files yet</p>
          <p className="mt-1 text-xs text-brand-500">
            Run any PDF tool, then tap “Save to My Files” to keep the result here.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {files.map((f) => (
            <div key={f.id} className="card flex items-center gap-3 py-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-100 text-brand-500 dark:bg-white/5">
                <FileText size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink" title={f.name}>
                  {f.name}
                </p>
                <p className="text-xs text-brand-400">
                  {fmtSize(f.size)} · {fmtDate(f.createdAt)}
                  {f.tool ? ` · ${f.tool}` : ""}
                </p>
              </div>
              <button
                onClick={() => download(f)}
                disabled={busyId === f.id}
                className="btn-ghost h-9"
                title="Download"
              >
                {busyId === f.id ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              </button>
              <button
                onClick={() => del(f)}
                className="btn-ghost h-9 text-danger"
                title="Delete"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
