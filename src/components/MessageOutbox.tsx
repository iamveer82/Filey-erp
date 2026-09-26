import { useCallback, useEffect, useState } from "react";
import { agentStorageScope, AGENT_STORAGE_EVENT } from "../lib/agentStorage";
import { messageJobs, canReviewMessage, reviewMessageNotSent, OUTBOX_EVENT, type MessageJob } from "../lib/messageOutbox";
import { errMsg } from "../lib/format";
import { ErrorBanner } from "./ui";

const labels = {sending:"Sending or interrupted · check WhatsApp",accepted:"Accepted by WhatsApp",observed_sent:"Sent bubble observed",unknown:"Outcome unknown · check WhatsApp",not_sent:"Not sent"};

export default function MessageOutbox() {
  const [jobs, setJobs] = useState<MessageJob[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setJobs(await messageJobs()); setError(""); }
    catch(error) { setJobs([]); setError(errMsg(error)); }
  }, []);
  useEffect(() => {
    void load();
    const refresh = () => { void load(); };
    window.addEventListener(OUTBOX_EVENT, refresh);
    window.addEventListener(AGENT_STORAGE_EVENT, refresh);
    return () => { window.removeEventListener(OUTBOX_EVENT, refresh); window.removeEventListener(AGENT_STORAGE_EVENT, refresh); };
  }, [load]);
  return <section aria-label="WhatsApp invoice outbox">
    <p className="help mb-4">Send attempts on this device, retained across restarts and local/cloud switching. Acceptance is not a delivery receipt. An interrupted send stays blocked until you check the chat; an active attempt may take up to six minutes to become reviewable.</p>
    {error && <ErrorBanner message={error} />}
    <button className="btn-ghost mb-3" onClick={() => void load()}>Refresh history</button>
    {!jobs.length && !error && <p className="card p-6 text-sm text-muted-foreground">No invoice sends recorded on this device yet.</p>}
    <ul className="divide-y divide-border">{jobs.map(job => <li key={job.id} className="py-4">
      <div className="flex flex-wrap justify-between gap-2"><p className="text-sm font-medium">{job.filename}</p><p className="text-xs">{labels[job.outcome]}</p></div>
      <p className="mt-1 text-xs text-muted-foreground">{job.recipient} · {new Date(job.at).toLocaleString()} · {job.method === "paired" ? "Paired WhatsApp" : "Filey AI"}</p>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm">{job.text}</p>
      <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">Attempt details</summary><p className="mt-2 break-all">Attempt {job.id}<br/>Document version: {job.version}<br/>PDF SHA-256: {job.fileHash}<br/>WhatsApp ID: {job.providerId || "Not available"}</p></details>
      {canReviewMessage(job) && <button className="btn-ghost mt-2" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await reviewMessageNotSent(job, agentStorageScope() ?? "signed-out"); await load(); }
        catch(error) { setError(errMsg(error)); } finally { setBusy(false); }
      }}>I checked WhatsApp: not sent</button>}
    </li>)}</ul>
  </section>;
}
