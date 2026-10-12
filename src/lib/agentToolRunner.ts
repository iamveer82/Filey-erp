import { supabase } from "./supabase";

export type ToolResult = { status: "ok" | "error"; output?: unknown; error?: string };

export async function runToolWithAudit<T>(
  taskId: string,
  toolName: string,
  input: Record<string, unknown>,
  executor: (input: Record<string, unknown>) => Promise<T>,
  timeoutMs = 30000,
): Promise<ToolResult> {
  const started = Date.now();
  let result: ToolResult;
  try {
    const value = await Promise.race([
      executor(input),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
    ]);
    const elapsed = Date.now() - started;
    result = { status: "ok", output: value };
    await supabase!.from("agent_tool_calls").insert({
      task_id: taskId, tool_name: toolName, input, output: { value }, status: "ok", elapsed_ms: elapsed,
    });
  } catch (e) {
    const elapsed = Date.now() - started;
    result = { status: "error", error: String(e) };
    await supabase!.from("agent_tool_calls").insert({
      task_id: taskId, tool_name: toolName, input, output: { error: String(e) }, status: "error", elapsed_ms: elapsed,
    }).catch(() => undefined);
  }
  return result;
}