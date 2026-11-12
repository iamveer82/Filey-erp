/* One Filey AI chat turn on THIS device's engine. The in-app chat runs it, and so
 * does a desktop answering a linked phone (linkedAgent.ts): the same prompt, the
 * same tools, the same approvals on both paths. */
import { aiAgentStream, aiAutonomousStream, aiChat, buildSystemPrompt, getPersona, type AiImage, type AiMessage } from "./ai";
import { AGENT_HABITS, memoryDigest } from "./aiMemory";
import { skillsIndex } from "./agentSkills";
import { buildAiContext } from "./aiContext";
import { chatRecap, fileyAgentEnabled, fileyAgentTurn, refreshIdleFileyAgentSession } from "./fileyAgent";
import { agentPersonaPrompt } from "./agentPersona";
import { agentSystemBase, memoryNudge } from "./agentPrompt";
import { stackHint } from "./agentStack";
import { isToolAllowed } from "./capabilities";
import { engineModeNote, gateFor } from "./agentMode";
import type { AgentEvent } from "./agentHarness";
import type { ConfirmFn } from "./aiTools";
import type { AiEffort } from "./aiEndpoint";

/** Whether the brief may send the agent to learn_skill: the "self" capability is on and the
 *  current mode runs that write without an approval card. Hermes gates its skill-writing
 *  guidance on skill_manage being available the same way, so the prompt never names a tool
 *  that would come back blocked or as a surprise approval. */
export const canLearnSkills = (): boolean => isToolAllowed("learn_skill") && gateFor("learn_skill") === "run";

/** The in-app brief: Hermes' identity and guidance with Filey's tools (agentPrompt.ts). The
 *  ERP tools are offered by the harness and mapped by appMapPrompt; the brief says who the
 *  agent is and how it works, not which 150 tools exist. */
export const agentSystem = () => agentSystemBase("app", { canLearnSkills: canLearnSkills() });

/** A bare greeting, thanks or goodbye. Not "ok", "yes" or "go ahead": those may answer a
 *  question the agent asked, so they always reach the full agent. */
const SMALL_TALK = /^(h+i+|h+e+y+|h+y+|hello+|hiya|salam|salaam|as+alam(u|o)?\s?alaikum|marhaba|good\s(morning|afternoon|evening)|thanks?(\s(you|u))?(\s(a\slot|so\smuch|very\smuch))?|thx|bye|see\s(you|ya))[\s!.,?\p{Extended_Pictographic}️]*$/iu;

export function isSmallTalk(text: string): boolean {
  const message = text.trim();
  return message.length <= 40 && SMALL_TALK.test(message);
}

const SMALL_TALK_SYSTEM = "You are Filey AI, the assistant in the owner's Filey ERP app. Answer this short message in one or two friendly sentences, in the owner's language, and offer help with their business, documents or computer tasks. No lists.";

/** Small talk needs no tools, engine session or ~15K-token tool setup: one short model call on
 *  the same model and billing writes the reply (nothing is canned). */
function smallTalkTurn(input: AgentTurnInput, options: AgentTurnOptions): AsyncGenerator<AgentEvent, string> {
  // eslint-disable-next-line require-yield -- one short answer, no tool events
  return (async function* (): AsyncGenerator<AgentEvent, string> {
    return aiChat([{ role: "system", text: SMALL_TALK_SYSTEM }, ...input.history.slice(-2), { role: "user", text: input.goalText }],
      { signal: options.signal, maxTokens: 120 });
  })();
}

export interface AgentTurnInput {
  chatId: string;
  goalText: string;
  /** Earlier turns, oldest first, without the new message. */
  history: AiMessage[];
  /** 1-based count of the user's messages in this chat including this one. The history
   *  above is capped, so the caller that holds the whole chat passes the real figure;
   *  the memory nudge cadence is measured against it. */
  userTurn?: number;
  images?: AiImage[];
  /** Autonomous plan → act → verify run instead of a conversational reply. */
  auto: boolean;
}

