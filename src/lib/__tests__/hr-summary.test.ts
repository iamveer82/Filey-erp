import { beforeEach, describe, expect, it } from "vitest";
import { setDataMode } from "../dataMode";
import { hr } from "../api";
import { todayYmd } from "../format";

/* hr.summary() used to read the entire attendance table — every employee for
 * every day the company has ever operated — and then discard all but today's
 * rows in JavaScript, just to render two counters. It now narrows on the date
 * server-side.
 *
 * These guard the two ways that change could break: counting rows from other
 * days, and the date filter silently matching nothing (which would show a
 * permanent 0 present). Running in local mode also exercises the offline
 * shim's eq() on a string column, which is the part the cloud path doesn't
 * prove. */

beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
});

const OLD_DAY = "2020-01-02";

describe("hr.summary attendance counters", () => {
  it("counts only today, ignoring every earlier day", async () => {
    const alice = (await hr.createEmployee({ name: "Alice" } as never)) as number;
    const bob = (await hr.createEmployee({ name: "Bob" } as never)) as number;

    await hr.markAttendance(alice, todayYmd(), "present");
    await hr.markAttendance(bob, todayYmd(), "leave");
    // Same people, long-past days. If these leak in, the counters inflate
    // forever as history accumulates — the bug this is here to catch.
    await hr.markAttendance(alice, OLD_DAY, "present");
    await hr.markAttendance(bob, OLD_DAY, "present");

    const s = await hr.summary();
    expect(s.present_today).toBe(1);
    expect(s.on_leave).toBe(1);
  });

  it("reports zero when nobody is marked today", async () => {
    const carol = (await hr.createEmployee({ name: "Carol" } as never)) as number;
    await hr.markAttendance(carol, OLD_DAY, "present");

    const s = await hr.summary();
    expect(s.present_today).toBe(0);
    expect(s.on_leave).toBe(0);
  });

  it("still counts today's rows at all (date filter isn't matching nothing)", async () => {
    const dan = (await hr.createEmployee({ name: "Dan" } as never)) as number;
    await hr.markAttendance(dan, todayYmd(), "present");

    const s = await hr.summary();
    expect(s.present_today).toBe(1);
  });
});
