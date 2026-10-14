/* Filey AI on the paired computer. A phone or browser turn runs on the desktop's
 * engine — its Filey Agent or Filey AI, its model and keys, its tools (WhatsApp
 * included) and its records — and streams back over Filey Link (deviceLink.ts).
 * Approvals are asked on the phone, where the person is. When no computer takes
 * the turn, the phone runs it itself, exactly as before. */
import type { AgentEvent } from "./agentHarness";
import type { AiMessage } from "./ai";
import type { ConfirmFn } from "./aiTools";
import {
  LinkUnavailable, forgetHost, linkedHost, openLinkSession, registerLinkMethod,
  type LinkedDevice, type LinkSession,
} from "./deviceLink";

/** Turns from linked devices are remote runs (aiTools.isRemoteAgentRun): no
 *  computer or browser control and no shell, whatever the phone asks. */
export const linkAgentId = (deviceId: string, chatId: string) => `link:${deviceId}:${chatId}`;

/** Tools a phone running its own turn hands to the computer: the WhatsApp bridge is paired there. */
export const DESKTOP_TOOLS = new Set(["send_whatsapp", "send_whatsapp_file", "send_invoice_whatsapp"]);

const ACCEPT_MS = 6_000;
/** The computer sends a heartbeat every 10 s while it works. */
const SILENCE_MS = 45_000;
const HISTORY_CHARS = 60_000;
const DETAIL_CHARS = 24_000;

export interface LinkedTurnInput { chatId: string; goalText: string; history: AiMessage[]; auto: boolean }

// ---- desktop ---------------------------------------------------------------------

const clip = (value: unknown, max: number) => typeof value === "string" ? value.slice(0, max) : "";
const roomy = (value: unknown) => JSON.stringify(value ?? null).length <= DETAIL_CHARS;

