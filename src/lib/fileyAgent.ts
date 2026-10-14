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
import type { AgentEvent } from "./agentHarness";

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
  /** Approval for sensitive Filey actions and for the agent's own risky commands. */
  confirm: ConfirmFn;
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
  const words = (query ?? "").toLowerCase().split(/\W+/).filter(Boolean);
  const tools = TOOLS.filter(t => {
    const hay = `${t.name} ${t.description}`.toLowerCase();
    return words.every(w => hay.includes(w));
  }).map(t => ({ name: t.name, purpose: summary(t.description), ...(t.sensitive ? { needs_approval: true } : {}) }));
  return { count: tools.length, tools, next: "Call filey_tools with name=<tool> for its parameters, then filey_run." };
}

async function answerFileyTool(params: Record<string, unknown>, ctx: AppRequestContext): Promise<unknown> {
  const op = params.op;
  const name = typeof params.name === "string" ? params.name : undefined;
  const args = params.args && typeof params.args === "object" && !Array.isArray(params.args)
    ? params.args as Record<string, unknown> : {};
  if (op === "catalog") return fileyToolCatalog(name, typeof args.query === "string" ? args.query : undefined);
  if (op === "run" && name) return runTool(name, args, ctx.confirm, ctx.isOwner, ctx.turnId, ctx.signal, undefined, ctx.agentId);
  return { error: `Unsupported filey.tool request: ${String(op)}` };
}

export class FileyAgentClient {
  private seq = 0;
  private pending = new Map<string, { resolve(v: unknown): void; reject(e: Error): void }>();
  private listeners = new Set<(ev: GatewayEvent) => void>();
  private stop: () => void;
  /** Resolves on gateway.ready (after capabilities are announced). */
  readonly ready: Promise<void>;
  /** The app context the current turn answers requests with. */
  context: AppRequestContext = { confirm: () => false, isOwner: false };

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
        if (frame.error) waiter.reject(new Error(frame.error.message || "Filey Agent request failed"));
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
    try {
      if (frame.method === "filey.tool") {
        const out = await answerFileyTool(params, this.context);
        return this.reply(id, { result: { value: JSON.stringify(out ?? null) } });
      }
      if (frame.method === "approval") {
        const what = String(params.description || params.command || params.tool_name || "an action");
        const ok = await this.context.confirm(String(params.tool_name || "agent"), { action: what });
        return this.reply(id, { result: { choice: ok ? "once" : "deny" } });
      }
      // clarify, sudo, secrets, desktop panes: not offered here — the agent continues without them.
      return this.reply(id, { error: { code: -32601, message: `${frame.method} is not handled by the Filey app` } });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (frame.method === "filey.tool")
        return this.reply(id, { result: { value: JSON.stringify({ error: message, retry_safe: false }) } });
      return this.reply(id, { error: { code: -32000, message } });
    }
  }
}

/** Desktop: the Tauri-supervised sidecar (src-tauri/src/modules/filey_agent.rs) over stdio.
 *  Lines that arrive before the client subscribes are held, so gateway.ready is never lost. */
