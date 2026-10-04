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

/** Next fire time after `now`, catching up past-due repeats without stacking
 *  (a daily reminder the app missed for 3 days fires once, next, not 3×). */
export function nextOccurrence(at: number, repeat: string, now: number): number {
  const step =
    repeat === "daily"
      ? 86_400_000
      : repeat === "weekly"
        ? 604_800_000
        : repeat === "monthly"
          ? 2_592_000_000
          : 0;
  return step > 0 && at <= now ? at + (Math.floor((now - at) / step) + 1) * step : at;
}
