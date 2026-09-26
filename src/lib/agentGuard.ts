// Run-scoped guard rails for the agent loop.
//
// A tool-calling model repeats itself. It re-reads the same list because it
// lost track, or re-issues a write because the first result didn't look like
// what it expected. Nothing in the loop noticed, which meant two consequences:
// rounds burned re-fetching data already in the conversation, and — the one
// that reaches a customer — the same invoice emailed twice.
//
// This is deliberately small. It is not a planner or a policy engine: it
// remembers what has already been called in THIS run and answers a repeat
// without executing it again.

/** Tools whose names mark them as reads. Everything else is treated as a write,
 *  which is the safe direction to be wrong in: a read wrongly classed as a
 *  write is merely re-executed, a write wrongly classed as a read is a
 *  duplicate side effect. */
const READ_PREFIXES = [
  "get_",
  "list_",
  "find_",
  "read_",
  "search_",
  "recall",
  "vat_",
  "financial_",
  "receivables_",
  "payables_",
  "crm_pipeline",
  "use_saved_file",
];

export const isReadOnly = (name: string): boolean =>
  name === "work_service" || READ_PREFIXES.some((p) => name.startsWith(p));

export interface Step {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  /** Short human line for the run summary. */
  note: string;
}

export interface GuardDecision {
  /** When set, the loop must NOT execute — hand this back to the model. */
  short?: unknown;
}

export interface AgentGuard {
  /** Called before executing. Returns a canned result to skip execution. */
  before(name: string, args: Record<string, unknown>): GuardDecision;
  /** Called after executing, with whatever the tool returned. */
  after(name: string, args: Record<string, unknown>, result: unknown): void;
  /** What happened this run, for the "I couldn't finish" case — a list of
   *  steps taken is worth more to a user than an apology. */
  steps(): Step[];
  summary(): string;
}

const keyOf = (name: string, args: Record<string, unknown>) => {
  // Stable across key order: the model does not emit arguments consistently.
  try {
    const sorted = Object.keys(args ?? {})
      .sort()
      .reduce<Record<string, unknown>>((o, k) => ((o[k] = args[k]), o), {});
    return `${name}:${JSON.stringify(sorted)}`;
  } catch {
    return `${name}:?`;
  }
};

const shortNote = (name: string, result: unknown): string => {
  const r = result as { error?: string; message?: string } | null;
  if (r?.error) return `${name} failed: ${r.error}`;
  if (r?.message) return `${name}: ${r.message}`;
  return `${name}: done`;
};

/** Wrap a tool result so a failure reads as "try another way", not "stop".
 *
 *  A bare {error: "..."} is what made the agent give up on the first refusal:
 *  it looks terminal. Telling it how many steps remain, and that adapting is
 *  expected, is the difference between one failed call ending the task and the
 *  agent routing around it. */
export function coachResult(result: unknown, roundsLeft: number): unknown {
  if ((result as { retry_safe?: boolean } | null)?.retry_safe === false) return result;
  const err = (result as { error?: string } | null)?.error;
  if (!err) return result;
  const refused =
    /not approve|owner-only|capability.*(off|disabled)|Plan mode|permission|access.*(disabled|enable|expired)/i.test(
      String(err)
    );
  return {
    ...(result as Record<string, unknown>),
    steps_remaining: roundsLeft,
    what_to_do: refused
      ? "Respect this access or approval boundary. Do not retry through a different tool or channel. Explain what access or decision is needed; continue only with independently authorized work."
      : roundsLeft <= 1
        ? "This was the last step. Tell the user plainly what worked, what didn't, and what you'd try next."
        : "This attempt failed — that is normal, not a reason to stop. Try a DIFFERENT approach: another tool, different arguments, or look up the thing you assumed. Repeating this identical call will be refused.",
  };
}

export function createGuard(): AgentGuard {
  const seen = new Map<string, unknown>();
  const log: Step[] = [];

  return {
    before(name, args) {
      if (["workspace_browser", "get_video_job", "list_video_jobs"].includes(name)) return {};
      // Screen observations are perishable; reusing one can target a changed window.
      if (
        (name === "computer_use" || name === "agent_computer" || name === "browser") &&
        ["screenshot", "snapshot", "list", "list_windows", "list_tabs"].includes(
          String(args.action)
        )
      )
        return {};
      const k = keyOf(name, args);
      if (!seen.has(k)) return {};
      const prior = seen.get(k);
      if (isReadOnly(name))
        // Already answered this exact question — hand back the same answer
        // rather than spending a round on it.
        return { short: prior };
      // A write. Refuse, and say what happened the first time so the model can
      // move on instead of concluding the call failed and trying again.
      return {
        short: {
          error: `Already ran ${name} with these exact arguments in this task — not repeating it.`,
          previous_result: prior,
          hint: "If this genuinely needs doing twice, change something (a different recipient, amount or reference) so it isn't an accidental duplicate.",
        },
      };
    },
    after(name, args, result) {
      const k = keyOf(name, args);
      const failed = !!(result as { error?: string } | null)?.error;
      if (!failed && !isReadOnly(name)) {
        // Verify against current records after a write, not the pre-write cache.
        for (const key of seen.keys())
          if (isReadOnly(key.split(":")[0])) seen.delete(key);
      }
      seen.set(k, result);
      log.push({ name, args, ok: !failed, note: shortNote(name, result) });
    },
    steps() {
      return [...log];
    },
    summary() {
      if (!log.length) return "";
      const done = log.filter((s) => s.ok).map((s) => s.note);
      const failed = log.filter((s) => !s.ok).map((s) => s.note);
      const parts: string[] = [];
      if (done.length) parts.push(`Done: ${done.join("; ")}`);
      if (failed.length) parts.push(`Failed: ${failed.join("; ")}`);
      return parts.join(". ");
    },
  };
}
