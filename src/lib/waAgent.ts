// Filey's own agent, reachable over WhatsApp — same brain, memory and tools as
// the in-app chat, but driven entirely on-device (no server, no webhook).
//
// The WhatsApp bridge sidecar forwards each message here through the `wa-message`
// event; this runs the app's local agent and answers back through replyWa().
// Sensitive (money/outbound) tools go through a two-pass confirm: the first run
// denies them so the agent asks the user, and a "yes" reply re-runs with them
// allowed. Nothing leaves without approval.
import { aiReady } from "./ai";
import { log } from "./log";
import { serviceError } from "./serviceError";


import {
  bridgeState,
  getBridgeConfig,
  hasDesktop,
  onBridgeState,
  onWaMessage,
  onWaVoice,
  replyWa,
  sendWaFile,
  type WaMessage,
  type WaVoice,
} from "./waBridge";
import { waLogAdd } from "./waLog";
import { whatsappContext } from "./agentSessions";
import { clearAgentProgress } from "./agentRunState";
import { stopAgentComputer } from "./agentComputer";
import { agentStorageScope, AGENT_STORAGE_EVENT } from "./agentStorage";
import { runRemoteAgentTurn, clearRemoteAgentTurns, clearRemoteAgentConversation } from "./remoteAgentTurn";

/** Every message Filey sends on WhatsApp opens with this line, so an answer is
 *  recognisable in a self-chat. WhatsApp has no native underline; a short
 *  box-drawing separator avoids the gaps between combining underlined letters. */
export const WA_HEADER = "*Filey Agent*\n────────────";

/** Put the header on a reply (once) — the model is asked for it, and this makes
 *  sure it is there, in the exact house style, even when the model forgets or
 *  styles it wrong. The first line counts as the header when its bare text
 *  (styling marks stripped) reads "filey agent". */
export function waFormat(text: string): string {
  const t = (text ?? "").trim();
  if (!t) return "";
  const [first, ...rest] = t.split("\n");
  const bare = first
    .replace(/[\u0332*_\u26a1]/g, "")
    .trim()
    .toLowerCase();
  const body = bare === "filey agent"
    ? rest.join("\n").trim().replace(/^─+[ \t]*(?:\r?\n|$)/, "").trim()
    : t;
  return body ? `${WA_HEADER}\n\n${body}` : WA_HEADER;
}

let started = false;

/** One agent run at a time, and messages wait their turn instead of being
 *  turned away. Two lines fired off in quick succession are two questions the
 *  owner wants answered, not a queue to apologise about.
 *  Bound the backlog and age out turns before they can perform late actions. */
let queue: Promise<void> = Promise.resolve();
let queued = 0;
let generation = 0;
let activeRun: AbortController | null = null;

/** A run that never finishes used to wedge the queue forever: the message that
 *  hung was never answered, and every message after it — hours of them — was
 *  answered by nobody either. One LLM call can legitimately take minutes (the
 *  desktop AI proxy allows 180s per request and retries transient failures), so
 *  the cap is generous, but it is a cap. Stays under the sidecar's own reply
 *  timeout so the owner gets this line rather than the sidecar's. */
const RUN_TIMEOUT_MS = 200_000;

function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  fallback: T,
  abort: () => void,
  signal?: AbortSignal
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
      const cancel = () => { cleanup(); reject(new DOMException("Stopped", "AbortError")); };
    const cleanup = () => { clearTimeout(t); signal?.removeEventListener("abort", cancel); };
    const t = setTimeout(() => {
      cleanup();
      abort();
      resolve(fallback);
    }, ms);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    const done = (v: T) => {
      cleanup();
      resolve(v);
    };
    p.then(done, (e) => {
      cleanup();
      reject(e);
    });
  });
}

/** Digits of the number part of a JID: "971501234567:12@s.whatsapp.net" and
 *  "971501234567" both come out as "971501234567". */
const num = (s: string | null | undefined) =>
  s?.includes("@") && !/^\d+(?::\d+)?@s\.whatsapp\.net$/.test(s)
    ? "" : (s ?? "").split("@")[0].split(":")[0].replace(/\D/g, "");

