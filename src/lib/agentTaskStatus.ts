import { supabase } from "./supabase";

export async function getAgentTaskStatus(taskId: string) {
  const { data, error } = await supabase!.from("agent_tasks").select("id,status,error,result,updated_at").eq("id", taskId).maybeSingle();
  if (error) throw error;
  return data;
}