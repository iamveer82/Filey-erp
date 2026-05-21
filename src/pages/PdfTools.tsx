import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Upload,
  FolderClosed,
  FolderPlus,
  MoreHorizontal,
  CheckCircle2,
  LayoutGrid,
  Download,
  Pencil,
  SquarePen,
  Trash2,
  Share2,
  Eye,
} from "lucide-react";
import { PageHeader, InfoCard } from "../components/ui";
import { toolRuns } from "../lib/api";
import {
  uploadOutputs,
  removePaths,
  downloadBytes,
  fileNameOf,
  ensureRoom,
  usedBytes,
  STORAGE_QUOTA_BYTES,
} from "../lib/toolStorage";
import { downloadFile, type OutFile } from "../lib/pdfTools";
import {
  PDF_TOOLS,
  ToolRunner,
  toolById,
  type Tool,
} from "../components/PdfToolbox";
import ToolBrowserModal from "../components/ToolBrowserModal";
import PreviewModal from "../components/PreviewModal";

interface RunLog {
  id: number;
  toolId: string;
  toolName: string;
  file: string;
  paths: string[];
  ts: number;
}

function mb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ago(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const SAMPLE_FOLDERS = [
  { name: "Invoices", files: 24, size: "245 MB" },
  { name: "Contracts", files: 16, size: "120 MB" },
  { name: "Receipts", files: 32, size: "310 MB" },
  { name: "Reports", files: 18, size: "180 MB" },
  { name: "Scans", files: 27, size: "—" },
];

export default function ToolsPage() {
  const [active, setActive] = useState<Tool | null>(null);
  const [runs, setRuns] = useState<RunLog[]>([]);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [preview, setPreview] = useState<RunLog | null>(null);
  const [used, setUsed] = useState(0);

  const refreshRuns = () => {
    toolRuns
      .list()
      .then((rows) =>
        setRuns(
          rows.slice(0, 20).map((r) => ({
            id: r.id,
            toolId: r.tool,
            toolName: r.tool_name,
            file: r.file_name,
            paths: r.storage_paths ?? [],
            ts: new Date(r.created_at).getTime(),
          }))
        )
      )
      .catch(() => {});
    usedBytes().then(setUsed).catch(() => {});
  };

  useEffect(() => {
    refreshRuns();
  }, []);

  const logRun = async (
    toolId: string,
    files: string[],
    outputs: OutFile[]
  ) => {
    const t = toolById(toolId);
    try {
      const runId = await toolRuns.log(
        toolId,
        t?.name ?? toolId,
        files[0] ?? "file"
      );
      if (typeof runId === "number" && runId > 0) {
        const total = outputs.reduce((s, o) => s + o.bytes.byteLength, 0);
        const room = await ensureRoom(total);
        if (room) {
          const paths = await uploadOutputs(runId, outputs);
          if (paths.length) await toolRuns.setPaths(runId, paths, total);
        }
      }
    } catch {
      /* offline / storage unavailable — log still recorded */
    }
    refreshRuns();
  };

  const openTool = (toolId: string) => {
    const t = toolById(toolId);
    if (t) setActive(t);
  };

  const downloadRun = async (r: RunLog) => {
    if (!r.paths.length) {
      openTool(r.toolId);
      return;
    }
    try {
      for (const p of r.paths) {
        const got = await downloadBytes(p);
        if (got) downloadFile({ name: fileNameOf(p), bytes: got.bytes });
      }
    } catch (e) {
      alert(
        `Could not download: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  };

  const renameRun = async (r: RunLog) => {
    const next = prompt("Rename file", r.file);
    if (next == null || !next.trim() || next === r.file) return;
    try {
      await toolRuns.rename(r.id, next.trim());
      refreshRuns();
    } catch (e) {
      alert(`Could not rename: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const deleteRun = async (r: RunLog) => {
    if (!confirm(`Remove "${r.file}" and its stored files?`)) return;
    try {
      await removePaths(r.paths);
      await toolRuns.remove(r.id);
      refreshRuns();
    } catch (e) {
      alert(`Could not delete: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const shareRun = async (r: RunLog) => {
    const text = `${r.file} — processed with ${r.toolName} (${ago(r.ts)})`;
    try {
      if (navigator.share) await navigator.share({ title: r.file, text });
      else {
        await navigator.clipboard.writeText(text);
        alert("Copied details to clipboard.");
      }
    } catch {
      /* user dismissed share sheet */
    }
  };

  const quick = PDF_TOOLS.slice(0, 8);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Tools"
        subtitle="Powerful tools to help you manage and process your business documents"
      />

      {/* Quick access */}
      <InfoCard
        title="Quick Access"
        className="mb-4"
        action={
          <button
            className="btn-primary text-xs"
            onClick={() => setBrowseOpen(true)}
          >
            <LayoutGrid size={14} /> View all
          </button>
        }
      >
        <p className="text-xs text-brand-400 -mt-3 mb-4">
          Your most used tools — every action runs locally on this device
        </p>
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-3">
          {quick.map((t) => (
            <button
              key={t.id}
              onClick={() => setActive(t)}
              className="flex flex-col items-center gap-2 rounded-xl p-3 hover:bg-brand-50 transition-colors cursor-pointer"
            >
              <div className="rounded-2xl bg-primary-100 text-primary-700 p-3">
                <t.icon size={20} />
              </div>
              <span className="text-[11px] font-semibold text-brand-600 text-center leading-tight">
                {t.name}
              </span>
            </button>
          ))}
          <button
            onClick={() => setBrowseOpen(true)}
            className="flex flex-col items-center gap-2 rounded-xl p-3 hover:bg-brand-50 transition-colors cursor-pointer"
          >
            <div className="rounded-2xl bg-brand-100 text-brand-500 p-3">
              <MoreHorizontal size={20} />
            </div>
            <span className="text-[11px] font-semibold text-brand-600">
              More Tools
            </span>
          </button>
        </div>
      </InfoCard>

      {/* Recent activity (full width) */}
      <InfoCard
        title="Recent Activity"
        className="mb-4"
        action={
          <span
            className="text-[11px] font-semibold text-brand-400"
            title="Stored output files count toward your account quota"
          >
            {mb(used)} / {mb(STORAGE_QUOTA_BYTES)} used
          </span>
        }
      >
        {runs.length === 0 ? (
          <p className="text-sm text-brand-400">
            No tool runs yet — your processed files will appear here.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {runs.slice(0, 8).map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">
                    {r.file}
                  </p>
                  <p className="text-[11px] text-brand-400">
                    {r.toolName} · {ago(r.ts)}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    aria-label="Preview"
                    title="Preview a document"
                    onClick={() => setPreview(r)}
                    className="rounded-lg p-1.5 text-brand-500 hover:bg-brand-50 cursor-pointer"
                  >
                    <Eye size={16} />
                  </button>
                  <button
                    aria-label="Download"
                    title={
                      r.paths.length
                        ? "Download stored file"
                        : "Re-open tool to regenerate"
                    }
                    onClick={() => downloadRun(r)}
                    className="rounded-lg p-1.5 text-brand-500 hover:bg-brand-50 cursor-pointer"
                  >
                    <Download size={16} />
                  </button>
                  <RunMenu
                    onRename={() => renameRun(r)}
                    onEdit={() => openTool(r.toolId)}
                    onDelete={() => deleteRun(r)}
                    onShare={() => shareRun(r)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </InfoCard>

      {/* Files + storage */}
      <div>
        <InfoCard
          title="Files"
          action={
            <button className="btn-ghost text-xs">
              <Upload size={14} /> Upload
            </button>
          }
        >
          <p className="text-xs text-brand-400 -mt-3 mb-4">
            Organize and manage files for your tools
          </p>
          <div className="flex flex-wrap gap-2 mb-4">
            {SAMPLE_FOLDERS.map((f) => (
              <div
                key={f.name}
                className="flex items-center gap-2 rounded-xl border border-brand-200 px-3 py-2"
              >
                <FolderClosed size={16} className="text-secondary-500" />
                <div className="leading-tight">
                  <p className="text-xs font-semibold text-ink">{f.name}</p>
                  <p className="text-[10px] text-brand-400">
                    {f.files} files
                  </p>
                </div>
              </div>
            ))}
            <button className="flex items-center gap-2 rounded-xl border border-dashed border-brand-300 px-3 py-2 text-brand-500 text-xs font-semibold hover:bg-brand-50 cursor-pointer">
              <FolderPlus size={16} /> New Folder
            </button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-brand-400">
                <th className="py-2">Name</th>
                <th className="py-2">Files</th>
                <th className="py-2">Size</th>
              </tr>
            </thead>
            <tbody>
              {SAMPLE_FOLDERS.slice(0, 4).map((f) => (
                <tr key={f.name} className="border-t border-brand-100">
                  <td className="py-2.5 font-semibold text-ink flex items-center gap-2">
                    <FolderClosed size={15} className="text-secondary-500" />
                    {f.name}
                  </td>
                  <td className="py-2.5 text-brand-600">{f.files} files</td>
                  <td className="py-2.5 text-brand-600">{f.size}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </InfoCard>
      </div>

      {active && (
        <ToolRunner
          tool={active}
          onClose={() => setActive(null)}
          onComplete={logRun}
        />
      )}

      <ToolBrowserModal
        open={browseOpen}
        onClose={() => setBrowseOpen(false)}
        onComplete={logRun}
      />

      <PreviewModal
        open={!!preview}
        title={preview?.file}
        paths={preview?.paths ?? []}
        onClose={() => setPreview(null)}
      />

      <p className="flex items-center gap-1.5 text-[11px] text-brand-400 mt-4">
        <CheckCircle2 size={12} className="text-success" />
        All processing happens locally — files never leave this device.
      </p>
    </div>
  );
}

function RunMenu({
  onRename,
  onEdit,
  onDelete,
  onShare,
}: {
  onRename: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onShare: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const item = (
    icon: ReactNode,
    label: string,
    fn: () => void,
    danger?: boolean
  ) => (
    <button
      onClick={() => {
        setOpen(false);
        fn();
      }}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left cursor-pointer transition-colors ${
        danger
          ? "text-danger hover:bg-danger/10"
          : "text-brand-600 hover:bg-brand-50"
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="relative" ref={ref}>
      <button
        aria-label="More actions"
        onClick={() => setOpen((v) => !v)}
        className="rounded-lg p-1.5 text-brand-500 hover:bg-brand-50 cursor-pointer"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-40 rounded-xl border border-brand-200 bg-white shadow-bento-hover py-1 z-20">
          {item(<Pencil size={14} />, "Rename", onRename)}
          {item(<SquarePen size={14} />, "Edit", onEdit)}
          {item(<Share2 size={14} />, "Share", onShare)}
          {item(<Trash2 size={14} />, "Delete", onDelete, true)}
        </div>
      )}
    </div>
  );
}