/** Is this sender the owner? Exact match against the paired account itself
 *  (self-chat) or the owner number explicitly set in
 *  Integrations — that last one is how a spare SIM can be the bot while the
 *  owner talks to it from their own phone. Exact, not substring: a shorter
 *  number that sits inside the owner's would otherwise pass as the owner. */
export function isOwnerNumber(
  me: string | null | undefined,
  _companyWa: string | null | undefined,
  from: string,
  ownerNumber?: string | null
): boolean {
  const f = num(from);
  if (!f) return false;
  return [me, ownerNumber].some((c) => !!num(c) && num(c) === f);
}

async function isOwnerSender(from: string, session: string): Promise<boolean> {
  try {
    if (!session || !agentStorageScope()) return false;
    const { state, me, sessionId } = await bridgeState();
    if (state !== "connected" || sessionId !== session) return false;
    const { ownerNumber } = getBridgeConfig();
    return isOwnerNumber(me, null, from, ownerNumber);
  } catch {
    // offline / no profile — deny (the agent stays owner-only)
    return false;
  }
}

/** Mount the WhatsApp handler once at boot. Safe to call repeatedly. */
export function startWaAgent(): void {
  if (started || !hasDesktop) return;
  started = true;
  let lastScope = agentStorageScope();
  window.addEventListener(AGENT_STORAGE_EVENT, () => {
    const scope = agentStorageScope();
    if (scope === lastScope) return;
    lastScope = scope;
    generation++;
    activeRun?.abort();
    clearRemoteAgentTurns(undefined, "whatsapp");
  });
  let lastBridgeSession: string | null | undefined;
  onBridgeState((state) => {
    const replaced = !!lastBridgeSession && state.sessionId !== lastBridgeSession;
    lastBridgeSession = state.sessionId;
    if (state.state === "connected" && !replaced) return;
    generation++;
    activeRun?.abort();
    clearRemoteAgentTurns(undefined, "whatsapp");
  });

  onWaMessage((m) => {
    void enqueueOwner(m, (deadline, signal) => handle(m, { deadline, signal }));
  });
  window.addEventListener("filey:stop-agent-browser", () => {
    generation++; activeRun?.abort(); clearRemoteAgentTurns(undefined, "whatsapp");
  });

  // Voice notes: transcribe with the configured provider's Whisper endpoint,
  // then run the exact same handler the words would have taken as text.
  onWaVoice((v) => {
    void enqueueOwner(v, (deadline, signal) => handleVoice(v, deadline, signal));
  });
}

/** Clear non-owner requests before they can wait behind a long owner run. */
async function enqueueOwner(m: Pick<WaMessage, "id" | "from" | "bridgeSession"> & { text?: string }, run: (deadline: number, signal: AbortSignal) => Promise<void>) {
  const scope = agentStorageScope();
  const epoch = generation;
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  if (!scope || !(await isOwnerSender(m.from, m.bridgeSession)) || scope !== agentStorageScope() || epoch !== generation) {
    await replyWa(m.id, "", m.bridgeSession).catch(() => {});
    return;
  }
  const command = m.text?.trim().toLowerCase();
  if (command && ["/help", "/status", "/stop", "/new"].includes(command)) {
    let stopWarning = "";
    if (command === "/stop" || command === "/new") {
      generation++;
      activeRun?.abort();
      clearRemoteAgentTurns(undefined, "whatsapp");
      const stopEpoch = generation;
      try { await stopAgentComputer(`whatsapp:${m.from}`); }
      catch { stopWarning = "\nThe browser could not confirm it stopped. Open Filey and close the browser panel's tabs."; }
      if (scope !== agentStorageScope() || stopEpoch !== generation) {
        await replyWa(m.id, "", m.bridgeSession).catch(() => {});
        return;
      }
    }
    if (command === "/new") {
      clearRemoteAgentConversation(scope, "whatsapp", m.from);
      if (scope) clearAgentProgress(`whatsapp:${m.from}`, scope);
      waLogAdd({ dir: "in", from: m.from, text: "/new", sessionStart: true }, scope);
    }
    const text = command === "/new" ? "New conversation started. Your saved preferences and skills are kept."
      : command === "/stop" ? "WhatsApp tasks stopped and pending approvals cleared. An action already submitted may have completed; check before repeating it."
      : command === "/status" ? `Filey is connected. AI ${aiReady() ? "is ready" : "needs setup in Settings"}. ${queued} request(s) active or queued.`
      : "Send a task, question or voice note. /status checks readiness, /stop cancels WhatsApp tasks, /new starts fresh context. Reply YES only to an exact action proposal you want to approve.";
    if (scope === agentStorageScope()) await replyWa(m.id, waFormat(text + stopWarning), m.bridgeSession).catch(() => {});
    return;
  }
  if (queued >= 3) {
    await replyWa(m.id, waFormat("I'm finishing your earlier requests. Please wait for my reply before sending another task."), m.bridgeSession).catch(() => {});
    return;
  }
  queued++;
  queue = queue
    .then(async () => {
      if (scope !== agentStorageScope() || epoch !== generation) {
        await replyWa(m.id, "", m.bridgeSession);
        return;
      }
      if (Date.now() >= deadline - 5000) {
        await replyWa(m.id, waFormat("This request expired while waiting. I haven't started it. Send it again if you still need it."), m.bridgeSession);
        return;
      }
      const controller = new AbortController();
      activeRun = controller;
      try { await run(deadline, controller.signal); }
      finally { if (activeRun === controller) activeRun = null; }
    })
    .catch((e) => log.warn("whatsapp", "owner request failed", e))
    .finally(() => { queued--; });
}

