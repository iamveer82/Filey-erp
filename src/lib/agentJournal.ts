/* What happened last time.
 *
 * The agent had two kinds of memory and neither covered its own competence:
 * `remember` stores facts the USER states, and skills store procedures the user
 * WRITES. Nothing recorded what the agent itself tried and how it went, so the
 * same dead end was walked into every run — the same tool called with the same
 * wrong argument shape, the same goal abandoned at the round limit.
 *
 * This is that third memory, and it is deliberately the smallest useful one: a
 * capped list of runs that went badly, replayed into the next autonomous run's
 * prompt as "here is what did not work". Successful runs are not stored — they
 * are the default and would only dilute the digest.
 */
import type { AgentDoneReason } from "./agentHarness";

const KEY = "filey.agent.journal";
/** Runs kept. Small on purpose: this is a hint, not an audit log — audit_log
 *  and the diagnostics panel are where a complete record belongs. */
const CAP = 30;
/** How many go into a prompt. Beyond a handful the model stops reading them. */
const DIGEST_N = 5;

export interface ToolFailure {
  tool: string;
  error: string;
}

export interface RunNote {
  at: number;
  goal: string;
  reason: AgentDoneReason;
  failures: ToolFailure[];
}

function load(): RunNote[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as RunNote[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return []; // a corrupt journal must never break a run
  }
}

function save(list: RunNote[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-CAP)));
  } catch {
    // Full or read-only storage: losing a hint is not worth failing the run.
  }
}

/** Pull the tool failures out of a finished run's events.
 *
 * One entry per tool: a model that calls the same broken tool five times in a
 * run teaches the next run one thing, not five. */
export function failuresFrom(
  events: { type: string; name?: string; result?: unknown }[]
): ToolFailure[] {
  const seen = new Map<string, string>();
  for (const e of events) {
    if (e.type !== "tool_result" || !e.name) continue;
    const r = e.result as { error?: unknown } | null | undefined;
    const err = r && typeof r === "object" && "error" in r ? r.error : undefined;
    if (err === undefined || err === null) continue;
    if (!seen.has(e.name)) seen.set(e.name, String(err).slice(0, 160));
  }
  return [...seen].map(([tool, error]) => ({ tool, error }));
}

/** Record a run. Only the ones worth learning from are kept: a run that
 *  answered cleanly with no failed tool has nothing to teach. */
export function recordRun(note: Omit<RunNote, "at">): void {
  if (note.reason !== "exhausted" && note.failures.length === 0) return;
  save([
    ...load(),
    {
      at: Date.now(),
      goal: note.goal.slice(0, 120),
      reason: note.reason,
      failures: note.failures.slice(0, 5),
    },
  ]);
}

export function listRuns(): RunNote[] {
  return load().slice().reverse(); // newest first, for the diagnostics panel
}

export function clearJournal(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to do — the cap keeps it bounded anyway
  }
}

/** The prompt fragment. Empty when there is nothing to warn about, so callers
 *  can concatenate it unconditionally.
 *
 *  ponytail: most-recent-N, not most-relevant-N. Matching the digest to the
 *  current goal needs similarity scoring and a corpus worth scoring against;
 *  with a 30-run cap the recent ones usually ARE the related ones. Revisit if
 *  the journal ever grows or the hints start reading as noise. */
export function journalDigest(): string {
  const recent = load().slice(-DIGEST_N).reverse();
  if (!recent.length) return "";
  const lines = recent.map((r) => {
    const what =
      r.reason === "exhausted" ? "ran out of steps" : "finished with tool errors";
    const fails = r.failures.length
      ? ` — ${r.failures.map((f) => `${f.tool}: ${f.error}`).join("; ")}`
      : "";
    return `· "${r.goal}" — ${what}${fails}`;
  });
  return [
    "WHAT DID NOT WORK BEFORE (your own recent runs). Treat these as known dead ends:",
    ...lines,
    "If this run resembles one of them, take a different route rather than repeating the same call.",
  ].join("\n");
}
