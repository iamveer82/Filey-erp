import { FileySpinner } from "../../components/FileySpinner";
import { useCallback, useEffect, useState } from "react";
import { Cloud, Check, Download, Upload, FolderOpen, ShieldCheck } from "lucide-react";
import { effectiveDataMode, type DataMode } from "../../lib/dataMode";
import { cloudConfigured, supabase } from "../../lib/supabase";
import { CLOUD_RECONNECT_MESSAGE } from "../../lib/cloudSession";
import { switchWorkspace } from "../../lib/switchWorkspace";
import { useAuth } from "../../lib/auth";
import {
  autoSyncEnabled,
  setAutoSyncEnabled,
  getSyncStatus,
  syncStatusMessage,
  syncNow,
  syncCycle,
  markAllForSync,
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
import { pendingCloudWrites } from "../../lib/api";
import { SettingsPanel, SettingsSection } from "../../components/SettingsLayout";
import SyncConflictReview from "../../components/SyncConflictReview";
import { Modal, Switch } from "../../components/ui";
import { useUI } from "../../lib/ui";

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
    // Includes the initial session and renewal failure/sign-out, so an expired
    // connection offers sign-in immediately instead of a stale Connected label.
    const subscription = supabase?.auth.onAuthStateChange((_event, session) => {
      setConnected(session?.user.email ?? null);
    });
    const onStatus = () => {
      setSync(getSyncStatus());
      setEnabled(autoSyncEnabled());
    };
    window.addEventListener("filey:sync-status", onStatus);
    return () => {
      subscription?.data.subscription.unsubscribe();
      window.removeEventListener("filey:sync-status", onStatus);
    };
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
          "That email and password didn't match a Filey account. If you've been using Filey offline, this email has no cloud account yet - creating one takes a moment and your on-device data stays exactly where it is."
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
        "Upload all device data now? If both sides have changed, you can choose which version to keep."
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
      setErr("Couldn't finish uploading. Your saved data is safe. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const statusLine =
    sync.state === "syncing"
      ? "Syncing…"
      : sync.state === "error"
        ? sync.error?.includes(CLOUD_RECONNECT_MESSAGE)
          ? CLOUD_RECONNECT_MESSAGE
          : syncStatusMessage(sync)
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
        If both sides change the same record, choose which version to keep and Filey will merge and sync it.
      </p>

      {connected ? (
        <>
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span className="inline-flex min-w-0 items-start gap-1 text-success">
              <Check size={14} className="mt-0.5 shrink-0" />{" "}
              <span className="min-w-0 break-words">Connected as {connected}</span>
            </span>
            <button className="btn-ghost shrink-0" disabled={busy || sync.state === "syncing"} onClick={disconnect}>
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
                void syncCycle(null, { manual: true }).catch(() =>
                  setErr("Couldn't finish syncing. Your saved data is safe. Check your connection and try again.")
                );
              }}
            >
              Sync now
            </button>
            <button className="btn-ghost" disabled={busy || sync.state === "syncing"} onClick={uploadAll}>
              Upload all local data
            </button>
          </div>
          <p
            role="status"
            className="text-xs text-muted-foreground"
          >
            {statusLine}
          </p>
          <SyncConflictReview />
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

// Where the user's records live. One switch: off keeps everything on this
// device, on puts it in their Filey account so it follows them between devices.
// Turning it ON is the upload, so it asks first; turning it OFF never uploads.
export default function DataModePanel() {
  const mode: DataMode = effectiveDataMode();
  const { confirm, toast } = useUI();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MigrateResult[] | null>(null);
  const [err, setErr] = useState("");
  const [dataDir, setDataDirState] = useState("");
  const [exportDir, setExportDirState] = useState(getExportDir());
  const [pendingWrites, setPendingWrites] = useState(0);
  const [progress, setProgress] = useState("");
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  /** Live cloud session, independent of which store is currently open. In local
   *  mode the app user is the DEVICE account, so only Supabase can say whether
   *  there is an account to upload to. */
  const [cloudSession, setCloudSession] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (hasTauri)
      void Promise.all([getDataDir(), storageRecoveryStatus()])
        .then(([directory, recovery]) => { if (active) { setDataDirState(directory); setRecoveryError(recovery); } })
        .catch(error => { if (active) setErr(String(error?.message ?? error)); });
    void pendingCloudWrites()
      .then((rows) => { if (active) setPendingWrites(rows.length); })
      .catch(() => {});
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

  const changeDataDir = async () => {
    if (storageBusy) return;
    setStorageBusy(true); setErr("");
    try {
      const dir = await pickFolder();
      if (!dir || !window.confirm(`Copy the Filey database and saved files to:\n${dir}\n\nChoose an empty folder. Filey will verify the copy and restart. The original folder is preserved.`)) return;
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
  const [localExists, setLocalExists] = useState<boolean | null>(null);
  useEffect(() => {
    void hasLocalData()
      .then(setLocalExists)
      .catch(() =>
        setErr("Could not check the device workspace. Reload before switching.")
      );
  }, []);

  /** Reload into the destination store. Only reached once the user has agreed
   *  (cloud) or the move is purely local, so the reload itself is unconditional. */
  const openStore = useCallback(
    async (target: DataMode) => {
      await switchWorkspace(target, false);
      window.location.reload();
    },
    []
  );

  /** The whole local <-> cloud switch. One click, one pass.
   *
   *  ON  = upload. Consent first, then one batched push of the tables that
   *        actually hold rows, then reopen on the cloud. Nothing is pulled
   *        back down and nothing is polled afterwards: cloud mode reads and
   *        writes the account directly, so the transfer is the only billable
   *        work this causes.
   *  OFF = private. No upload, no consent, one profile read to check the
   *        device is allowed to hold this account's copy. */
  const toggleStorage = async (next: boolean) => {
    const target: DataMode = next ? "cloud" : "local";
    if (target === mode || busy) return;
    if (isMigrating()) {
      setErr("Wait for the current transfer to finish before switching.");
      return;
    }
    setErr("");
    setResult(null);
    if (!next) {
      setBusy(true);
      try {
        await openStore("local");
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
      return;
    }
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
    const hasDeviceData = localExists === true;
    if (
      !(await confirm({
        title: "Store your data in your Filey account?",
        message: hasDeviceData
          ? `Turning this on uploads the records saved on this device — invoices, customers, products and files — to ${cloudSession}, and Filey then works from your account on every device you sign in to. Your device keeps its own copy. You can switch back at any time; turning it off does not delete anything from your account.`
          : `Turning this on stores your records in your Filey account (${cloudSession}) so they follow you to every device you sign in to. You can switch back to this device at any time.`,
        confirmLabel: "Upload and turn on",
      }))
    )
      return;
    setBusy(true);
    setMigrating(true);
    try {
      if (hasDeviceData) {
        const res = await migrateLocalToCloud(setProgress);
        setResult(res);
        const failed = res.filter((r) => r.error);
        if (failed.length)
          throw new Error(
            `Upload incomplete for: ${failed.map((r) => r.table).join(", ")}. Nothing was switched — your records are still on this device.`
          );
      }
      await openStore("cloud");
      toast.success("Your data is now in your Filey account.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setMigrating(false);
      setProgress("");
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

  const cloudOn = mode === "cloud";

  return (
    <SettingsPanel>
      <SettingsSection
        title="Data and storage"
        description="Keep your records private on this device, or store them in your Filey account to use them on every device."
      >
        <div className="flex items-start gap-3 rounded-xl border border-border p-4">
          <span
            aria-hidden="true"
            className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-hover text-muted-foreground"
          >
            {cloudOn ? <Cloud size={18} /> : <ShieldCheck size={18} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground">Store in my Filey account</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {cloudOn ? (
                <>
                  On. Your records live in {cloudSession || user?.email || "your Filey account"} and
                  follow you to every device you sign in to. Needs internet to make changes.
                </>
              ) : (
                <>
                  Off. Your records stay on this device only — nothing is uploaded, and Filey
                  works with no internet. Basic is free: the whole ERP and CRM, 5 invoices a month.
                </>
              )}
            </p>
          </div>
          <Switch
            checked={cloudOn}
            busy={busy}
            disabled={!cloudConfigured || localExists === null}
            onChange={(next) => void toggleStorage(next)}
            label="Store my data in my Filey account"
            className="mt-1"
          />
        </div>
        <p className="text-sm text-muted-foreground">
          {cloudOn
            ? "Turning this off switches back to the records saved on this device. It does not delete anything from your account."
            : "Turning this on uploads this device's records to your account, once. You can turn it off again at any time."}
        </p>
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
            {progress || "Switching…"}
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
                  Newer cloud edits are preserved as conflicts for you to review.
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
