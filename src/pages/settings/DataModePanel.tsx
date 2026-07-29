import { useEffect, useState } from "react";
import { Cloud, HardDrive, Check, Download, Upload, FolderOpen, RefreshCw } from "lucide-react";
import { getDataMode, setDataMode, type DataMode } from "../../lib/dataMode";
import { cloudConfigured } from "../../lib/supabase";
import {
  autoSyncEnabled,
  setAutoSyncEnabled,
  getSyncStatus,
  syncNow,
  syncCycle,
  markAllForSync,
  cloudSessionEmail,
  cloudSignIn,
  cloudSignUp,
  cloudSignOut,
  type SyncStatus,
} from "../../lib/sync";
import {
  migrateCloudToLocal,
  migrateLocalToCloud,
  normalizeLocalEmirates,
  type MigrateResult,
} from "../../lib/migrate";
import { canUseLocalMode, hasLocalData, ENFORCE_LICENSING } from "../../lib/license";
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
  backupAll,
  restoreAll,
} from "../../lib/localPaths";

// Cloud sync card (local mode only): connect a cloud account and this device
// syncs both ways — local changes upload within a second, and edits from your
// other devices or teammates download automatically.
function CloudSyncCard() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signup, setSignup] = useState(false);
  const [connected, setConnected] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(autoSyncEnabled());
  const [sync, setSync] = useState<SyncStatus>(getSyncStatus());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");

  useEffect(() => {
    cloudSessionEmail().then(setConnected).catch(() => {});
    const onStatus = () => {
      setSync(getSyncStatus());
      setEnabled(autoSyncEnabled());
    };
    window.addEventListener("filey:sync-status", onStatus);
    return () => window.removeEventListener("filey:sync-status", onStatus);
  }, []);

  const connect = async () => {
    setBusy(true);
    setErr("");
    setInfo("");
    try {
      if (signup) {
        const r = await cloudSignUp(email.trim(), password);
        if (r === "confirm") {
          setInfo("Account created — confirm it from the email we sent, then connect.");
          setSignup(false);
          return;
        }
      } else {
        await cloudSignIn(email.trim(), password);
      }
      setConnected(email.trim());
      setPassword("");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    await cloudSignOut();
    setConnected(null);
  };

  const uploadAll = async () => {
    if (
      !window.confirm(
        "Upload ALL local data to the cloud now? Cloud copies of the same records are overwritten — this device wins."
      )
    )
      return;
    setBusy(true);
    setErr("");
    try {
      await markAllForSync();
      const ok = await syncNow(null, { manual: true });
      // syncNow reports its own reason via sync status; surface anything left.
      if (!ok && getSyncStatus().state !== "error")
        setErr("Upload did not run. Check that you're signed in and online.");
    } catch (e) {
      // Without this the whole thing failed in silence: setErr("") above, no
      // catch, and the rejection vanished into an unhandled promise.
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const statusLine =
    sync.state === "syncing"
      ? "Syncing…"
      : sync.state === "error"
        ? `Sync failed: ${sync.error}`
        : sync.at
          ? `Last synced ${new Date(sync.at).toLocaleString()}`
          : "Waiting for changes to sync.";

  return (
    <div className="border-t border-brand-100 pt-4 space-y-3">
      <div>
        <p className="font-medium text-ink flex items-center gap-2">
          <RefreshCw size={16} /> Cloud sync (automatic)
        </p>
        <p className="text-sm text-brand-500 mt-0.5">
          Keep working offline on this device; changes upload to your cloud
          account within seconds, and edits from your other devices or
          teammates download automatically. Unpushed local edits always win.
        </p>
      </div>

      {connected ? (
        <>
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span className="inline-flex items-center gap-1 text-success">
              <Check size={14} /> Connected as {connected}
            </span>
            <button className="btn-ghost shrink-0" onClick={disconnect}>
              Disconnect
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => {
                setAutoSyncEnabled(e.target.checked);
                setEnabled(e.target.checked);
              }}
            />
            Sync changes automatically
          </label>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              className="btn-ghost"
              disabled={busy || sync.state === "syncing"}
              onClick={() => {
                setErr("");
                void syncCycle(null, { manual: true }).catch((e) =>
                  setErr(e instanceof Error ? e.message : String(e))
                );
              }}
            >
              Sync now
            </button>
            <button className="btn-ghost" disabled={busy} onClick={uploadAll}>
              Upload all local data
            </button>
          </div>
          <p
            className={`text-xs ${sync.state === "error" ? "text-danger" : "text-brand-500"}`}
          >
            {statusLine}
          </p>
        </>
      ) : (
        <>
          <div className="flex items-end gap-2 flex-wrap">
            <label className="text-sm text-ink">
              <span className="block text-xs text-brand-500 mb-1">Email</span>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </label>
            <label className="text-sm text-ink">
              <span className="block text-xs text-brand-500 mb-1">Password</span>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={signup ? "new-password" : "current-password"}
              />
            </label>
            <button
              className="rounded-xl bg-ink text-white px-4 py-2.5 text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
              disabled={busy || !email || !password}
              onClick={connect}
            >
              {busy ? "Working…" : signup ? "Create account" : "Connect"}
            </button>
          </div>
          <button
            className="text-xs text-brand-500 underline cursor-pointer"
            onClick={() => setSignup((s) => !s)}
          >
            {signup ? "Have an account? Sign in" : "New to Filey Cloud? Create an account"}
          </button>
        </>
      )}
      {info && (
        <p className="text-sm text-ink bg-primary-50 rounded-lg px-3 py-2">{info}</p>
      )}
      {err && (
        <p className="text-sm text-danger bg-danger/10 rounded-lg px-3 py-2">{err}</p>
      )}
    </div>
  );
}

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

  const [backupMsg, setBackupMsg] = useState("");
  const [emirateMsg, setEmirateMsg] = useState("");

  const runEmirateFix = async () => {
    setEmirateMsg("");
    try {
      const n = await normalizeLocalEmirates();
      setEmirateMsg(
        n
          ? `Updated ${n} field${n === 1 ? "" : "s"} to the current emirate codes.`
          : "All records already use the current emirate codes."
      );
    } catch (e: any) {
      setEmirateMsg(`Failed: ${e?.message ?? e}`);
    }
  };

  const runBackup = async () => {
    const dir = await pickFolder();
    if (!dir) return;
    const dest = `${dir}/filey-backup-${new Date().toISOString().slice(0, 10)}`;
    setBackupMsg("");
    try {
      const path = await backupAll(dest);
      setBackupMsg(`Full backup saved (database + files): ${path}`);
    } catch (e: any) {
      setBackupMsg(`Backup failed: ${e?.message ?? e}`);
    }
  };

  const runRestore = async () => {
    const src = await pickFolder();
    if (!src) return;
    if (
      !window.confirm(
        `Restore the full backup in:\n${src}\n\nThis REPLACES all data AND files on this device. The app will restart. Make a backup first if unsure.`
      )
    )
      return;
    try {
      await restoreAll(src);
      await restartApp();
    } catch (e: any) {
      setBackupMsg(`Restore failed: ${e?.message ?? e}`);
    }
  };

  const switchTo = async (m: DataMode) => {
    if (m === mode) return;
    if (m === "cloud" && !cloudConfigured) return;
    // Offline/local mode is the licensed tier; cloud is the free default.
    if (m === "local" && !(await canUseLocalMode())) {
      setErr(
        "Offline mode comes with Filey Freedom (AED 499, one-time). Get it under Settings → Desktop License, then switch."
      );
      return;
    }
    // Offline and cloud are separate stores. Switching to offline on a device
    // that has never held local records opened an empty workspace — no company
    // details, no customers — which reads as though the app threw your data
    // away. Copying it down was a separate button you had to know to press
    // first, so offer it here, where the need actually arises.
    if (m === "local" && !(await hasLocalData())) {
      const bring = window.confirm(
        "Bring your cloud data to this device first?\n\n" +
          "Offline mode keeps its own copy, separate from the cloud, and this device has none yet. Switching without copying opens an empty workspace — your cloud records are not deleted either way.\n\n" +
          "OK — copy it down now, then switch.\n" +
          "Cancel — switch to an empty offline workspace."
      );
      if (bring) {
        setBusy(true);
        setErr("");
        setResult(null);
        try {
          setResult(await migrateCloudToLocal(setProgress));
        } catch (e) {
          // Switching anyway would drop them into the empty workspace this was
          // meant to prevent, so stay put and explain.
          setErr(
            `Could not copy your cloud data, so this device is still on cloud mode: ${
              e instanceof Error ? e.message : String(e)
            }`
          );
          return;
        } finally {
          setBusy(false);
          setProgress("");
        }
      }
    }
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

  const runPush = async () => {
    if (
      !window.confirm(
        "Upload this device's local data to your cloud account? The web version will then show the same data. Cloud records with the same id are OVERWRITTEN — this device wins. You must be signed in."
      )
    )
      return;
    setBusy(true);
    setErr("");
    setResult(null);
    try {
      const res = await migrateLocalToCloud(setProgress);
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
        onClick={() => void switchTo(m)}
        disabled={disabled}
        className={`w-full text-left rounded-xl border p-4 transition ${
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
          m="cloud"
          icon={Cloud}
          title="Filey Cloud (free)"
          desc={
            cloudConfigured
              ? "Stored securely in the cloud and synced across your devices and team."
              : "Not available — Supabase isn't configured in this build."
          }
          disabled={!cloudConfigured}
        />
        <Card
          m="local"
          icon={HardDrive}
          title="Offline (this device)"
          desc={
            "Everything stored on this computer. No account, no internet, never leaves the machine." +
            (ENFORCE_LICENSING ? " Requires a Filey Desktop license." : "")
          }
        />
      </div>
      {err && (
        <p className="text-sm text-danger bg-danger/10 rounded-lg px-3 py-2">{err}</p>
      )}

      {mode === "local" && cloudConfigured && <CloudSyncCard />}

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

          {/* Backup & restore */}
          <div>
            <p className="font-medium text-ink flex items-center gap-2">
              <Download size={16} /> Backup &amp; restore
            </p>
            <p className="text-sm text-brand-500 mt-0.5 mb-2">
              Save a full copy — database <em>and</em> your files — into a backup
              folder, or restore from one. Your offline safety net; keep it
              somewhere safe (USB drive, synced folder).
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <button className="btn-ghost" onClick={runBackup}>
                Export backup
              </button>
              <button className="btn-ghost" onClick={runRestore}>
                Restore backup
              </button>
            </div>
            {backupMsg && (
              <p className="text-xs text-brand-500 mt-2 break-all">{backupMsg}</p>
            )}
          </div>

          {/* Data fixes */}
          <div>
            <p className="font-medium text-ink flex items-center gap-2">
              <Check size={16} /> Fix emirate codes
            </p>
            <p className="text-sm text-brand-500 mt-0.5 mb-2">
              Rewrite older records to the UAE e-invoice emirate codes
              (AUH/DXB/SHJ…). Safe to run anytime.
            </p>
            <button className="btn-ghost" onClick={runEmirateFix}>
              Normalize emirate codes
            </button>
            {emirateMsg && (
              <p className="text-xs text-brand-500 mt-2 break-all">{emirateMsg}</p>
            )}
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
            className="rounded-xl bg-ink text-white px-4 py-2.5 text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
          >
            {busy ? progress || "Working…" : "Import cloud data"}
          </button>

          <div className="pt-2">
            <p className="font-medium text-ink flex items-center gap-2">
              <Upload size={16} /> Push local data to the cloud
            </p>
            <p className="text-sm text-brand-500 mt-0.5">
              Uploads everything on this device (invoices, customers, products,
              files…) to your cloud account, so the web version shows the same
              data. Cloud records sharing an id are overwritten by this
              device's copy.
            </p>
          </div>
          <button
            onClick={runPush}
            disabled={busy}
            className="rounded-xl bg-ink text-white px-4 py-2.5 text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
          >
            {busy ? progress || "Working…" : "Push local data to cloud"}
          </button>
          {result && (
            <div className="text-sm">
              <p className="text-success font-medium mb-1">
                Done. Per-table summary below.
              </p>
              <ul className="text-brand-500 grid grid-cols-2 gap-x-6 gap-y-0.5">
                {result
                  .filter((r) => r.rows > 0 || r.error)
                  .map((r) => (
                    <li key={r.table} className="flex justify-between" title={r.error}>
                      <span>{r.table}</span>
                      <span className={r.error ? "text-danger" : "tabular-nums"}>
                        {r.error ? `${r.rows} · ${r.error}` : r.rows}
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
