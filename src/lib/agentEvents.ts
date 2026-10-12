import { supabase } from "./supabase";

export async function recordAgentEvent(threadId: string, eventType: string, payload: Record<string, unknown>, dedupeKey?: string) {
  const { error } = await supabase!.from("agent_events").insert({
    thread_id: threadId, event_type: eventType, payload, idempotency_key: dedupeKey ?? null,
  });
  if (error) throw error;
}