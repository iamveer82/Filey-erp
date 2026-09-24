import { useEffect, useState } from "react";
import { Cloud, HardDrive } from "lucide-react";
import { FileySpinner } from "./FileySpinner";
import { getSyncStatus, listSyncConflicts, resolveSyncConflicts } from "../lib/sync";

export default function SyncConflictReview() {
  const [count, setCount] = useState(0);
  const [syncing, setSyncing] = useState(getSyncStatus().state === "syncing");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let request = 0;
    const refresh = () => {
      const current = ++request;
      setSyncing(getSyncStatus().state === "syncing");
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
      await resolveSyncConflicts(keepLocal);
      setCount((await listSyncConflicts()).length);
    } catch {
      setError("Couldn't finish syncing. Your saved data is safe. Check your connection and workspace, then try again.");
    } finally { setBusy(false); }
  };
  return <>
    {(count > 0 || busy) && <div className="space-y-3 border-t border-border pt-4" aria-busy={busy}>
      <h4 className="text-sm font-medium">Which changes should Filey keep?</h4>
      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
        Some records have different versions on this device and the cloud. Choose which version to keep for those records. Records saved on only one side will be kept.
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
        {busy ? <><FileySpinner size={14} /> Merging and syncing...</> : "Filey will merge and sync automatically after you choose. The other version of overlapping records will be replaced."}
      </p>
    </div>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </>;
}
