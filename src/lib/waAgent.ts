// Filey's own agent, reachable over WhatsApp — same brain, memory and tools as
// the in-app chat, but driven entirely on-device (no server, no webhook).
//
// The WhatsApp bridge sidecar forwards each message here through the `wa-message`
// event; this runs the app's local agent and answers back through replyWa().
// Sensitive (money/outbound) tools go through a two-pass confirm: the first run
// denies them so the agent asks the user, and a "yes" reply re-runs with them
// allowed. Nothing leaves without approval.
import { aiAgent, aiReady, buildSystemPrompt, getPersona, type AiMessage } from "./ai";
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

const SYSTEM =
  "You are Filey, the user's AI business agent with full control of their ERP app via tools — you can read AND modify: stats, customers, products, invoices, quotes, orders, purchase orders, expenses, attendance, files, and navigation. You have long-term memory: use `remember` to save durable facts/preferences and `recall` to look them up. When asked to do something, execute the tool and confirm in one short line. Money/outbound actions require user approval: if a tool needs approval and is refused, tell the user exactly what you need approved and ask them to reply YES to proceed. Never invent data — look it up. Be concise and practical.";

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

/** Chats that have a proposal awaiting approval (a refused sensitive tool).
 *  A "yes" reply to one of these re-runs the agent with sensitive tools allowed. */
const pendingApproval = new Map<string, boolean>();

const AFFIRMATIVE = /^(yes|yep|y|ya|ok|okay|approve|confirm|go|do it|proceed|sure|agreed)$/i;

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
    await replyWa(m.id, "");
    return;
  }

  if (!aiReady()) {
    await replyWa(m.id, "Filey AI isn't configured yet — add an AI key in Settings → AI Assistant first.");
    return;
  }

  try {
    const key = m.from || "unknown";
    // A "yes" to a pending proposal is the second pass: sensitive tools allowed.
    const allowSensitive = pendingApproval.has(key) && AFFIRMATIVE.test(m.text.trim());

    let approvalHit = false;
    const confirm = (name: string, args: Record<string, unknown>) => {
      void name; void args; // refused below — the agent must ask the user
      if (allowSensitive) return true;
      approvalHit = true;
      return false;
    };

    const baseSystem = buildSystemPrompt(
      SYSTEM,
      getPersona(),
      [memoryDigest(), skillsIndex()].filter(Boolean).join("\n\n")
    );
    const system: AiMessage = {
      role: "system",
      text: allowSensitive
        ? baseSystem + "\n\nAPPROVAL GRANTED: the user just approved your pending request. Execute it now with the tools — do not ask again."
        : baseSystem,
    };

    const prev = history.get(key) ?? [];
    const userMsg: AiMessage = { role: "user", text: m.text };
    const reply = await aiAgent([system, ...prev, userMsg], {
      maxTokens: 1200,
      confirm,
      isOwner: true, // gated above — only the owner reaches this point
    });
    const text = reply?.trim() ? reply : "…";
    const next: AiMessage[] = [...prev, userMsg, { role: "assistant", text }];
    if (next.length > HISTORY_LIMIT) next.splice(0, next.length - HISTORY_LIMIT);
    history.set(key, next);

    if (approvalHit) pendingApproval.set(key, true);
    else pendingApproval.delete(key);

    await replyWa(m.id, text);
  } catch {
    await replyWa(m.id, "Sorry — something went wrong on my side. Try again in a moment.");
  }
}
