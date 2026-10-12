import { supabase } from "./supabase";
import { enqueueAgentTask } from "./agentCore";

export async function enqueueFinancialAssistantTurn(text: string) {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  const userId = data.user?.id;
  if (!userId) return null;
  return enqueueAgentTask({ userId, taskType: "assistant_turn", input: { text } });
}