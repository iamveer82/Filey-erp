import { supabase } from "./supabase";

export async function recordJournalEvent(userId: string, companyId: string | undefined, sourceType: string, sourceId: string | undefined, payload: Record<string, unknown>) {
  const { error } = await supabase!.from("journal_events").insert({
    user_id: userId, company_id: companyId ?? null, source_type: sourceType, source_id: sourceId ?? null, payload,
  });
  if (error) throw error;
}