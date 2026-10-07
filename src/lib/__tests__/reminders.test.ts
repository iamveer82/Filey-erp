import { beforeEach, describe, expect, it, vi } from "vitest";
const identity = vi.hoisted(() => ({ scope: "org:user:alice" as string | null }));
vi.mock("../api", () => ({ getCacheScope: () => identity.scope }));
import {
  addReminder,
  loadReminders,
  listReminders,
  removeReminder,
  nextOccurrence,
  saveReminders,
} from "../reminders";
import { agentStorageKey, agentStorageScope } from "../agentStorage";

beforeEach(() => {
  localStorage.clear(); localStorage.setItem("filey_data_mode", "local");
  identity.scope = "org:user:alice";
});

describe("reminders", () => {
  it("adds, lists, and removes", () => {
    addReminder("call X", Date.now() + 1000);
    expect(loadReminders()).toHaveLength(1);
    const r = listReminders()[0];
    removeReminder(r.id);
    expect(loadReminders()).toHaveLength(0);
  });

  it("nextOccurrence catches up past-due repeats without stacking", () => {
    const now = Date.now();
    const next = nextOccurrence(now - 3 * 86_400_000, "daily", now);
    expect(next).toBeGreaterThan(now);
    expect(next).toBeLessThanOrEqual(now + 86_400_000);
  });

  it("nextOccurrence keeps the wall-clock time and day of month across repeats", () => {
    const local = (y: number, m: number, d: number, h = 9) => new Date(y, m, d, h, 0, 0, 0).getTime();
    // Daily/weekly: the next fire is the same local time on a later calendar day,
    // never shifted by an hour after a DST change.
    const daily = new Date(nextOccurrence(local(2026, 2, 1), "daily", local(2026, 2, 30, 12)));
    expect([daily.getHours(), daily.getMinutes()]).toEqual([9, 0]);
    expect(daily.getTime()).toBe(local(2026, 2, 31));
    const weekly = new Date(nextOccurrence(local(2026, 0, 5), "weekly", local(2026, 10, 2, 12)));
    expect(weekly.getDay()).toBe(1);
    expect(weekly.getHours()).toBe(9);
    // Monthly: fires on the anchor's day of month (clamped in short months) and
    // does not drift the way a fixed 30-day step does.
    expect(nextOccurrence(local(2026, 0, 31), "monthly", local(2026, 1, 1))).toBe(local(2026, 1, 28));
    expect(nextOccurrence(local(2026, 0, 31), "monthly", local(2026, 2, 1))).toBe(local(2026, 2, 31));
    expect(nextOccurrence(local(2026, 0, 15), "monthly", local(2027, 5, 20))).toBe(local(2027, 6, 15));
    // Future reminders and one-off reminders are left alone.
    expect(nextOccurrence(local(2030, 0, 1), "daily", local(2026, 0, 1))).toBe(local(2030, 0, 1));
    expect(nextOccurrence(local(2020, 0, 1), "none", local(2026, 0, 1))).toBe(local(2020, 0, 1));
  });

  it("isolates reminders by account, workspace and mode, preserving unattributed legacy data", () => {
    localStorage.setItem("filey.reminders", '[{"text":"legacy private reminder"}]');
    addReminder("Alice's private reminder", 1000);
    for (const [mode, scope] of [["local", "org:user:bob"], ["local", "other:user:alice"], ["cloud", "org:user:alice"]]) {
      localStorage.setItem("filey_data_mode", mode); identity.scope = scope;
      expect(loadReminders()).toEqual([]);
    }
    localStorage.setItem("filey_data_mode", "local");
    expect(loadReminders()[0].text).toContain("Alice");
    expect(localStorage.getItem("filey.reminders")).toContain("legacy private reminder");
    const original = agentStorageScope()!;
    identity.scope = "org:user:bob";
    expect(() => saveReminders([], original)).toThrow(/account changed/);
    identity.scope = null;
    expect(loadReminders()).toEqual([]);
    expect(() => addReminder("Anonymous", 1000)).toThrow(/Sign in/);
  });

  it("preserves damaged saved data and rejects invalid reminder dates before saving", () => {
    const key = agentStorageKey("filey.reminders")!;
    localStorage.setItem(key, "damaged");
    expect(() => addReminder("New reminder", 1000)).toThrow(/could not be read/);
    expect(localStorage.getItem(key)).toBe("damaged");
    localStorage.removeItem(key);
    for (const at of [NaN, Infinity, 9e15]) expect(() => addReminder("Invalid", at)).toThrow(/invalid details/);
    expect(loadReminders()).toEqual([]);
    expect(nextOccurrence(-8e15, "daily", Date.now())).toBeGreaterThan(Date.now());
  });
});
