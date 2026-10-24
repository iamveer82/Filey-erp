/* Filey Agent client — the app's side of the agent runtime in agent/ (the Hermes fork).
 *
 * The agent owns the loop: model calls, memory, skills, scheduling, sub-agents, and its own
 * general tools (web, files, browser, terminal). The APP owns Filey ERP: every business action
 * the agent takes arrives here as a `filey.tool` request and runs through the same runTool the
 * in-app chat uses — so invoice math, numbering, posting, workspace scope, module access,
 * capability switches and approval prompts are exactly the app's. Nothing is re-implemented on
 * the agent side, which is what made the old remote paths drift (and fail to make invoices).
 *
 * Wire: newline-delimited JSON-RPC 2.0 (tui_gateway). Transports: the desktop sidecar's stdio
 * (relayed by Tauri) or a WebSocket to a hosted agent. */
import { TOOLS, runTool, type ConfirmFn } from "./aiTools";
import { taskComputerSession } from "./computerUse";
import type { AgentEvent } from "./agentHarness";
import { readAgentStorage, writeAgentStorage } from "./agentStorage";
import { toolsForRequest } from "./appMap";
import { APP_NAME_FOR } from "./fileyHermesTools";
import type { AiImage } from "./ai";

export interface AgentTransport {
  send(line: string): void | Promise<void>;
  /** Subscribe to inbound lines; returns an unsubscribe. */
  onLine(cb: (line: string) => void): () => void;
}

interface RpcFrame {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message?: string };
}

export interface GatewayEvent {
  type: string;
  session_id?: string;
  payload?: Record<string, unknown>;
}

/** What the app does when the agent asks it something (server→client requests). */
export interface AppRequestContext {
  /** Approval for sensitive Filey actions (and the agent's own risky commands, unless
   *  confirmCommand answers those). */
  confirm: ConfirmFn;
  /** Approval for the engine's own terminal and file commands, when it differs from confirm. */
  confirmCommand?: ConfirmFn;
  /** Messages the person typed while this turn runs: they steer it (Hermes /steer). */
  drainSteer?: () => string[];
  /** Steering the engine could not take (the turn was finishing): hand it back, never drop it. */
  returnSteer?: (texts: string[]) => void;
  isOwner: boolean;
  /** Current chat turn — scopes attachments and produced files to it. */
  turnId?: string;
  signal?: AbortSignal;
  agentId?: string;
}

const summary = (text: string) => {
  const first = text.split(/(?<=\.)\s/)[0] ?? text;
  return first.length > 140 ? `${first.slice(0, 137)}…` : first;
};

/** `filey.tool` catalog: names + purpose, filtered by words; or one tool's full schema. */
export function fileyToolCatalog(name?: string, query?: string): unknown {
  if (name) {
    const tool = TOOLS.find(t => t.name === name);
    if (!tool) {
      const near = TOOLS.filter(t => t.name.includes(name) || name.includes(t.name)).map(t => t.name).slice(0, 8);
      return { error: `Unknown Filey tool "${name}".`, did_you_mean: near };
    }
    return { name: tool.name, description: tool.description, parameters: tool.parameters,
      ...(tool.sensitive ? { needs_approval: true } : {}) };
  }
  // The app map knows how people ask (short phrases, Arabic: "rennox gave a deposit",
  // "سند قبض"); plain word overlap ranks the rest. All-words-must-match used to return
  // nothing for a natural phrase, so the agent concluded the action did not exist.
  const words = (query ?? "").toLowerCase().split(/\W+/).filter(word => word.length > 1);
  const mapped = new Set(query ? toolsForRequest(query) : []);
  const ranked = TOOLS.map(t => {
    const hay = `${t.name.replace(/_/g, " ")} ${t.description}`.toLowerCase();
    return { t, score: (mapped.has(t.name) ? 100 : 0) + words.filter(word => hay.includes(word)).length };
  }).filter(row => (!words.length && !mapped.size) || row.score > 0)
    .sort((a, b) => b.score - a.score);
  const tools = (words.length || mapped.size ? ranked.slice(0, 30) : ranked)
    .map(({ t }) => ({ name: t.name, purpose: summary(t.description), ...(t.sensitive ? { needs_approval: true } : {}) }));
  return { count: tools.length, tools, next: "Call filey_tools with name=<tool> for its parameters, then filey_run." };
}

/**
 * One desktop session per agent turn, shared by every `filey.tool` call.
 * The Python agent runs its own tools, so when it reaches for `computer_use`
 * the app must lend it the same session the in-app chat uses. The signal owns
 * the lifetime: aborting the turn stops access.
 */
