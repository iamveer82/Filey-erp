import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** The original active workspace and current admin membership are one SQL
 * snapshot. Fail closed after awaited job reads, immediately before sending. */
export async function requireScheduledWorkspace(
  client: SupabaseClient,
  owner: string,
  org: string,
): Promise<void> {
  let allowed = false;
  try {
    const { data, error } = await client.rpc("filey_agent_workspace_allowed", {
      p_owner: owner,
      p_org: org,
    });
    allowed = !error && data === true;
  } catch { /* Unavailable authority cannot authorize private delivery. */ }
  if (!allowed) throw new Error("Scheduled delivery no longer has workspace access.");
}
