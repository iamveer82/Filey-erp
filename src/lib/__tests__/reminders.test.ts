import { beforeEach, describe, expect, it } from "vitest";
import {
  addReminder,
  loadReminders,
  listReminders,
  removeReminder,
  nextOccurrence,
} from "../reminders";

beforeEach(() => localStorage.clear());

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
});
