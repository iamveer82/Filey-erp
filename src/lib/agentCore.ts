import { supabase } from "./supabase";

export type AgentTaskStatus = "queued" | "running" | "done" | "failed" | "dead_letter";
export type AgentTask = {
  id?: string;
  userId: string;
  companyId?: string;
  threadId?: string;
  taskType: string;
  status?: AgentTaskStatus;
  attempts?: number;
  nextRunAt?: string;
  input?: Record<string, unknown>;
  idempotencyKey?: string;
};

export async function enqueueAgentTask(task: AgentTask) {
  const { data, error } = await supabase!.from("agent_tasks").insert({
    user_id: task.userId, company_id: task.companyId ?? null, thread_id: task.threadId ?? null,
    task_type: task.taskType, status: "queued", attempts: 0, next_run_at: task.nextRunAt ?? new Date().toISOString(),
    input: task.input ?? {}, idempotency_key: task.idempotencyKey ?? null,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function claimAgentTask(worker: string, kinds: string[]) {
  const { data, error } = await supabase!.from("agent_tasks")
    .update({ status: "running", claimed_by: worker, claimed_at: new Date().toISOString(), attempts: 1 })
    .eq("status", "queued").in("task_type", kinds)
    .lte("next_run_at", new Date().toISOString()).order("next_run_at", { ascending: true }).limit(1)
    .select().maybeSingle();
  if (error) throw error;
  return data;
}

export async function finishAgentTask(taskId: string, status: AgentTaskStatus, result?: Record<string, unknown>, errorText?: string) {
  const { error } = await supabase!.from("agent_tasks")
    .update({ status, result: result ?? null, error: errorText ?? null, updated_at: new Date().toISOString(), claimed_by: null })
    .eq("id", taskId);
  if (error) throw error;
}