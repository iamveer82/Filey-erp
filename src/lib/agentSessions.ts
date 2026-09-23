import { loadChats } from "./aiChats";
import { waLogList } from "./waLog";
import type { AiMessage } from "./ai";

/** Reuse the durable channel log; approvals are deliberately never restored. */
export function whatsappContext(from: string): AiMessage[] {
  const rows = waLogList({ from, limit: 200 });
  const start = rows.reduce((last, row, index) => row.sessionStart ? index : last, -1);
  return rows.slice(start + 1).slice(-20).map(row => ({
    role: row.dir === "in" ? "user" : "assistant", text: row.text,
  }));
}

/** Search only this signed-in user's current workspace and storage mode.
 * Bounded local text search avoids an embedding service and extra cloud calls. */
export function searchConversations(query: string) {
  const clean = query.trim().toLocaleLowerCase();
  if (clean.length < 2 || clean.length > 200)
    throw new Error("Search with between 2 and 200 characters.");
  const words = [...new Set(clean.split(/[^\p{L}\p{N}]+/u).filter(word => word.length > 1))];
  const score = (text: string) => {
    const lower = text.toLocaleLowerCase();
    return (lower.includes(clean) ? 10 : 0) + words.filter(word => lower.includes(word)).length;
  };
  const sessions = loadChats().filter(chat => chat && typeof chat.id === "string" && Array.isArray(chat.turns))
    .slice(0, 50).map(chat => ({
      id: chat.id, channel: "filey", title: chat.title, updatedAt: chat.updatedAt,
      turns: chat.turns.filter(turn => typeof turn.text === "string"),
    }));
  const phones = new Map<string, { role: "user" | "assistant"; text: string; at: number }[]>();
  for (const row of waLogList({ limit: 200 })) {
    const list = phones.get(row.from) ?? [];
    list.push({ role: row.dir === "in" ? "user" : "assistant", text: row.text, at: row.at });
    phones.set(row.from, list);
  }
  for (const [phone, turns] of phones)
    sessions.push({ id: `whatsapp:${phone}`, channel: "whatsapp", title: `WhatsApp · ${phone}`, updatedAt: turns[turns.length - 1].at, turns });
  return sessions.map(session => ({
    ...session,
    score: Math.max(0, ...session.turns.map(turn => score(turn.text))),
    turns: session.turns.filter(turn => score(turn.text) > 0).slice(-3).map(turn => {
      const lower = turn.text.toLocaleLowerCase();
      const hit = Math.max(0, words.map(word => lower.indexOf(word)).find(index => index >= 0) ?? 0);
      const start = Math.max(0, hit - 120);
      return { role: turn.role, text: `${start ? "…" : ""}${turn.text.slice(start, start + 650)}${turn.text.length > start + 650 ? "…" : ""}` };
    }),
  })).filter(session => session.score > 0)
    .sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt).slice(0, 5);
}
