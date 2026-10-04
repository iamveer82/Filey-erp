import type { ChatTurn } from "../lib/aiChats";

export default function AgentRunProgress({
  run,
  pending,
}: {
  run?: ChatTurn["run"];
  pending?: boolean;
}) {
  if (!run) return null;
  if (pending && !run.plan.length && !run.actions.length) return null;
  const incomplete = ["blocked", "exhausted", "error", "stopped"].includes(run.outcome ?? "")
    || run.plan.some(step => step.status !== "completed");
  const waiting = run.actions.some(action => action.status === "waiting");
  const text = pending ? "Working…"
    : run.outcome === "stopped" ? "Task stopped. Send a follow-up to continue."
    : incomplete ? "Task incomplete. Send a follow-up to continue."
    : waiting ? "Check the media card for its status."
    : "";
  if (!text) return null;
  return <p role="status" aria-label="Task progress" className="mt-2 text-xs text-muted-foreground">{text}</p>;
}
