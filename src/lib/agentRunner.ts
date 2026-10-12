import { claimAgentTask, finishAgentTask } from "./agentCore";

export async function runNextTask(
  worker: string,
  kinds: string[],
  handler: (task: {
    id: string;
    task_type: string;
    user_id: string;
    input: Record<string, unknown>;
  }) => Promise<Record<string, unknown>>,
) {
  const task = await claimAgentTask(worker, kinds);
  if (!task?.id) return false;
  try {
    const output = await handler(task as any);
    await finishAgentTask(task.id, "done", output);
    return true;
  } catch (err) {
    await finishAgentTask(task.id, "failed", undefined, String(err));
    return false;
  }
}