export interface AgentTurnOptions {
  isOwner: boolean;
  signal: AbortSignal;
  agentId: string;
  confirm: ConfirmFn;
  turnId?: string;
  /** Messages the person sends while the turn runs; they steer it. */
  drainSteer?: () => string[];
  /** Steering the agent could not take (the turn was finishing), handed back to the caller. */
  returnSteer?: (texts: string[]) => void;
  maxTokens?: number;
  effort?: AiEffort;
  reasoningEnabled?: boolean;
  computerSession?: () => Promise<number>;
}

/** The in-browser engine's turn (the TypeScript loop in ai.ts). The in-app chat no longer
 *  runs it — Filey Agent does — but its prompt assembly is kept and tested here. */
export async function* builtInAgentTurn(input: AgentTurnInput, options: AgentTurnOptions): AsyncGenerator<AgentEvent, string> {
  if (input.auto)
    return yield* aiAutonomousStream(input.goalText, { ...options, history: input.history, images: input.images });
  const brief = await buildAiContext(undefined, options.signal).catch(() => "");
  options.signal.throwIfAborted();
  const system = buildSystemPrompt(`${agentSystem()}\n\n${AGENT_HABITS}`, getPersona(),
    [agentPersonaPrompt(), memoryDigest(12, input.goalText), skillsIndex(), brief].filter(Boolean).join("\n\n"));
  // Every tenth user turn carries Hermes' memory nudge. It rides the user message, so
  // the system prompt stays cacheable, and only the model sees it: the chat stores the
  // user's own words (AgentChat keeps shownText) and the run journal strips it.
  const nudge = memoryNudge(input.userTurn ?? input.history.filter(m => m.role === "user").length + 1,
    { canLearnSkills: canLearnSkills() });
  const note = [nudge, stackHint(input.goalText)].filter(Boolean).join("");
  return yield* aiAgentStream([
    { role: "system", text: system },
    ...input.history,
    { role: "user", text: note ? `${input.goalText}${note.startsWith("\n") ? note : `\n\n${note}`}` : input.goalText, images: input.images },
  ], options);
}

/** One in-app chat turn: always Filey Agent (Hermes). */
export function runAgentTurn(input: AgentTurnInput, options: AgentTurnOptions): AsyncGenerator<AgentEvent, string> {
  // Filey Agent (Hermes) is the agent: it keeps its own session history, memory and persona;
  // business actions come back here through runTool. Attachments reach its tools through this
  // turn's slot. No backup brain: when the engine is down the turn says why.
  // The mode rides each in-app turn (one line), so the model acts instead of asking
  // permission in chat; the app shows an approval card when one is really needed.
  // A chat idle for hours restarts its engine session small; a short recap keeps the thread.
  if (fileyAgentEnabled()) {
    if (!input.images?.length && isSmallTalk(input.goalText)) return smallTalkTurn(input, options);
    const recap = refreshIdleFileyAgentSession(input.chatId) ? chatRecap(input.history) : "";
    return fileyAgentTurn(input.chatId, [engineModeNote(), recap, input.goalText].filter(Boolean).join("\n\n"), {
      confirm: options.confirm, isOwner: options.isOwner, turnId: options.turnId, signal: options.signal, agentId: options.agentId,
      drainSteer: options.drainSteer, returnSteer: options.returnSteer,
    }, input.images, input.goalText);
  }
  // Web and phone: the agent lives on the owner's computer. AgentChat sends the turn there
  // over Filey Link first; this is what answers when no computer is open.
  // eslint-disable-next-line require-yield -- a turn that fails before its first event
  return (async function* (): AsyncGenerator<AgentEvent, string> {
    throw new Error("The Filey Agent runs on your computer. Open the Filey desktop app there and stay signed in, then send this again.");
  })();
}
