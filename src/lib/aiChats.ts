/* Local store for the copilot's chat sessions. Each session keeps its own
 * rolling memory (last TURN_CAP turns). Persisted in this browser only. */

import { AGENT_STORAGE_EVENT, agentStorageScope, readAgentStorage, requireAgentStorageScope, writeAgentStorage } from "./agentStorage";

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  /** Files the agent produced on this turn, kept with the message that made
   *  them so they stay reachable instead of vanishing at the next question. */
  files?: { name: string; path?: string; url?: string; videoJobId?: string; mediaJobId?: string }[];
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
  /** A user-entered title, retained when new messages change the derived title. */
  customTitle?: string;
  turns: ChatTurn[];
  createdAt: number;
  updatedAt: number;
}

const CHATS_KEY = "filey.ai.chats";
const RECOVERY_KEY = "filey.ai.chats.recovery";
const ACTIVE_KEY = "filey.ai.active";
const SESSION_KEY = "filey.ai.session";
export const TURN_CAP = 30;
/** Total sessions kept. Chats used to be unbounded, so a long-lived install
 *  crept toward the ~5 MB localStorage ceiling and then silently stopped
 *  persisting — newest wins now, and history stays readable. */
export const MAX_CHATS = 50;

// Browser output cannot be persisted, but switching chats in this page should
// not discard it. Keep only the live URLs in memory, with their owning scope
// and exact message, and release them when history no longer references them.
type LiveTurn = { index: number; role: ChatTurn["role"]; text: string; files: NonNullable<ChatTurn["files"]> };
let liveScope: string | null = null;
let liveFiles = new Map<string, LiveTurn[]>();
function liveUrls(files: Map<string, LiveTurn[]>): Set<string> {
  return new Set([...files.values()].flatMap(turns => turns.flatMap(turn => turn.files.flatMap(file => file.url ? [file.url] : []))));
}
function replaceLiveFiles(next: Map<string, LiveTurn[]>): void {
  const retained = liveUrls(next);
  for (const url of liveUrls(liveFiles)) if (!retained.has(url)) URL.revokeObjectURL?.(url);
  liveFiles = next;
}
function syncLiveScope(scope = agentStorageScope()): void {
  if (scope === liveScope) return;
  replaceLiveFiles(new Map());
  liveScope = scope;
}