const turnComputers = new WeakMap<AbortSignal, ReturnType<typeof taskComputerSession>>();
function turnComputer(signal?: AbortSignal) {
  if (!signal) return undefined;
  let session = turnComputers.get(signal);
  if (!session) {
    session = taskComputerSession(signal);
    turnComputers.set(signal, session);
  }
  return session;
}

/** Close this turn's desktop session. Abort also does this; a normal finish must too. */
export async function stopTurnComputer(signal?: AbortSignal): Promise<void> {
  if (!signal) return;
  const session = turnComputers.get(signal);
  turnComputers.delete(signal);
  await session?.stop().catch(() => {});
}

async function answerFileyTool(params: Record<string, unknown>, ctx: AppRequestContext): Promise<unknown> {
  const op = params.op;
  const name = typeof params.name === "string" ? params.name : undefined;
  const args = params.args && typeof params.args === "object" && !Array.isArray(params.args)
    ? params.args as Record<string, unknown> : {};
  if (op === "catalog") return fileyToolCatalog(name, typeof args.query === "string" ? args.query : undefined);
  if (op === "run" && name)
    return runTool(name, args, ctx.confirm, ctx.isOwner, ctx.turnId, ctx.signal, turnComputer(ctx.signal)?.get, ctx.agentId);
  return { error: `Unsupported filey.tool request: ${String(op)}` };
}

/** An error the engine answered with; `code` tells callers what to try next (4018: dispatch it). */
export class FileyAgentRpcError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
    this.name = "FileyAgentRpcError";
  }
}

export class FileyAgentClient {
  private seq = 0;
  private pending = new Map<string, { resolve(v: unknown): void; reject(e: Error): void }>();
  private listeners = new Set<(ev: GatewayEvent) => void>();
  private stop: () => void;
  /** Resolves on gateway.ready (after capabilities are announced). */
  readonly ready: Promise<void>;
  /** Requests from a session with no turn of its own: refuse every approval. */
  context: AppRequestContext = { confirm: () => false, isOwner: false };
  /** Each running turn's context, by engine session. The in-app chat, WhatsApp, Telegram and
   *  an automation can run at once; a tool call must be answered with ITS turn's approvals,
   *  owner status and signal, never with whichever turn started last. */
  readonly contexts = new Map<string, AppRequestContext>();
  private contextFor(params: Record<string, unknown>): AppRequestContext {
    return (typeof params.session_id === "string" && this.contexts.get(params.session_id)) || this.context;
  }

  constructor(private transport: AgentTransport) {
    let markReady!: () => void;
    this.ready = new Promise(resolve => { markReady = resolve; });
    this.stop = transport.onLine(line => {
      let frame: RpcFrame;
      try { frame = JSON.parse(line); } catch { return; }
      if (frame.method === "event") {
        const ev = frame.params as unknown as GatewayEvent;
        if (ev?.type === "gateway.ready") {
          // Announce that this client answers server→client requests (filey.tool, approval).
          void this.request("client.capabilities", { server_requests: true }).finally(markReady);
        }
        for (const cb of this.listeners) cb(ev);
      } else if (frame.method && frame.id !== undefined) {
        void this.answer(frame);
      } else if (frame.id !== undefined) {
        const waiter = this.pending.get(String(frame.id));
        if (!waiter) return;
        this.pending.delete(String(frame.id));
        if (frame.error) waiter.reject(new FileyAgentRpcError(frame.error.message || "Filey Agent request failed", frame.error.code));
        else waiter.resolve(frame.result);
      }
    });
  }

