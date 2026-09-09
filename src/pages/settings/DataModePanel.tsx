import { useEffect, useState } from "react";
import { Cloud, HardDrive, Check, Download, Upload, FolderOpen } from "lucide-react";
import { getDataMode, type DataMode } from "../../lib/dataMode";
import { cloudConfigured } from "../../lib/supabase";
import { switchWorkspace } from "../../lib/switchWorkspace";
import { useAuth } from "../../lib/auth";
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
import { setMigrating, isMigrating } from "../../lib/sync";
import { hasLocalData } from "../../lib/license";
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
import { todayYmd } from "../../lib/format";
import { pendingCloudWrites } from "../../lib/api";
import { SettingsPanel, SettingsSection } from "../../components/SettingsLayout";

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
  /** Sign-in failed in the way that usually means "no cloud account yet". */
  const [offerSignup, setOfferSignup] = useState(false);

  useEffect(() => {
    cloudSessionEmail()
      .then(setConnected)
      .catch(() => {});
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
          setInfo("Account created - confirm it from the email we sent, then connect.");
          setSignup(false);
          return;
        }
      } else {
        await cloudSignIn(email.trim(), password);
      }
      setConnected(email.trim());
      setPassword("");
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      // Supabase returns the SAME "Invalid login credentials" whether the
      // password is wrong or no such account exists — it will not confirm
      // whether an email is registered. People reach this card after using
      // Filey offline, where the email only ever existed on their own device
      // and no cloud account was created, so "you typed the wrong password"
      // is usually the wrong guess. Name both, and offer the way forward
      // instead of leaving them on a dead end.
      if (!signup && /invalid login credentials|invalid email or password/i.test(msg)) {
        setErr(
          "That email and password didn't match a Filey Cloud account. If you've been using Filey offline, this email has no cloud account yet - creating one takes a moment and your on-device data stays exactly where it is."
        );
        setOfferSignup(true);
      } else {
        setErr(msg);
      }
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
        "Upload ALL local data to the cloud now? Cloud copies of the same records are overwritten - this device wins."
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
    <SettingsSection
      title="Cloud sync (automatic)"
      description="Keep this device and your cloud account up to date."
    >
      <p className="text-sm leading-relaxed text-muted-foreground">
        Keep working offline on this device; changes upload to your cloud account within
        seconds, and edits from your other devices or teammates download automatically.
        Review transfers before enabling sync; local edits replace matching cloud records.
      </p>

      {connected ? (
        <>
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span className="inline-flex min-w-0 items-start gap-1 text-success">
              <Check size={14} className="mt-0.5 shrink-0" />{" "}
              <span className="min-w-0 break-words">Connected as {connected}</span>
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
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="min-w-0 text-sm text-foreground">
              <span className="block text-xs text-brand-500 mb-1">Email</span>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </label>
            <label className="min-w-0 text-sm text-foreground">
              <span className="block text-xs text-brand-500 mb-1">Password</span>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={signup ? "new-password" : "current-password"}
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              className="btn-primary"
              disabled={busy || !email || !password}
              onClick={connect}
            >
              {busy ? "Working…" : signup ? "Create account" : "Connect"}
            </button>
            <button
              className="text-xs text-brand-500 underline cursor-pointer"
              onClick={() => {
                setSignup((s) => !s);
                setErr("");
                setOfferSignup(false);
              }}
            >
              {signup
                ? "Have an account? Sign in"
                : "New to Filey Cloud? Create an account"}
            </button>
          </div>
        </>
      )}
      {info && (
        <p
          role="status"
          className="text-sm text-foreground bg-hover rounded-lg px-3 py-2"
        >
          {info}
        </p>
      )}
      {err && (
        <div
          role="alert"
          className="text-sm text-danger bg-danger/10 rounded-lg px-3 py-2 space-y-2"
        >
          <p>{err}</p>
          {offerSignup && (
            <button
              className="btn-ghost"
              onClick={() => {
                setSignup(true);
                setErr("");
                setOfferSignup(false);
              }}
            >
              Create a cloud account for {email.trim()}
            </button>
          )}
        </div>
      )}
    </SettingsSection>
  );
}

