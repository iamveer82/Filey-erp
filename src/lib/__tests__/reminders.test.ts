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