  request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = `c${++this.seq}`;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: v => resolve(v as T), reject });
      Promise.resolve(this.transport.send(JSON.stringify({ jsonrpc: "2.0", id, method, params })))
        .catch(e => { this.pending.delete(id); reject(e instanceof Error ? e : new Error(String(e))); });
    });
  }

  onEvent(cb: (ev: GatewayEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  close() {
    this.stop();
    for (const w of this.pending.values()) w.reject(new Error("Filey Agent disconnected"));
    this.pending.clear();
  }

  private reply(id: string | number, body: { result?: unknown; error?: { code: number; message: string } }) {
    return Promise.resolve(this.transport.send(JSON.stringify({ jsonrpc: "2.0", id, ...body }))).catch(() => {});
  }

  private async answer(frame: RpcFrame) {
    const params = frame.params ?? {};
    const id = frame.id as string | number;
    const ctx = this.contextFor(params);
    try {
      if (frame.method === "filey.tool") {
        const out = await answerFileyTool(params, ctx);
        return this.reply(id, { result: { value: JSON.stringify(out ?? null) } });
      }
      if (frame.method === "approval") {
        // The engine's own risky commands (terminal, files). A turn with nobody watching
        // (automations) refuses them: they are not Filey tools the review queue can replay.
        const what = String(params.description || params.command || params.tool_name || "an action");
        const ok = await (ctx.confirmCommand ?? ctx.confirm)(String(params.tool_name || "agent"), { action: what });
        return this.reply(id, { result: { choice: ok ? "once" : "deny" } });
      }
      // Window bridges belong to the agent's own desktop. Decline at once so the
      // gateway does not wait out the deadline. Any other request still gets a
      // response, which ends the wait instead of leaving the agent stuck.
      const windowOwned = frame.method === "preview.read" || frame.method === "preview.act" || frame.method === "terminal.read" || frame.method === "window.read" || frame.method === "tour";
      return this.reply(id, { error: { code: windowOwned ? 4404 : -32601, message: windowOwned ? "This window does not show that session." : `${frame.method} is not handled by the Filey app` } });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (frame.method === "filey.tool")
        return this.reply(id, { result: { value: JSON.stringify({ error: message, retry_safe: false }) } });
      return this.reply(id, { error: { code: -32000, message } });
    }
  }
}

/* ── Engine status ─────────────────────────────────────────────────────────
 * Filey Agent is the only agent on the desktop: there is no backup brain, so
 * the app says plainly what the engine is doing and restarts it when it dies. */
export type FileyAgentState = "off" | "installing" | "starting" | "ready" | "restarting" | "unavailable";
export interface FileyAgentStatus {
  state: FileyAgentState;
  message?: string;
  attempt?: number;
  /** While installing: 0–100 once the download size is known. */
  percent?: number;
}
export const FILEY_AGENT_STATUS_EVENT = "filey:agent-engine";
let status: FileyAgentStatus = { state: "off" };
export const fileyAgentStatus = (): FileyAgentStatus => status;
function setStatus(next: FileyAgentStatus) {
  status = next;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(FILEY_AGENT_STATUS_EVENT, { detail: next }));
}

/** Waits between restarts; after the last one the engine is reported unavailable. */
const RESTART_DELAYS_MS = [1000, 2000, 5000, 10_000, 30_000];
let restarts = 0;
let restartTimer: ReturnType<typeof setTimeout> | undefined;
let readySince = 0;

/* First use on an installed app: the engine is downloaded (signed with the app's release
 * key and checked before unpacking; see agent_engine.rs), then started. */
let installing: Promise<void> | undefined;
let installTried = false;
function installEngine(): Promise<void> {
  installing ??= (async () => {
    installTried = true;
    setStatus({ state: "installing", message: "Setting up Filey Agent on this computer…" });
    const [{ invoke }, { listen }] = await Promise.all([import("@tauri-apps/api/core"), import("@tauri-apps/api/event")]);
    const off = await listen<{ stage?: string; received?: number; total?: number | null }>("filey-agent-install", e => {
      const { stage, received = 0, total } = e.payload ?? {};
      const percent = total ? Math.min(100, Math.round((received / total) * 100)) : undefined;
      const message = stage === "verifying" ? "Checking the Filey Agent download…"
        : stage === "unpacking" ? "Installing Filey Agent…"
        : "Downloading Filey Agent…";
      setStatus({ state: "installing", message, ...(percent !== undefined ? { percent } : {}) });
    });
    try {
      await invoke("filey_agent_install");
      restarts = 0;
      await startFileyAgent();
    } catch (error) {
      setStatus({ state: "unavailable", message: error instanceof Error ? error.message : String(error) });
    } finally {
      off();
      installing = undefined;
    }
  })();
  return installing;
}

function scheduleRestart(reason: string) {
  if (restartTimer) return;
  // A run of good health earns a fresh set of retries.
  if (readySince && Date.now() - readySince > 60_000) restarts = 0;
  readySince = 0;
  if (/not installed/i.test(reason) && desktop() && !installTried) {
    void installEngine();
    return;
  }
  if (/not installed|starts only from the Filey app/i.test(reason) || restarts >= RESTART_DELAYS_MS.length) {
    setStatus({ state: "unavailable", message: reason });
    return;
  }
  const delay = RESTART_DELAYS_MS[restarts++];
  setStatus({ state: "restarting", message: reason, attempt: restarts });
  restartTimer = setTimeout(() => { restartTimer = undefined; void startFileyAgent(); }, delay);
}

