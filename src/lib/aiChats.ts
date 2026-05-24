/* Local store for the copilot's chat sessions. Each session keeps its own
 * rolling memory (last TURN_CAP turns). Persisted in this browser only. */

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}
export interface Chat {
  id: string;
  title: string;
  turns: ChatTurn[];
  createdAt: number;
  updatedAt: number;
}

const CHATS_KEY = "filey.ai.chats";
const ACTIVE_KEY = "filey.ai.active";
const LEGACY_KEY = "filey.ai.history"; // single-history from earlier builds
export const TURN_CAP = 30;

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function deriveTitle(turns: ChatTurn[]): string {
  const first = turns.find((t) => t.role === "user");
  const s = (first?.text ?? "").trim().replace(/\s+/g, " ");
  if (!s) return "New chat";
  return s.length > 40 ? s.slice(0, 40) + "…" : s;
}

export function newChat(): Chat {
  const now = Date.now();
  return { id: uid(), title: "New chat", turns: [], createdAt: now, updatedAt: now };
}

export function loadChats(): Chat[] {
  try {
    const raw = localStorage.getItem(CHATS_KEY);
    if (raw) return JSON.parse(raw) as Chat[];
    // one-time migration of the old single conversation
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const turns = JSON.parse(legacy) as ChatTurn[];
      if (Array.isArray(turns) && turns.length) {
        const c: Chat = {
          id: uid(),
          title: deriveTitle(turns),
          turns: turns.slice(-TURN_CAP),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        saveChats([c]);
        return [c];
      }
    }
    return [];
  } catch {
    return [];
  }
}

export function saveChats(chats: Chat[]): void {
  try {
    localStorage.setItem(CHATS_KEY, JSON.stringify(chats));
  } catch {
    /* ignore quota */
  }
}

export function getActiveId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}
export function setActiveId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* ignore */
  }
}

/** Plain-text transcript for sharing / copying. */
export function transcript(chat: Chat): string {
  return chat.turns
    .map((t) => `${t.role === "user" ? "You" : "AI"}: ${t.text}`)
    .join("\n\n");
}
