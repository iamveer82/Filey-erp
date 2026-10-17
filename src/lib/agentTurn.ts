/* One Filey AI chat turn on THIS device's engine. The in-app chat runs it, and so
 * does a desktop answering a linked phone (linkedAgent.ts): the same prompt, the
 * same tools, the same approvals on both paths. */
import { aiAgentStream, aiAutonomousStream, buildSystemPrompt, getPersona, type AiImage, type AiMessage } from "./ai";
import { AGENT_HABITS, memoryDigest } from "./aiMemory";
import { skillsIndex } from "./agentSkills";
import { buildAiContext } from "./aiContext";
import { fileyAgentEnabled, fileyAgentOrFallback, fileyAgentTurn } from "./fileyAgent";
import type { AgentEvent } from "./agentHarness";
import type { ConfirmFn } from "./aiTools";
import type { AiEffort } from "./aiEndpoint";

export const AGENT_SYSTEM =
  "You are Filey, the user's AI business agent with full control of their ERP app via tools — you can read AND modify: stats, customers, products, invoices, quotes, orders, purchase orders, expenses, attendance, files, and navigation. You have long-term memory: use `remember` to save durable facts/preferences and `recall` to look them up. When asked to do something, execute the tool and confirm in one short line. Money/outbound actions require user approval. Never invent data — look it up. Be concise and practical. SHOW, DON'T JUST TELL: when an answer has numbers to compare, a trend, parts of a total, a plan or options, call show_view with the real figures beside a short explanation, without being asked (bar to compare or over time, stacked bar for parts per period, pie or radial for shares of one total, stats for KPIs, table for exact rows, steps for a process, choices for a decision). For something to play with (calculator, what-if, simulator, diagram) use show_ui. Skip widgets for one number, a yes/no or a finished action.";

export interface AgentTurnInput {
  chatId: string;
  goalText: string;
  /** Earlier turns, oldest first, without the new message. */
  history: AiMessage[];
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
  maxTokens?: number;
  effort?: AiEffort;
  reasoningEnabled?: boolean;
  computerSession?: () => Promise<number>;
}

/** Filey Agent when it is switched on here (Filey AI answers if it can't start), else Filey AI. */
export function runAgentTurn(input: AgentTurnInput, options: AgentTurnOptions): AsyncGenerator<AgentEvent, string> {
  const builtIn = async function* (): AsyncGenerator<AgentEvent, string> {
    if (input.auto)
      return yield* aiAutonomousStream(input.goalText, { ...options, history: input.history, images: input.images });
    const brief = await buildAiContext(undefined, options.signal).catch(() => "");
    options.signal.throwIfAborted();
    const system = buildSystemPrompt(`${AGENT_SYSTEM}\n\n${AGENT_HABITS}`, getPersona(),
      [memoryDigest(12, input.goalText), skillsIndex(), brief].filter(Boolean).join("\n\n"));
    return yield* aiAgentStream([
      { role: "system", text: system },
      ...input.history,
      { role: "user", text: input.goalText, images: input.images },
    ], options);
  };
  // Filey Agent keeps its own session history, memory and persona; business actions come
  // back here through runTool. Attachments reach its tools through this turn's slot.
  return fileyAgentEnabled()
    ? fileyAgentOrFallback(fileyAgentTurn(input.chatId, input.goalText, {
      confirm: options.confirm, isOwner: options.isOwner, turnId: options.turnId, signal: options.signal, agentId: options.agentId,
    }), builtIn)
    : builtIn();
}