/** The person pressed Retry: a fresh set of attempts (and a fresh install try), starting now. */
export function retryFileyAgent(): Promise<void> {
  if (installing) return installing;
  restarts = 0;
  installTried = false;
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = undefined;
  return startFileyAgent();
}

/** Why the engine stopped, from its last stderr lines. */
function exitReason(stderr: unknown): string {
  const lines = Array.isArray(stderr) ? stderr.filter((line): line is string => typeof line === "string" && !!line.trim()) : [];
  const refused = lines.find(line => /starts only from the Filey app/i.test(line));
  if (refused) return refused.trim();
  const last = lines.filter(line => !/^\s*(File |Traceback|\^)/.test(line)).pop();
  return last ? `Filey Agent stopped: ${last.trim().slice(0, 200)}` : "Filey Agent stopped unexpectedly.";
}

/* Desktop: the Tauri-supervised sidecar (src-tauri/src/modules/filey_agent.rs) over stdio.
 * The Tauri listeners are registered once for the page; each engine process gets a fresh
 * transport. Lines that arrive before the client subscribes are held, so gateway.ready is
 * never lost. */
const desktopSubs = new Set<(line: string) => void>();
let desktopEarly: string[] = [];
let desktopListening: Promise<void> | undefined;

function onEngineExit(info: { stderr?: unknown } | undefined) {
  connection = undefined;
  liveSessions.clear();
  const reason = exitReason(info?.stderr);
  // End any turn waiting on events: the stream turns this into its error.
  const dead = JSON.stringify({ jsonrpc: "2.0", method: "event", params: { type: "error", payload: { message: `${reason} Restarting it now; send your message again in a moment.` } } });
  desktopSubs.forEach(cb => cb(dead));
  desktopSubs.clear();
  desktopEarly = [];
  scheduleRestart(reason);
}

function listenDesktop(): Promise<void> {
  desktopListening ??= (async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const { listen } = await import("@tauri-apps/api/event");
    await listen<string>("filey-agent-line", e => desktopSubs.size ? desktopSubs.forEach(cb => cb(e.payload)) : desktopEarly.push(e.payload));
    await listen<{ stderr?: unknown }>("filey-agent-exit", e => onEngineExit(e.payload));
    // The agent's model is Filey AI on the user's own Coins: it authenticates as the signed-in user
    // with this token (read per request), so keep it current across Supabase refreshes.
    // The cloud client even in local mode: Coins belong to the Filey account, not the device data.
    const { supabase } = await import("./supabase");
    if (supabase) {
      const pushSession = (session: { access_token: string; expires_at?: number } | null) => session
        ? invoke("filey_agent_session", { accessToken: session.access_token, expiresAt: session.expires_at ?? 0 }).catch(() => {})
        : Promise.resolve();
      await pushSession((await supabase.auth.getSession()).data.session);
      supabase.auth.onAuthStateChange((_event, session) => { void pushSession(session); });
    }
  })().catch(error => { desktopListening = undefined; throw error; });
  return desktopListening;
}

export async function desktopAgentTransport(): Promise<AgentTransport> {
  await listenDesktop();
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("filey_agent_start");
  return {
    send: line => invoke("filey_agent_send", { line }),
    onLine: cb => {
      desktopSubs.add(cb);
      desktopEarly.splice(0).forEach(cb);
      return () => desktopSubs.delete(cb);
    },
  };
}

/** Web and phone: the hosted Filey Agent (tools/agent-host/host.py behind a Cloudflare tunnel).
 *  The first frame proves the Filey account; refreshed tokens follow so the model keeps billing
 *  the user's own Coins. Each user gets their own agent there. */
