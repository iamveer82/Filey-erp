// A model that does exactly what the test says, so a case reads "given the
// model answers like this, what did the system actually do?".
//
// The point is the half nobody could test before: not whether the model is
// clever, but whether the machinery around it — the tool surface it is offered,
// the gates, the guard, what lands in the database — behaves. The invoice bug
// that started this was invisible to every existing test because the tool
// simply had nowhere to put "400 litres"; a case here fails the moment that
// parameter disappears again.
//
// Requests are recorded, so a case can assert what the model was SHOWN as well
// as what it did. That is the tool-selection dimension: offering 89 tools or
// advertising writes in Plan mode are both bugs you can only see from here.
import { vi } from "vitest";

export interface ToolCallScript {
  name: string;
  args: Record<string, unknown>;
}

/** One scripted assistant turn: some text, and optionally tools to call. */
export interface Turn {
  text?: string;
  calls?: ToolCallScript[];
}

export interface Recorded {
  /** Tool names offered to the model on this request. */
  offered: string[];
  body: Record<string, unknown>;
}

export interface ScriptedModel {
  /** Every request the harness made, in order. */
  requests: Recorded[];
  /** Tool names offered on the first request. */
  firstOffered: () => string[];
  /** Bytes of tool schema on the first request — the cost of the surface. */
  firstToolBytes: () => number;
}

/** OpenAI chat-completions shape, which is also OpenRouter/Groq/Ollama. */
function openaiTurn(t: Turn) {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: t.text ?? "",
          tool_calls: t.calls?.map((c, i) => ({
            id: `call_${i}`,
            type: "function",
            function: { name: c.name, arguments: JSON.stringify(c.args) },
          })),
        },
      },
    ],
  };
}

/**
 * Install a fetch stub that plays `turns` in order. The last turn repeats if
 * the harness asks for more, which is what makes round-exhaustion testable.
 */
export function scriptModel(turns: Turn[]): ScriptedModel {
  const requests: Recorded[] = [];
  let i = 0;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      const tools = (body.tools ?? []) as { function?: { name?: string } }[];
      requests.push({
        offered: tools.map((t) => t.function?.name ?? "").filter(Boolean),
        body,
      });
      const turn = turns[Math.min(i++, turns.length - 1)];
      return {
        ok: true,
        status: 200,
        json: async () => openaiTurn(turn),
      };
    })
  );

  return {
    requests,
    firstOffered: () => requests[0]?.offered ?? [],
    firstToolBytes: () => JSON.stringify(requests[0]?.body?.tools ?? []).length,
  };
}

/** Shorthand for a turn that just answers. */
export const says = (text: string): Turn => ({ text });

/** Shorthand for a turn that calls one tool. */
export const calls = (
  name: string,
  args: Record<string, unknown>,
  text = ""
): Turn => ({ text, calls: [{ name, args }] });
