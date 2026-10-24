import { Suspense, lazy, useEffect, useState, useSyncExternalStore } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowUp, Square } from "lucide-react";
import { AGENT_STORAGE_EVENT, agentStorageScope } from "../lib/agentStorage";
import { useModules } from "../lib/modules";
import type { AgentChatStatus } from "../pages/AgentChat";
import ErrorBoundary from "./ErrorBoundary";
import FileyLoader from "./FileyLoader";
import ThinkingDots from "./ThinkingDots";
import ApprovalCard from "./ApprovalCard";
import "../pages/AgentChat.css";

// Loaded with the agent, not with every page: the terminal pulls in the agent's tools.
const AgentTerminal = lazy(() => import("./AgentTerminal"));
const VIEW_KEY = "filey.agent.view";
/** Filey Agent's terminal runs where its engine does: the desktop app. */
const desktopApp = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
/** The redacted arguments the chat already prepared for its own card. */
function previewArgs(preview?: string): Record<string, unknown> {
  try {
    const value: unknown = preview ? JSON.parse(preview) : {};
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

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

/** Everywhere except the chat itself, a running Filey AI task keeps a bar: the
 * person can type the next instruction and settle an approval in the section
 * the work is happening in, instead of switching back to the chat. */
function AgentSession() {
  const { pathname } = useLocation();
  const active = pathname === "/agent";
  const [visited, setVisited] = useState(active);
  const [status, setStatus] = useState<AgentChatStatus | null>(null);
  const [next, setNext] = useState("");
  const terminalAvailable = desktopApp();
  const [view, setView] = useState<"chat" | "terminal">(() => {
    try { return localStorage.getItem(VIEW_KEY) === "terminal" ? "terminal" : "chat"; } catch { return "chat"; }
  });
  const chooseView = (mode: "chat" | "terminal") => {
    setView(mode);
    try { localStorage.setItem(VIEW_KEY, mode); } catch { /* remembered for this visit only */ }
  };
  useEffect(() => { if (active) setVisited(true); }, [active]);
  if (!visited && !active) return null;
  const working = !!status && (status.busy || status.approvalPending);

  const send = () => {
    const text = next.trim();
    if (!text || !status?.send) return;
    status.send(text);
    setNext("");
  };

  return (
    <>
      {!active && working && (
        <aside aria-label="Filey AI task" className="mx-4 mt-4 rounded-xl border border-border bg-card px-3 py-2.5 text-sm sm:mx-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p role="status" className="flex min-w-0 items-center gap-2 text-muted-foreground">
              {status?.approvalPending ? "Filey AI needs your approval." : status?.busy ? <>Filey AI <ThinkingDots /></> : "Filey AI"}
            </p>
            <form
              className="flex min-w-0 flex-1 items-center gap-2"
              onSubmit={(event) => { event.preventDefault(); send(); }}
            >
              <input
                // Distinct from the chat's own composer label: off-route only
                // this one exists, and section tests name the chat's exactly.
                aria-label="Message Filey AI from this section"
                value={next}
                onChange={(event) => setNext(event.target.value)}
                placeholder={status?.busy ? "Tell Filey what to change…" : "Ask Filey AI…"}
                disabled={!status?.send}
                className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
              <button
                type="submit"
                aria-label="Send to Filey AI"
                disabled={!status?.send || !next.trim()}
                className="btn-ghost shrink-0"
              >
                <ArrowUp size={15} /> Send
              </button>
            </form>
            <div className="flex shrink-0 items-center gap-2">
              <Link className="btn-ghost" to="/agent">Return to chat</Link>
              {status?.busy && (
                <button type="button" className="btn-ghost" onClick={status.stop} aria-label="Stop Filey AI task">
                  <Square size={13} /> Stop
                </button>
              )}
            </div>
          </div>

          {/* Every pending approval lands here, with the same redacted preview
              the chat card shows, so nothing waits behind a section switch. */}
          {status?.approval && (
            <div className="mt-3 max-w-md">
              <ApprovalCard
                key={status.approval.id}
                tool={status.approval.name}
                args={previewArgs(status.approval.preview)}
                onApprove={() => status.settleApproval?.(true)}
                onDecline={() => status.settleApproval?.(false)}
              />
            </div>
          )}
        </aside>
      )}
      <div hidden={!active} inert={!active} aria-hidden={!active || undefined} className="workspace-content min-w-0 px-4 pt-6 pb-16 sm:px-6">
        {/* Desktop: Filey Agent (Hermes) in a chat or in its own terminal, same engine. */}
        {terminalAvailable && (
          <div className="filey-agent-views" role="group" aria-label="Agent view">
            <button type="button" aria-pressed={view === "chat"} onClick={() => chooseView("chat")}>Chat</button>
            <button type="button" aria-pressed={view === "terminal"} onClick={() => chooseView("terminal")}>Terminal</button>
          </div>
        )}
        <div hidden={view === "terminal" && terminalAvailable}>
          <ErrorBoundary>
            <Suspense fallback={<FileyLoader />}>
              <AgentChat active={active && (view === "chat" || !terminalAvailable)} onStatusChange={setStatus} />
            </Suspense>
          </ErrorBoundary>
        </div>
        {terminalAvailable && view === "terminal" && (
          <ErrorBoundary>
            <Suspense fallback={<FileyLoader />}>
              <AgentTerminal active={active} />
            </Suspense>
          </ErrorBoundary>
        )}
      </div>
    </>
  );
}
