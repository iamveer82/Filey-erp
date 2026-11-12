/* Long tasks: one goal the agent keeps working on by itself until it is finished.
 *
 * A long task is an automation whose schedule is "until_done". The scheduler
 * (components/AgentScheduler) calls the agent again as soon as a turn ends, on the same engine
 * session, until the agent reports it is done or needs the owner. Whatever ends a turn early is
 * survived, not surfaced: the engine restarting, the network or the AI service dropping, Filey
 * being closed, the computer restarting. Each turn opens with the goal and the agent's own last
 * note, so the work carries on even when the engine session had to start fresh.
 *
 * Nobody is watching, so the automation rules apply: send and pay steps wait under Needs your
 * OK, and risky terminal commands are refused. The daily background-run cap does not apply (a
 * long task is many turns by design); its own guard is the no-progress check below.
 */
import type { AgentTask } from "./agentTasks";
import { parkForApproval } from "./agentApprovals";
import { fileyAgentTurn, restartFileyAgentEngine } from "./fileyAgent";

export const isLongTask = (task: Pick<AgentTask, "schedule">): boolean => task.schedule.type === "until_done";

/** Waits after a failed turn: quick at first, then every 15 minutes for as long as it takes. */
const RETRY_AFTER_S = [30, 60, 120, 300, 600, 900];
export const retryDelayMs = (failures: number): number =>
  RETRY_AFTER_S[Math.max(1, Math.min(failures, RETRY_AFTER_S.length)) - 1] * 1000;

/** Turns in a row without one tool call before the task counts as going nowhere. */
export const IDLE_TURN_LIMIT = 3;
/** No event and no tool request from the engine for this long: it has hung, not thought.
 *  ponytail: a single tool that really runs silently for longer is cut off and retried too;
 *  raise this if real jobs need it (the app's own tools already stop at 30 minutes). */
export const SILENT_TURN_MS = 45 * 60_000;
const HUNG = "The agent went silent for 45 minutes, so the turn was restarted.";

export type LongTaskStatus = "done" | "continue" | "blocked";

/** The agent's closing `STATUS:` line. `body` is the reply without it; `note` is what it said
 *  after the status word, or the end of the reply when it said nothing. */
export function readStatus(reply: string): { status: LongTaskStatus | null; note: string; body: string } {
  const lines = reply.trimEnd().split("\n");
  for (let i = lines.length - 1, seen = 0; i >= 0 && seen < 4; i--) {
    if (!lines[i].trim()) continue;
    seen++;
    const match = /^[\s>*_`#-]*STATUS\s*[:：][\s*_`]*(DONE|CONTINUE|BLOCKED)\b[\s*_`.:–—-]*(.*)$/i.exec(lines[i]);
    if (!match) continue;
    const body = [...lines.slice(0, i), ...lines.slice(i + 1)].join("\n").trim();
    const said = match[2].replace(/[\s*_`]+$/, "").trim();
    return { status: match[1].toLowerCase() as LongTaskStatus, note: (said || body.slice(-300)).slice(0, 600), body };
  }
  const body = reply.trim();
  return { status: null, note: body.slice(-300), body };
}

/** What the agent is told at the start of every turn. */
export function longTaskPrompt(task: AgentTask): string {
  return [
    `[Long task "${task.name}", turn ${(task.turns ?? 0) + 1}. Nobody is watching: work by yourself until all of it is finished, and do as much as you can in this turn. Send and pay steps are saved for the owner's OK; carry on with the rest.]`,
    `Goal: ${task.goal}`,
    task.note ? `Your last note: ${task.note}` : "",
    task.answer ? `You stopped to ask the owner. Their answer: ${task.answer}` : "",
    task.cutOff ? `The last turn was cut off (${task.cutOff}). First check what it already did by reading the records back, so nothing is created, sent or paid twice.` : "",
    "End with one last line: `STATUS: DONE` when all of it is finished and checked; `STATUS: CONTINUE - <what is done, and the next step>` when more remains (you are called again at once); or `STATUS: BLOCKED - <what you need from the owner>` when you cannot go on without them.",
  ].filter(Boolean).join("\n");
}

export interface TurnResult { reply: string; tools: number }
interface Outcome { patch: Partial<AgentTask>; tell?: { title: string; body: string } }

