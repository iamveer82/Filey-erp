import type { AiMessage } from "./ai";
import type { AgentEvent } from "./agentHarness";
import { AGENT_STORAGE_EVENT, agentStorageScope, readAgentStorage, writeAgentStorage } from "./agentStorage";
import { getCacheIdentity, getCacheOrg } from "./api";
import { aiAccountSession, invalidateCreditStatus } from "./aiCredits";

type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";
type Job = { id?: string; status: JobStatus; result?: string; events?: unknown[]; last_sequence?: number };
export interface HermesAgentOptions {
  funding?: "credits" | "free" | "byok";
  isOwner?: boolean;
  reasoningEnabled?: boolean;
  signal?: AbortSignal;
  agentId?: string;
  /** Recover one existing scoped receipt; this path never submits a prompt. */
  resumeJobId?: string;
}
export interface HermesJobReceipt {
  id: string;
  user_id: string;
  org_id: string;
  status: JobStatus | "unknown";
}
const RECEIPT_KEY = "filey.ai.hermes-job";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Metadata only, scoped by the existing account/mode storage boundary. One
 * active pilot job per user means a single latest-job pointer is sufficient. */
export function getHermesJobReceipt(): HermesJobReceipt | null {
  const scope = agentStorageScope(), org = getCacheOrg();
  if (!scope?.startsWith("cloud:") || !scope.includes(":user:") || !org) return null;
  const user = scope.slice(scope.lastIndexOf(":user:") + 6);
  try {
    const raw = readAgentStorage(RECEIPT_KEY), value: unknown = raw ? JSON.parse(raw) : null;
    if (!object(value) || Object.keys(value).some(key => !["id", "user_id", "org_id", "status"].includes(key)) ||
      typeof value.id !== "string" || !uuid.test(value.id) || value.user_id !== user || value.org_id !== org ||
      (value.status !== "unknown" && !statuses.has(String(value.status)))) return null;
    return value as unknown as HermesJobReceipt;
  } catch { return null; }
}

export function resumeHermesAgentStream(jobId: string, opts: HermesAgentOptions): AsyncGenerator<AgentEvent, string, void> {
  return hermesAgentStream([], { ...opts, resumeJobId: jobId });
}

/** This is trusted build configuration, never a URL from a prompt or setting.
 * No deployment enables the pilot merely by installing these adapter files. */
export function getHermesPilotConfig(): { url: string; readOnly: true } | null {
  const raw = import.meta.env.VITE_FILEY_HERMES_PILOT_URL;
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const url = new URL(raw.trim());
    const local = import.meta.env.DEV && url.origin === "http://127.0.0.1:16472";
    if ((url.protocol !== "https:" && !local) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) return null;
    return { url: url.origin, readOnly: true };
  } catch { return null; }
}

export class HermesJobError extends Error {
  constructor(message: string, readonly jobId?: string, readonly status?: number) {
    super(message);
    this.name = "HermesJobError";
  }
}

class RetryableJobError extends Error {}
const scopeEvents = [AGENT_STORAGE_EVENT, "storage", "filey:workspace-changed", "filey:workspace-transition"];
const statuses = new Set(["queued", "running", "completed", "failed", "cancelled", "interrupted"]);
const terminal = (status: JobStatus) => !["queued", "running"].includes(status);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const bounded = (value: unknown, max = 500000): value is string => typeof value === "string" && value.length <= max;

function validateJob(value: unknown, id: string, requireId = false): Job {
  if (!object(value) || !statuses.has(String(value.status)) ||
    (requireId ? value.id !== id : value.id !== undefined && value.id !== id) ||
    (value.result !== undefined && !bounded(value.result)) ||
    (value.last_sequence !== undefined && (!Number.isSafeInteger(value.last_sequence) || Number(value.last_sequence) < 0)) ||
    (value.events !== undefined && (!Array.isArray(value.events) || value.events.length > 256)))
    throw new HermesJobError("Filey AI preview returned an invalid job receipt. The request was not repeated.", id);
  return value as Job;
}

