import { FileySpinner } from "../../components/FileySpinner";
import { useEffect, useRef, useState } from "react";
import { Cloud, Download, FolderOpen, ShieldCheck } from "lucide-react";
import { effectiveDataMode, type DataMode } from "../../lib/dataMode";
import { cloudConfigured, supabase } from "../../lib/supabase";
import { switchWorkspace, WorkspaceTransferError } from "../../lib/switchWorkspace";
import { useAuth } from "../../lib/auth";
import {
  migrateCloudToLocal,
  normalizeLocalEmirates,
  type MigrateResult,
} from "../../lib/migrate";
import { setMigrating, isMigrating } from "../../lib/sync";
import {
  DEVICE_COPY_EVENT,
  deviceCopyAt,
  deviceCopyInFlight,
} from "../../lib/cloudCopy";
import {
  hasTauri,
  pickFolder,
  getDataDir,
  setDataDir,
  restartApp,
  storageRecoveryStatus,
  cancelPendingStorage,
  getExportDir,
  setExportDir,
  clearExportDir,
  openFolder,
  backupAll,
  restoreAll,
  type FullBackupResult,
} from "../../lib/localPaths";
import { todayYmd } from "../../lib/format";
import { flushOutbox, pendingCloudWrites } from "../../lib/api";
import { SettingsPanel, SettingsSection } from "../../components/SettingsLayout";
import { Modal, Switch } from "../../components/ui";
import { log } from "../../lib/log";
import { useUI } from "../../lib/ui";

const RETRY_MESSAGE = "Couldn't finish the transfer. Your saved data is safe.";


