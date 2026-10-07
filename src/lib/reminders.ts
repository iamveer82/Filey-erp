// Reminder store — user-defined scheduled messages ("remind me to X at Y").
// Fired by the proactive agent and delivered to the owner over WhatsApp.
// Account/workspace scoped; unattributed legacy reminders remain untouched.
import { agentStorageKey, writeAgentStorage } from "./agentStorage";
export interface Reminder {
  id: string;
  text: string;
  /** Next fire time, epoch ms. */
  at: number;
  repeat?: "none" | "daily" | "weekly" | "monthly";
}

const KEY = "filey.reminders";

export function loadReminders(): Reminder[] {
  const key = agentStorageKey(KEY);
  if (!key) return [];
  const raw = localStorage.getItem(key);
  if (!raw) return [];
  let list: unknown;
  try { list = JSON.parse(raw); } catch { throw new Error("Your reminders could not be read. Saved reminders were not changed."); }
  validateReminders(list);
  return list;
}

function validateReminders(list: unknown): asserts list is Reminder[] {
  if (!Array.isArray(list) || list.some(r => !r || typeof r.id !== "string" || !r.id
    || typeof r.text !== "string" || !r.text.trim() || !Number.isFinite(r.at)
    || !Number.isFinite(new Date(r.at).getTime())
    || (r.repeat !== undefined && !["none", "daily", "weekly", "monthly"].includes(r.repeat))))
    throw new Error("Your reminders contain invalid details. Saved reminders were not changed.");
}

export function saveReminders(list: Reminder[], expectedScope?: string): void {
  validateReminders(list);
  writeAgentStorage(KEY, JSON.stringify(list), expectedScope);
}

export function addReminder(
  text: string,
  at: number,
  repeat: Reminder["repeat"] = "none"
): Reminder {
  const r: Reminder = {
    id: `rem_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    text,
    at,
    repeat,
  };
  saveReminders([...loadReminders(), r]);
  return r;
}

export function removeReminder(id: string): void {
  saveReminders(loadReminders().filter((r) => r.id !== id));
}

export function listReminders(): Reminder[] {
  return [...loadReminders()].sort((a, b) => a.at - b.at);
}

const DAY_MS = 86_400_000;
/** Mean Gregorian month: 146097 days per 400-year cycle, 4800 months. */
const MEAN_MONTH_MS = 30.436875 * DAY_MS;

/** The n-th occurrence after `at`, in local calendar terms so a 09:00 reminder
 *  stays at 09:00 across DST and a monthly one keeps its day of month (clamped
 *  to shorter months, e.g. the 31st → Feb 28th) instead of drifting. */
function occurrence(at: number, repeat: string, n: number): number {
  const d = new Date(at);
  if (repeat === "daily") d.setDate(d.getDate() + n);
  else if (repeat === "weekly") d.setDate(d.getDate() + 7 * n);
  else if (repeat === "monthly") {
    const dayOfMonth = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(dayOfMonth, lastDay));
  }
  return d.getTime();
}

/** Next fire time after `now`, catching up past-due repeats without stacking
 *  (a daily reminder the app missed for 3 days fires once, next, not 3×). */
export function nextOccurrence(at: number, repeat: string, now: number): number {
  const approxStep =
    repeat === "daily"
      ? DAY_MS
      : repeat === "weekly"
        ? 7 * DAY_MS
        : repeat === "monthly"
          ? MEAN_MONTH_MS
          : 0;
  if (!(approxStep > 0) || at > now) return at;
  // Jump straight to the estimated occurrence, then settle by a step or two:
  // the estimate is only off by DST shifts or month-length variation, so this
  // stays O(1) even for an `at` far in the past.
  let n = Math.max(1, Math.floor((now - at) / approxStep));
  let next = occurrence(at, repeat, n);
  while (next <= now) next = occurrence(at, repeat, ++n);
  while (n > 1) {
    const previous = occurrence(at, repeat, n - 1);
    if (previous <= now) break;
    next = previous;
    n--;
  }
  return next;
}