/** Transcribe one voice note and answer it. Falls back to a clear, honest
 *  line when no speech provider is configured — never silence. */
async function handleVoice(v: WaVoice, deadline: number, signal: AbortSignal): Promise<void> {
  const scope = agentStorageScope();
  const epoch = generation;
  if (!scope || !(await isOwnerSender(v.from, v.bridgeSession)) || scope !== agentStorageScope() || epoch !== generation || signal.aborted) {
    await replyWa(v.id, "", v.bridgeSession);
    return;
  }
  waLogAdd({
    dir: "in",
    from: v.from,
    name: v.fromName,
    text: "[voice note]",
  }, scope);
  let transcript = "";
  try {
    const { transcribeAudio, sttAvailable } = await import("./voice");
    if (signal.aborted || scope !== agentStorageScope() || epoch !== generation) {
      await replyWa(v.id, "", v.bridgeSession);
      return;
    }
    if (!sttAvailable()) {
      await replyWa(
        v.id,
        waFormat(
          "I can't listen yet — voice needs an OpenAI or Groq key in Settings → AI Assistant. Type it out and I'm on it."
        ),
        v.bridgeSession
      );
      return;
    }
    const bytes = Uint8Array.from(atob(v.b64), (c) => c.charCodeAt(0));
    transcript = await withTimeout(transcribeAudio(bytes, {
      mimetype: v.mimetype,
      filename: "note.ogg",
    }), Math.max(1, deadline - Date.now()), "", () => {}, signal);
    if (scope !== agentStorageScope() || epoch !== generation) {
      await replyWa(v.id, "", v.bridgeSession);
      return;
    }
  } catch (e) {
    if (signal.aborted || scope !== agentStorageScope() || epoch !== generation) {
      await replyWa(v.id, "", v.bridgeSession).catch(() => {});
      return;
    }
    log.warn("whatsapp", "voice transcription failed", e);
    await replyWa(
      v.id,
      waFormat(
        "That voice note didn't come through clearly on my side. Send it as text and I'm on it."
      ),
      v.bridgeSession
    );
    return;
  }
  if (!transcript) {
    await replyWa(v.id, waFormat("That one came through silent — say it again?"), v.bridgeSession);
    return;
  }
  log.info("whatsapp", "Owner voice note transcribed");
  // The spoken words are treated exactly like typed ones; `voice` flags the
  // reply path to also send a spoken version back.
  await handle(
    { id: v.id, bridgeSession: v.bridgeSession, from: v.from, text: transcript, fromName: v.fromName, chatJid: v.chatJid },
    { voice: true, deadline, signal }
  );
}

/** Answer one incoming message. Runs one at a time, off the queue. When
 *  `voice` is set (a voice note came in), the reply also goes back as a
 *  spoken voice note where TTS is available — talk in, talk out. */