// Switch where data lives. Changing mode reloads the app; it does NOT migrate
// data — local data stays on this device, cloud data stays in your account.
export default function DataModePanel() {
  const mode: DataMode = getDataMode() ?? (cloudConfigured ? "cloud" : "local");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MigrateResult[] | null>(null);
  const [err, setErr] = useState("");
  const [dataDir, setDataDirState] = useState("");
  const [exportDir, setExportDirState] = useState(getExportDir());
  const [pendingWrites, setPendingWrites] = useState(0);
  const [progress, setProgress] = useState("");

  useEffect(() => {
    if (hasTauri)
      getDataDir()
        .then(setDataDirState)
        .catch(() => {});
    void pendingCloudWrites()
      .then((rows) => setPendingWrites(rows.length))
      .catch(() => {});
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
    const dest = `${dir}/filey-backup-${todayYmd()}`;
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

  const { user } = useAuth();
  const [destination, setDestination] = useState<DataMode | null>(null);
  const [copyCloud, setCopyCloud] = useState(false);
  const [localExists, setLocalExists] = useState<boolean | null>(null);
  useEffect(() => {
    void hasLocalData()
      .then(setLocalExists)
      .catch(() =>
        setErr("Could not check the device workspace. Reload before switching.")
      );
  }, []);

  const switchTo = async () => {
    if (!destination || busy) return;
    setBusy(true);
    setErr("");
    try {
      await switchWorkspace(destination, copyCloud);
      window.location.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    if (isMigrating()) {
      setErr("Wait for the active transfer to finish before importing.");
      return;
    }
    if (
      !window.confirm(
        "Copy your cloud data onto this device? This replaces any existing local data. You must be signed in to your cloud account."
      )
    )
      return;
    setBusy(true);
    setErr("");
    setResult(null);
    setMigrating(true);
    try {
      const res = await migrateCloudToLocal(setProgress);
      setResult(res);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
      setMigrating(false);
      setProgress("");
    }
  };

  const runPush = async () => {
    if (isMigrating()) {
      setErr("Wait for the active transfer to finish before uploading.");
      return;
    }
    if (
      !window.confirm(
        "Upload this device's local data to your cloud account? The web version will then show the same data. Cloud records with the same id are OVERWRITTEN - this device wins. You must be signed in."
      )
    )
      return;
    setBusy(true);
    setErr("");
    setResult(null);
    setMigrating(true);
    try {
      const res = await migrateLocalToCloud(setProgress);
      setResult(res);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
      setMigrating(false);
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
        onClick={() => {
          setDestination(m);
          setCopyCloud(false);
          setErr("");
        }}
        disabled={disabled || busy || active}
        aria-pressed={active}
        className={`w-full min-w-0 text-left rounded-lg border p-4 transition-colors ${
          active ? "border-foreground/30 bg-hover" : "border-border hover:bg-hover"
        } ${disabled ? "opacity-50 cursor-not-allowed" : active ? "cursor-default" : "cursor-pointer"}`}
      >
        <div className="flex items-start gap-3">
          <Icon size={18} className="mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground flex flex-wrap items-center gap-2">
              {title}
              {active && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
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
    <SettingsPanel>
      <SettingsSection
        title="Workspace storage"
        description="Choose where this workspace reads and saves your business records."
      >
        <p className="text-sm leading-relaxed text-muted-foreground">
          Local and cloud are separate stores. Switching keeps your account signed in and
          never uploads or replaces records automatically.
        </p>
        <p className="text-sm mt-3 text-foreground break-words">
          <span className="font-medium">
            {mode === "cloud" ? "Cloud workspace" : "Local workspace"}
          </span>
          <span className="text-muted-foreground">
            {" "}
            · {user?.email || "Account not connected"}
          </span>
        </p>
        <div className="grid gap-3 xl:grid-cols-2" aria-label="Workspace storage">
          <Card
            m="cloud"
            icon={Cloud}
            title="Filey Cloud"
            desc="Live account records, shared across your signed-in devices. Requires internet for changes."
            disabled={!cloudConfigured}
          />
          <Card
            m="local"
            icon={HardDrive}
            title="This device"
            disabled={localExists === null}
            desc={
              "Device records, available offline. Cloud sync is optional and controlled separately." +
              " Free core ERP and CRM, with unlimited local invoices."
            }
          />
        </div>
        {destination && destination !== mode && (
          <section
            className="border-t border-border pt-4 space-y-3"
            aria-label="Review workspace switch"
          >
            <h3 className="font-medium">
              Switch to {destination === "cloud" ? "Filey Cloud" : "this device"}
            </h3>
            <p className="text-sm text-muted-foreground">
              {destination === "cloud"
                ? "You will see the records currently saved in your cloud account. Unsynced device changes stay on this device; use Cloud sync below first if you want to transfer them."
                : localExists
                  ? "Resume your saved device records. They may differ from your cloud records. Automatic cloud sync will be off."
                  : "This device has no saved business records yet. Start an empty local workspace or choose to copy your cloud records below."}{" "}
              The app reloads after checking the destination. Finish any unsaved work in
              other tabs first.
            </p>
            {destination === "local" && !localExists && (
              <label className="flex items-start gap-2 text-sm">
                <input
                  className="mt-1"
                  type="checkbox"
                  checked={copyCloud}
                  disabled={busy}
                  onChange={(e) => setCopyCloud(e.target.checked)}
                />
                Copy my cloud records to this empty device workspace
              </label>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                className="btn-primary"
                disabled={busy}
                onClick={() => void switchTo()}
              >
                {busy ? "Checking workspace…" : "Switch workspace"}
              </button>
              <button
                className="btn-ghost"
                disabled={busy}
                onClick={() => setDestination(null)}
              >
                Cancel
              </button>
            </div>
          </section>
        )}
        {err && (
          <p
            role="alert"
            className="text-sm text-danger bg-danger/10 rounded-lg px-3 py-2"
          >
            {err}
          </p>
        )}

        {busy && (
          <p role="status" className="text-sm text-muted-foreground">
            {progress || "Checking workspace…"}
          </p>
        )}
        {pendingWrites > 0 && (
          <div role="status" className="border-t border-border pt-4 text-sm space-y-2">
            <h3 className="font-medium">Older offline saves need review</h3>
            <p className="text-muted-foreground">
              {pendingWrites} queued changes remain on this device. Changes without a
              verified source account are preserved and will not be sent automatically.
              Keep a device backup and contact support before clearing storage.
            </p>
          </div>
        )}
        {result && (
          <details
            open={result.some((r) => r.error)}
            className="text-sm border-t border-border pt-4"
          >
            <summary className="font-medium cursor-pointer">
              {result.some((r) => r.error)
                ? "Transfer needs attention"
                : "Transfer complete — view details"}
            </summary>
            <ul className="mt-2 space-y-1">
              {result.map((r) => (
                <li
                  key={r.table}
                  className={r.error ? "text-danger" : "text-muted-foreground"}
                >
                  {r.table}: {r.error || `${r.rows} records copied`}
                </li>
              ))}
            </ul>
          </details>
        )}
      </SettingsSection>
      {mode === "local" && cloudConfigured && <CloudSyncCard />}

      {hasTauri && (
        <>
          {/* Database location */}
          <SettingsSection
            title="Data location"
            description="Where the local database and saved files live on this computer."
          >
            <p className="text-sm text-muted-foreground">
              Move it to your Desktop, a USB drive, or any folder.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <code className="w-full rounded-lg bg-hover p-3 text-xs text-muted-foreground break-all">
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
          </SettingsSection>

          {/* Documents export folder */}
          <SettingsSection
            title="Documents folder"
            description="Choose a folder for exported PDFs."
          >
            <p className="text-sm text-muted-foreground">
              Save generated documents (invoices, quotes…) as real PDF files here, in
              addition to keeping them in the app.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <code className="w-full rounded-lg bg-hover p-3 text-xs text-muted-foreground break-all">
                {exportDir || "Not set - documents stay in the app only"}
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
          </SettingsSection>

          {/* Backup & restore */}
          <SettingsSection
            title="Backup & restore"
            description="Protect your local workspace with a complete backup."
          >
            <p className="text-sm leading-relaxed text-muted-foreground">
              Save a full copy - database <em>and</em> your files - into a backup folder,
              or restore from one. Your offline safety net; keep it somewhere safe (USB
              drive, synced folder).
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
          </SettingsSection>

          {/* Data fixes */}
          <SettingsSection
            title="Fix emirate codes"
            description="Update legacy UAE location codes."
          >
            <p className="text-sm leading-relaxed text-muted-foreground">
              Rewrite older records to the UAE e-invoice emirate codes (AUH/DXB/SHJ…).
              Safe to run anytime.
            </p>
            <button className="btn-ghost" onClick={runEmirateFix}>
              Normalize emirate codes
            </button>
            {emirateMsg && (
              <p className="text-xs text-brand-500 mt-2 break-all">{emirateMsg}</p>
            )}
          </SettingsSection>
        </>
      )}

      {cloudConfigured && (
        <SettingsSection
          title="Transfer data"
          description="Copy records between this device and your cloud account. Review replacement details before starting."
        >
          {/* While a transfer runs, the card becomes ONE spinning circle —
              no per-table narration, no counts. People don't act on which of
              fourteen tables is uploading; they just need to know it's working
              and that it finished. */}
          {busy ? (
            <div
              className="grid place-items-center py-10"
              role="status"
              aria-label="Syncing"
            >
              <div
                className="h-10 w-10 rounded-full animate-spin"
                style={{
                  border: "3px solid hsl(var(--brand-200))",
                  borderTopColor: "hsl(var(--ink))",
                }}
              />
            </div>
          ) : (
            <>
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
              <button onClick={runImport} disabled={busy} className="btn-ghost">
                Import cloud data
              </button>

              <div className="border-t border-border pt-4">
                <p className="font-medium text-ink flex items-center gap-2">
                  <Upload size={16} /> Push local data to the cloud
                </p>
                <p className="text-sm text-brand-500 mt-0.5">
                  Uploads everything on this device (invoices, customers, products,
                  files…) to your cloud account, so the web version shows the same data.
                  Cloud records sharing an id are overwritten by this device's copy.
                </p>
              </div>
              <button onClick={runPush} disabled={busy} className="btn-ghost">
                Push local data to cloud
              </button>
              {result && (
                <p
                  className={`text-sm font-medium ${result.some((r) => r.error) ? "text-danger" : "text-success"}`}
                >
                  {result.some((r) => r.error)
                    ? "Transfer incomplete. Review the transfer details above."
                    : "Transfer completed. Storage mode has not changed."}
                </p>
              )}
            </>
          )}
        </SettingsSection>
      )}
    </SettingsPanel>
  );
}