if (typeof window !== "undefined") {
  // Account changes may go A → B → A before chat is read again. Revoke on the
  // transition itself, so a former workspace's private outputs cannot survive.
  for (const event of [AGENT_STORAGE_EVENT, "filey:workspace-changed", "filey:workspace-transition", "storage"])
    window.addEventListener(event, () => syncLiveScope());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasControlCharacters(value: string): boolean {
  return [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

function localFilePath(value: unknown): string | undefined {
  if (typeof value !== "string" || hasControlCharacters(value)) return;
  if (/^[a-z]:[\\/]/i.test(value)) return value;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  if (!value.startsWith("file:")) return;
  try {
    const uri = new URL(value);
    const path = decodeURIComponent(uri.pathname);
    if (uri.protocol === "file:" && !uri.hostname && !uri.search && !uri.hash
      && path.startsWith("/") && !path.startsWith("//") && !path.includes("\\") && !hasControlCharacters(path)) return value;
  } catch { /* malformed file URI */ }
}

function jobId(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,255}$/i.test(value) ? value : undefined;
}

function savedFiles(value: unknown): NonNullable<ChatTurn["files"]> {
  if (!Array.isArray(value)) return [];
  return value.flatMap(file => {
    if (!isRecord(file) || typeof file.name !== "string" || !file.name.trim()) return [];
    const path = localFilePath(file.path);
    const videoJobId = jobId(file.videoJobId);
    const mediaJobId = jobId(file.mediaJobId);
    // Disk-stored URLs are never usable browser outputs. Only our in-memory
    // map may restore a blob URL belonging to this workspace and exact turn.
    return path || videoJobId || mediaJobId ? [{ name: file.name,
      ...(path ? { path } : {}), ...(videoJobId ? { videoJobId } : {}), ...(mediaJobId ? { mediaJobId } : {}) }] : [];
  });
}

function savedRun(value: unknown): ChatTurn["run"] {
  if (!isRecord(value)) return;
  const plan: NonNullable<ChatTurn["run"]>["plan"] = [];
  const actions: NonNullable<ChatTurn["run"]>["actions"] = [];
  if (Array.isArray(value.plan)) for (const entry of value.plan) {
    if (isRecord(entry) && typeof entry.step === "string" && typeof entry.status === "string"
      && ["pending", "in_progress", "completed", "blocked"].includes(entry.status))
      plan.push({ step: entry.step, status: entry.status as (typeof plan)[number]["status"] });
  }
  if (Array.isArray(value.actions)) for (const entry of value.actions) {
    if (isRecord(entry) && typeof entry.id === "string" && typeof entry.name === "string" && typeof entry.status === "string"
      && ["running", "completed", "failed", "waiting"].includes(entry.status))
      actions.push({ id: entry.id, name: entry.name, status: entry.status as (typeof actions)[number]["status"],
        ...(typeof entry.detail === "string" ? { detail: entry.detail } : {}) });
  }
  return { plan, actions, ...(typeof value.outcome === "string" ? { outcome: value.outcome } : {}) };
}

function parseChats(value: unknown): { chats: Chat[]; damaged: boolean } {
  if (!Array.isArray(value)) return { chats: [], damaged: true };
  const chats: Chat[] = [];
  const ids = new Set<string>();
  let damaged = false;
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id.trim() || ids.has(entry.id)
      || typeof entry.title !== "string" || !Array.isArray(entry.turns)
      || typeof entry.createdAt !== "number" || !Number.isFinite(entry.createdAt) || entry.createdAt < 0
      || typeof entry.updatedAt !== "number" || !Number.isFinite(entry.updatedAt) || entry.updatedAt < 0) {
      damaged = true;
      continue;
    }
    const turns: ChatTurn[] = [];
    for (const turn of entry.turns) {
      if (!isRecord(turn) || (turn.role !== "user" && turn.role !== "assistant") || typeof turn.text !== "string") {
        damaged = true;
        continue;
      }
      const run = savedRun(turn.run);
      turns.push({ role: turn.role, text: turn.text,
        ...(turn.files !== undefined ? { files: savedFiles(turn.files) } : {}), ...(run ? { run } : {}) });
    }
    const customTitle = typeof entry.customTitle === "string" ? entry.customTitle.trim().slice(0, 120).trim() : "";
    chats.push({ id: entry.id, title: customTitle || entry.title.trim() || deriveTitle(turns),
      ...(customTitle ? { customTitle } : {}), turns, createdAt: entry.createdAt, updatedAt: entry.updatedAt });
    ids.add(entry.id);
  }
  return { chats, damaged };
}

function parseHistory(raw: string | null): ReturnType<typeof parseChats> {
  if (raw === null) return { chats: [], damaged: false };
  try { return parseChats(JSON.parse(raw)); }
  catch { return { chats: [], damaged: true }; }
}

function historyKey(scope: string): string {
  return `${CHATS_KEY}:${encodeURIComponent(scope)}`;
}

/** A read-only recovery signal, including storage that cannot safely be read. */
export function chatHistoryNeedsRecovery(): boolean {
  try {
    const scope = agentStorageScope();
    return scope ? parseHistory(localStorage.getItem(historyKey(scope))).damaged : false;
  } catch {
    return true;
  }
}

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
    const scope = agentStorageScope();
    syncLiveScope(scope);
    if (!scope) return [];
    return parseHistory(localStorage.getItem(historyKey(scope))).chats.map(chat => ({
      ...chat,
      turns: chat.turns.map((turn, index) => {
        const live = liveFiles.get(chat.id)?.find(saved => saved.index === index && saved.role === turn.role && saved.text === turn.text);
        return live ? { ...turn, files: [...(turn.files ?? []), ...live.files] } : turn;
      }),
    }));
  } catch {
    console.error("Failed to load chats from localStorage");
    return [];
  }
}

let saveFailed = false;

function reportSaveFailure(): false {
  if (!saveFailed) {
    saveFailed = true; // once per incident — don't toast every turn
    // JSON/storage errors may include the private source. Never log them.
    console.error("Failed to save chats to localStorage");
    window.dispatchEvent(new CustomEvent("filey:chats:save-failed"));
  }
  return false;
}

