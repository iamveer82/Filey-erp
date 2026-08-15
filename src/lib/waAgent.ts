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
import { bridgeState, hasDesktop, onWaMessage, replyWa } from "./waBridge";
import { billing } from "./api";

const SYSTEM =
  "You are Filey, the user's AI business agent with full control of their ERP app via tools — you can read AND modify: stats, customers, products, invoices, quotes, orders, purchase orders, expenses, attendance, files, and navigation. You have long-term memory: use `remember` to save durable facts/preferences and `recall` to look them up. When asked to do something, execute the tool and confirm in one short line. Money/outbound actions require user approval: if a tool needs approval and is refused, tell the user exactly what you need approved and ask them to reply YES to proceed. Never invent data — look it up. Be concise and practical.";

let started = false;
let busy = false;

/** Rolling per-chat history keyed by sender, so the agent remembers context
 *  ("same as before" actually lands). ponytail: in-memory Map — resets on app
 *  restart. Persist to localStorage if history must survive restarts. */
const history = new Map<string, AiMessage[]>();
const HISTORY_LIMIT = 20; // user+assistant turns kept per chat

/** Chats that have a proposal awaiting approval (a refused sensitive tool).
 *  A "yes" reply to one of these re-runs the agent with sensitive tools allowed. */
const pendingApproval = new Map<string, boolean>();

const AFFIRMATIVE = /^(yes|yep|y|ya|ok|okay|approve|confirm|go|do it|proceed|sure|agreed)$/i;

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/** Is this sender the owner? True for self-chat on the paired number, or for
 *  the company WhatsApp number from the profile. Customers get false, so they
 *  can never reach owner-only tools. */
async function isOwnerSender(from: string): Promise<boolean> {
  const f = digits(from);
  if (!f) return false;
  try {
    const me = (await bridgeState()).me;
    if (me && me.includes(f)) return true; // self-chat on the paired number
    const wa = digits((await billing.getCompany())?.whatsapp);
    if (wa && wa === f) return true;
  } catch {
    // offline — fall through to false (deny owner-only tools)
  }
  return false;
}

/** Mount the WhatsApp handler once at boot. Safe to call repeatedly. */
export function startWaAgent(): void {
  if (started || !hasDesktop) return;
  started = true;

  onWaMessage(async (m) => {
    if (!aiReady()) {
      await replyWa(m.id, "Filey AI isn't configured yet — add an AI key in Settings → AI Assistant first.");
      return;
    }
    if (busy) {
      await replyWa(m.id, "One moment — still finishing the previous request.");
      return;
    }
    busy = true;
    try {
      const key = m.from || "unknown";
      // A "yes" to a pending proposal is the second pass: sensitive tools allowed.
      const allowSensitive = pendingApproval.has(key) && AFFIRMATIVE.test(m.text.trim());
      const isOwner = await isOwnerSender(m.from);

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
        isOwner,
      });
      const text = reply?.trim() ? reply : "…";
      const next: AiMessage[] = [...prev, userMsg, { role: "assistant", text }];
      if (next.length > HISTORY_LIMIT) next.splice(0, next.length - HISTORY_LIMIT);
      history.set(key, next);

      if (approvalHit) pendingApproval.set(key, true);
      else pendingApproval.delete(key);

      await replyWa(m.id, text);
    } catch (e) {
      await replyWa(m.id, "Sorry — something went wrong on my side. Try again in a moment.");
    } finally {
      busy = false;
    }
  });
}