export async function desktopAgentTransport(): Promise<AgentTransport> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const subs = new Set<(line: string) => void>();
  const early: string[] = [];
  await listen<string>("filey-agent-line", e => subs.size ? subs.forEach(cb => cb(e.payload)) : early.push(e.payload));
  await listen("filey-agent-exit", () => { connection = undefined; sessions.clear(); });
  // The agent's model is Filey AI on the user's own Coins: it authenticates as the signed-in user
  // with this token (read per request), so keep it current across Supabase refreshes.
  // The cloud client even in local mode: Coins belong to the Filey account, not the device data.
  const { supabase } = await import("./supabase");
  const pushSession = (session: { access_token: string; expires_at?: number } | null) => session
    ? invoke("filey_agent_session", { accessToken: session.access_token, expiresAt: session.expires_at ?? 0 }).catch(() => {})
    : Promise.resolve();
  if (supabase) {
    await pushSession((await supabase.auth.getSession()).data.session);
    supabase.auth.onAuthStateChange((_event, session) => { void pushSession(session); });
  }
  await invoke("filey_agent_start");
  return {
    send: line => invoke("filey_agent_send", { line }),
    onLine: cb => {
      subs.add(cb);
      early.splice(0).forEach(cb);
      return () => subs.delete(cb);
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
    sessions.clear();
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

/** Opt-in while the agent runtime rolls out: Settings flips this per device. The desktop app
 *  runs its own sidecar; the web and phone app reach the owner's computer through the host. */
export const FILEY_AGENT_RUNTIME_KEY = "filey.agentRuntime";
const desktop = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export function fileyAgentEnabled(): boolean {
  try {
    return localStorage.getItem(FILEY_AGENT_RUNTIME_KEY) === "filey-agent";
  } catch {
    return false;
  }
}

let connection: Promise<FileyAgentClient> | undefined;
const sessions = new Map<string, Promise<string>>();

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

/** One chat turn on Filey Agent: one agent session per Filey chat, created on first use. */
export async function* fileyAgentTurn(chatId: string, text: string, ctx: AppRequestContext): AsyncGenerator<AgentEvent, string> {
  const client = await connect();
  let session = sessions.get(chatId);
  if (!session) {
    session = client.request<{ session_id: string }>("session.create", { source: "filey", idempotency_key: chatId })
      .then(r => r.session_id);
    sessions.set(chatId, session);
    session.catch(() => sessions.delete(chatId));
  }
  return yield* fileyAgentStream(client, await session, text, ctx);
}

/** The Filey Agent turn, or the built-in chat when the agent can't start it (offline, busy, not
 *  allowed). Only a failure before the agent's first event falls back: by then it has taken no
 *  action, so the built-in chat can't repeat one. */
export async function* fileyAgentOrFallback(
  primary: AsyncGenerator<AgentEvent, string>,
  fallback: () => AsyncGenerator<AgentEvent, string>,
): AsyncGenerator<AgentEvent, string> {
  let first: IteratorResult<AgentEvent, string>;
  try {
    first = await primary.next();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const note = (text: string) => `_${reason} Filey AI answered instead._\n\n${text}`;
    const backup = fallback();
    for (;;) {
      const step = await backup.next();
      if (step.done) return note(step.value);
      yield step.value.type === "done" ? { ...step.value, text: note(step.value.text) } : step.value;
    }
  }
  if (first.done) return first.value;
  yield first.value;
  return yield* primary;
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
  const interrupt = () => { void client.request("session.interrupt", { session_id: sessionId }).catch(() => {}); };
  ctx.signal?.addEventListener("abort", interrupt, { once: true });
  client.context = ctx;
  try {
    await client.request("prompt.submit", { session_id: sessionId, text });
    for (;;) {
      if (!queue.length) await new Promise<void>(resolve => { wake = resolve; });
      wake = undefined;
      const ev = queue.shift();
      if (!ev) continue;
      const p = ev.payload ?? {};
      if (ev.type === "message.interim" && typeof p.text === "string" && p.text.trim()) {
        yield { type: "text", text: p.text };
      } else if (ev.type === "tool.start") {
        const args = (p.args ?? {}) as Record<string, unknown>;
        // filey_run carries the real business action; show that, not the wrapper.
        const name = p.name === "filey_run" && typeof args.name === "string" ? args.name : String(p.name);
        yield { type: "tool_call", id: String(p.tool_id), name, args };
      } else if (ev.type === "tool.complete") {
        const args = (p.args ?? {}) as Record<string, unknown>;
        const name = p.name === "filey_run" && typeof args.name === "string" ? args.name : String(p.name);
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
    ctx.signal?.removeEventListener("abort", interrupt);
    off();
  }
}