// Where the user's records live. One switch: off keeps everything on this
// device, on puts it in their Filey account so it follows them between devices.
// Switching transfers the current workspace first and preserves the account.
export default function DataModePanel() {
  const { confirm } = useUI();
  const transferPending = useRef(false);
  const mode: DataMode = effectiveDataMode();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MigrateResult[] | null>(null);
  const [err, setErr] = useState("");
  const [retryAction, setRetryAction] = useState<DataMode | "import" | null>(null);
  const [dataDir, setDataDirState] = useState("");
  const [exportDir, setExportDirState] = useState(getExportDir());
  const [pendingWrites, setPendingWrites] = useState(0);
  const [retryingWrites, setRetryingWrites] = useState(false);
  const [pendingWriteError, setPendingWriteError] = useState("");
  const [progress, setProgress] = useState("");
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  /** Live cloud session, independent of which store is currently open. In local
   *  mode the app user is the DEVICE account, so only Supabase can say whether
   *  there is an account to upload to. */
  const [cloudSession, setCloudSession] = useState<string | null>(null);
  const [copiedAt, setCopiedAt] = useState(deviceCopyAt());
  useEffect(() => {
    const copied = () => setCopiedAt(deviceCopyAt());
    window.addEventListener(DEVICE_COPY_EVENT, copied);
    return () => window.removeEventListener(DEVICE_COPY_EVENT, copied);
  }, []);

  useEffect(() => {
    let active = true;
    if (hasTauri)
      void Promise.all([getDataDir(), storageRecoveryStatus()])
        .then(([directory, recovery]) => { if (active) { setDataDirState(directory); setRecoveryError(recovery); } })
        .catch(error => { if (active) setErr(String(error?.message ?? error)); });
    if (supabase) {
      void supabase.auth.getSession()
        .then(({ data }) => { if (active) setCloudSession(data.session?.user.email ?? null); })
        .catch(() => {});
      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        if (active) setCloudSession(session?.user.email ?? null);
      });
      return () => { active = false; sub.subscription.unsubscribe(); };
    }
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    let request = 0;
    const refresh = () => {
      const current = ++request;
      void pendingCloudWrites().then(rows => {
        if (active && current === request) setPendingWrites(rows.length);
      }).catch(() => {});
    };
    refresh();
    window.addEventListener("filey:outbox-change", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("filey:outbox-change", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [retryingWrites]);

  const retryPendingWrites = async () => {
    if (retryingWrites || busy || mode !== "cloud" || !cloudSession) return;
    setRetryingWrites(true);
    setPendingWriteError("");
    try { await flushOutbox(); }
    catch { setPendingWriteError("Couldn't reconnect to Filey Cloud. Your queued changes are preserved. Check your connection and account, then retry."); }
    finally { setRetryingWrites(false); }
  };

  const changeDataDir = async () => {
    if (storageBusy) return;
    setStorageBusy(true); setErr("");
    try {
      const dir = await pickFolder();
      if (!dir || !await confirm({ title: "Move device storage?", message: `Copy the Filey database and saved files to:\n${dir}\n\nChoose an empty folder. Filey will verify the copy and restart. The original folder is preserved.`, confirmLabel: "Copy and restart" })) return;
      await setDataDir(dir);
      await restartApp();
    } catch (error) { setErr(error instanceof Error ? error.message : String(error)); }
    finally { setStorageBusy(false); }
  };

  const changeExportDir = async () => {
    const dir = await pickFolder();
    if (!dir) return;
    setExportDir(dir);
    setExportDirState(dir);
  };

  const [backupMsg, setBackupMsg] = useState("");
  const [backupResult, setBackupResult] = useState<FullBackupResult | null>(null);
  const [showRecovery, setShowRecovery] = useState(false);
  const [restoreSource, setRestoreSource] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [storageBusy, setStorageBusy] = useState(false);
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
    if (storageBusy) return;
    setStorageBusy(true);
    try {
      const dir = await pickFolder();
      if (!dir) return;
      const dest = `${dir}/filey-backup-${todayYmd()}-${Date.now().toString(36)}`;
      setBackupMsg("");
      const result = await backupAll(dest);
      setBackupResult(result);
      setShowRecovery(false);
      setBackupMsg(`Verified backup saved (database + files): ${result.path}`);
    } catch (e: any) {
      setBackupMsg(`Backup failed: ${e?.message ?? e}`);
    } finally { setStorageBusy(false); }
  };

  const runRestore = async () => {
    if (storageBusy) return;
    setStorageBusy(true);
    try {
      const src = await pickFolder();
      if (!src) return;
      setRestoreSource(src);
      setRecoveryCode("");
      setBackupMsg("");
    } catch (error) { setBackupMsg(String(error)); }
    finally { setStorageBusy(false); }
  };
  const confirmRestore = async () => {
    if (!restoreSource || storageBusy) return;
    setStorageBusy(true);
    try {
      await restoreAll(restoreSource, recoveryCode);
      setRecoveryCode("");
      await restartApp();
    } catch (e: any) {
      setBackupMsg(`Restore failed: ${e?.message ?? e}`);
    } finally { setStorageBusy(false); }
  };

  const { user } = useAuth();
  const transferFailed = (error: unknown) => {
    log.warn("sync", "Workspace transfer failed", error);
    setErr(error instanceof WorkspaceTransferError ? error.message : RETRY_MESSAGE);
  };
  /** The helper owns transfer ordering and locks; the switch owns only its UI. */
  const toggleStorage = async (next: boolean) => {
    const target: DataMode = next ? "cloud" : "local";
    if (target === mode || busy || transferPending.current) return;
    setRetryAction(target);
    // A background refresh of this computer's copy finishes first; it is what makes the switch quick.
    const copying = deviceCopyInFlight();
    if (copying) {
      transferPending.current = true;
      setBusy(true);
      setProgress("Finishing this computer's copy…");
      try { await copying; } finally { transferPending.current = false; setBusy(false); setProgress(""); }
    }
    if (isMigrating()) {
      setErr("Wait for the current transfer to finish before switching.");
      return;
    }
    setErr("");
    setResult(null);
    if (!cloudConfigured) {
      setErr("Cloud storage isn't available in this build.");
      return;
    }
    // The device account is not the cloud account. Without a live session there
    // is nowhere to upload to, so send them to the connect card rather than
    // half-switching into an empty store.
    if (!cloudSession) {
      setErr(
        mode === "local"
          ? "Connect your Filey account below first, then flip this switch to upload."
          : "Sign in to your Filey account, then flip this switch to upload."
      );
      return;
    }
    transferPending.current = true;
    setBusy(true);
    try {
      if (target === "cloud" && !await confirm({
        title: "Store this workspace in Filey Cloud?",
        message: "Your device records and files will be uploaded and stored in your Filey account. Your local edits are kept when the same record changed in both places. Local mode stays open if you cancel.",
        confirmLabel: "Upload and use cloud",
      })) return;
      await switchWorkspace(target, setProgress);
      window.location.reload();
    } catch (e) {
      transferFailed(e);
    } finally {
      transferPending.current = false;
      setBusy(false);
      setProgress("");
    }
  };

  const runImport = async (retry = false) => {
    if (busy || transferPending.current) return;
    if (isMigrating()) {
      setErr("Wait for the active transfer to finish before importing.");
      return;
    }
    transferPending.current = true;
    let started = false;
    setRetryAction("import");
    setBusy(true);
    setErr("");
    setResult(null);
    try {
      if (!retry && !await confirm({ title: "Copy cloud data to this device?", message: "This replaces any existing local data. You must be signed in to your cloud account.", confirmLabel: "Copy cloud data", danger: true })) return;
      if (isMigrating()) throw new Error("Wait for the active transfer to finish before importing.");
      setMigrating(true);
      started = true;
      const res = await migrateCloudToLocal(() => setProgress("Saving cloud data on this device…"));
      setResult(res);
      if (res.some(r => r.error)) transferFailed(res.filter(r => r.error));
    } catch (e: any) {
      transferFailed(e);
    } finally {
      setBusy(false);
      if (started) setMigrating(false);
      transferPending.current = false;
      setProgress("");
    }
  };

  const cloudOn = mode === "cloud";
  const retryTransfer = () => {
    if (retryAction === "import") void runImport(true);
    else if (retryAction) void toggleStorage(retryAction === "cloud");
  };

  return (
    <SettingsPanel>
      <SettingsSection
        title="Data and storage"
        description={cloudOn
          ? "Your records are in your Filey account. Turn this off to bring them back to this computer."
          : "Your records stay on this computer. Cloud mode is coming soon."}
      >
        {cloudOn ? (
          <>
            <div className="flex items-start gap-3 rounded-xl border border-border p-4">
              <span
                aria-hidden="true"
                className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-hover text-muted-foreground"
              >
                <Cloud size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground">Store in my Filey account</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  On. Your records live in {cloudSession || user?.email || "your Filey account"} and
                  follow you to every device you sign in to. Needs internet to make changes.
                  {hasTauri && <>
                    {" "}This computer keeps an up-to-date copy too{copiedAt ? ` (updated ${new Date(copiedAt).toLocaleString()})` : ""},
                    so turning this off continues from your latest records.
                  </>}
                </p>
              </div>
              <Switch
                checked
                busy={busy}
                disabled={!cloudConfigured}
                onChange={() => void toggleStorage(false)}
                label="Store my data in my Filey account"
                className="mt-1"
              />
            </div>
            <p className="text-sm text-muted-foreground">
              Turn off to save the latest cloud data and files on this device, then work offline. Your cloud copy stays safe.
            </p>
          </>
        ) : (
          <div className="flex items-start gap-3 rounded-xl border border-dashed border-border p-4">
            <span
              aria-hidden="true"
              className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-hover text-muted-foreground"
            >
              <ShieldCheck size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-foreground">Filey Cloud</p>
                <span className="rounded-full bg-hover px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  Coming soon
                </span>
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Cloud mode is coming soon. Until then your records stay on this computer and work offline.
              </p>
            </div>
          </div>
        )}
        {err && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 text-sm bg-hover rounded-lg px-3 py-2"
          >
            <p>{err}</p>
            {retryAction && <button type="button" className="btn-ghost" onClick={retryTransfer} disabled={busy}>Try again</button>}
          </div>
        )}

        {busy && (
          <p role="status" className="text-sm text-muted-foreground">
            {progress || "Switching…"}
          </p>
        )}
        {pendingWrites > 0 && (
          <div role="status" className="border-t border-border pt-4 text-sm space-y-2">
            <h3 className="font-medium">Older offline saves need review</h3>
            <p className="text-muted-foreground">
              {pendingWrites} queued {pendingWrites === 1 ? "change remains" : "changes remain"} on this device, awaiting cloud confirmation.
              Check your connection and select the original company account before retrying.
              Changes with conflicts or without a verified source account are kept for review.
              Keep a device backup and contact support before clearing storage.
            </p>
            {mode === "cloud" && <button type="button" className="btn-ghost" disabled={retryingWrites || busy || !cloudSession} onClick={() => void retryPendingWrites()}>
              {retryingWrites ? "Retrying queued saves…" : "Retry queued saves"}
            </button>}
            {mode === "local" && <p className="text-muted-foreground">Open the original cloud workspace to retry these older cloud saves. Your local records stay on this device.</p>}
            {pendingWriteError && <p role="alert" className="text-danger">{pendingWriteError}</p>}
          </div>
        )}
      </SettingsSection>

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
              <button className="btn-ghost shrink-0" onClick={changeDataDir} disabled={storageBusy}>
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
            {recoveryError && <div className="space-y-3 rounded-xl border border-warning/40 p-4" role="alert">
              <p className="text-sm font-medium">The pending storage change could not finish</p>
              <p className="text-sm break-words">{recoveryError}</p>
              <p className="text-xs text-muted-foreground">Your existing workspace is open. You can cancel the pending change; its copied files will be preserved.</p>
              <button className="btn-ghost" onClick={() => void cancelPendingStorage().then(() => setRecoveryError(null)).catch(error => setBackupMsg(String(error)))}>Cancel pending change</button>
            </div>}
            <p className="text-sm leading-relaxed text-muted-foreground">
              Save a full copy - database <em>and</em> your files - into a backup folder,
              or restore from one. Your offline safety net; keep it somewhere safe (USB
              drive, synced folder).
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <button className="btn-ghost" onClick={runBackup} disabled={storageBusy}>
                Export backup
              </button>
              <button className="btn-ghost" onClick={runRestore} disabled={storageBusy}>
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

      {cloudConfigured && cloudOn && (
        <SettingsSection
          title="Transfer data"
          description="Copy your Filey Cloud records onto this computer before turning cloud storage off."
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
              <FileySpinner size={40} className="text-foreground" />
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
              <button onClick={() => void runImport()} disabled={busy} className="btn-ghost">
                Import cloud data
              </button>

              {result && !result.some(r => r.error) && (
                <p
                  className="text-sm font-medium text-success"
                >
                  Transfer completed. Storage mode has not changed.
                </p>
              )}
            </>
          )}
        </SettingsSection>
      )}
      <Modal open={!!backupResult} onClose={() => { setBackupResult(null); setShowRecovery(false); }} title="Save your recovery code">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Your database and files have been backed up. Keep this code in your password manager, separately from the backup folder. You will need it after reinstalling your operating system or moving to another account.</p>
          <label className="block text-sm font-medium">
            Recovery code
            <input className="input mt-2 w-full font-mono text-xs" readOnly type={showRecovery ? "text" : "password"} value={backupResult?.recoveryCode ?? ""} autoComplete="off" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost" onClick={() => setShowRecovery(value => !value)}>{showRecovery ? "Hide code" : "Show code"}</button>
            <button className="btn-ghost" onClick={() => {
              if (backupResult) void navigator.clipboard.writeText(backupResult.recoveryCode)
                .then(() => setBackupMsg("Recovery code copied. Save it separately from the backup."))
                .catch(() => setBackupMsg("Could not copy the code. Show it and copy it manually."));
            }}>Copy code</button>
          </div>
          <p className="text-xs text-muted-foreground">The code protects recovery of encrypted files. The backup database itself contains readable business data; keep the folder private.</p>
          <div className="flex justify-end"><button className="btn-primary" onClick={() => { setBackupResult(null); setShowRecovery(false); }}>Done</button></div>
        </div>
      </Modal>
      <Modal open={!!restoreSource} onClose={() => { if (!storageBusy) { setRestoreSource(""); setRecoveryCode(""); } }} title="Restore a backup">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Filey will verify this backup and restart into the restored workspace. Your current data folder and the backup are preserved.</p>
          <p className="rounded-xl bg-muted p-3 text-xs break-all">{restoreSource}</p>
          <label className="block text-sm font-medium">Recovery code
            <input className="input mt-2 w-full font-mono" type="password" value={recoveryCode} onChange={event => setRecoveryCode(event.target.value)} autoComplete="off" disabled={storageBusy} placeholder="Paste the code saved with your backup" />
          </label>
          <p className="text-xs text-muted-foreground">Optional on the original OS account. Older backups require the original device encryption key and cannot use a recovery code.</p>
          {backupMsg && <p role="status" className="text-sm break-words">{backupMsg}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button className="btn-ghost" disabled={storageBusy} onClick={() => { setRestoreSource(""); setRecoveryCode(""); }}>Cancel</button>
            <button className="btn-primary" disabled={storageBusy} onClick={() => void confirmRestore()}>{storageBusy ? "Verifying backup…" : "Restore and restart"}</button>
          </div>
        </div>
      </Modal>
    </SettingsPanel>
  );
}