function validateEvent(value: unknown, id: string): AgentEvent {
  if (object(value)) {
    if (value.type === "text" && bounded(value.text)) return { type: "text", text: value.text };
    if (value.type === "plan" && Array.isArray(value.steps) && value.steps.length <= 32 && value.steps.every(step =>
      object(step) && bounded(step.step, 4096) && ["pending", "in_progress", "completed", "blocked"].includes(String(step.status))))
      return { type: "plan", steps: value.steps as Extract<AgentEvent, { type: "plan" }>["steps"] };
    if (bounded(value.id, 128) && value.id && bounded(value.name, 128) && value.name) {
      if (value.type === "tool_call" && object(value.args))
        return { type: "tool_call", id: value.id, name: value.name, args: value.args };
      if (value.type === "tool_result" && Object.prototype.hasOwnProperty.call(value, "result"))
        return { type: "tool_result", id: value.id, name: value.name, result: value.result };
    }
    if (value.type === "done" && bounded(value.text) && ["answered", "finished", "blocked", "exhausted", "stopped", "error"].includes(String(value.reason)))
      return { type: "done", text: value.text, reason: value.reason as Extract<AgentEvent, { type: "done" }>["reason"] };
  }
  throw new HermesJobError("Filey AI preview returned an invalid event. The request was not repeated.", id);
}

function withAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const stop = () => { cleanup(); reject(new DOMException("Aborted", "AbortError")); };
    const cleanup = () => signal.removeEventListener("abort", stop);
    signal.addEventListener("abort", stop, { once: true });
    work.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal.aborted) stop();
  });
}

function wireMessages(messages: AiMessage[]): { role: "user" | "assistant"; text: string }[] {
  if (messages.some(message => message.images?.length))
    throw new HermesJobError("Filey AI preview does not support image attachments yet. Use the regular Filey agent for this task.");
  // The service supplies its own trusted policy. Browser system notes must not
  // grant a hosted agent permissions or expose local memory to that service.
  const result = messages.filter(message => message.role !== "system").map(message => {
    if (!["user", "assistant"].includes(message.role) || !bounded(message.text, 16000) || !message.text.trim())
      throw new HermesJobError("Filey AI preview cannot accept this conversation format.");
    return { role: message.role as "user" | "assistant", text: message.text };
  });
  if (!result.length || result[result.length - 1].role !== "user" || result.length > 30)
    throw new HermesJobError("This conversation is too large or empty for Filey AI preview. Start a shorter task.");
  return result;
}

/** Explicit cloud-owner pilot only. GET retries observe the same stored job;
 * neither a lost acknowledgement nor a failed job replays POST or falls back
 * to another agent. The client never executes the service's tool events. */
