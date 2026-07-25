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

/* ── recall ranking ────────────────────────────────────────────────────────
 * A plain substring match only found a memory when the user echoed its exact
 * wording — ask "what do I know about pricing?" and a memory reading "Bapco
 * gets 5% off list price" stayed invisible. Recall now scores by term overlap
 * so partial and reordered wording still retrieves.
 *
 * ponytail: term overlap, not embeddings — it needs no API key, no index to
 * rebuild, and works offline, which matters because memories live on-device.
 * Swap in vector search only if recall quality measurably falls short.
 */

/** Words too common to carry meaning — they'd match nearly every memory. */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are",
  "was", "were", "be", "been", "it", "its", "this", "that", "with", "from",
  "at", "by", "as", "my", "our", "we", "i", "you", "your", "do", "does", "did",
  "what", "which", "who", "when", "where", "how", "any", "all", "about",
]);

function terms(s: string): string[] {
  return norm(s)
    .split(/[^a-z0-9%@.]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Length of the leading run two words have in common. */
function sharedPrefix(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
}

/** How well one memory answers a query. 0 = no connection at all. */
function score(mem: Memory, query: string, queryTerms: string[]): number {
  const text = norm(mem.text);
  const tag = norm(mem.tag ?? "");
  // Whole-phrase hit is the strongest signal — keeps old exact-match behaviour
  // ranked top rather than merely preserved.
  let total = text.includes(query) || (tag && tag.includes(query)) ? 10 : 0;
  const memTerms = terms(mem.text);
  const tagTerms = terms(mem.tag ?? "");
  for (const q of queryTerms) {
    if (tagTerms.some((t) => t === q)) total += 3; // the tag IS the topic
    if (memTerms.some((t) => t === q)) total += 2;
    // Shared-stem match catches plurals and morphology — "invoice"/"invoices"
    // share 7 leading characters, "price"/"pricing" share 4. Cheaper and less
    // brittle than a stemmer, and 4 is long enough to keep "price" away from
    // "principal".
    else if (memTerms.some((t) => sharedPrefix(t, q) >= 4)) total += 1;
  }
  return total;
}

/** Relevance-ranked search over text + tag, capped. Ties break newest-first,
 *  and an empty query returns the most recent memories. */
export function searchMemories(query?: string, limit = 8): Memory[] {
  const all = listMemories(); // newest first
  const q = norm(query ?? "");
  if (!q) return all.slice(0, limit);

  const queryTerms = terms(q);
  const ranked = all
    .map((m, i) => ({ m, i, s: score(m, q, queryTerms) }))
    .filter((r) => r.s > 0)
    // `i` ascends with age, so it doubles as the newest-first tiebreak.
    .sort((a, b) => b.s - a.s || a.i - b.i);
  return ranked.slice(0, limit).map((r) => r.m);
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