/** A turn ended by itself: finished, needs the owner, or goes again. */
export function afterTurn(task: AgentTask, result: TurnResult, now = Date.now()): Outcome {
  const { status, note, body } = readStatus(result.reply);
  const patch: Partial<AgentTask> = {
    lastRun: now, turns: (task.turns ?? 0) + 1, lastResult: body || result.reply, lastError: undefined,
    runningSince: undefined, failures: 0, retryAt: undefined, cutOff: undefined, answer: undefined, note,
  };
  if (status === "done")
    return { patch: { ...patch, done: true, idleTurns: 0 }, tell: { title: `${task.name} finished`, body: body || "Done." } };
  if (status === "blocked") {
    const why = note || "It needs you to continue.";
    return { patch: { ...patch, blocked: why }, tell: { title: `${task.name} needs you`, body: why } };
  }
  const idleTurns = result.tools ? 0 : (task.idleTurns ?? 0) + 1;
  if (idleTurns >= IDLE_TURN_LIMIT) {
    const why = "It stopped making progress. Check its last result, then press Resume.";
    return { patch: { ...patch, idleTurns, blocked: why }, tell: { title: `${task.name} needs you`, body: why } };
  }
  return { patch: { ...patch, idleTurns } };
}

/** A turn failed (engine down, no network, AI service refusing): try again later, for as long
 *  as it takes. The owner hears about it once, on the third failure in a row. */
export function afterFailure(task: AgentTask, message: string, now = Date.now()): Outcome {
  const failures = (task.failures ?? 0) + 1;
  return {
    patch: { lastRun: now, lastError: message, runningSince: undefined, failures, retryAt: now + retryDelayMs(failures), cutOff: message.slice(0, 200) },
    ...(failures === 3 ? { tell: { title: `${task.name} is waiting`, body: `It keeps retrying by itself. ${message}` } } : {}),
  };
}

/** A few words on where a long task stands, for the Automations list and the agent. */
export function longTaskState(task: AgentTask, now = Date.now()): string {
  if (task.done) return "Finished";
  if (task.blocked) return "Needs you";
  if (!task.enabled) return "Paused";
  if (task.runningSince) return `Working, turn ${(task.turns ?? 0) + 1}`;
  if ((task.retryAt ?? 0) > now) return "Retrying shortly";
  return task.turns ? `Continuing, turn ${task.turns + 1}` : "Starting";
}

/** One agent turn of a long task. Resolves with the reply and how many tools it used; throws
 *  when the turn failed, was stopped, or the engine went silent (it is then interrupted, and
 *  restarted if it does not even answer that). */
export async function runLongTaskTurn(task: AgentTask, signal: AbortSignal): Promise<TurnResult> {
  const chatId = `longtask:${task.id}`;
  const inner = new AbortController();
  const stop = () => inner.abort(signal.reason);
  if (signal.aborted) stop();
  else signal.addEventListener("abort", stop, { once: true });

  let hung = false;
  let giveUp!: (error: Error) => void;
  const silence = new Promise<never>((_, reject) => { giveUp = reject; });
  silence.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const alive = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      hung = true;
      inner.abort();
      timer = setTimeout(() => {
        void restartFileyAgentEngine();
        giveUp(new Error(HUNG));
      }, 60_000);
    }, SILENT_TURN_MS);
  };
  alive();

  const stream = fileyAgentTurn(chatId, longTaskPrompt(task), {
    confirm: parkForApproval({ id: task.id, name: task.name }),
    // The engine's own terminal and file commands that need approval: refused with nobody watching.
    confirmCommand: () => false,
    isOwner: false,
    signal: inner.signal,
    agentId: chatId,
    onActivity: alive,
  });
  let tools = 0;
  try {
    for (;;) {
      const step = await Promise.race([stream.next(), silence]);
      if (step.done) {
        if (hung) throw new Error(HUNG);
        return { reply: step.value, tools };
      }
      const ev = step.value;
      if (ev.type === "tool_call") tools++;
      else if (ev.type === "done" && ev.reason !== "answered") {
        if (hung) throw new Error(HUNG);
        throw new Error(ev.reason === "stopped" ? "The turn was stopped." : ev.text || "The agent could not finish this turn.");
      }
    }
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
    void stream.return("").catch(() => {});
  }
}