export async function* hermesAgentStream(messages: AiMessage[], opts: HermesAgentOptions): AsyncGenerator<AgentEvent, string, void> {
  const config = getHermesPilotConfig();
  const scope = agentStorageScope(), identity = getCacheIdentity(), org = getCacheOrg();
  if (!config) throw new HermesJobError("Filey AI preview is not enabled in this build.");
  if (!scope?.startsWith("cloud:") || !org || opts.funding !== "credits" || opts.isOwner !== true ||
    /^(?:whatsapp|telegram|slack):/i.test(opts.agentId ?? ""))
    throw new HermesJobError("Filey AI preview requires the workspace owner's cloud Filey AI connection.");
  const resuming = opts.resumeJobId !== undefined;
  const existing = getHermesJobReceipt(), receipt = resuming ? existing : null;
  if (resuming && (!receipt || receipt.id !== opts.resumeJobId))
    throw new HermesJobError("This Filey AI preview task is not saved for the current cloud workspace.");
  if (!resuming && existing && (existing.status === "unknown" || !terminal(existing.status)))
    throw new HermesJobError("A Filey AI preview task is already saved. Resume it or check its status before starting another task.", existing.id);
  const id = receipt?.id ?? crypto.randomUUID();
  const body = receipt ? undefined : JSON.stringify({ request_id: id, messages: wireMessages(messages), reasoning: opts.reasoningEnabled === true });
  if (body && new TextEncoder().encode(body).length > 64000)
    throw new HermesJobError("This conversation is too large for Filey AI preview. Start a shorter task.");
  const controller = new AbortController();
  const signal = controller.signal;
  let token = "", owner = "", dispatched = false, finished = false, failed = false, cancelStarted = false;
  const saveReceipt = (status: HermesJobReceipt["status"], required = false) => {
    try { writeAgentStorage(RECEIPT_KEY, JSON.stringify({ id, user_id: owner, org_id: org, status }), scope); }
    catch {
      if (required) throw new HermesJobError("The Filey AI preview task reference could not be saved. No task was submitted.", id);
      // An earlier durable pointer still identifies this exact job. A failed
      // status refresh must not discard an otherwise confirmed final reply.
    }
  };
  const assertCurrent = () => {
    signal.throwIfAborted();
    if (scope !== agentStorageScope() || identity !== getCacheIdentity() || org !== getCacheOrg())
      throw new DOMException("The workspace changed.", "AbortError");
  };
  const cancel = () => {
    if (!dispatched || finished || cancelStarted || !token) return;
    cancelStarted = true;
    // Best-effort stop uses the ORIGINAL owner/workspace token, never the next
    // signed-in account. Its response cannot enter a new conversation.
    void fetch(`${config.url}/v1/jobs/${id}/cancel`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "X-Filey-Org": org },
      credentials: "omit", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(3000),
    }).catch(() => undefined);
  };
  const stop = () => { controller.abort(); cancel(); };
  const scopeChanged = () => {
    if (scope !== agentStorageScope() || identity !== getCacheIdentity() || org !== getCacheOrg()) stop();
  };
  opts.signal?.addEventListener("abort", stop, { once: true });
  scopeEvents.forEach(event => window.addEventListener(event, scopeChanged));
  if (opts.signal?.aborted) stop();

  let activeElapsed = 0, activeSince: number | null = null;
  const ready = () => document.visibilityState !== "hidden" && navigator.onLine !== false;
  const clockChanged = () => {
    if (activeSince !== null) activeElapsed += Math.max(0, Date.now() - activeSince);
    activeSince = ready() ? Date.now() : null;
  };
  const remaining = () => 300000 - activeElapsed - (activeSince === null ? 0 : Math.max(0, Date.now() - activeSince));
  const wakeEvents = ["online", "offline", "focus"];
  wakeEvents.forEach(event => window.addEventListener(event, clockChanged));
  document.addEventListener("visibilitychange", clockChanged);
  clockChanged();
  const wait = (delay: number) => new Promise<void>((resolve, reject) => {
    let elapsed = delay === 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", wake);
      wakeEvents.forEach(event => window.removeEventListener(event, wake));
      document.removeEventListener("visibilitychange", wake);
    };
    const wake = (event?: Event) => {
      try { assertCurrent(); } catch (error) { cleanup(); reject(error); return; }
      if (ready() && (elapsed || event?.type === "online" || event?.type === "focus" || event?.type === "visibilitychange")) {
        cleanup(); resolve();
      }
    };
    signal.addEventListener("abort", wake, { once: true });
    wakeEvents.forEach(event => window.addEventListener(event, wake));
    document.addEventListener("visibilitychange", wake);
    if (delay) timer = setTimeout(() => { elapsed = true; wake(); }, delay);
    wake();
  });
  const request = async (path: string, method = "GET", payload?: string): Promise<unknown> => {
    assertCurrent();
    const authTimeout = new AbortController();
    const authTimer = setTimeout(() => authTimeout.abort(), Math.max(1, Math.min(15000, remaining())));
    let session: Awaited<ReturnType<typeof aiAccountSession>>;
    try { session = await withAbort(aiAccountSession(), AbortSignal.any([signal, authTimeout.signal])); }
    catch (error) {
      assertCurrent();
      if (authTimeout.signal.aborted || (error instanceof Error && error.name === "CompletionTransportError")) throw new RetryableJobError();
      throw new HermesJobError("Sign in again before using Filey AI preview.", id);
    } finally { clearTimeout(authTimer); }
    assertCurrent();
    if (owner && owner !== session.user.id) { stop(); throw new DOMException("The account changed.", "AbortError"); }
    if (!session.access_token || !session.user.id) throw new HermesJobError("Sign in again before using Filey AI preview.", id);
    owner = session.user.id; token = session.access_token;
    if (receipt && receipt.user_id !== owner) { stop(); throw new DOMException("The account changed.", "AbortError"); }
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), Math.max(1, Math.min(15000, remaining())));
    const requestSignal = AbortSignal.any([signal, timeout.signal]);
    try {
      if (method === "POST") { saveReceipt("unknown", true); dispatched = true; }
      else if (receipt) dispatched = true;
      const response = await withAbort(fetch(`${config.url}${path}`, {
        method, headers: { Authorization: `Bearer ${token}`, "X-Filey-Org": org, ...(payload ? { "Content-Type": "application/json" } : {}) },
        body: payload, signal: requestSignal, credentials: "omit", redirect: "error", cache: "no-store",
      }), requestSignal);
      assertCurrent();
      if ([429, 500, 502, 503, 504].includes(response.status)) throw new RetryableJobError();
      if (!response.ok) throw new HermesJobError(response.status === 402 ? "Insufficient credit. Add Coin to continue." :
        response.status === 401 ? "Sign in again before using Filey AI preview." : response.status === 403 ? "This workspace cannot use Filey AI preview." :
        response.status === 404 ? "The Filey AI preview task could not be found. The request was not repeated." : "The Filey AI preview request could not be accepted.", id, response.status);
      const text = await withAbort(response.text(), requestSignal);
      assertCurrent();
      if (text.length > 1048576) throw new HermesJobError("The Filey AI preview response is too large to read safely.", id);
      try { return JSON.parse(text) as unknown; }
      catch { throw new HermesJobError("Filey AI preview returned an invalid response. The request was not repeated.", id); }
    } catch (error) {
      assertCurrent();
      if (error instanceof HermesJobError || error instanceof RetryableJobError) throw error;
      throw new RetryableJobError();
    } finally { clearTimeout(timer); }
  };
  let sequence = 0, delay = 0, pending = 0;
  let done: Extract<AgentEvent, { type: "done" }> | undefined;
  try {
    assertCurrent();
    yield { type: "text", text: "Filey AI preview is read-only. It can inspect information, but cannot change records or send messages." };
    assertCurrent();
    await wait(0);
    if (!receipt) {
      try { saveReceipt(validateJob(await request("/v1/jobs", "POST", body), id, true).status); }
      catch (error) {
        if (!(error instanceof RetryableJobError)) throw error;
        if (!dispatched) throw new HermesJobError("Filey AI preview could not connect. No task was submitted.", id);
        // The UUID is also the job ID. Losing POST's acknowledgement only permits
        // reading that job, never submitting its prompt or tools again.
        delay = 3000;
      }
    }
    for (let attempt = 0; attempt < 120; attempt++) {
      await wait(delay);
      assertCurrent();
      if (remaining() <= 0) break;
      let job: Job;
      try { job = validateJob(await request(`/v1/jobs/${id}/events?after=${sequence}`), id); }
      catch (error) {
        if (error instanceof HermesJobError && error.status === 404) saveReceipt("interrupted");
        if (!(error instanceof RetryableJobError)) throw error;
        delay = 3000; pending = 3; continue;
      }
      saveReceipt(job.status);
      const previous = sequence;
      for (const value of job.events ?? []) {
        assertCurrent();
        if (!object(value) || !Number.isSafeInteger(value.sequence) || Number(value.sequence) <= 0)
          throw new HermesJobError("Filey AI preview returned an invalid event receipt.", id);
        const next = Number(value.sequence);
        if (next <= sequence) continue; // reconnects can overlap the last batch
        if (next !== sequence + 1) throw new HermesJobError("The Filey AI preview event history is incomplete. The request was not repeated.", id);
        const event = validateEvent(value.event, id);
        sequence = next;
        if (event.type === "done") done = event;
        else yield event;
        assertCurrent();
      }
      if (job.last_sequence !== undefined && sequence > job.last_sequence)
        throw new HermesJobError("The Filey AI preview event history is inconsistent. The request was not repeated.", id);
      if (job.last_sequence !== undefined && sequence < job.last_sequence) {
        if (sequence === previous) throw new HermesJobError("The Filey AI preview event history is incomplete. The request was not repeated.", id);
        delay = 0; continue; // read all retained pages before publishing the final answer
      }
      if (terminal(job.status)) {
        if (job.status === "completed" && typeof job.result !== "string") {
          try { job = validateJob(await request(`/v1/jobs/${id}`), id, true); }
          catch (error) {
            if (!(error instanceof RetryableJobError)) throw error;
            delay = 3000; pending = 3; continue;
          }
        }
        assertCurrent();
        const text = job.status === "completed" ? job.result : job.status === "cancelled" ? "Filey AI preview was stopped." :
          job.result === "Insufficient credit. Add Coin to continue." ? job.result :
          "Filey AI preview could not finish this task. It was not repeated.";
        if (typeof text !== "string" || (job.status === "completed" && done && (done.text !== text || !["answered", "finished"].includes(done.reason))))
          throw new HermesJobError("Filey AI preview did not confirm its final answer. The request was not repeated.", id);
        assertCurrent();
        invalidateCreditStatus();
        assertCurrent();
        finished = true;
        yield { type: "done", text, reason: job.status === "completed" ? done?.reason ?? "answered" : job.status === "cancelled" ? "stopped" : "error" };
        assertCurrent();
        return text;
      }
      if (sequence > previous) pending = 0;
      delay = [500, 1000, 1500, 3000][pending];
      pending = Math.min(3, pending + 1);
    }
    throw new HermesJobError("Filey AI preview is still reconnecting. The task was not repeated; check its status before starting another task.", id);
  } catch (error) { failed = true; throw error; }
  finally {
    opts.signal?.removeEventListener("abort", stop);
    scopeEvents.forEach(event => window.removeEventListener(event, scopeChanged));
    wakeEvents.forEach(event => window.removeEventListener(event, clockChanged));
    document.removeEventListener("visibilitychange", clockChanged);
    if (signal.aborted || (!failed && !finished)) cancel();
  }
}
