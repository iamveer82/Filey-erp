import { useEffect, useState } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { FileySpinner } from "./FileySpinner";
import {
  FILEY_AGENT_STATUS_EVENT,
  fileyAgentEnabled,
  fileyAgentStatus,
  retryFileyAgent,
  type FileyAgentStatus,
} from "../lib/fileyAgent";

/** What the Filey Agent engine is doing, above the composer, whenever it is not ready.
 *  There is no backup agent, so a stopped engine must be visible, with a way to retry. */
export default function AgentEngineStatus() {
  const [status, setStatus] = useState<FileyAgentStatus>(fileyAgentStatus);
  useEffect(() => {
    const update = (e: Event) => setStatus((e as CustomEvent<FileyAgentStatus>).detail ?? fileyAgentStatus());
    window.addEventListener(FILEY_AGENT_STATUS_EVENT, update);
    setStatus(fileyAgentStatus());
    return () => window.removeEventListener(FILEY_AGENT_STATUS_EVENT, update);
  }, []);
  if (!fileyAgentEnabled() || status.state === "ready") return null;
  if (status.state === "unavailable")
    return (
      <div role="alert" className="mb-2 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <p className="flex-1">{status.message || "Filey Agent is not running on this computer."}</p>
        <button
          type="button"
          onClick={() => void retryFileyAgent()}
          className="inline-flex shrink-0 items-center gap-1 font-medium underline-offset-2 hover:underline"
        >
          <RotateCcw size={12} /> Retry
        </button>
      </div>
    );
  if (status.state === "installing")
    return (
      <div role="status" className="mb-2 text-xs text-brand-500">
        <div className="flex items-center gap-2">
          <FileySpinner size={12} className="animate-spin" />
          <span className="flex-1">{status.message || "Setting up Filey Agent…"}</span>
          {status.percent !== undefined && <span className="tabular-nums">{status.percent}%</span>}
        </div>
        {status.percent !== undefined && (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full rounded-full bg-primary-500 transition-[width]" style={{ width: `${status.percent}%` }} />
          </div>
        )}
      </div>
    );
  return (
    <div role="status" className="mb-2 flex items-center gap-2 text-xs text-brand-500">
      <FileySpinner size={12} className="animate-spin" />
      {status.state === "restarting"
        ? `Filey Agent stopped, restarting${status.attempt ? ` (try ${status.attempt})` : ""}…`
        : "Filey Agent is starting…"}
    </div>
  );
}
