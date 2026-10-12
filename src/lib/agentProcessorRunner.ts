import { runNextTask } from "./agentRunner";
import { getProcessor } from "./agentProcessors";

export async function runPendingAgentTask(worker: string, kinds: string[]) {
  return runNextTask(worker, kinds, async (task) => {
    const processor = getProcessor(task.task_type);
    if (!processor) return { skipped: true, reason: "unknown_task_type" };
    return processor({ taskId: task.id, userId: task.user_id, input: task.input });
  });
}