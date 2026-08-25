// Filey's own agent, reachable over WhatsApp — same brain, memory and tools as
// the in-app chat, but driven entirely on-device (no server, no webhook).
//
// The WhatsApp bridge sidecar forwards each message here through the `wa-message`
// event; this runs the app's local agent and answers back through replyWa().
// Sensitive (money/outbound) tools go through a two-pass confirm: the first run
// denies them so the agent asks the user, and a "yes" reply re-runs with them
// allowed. Nothing leaves without approval.
import { aiAgent, aiReady, buildSystemPrompt, getPersona, type AiMessage } from "./ai";
import { log } from "./log";
import { memoryDigest } from "./aiMemory";
import { skillsIndex } from "./agentSkills";
import {
  bridgeState,
  getBridgeConfig,
  hasDesktop,
  onWaMessage,
  replyWa,
  type WaMessage,
} from "./waBridge";
import { billing } from "./api";
import { waLogAdd } from "./waLog";

const SYSTEM =
  "You are Filey, the user's AI business agent with full control of their ERP app via tools — you can read AND modify: stats, customers, products, invoices, quotes, orders, purchase orders, expenses, attendance, files, and navigation. You have long-term memory: use `remember` to save durable facts/preferences and `recall` to look them up. When asked to do something, execute the tool and confirm in one short line. Money/outbound actions require user approval: if a tool needs approval and is refused, tell the user exactly what you need approved and ask them to reply YES to proceed. Never invent data — look it up. Be concise and practical.";

/** WhatsApp has no underline markup — the combining low line (U+0332) after
 *  each character is how underlined text is typed on WhatsApp, and every
 *  client renders it. */
const underline = (s: string) =>
  [...s].map((ch) => (ch === " " ? ch : ch + "\u0332")).join("");

/** Every message Filey sends on WhatsApp opens with this line, so an answer is
 *  recognisable as the agent's at a glance in a thread of your own messages —
 *  bold + underlined, the way reference agents sign their replies. */
export const WA_HEADER = `*${underline("Filey Agent")}*`;

/** WhatsApp is not markdown: `#`, `**` and tables render as literal characters,
 *  so the house style is spelled out rather than left to the model's defaults. */
const FORMAT = [
  "REPLY FORMAT — every WhatsApp message you send follows it:",
  "1. First line is exactly the words: Filey Agent",
  "   (the app styles that line itself — never add emoji, bold marks or underlines to it)",
  "2. Blank line, then the answer — lead with the outcome in one sentence, key values in *bold*.",
  "3. Detail, when there is any, goes in sections: a heading line in *BOLD CAPS*, then items as `· Label — value`.",
  "4. WhatsApp formatting ONLY: *bold*, _italic_, ```monospace```. Never markdown (#, **, ---, | tables, code fences) — it shows up as raw characters.",
  "5. Plain sentences, no emojis beyond the header, and keep it short enough to read on a phone.",
].join("\n");

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
  const body = bare === "filey agent" ? rest.join("\n").trim() : t;
  return body ? `${WA_HEADER}\n\n${body}` : WA_HEADER;
}

/** The same business snapshot the in-app chat gets. Never fatal: a phone
 *  message must still be answered when the snapshot cannot be built. */
async function businessBrief(): Promise<string> {
  try {
    const { buildAiContext } = await import("./aiContext");
    return await buildAiContext();
  } catch {
    return "";
  }
}

let started = false;

/** One agent run at a time, and messages wait their turn instead of being
 *  turned away. Two lines fired off in quick succession are two questions the
 *  owner wants answered, not a queue to apologise about.
 *  ponytail: unbounded chain — the sidecar times a message out after 2min, so a
 *  long backlog answers late rather than never. Cap it if that ever bites. */
let queue: Promise<void> = Promise.resolve();

/** Rolling per-chat history keyed by sender, so the agent remembers context
 *  ("same as before" actually lands). ponytail: in-memory Map — resets on app
 *  restart. Persist to localStorage if history must survive restarts. */
