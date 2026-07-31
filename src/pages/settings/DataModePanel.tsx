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
import { todayYmd } from "../../lib/format";

/** The one control most people should ever need: sync on, or everything here. */
function SyncSwitch({
  on,
  busy,
  progress,
  onChange,
}: {
  on: boolean;
  busy: boolean;
  progress: string;
  onChange: (want: boolean) => void;
}) {
  return (
    <div className="rounded-xl border border-brand-200 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium text-ink flex items-center gap-2">
            {on ? <Cloud size={16} /> : <HardDrive size={16} />}
            Sync with your Filey account
          </p>
          <p className="text-sm text-brand-500 mt-0.5">
            {on
              ? "Your data is in your account, so you can sign in on another device and pick up where you left off."
              : "Your data lives on this computer and is not being sent anywhere. Turn this on to use it on another device."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Sync with your Filey account"
          disabled={busy}
          onClick={() => onChange(!on)}
          className={`relative w-11 h-6 rounded-full shrink-0 cursor-pointer transition-colors disabled:opacity-50 ${
            on ? "bg-primary-400" : "bg-brand-200"
          }`}
        >
          <span
            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
              on ? "left-[22px]" : "left-0.5"
            }`}
          />
        </button>
      </div>
      {busy && (
        <p className="text-xs text-brand-500 mt-3">
          {progress || "Working…"}
        </p>
      )}
    </div>
  );
}

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
          "That email and password didn't match a Filey Cloud account. If you've been using Filey offline, this email has no cloud account yet — creating one takes a moment and your on-device data stays exactly where it is."
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
            onClick={() => {
              setSignup((s) => !s);
              setErr("");
              setOfferSignup(false);
            }}
          >
            {signup ? "Have an account? Sign in" : "New to Filey Cloud? Create an account"}
          </button>
        </>
      )}
      {info && (
        <p className="text-sm text-ink bg-primary-50 rounded-lg px-3 py-2">{info}</p>
      )}
      {err && (
        <div className="text-sm text-danger bg-danger/10 rounded-lg px-3 py-2 space-y-2">
          <p>{err}</p>
          {offerSignup && (
            <button
              className="rounded-lg bg-ink text-white px-3 py-1.5 text-xs font-medium hover:opacity-90 transition"
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

  /**
   * The whole storage question as one switch.
   *
   * ON  — data lives in the account and reaches every device you sign in to.
   * OFF — copy everything to this computer FIRST, then stop sending. The copy
   *       is the point: flipping storage without it is what made the app look
   *       like it had thrown the user's data away.
   *
   * Nothing is deleted from the cloud either way, so turning sync back on
   * reunites the device with the account rather than starting over.
   */
  const setSync = async (want: boolean) => {
    setErr("");
    setResult(null);
    if (want) {
      // Back on: keep this device's copy and push it up, rather than pulling
      // the cloud down over the top of local work that was done while off.
      setBusy(true);
      try {
        setAutoSyncEnabled(true);
        if (getDataMode() === "local") {
          // Deliberately NOT markAllForSync(). The journal already recorded
          // every local write made while sync was off, so a normal cycle
          // pushes exactly those and leaves untouched rows alone. Marking
          // everything dirty would re-upload this device's stale copies over a
          // teammate's newer ones — the precise thing row-level push exists to
          // prevent. "Upload all local data" below is still there for when
          // someone really does mean "this device wins".
          const ok = await syncCycle(null, { manual: true });
          if (!ok && getSyncStatus().state !== "error")
            setErr("Sync is on, but nothing moved yet — check you're signed in.");
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (
      !window.confirm(
        "Stop syncing to the cloud?\n\n" +
          "Filey will copy everything to this computer first, then keep it here and send nothing further. Your cloud copy is left as it is — turning sync back on reconnects this device to it.\n\n" +
          "You will need sync on again to use the same data on another device."
      )
    )
      return;

    setBusy(true);
    try {
      // Copy down BEFORE switching, and abort the switch if it fails —
      // otherwise the user lands in an empty workspace, which is the exact
      // failure this flow exists to prevent.
      if (getDataMode() !== "local") {
        setResult(await migrateCloudToLocal(setProgress));
      }
      setAutoSyncEnabled(false);
      setDataMode("local");
      window.location.reload();
    } catch (e) {
      setErr(
        `Could not copy your data to this device, so sync is still on and nothing changed: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
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
        <h2 className="text-lg font-medium text-ink">Data &amp; Storage</h2>
        <p className="text-sm text-brand-500 mt-1">
          Your data syncs to your Filey account so you can use it on more than
          one device. Turn sync off and Filey copies everything to this computer
          first, then keeps it here and stops sending anything to the cloud.
        </p>
      </div>

      <SyncSwitch
        on={mode === "cloud" || autoSyncEnabled()}
        busy={busy}
        progress={progress}
        onChange={(want) => void setSync(want)}
      />
      <details className="rounded-xl border border-brand-200 p-3">
        <summary className="text-sm text-brand-500 cursor-pointer">
          Advanced — choose storage manually
        </summary>
        <div className="space-y-3 mt-3">
          <Card
            m="cloud"
            icon={Cloud}
            title="Filey Cloud"
            desc={
              cloudConfigured
                ? "Stored in your account and available on every device you sign in to."
                : "Not available — Supabase isn't configured in this build."
            }
            disabled={!cloudConfigured}
          />
          <Card
            m="local"
            icon={HardDrive}
            title="This device only"
            desc={
              "Everything stored on this computer. No internet needed, nothing leaves the machine." +
              (ENFORCE_LICENSING ? " Requires a Filey Freedom license." : "")
            }
          />
        </div>
      </details>
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
