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
  READ_PREFIXES.some((p) => name.startsWith(p));

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

export function createGuard(): AgentGuard {
  const seen = new Map<string, unknown>();
  const log: Step[] = [];

  return {
    before(name, args) {
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
      seen.set(k, result);
      const failed = !!(result as { error?: string } | null)?.error;
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
