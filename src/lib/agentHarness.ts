/* Provider-agnostic agent harness.
 *
 * The loop is written ONCE, in one normalised shape, and converts to a
 * provider's wire format only at the LLM call boundary. Before this there were
 * two loops — one per provider — that had to be kept in step by hand, and they
 * drifted: the round budget was raised in one and not the other, which is how
 * "the agent gives up early" survived a fix. A provider now supplies four small
 * functions and inherits the loop, the guard, the confirm gate and the round
 * accounting automatically.
 *
 * The loop is an async generator, so a caller can either drain it for the final
 * answer (aiAgent) or render each step as it happens. Every step is a typed
 * event rather than a string callback, so a UI can show a tool call and its
 * result distinctly instead of parsing prose.
 *
 * Provider credentials and the fetch used to reach them are injected rather
 * than imported: it keeps this module free of a cycle with ai.ts, and it means
 * a test can run the whole loop against a stub without a network.
 */

import { TOOLS, runTool, type ConfirmFn } from "./aiTools";
import { createGuard, coachResult } from "./agentGuard";
import type { AiConfig, AiMessage } from "./ai";

/** Eight was too few and it showed as "gives up early": discovering a file
 *  tool, running it, filing the result and reporting is already four, before
 *  anything goes wrong once. A round is one model call, so the cost of the
 *  extra headroom is only paid by tasks that actually use it. */
export const MAX_TOOL_ROUNDS = 16;

/** Why the loop stopped. */
export type AgentDoneReason =
  /** The model replied without calling a tool. */
  | "answered"
  /** The model called the caller's finish tool (autonomous runs). */
  | "finished"
  /** The round budget ran out with work still outstanding. */
  | "exhausted";

/** One observable step of a run. */
export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; result: unknown }
  | { type: "done"; text: string; reason: AgentDoneReason };

export interface AgentToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface HarnessOpts {
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  maxRounds?: number;
  extraTools?: AgentToolDef[];
  finishToolName?: string;
  /** Per-run override for the sensitive-action confirm gate. */
  confirm?: ConfirmFn;
  /** Whether this run may use owner-only tools (true in-app, and for the owner's
   *  own WhatsApp number; false for customers). */
  isOwner?: boolean;
}

export interface HarnessDeps {
  cfg: AiConfig;
  /** The retrying fetch from ai.ts. Injected so this module stays testable. */
  fetchFn: (url: string, init: RequestInit) => Promise<Response>;
}

/** A tool call in the shape the loop works with, whatever the provider called it. */
interface NormalCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

interface ToolOutcome {
  id: string;
  name: string;
  content: string;
}

/** The provider-shaped conversation the adapter appends to as the run proceeds. */
interface Wire {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  convo: any[];
  system: string;
}

/** Everything that differs between providers, and nothing that doesn't. */
interface Adapter {
  init(messages: AiMessage[]): Wire;
  buildRequest(
    wire: Wire,
    tools: AgentToolDef[],
    opts: HarnessOpts,
    cfg: AiConfig
  ): { url: string; init: RequestInit };
  /** Append the assistant turn to the wire and normalise it for the loop. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readTurn(wire: Wire, data: any): { text: string; calls: NormalCall[] };
  pushResults(wire: Wire, results: ToolOutcome[]): void;
}

/* ── OpenAI Chat Completions (also OpenRouter, Groq, Ollama, LM Studio…) ──── */

const openaiAdapter: Adapter = {
  init(messages) {
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.text)
      .join("\n\n");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const convo: any[] = [];
    if (system) convo.push({ role: "system", content: system });
    for (const m of messages.filter((m) => m.role !== "system"))
      convo.push({
        role: m.role,
        content: m.images?.length
          ? [
              { type: "text", text: m.text },
              ...m.images.map((im) => ({
                type: "image_url",
                image_url: { url: `data:${im.mediaType};base64,${im.dataBase64}` },
              })),
            ]
          : m.text,
      });
    return { convo, system };
  },

  buildRequest(wire, tools, opts, cfg) {
    return {
      url: `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`,
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: opts.maxTokens ?? 2048,
          temperature: opts.temperature ?? 0.3,
          messages: wire.convo,
          tools: tools.map((t) => ({
            type: "function",
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            },
          })),
        }),
        signal: opts.signal,
      },
    };
  },

  readTurn(wire, data) {
    const msg = data?.choices?.[0]?.message;
    if (!msg) return { text: "", calls: [] };
    wire.convo.push(msg);
    const calls: NormalCall[] = [];
    if (Array.isArray(msg.tool_calls))
      for (const tc of msg.tool_calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function?.arguments || "{}");
        } catch {
          // A malformed argument blob is the model's error, not a crash: run
          // the tool with no arguments and let it report what it needed.
          console.error("Failed to parse tool call arguments");
        }
        calls.push({ id: tc.id, name: tc.function?.name, args });
      }
    return { text: (msg.content ?? "").toString().trim(), calls };
  },

  pushResults(wire, results) {
    for (const r of results)
      wire.convo.push({ role: "tool", tool_call_id: r.id, content: r.content });
  },
};

