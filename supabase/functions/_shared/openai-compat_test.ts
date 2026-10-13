import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { completionStream } from "./openai-compat.ts";

Deno.test("a finished tool-call completion replays as one OpenAI SSE delta plus usage", async () => {
  const response = completionStream({
    id: "c1",
    model: "filey-ai",
    choices: [{
      index: 0,
      finish_reason: "tool_calls",
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "t1", type: "function", function: { name: "filey_run", arguments: "{\"name\":\"create_invoice_draft\"}" } }],
      },
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });
  assertEquals(response.headers.get("content-type"), "text/event-stream");
  const frames = (await response.text()).trim().split("\n\n").map((line) => line.slice("data: ".length));
  assertEquals(frames.at(-1), "[DONE]");
  const [first, usage] = frames.slice(0, 2).map((frame) => JSON.parse(frame));
  assertEquals(first.object, "chat.completion.chunk");
  assertEquals(first.choices[0].finish_reason, "tool_calls");
  assertEquals(first.choices[0].delta.tool_calls[0], {
    index: 0, id: "t1", type: "function", function: { name: "filey_run", arguments: "{\"name\":\"create_invoice_draft\"}" },
  });
  assertEquals(usage.choices, []);
  assertEquals(usage.usage.total_tokens, 15);
});
