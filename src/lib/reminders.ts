// Reminder store — user-defined scheduled messages ("remind me to X at Y").
// Fired by the proactive agent and delivered to the owner over WhatsApp.
// localStorage-backed; resets only if the app data is cleared.
export interface Reminder {
  id: string;
  text: string;
  /** Next fire time, epoch ms. */
  at: number;
  repeat?: "none" | "daily" | "weekly" | "monthly";
}

const KEY = "filey.reminders";

export function loadReminders(): Reminder[] {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? (v as Reminder[]) : [];
  } catch {
    return [];
  }
}

export function saveReminders(list: Reminder[]): void {
  localStorage.setItem(KEY, JSON.stringify(list));
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
  let next = at;
  while (next <= now && step > 0) next += step; // ponytail: O(n) catch-up, fine at this scale
  return next;
}
