import { invoke } from "@tauri-apps/api/core";
import { getCacheScope } from "./api";
import { agentStorageScope, AGENT_STORAGE_EVENT, readAgentStorage, writeAgentStorage } from "./agentStorage";
import { hasCredential, readCredential, saveCredential } from "./credentialStore";
import { requireModuleAccess } from "./moduleAccess";
import { runRemoteAgentTurn, clearRemoteAgentConversation, clearRemoteAgentTurns } from "./remoteAgentTurn";
import { stopAgentComputer } from "./agentComputer";
import { aiReady } from "./ai";

export const TELEGRAM_EVENT = "filey:telegram-agent";
const KEY = "filey.telegram_agent";
const TOKEN = "telegram.bot_token";
const MAX_AGE = 5 * 60_000;
const PAIR_TTL = 10 * 60_000;
const desktop = () => "__TAURI_INTERNALS__" in window;
type Config = { botId: string; username: string; ownerId?: string; offset: number; enabled: boolean };
export type TelegramState = { state: "disconnected" | "connecting" | "pairing" | "connected" | "error"; username?: string; ownerId?: string; pairCode?: string; error?: string };
type TelegramMessage = { message_id: number; date: number; chat: { id: number; type: string }; from?: { id: number; is_bot?: boolean }; text?: string; caption?: string; document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number }; photo?: { file_id: string; file_size?: number }[] };
type TelegramUpdate = { update_id: number; message?: TelegramMessage };
let state: TelegramState = { state: "disconnected" };
let epoch = 0;
let taskEpoch = 0;
let polling: AbortController | null = null;
let activeTask: AbortController | null = null;
let booted = false;
let scope: string | null = null;
let runtimeBotId: string | null = null;
let pairExpires = 0;
let queue: Promise<void> = Promise.resolve();
let queued = 0;

function config(): Config | null {
  try {
    const c = JSON.parse(readAgentStorage(KEY) || "null");
    return c && /^\d+$/.test(c.botId) && /^[A-Za-z0-9_]{5,32}$/.test(c.username) && Number.isSafeInteger(c.offset) && c.offset >= 0 && typeof c.enabled === "boolean" && (!c.ownerId || /^\d+$/.test(c.ownerId)) ? c : null;
  } catch { return null; }
}
function emit(next: TelegramState) { state = next; window.dispatchEvent(new Event(TELEGRAM_EVENT)); }
export const telegramState = () => state;
export const telegramSaved = () => desktop() && !!config() && hasCredential(TOKEN);
export function onTelegramState(cb: () => void) { window.addEventListener(TELEGRAM_EVENT, cb); return () => window.removeEventListener(TELEGRAM_EVENT, cb); }
const current = (generation: number, expected: string) => generation === epoch && expected === agentStorageScope() && !polling?.signal.aborted;
function stopped() { return new DOMException("Telegram stopped", "AbortError"); }
async function request<T>(method: string, payload: Record<string, unknown>, generation: number, expected: string, taskSignal?: AbortSignal): Promise<T> {
  if (!current(generation, expected) || taskSignal?.aborted) throw stopped();
  const credentialScope = getCacheScope();
  if (!credentialScope) throw stopped();
  const signal = polling?.signal;
  const result = await new Promise<T>((resolve, reject) => {
    const abort = () => { cleanup(); reject(stopped()); };
    const cleanup = () => { signal?.removeEventListener("abort", abort); taskSignal?.removeEventListener("abort", abort); };
    signal?.addEventListener("abort", abort, { once: true });
    taskSignal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted || taskSignal?.aborted) { abort(); return; }
    void invoke<T>("telegram_request", { scope: credentialScope, method, payload, expectedBotId: method === "getMe" ? null : runtimeBotId }).then(
      result => { cleanup(); resolve(result); }, error => { cleanup(); reject(error); }
    );
  });
  if (!current(generation, expected) || credentialScope !== getCacheScope() || taskSignal?.aborted) throw stopped();
  return result;
}
// Retry reads on the next polling iteration, never an ambiguous outbound send.
async function send(chat: string, text: string, generation: number, expected: string, taskSignal?: AbortSignal) {
  const parts: string[] = [];
  let part = "";
  for (const char of text.trim() || "This task produced no answer. Check Filey before retrying.") {
    if (part.length + char.length > 4000) { parts.push(part); part = ""; }
    part += char;
  }
  if (part) parts.push(part);
  for (const text of parts) {
    const result = await request<{ message_id?: number }>("sendMessage", { chat_id: chat, text, link_preview_options: { is_disabled: true } }, generation, expected, taskSignal);
    if (!Number.isSafeInteger(result?.message_id) || result.message_id! <= 0) throw new Error("Telegram did not confirm the reply.");
  }
}
export function isPrivateOwner(message: TelegramMessage, owner: string): boolean {
  return message.chat?.type === "private" && !message.from?.is_bot && Number.isSafeInteger(message.from?.id) && String(message.from?.id) === owner && String(message.chat.id) === owner;
}
function cancelTasks() { taskEpoch++; activeTask?.abort(); clearRemoteAgentTurns(scope ?? undefined, "telegram"); }
function stopRuntime() {
  const owner = state.ownerId;
  epoch++; polling?.abort(); polling = null; cancelTasks(); pairExpires = 0;
  runtimeBotId = null;
  if (owner) void stopAgentComputer(`telegram:${owner}`).catch(() => {});
  emit({ state: "disconnected" });
}
export async function disconnectTelegram(remove = false) {
  const expected = agentStorageScope();
  stopRuntime();
  const saved = config();
  if (saved && expected) writeAgentStorage(KEY, JSON.stringify({ ...saved, enabled: false }), expected);
  if (remove) {
    await saveCredential(TOKEN, null);
    if (expected !== agentStorageScope()) throw stopped();
    writeAgentStorage(KEY, null, expected ?? undefined);
  }
}

