import { useEffect, useState } from "react";
import { Cloud, HardDrive, Check, Download, FolderOpen } from "lucide-react";
import { getDataMode, setDataMode, type DataMode } from "../../lib/dataMode";
import { cloudConfigured } from "../../lib/supabase";
import { migrateCloudToLocal, type MigrateResult } from "../../lib/migrate";
import {
  hasTauri,
  pickFolder,
  getDataDir,
  setDataDir,
  restartApp,
  getExportDir,
  setExportDir,
  clearExportDir,
  openFolder,
} from "../../lib/localPaths";

// Switch where data lives. Changing mode reloads the app; it does NOT migrate
// data — local data stays on this device, cloud data stays in your account.
export default function DataModePanel() {
  const mode: DataMode = getDataMode() ?? (cloudConfigured ? "cloud" : "local");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<MigrateResult[] | null>(null);
  const [err, setErr] = useState("");
  const [dataDir, setDataDirState] = useState("");
  const [exportDir, setExportDirState] = useState(getExportDir());

  useEffect(() => {
    if (hasTauri) getDataDir().then(setDataDirState).catch(() => {});
  }, []);

  const changeDataDir = async () => {
    const dir = await pickFolder();
    if (!dir) return;
    if (
      !window.confirm(
        `Move the Filey database to:\n${dir}\n\nThe app will restart. Your current data is copied to the new location.`
      )
    )
      return;
    try {
      await setDataDir(dir);
      await restartApp();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  };

  const changeExportDir = async () => {
    const dir = await pickFolder();
    if (!dir) return;
    setExportDir(dir);
    setExportDirState(dir);
  };

  const switchTo = (m: DataMode) => {
    if (m === mode) return;
    if (m === "cloud" && !cloudConfigured) return;
    setDataMode(m);
    window.location.reload();
  };

  const runImport = async () => {
    if (
      !window.confirm(
        "Copy your cloud data onto this device? This replaces any existing local data. You must be signed in to your cloud account."
      )
    )
      return;
    setBusy(true);
    setErr("");
    setResult(null);
    try {
      const res = await migrateCloudToLocal(setProgress);
      setResult(res);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const Card = ({
    m,
    icon: Icon,
    title,
    desc,
    disabled,
  }: {
    m: DataMode;
    icon: typeof Cloud;
    title: string;
    desc: string;
    disabled?: boolean;
  }) => {
    const active = mode === m;
    return (
      <button
        onClick={() => switchTo(m)}
        disabled={disabled}
        className={`w-full text-left rounded-2xl border p-4 transition ${
          active
            ? "border-primary-400 bg-primary-50"
            : "border-brand-200 hover:border-brand-300"
        } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
      >
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-ink p-2.5 text-white">
            <Icon size={20} />
          </div>
          <div className="flex-1">
            <p className="font-medium text-ink flex items-center gap-2">
              {title}
              {active && (
                <span className="inline-flex items-center gap-1 text-xs text-primary-600">
                  <Check size={14} /> Active
                </span>
              )}
            </p>
            <p className="text-sm text-brand-500 mt-0.5">{desc}</p>
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="text-lg font-medium text-ink">Data & Storage</h2>
        <p className="text-sm text-brand-500 mt-1">
          Choose where Filey keeps your data. Switching reloads the app and does
          not move existing data between local and cloud.
        </p>
      </div>
      <div className="space-y-3">
        <Card
          m="local"
          icon={HardDrive}
          title="Offline (this device)"
          desc="Everything stored on this computer. No account, no internet, never leaves the machine."
        />
        <Card
          m="cloud"
          icon={Cloud}
          title="Cloud sync"
          desc={
            cloudConfigured
              ? "Stored in your Supabase account and synced across devices."
              : "Not available — Supabase isn't configured in this build."
          }
          disabled={!cloudConfigured}
        />
      </div>

      {hasTauri && (
        <div className="border-t border-brand-100 pt-4 space-y-4">
          {/* Database location */}
          <div>
            <p className="font-medium text-ink flex items-center gap-2">
              <HardDrive size={16} /> Data location
            </p>
            <p className="text-sm text-brand-500 mt-0.5 mb-2">
              Where the Filey database (all data &amp; files) is stored on this
              computer. Move it to your Desktop, a USB drive, or any folder.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <code className="text-xs bg-brand-100 dark:bg-white/12 px-2 py-1.5 rounded flex-1 min-w-0 truncate">
                {dataDir || "…"}
              </code>
              <button className="btn-ghost shrink-0" onClick={changeDataDir}>
                Change folder
              </button>
              {dataDir && (
                <button
                  className="btn-ghost shrink-0"
                  onClick={() => openFolder(dataDir)}
                >
                  <FolderOpen size={14} /> Open
                </button>
              )}
            </div>
          </div>

          {/* Documents export folder */}
          <div>
            <p className="font-medium text-ink flex items-center gap-2">
              <FolderOpen size={16} /> Documents folder
            </p>
            <p className="text-sm text-brand-500 mt-0.5 mb-2">
              Save generated documents (invoices, quotes…) as real PDF files
              here, in addition to keeping them in the app.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <code className="text-xs bg-brand-100 dark:bg-white/12 px-2 py-1.5 rounded flex-1 min-w-0 truncate">
                {exportDir || "Not set — documents stay in the app only"}
              </code>
              <button className="btn-ghost shrink-0" onClick={changeExportDir}>
                {exportDir ? "Change" : "Choose folder"}
              </button>
              {exportDir && (
                <>
                  <button
                    className="btn-ghost shrink-0"
                    onClick={() => openFolder(exportDir)}
                  >
                    <FolderOpen size={14} /> Open
                  </button>
                  <button
                    className="btn-ghost shrink-0 text-danger"
                    onClick={() => {
                      clearExportDir();
                      setExportDirState("");
                    }}
                  >
                    Clear
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {cloudConfigured && (
        <div className="border-t border-brand-100 pt-4 space-y-3">
          <div>
            <p className="font-medium text-ink flex items-center gap-2">
              <Download size={16} /> Import cloud data to this device
            </p>
            <p className="text-sm text-brand-500 mt-0.5">
              Copies everything from your cloud account (invoices, customers,
              products, files…) into local storage. Sign in to Cloud mode first.
              Replaces existing local data.
            </p>
          </div>
          <button
            onClick={runImport}
            disabled={busy}
            className="rounded-2xl bg-ink text-white px-4 py-2.5 text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
          >
            {busy ? progress || "Importing…" : "Import cloud data"}
          </button>
          {err && (
            <p className="text-sm text-danger bg-danger/10 rounded-lg px-3 py-2">
              {err}
            </p>
          )}
          {result && (
            <div className="text-sm">
              <p className="text-success font-medium mb-1">
                Imported. Switch to Offline mode above to use it.
              </p>
              <ul className="text-brand-500 grid grid-cols-2 gap-x-6 gap-y-0.5">
                {result
                  .filter((r) => r.rows > 0 || r.error)
                  .map((r) => (
                    <li key={r.table} className="flex justify-between">
                      <span>{r.table}</span>
                      <span className={r.error ? "text-danger" : "tabular-nums"}>
                        {r.error ? "failed" : r.rows}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
