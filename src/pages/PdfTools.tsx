import { useEffect, useMemo, useState } from "react";
import {
  Star,
  ChevronRight,
  Upload,
  FolderClosed,
  FolderPlus,
  MoreHorizontal,
  CheckCircle2,
  Wrench,
} from "lucide-react";
import { PageHeader, InfoCard, Card } from "../components/ui";
import { toolRuns } from "../lib/api";
import PdfToolbox, {
  PDF_TOOLS,
  PDF_CATS,
  ToolRunner,
  toolById,
  type Tool,
} from "../components/PdfToolbox";

interface RunLog {
  toolName: string;
  file: string;
  ts: number;
}

const FAVS_KEY = "filey_tool_favs";

const loadFavs = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(FAVS_KEY) || "null");
    return Array.isArray(v) ? v : ["merge", "compress", "img2pdf", "watermark"];
  } catch {
    return ["merge", "compress", "img2pdf", "watermark"];
  }
};

function ago(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const CAT_META: Record<string, string> = {
  Organize: "Merge, split, extract & delete pages",
  Edit: "Rotate, number & watermark documents",
  Convert: "Images ↔ PDF conversion",
  Optimize: "Compress & slim files",
};

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
  const [favs, setFavs] = useState<string[]>([]);
  const [filter, setFilter] = useState<string | null>(null);

  const refreshRuns = () =>
    toolRuns
      .list()
      .then((rows) =>
        setRuns(
          rows.slice(0, 20).map((r) => ({
            toolName: r.tool_name,
            file: r.file_name,
            ts: new Date(r.created_at).getTime(),
          }))
        )
      )
      .catch(() => {});

  useEffect(() => {
    refreshRuns();
    setFavs(loadFavs());
  }, []);

  const logRun = async (toolId: string, files: string[]) => {
    const t = toolById(toolId);
    try {
      await toolRuns.log(toolId, t?.name ?? toolId, files[0] ?? "file");
    } catch {
      /* offline — queued by the api layer */
    }
    refreshRuns();
  };

  const toggleFav = (id: string) => {
    const next = favs.includes(id)
      ? favs.filter((x) => x !== id)
      : [...favs, id];
    setFavs(next);
    localStorage.setItem(FAVS_KEY, JSON.stringify(next));
  };

  const quick = PDF_TOOLS.slice(0, 8);
  const favTools = useMemo(
    () => favs.map(toolById).filter(Boolean) as Tool[],
    [favs]
  );

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
            className="btn-ghost text-xs"
            onClick={() => setFilter(filter ? null : "Organize")}
          >
            {filter ? "Hide tools" : "View all tools"}
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
            onClick={() => setFilter("Organize")}
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

      {/* Activity / favorites / categories */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-4">
        <InfoCard title="Recent Activity" className="lg:col-span-2">
          {runs.length === 0 ? (
            <p className="text-sm text-brand-400">
              No tool runs yet — your processed files will appear here.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {runs.slice(0, 5).map((r, i) => (
                <li
                  key={i}
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
                  <span className="pill bg-success/15 text-success shrink-0">
                    Completed
                  </span>
                </li>
              ))}
            </ul>
          )}
        </InfoCard>

        <InfoCard title="Favorite Tools">
          <ul className="space-y-2">
            {favTools.length === 0 && (
              <li className="text-sm text-brand-400">
                Star a tool to pin it here.
              </li>
            )}
            {favTools.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-2"
              >
                <button
                  className="flex items-center gap-2 min-w-0 cursor-pointer"
                  onClick={() => setActive(t)}
                >
                  <span className="rounded-lg bg-primary-100 text-primary-700 p-1.5">
                    <t.icon size={15} />
                  </span>
                  <span className="text-sm font-semibold text-ink truncate">
                    {t.name}
                  </span>
                </button>
                <button
                  aria-label="Unpin"
                  onClick={() => toggleFav(t.id)}
                  className="text-primary-500 cursor-pointer"
                >
                  <Star size={15} fill="currentColor" />
                </button>
              </li>
            ))}
          </ul>
        </InfoCard>

        <InfoCard title="Tool Categories">
          <ul className="space-y-1">
            {PDF_CATS.map((c) => {
              const count = PDF_TOOLS.filter((t) => t.cat === c).length;
              return (
                <li key={c}>
                  <button
                    onClick={() => setFilter(c)}
                    className="w-full flex items-center justify-between gap-2 rounded-xl px-2 py-2 hover:bg-brand-50 transition-colors cursor-pointer text-left"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="rounded-lg bg-primary-100 text-primary-700 p-1.5">
                        <Wrench size={15} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink">
                          {c} Tools
                        </p>
                        <p className="text-[11px] text-brand-400 truncate">
                          {count} tools · {CAT_META[c]}
                        </p>
                      </div>
                    </div>
                    <ChevronRight size={15} className="text-brand-300 shrink-0" />
                  </button>
                </li>
              );
            })}
          </ul>
        </InfoCard>
      </div>

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

      {/* All tools (filtered) */}
      {filter && (
        <Card className="mt-4">
          <div className="flex items-center justify-between mb-4">
            <p className="font-bold text-ink">All {filter} Tools</p>
            <button
              className="btn-ghost text-xs"
              onClick={() => setFilter(null)}
            >
              Collapse
            </button>
          </div>
          <PdfToolbox filter={filter} onComplete={logRun} />
        </Card>
      )}

      {active && (
        <ToolRunner
          tool={active}
          onClose={() => setActive(null)}
          onComplete={logRun}
        />
      )}

      <p className="flex items-center gap-1.5 text-[11px] text-brand-400 mt-4">
        <CheckCircle2 size={12} className="text-success" />
        All processing happens locally — files never leave this device.
      </p>
    </div>
  );
}