export async function connectTelegram(token?: string): Promise<TelegramState> {
  if (!desktop()) throw new Error("Telegram agent tasks run in the installed Filey desktop app.");
  const expected = agentStorageScope();
  if (!expected) throw new Error("Sign in to Filey before connecting Telegram.");
  await requireModuleAccess("integrations", true);
  if (expected !== agentStorageScope()) throw stopped();
  stopRuntime();
  scope = expected;
  polling = new AbortController();
  const generation = epoch;
  let previousToken: string | null = null;
  let replacedToken = false;
  emit({ state: "connecting" });
  try {
    if (token !== undefined) {
      if (!/^\d{5,20}:[A-Za-z0-9_-]{20,128}$/.test(token.trim())) throw new Error("Enter the bot token provided by Telegram BotFather.");
      previousToken = await readCredential(TOKEN);
      if (!current(generation, expected)) throw stopped();
      await saveCredential(TOKEN, token.trim());
      replacedToken = true;
      if (!current(generation, expected)) throw stopped();
    }
    const bot = await request<{ id: number; username: string; is_bot: boolean }>("getMe", {}, generation, expected);
    if (!bot.is_bot || !Number.isSafeInteger(bot.id) || !/^[A-Za-z0-9_]{5,32}$/.test(bot.username)) throw new Error("Telegram did not return a valid bot.");
    runtimeBotId = String(bot.id);
    // Acquire ownership before reading/advancing the provider cursor or saving
    // pairing state. A second window must not consume the first one's backlog.
    if (!navigator.locks) throw new Error("This desktop runtime cannot safely lock a Telegram connection. Update Filey and try again.");
    const locked = await new Promise<boolean>((resolve, reject) => {
      void navigator.locks.request(`filey.telegram:${bot.id}`, { ifAvailable: true }, async lock => {
        if (!lock || !current(generation, expected)) { resolve(false); return; }
        const signal = polling!.signal;
        const held = new Promise<void>(release => {
          const stopped = () => { signal.removeEventListener("abort", stopped); release(); };
          signal.addEventListener("abort", stopped, { once: true });
          if (signal.aborted) stopped();
        });
        resolve(true);
        await held;
      }).catch(reject);
    });
    if (!current(generation, expected)) throw stopped();
    if (!locked) throw new Error("This bot is running in another Filey window. Disconnect it there before reconnecting here.");
    const webhook = await request<{ url: string }>("getWebhookInfo", {}, generation, expected);
    if (typeof webhook.url !== "string" || webhook.url) throw new Error("This bot is connected to another service. Use a dedicated Filey bot from BotFather, or disconnect its existing webhook first.");
    const previous = config();
    const c: Config = previous?.botId === String(bot.id) && token === undefined ? { ...previous, enabled: true } : { botId: String(bot.id), username: bot.username, offset: 0, enabled: true };
    // New connection starts after the old provider backlog. Never replay old
    // commands as fresh requests from a newly paired owner.
    if (!c.offset) {
      const tail = await request<TelegramUpdate[]>("getUpdates", { offset: -1, timeout: 0 }, generation, expected);
      if (!Array.isArray(tail)) throw new Error("Could not check the Telegram message queue.");
      c.offset = tail.reduce((next, u) => Number.isSafeInteger(u.update_id) ? Math.max(next, u.update_id + 1) : next, 0);
    }
    writeAgentStorage(KEY, JSON.stringify(c), expected);
    const code = c.ownerId ? undefined : Array.from(crypto.getRandomValues(new Uint8Array(10)), b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    pairExpires = Date.now() + PAIR_TTL;
    emit({ state: c.ownerId ? "connected" : "pairing", username: c.username, ownerId: c.ownerId, pairCode: code });
    void poll(generation, expected).catch(() => { if (current(generation, expected)) emit({ ...state, state: "error", error: "Telegram stopped. Reconnect to continue." }); });
    return state;
  } catch (error) {
    if (generation === epoch && expected === agentStorageScope()) {
      if (replacedToken) await saveCredential(TOKEN, previousToken).catch(() => {});
      if (generation !== epoch || expected !== agentStorageScope()) throw stopped();
      polling?.abort();
      emit({ state: "error", error: error instanceof Error && !/bot\d+:|https?:/i.test(error.message) ? error.message : "Telegram could not connect. Check the bot token and try again." });
    }
    throw error;
  }
}

async function poll(generation: number, expected: string) {
  while (current(generation, expected)) {
    try {
      const c = config();
      if (!c?.enabled) return;
      const updates = await request<TelegramUpdate[]>("getUpdates", { offset: c.offset }, generation, expected);
      if (!Array.isArray(updates)) throw new Error("Invalid Telegram updates");
      if (c.ownerId) emit({ state: "connected", username: c.username, ownerId: c.ownerId });
      for (const update of updates) {
        if (!current(generation, expected)) return;
        if (!Number.isSafeInteger(update.update_id) || update.update_id < c.offset) continue;
        // Claim locally before any write. A crash or ambiguous send is never
        // retried as another invoice/customer/payment operation.
        c.offset = update.update_id + 1;
        writeAgentStorage(KEY, JSON.stringify(c), expected);
        const message = update.message;
        if (!message || !Number.isSafeInteger(message.date) || Date.now() - message.date * 1000 > MAX_AGE || message.date * 1000 > Date.now() + 60_000) continue;
        if (!c.ownerId) {
          if (Date.now() > pairExpires) { emit({ ...state, state: "error", pairCode: undefined, error: "Pairing expired. Reconnect to get a new code." }); continue; }
          if (!state.pairCode || message.text?.trim() !== `PAIR ${state.pairCode}` || !message.from || !isPrivateOwner(message, String(message.from.id))) continue;
          c.ownerId = String(message.from.id);
          writeAgentStorage(KEY, JSON.stringify(c), expected);
          emit({ state: "connected", username: c.username, ownerId: c.ownerId });
          await send(c.ownerId, "Filey is connected to your private chat. Send a task, or use /help, /status, /stop and /new. Keep Filey desktop open.", generation, expected);
          continue;
        }
        if (!isPrivateOwner(message, c.ownerId)) continue;
        const command = message.text?.trim().toLowerCase();
        if (command && ["/stop", "/new", "/help", "/status"].includes(command)) {
          let stopWarning = "";
          if (command === "/stop" || command === "/new") {
            cancelTasks();
            try { await stopAgentComputer(`telegram:${c.ownerId}`); }
            catch { stopWarning = " The browser did not confirm it stopped; open Filey and close its tabs."; }
            if (!current(generation, expected)) return;
          }
          if (command === "/new") clearRemoteAgentConversation(expected, "telegram", c.ownerId);
          await send(c.ownerId, command === "/help" ? "Ask me to find records, draft or revise an invoice, export a PDF, or process an attached file. Enabled Filey tools and your workspace role apply. Sensitive actions need one exact YES approval. /stop cancels tasks; /new also starts a fresh conversation." : command === "/status" ? `Connected to Filey desktop. ${activeTask ? "A task is running." : aiReady() ? "Ready for a task." : "Connect a model in Filey Settings → AI Assistant first."}` : `Stopped. A tool already in progress may have finished; check Filey before repeating an action.${stopWarning}`, generation, expected);
          continue;
        }
        const acceptedAt = Date.now();
        const taskGeneration = taskEpoch;
        if (queued >= 5) { await send(c.ownerId, "Your task queue is full. Let the current tasks finish, or send /stop and try again.", generation, expected); continue; }
        queued++;
        if (queued > 1) void send(c.ownerId, "Queued. I’ll work on this after the current task. Send /stop to cancel pending work.", generation, expected).catch(() => {
          if (current(generation, expected)) emit({ ...state, state: "error", error: "A queued-task receipt was not confirmed. The task remains queued; check Filey before sending it again." });
        });
        queue = queue.catch(() => {}).then(async () => {
          if (!current(generation, expected) || taskGeneration !== taskEpoch) return;
          if (Date.now() - acceptedAt > MAX_AGE) { await send(c.ownerId!, "This queued task expired. Send it again if you still want it done.", generation, expected); return; }
          await execute(message, c.ownerId!, generation, taskGeneration, expected);
        }).catch(() => { if (current(generation, expected)) emit({ ...state, state: "error", error: "A task reply was not confirmed. Check Telegram and Filey before retrying an action." }); }).finally(() => { queued--; });
      }
    } catch {
      if (!current(generation, expected)) return;
      emit({ ...state, state: "error", error: "Telegram could not receive messages. Checking the connection again…" });
      await new Promise<void>(resolve => {
        const signal = polling?.signal;
        const done = () => { clearTimeout(timeout); signal?.removeEventListener("abort", done); resolve(); };
        const timeout = setTimeout(done, 5000);
        signal?.addEventListener("abort", done, { once: true });
        if (signal?.aborted) done();
      });
    }
  }
}

async function execute(message: TelegramMessage, owner: string, generation: number, taskGeneration: number, expected: string) {
  const controller = new AbortController();
  activeTask = controller;
  const valid = () => current(generation, expected) && taskGeneration === taskEpoch && !controller.signal.aborted;
  const deadline = Date.now() + 200_000;
  const timeout = setTimeout(() => controller.abort(), 200_000);
  let typing = false;
  const pulse = async () => { if (!valid() || typing) return; typing = true; try { await request("sendChatAction", { chat_id: owner, action: "typing" }, generation, expected, controller.signal); } catch { /* Activity is best effort; final output is checked. */ } finally { typing = false; } };
  void pulse();
  const activity = setInterval(() => void pulse(), 4000);
  try {
    await requireModuleAccess("integrations", true);
    if (!valid()) return;
    if (!aiReady()) { await send(owner, "Connect a model in Filey Settings → AI Assistant first, then send your task again.", generation, expected, controller.signal); return; }
    const doc = message.document ?? message.photo?.slice(-1).map(p => ({ ...p, file_name: "telegram-photo.jpg", mime_type: "image/jpeg" }))[0];
    const attachments: File[] = [];
    if (doc) {
      if (doc.file_size != null && doc.file_size > 12 * 1024 * 1024) { await send(owner, "Send a file smaller than 12 MB.", generation, expected); return; }
      const file = await request<{ b64: string }>("downloadFile", { file_id: doc.file_id }, generation, expected, controller.signal);
      if (!valid()) return;
      if (typeof file.b64 !== "string" || file.b64.length > 16 * 1024 * 1024) throw new Error("Invalid attachment");
      const bytes = Uint8Array.from(atob(file.b64), c => c.charCodeAt(0));
      // eslint-disable-next-line no-control-regex -- Provider filenames are untrusted.
      const name = (doc.file_name || "telegram-file").split(/[\\/]/).pop()!.replace(/[\x00-\x1f]/g, "").slice(0, 160);
      attachments.push(new File([bytes], name, { type: doc.mime_type || "application/octet-stream" }));
    }
    const text = message.text || message.caption || (attachments.length ? "Describe the attached file." : "");
    if (!text) { await send(owner, "Send a text task, photo or document. Voice and other Telegram message types are not supported yet.", generation, expected); return; }
    const result = await runRemoteAgentTurn({ scope: expected, channel: "telegram", conversationId: owner, text, attachments, signal: controller.signal, deadline, isCurrent: valid });
    if (!valid()) return;
    await requireModuleAccess("integrations", true);
    if (!valid()) return;
    const deliveries: string[] = [];
    const seen = new Set<string>();
    for (const file of result.files) {
      if (!valid()) return;
      if (!file.path || seen.has(file.path)) { if (!file.path) deliveries.push(`${file.name}: open Filey to review this output.`); continue; }
      seen.add(file.path);
      if (file.telegramRecipients?.includes(owner)) continue;
      if (Date.now() >= deadline - 10_000) { deliveries.push(`${file.name}: saved locally; task time limit reached before sending.`); continue; }
      try {
        const receipt = await request<{ message_id?: number }>("sendDocument", { chat_id: owner, path: file.path, filename: file.name }, generation, expected, controller.signal);
        if (!Number.isSafeInteger(receipt?.message_id) || receipt.message_id! <= 0) throw new Error("Telegram did not confirm the document.");
        (file.telegramRecipients ??= []).push(owner);
        deliveries.push(`${file.name}: accepted by Telegram.`);
      }
      catch { deliveries.push(`${file.name}: delivery not confirmed. Check Telegram before retrying; the local file is preserved.`); }
    }
    const reply = result.text + (deliveries.length ? `\n\nFILES\n${deliveries.join("\n")}` : "");
    if (!valid()) return;
    await send(owner, reply, generation, expected, controller.signal);
    if (valid()) result.delivered(reply);
  } catch {
    if (current(generation, expected) && taskGeneration === taskEpoch) await send(owner, controller.signal.aborted ? "The task reached its time limit and stopped. Check Filey before repeating an action." : "This task could not finish. Check Filey before retrying an action.", generation, expected);
  } finally { clearInterval(activity); clearTimeout(timeout); if (activeTask === controller) activeTask = null; }
}

export function startTelegramAgent() {
  if (booted || !desktop()) return;
  booted = true;
  scope = agentStorageScope();
  window.addEventListener(AGENT_STORAGE_EVENT, () => { if (scope !== agentStorageScope()) { stopRuntime(); scope = agentStorageScope(); } });
  window.addEventListener("filey:workspace-changed", () => { if (scope !== agentStorageScope()) { stopRuntime(); scope = agentStorageScope(); } });
  window.addEventListener("filey:stop-agent-browser", cancelTasks);
  // Explicit reconnect after sign-in or changing workspace avoids silently
  // handing an old owner chat control of a different live workspace.
}
