/* Agent long-term memory — the "learn from it" layer.
 *
 * Durable facts and preferences the assistant should remember across chats:
 * how the user works, recurring customers/suppliers, naming conventions,
 * standing instructions ("always CC accounts@…", "our VAT is 5%"), etc.
 *
 * ponytail: localStorage is the store — non-secret learnings, same pattern as
 * the AI config/persona. Move to the desktop SQLite/encrypted store only if
 * memories ever need to sync across devices or hold sensitive data.
 *
 * NEVER store secrets here (API keys, passwords) — it's plaintext, and the
 * digest is injected into the model prompt every turn.
 */

export interface Memory {
  id: string;
  text: string;
  /** Optional short bucket, e.g. "preference", "customer", "tax". */
  tag?: string;
  created_at: string;
}

const KEY = "filey.ai.memory";
const MAX_MEMORIES = 200; // bound localStorage; oldest dropped past this
const DIGEST_LIMIT = 12; // how many to surface in the system prompt

function load(): Memory[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as Memory[]) : [];
  } catch {
    console.error("Failed to parse AI memory from localStorage");
    return [];
  }
}

function save(list: Memory[]): void {
  // Keep the most recent MAX_MEMORIES (list is oldest→newest).
  const trimmed = list.slice(-MAX_MEMORIES);
  localStorage.setItem(KEY, JSON.stringify(trimmed));
}

const norm = (s: string) => s.trim().toLowerCase();

/** Save a durable fact. Near-duplicate text (same normalised string) is
 *  refreshed in place rather than duplicated. Returns the stored memory. */
export function addMemory(text: string, tag?: string): Memory {
  const clean = text.trim();
  if (!clean) throw new Error("Cannot remember an empty note.");
  const list = load();
  const existing = list.find((m) => norm(m.text) === norm(clean));
  if (existing) {
    existing.created_at = new Date().toISOString();
    if (tag) existing.tag = tag.trim();
    save(list);
    return existing;
  }
  const mem: Memory = {
    id: `mem_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    text: clean,
    tag: tag?.trim() || undefined,
    created_at: new Date().toISOString(),
  };
  list.push(mem);
  save(list);
  return mem;
}

/** All memories, newest first. */
export function listMemories(): Memory[] {
  return load().reverse();
}

/** Substring search over text + tag, newest-first, capped. Empty query =
 *  most-recent memories. */
export function searchMemories(query?: string, limit = 8): Memory[] {
  const all = listMemories();
  const q = norm(query ?? "");
  const hits = q ? all.filter((m) => norm(m.text).includes(q) || norm(m.tag ?? "").includes(q)) : all;
  return hits.slice(0, limit);
}

export function deleteMemory(id: string): void {
  save(load().filter((m) => m.id !== id));
}

export function clearMemories(): void {
  localStorage.removeItem(KEY);
}

/** Compact bullet digest of recent memories for the system prompt. Returns ""
 *  when there's nothing, so callers can append unconditionally. */
export function memoryDigest(limit = DIGEST_LIMIT): string {
  const recent = listMemories().slice(0, limit);
  if (!recent.length) return "";
  const lines = recent.map((m) => `- ${m.tag ? `[${m.tag}] ` : ""}${m.text}`);
  return [
    "MEMORY — durable facts you've learned about this user/business. Use the `recall` tool to search older notes, and the `remember` tool to save new durable facts, preferences, or standing instructions the user shares:",
    ...lines,
  ].join("\n");
}