export const FILEY_AGENT_HOST_URL = "wss://agent.gofiley.com/ws";
const HOST_CLOSED: Record<number, string> = {
  4401: "This Filey account can't use the Filey Agent yet.",
  4403: "This Filey account can't use the Filey Agent yet.",
  4409: "The Filey Agent was opened in another window.",
  4429: "The Filey Agent is busy right now. Try again in a few minutes.",
};
export async function hostAgentTransport(url = FILEY_AGENT_HOST_URL): Promise<AgentTransport> {
  const { supabase } = await import("./supabase");
  const session = supabase && (await supabase.auth.getSession()).data.session;
  if (!supabase || !session) throw new Error("Sign in to your Filey account to use the Filey Agent.");
  const auth = (method: string, s: { access_token: string; expires_at?: number }) =>
    JSON.stringify({ jsonrpc: "2.0", method, params: { access_token: s.access_token, expires_at: s.expires_at ?? 0 } });
  const subs = new Set<(line: string) => void>();
  const early: string[] = [];
  const deliver = (line: string) => subs.size ? subs.forEach(cb => cb(line)) : early.push(line);
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => { ws.send(auth("filey.auth", session)); resolve(); };
    ws.onerror = () => reject(new Error("The Filey Agent is offline right now."));
  });
  ws.onmessage = e => deliver(String(e.data));
  const sub = supabase.auth.onAuthStateChange((_event, s) => {
    if (s && ws.readyState === WebSocket.OPEN) ws.send(auth("filey.session", s));
  });
  // Cloudflare closes a WebSocket that is silent for 100 s mid-way through a long turn.
  const ping = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ jsonrpc: "2.0", id: `ping${Date.now()}`, method: "gateway.ping" }));
  }, 30_000);
  let closed = "";
  ws.onclose = e => {
    clearInterval(ping);
    sub.data.subscription.unsubscribe();
    connection = undefined;
    liveSessions.clear();
    closed = HOST_CLOSED[e.code] ?? "The Filey Agent is offline right now.";
    // End any turn waiting on events: the stream turns this into its error.
    deliver(JSON.stringify({ jsonrpc: "2.0", method: "event", params: { type: "error", payload: { message: closed } } }));
  };
  return {
    send: line => {
      if (ws.readyState !== WebSocket.OPEN) throw new Error(closed || "The Filey Agent is offline right now.");
      ws.send(line);
    },
    onLine: cb => {
      subs.add(cb);
      early.splice(0).forEach(cb);
      return () => subs.delete(cb);
    },
  };
}

const desktop = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
/** Filey Agent (Hermes) is THE agent on the desktop app: every turn runs on it, with no
 *  backup brain. The web and phone app reach it through the owner's open computer
 *  (Filey Link); agent.gofiley.com was never deployed, so there is no hosted engine. */
export function fileyAgentEnabled(): boolean {
  return desktop();
}

/* ── The engine's model follows Settings → AI ────────────────────────────────
 * Filey AI on the person's Coins by default; their own provider and key when they chose
 * that. Without this a bring-your-own-key user would be charged Coins by the agent. */
async function syncEngineModel(): Promise<boolean> {
  const [{ creditChoice }, { getAiRequestConfig }, { invoke }] = await Promise.all([
    import("./aiCredits"), import("./ai"), import("@tauri-apps/api/core"),
  ]);
  let own: { baseUrl: string; model: string; apiKey: string; anthropic: boolean } | null = null;
  if (creditChoice().funding === "byok") {
    const cfg = await getAiRequestConfig().catch(() => null);
    if (cfg?.baseUrl && cfg.model) own = { baseUrl: cfg.baseUrl, model: cfg.model, apiKey: cfg.apiKey ?? "", anthropic: cfg.provider === "anthropic" };
  }
  return invoke<boolean>("filey_agent_model", { own });
}

/** A changed model applies on a fresh engine; restart it once no turn is running. */
let restartWhenIdle = false;
async function restartIfIdle(): Promise<void> {
  if (!restartWhenIdle) return;
  const client = connection ? await connection.catch(() => null) : null;
  if (!client) { restartWhenIdle = false; return; }
  if (client.contexts.size) return; // the last turn to finish calls this again
  restartWhenIdle = false;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("filey_agent_stop").catch(() => {}); // the exit event schedules the restart
}

let modelWatch = false;
function watchModelSettings() {
  if (modelWatch || typeof window === "undefined") return;
  modelWatch = true;
  const changed = () => {
    void syncEngineModel().then(updated => {
      if (!updated) return;
      restartWhenIdle = true;
      void restartIfIdle();
    }).catch(error => console.warn("Filey Agent model settings were not applied.", error));
  };
  void import("./ai").then(({ AI_CONFIG_EVENT }) => window.addEventListener(AI_CONFIG_EVENT, changed));
  void import("./aiCredits").then(({ AI_CREDITS_EVENT }) => window.addEventListener(AI_CREDITS_EVENT, changed));
}

/** Start the desktop engine and stay on the gateway so filey.tool and approval get an answer.
 *  A failure is reported through the engine status and retried; it never throws into startup. */
