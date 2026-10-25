import { useEffect, useState } from "react";
import ApprovalCard from "./ApprovalCard";
import { approvalExpiresAt, decideApproval, pendingApprovalSnapshot, type ApprovalRequest } from "../lib/agentApprovals";
import { AGENT_STORAGE_EVENT } from "../lib/agentStorage";
import { approvalArgs } from "../lib/aiTools";

/** Background work waiting for the owner's OK, as a card in the chat: the oldest first,
 *  one at a time. Approve runs that exact action once; Not now drops it. */
export default function QueuedApprovals() {
  const [requests, setRequests] = useState<ApprovalRequest[]>(() => pendingApprovalSnapshot());
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    const update = () => setRequests(pendingApprovalSnapshot());
    window.addEventListener(AGENT_STORAGE_EVENT, update);
    window.addEventListener("filey:workspace-changed", update);
    const timer = setInterval(update, 60_000); // requests lapse on their own
    return () => {
      window.removeEventListener(AGENT_STORAGE_EVENT, update);
      window.removeEventListener("filey:workspace-changed", update);
      clearInterval(timer);
    };
  }, []);
  const first = requests[0];
  const outcome = note && (
    <p role="status" className={`mb-3 text-xs ${note.ok ? "text-muted-foreground" : "text-danger"}`}>{note.text}</p>
  );
  if (!first) return outcome || null;

  const decide = async (approve: boolean) => {
    if (busy) return;
    setBusy(first.id);
    setNote(null);
    try {
      const done = await decideApproval(first.id, approve);
      if (done.status === "done") setNote({ ok: true, text: "Approved and done." });
      else if (done.status === "failed") setNote({ ok: false, text: done.result || "It did not go through." });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
      setRequests(pendingApprovalSnapshot());
    }
  };

  return (
    <>
      {outcome}
      <ApprovalCard
        key={first.id}
        tool={first.tool}
        args={approvalArgs(first.tool, first.args)}
        expiresAt={approvalExpiresAt(first)}
        from={first.source.name}
        busy={busy === first.id}
        onApprove={() => void decide(true)}
        onDecline={() => void decide(false)}
      />
      {requests.length > 1 && (
        <p className="-mt-1 mb-3 text-center text-xs text-muted-foreground">
          {requests.length - 1} more waiting after this one
        </p>
      )}
    </>
  );
}
