// Proactive agent: runs the local agent on a schedule (daily summary + periodic
// low-stock / overdue alerts) and delivers results to the owner over WhatsApp.
// Everything runs on-device; nothing is sent unless the bridge is paired and
// the owner's number resolves.
import { aiAutonomous, aiReady, DENY_SENSITIVE } from "./ai";
import { log } from "./log";
import { bridgeState, getBridgeConfig, hasDesktop, onBridgeState, sendWa } from "./waBridge";
import { loadReminders, nextOccurrence, saveReminders } from "./reminders";
import { waFormat } from "./waAgent";

let started = false;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAILY_KEY = "filey.proactive.daily";
const ALERTS_KEY = "filey.proactive.alerts";
/** After a failed run, wait this long before trying again — short enough that
 *  a transient outage isn't a full-day blackout, long enough that a WhatsApp
 *  reconnect storm can't fire an agent run per flap. */
const FAILURE_RETRY_MS = 10 * 60 * 1000;

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

function readStamp(key: string): number {
  try {
    return Number(localStorage.getItem(key) || "0") || 0;
  } catch {
    return 0;
  }
}
function writeStamp(key: string, at: number): void {
  try {
    localStorage.setItem(key, String(at));
  } catch (e) {
    console.error(`Failed to write "${key}" to localStorage`, e);
  }
}

/** The JID to notify: the CONNECTED account's own chat.
 *
 *  The company profile's WhatsApp number is deliberately not used. That is the
 *  number printed on invoices — customers message it, and it is often not the
 *  phone the owner reads. Alerts went there whenever it differed from the
 *  paired account, which is a business inbox getting the owner's stock and
 *  revenue lines. The only override is the owner number set in Integrations,
 *  which exists precisely for "a spare SIM is the bot, my phone is the owner". */
async function ownerJid(): Promise<string | null> {
  const me = (await bridgeState()).me;
  if (!me) return null;
  const own = digits(getBridgeConfig().ownerNumber);
  return own ? `${own}@s.whatsapp.net` : me;
}

/** Same house style as the WhatsApp replies — WhatsApp markup, not markdown.
 *  The header line is added on send by waFormat(). */
const WA_STYLE =
  "This goes out over WhatsApp: use *bold* for key values, a *BOLD CAPS* heading before a list, and `· Label — value` for items. Never markdown (#, **, ---, tables) and no emojis — they render as raw characters.";

const DAILY_GOAL =
  "Write a short daily summary for the business owner. Look up the numbers with your tools — do NOT invent. Cover: invoices/orders created today, revenue, new customers, and anything notable. Keep it under 120 words. Start with '*DAILY SUMMARY*'. " +
  WA_STYLE;

const ALERTS_GOAL =
  "Check for (1) products at or below their reorder point and (2) invoices past their due date still unpaid. Look up the real numbers with your tools. If nothing needs attention, reply with exactly the word NONE. Otherwise list each item: product name and current stock; invoice number, customer, days overdue, and amount. " +
  WA_STYLE;

/** Run one proactive sweep. Returns whether it COMPLETED — a failed run must
 *  not consume its slot's throttle, or a transient failure blacks the alert
 *  out for a whole day and nobody is told why it went quiet. */
async function run(kind: "daily" | "alerts"): Promise<boolean> {
  if (!aiReady()) return false;
  const to = await ownerJid();
  if (!to) return false; // bridge not paired — nothing to send through
  try {
    const text = (
      await aiAutonomous(kind === "daily" ? DAILY_GOAL : ALERTS_GOAL, {
        maxTokens: 900,
        // This fires hourly with nobody watching, and its goal names overdue
        // invoices and low stock — i.e. it is holding a list of customers and
        // suppliers. It reports to the owner; it does not get to contact them.
        confirm: DENY_SENSITIVE,
      })
    ).trim();
    if (!text) return true; // nothing worth sending — done, don't retry
    if (kind === "alerts" && text.toUpperCase() === "NONE") return true;
    await sendWa(to, waFormat(text));
    return true;
  } catch (e) {
    log.warn("agent", `proactive ${kind} failed`, e);
    return false;
  }
}

/** Fire any reminders that have come due, rescheduling repeats. A one-off
 *  reminder is only dropped once its WhatsApp send actually succeeded — a
 *  transient failure used to delete it outright, silently losing whatever the
 *  owner had asked to be told about. */
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
    const sent = to
      ? await sendWa(to, waFormat(`*REMINDER* — ${r.text}`)).then(
          () => true,
          () => false
        )
      : false;
    if (r.repeat && r.repeat !== "none") {
      // Repeats move forward regardless — a missed ping shouldn't stack up.
      remaining.push({ ...r, at: nextOccurrence(r.at, r.repeat, now) });
    } else if (!sent) {
      remaining.push(r); // keep until it actually goes out
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
   *  run — an LLM bill and a WhatsApp message per flap. The timestamp is
   *  written AFTER the run: a failed run only buys a short backoff, not a
   *  full day of silence. */
  const throttled = async (kind: "daily" | "alerts", key: string, every: number) => {
    const last = readStamp(key);
    if (Date.now() - last < every) return;
    const ok = await run(kind);
    writeStamp(key, ok ? Date.now() : Date.now() - every + FAILURE_RETRY_MS);
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