function parseTurn(params: Record<string, unknown>): LinkedTurnInput {
  const goalText = clip(params.goalText, 20_000).trim();
  if (!goalText) throw new Error("Nothing to do.");
  const history = (Array.isArray(params.history) ? params.history : []).flatMap((m): AiMessage[] =>
    m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string" ? [{ role: m.role, text: m.text }] : []);
  return { chatId: clip(params.chatId, 200) || "chat", goalText, history: fitHistory(history), auto: params.auto === true };
}

/** Tool details are for the progress list; the computer keeps anything bulky. */
function compact(event: AgentEvent): AgentEvent {
  if (event.type === "tool_result" && !roomy(event.result))
    return { ...event, result: event.result && typeof event.result === "object" && "error" in event.result
      ? { error: clip(String((event.result as { error: unknown }).error), 2000) }
      : { ok: true, note: "Large result kept on the computer." } };
  if (event.type === "tool_call" && !roomy(event.args)) return { ...event, args: {} };
  return event;
}

/** Desktop: run requests from paired phones and browsers. */
export function serveLinkedDevices(): void {
  registerLinkMethod("agent.turn", async (params, call) => {
    const input = parseTurn(params);
    const [{ runAgentTurn }, { endTurn }] = await Promise.all([import("./agentTurn"), import("./aiTools")]);
    const agentId = linkAgentId(call.device.id, input.chatId);
    const turnId = `link-${call.id}`;
    // Approvals go to the phone; the desktop's own mode, capability switches
    // and module access still decide inside runTool.
    const stream = runAgentTurn({ ...input, chatId: agentId },
      { isOwner: true, signal: call.signal, agentId, confirm: call.ask, turnId, maxTokens: 4096 });
    let text = "";
    try {
      for (;;) {
        const step = await stream.next();
        if (step.done) { text = step.value; break; }
        await call.emit("event", compact(step.value));
      }
    } finally {
      await stream.return("");
    }
    const files = endTurn(turnId).map(f => ({ name: f.name, ...(typeof f.url === "string" && /^https:/.test(f.url) ? { url: f.url } : {}) }));
    return { text, files };
  });

  registerLinkMethod("tool.run", async (params, call) => {
    const name = String(params.name);
    const args = params.args;
    if (!DESKTOP_TOOLS.has(name) || !args || typeof args !== "object" || Array.isArray(args))
      return { error: `"${name}" can't be run from another device.`, retry_safe: false };
    const { runTool } = await import("./aiTools");
    // The phone's own runTool asked its owner before handing this over.
    return runTool(name, args as Record<string, unknown>, async () => true, true, undefined, call.signal, undefined,
      linkAgentId(call.device.id, "tools"));
  });
}

// ---- phone and browser -------------------------------------------------------------

function fitHistory(history: AiMessage[]): AiMessage[] {
  const kept: AiMessage[] = [];
  let size = 0;
  for (const m of [...history].reverse()) {
    size += m.text.length;
    if (size > HISTORY_CHARS) break;
    kept.unshift({ role: m.role, text: m.text });
  }
  return kept;
}

/** Waits for the computer to take the request. Anything short of that is LinkUnavailable. */
async function taken(session: LinkSession, host: LinkedDevice, signal?: AbortSignal): Promise<void> {
  let reply;
  try {
    reply = await session.next(ACCEPT_MS, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new LinkUnavailable(`${host.label} didn't pick this up.`);
  }
  if (reply.type === "accepted") return;
  const data = reply.data as { message?: string; code?: string } | undefined;
  // The computer forgot this device (disconnected there): stop sending it work.
  if (data?.code === "not_paired") forgetHost(host.id);
  throw new LinkUnavailable(data?.message || `${host.label} didn't pick this up.`, data?.code);
}

function failure(reply: { data?: unknown }, host: LinkedDevice, signal: AbortSignal): Error {
  const data = reply.data as { message?: string; stopped?: boolean } | undefined;
  if (data?.stopped && signal.aborted) return new DOMException("Stopped.", "AbortError");
  return new Error(`${host.label}: ${data?.message || "the request failed."}`);
}

/** This turn on the paired computer. Throws LinkUnavailable until the computer has taken it. */
export async function* linkedAgentTurn(input: LinkedTurnInput, ctx: { confirm: ConfirmFn; signal: AbortSignal }): AsyncGenerator<AgentEvent, string> {
  const host = linkedHost();
  if (!host) throw new LinkUnavailable("No connected computer is open.");
  const session = await openLinkSession(host.id, "agent.turn",
    { chatId: input.chatId, goalText: input.goalText, history: fitHistory(input.history), auto: input.auto });
  const cancel = () => void session.send("cancel").catch(() => {});
  ctx.signal.addEventListener("abort", cancel, { once: true });
  try {
    await taken(session, host, ctx.signal);
    for (;;) {
      const reply = await session.next(SILENCE_MS, ctx.signal);
      if (reply.type === "event") yield reply.data as AgentEvent;
      else if (reply.type === "confirm") {
        const ask = reply.data as { cid?: string; name?: string; args?: Record<string, unknown> };
        const ok = await Promise.resolve(ctx.confirm(String(ask.name), ask.args ?? {})).catch(() => false);
        await session.send("answer", { cid: ask.cid, ok }).catch(() => {});
      } else if (reply.type === "result") {
        const done = reply.data as { text?: string; files?: { name: string; url?: string }[] } | undefined;
        const files = (done?.files ?? []).map(f => f.url ? `[${f.name}](${f.url})` : f.name);
        return `${done?.text ?? ""}${files.length ? `\n\nSaved on ${host.label}: ${files.join(", ")}` : ""}`;
      } else if (reply.type === "error") throw failure(reply, host, ctx.signal);
    }
  } finally {
    ctx.signal.removeEventListener("abort", cancel);
    session.close();
  }
}

/** The linked turn, or this device's own when no computer takes it. Once the
 *  computer has the turn, its errors are shown, never quietly re-run here. */
export async function* preferLinked(
  linked: () => AsyncGenerator<AgentEvent, string>,
  local: () => AsyncGenerator<AgentEvent, string>,
): AsyncGenerator<AgentEvent, string> {
  const remote = linked();
  let first: IteratorResult<AgentEvent, string>;
  try {
    first = await remote.next();
  } catch (error) {
    if (!(error instanceof LinkUnavailable)) throw error;
    return yield* local();
  }
  if (first.done) return first.value;
  yield first.value;
  return yield* remote;
}

/** A desktop-only tool from a phone's own turn: the computer's answer, or `fallback` with how to get one. */
export async function viaDesktopOr(name: string, args: Record<string, unknown>, signal: AbortSignal | undefined, fallback: string): Promise<unknown> {
  const host = DESKTOP_TOOLS.has(name) ? linkedHost() : undefined;
  if (host) {
    let session: LinkSession | undefined;
    try {
      session = await openLinkSession(host.id, "tool.run", { name, args });
      await taken(session, host, signal);
      for (;;) {
        const reply = await session.next(SILENCE_MS, signal);
        if (reply.type === "result") return reply.data;
        if (reply.type === "error") return { error: (reply.data as { message?: string })?.message || "The computer couldn't run this.", retry_safe: false };
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      if (!(error instanceof LinkUnavailable))
        return { error: `${host.label} stopped responding. Check WhatsApp on the computer before retrying.`, delivery: "unconfirmed", retry_safe: false };
    } finally {
      session?.close();
    }
  }
  return {
    error: fallback,
    hint: "Connect this device to your computer in Settings → AI Assistant → Linked devices, and keep Filey open there with WhatsApp connected.",
  };
}
