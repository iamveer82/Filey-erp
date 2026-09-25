import { useEffect, useState } from "react";
import { Cloud, HardDrive } from "lucide-react";
import { FileySpinner } from "./FileySpinner";
import { getSyncStatus, syncStatusMessage, listSyncConflicts, resolveSyncConflicts } from "../lib/sync";

export default function SyncConflictReview() {
  const [count, setCount] = useState(0);
  const [syncing, setSyncing] = useState(getSyncStatus().state === "syncing");
  const [busy, setBusy] = useState(false);
  const [needsRecovery, setNeedsRecovery] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let request = 0;
    const refresh = () => {
      const current = ++request;
      const status = getSyncStatus();
      setSyncing(status.state === "syncing");
      setNeedsRecovery(!!status.failures?.some(f => f.kind === "permission" && /different company/.test(f.message)));
      void listSyncConflicts().then(rows => {
        if (active && current === request) setCount(rows.length);
      }).catch(() => { if (active) setError("Couldn't check saved changes. Try syncing again."); });
    };
    refresh();
    window.addEventListener("filey:sync-status", refresh);
    return () => { active = false; window.removeEventListener("filey:sync-status", refresh); };
  }, []);
  const resolve = async (keepLocal: boolean) => {
    setBusy(true); setError("");
    try {
      const complete = await resolveSyncConflicts(keepLocal);
      if (!complete) setError(syncStatusMessage(getSyncStatus()));
      setCount((await listSyncConflicts()).length);
    } catch {
      setError("Couldn't finish syncing. Your saved data is safe. Check your connection and workspace, then try again.");
    } finally { setBusy(false); }
  };
  return <>
    {(count > 0 || needsRecovery || busy) && <div className="space-y-3 border-t border-border pt-4" aria-busy={busy}>
      <h4 className="text-sm font-medium">Which changes should Filey keep?</h4>
      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
        Choose the version to use wherever this device and the cloud overlap. Filey will upload device-only records and download cloud-only records, so both workspaces match.
      </p>
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" disabled={busy || syncing} onClick={() => void resolve(true)}>
          <HardDrive size={16} /> Use this device's changes
        </button>
        <button className="btn-ghost" disabled={busy || syncing} onClick={() => void resolve(false)}>
          <Cloud size={16} /> Use cloud changes
        </button>
      </div>
      <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
        {busy ? <><FileySpinner size={14} /> Merging and syncing...</> : "The other version of overlapping records will be replaced. Keep automatic sync on to receive later changes on both devices."}
      </p>
    </div>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </>;
}