export function startFileyAgent(): Promise<void> {
  if (!desktop()) return Promise.resolve();
  setStatus({ state: restarts ? "restarting" : "starting", ...(restarts ? { attempt: restarts } : {}) });
  watchModelSettings();
  return syncEngineModel()
    .catch(error => console.warn("Filey Agent model settings were not applied.", error))
    .then(() => connect())
    .then(() => {
      readySince = Date.now();
      setStatus({ state: "ready" });
    })
    .catch(error => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("Filey Agent did not start.", message);
      scheduleRestart(message);
    });
}

let connection: Promise<FileyAgentClient> | undefined;
/** Chat id → the engine's runtime session id, for this engine process only. */
const liveSessions = new Map<string, Promise<string>>();
/** Chat id → the engine's stored session id: survives restarts of the engine and the app. */
const SESSIONS_KEY = "filey.agent.hermesSessions";

function storedSessions(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(readAgentStorage(SESSIONS_KEY) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, string> : {};
  } catch {
    return {};
  }
}

function rememberSession(chatId: string, storedId: string) {
  try {
    const all = { ...storedSessions(), [chatId]: storedId };
    const keys = Object.keys(all);
    for (const old of keys.slice(0, Math.max(0, keys.length - 300))) delete all[old];
    writeAgentStorage(SESSIONS_KEY, JSON.stringify(all));
  } catch {
    // Signed out mid-turn: the chat still works, it just starts fresh next launch.
  }
}

/** Start this chat over: the next turn gets a new engine session. */
export function forgetFileyAgentSession(chatId: string): void {
  liveSessions.delete(chatId);
  try {
    const all = storedSessions();
    if (!(chatId in all)) return;
    delete all[chatId];
    writeAgentStorage(SESSIONS_KEY, JSON.stringify(all));
  } catch {
    // Signed out: nothing stored to forget.
  }
}

/** The engine session for a Filey chat: resumed when it exists, created otherwise. */
function sessionFor(client: FileyAgentClient, chatId: string): Promise<string> {
  let live = liveSessions.get(chatId);
  if (!live) {
    live = (async () => {
      const stored = storedSessions()[chatId];
      if (stored) {
        try {
          const resumed = await client.request<{ session_id: string }>("session.resume",
            { session_id: stored, source: "filey", lazy: true, omit_messages: true });
          if (resumed?.session_id) return resumed.session_id;
        } catch {
          // Gone from the engine's store: start this chat fresh.
        }
      }
      const created = await client.request<{ session_id: string; stored_session_id?: string }>("session.create",
        { source: "filey", idempotency_key: chatId });
      if (created.stored_session_id) rememberSession(chatId, created.stored_session_id);
      return created.session_id;
    })();
    liveSessions.set(chatId, live);
    live.catch(() => liveSessions.delete(chatId));
  }
  return live;
}

/** Connects (or reuses the connection) and waits until the agent is ready for turns. */
export function connectFileyAgent(): Promise<FileyAgentClient> {
  return connect();
}

function connect(): Promise<FileyAgentClient> {
  connection ??= (async () => {
    const client = new FileyAgentClient(await (desktop() ? desktopAgentTransport() : hostAgentTransport()));
    // A sidecar that was already running sent gateway.ready to an earlier page load.
    await Promise.race([client.ready, new Promise(r => setTimeout(r, 4000))
      .then(() => client.request("client.capabilities", { server_requests: true }))]);
    return client;
  })().catch(e => { connection = undefined; throw e; });
  return connection;
}

/** The engine, started if needed. A turn sent while it restarts waits for it instead of
 *  failing at once; an engine reported unavailable fails with its reason. */
