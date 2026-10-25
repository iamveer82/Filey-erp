// How much the agent may do on its own — one setting, four modes.
//
// Before this, every money/outbound tool asked every single time, which over
// WhatsApp means a "reply YES" round-trip per action. That is right when you
// are getting to know the agent and tiresome once you trust it, so the answer
// is a mode you choose rather than a prompt you re-answer.
//
// What counts as a "write" is not a new flag on 100+ tools: capabilities.ts
// already lists exactly the write/action tools (reads, navigation, memory and
// skills are deliberately absent), so membership there IS the write set.
import { CAPABILITIES, isWriteTool, setCapabilityEnabled } from "./capabilities";
import { readAgentStorage, writeAgentStorage } from "./agentStorage";

export type AgentMode = "auto" | "accept_edits" | "manual" | "plan";

export interface AgentModeInfo {
  id: AgentMode;
  name: string;
  description: string;
}

export const AGENT_MODES: AgentModeInfo[] = [
  {
    id: "auto",
    name: "Auto",
    description: "Full permission — runs everything, including sending and payments, without asking.",
  },
  {
    id: "accept_edits",
    name: "Accept edits",
    description:
      "Creates and edits records on its own; still asks before sending, emailing or marking money moved.",
  },
  {
    id: "manual",
    name: "Manual",
    description: "Asks before every action that changes anything. Reading is always free.",
  },
  {
    id: "plan",
    name: "Plan",
    description: "Looks things up and writes the plan first — makes no changes at all until you switch modes.",
  },
];

const KEY = "filey.agent.mode";
/** Today's behaviour: edits run, money/outbound asks. Changing modes is a
 *  deliberate act, so the default must not quietly widen what the agent may do. */
const DEFAULT: AgentMode = "accept_edits";

const valid = (v: unknown): v is AgentMode =>
  AGENT_MODES.some((m) => m.id === v);

export function getAgentMode(): AgentMode {
  try {
    const v = readAgentStorage(KEY);
    if (valid(v)) return v;
    // Unattributed legacy choices may restrict access, never grant it. Keep a
    // former Plan/Manual choice until this workspace explicitly chooses a mode.
    if (v === null) {
      const legacy = localStorage.getItem(KEY);
      if (legacy === "plan" || legacy === "manual") return legacy;
    }
    return DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function setAgentMode(mode: AgentMode): void {
  try {
    writeAgentStorage(KEY, mode);
  } catch {
    // A read-only localStorage must not break the agent; it stays on the default.
  }
}

/** The owner's rule (2026-10-24): sending a document or an invoice out always waits
 *  for their OK, Auto mode included. Plain messages stay on the mode's terms. */
export const ALWAYS_ASK_TOOLS: ReadonlySet<string> = new Set([
  "send_invoice", "send_invoice_whatsapp", "email_invoice", "share_document_link", "send_whatsapp_file",
]);

/** Full access is the in-app owner's pre-approval. WhatsApp and scheduled jobs
 *  keep their own confirm callback and do not use this. */
export function fullAccessPreapproved(mode: AgentMode = getAgentMode(), toolName?: string): boolean {
  return mode === "auto" && !(toolName && ALWAYS_ASK_TOOLS.has(toolName));
}

/** Desktop dev session: Full access, every action group on, except the optional
 *  per-conversation browser (that stays an explicit opt-in). */
export function grantDesktopFullAccess(): void {
  setAgentMode("auto");
  for (const cap of CAPABILITIES) {
    if (cap.id === "agent_computers") continue;
    setCapabilityEnabled(cap.id, true);
  }
}

/** run = go ahead, ask = get the user's approval first, block = refuse outright. */
export type Gate = "run" | "ask" | "block";

/**
 * What the current mode says about one tool call.
 *
 * `sensitive` is the tool's own flag (money and outbound: sending, marking
 * paid, emailing, posting). Those are the calls that cost real money or leave
 * the building, so they are the last thing any mode stops asking about.
 */
export function gateFor(
  toolName: string,
  sensitive = false,
  mode: AgentMode = getAgentMode()
): Gate {
  const writes = sensitive || isWriteTool(toolName);
  if (!writes) return "run"; // reads, navigation, memory, skills — always free
  switch (mode) {
    case "auto":
      return ALWAYS_ASK_TOOLS.has(toolName) ? "ask" : "run";
    case "plan":
      return "block";
    case "manual":
      return "ask";
    case "accept_edits":
      return sensitive ? "ask" : "run";
  }
}

/** Appended to the system prompt so the model works with the mode instead of
 *  discovering it one refused tool at a time. */
export function modeSystemNote(mode: AgentMode = getAgentMode()): string {
  switch (mode) {
    case "plan":
      return "PLAN MODE: you may read and look anything up, but every action that would change data is blocked. Do not attempt them. Investigate, then reply with a short numbered plan of exactly what you would do, and tell the user to switch out of Plan mode to run it.";
    case "manual":
      return "MANUAL MODE: every action that changes data needs the user's approval. Expect to be refused once, ask plainly for the go-ahead, and continue when they agree.";
    case "auto":
      return "AUTO MODE: the user has pre-approved your actions, including the terminal (run_shell), Windows apps (computer_use), messages and payments. Execute without asking — say plainly what you did. Sending a document or an invoice out still needs the user's OK: an approval card appears, so just make the call. If a command or click fails, read the result, adapt, and try a different step. Do not claim you have no terminal or no computer access.";
    case "accept_edits":
      return "";
  }
}
