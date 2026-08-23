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
import { isToolAllowed } from "./capabilities";
import { gateFor } from "./agentMode";
import { CORE_TOOLS, TOOLSETS, toolsetIndex } from "./toolsets";
import {
  compressForModel,
  headroomRetrieve,
  HEADROOM_RETRIEVE,
} from "./headroom";
import { log } from "./log";
import type { AiConfig, AiMessage } from "./ai";

/** Eight was too few and it showed as "gives up early": discovering a file
 *  tool, running it, filing the result and reporting is already four, before
 *  anything goes wrong once. A round is one model call, so the cost of the
 *  extra headroom is only paid by tasks that actually use it. */
export const MAX_TOOL_ROUNDS = 16;

/** The two tools the harness owns rather than aiTools: they change what the
 *  model can see next round, so they are answered here without touching the
 *  app. */
const LIST_TOOLSETS = "list_toolsets";
const USE_TOOLSET = "use_toolset";

/** Answered here like the two above: it reaches into this run's compression
 *  store, not the app. Only offered once something was actually compressed,
 *  so the model never sees a tool that has nothing to retrieve. */
const headroomTool: AgentToolDef = {
  name: HEADROOM_RETRIEVE,
  description:
    "Fetch the FULL original of an earlier tool output that came back with a [headroom] compressed marker. Pass the exact id from that marker. Use it when the digest is not enough — for example you need one row the table clipped.",
  parameters: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
  },
};

const toolsetTools: AgentToolDef[] = [
  {
    name: LIST_TOOLSETS,
    description:
      "List the extra tool domains available (purchasing, accounting, people, files, messaging, web…). Call this when the job needs something beyond the everyday tools you can already see.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: USE_TOOLSET,
    description:
      "Load a tool domain by name so its tools become available for the rest of this conversation. Call it as soon as you know which domain the job needs, then use the tools it brings.",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "Domain id from list_toolsets." } },
      required: ["name"],
    },
  },
];

/** Open a domain for the rest of the run. Names what actually arrived, because
 *  a domain whose tools are all gated off would otherwise look like it worked
 *  and then appear empty. */
function openToolset(
  name: string,
  opened: Set<string>,
  opts: HarnessOpts
): Record<string, unknown> {
  const id = name.trim().toLowerCase();
  const set = TOOLSETS[id];
  if (!set) {
    return {
      error: `No toolset "${name}".`,
      available: Object.keys(TOOLSETS),
    };
  }
  opened.add(id);
  const usable = set.tools.filter((n) => {
    const t = TOOLS.find((x) => x.name === n);
    if (!t) return false;
    if (t.ownerOnly && !opts.isOwner) return false;
    if (!isToolAllowed(n)) return false;
    return gateFor(n, t.sensitive) !== "block";
  });
  return usable.length
    ? { ok: true, loaded: id, tools: usable }
    : {
        ok: true,
        loaded: id,
        tools: [],
        note: `The "${id}" tools are all switched off right now — either the capability is disabled in Settings, or the current agent mode blocks them. Tell the user that rather than trying another way in.`,
      };
}

/**
 * What the model is shown this round.
 *
 * Two filters, in order. First the gates that would refuse the call anyway —
 * offering a tool the app will decline wastes a round and teaches the model
 * nothing, and in Plan mode advertising writes invites exactly the attempt the
 * mode exists to prevent. Then the core/domain split, so the list stays short
 * enough for the model to choose well.
 */
export function offeredTools(
  opts: HarnessOpts,
  opened: ReadonlySet<string>
): AgentToolDef[] {
  const visible = TOOLS.filter((t) => {
    if (t.ownerOnly && !opts.isOwner) return false;
    if (!isToolAllowed(t.name)) return false;
    return gateFor(t.name, t.sensitive) !== "block";
  });

  const inOpenSets = new Set(
    [...opened].flatMap((id) => TOOLSETS[id]?.tools ?? [])
  );
  const core = new Set<string>(CORE_TOOLS);
  const chosen = visible.filter((t) => core.has(t.name) || inOpenSets.has(t.name));

  return [
    ...chosen.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
    // No point advertising more domains once they are all open.
    ...(opened.size < Object.keys(TOOLSETS).length ? toolsetTools : []),
    ...(opts.extraTools ?? []),
  ];
}