async function readyClient(signal?: AbortSignal): Promise<FileyAgentClient> {
  if (!desktop()) throw new Error("The Filey Agent runs in the Filey desktop app. Open Filey on your computer to chat with it.");
  if (status.state === "unavailable" || status.state === "off") void retryFileyAgent();
  if (status.state === "installing") throw new Error(`${status.message || "Filey Agent is being set up."} Send this again when it is ready.`);
  const deadline = Date.now() + 90_000;
  for (;;) {
    signal?.throwIfAborted();
    if (connection && status.state === "ready") return connection;
    if (status.state === "unavailable") throw new Error(status.message || "Filey Agent is unavailable on this computer.");
    if (Date.now() > deadline) throw new Error("Filey Agent is taking too long to start. Try again in a moment.");
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

/** One chat turn on Filey Agent: one engine session per Filey chat, kept across restarts.
 *  Photos ride with the message (the engine queues them for its next prompt). */
export async function* fileyAgentTurn(chatId: string, text: string, ctx: AppRequestContext, images: AiImage[] = []): AsyncGenerator<AgentEvent, string> {
  const client = await readyClient(ctx.signal);
  const sessionId = await sessionFor(client, chatId);
  for (const image of images) {
    ctx.signal?.throwIfAborted();
    await client.request("image.attach_bytes", {
      session_id: sessionId, content_base64: image.dataBase64, ext: image.mediaType.split("/")[1] ?? "png",
    });
  }
  return yield* fileyAgentStream(client, sessionId, text, ctx);
}

function unwrapFileyRun(p: Record<string, unknown>): { name: string; args: Record<string, unknown> } {
  const outer = (p.args && typeof p.args === "object" ? p.args : {}) as Record<string, unknown>;
  // Native Filey tools carry the engine's name for them (filey_computer → computer_use).
  if (p.name !== "filey_run" || typeof outer.name !== "string") return { name: APP_NAME_FOR[String(p.name)] ?? String(p.name), args: outer };
  const inner = typeof outer.args === "string" ? parse(outer.args) : outer.args;
  return { name: outer.name, args: inner && typeof inner === "object" && !Array.isArray(inner) ? inner as Record<string, unknown> : {} };
}

const parse = (value: unknown) => {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
};

/** One chat turn against a Filey Agent session, as the in-app chat's AgentEvent stream. */
export async function* fileyAgentStream(
  client: FileyAgentClient,
  sessionId: string,
  text: string,
  ctx: AppRequestContext,
): AsyncGenerator<AgentEvent, string> {
  const queue: GatewayEvent[] = [];
  let wake: (() => void) | undefined;
  const off = client.onEvent(ev => {
    if (ev.session_id && ev.session_id !== sessionId) return;
    queue.push(ev);
    wake?.();
  });
  if (client.contexts.has(sessionId)) {
    off();
    throw new Error("This conversation is still answering. Wait for it to finish, or stop it first.");
  }
  client.contexts.set(sessionId, ctx);
  const interrupt = () => { void client.request("session.interrupt", { session_id: sessionId }).catch(() => {}); };
  ctx.signal?.addEventListener("abort", interrupt, { once: true });
  // Steering: a message typed mid-run reaches the engine after its next tool call, exactly
  // as Hermes' /steer does. One that arrives as the turn finishes is handed back.
  let steering: Promise<void> | null = null;
  const steer = () => {
    if (steering || !ctx.drainSteer) return;
    const texts = ctx.drainSteer();
    if (!texts.length) return;
    steering = (async () => {
      const refused: string[] = [];
      for (const text of texts) {
        const result = await client.request<{ type?: string }>("command.dispatch", { session_id: sessionId, name: "steer", arg: text })
          .catch(() => null);
        if (result?.type !== "exec") refused.push(text);
      }
      if (refused.length) ctx.returnSteer?.(refused);
    })().finally(() => { steering = null; });
  };
  const steerTimer = ctx.drainSteer ? setInterval(steer, 500) : undefined;
  try {
    await client.request("prompt.submit", { session_id: sessionId, text });
    for (;;) {
      if (!queue.length) await new Promise<void>(resolve => { wake = resolve; });
      wake = undefined;
      const ev = queue.shift();
      if (!ev) continue;
      const p = ev.payload ?? {};
      if (ev.type === "message.delta" && typeof p.text === "string" && p.text) {
        // Token by token into the chat bubble as the engine writes it.
        yield { type: "delta", text: p.text };
      } else if (ev.type === "message.interim" && typeof p.text === "string" && p.text.trim()) {
        yield { type: "text", text: p.text };
      } else if (ev.type === "tool.start") {
        // filey_run carries the real business action; show that and ITS arguments, not the
        // wrapper's: the chat builds cards (show_ui, show_view…) from them.
        const { name, args } = unwrapFileyRun(p);
        yield { type: "tool_call", id: String(p.tool_id), name, args };
      } else if (ev.type === "tool.complete") {
        const { name } = unwrapFileyRun(p);
        yield { type: "tool_result", id: String(p.tool_id), name, result: parse(p.result ?? p.result_text) };
      } else if (ev.type === "error") {
        throw new Error(String(p.message || "Filey Agent error"));
      } else if (ev.type === "message.complete") {
        const reply = typeof p.text === "string" ? p.text : JSON.stringify(p.text ?? "");
        const reason = p.status === "interrupted" ? "stopped" : p.status === "error" ? "error" : "answered";
        yield { type: "done", text: reply, reason };
        return reply;
      }
    }
  } finally {
    if (steerTimer) clearInterval(steerTimer);
    await (steering as Promise<void> | null); // a steer in flight settles (or is handed back) first
    ctx.signal?.removeEventListener("abort", interrupt);
    if (client.contexts.get(sessionId) === ctx) client.contexts.delete(sessionId);
    off();
    await stopTurnComputer(ctx.signal);
    if (restartWhenIdle) void restartIfIdle();
  }
}

/* ── Slash commands (the terminal tab) ─────────────────────────────────────
 * The same commands Hermes' own terminal offers (/help, /model, /skills, /new, /retry,
 * skill commands…), run on this chat's engine session. */
export type FileyAgentSlashResult =
  /** Text to print. */
  | { kind: "output"; text: string }
  /** A prompt to send as the next turn (skills, /retry…); `display` is what to show for it. */
  | { kind: "send"; message: string; display?: string; notice?: string }
  /** Text to put back in the input for editing (/undo). */
  | { kind: "prefill"; message: string; notice?: string };

const splitCommand = (command: string) => {
  const [name = "", ...rest] = command.trim().replace(/^\//, "").split(/\s+/);
  return { name, arg: rest.join(" ") };
};

export async function fileyAgentSlash(chatId: string, command: string, signal?: AbortSignal): Promise<FileyAgentSlashResult> {
  const client = await readyClient(signal);
  const sessionId = await sessionFor(client, chatId);
  try {
    const result = await client.request<{ output?: unknown }>("slash.exec", { session_id: sessionId, command });
    return { kind: "output", text: typeof result?.output === "string" ? result.output : JSON.stringify(result?.output ?? "") };
  } catch (error) {
    // 4018: a skill, bundle, plugin or pending-input command — command.dispatch runs those.
    if (!(error instanceof FileyAgentRpcError) || error.code !== 4018) throw error;
  }
  let { name, arg } = splitCommand(command);
  for (let hop = 0; ; hop++) {
    const result = await client.request<Record<string, unknown>>("command.dispatch", { session_id: sessionId, name, arg });
    const text = (key: string) => (typeof result?.[key] === "string" ? result[key] as string : undefined);
    if (result?.type === "alias" && text("target") && hop < 3) {
      const target = splitCommand(text("target")!);
      name = target.name;
      arg = [target.arg, arg].filter(Boolean).join(" ");
      continue;
    }
    if ((result?.type === "send" || result?.type === "skill") && text("message"))
      return { kind: "send", message: text("message")!, display: text("display") ?? (text("name") ? `Running skill ${text("name")}` : undefined), notice: text("notice") };
    if (result?.type === "prefill" && text("message") !== undefined)
      return { kind: "prefill", message: text("message")!, notice: text("notice") };
    return { kind: "output", text: text("output") ?? text("notice") ?? "(no output)" };
  }
}

export interface FileyAgentCompletion { text: string; display: string; meta: string }

/** Slash-command suggestions while typing; empty unless the engine is ready. */
export async function fileyAgentComplete(chatId: string, text: string): Promise<FileyAgentCompletion[]> {
  if (!text.startsWith("/") || status.state !== "ready" || !connection) return [];
  const client = await connection;
  const live = liveSessions.get(chatId);
  const sessionId = live ? await live.catch(() => undefined) : undefined;
  const result = await client.request<{ items?: Partial<FileyAgentCompletion>[] }>("complete.slash", { text, ...(sessionId ? { session_id: sessionId } : {}) });
  return (result?.items ?? [])
    .filter(item => typeof item.text === "string")
    .slice(0, 10)
    .map(item => ({ text: item.text!, display: item.display || item.text!, meta: item.meta || "" }));
}

/** A whole turn's final reply, for callers that do not show progress (channels, automations). */
export async function fileyAgentReply(chatId: string, text: string, ctx: AppRequestContext): Promise<string> {
  // Each automation run starts clean, as Hermes' own cron jobs do: resuming one session
  // every run resent all earlier runs with each request (33K tokens and growing).
  if (/^(automation|proactive):/.test(chatId)) forgetFileyAgentSession(chatId);
  const stream = fileyAgentTurn(chatId, text, ctx);
  for (;;) {
    const step = await stream.next();
    if (step.done) return step.value;
  }
}