const history = new Map<string, AiMessage[]>();
const HISTORY_LIMIT = 20; // user+assistant turns kept per chat

/** The exact call a chat has proposed and is waiting on, as `name:argsJSON`.
 *
 *  This stored a bare `true`, and the confirm below threw away the tool name and
 *  arguments — so a "yes" did not approve the message the owner had just been
 *  shown, it switched sensitive tools ON for the whole next run: up to
 *  MAX_TOOL_ROUNDS rounds, any number of calls, any recipient. Approving one
 *  WhatsApp message and getting several, to numbers never mentioned, is exactly
 *  that. Binding the approval to the proposed call is what makes "yes" mean the
 *  thing the owner read.
 *
 *  ponytail: signature is JSON.stringify of the args, so a re-proposal with the
 *  keys in a different order reads as a different call and is re-asked. Erring
 *  towards asking twice is the right side to err on here. */
const pendingApproval = new Map<string, { sig: string; at: number }>();

/** How long a proposed call stays approvable. A "yes" hours later used to
 *  authorise whatever was last proposed — the owner has no way to see the old
 *  wording by then, so it expires and the agent simply asks again. */
const APPROVAL_TTL_MS = 15 * 60_000;

/** Identity of a proposed call, for matching an approval to it. */
const callSig = (name: string, args: Record<string, unknown>) =>
  `${name}:${JSON.stringify(args ?? {})}`;

const AFFIRMATIVE = /^(yes|yep|y|ya|ok|okay|approve|confirm|go|do it|proceed|sure|agreed)$/i;

/** A run that never finishes used to wedge the queue forever: the message that
 *  hung was never answered, and every message after it — hours of them — was
 *  answered by nobody either. One LLM call can legitimately take minutes (the
 *  desktop AI proxy allows 180s per request and retries transient failures), so
 *  the cap is generous, but it is a cap. Stays under the sidecar's own reply
 *  timeout so the owner gets this line rather than the sidecar's. */
const RUN_TIMEOUT_MS = 200_000;

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    const done = (v: T) => {
      clearTimeout(t);
      resolve(v);
    };
    p.then(done, () => done(fallback));
  });
}

/** Digits of the number part of a JID: "971501234567:12@s.whatsapp.net" and
 *  "971501234567" both come out as "971501234567". */
const num = (s: string | null | undefined) =>
  (s ?? "").split("@")[0].split(":")[0].replace(/\D/g, "");

/** Is this sender the owner? Exact match against the paired account itself
 *  (self-chat), the company WhatsApp number, or the owner number set in
 *  Integrations — that last one is how a spare SIM can be the bot while the
 *  owner talks to it from their own phone. Exact, not substring: a shorter
 *  number that sits inside the owner's would otherwise pass as the owner. */
export function isOwnerNumber(
  me: string | null | undefined,
  companyWa: string | null | undefined,
  from: string,
  ownerNumber?: string | null
): boolean {
  const f = num(from);
  if (!f) return false;
  return [me, companyWa, ownerNumber].some((c) => !!num(c) && num(c) === f);
}

async function isOwnerSender(from: string): Promise<boolean> {
  try {
    const me = (await bridgeState()).me;
    const { ownerNumber } = getBridgeConfig();
    return isOwnerNumber(me, (await billing.getCompany())?.whatsapp, from, ownerNumber);
  } catch {
    // offline / no profile — deny (the agent stays owner-only)
    return false;
  }
}

/** Mount the WhatsApp handler once at boot. Safe to call repeatedly. */
export function startWaAgent(): void {
  if (started || !hasDesktop) return;
  started = true;

  onWaMessage((m) => {
    queue = queue.then(() => handle(m)).catch(() => {});
  });
}