async function handle(m: WaMessage, opts: { voice?: boolean; deadline?: number; signal?: AbortSignal } = {}): Promise<void> {
  const scope = agentStorageScope();
  const epoch = generation;
  const deadline = opts.deadline ?? Date.now() + RUN_TIMEOUT_MS;
  const answer = async (text: string) => {
    if (scope !== agentStorageScope() || epoch !== generation || opts.signal?.aborted) {
      await replyWa(m.id, "", m.bridgeSession).catch(() => {});
      return false;
    }
    // Empty stays empty: that is the deliberate silence for a non-owner, and it
    // is what releases the sidecar's pending promise.
    const out = waFormat(text);
    try {
      await replyWa(m.id, out, m.bridgeSession);
      if (out && scope === agentStorageScope())
        waLogAdd(
          { dir: "out", from: m.from, name: m.fromName, text: out },
          scope ?? undefined
        );
      return scope === agentStorageScope() && epoch === generation;
    } catch (e) {
      // The bridge died between receiving the question and the answer. The
      // sidecar's pending entry will time out with its own line to the owner;
      // here it matters only that the failure is visible in the app log
      // instead of the reply vanishing into a resolved promise.
      log.error(
        "whatsapp",
        `reply to ${m.from} could not be delivered — bridge not running?`,
        e instanceof Error ? e.message : String(e)
      );
      return false;
    }
  };

  // The agent answers the OWNER only. Anyone else who happens to have the
  // business number gets silence: this agent can read the whole book —
  // customers, prices, revenue — and its approval gate is a "yes" in the same
  // chat, so a stranger could both read the data and approve their own invoice
  // edits. Silence rather than a refusal: a customer messaging the business
  // must not get an auto-reply at all.
  // ponytail: hard owner gate. A customer-facing mode needs its own read-only,
  // no-confirm tool set before it can be turned on.
  // The empty reply matters: it releases the sidecar's pending promise, which
  // would otherwise time out and send the customer a "didn't answer" line.
  if (!scope || !(await isOwnerSender(m.from, m.bridgeSession))) {
    // Silent to the sender, but never silent to the log: a wrong owner match is
    // indistinguishable from a broken bridge from the outside, and that cost a
    // long evening once.
    const me = await bridgeState()
      .then((s) => s.me)
      .catch(() => null);
    log.warn(
      "whatsapp",
      `ignored ${m.from} — not recognised as the owner`,
      `paired account: ${me ?? "unknown"}, owner number set: ${
        getBridgeConfig().ownerNumber || "none"
      }`
    );
    await answer("");
    return;
  }
  // Owner lookup is async: an account switch or /stop during it must not
  // start work or write the old request into a different workspace's log.
  if (scope !== agentStorageScope() || epoch !== generation || opts.signal?.aborted) {
    await replyWa(m.id, "", m.bridgeSession).catch(() => {});
    return;
  }
  const priorContext = whatsappContext(m.from);
  waLogAdd({ dir: "in", from: m.from, name: m.fromName, text: m.text }, scope);
  log.info("whatsapp", "Owner request received");

  // A greeting needs neither a business-data scan nor a paid model round trip.
  if (!opts.voice && !m.attachment && /^(?:hi|hey|hello|hyy)(?: filey)?[!. ]*$/i.test(m.text.trim())) {
    await answer("Hi. Send me a task or question and I'll help you here.");
    return;
  }

  if (!aiReady()) {
    await answer(
      "Filey AI isn't configured yet — add an AI key in Settings → AI Assistant first."
    );
    return;
  }

  try {
    const attachments: File[] = [];
    if (m.attachment) {
      const { b64, mimetype, name } = m.attachment;
      if (typeof b64 !== "string" || b64.length > 16 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64))
        throw new Error("The attachment is invalid or exceeds the 12 MB limit.");
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      if (!bytes.length || bytes.length > 12 * 1024 * 1024) throw new Error("Send a file smaller than 12 MB.");
      // eslint-disable-next-line no-control-regex -- Strip control bytes from an untrusted filename.
      const filename = String(name || "attachment").split(/[\\/]/).pop()!.replace(/[\x00-\x1f]/g, "").slice(0, 160) || "attachment";
      attachments.push(new File([bytes], filename, { type: String(mimetype || "application/octet-stream") }));
    }
    const result = await runRemoteAgentTurn({
      scope, channel: "whatsapp", conversationId: m.from, text: m.text, attachments,
      context: priorContext, deadline, signal: opts.signal ?? new AbortController().signal,
      isCurrent: () => scope === agentStorageScope() && epoch === generation,
    });
    const outputs = result.files;
    const reply = result.text;
    const recipient = m.chatJid || `${m.from}@s.whatsapp.net`;
    // Only this turn's outputs go back to the authenticated source chat. Paths
    // never come from a model-supplied recipient or arbitrary filesystem lookup.
    const deliveries: string[] = [];
    const seen = new Set<string>();
    for (const file of outputs) {
      if (scope !== agentStorageScope() || epoch !== generation || opts.signal?.aborted) break;
      if (!file.path) {
        deliveries.push(`${file.name}: ${file.mediaJobId || file.videoJobId ? "open Filey AI to review the media job" : "no saved file available to attach"}.`);
        continue;
      }
      if (seen.has(file.path)) continue;
      seen.add(file.path);
      if (file.whatsappRecipients?.includes(recipient)) continue;
      if (Date.now() >= deadline - 10_000) { deliveries.push(`${file.name}: not sent; this task reached its time limit.`); continue; }
      try {
        const accepted = await sendWaFile(recipient, { path: file.path, filename: file.name }, m.bridgeSession);
        if (!accepted) throw new Error("No message ID was returned");
        (file.whatsappRecipients ??= []).push(recipient);
        deliveries.push(`${file.name}: accepted by WhatsApp.`);
        if (scope === agentStorageScope() && epoch === generation)
          waLogAdd({ dir: "out", from: m.from, text: `[File] ${file.name}`, document: { key: accepted, filename: file.name, channel: "whatsapp", outcome: "accepted" } }, scope);
      } catch {
        deliveries.push(`${file.name}: delivery was not confirmed. Check this chat before retrying; your local file is preserved.`);
      }
    }
    const text = reply + (deliveries.length ? `\n\n*FILES*\n${deliveries.join("\n")}` : "");
    if (!(await answer(text))) return;
    result.delivered(text);

    // Spoken reply for spoken input: TTS → mp3 on disk → audio message.
    // Best-effort — the text answer above already stands on its own.
    if (opts.voice && scope === agentStorageScope() && epoch === generation && !opts.signal?.aborted && Date.now() < deadline) {
      try {
        const { ttsAvailable, textToSpeech } = await import("./voice");
        if (ttsAvailable()) {
          const mp3 = await withTimeout<Uint8Array | null>(textToSpeech(text), Math.max(1, deadline - Date.now()), null, () => {}, opts.signal);
          if (!mp3 || scope !== agentStorageScope() || epoch !== generation || opts.signal?.aborted || Date.now() >= deadline) return;
          const { deliverFile } = await import("./agentFiles");
          const saved = await deliverFile({ name: `filey-voice-${Date.now()}.mp3`, bytes: mp3 });
          if (saved.path) {
            if (scope !== agentStorageScope() || epoch !== generation || opts.signal?.aborted || Date.now() >= deadline) return;
            await sendWaFile(m.chatJid || `${m.from}@s.whatsapp.net`, {
              path: saved.path,
              filename: "filey-reply.mp3",
              mimetype: "audio/mpeg",
              caption: undefined,
            }, m.bridgeSession);
            waLogAdd(
              {
                dir: "out",
                from: m.from,
                name: m.fromName,
                text: "[voice reply]",
              },
              scope
            );
          }
        }
      } catch (e) {
        log.warn("whatsapp", "voice reply skipped", e);
      }
    }
  } catch (e) {
    if (scope !== agentStorageScope() || epoch !== generation) {
      await replyWa(m.id, "", m.bridgeSession).catch(() => {});
      return;
    }
    // Provider failures can echo credentials, SQL or response bodies. Only
    // return the existing user-facing translation over the messaging channel.
    const failure = await serviceError(e, "This task could not finish. Open Filey to check its status before retrying an action.");
    await answer(failure.message);
  }
}
