import { Suspense, lazy, useEffect, useState, useSyncExternalStore } from "react";
import { Link, useLocation } from "react-router-dom";
import { Square } from "lucide-react";
import { AGENT_STORAGE_EVENT, agentStorageScope } from "../lib/agentStorage";
import { useModules } from "../lib/modules";
import type { AgentChatStatus } from "../pages/AgentChat";
import ErrorBoundary from "./ErrorBoundary";
import FileyLoader from "./FileyLoader";

const AgentChat = lazy(() => import("../pages/AgentChat"));

function subscribeScope(changed: () => void): () => void {
  const events = [AGENT_STORAGE_EVENT, "storage", "filey:workspace-changed", "filey:workspace-transition"];
  events.forEach(event => window.addEventListener(event, changed));
  return () => events.forEach(event => window.removeEventListener(event, changed));
}

/** The shell owns the mounted conversation; section navigation only hides it.
 * Account, organization, mode and access changes still release that session. */
export default function PersistentAgentChat() {
  const scope = useSyncExternalStore(subscribeScope, agentStorageScope, () => null);
  const { loading, error, isEnabled } = useModules();
  if (!scope || loading || error || !isEnabled("agent")) return null;
  return <AgentSession key={scope} />;
}

function AgentSession() {
  const active = useLocation().pathname === "/agent";
  const [visited, setVisited] = useState(active);
  const [status, setStatus] = useState<AgentChatStatus | null>(null);
  useEffect(() => { if (active) setVisited(true); }, [active]);
  if (!visited && !active) return null;
  return (
    <>
      {!active && (status?.busy || status?.approvalPending) && (
        <aside aria-label="Filey AI task" className="mx-4 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm sm:mx-6">
          <p role="status" className="min-w-0 text-muted-foreground">
            {status.approvalPending ? "Filey AI needs your approval." : "Filey AI is continuing your task."}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Link className="btn-ghost" to="/agent">Return to chat</Link>
            <button type="button" className="btn-ghost" onClick={status.stop} aria-label="Stop Filey AI task"><Square size={13} /> Stop</button>
          </div>
        </aside>
      )}
      <div hidden={!active} inert={!active} aria-hidden={!active || undefined} className="workspace-content min-w-0 px-4 pt-6 pb-16 sm:px-6">
        <ErrorBoundary>
          <Suspense fallback={<FileyLoader />}>
            <AgentChat active={active} onStatusChange={setStatus} />
          </Suspense>
        </ErrorBoundary>
      </div>
    </>
  );
}
