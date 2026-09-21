/* Local store for the copilot's chat sessions. Each session keeps its own
 * rolling memory (last TURN_CAP turns). Persisted in this browser only. */

import { readAgentStorage, writeAgentStorage } from "./agentStorage";

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  /** Files the agent produced on this turn, kept with the message that made
   *  them so they stay reachable instead of vanishing at the next question. */
  files?: { name: string; path?: string; url?: string; videoJobId?: string }[];
  run?: {
    plan: { step: string; status: "pending" | "in_progress" | "completed" | "blocked" }[];
    actions: {
      id: string;
      name: string;
      status: "running" | "completed" | "failed" | "waiting";
      detail?: string;
    }[];
    outcome?: string;
  };
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
export const TURN_CAP = 30;
/** Total sessions kept. Chats used to be unbounded, so a long-lived install
 *  crept toward the ~5 MB localStorage ceiling and then silently stopped
 *  persisting — newest wins now, and history stays readable. */
export const MAX_CHATS = 50;

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
    const raw = readAgentStorage(CHATS_KEY);
    if (raw) return JSON.parse(raw) as Chat[];
    return [];
  } catch {
    console.error("Failed to load chats from localStorage");
    return [];
  }
}

let saveFailed = false;

/** Persist the session list. Returns false when the write failed (quota full,
 *  storage blocked) so a caller that cares can tell the user — history used to
 *  stop saving with nothing but a console line. */
export function saveChats(chats: Chat[], expectedScope?: string): boolean {
  try {
    // A blob URL dies with the page that made it, so persisting one leaves a
    // download chip that silently does nothing tomorrow. Paths survive; URLs
    // are dropped on the way to disk and simply aren't offered after a reload.
    const clean = chats.map((c) => ({
      ...c,
      turns: c.turns.map((t) => ({
        role: t.role,
        text: t.text,
        ...(t.files
          ? {
              files: t.files
                .map(({ name, path, videoJobId }) => ({ name, path, videoJobId }))
                .filter((f) => f.path || f.videoJobId),
            }
          : {}),
        ...(t.run
          ? {
              run: {
                plan: t.run.plan.map(({ step, status }) => ({ step, status })),
                actions: t.run.actions.map(({ id, name, status, detail }) => ({
                  id,
                  name,
                  status,
                  detail,
                })),
                outcome: t.run.outcome,
              },
            }
          : {}),
      })),
    }));
    // Newest sessions win when over the cap.
    const bounded = [...clean]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_CHATS);
    writeAgentStorage(CHATS_KEY, JSON.stringify(bounded), expectedScope);
    saveFailed = false;
    return true;
  } catch (e) {
    if (!saveFailed) {
      saveFailed = true; // once per incident — don't toast every turn
      console.error("Failed to save chats to localStorage", e);
      window.dispatchEvent(new CustomEvent("filey:chats:save-failed"));
    }
    return false;
  }
}

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
    return readAgentStorage(ACTIVE_KEY);
  } catch {
    console.error("Failed to get active chat ID from localStorage");
    return null;
  }
}
export function setActiveId(id: string | null): void {
  try {
    writeAgentStorage(ACTIVE_KEY, id);
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
