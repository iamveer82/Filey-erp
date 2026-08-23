/* Local store for the copilot's chat sessions. Each session keeps its own
 * rolling memory (last TURN_CAP turns). Persisted in this browser only. */

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  /** Files the agent produced on this turn, kept with the message that made
   *  them so they stay reachable instead of vanishing at the next question. */
  files?: { name: string; path?: string; url?: string }[];
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
    console.error("Failed to load chats from localStorage");
    return [];
  }
}

export function saveChats(chats: Chat[]): void {
  try {
    // A blob URL dies with the page that made it, so persisting one leaves a
    // download chip that silently does nothing tomorrow. Paths survive; URLs
    // are dropped on the way to disk and simply aren't offered after a reload.
    const clean = chats.map((c) => ({
      ...c,
      turns: c.turns.map((t) =>
        t.files
          ? { ...t, files: t.files.map(({ name, path }) => ({ name, path })).filter((f) => f.path) }
          : t
      ),
    }));
    localStorage.setItem(CHATS_KEY, JSON.stringify(clean));
  } catch {
    console.error("Failed to save chats to localStorage");
  }
}

/** Set once per app run; its absence is what marks a fresh launch. */

/**
 * The chat to open, given where in the app's life we are.
 *
 * Each launch starts a clean conversation — yesterday's half-finished thread is
 * rarely what you meant to continue. Within one run, leaving the page (or using
 * the popover instead) keeps the chat you were having.
 *
 * sessionStorage draws that line for free: the webview clears it when the app
 * closes, while the chats themselves live in localStorage and survive. So
 * history keeps everything; only the *active* pointer resets. Both the full
 * page and the popover call this, or they would disagree about which chat is
 * current depending on which one you opened first.
 */
export function resolveOpeningChat(): Chat {
  // Every launch starts clean - the last conversation stays in History,
  // it just does not reopen over your screen.
  return newChat();
}

export function getActiveId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    console.error("Failed to get active chat ID from localStorage");
    return null;
  }
}
export function setActiveId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    console.error("Failed to set active chat ID in localStorage");
  }
}

/** Plain-text transcript for sharing / copying. */
export function transcript(chat: Chat): string {
  return chat.turns
    .map((t) => `${t.role === "user" ? "You" : "AI"}: ${t.text}`)
    .join("\n\n");
}
