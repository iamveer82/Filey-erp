// Proactive agent: runs the local agent on a schedule (daily summary + periodic
// low-stock / overdue alerts) and delivers results to the owner over WhatsApp.
// Everything runs on-device; nothing is sent unless the bridge is paired and
// the owner's number resolves.
import { aiAutonomous, aiReady } from "./ai";
import { bridgeState, hasDesktop, onBridgeState, sendWa } from "./waBridge";
import { billing } from "./api";
import { loadReminders, nextOccurrence, saveReminders } from "./reminders";

let started = false;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAILY_KEY = "filey.proactive.daily";
const ALERTS_KEY = "filey.proactive.alerts";

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/** The JID to notify. Self-chat when the paired number is the owner's, else the
 *  owner's own number from the company profile. */
async function ownerJid(): Promise<string | null> {
  const me = (await bridgeState()).me;
  if (!me) return null;
  try {
    const wa = digits((await billing.getCompany())?.whatsapp);
    if (wa && me.includes(wa)) return me; // paired number IS the owner
    if (wa) return `${wa}@s.whatsapp.net`;
  } catch {
    // offline / no profile — fall through to self-chat
  }
  return me;
}

const DAILY_GOAL =
  "Write a short daily summary for the business owner. Look up the numbers with your tools — do NOT invent. Cover: invoices/orders created today, revenue, new customers, and anything notable. Keep it under 120 words, plain text, no markdown, no emojis, no bullet symbols. Start with 'Daily summary:'.";

const ALERTS_GOAL =
  "Check for (1) products at or below their reorder point and (2) invoices past their due date still unpaid. Look up the real numbers with your tools. If nothing needs attention, reply with exactly the word NONE. Otherwise list each item in plain sentences: product name and current stock; invoice number, customer, days overdue, and amount. Plain text, no markdown, no emojis, no bullet symbols.";

async function run(kind: "daily" | "alerts"): Promise<void> {
  if (!aiReady()) return;
  const to = await ownerJid();
  if (!to) return; // bridge not paired — nothing to send through
  try {
    const text = (
      await aiAutonomous(kind === "daily" ? DAILY_GOAL : ALERTS_GOAL, {
        maxTokens: 900,
      })
    ).trim();
    if (!text) return;
    if (kind === "alerts" && text.toUpperCase() === "NONE") return; // stay quiet
    await sendWa(to, text);
  } catch (e) {
    console.warn(`proactive ${kind} failed:`, e);
  }
}

/** Fire any reminders that have come due, rescheduling repeats. One-off
 *  reminders are dropped after firing. Each is sent to the owner over WhatsApp. */
async function fireDueReminders(): Promise<void> {
  const now = Date.now();
  const list = loadReminders();
  if (!list.length) return;
  const remaining: typeof list = [];
  let changed = false;
  for (const r of list) {
    if (r.at > now) {
      remaining.push(r);
      continue;
    }
    changed = true;
    const to = await ownerJid();
    if (to) await sendWa(to, `Reminder: ${r.text}`).catch(() => {});
    if (r.repeat && r.repeat !== "none") {
      remaining.push({ ...r, at: nextOccurrence(r.at, r.repeat, now) });
    }
  }
  if (changed) saveReminders(remaining);
}

/** Mount once at boot: sweep on every bridge connect, then alerts hourly. */
export function startProactiveAgent(): void {
  if (started || !hasDesktop) return;
  started = true;

  /** Run at most once per `every` ms, across restarts. A dropped WhatsApp
   *  socket reconnects freely, and every reconnect used to fire a fresh agent
   *  run — an LLM bill and a WhatsApp message per flap. */
  const throttled = async (kind: "daily" | "alerts", key: string, every: number) => {
    const last = Number(localStorage.getItem(key) || "0");
    if (Date.now() - last < every) return;
    localStorage.setItem(key, String(Date.now()));
    await run(kind);
  };

  onBridgeState((s) => {
    if (s.state !== "connected") return;
    void throttled("daily", DAILY_KEY, DAY_MS);
    void throttled("alerts", ALERTS_KEY, HOUR_MS);
    void fireDueReminders();
  });
  setInterval(() => void throttled("alerts", ALERTS_KEY, HOUR_MS), HOUR_MS);
  setInterval(() => void fireDueReminders(), 30_000);
}