/** Why the loop stopped. */
export type AgentDoneReason =
  /** The model replied without calling a tool. */
  | "answered"
  /** The model called the caller's finish tool (autonomous runs). */
  | "finished"
  /** The round budget ran out with work still outstanding. */
  | "exhausted"
  /** The provider call failed mid-run; whatever was already done stands. */
  | "error";

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
  /** The chat turn this run belongs to — scopes per-turn file state (the
   *  attachment, produced files) to this run alone. */
  turnId?: string;
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
          temperature: opts.temperature ?? 0.3,
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

/** Context hygiene between rounds.
 *
 *  Images only need to be SEEN once: after the first round every earlier
 *  turn's base64 payload goes, otherwise a single screenshot is re-uploaded —
 *  and re-billed — on every remaining call of a 16-round run. Very old tool
 *  outputs shrink to a marker too, so a long run cannot grow without bound;
 *  recent results are kept whole because the model is usually iterating on
 *  exactly those. Both wire shapes carry content either as a string or as a
 *  block array, so the walk handles both. */
const OLD_TOOL_CLIP = 400;

function trimWire(wire: Wire, dropImages: boolean): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const convo = wire.convo as any[];
  for (let i = 0; i < convo.length; i++) {
    const m = convo[i];
    if (!m || typeof m !== "object") continue;
    const isLast = i === convo.length - 1;
    if (Array.isArray(m.content)) {
      let blocks = m.content;
      if (dropImages && !isLast) {
        blocks = blocks.filter(
          (b: { type?: string }) => b?.type !== "image" && b?.type !== "image_url"
        );
        if (!blocks.length) blocks = [{ type: "text", text: "[attachment seen earlier]" }];
        m.content = blocks;
      }
      if (!isLast) {
        // Anthropic-shaped tool results ride as blocks inside a user message.
        for (const b of blocks) {
          if (
            b?.type === "tool_result" &&
            typeof b.content === "string" &&
            b.content.length > OLD_TOOL_CLIP
          ) {
            b.content = `${b.content.slice(0, OLD_TOOL_CLIP)}…[older output trimmed]`;
          }
        }
      }
    } else if (typeof m.content === "string") {
      // OpenAI-shaped tool results and old assistant text. The last message is
      // always fresh; everything older than that has already been read once.
      if (!isLast && m.role === "tool" && m.content.length > OLD_TOOL_CLIP) {
        m.content = `${m.content.slice(0, OLD_TOOL_CLIP)}…[older output trimmed]`;
      }
    }
  }
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
  const maxRounds = opts.maxRounds ?? MAX_TOOL_ROUNDS;
  const guard = createGuard();
  /** Domains the model has asked for this run (see toolsets.ts). */
  const opened = new Set<string>();
  /** Flips on the first compressed output; from then on the retrieve tool is
   *  offered so the model can pull originals back. */
  let compressedThisRun = false;

  for (let round = 0; round < maxRounds; round++) {
    trimWire(wire, round > 0);
    const offered = offeredTools(opts, opened);
    const tools = compressedThisRun ? [...offered, headroomTool] : offered;
    const { url, init } = adapter.buildRequest(wire, tools, opts, deps.cfg);

    // A provider hiccup is not a crashed run: everything already done stands,
    // and the caller gets a done event (plus a journal-able reason) instead of
    // a generator that dies silently mid-stream.
    let data: unknown;
    try {
      const res = await deps.fetchFn(url, init);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 300)}` : ""}`);
      }
      data = await res.json();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("agent", "model call failed", msg);
      const text = `The model call failed (${msg}). Anything I did before that is saved — ask me to continue and I'll pick up from there.`;
      yield { type: "done", text, reason: "error" };
      return text;
    }
    const { text, calls } = adapter.readTurn(wire, data);

    if (text) yield { type: "text", text };

    if (!calls.length) {
      log.info("agent", `answered after ${round + 1} round(s)`);
      yield { type: "done", text, reason: "answered" };
      return text;
    }

    const outcomes: ToolOutcome[] = [];
    for (const call of calls) {
      if (opts.finishToolName && call.name === opts.finishToolName) {
        // The finish tool must be called ALONE. If it arrives alongside other
        // calls, answering it here would strand the rest: the assistant turn is
        // already on the wire, so a later conversation would believe those
        // calls ran when nothing did. Refuse just this call instead — every
        // call in the turn gets a result, and the model finishes cleanly next
        // round.
        if (call !== calls[calls.length - 1]) {
          const result = {
            error: `Call ${opts.finishToolName} by itself — finish no other tools in the same turn.`,
          };
          yield { type: "tool_result", id: call.id, name: call.name, result };
          outcomes.push({ id: call.id, name: call.name, content: JSON.stringify(result) });
          continue;
        }
        const summary = String(
          call.args.summary ?? text ?? "Task complete."
        ).trim();
        yield { type: "done", text: summary, reason: "finished" };
        return summary;
      }

      yield { type: "tool_call", id: call.id, name: call.name, args: call.args };

      // Answered here, not in the app: these decide what the model can see on
      // the next round, which is this loop's business rather than the ERP's.
      if (call.name === LIST_TOOLSETS || call.name === USE_TOOLSET) {
        const result =
          call.name === LIST_TOOLSETS
            ? { toolsets: toolsetIndex() }
            : openToolset(String(call.args.name ?? ""), opened, opts);
        yield { type: "tool_result", id: call.id, name: call.name, result };
        outcomes.push({ id: call.id, name: call.name, content: JSON.stringify(result) });
        continue;
      }
      if (call.name === HEADROOM_RETRIEVE) {
        const result = headroomRetrieve(String(call.args.id ?? ""));
        yield { type: "tool_result", id: call.id, name: call.name, result };
        outcomes.push({ id: call.id, name: call.name, content: JSON.stringify(result) });
        continue;
      }

      // A repeat of an identical call is answered from this run's memory —
      // reads return the earlier answer, writes are refused. Without it the
      // same invoice gets emailed twice when the model second-guesses itself.
      const decided = guard.before(call.name, call.args);
      const raw =
        "short" in decided
          ? decided.short
          : await runTool(call.name, call.args, opts.confirm, opts.isOwner, opts.turnId);
      if (!("short" in decided)) guard.after(call.name, call.args, raw);
      const result = coachResult(raw, maxRounds - round - 1);

      yield { type: "tool_result", id: call.id, name: call.name, result };
      // The UI event carries the full result; the WIRE gets the compressed
      // form (headroom), with the original retrievable by id. The clip inside
      // compressForModel is the same 6000-char backstop as before.
      const wireText = compressForModel(call.name, JSON.stringify(result));
      if (wireText.ccrId) compressedThisRun = true;
      outcomes.push({ id: call.id, name: call.name, content: wireText.text });
    }
    adapter.pushResults(wire, outcomes);
  }

  // Running out of rounds used to produce an apology and nothing else. What
  // was actually done matters more — especially if some of it changed data.
  log.warn("agent", `ran out of rounds after ${maxRounds}`, guard.summary());
  const done = guard.summary();
  const text = done
    ? `I got part of the way but ran out of steps. ${done}. Tell me how to continue.`
    : "I ran several steps but couldn't finish — try rephrasing.";
  yield { type: "done", text, reason: "exhausted" };
  return text;
}
