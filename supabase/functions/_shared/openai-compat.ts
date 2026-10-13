import { CORS_HEADERS } from "./rateLimit.ts";

type Completion = {
  id: string;
  model: string;
  choices: {
    index: number;
    message: {
      role: "assistant";
      content: string | null;
      reasoning_content?: string | null;
      tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
    };
    finish_reason: string | null;
  }[];
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

/** Replay a finished chat.completion as an OpenAI SSE stream. The managed upstream call is
 * non-streaming (one consumed request id = one provider call), but OpenAI clients such as the
 * Filey Agent runtime stream by default: they get the whole reply as one delta, then usage. */
export function completionStream(completion: Completion): Response {
  const created = Math.floor(Date.now() / 1000);
  const choice = completion.choices[0];
  const { message } = choice;
  const delta = {
    role: "assistant",
    content: message.content ?? "",
    ...(message.reasoning_content ? { reasoning_content: message.reasoning_content } : {}),
    ...(message.tool_calls?.length
      ? { tool_calls: message.tool_calls.map((call, index) => ({ index, ...call })) }
      : {}),
  };
  const base = { id: completion.id, object: "chat.completion.chunk", created, model: completion.model };
  const frames = [
    { ...base, choices: [{ index: 0, delta, finish_reason: choice.finish_reason }] },
    { ...base, choices: [], usage: completion.usage },
  ].map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(frames, {
    headers: { ...CORS_HEADERS, "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
  });
}