/** Answer one incoming message. Runs one at a time, off the queue. */
async function handle(m: WaMessage): Promise<void> {
  // Everything the bridge sees goes in the log, owner or customer: it is the
  // only record of the WhatsApp thread the in-app agent can read back (see
  // list_whatsapp_messages). WhatsApp itself offers no history to fetch.
  waLogAdd({ dir: "in", from: m.from, name: m.fromName, text: m.text });
  log.info("whatsapp", `message from ${m.from}`, m.text.slice(0, 120));
  const answer = async (text: string) => {
    // Empty stays empty: that is the deliberate silence for a non-owner, and it
    // is what releases the sidecar's pending promise.
    const out = waFormat(text);
    if (out) waLogAdd({ dir: "out", from: m.from, name: m.fromName, text: out });
    try {
      await replyWa(m.id, out);
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
  if (!(await isOwnerSender(m.from))) {
    // Silent to the sender, but never silent to the log: a wrong owner match is
    // indistinguishable from a broken bridge from the outside, and that cost a
    // long evening once.
    const me = await bridgeState().then((s) => s.me).catch(() => null);
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

  if (!aiReady()) {
    await answer("Filey AI isn't configured yet — add an AI key in Settings → AI Assistant first.");
    return;
  }

  try {
    const key = m.from || "unknown";
    // A "yes" approves the ONE call that was proposed last turn, not sensitive
    // tools in general — and only while that proposal is fresh. Anything else
    // the run tries is refused and re-proposed.
    const pending = AFFIRMATIVE.test(m.text.trim())
      ? pendingApproval.get(key)
      : undefined;
    const approvedSig =
      pending && Date.now() - pending.at <= APPROVAL_TTL_MS ? pending.sig : undefined;
    const allowSensitive = !!approvedSig;

    // The first refused call becomes the new pending proposal, so the reply the
    // owner reads and the call a later "yes" authorises are the same thing.
    let proposedSig: string | null = null;
    const confirm = (name: string, args: Record<string, unknown>) => {
      const sig = callSig(name, args);
      if (approvedSig && sig === approvedSig) return true;
      if (!proposedSig) proposedSig = sig;
      return false;
    };

    const baseSystem = buildSystemPrompt(
      `${SYSTEM}\n\n${FORMAT}`,
      getPersona(),
      [memoryDigest(), skillsIndex(), await businessBrief()].filter(Boolean).join("\n\n")
    );
    const system: AiMessage = {
      role: "system",
      text: allowSensitive
        ? baseSystem + "\n\nAPPROVAL GRANTED: the user just approved your pending request. Execute it now with the tools — do not ask again."
        : baseSystem,
    };

    const prev = history.get(key) ?? [];
    const userMsg: AiMessage = { role: "user", text: m.text };
    // null is the timeout marker — the agent itself always returns a string.
    const reply = await withTimeout<string | null>(
      aiAgent([system, ...prev, userMsg], {
        maxTokens: 2048,
        confirm,
        isOwner: true, // gated above — only the owner reaches this point
      }),
      RUN_TIMEOUT_MS,
      null
    );
    if (reply === null) {
      // Say so and drop the turn rather than holding the queue: the next
      // message must still get answered.
      await answer(
        "That one is taking longer than I can hold the line for — it may still be running in the app. Send it again, or ask me to check what got created."
      );
      return;
    }
    const text = reply?.trim() ? reply : "…";
    const next: AiMessage[] = [...prev, userMsg, { role: "assistant", text }];
    if (next.length > HISTORY_LIMIT) next.splice(0, next.length - HISTORY_LIMIT);
    history.set(key, next);

    if (proposedSig) pendingApproval.set(key, { sig: proposedSig, at: Date.now() });
    else pendingApproval.delete(key); // nothing outstanding — a stale "yes" must not land

    await answer(text);
  } catch (e) {
    // The reason matters over WhatsApp — there is no console to check.
    const why = e instanceof Error ? e.message : String(e);
    await answer(`Sorry — that failed on my side: ${why.slice(0, 300)}`);
  }
}
