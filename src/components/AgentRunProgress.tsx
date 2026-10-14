import type { ChatTurn } from "../lib/aiChats";

export default function AgentRunProgress({
  run,
  pending,
}: {
  run?: ChatTurn["run"];
  pending?: boolean;
}) {
  // While the task runs, the message's three dots say so; no status words.
  if (!run || pending) return null;
  const incomplete = ["blocked", "exhausted", "error", "stopped"].includes(run.outcome ?? "")
    || run.plan.some(step => step.status !== "completed");
  const waiting = run.actions.some(action => action.status === "waiting");
  const text = run.outcome === "stopped" ? "Task stopped. Send a follow-up to continue."
    : incomplete ? "Task incomplete. Send a follow-up to continue."
    : waiting ? "Check the media card for its status."
    : "";
  if (!text) return null;
  return <p role="status" aria-label="Task progress" className="mt-2 text-xs text-muted-foreground">{text}</p>;
}
