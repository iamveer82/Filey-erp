import { useEffect, useState } from "react";
import { Modal } from "./ui";
import { listSyncConflicts, reviewSyncConflict, resolveSyncConflict, type SyncConflict } from "../lib/sync";

export default function SyncConflictReview() {
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [review, setReview] = useState<{
    conflict: SyncConflict;
    local: Record<string, unknown> | null;
    cloud: Record<string, unknown> | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const refresh = () => void listSyncConflicts().then(rows => {
      if (active) setConflicts(rows);
    }).catch(e => { if (active) setError(String(e?.message ?? e)); });
    refresh();
    window.addEventListener("filey:sync-status", refresh);
    return () => { active = false; window.removeEventListener("filey:sync-status", refresh); };
  }, []);
  const open = async (conflict: SyncConflict) => {
    setBusy(true); setError("");
    try { setReview({ conflict, ...await reviewSyncConflict(conflict) }); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const resolve = async (keepLocal: boolean) => {
    if (!review) return;
    setBusy(true); setError("");
    try {
      await resolveSyncConflict(review.conflict, review.cloud, keepLocal, review.local);
      setReview(null);
      setConflicts(await listSyncConflicts());
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const fields = review ? [...new Set([...Object.keys(review.local ?? {}), ...Object.keys(review.cloud ?? {})])]
    .filter(key => !["user_id", "org_id", "sync_revision", "share_token"].includes(key)) : [];
  const display = (value: unknown) => {
    if (value == null) return "—";
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    return text.startsWith("data:") ? "Embedded file" : text;
  };
  return <>
    {conflicts.length > 0 && <div className="space-y-2 border-t border-border pt-4">
      <h4 className="text-sm font-medium">{conflicts.length} sync conflict{conflicts.length === 1 ? "" : "s"} to review</h4>
      <p className="text-xs text-muted-foreground">Your local records are preserved. Compare the available versions before choosing, then sync again.</p>
      {conflicts.map(conflict => <div key={conflict.id} className="flex flex-wrap items-center justify-between gap-2 py-1 text-sm">
        <span className="min-w-0 break-all">{conflict.table.replace(/_/g, " ")} · {conflict.recordId}</span>
        <button className="btn-ghost" disabled={busy} onClick={() => void open(conflict)}>Review</button>
      </div>)}
    </div>}
    {error && !review && <p role="alert" className="text-sm text-danger">{error}</p>}
    <Modal open={!!review} onClose={() => { if (!busy) setReview(null); }} title="Review sync conflict" size="lg">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{review?.cloud
          ? "Using the cloud version replaces this local record. Keeping the local version queues it for upload; Filey will check for newer cloud changes again."
          : "The cloud record is unavailable. It may belong to another workspace or have been deleted. Your local record is preserved; check the workspace before trying to upload it again."}</p>
        {review?.local && review.local.sync_revision == null && <p className="text-sm text-muted-foreground">This older local record has no saved cloud revision. This warning does not necessarily mean either version was edited recently. Compare both versions before choosing.</p>}
        <div className="max-h-[50vh] overflow-auto rounded-xl border border-border">
          <table className="w-full table-fixed text-left text-xs">
            <thead className="sticky top-0 bg-card"><tr><th className="w-1/4 p-3">Field</th><th className="p-3">This device{!review?.local ? " (deleted)" : ""}</th><th className="p-3">Cloud{!review?.cloud ? " (unavailable)" : ""}</th></tr></thead>
            <tbody>{fields.map(field => <tr key={field} className="border-t border-border">
              <th className="p-3 align-top font-medium break-words">{field.replace(/_/g, " ")}</th>
              <td className="p-3 align-top whitespace-pre-wrap break-all">{display(review?.local?.[field])}</td>
              <td className="p-3 align-top whitespace-pre-wrap break-all">{display(review?.cloud?.[field])}</td>
            </tr>)}</tbody>
          </table>
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn-ghost" disabled={busy} onClick={() => setReview(null)}>Cancel</button>
          <button className="btn-ghost" disabled={busy} onClick={() => void resolve(true)}>Keep local version</button>
          <button className="btn-primary" disabled={busy || !review?.cloud} onClick={() => void resolve(false)}>Use cloud version</button>
        </div>
      </div>
    </Modal>
  </>;
}
