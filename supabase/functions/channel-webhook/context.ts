import type { InboundMsg } from "./parse.ts";
import { rankMemories } from "./tools-writes.ts";

/** Only turns explicitly attributed to this workspace can become model
 *  context. Legacy logs without org metadata remain in the audit trail but
 *  cannot safely be assigned to the user's current company. */
// deno-lint-ignore no-explicit-any
export async function recentHistory(client: any, ownerId: string, orgId: string, channel: InboundMsg["channel"], chatId: string): Promise<{ role: "user" | "assistant"; content: string }[]> {
  if (!ownerId || !orgId.trim()) return [];
  try {
    const { data, error } = await client.from("channel_messages")
      .select("direction,body").eq("user_id", ownerId).eq("raw->>org_id", orgId)
      .eq("channel", channel).eq("external_id", chatId)
      .order("created_at", { ascending: false }).limit(12);
    if (error) return [];
    const turns: { role: "user" | "assistant"; content: string }[] = [];
    for (const row of [...(data ?? [])].reverse()) {
      const role = row.direction === "in" ? "user" : "assistant";
      const body = String(row.body ?? "").slice(0, 1500);
      if (!body) continue;
      const last = turns[turns.length - 1];
      if (last?.role === role) last.content += "\n" + body;
      else turns.push({ role, content: body });
    }
    while (turns[0]?.role === "assistant") turns.shift();
    return turns;
  } catch {
    return [];
  }
}

/** User-owned facts are also workspace-owned: personal workspaces keep their
 *  normal history, while switching companies cannot expose old team facts. */
// deno-lint-ignore no-explicit-any
export async function loadMemories(client: any, ownerId: string, orgId: string, query: string): Promise<string[]> {
  if (!ownerId || !orgId.trim()) return [];
  try {
    const { data, error } = await client.from("agent_memories")
      .select("text,tag").eq("user_id", ownerId).eq("org_id", orgId)
      .order("updated_at", { ascending: false }).limit(200);
    if (error) return [];
    const rows = (data ?? []) as { text: string; tag?: string }[];
    const ranked = rankMemories(rows, query);
    return [...ranked, ...rows.filter(row => !ranked.includes(row))].slice(0, 12)
      .map(row => String(row.text ?? "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}