/** Persist the session list. Returns false when the write failed (quota full,
 *  storage blocked) so a caller that cares can tell the user — history used to
 *  stop saving with nothing but a console line. */
export function saveChats(chats: Chat[], expectedScope?: string): boolean {
  try {
    const scope = requireAgentStorageScope(expectedScope);
    syncLiveScope(scope);
    // A failed read or malformed source is not an empty history. Keep the
    // exact original until the user explicitly chooses recovery.
    if (parseHistory(localStorage.getItem(historyKey(scope))).damaged) return reportSaveFailure();
    const parsed = parseChats(chats);
    if (parsed.damaged) return reportSaveFailure();
    // Bound live files and persisted sessions in the same order.
    const bounded = [...chats].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CHATS);
    // A blob URL dies with the page that made it, so persisting one leaves a
    // download chip that silently does nothing tomorrow. Paths survive; URLs
    // are dropped on the way to disk and simply aren't offered after a reload.
    const clean = parsed.chats.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CHATS);
    const next = new Map<string, LiveTurn[]>();
    for (const chat of bounded) {
      const turns = chat.turns.flatMap((turn, index) => {
        const files = Array.isArray(turn.files) ? turn.files.filter(file => isRecord(file)
          && typeof file.name === "string" && file.name.trim() && typeof file.url === "string" && file.url.startsWith("blob:"))
          .map(file => ({ ...file })) : [];
        return files.length ? [{ index, role: turn.role, text: turn.text, files }] : [];
      });
      if (turns.length) next.set(chat.id, turns);
    }
    writeAgentStorage(CHATS_KEY, JSON.stringify(clean), scope);
    replaceLiveFiles(next);
    saveFailed = false;
    return true;
  } catch {
    return reportSaveFailure();
  }
}

/** Explicit recovery only: keep the exact original on this device before
 * replacing damaged records with their readable content. Never silently
 * replace a different recovery backup. */
export function repairChatHistory(expectedScope?: string): boolean {
  try {
    const scope = requireAgentStorageScope(expectedScope);
    syncLiveScope(scope);
    const raw = localStorage.getItem(historyKey(scope));
    const parsed = parseHistory(raw);
    if (!parsed.damaged || raw === null) {
      saveFailed = false;
      return true;
    }
    const backupKey = `${RECOVERY_KEY}:${encodeURIComponent(scope)}`;
    const backup = localStorage.getItem(backupKey);
    if (backup !== null && backup !== raw) return reportSaveFailure();
    if (backup === null) localStorage.setItem(backupKey, raw);
    writeAgentStorage(CHATS_KEY, JSON.stringify(parsed.chats), scope);
    saveFailed = false;
    return true;
  } catch {
    return reportSaveFailure();
  }
}

/**
 * The chat to open, given where in the app's life we are.
 *
 * A new browser/webview session starts clean; remounting the chat in the same
 * session restores its current conversation. Normal section navigation keeps
 * the live chat mounted so its request, attachments and unfinished draft survive.
 *
 * sessionStorage draws that line for free: the webview clears it when the app
 * closes, while the chats themselves live in localStorage and survive. So
 * history keeps everything; only this session's pointer resets. The pointer is
 * scoped to the account, organization and storage mode, like the history.
 */
export function resolveOpeningChat(): Chat {
  const scope = agentStorageScope();
  const key = scope ? `${SESSION_KEY}:${encodeURIComponent(scope)}` : null;
  let active: string | null = null;
  try { if (key) active = sessionStorage.getItem(key); } catch { /* storage may be blocked */ }
  const saved = active ? loadChats().find(chat => chat.id === active) : undefined;
  if (saved) return saved;
  const chat = newChat();
  try { if (key) sessionStorage.setItem(key, chat.id); } catch { /* the mounted chat still retains state */ }
  return chat;
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
    const scope = requireAgentStorageScope();
    writeAgentStorage(ACTIVE_KEY, id, scope);
    const key = `${SESSION_KEY}:${encodeURIComponent(scope)}`;
    try {
      if (id) sessionStorage.setItem(key, id);
      else sessionStorage.removeItem(key);
    } catch { /* session storage must not prevent saving history */ }
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
