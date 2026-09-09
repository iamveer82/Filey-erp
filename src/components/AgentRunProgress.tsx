import { Check, Circle, LoaderCircle, CircleAlert } from "lucide-react";
import type { ChatTurn } from "../lib/aiChats";

export default function AgentRunProgress({
  run,
  pending,
}: {
  run?: ChatTurn["run"];
  pending?: boolean;
}) {
  if (!run || (!run.plan.length && !run.actions.length)) return null;
  const completed = run.plan.filter((s) => s.status === "completed").length;
  const unfinished = run.plan.some((s) => s.status !== "completed");
  return (
    <div
      className="mt-4 space-y-3 border-t border-border pt-3 text-[13px]"
      aria-label="Task progress"
    >
      {!!run.plan.length && (
        <>
          <p className="text-xs font-medium text-muted-foreground">
            Plan · {completed} of {run.plan.length} complete
          </p>
          <ol className="space-y-2">
            {run.plan.map((s, i) => {
              const Icon =
                s.status === "completed"
                  ? Check
                  : s.status === "blocked"
                    ? CircleAlert
                    : s.status === "in_progress" && pending
                      ? LoaderCircle
                      : Circle;
              return (
                <li key={i} className="flex items-start gap-2">
                  <Icon
                    size={14}
                    aria-hidden="true"
                    className={`mt-0.5 shrink-0 ${s.status === "in_progress" && pending ? "motion-safe:animate-spin" : ""}`}
                  />
                  <span
                    className={
                      s.status === "pending" ? "text-muted-foreground" : "text-foreground"
                    }
                  >
                    {s.step}
                    <span className="sr-only"> — {s.status.replace(/_/g, " ")}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      )}
      {!!run.actions.length && (
        <details open={pending || undefined} className="text-xs">
          <summary className="cursor-pointer py-1 text-muted-foreground">
            {run.actions.length} actions
            {run.actions.some((a) => a.status === "failed")
              ? " · some need attention"
              : ""}
          </summary>
          <ol className="mt-2 space-y-2" aria-label="Actions this turn">
            {run.actions.map((a, i) => {
              const Icon =
                a.status === "completed"
                  ? Check
                  : a.status === "failed"
                    ? CircleAlert
                    : pending
                      ? LoaderCircle
                      : Circle;
              return (
                <li key={`${a.id}-${i}`} className="flex items-start gap-2">
                  <Icon
                    aria-hidden="true"
                    size={13}
                    className={`mt-0.5 shrink-0 ${a.status === "running" && pending ? "motion-safe:animate-spin" : ""}`}
                  />
                  <span className="min-w-0 break-words">
                    {a.name.replace(/_/g, " ")}
                    <span className="text-muted-foreground">
                      {" "}
                      · {a.status === "running" && !pending ? "interrupted" : a.status}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </details>
      )}
      {!pending &&
        (run.outcome === "blocked" ||
          run.outcome === "exhausted" ||
          run.outcome === "error" ||
          run.outcome === "stopped" ||
          unfinished) && (
          <p className="text-xs text-muted-foreground">
            {run.outcome === "stopped" ? "Stopped." : "Task incomplete."} Send a follow-up
            to continue from this conversation.
          </p>
        )}
    </div>
  );
}