/* ── Anthropic Messages ───────────────────────────────────────────────────── */

const anthropicAdapter: Adapter = {
  init(messages) {
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.text)
      .join("\n\n");
    const convo = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role,
        content: m.images?.length
          ? [
              { type: "text", text: m.text },
              ...m.images.map((im) => ({
                type: "image",
                source: {
                  type: "base64",
                  media_type: im.mediaType,
                  data: im.dataBase64,
                },
              })),
            ]
          : m.text,
      }));
    return { convo, system };
  },

  buildRequest(wire, tools, opts, cfg) {
    const base = cfg.baseUrl.includes("anthropic")
      ? cfg.baseUrl.replace(/\/+$/, "")
      : "https://api.anthropic.com/v1";
    return {
      url: `${base}/messages`,
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": cfg.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: opts.maxTokens ?? 2048,
          system: wire.system || undefined,
          messages: wire.convo,
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters,
          })),
        }),
        signal: opts.signal,
      },
    };
  },

  readTurn(wire, data) {
    const content = data?.content ?? [];
    wire.convo.push({ role: "assistant", content });
    const text = (content as { type?: string; text?: string }[])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim();
    const calls: NormalCall[] =
      data?.stop_reason === "tool_use"
        ? (content as { type?: string; id?: string; name?: string; input?: unknown }[])
            .filter((b) => b.type === "tool_use")
            .map((b) => ({
              id: b.id ?? "",
              name: b.name ?? "",
              args: (b.input as Record<string, unknown>) || {},
            }))
        : [];
    return { text, calls };
  },

  pushResults(wire, results) {
    wire.convo.push({
      role: "user",
      content: results.map((r) => ({
        type: "tool_result",
        tool_use_id: r.id,
        content: r.content,
      })),
    });
  },
};

export function adapterFor(provider: AiConfig["provider"]): Adapter {
  return provider === "anthropic" ? anthropicAdapter : openaiAdapter;
}

/**
 * Run the agent, yielding each step as it happens and returning the final text.
 *
 * The generator's RETURN value is the answer; the yielded values are the
 * narration. A caller that only wants the answer drains it (see aiAgent).
 */
export async function* runAgentStream(
  messages: AiMessage[],
  opts: HarnessOpts,
  deps: HarnessDeps
): AsyncGenerator<AgentEvent, string, void> {
  const adapter = adapterFor(deps.cfg.provider);
  const wire = adapter.init(messages);
  const tools = [...TOOLS, ...(opts.extraTools ?? [])];
  const maxRounds = opts.maxRounds ?? MAX_TOOL_ROUNDS;
  const guard = createGuard();

  for (let round = 0; round < maxRounds; round++) {
    const { url, init } = adapter.buildRequest(wire, tools, opts, deps.cfg);
    const res = await deps.fetchFn(url, init);
    const data = await res.json();
    const { text, calls } = adapter.readTurn(wire, data);

    if (text) yield { type: "text", text };

    if (!calls.length) {
      yield { type: "done", text, reason: "answered" };
      return text;
    }

    const outcomes: ToolOutcome[] = [];
    for (const call of calls) {
      if (opts.finishToolName && call.name === opts.finishToolName) {
        const summary = String(
          call.args.summary ?? text ?? "Task complete."
        ).trim();
        yield { type: "done", text: summary, reason: "finished" };
        return summary;
      }

      yield { type: "tool_call", id: call.id, name: call.name, args: call.args };

      // A repeat of an identical call is answered from this run's memory —
      // reads return the earlier answer, writes are refused. Without it the
      // same invoice gets emailed twice when the model second-guesses itself.
      const decided = guard.before(call.name, call.args);
      const raw =
        "short" in decided
          ? decided.short
          : await runTool(call.name, call.args, opts.confirm, opts.isOwner);
      if (!("short" in decided)) guard.after(call.name, call.args, raw);
      const result = coachResult(raw, maxRounds - round - 1);

      yield { type: "tool_result", id: call.id, name: call.name, result };
      outcomes.push({
        id: call.id,
        name: call.name,
        content: JSON.stringify(result).slice(0, 6000),
      });
    }
    adapter.pushResults(wire, outcomes);
  }

  // Running out of rounds used to produce an apology and nothing else. What
  // was actually done matters more — especially if some of it changed data.
  const done = guard.summary();
  const text = done
    ? `I got part of the way but ran out of steps. ${done}. Tell me how to continue.`
    : "I ran several steps but couldn't finish — try rephrasing.";
  yield { type: "done", text, reason: "exhausted" };
  return text;
}
