import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearLog, log, logAsText, logEntries, onLog, supportSummary } from "../log";

beforeEach(() => {
  clearLog();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the diagnostics log", () => {
  it("keeps what happened, newest last, with its scope and level", () => {
    log.info("agent", "create_invoice_draft running");
    log.warn("whatsapp", "ignored 971500000000 — not the owner");

    const all = logEntries();
    expect(all).toHaveLength(2);
    expect(all[1]).toMatchObject({ scope: "whatsapp", level: "warn" });
  });

  it("filters by area and by level, which is how you find anything", () => {
    log.info("agent", "a");
    log.error("agent", "b");
    log.info("sync", "c");

    expect(logEntries({ scope: "agent" })).toHaveLength(2);
    expect(logEntries({ level: "error" })).toHaveLength(1);
    expect(logEntries({ scope: "sync", level: "error" })).toHaveLength(0);
  });

  it("records an Error as something readable rather than {}", () => {
    log.error("agent", "tool threw", new Error("Authentication Fails"));
    expect(logEntries()[0].detail).toBe("Error: Authentication Fails");
  });

  it("caps a large detail instead of holding a whole document in memory", () => {
    log.info("agent", "big", { blob: "x".repeat(5000) });
    expect(logEntries()[0].detail!.length).toBeLessThanOrEqual(500);
  });

  it("stays bounded — an app left open all day cannot grow forever", () => {
    for (let i = 0; i < 900; i++) log.info("agent", `entry ${i}`);
    const all = logEntries();
    expect(all.length).toBeLessThanOrEqual(400);
    // The oldest are the ones dropped.
    expect(all[all.length - 1].message).toBe("entry 899");
  });

  it("notifies a live viewer, and a broken one cannot break logging", () => {
    const seen: string[] = [];
    const off = onLog((e) => seen.push(e.message));
    onLog(() => {
      throw new Error("viewer blew up");
    });

    log.info("agent", "first");
    expect(seen).toEqual(["first"]);
    expect(logEntries()).toHaveLength(1); // logged despite the bad listener

    off();
    log.info("agent", "second");
    expect(seen).toEqual(["first"]); // unsubscribed
  });

  it("exports as text you can paste into a message", () => {
    log.warn("sync", "app_settings: 13 row(s) failed, will retry");
    const text = logAsText();
    expect(text).toContain("WARN");
    expect(text).toContain("[sync]");
    expect(text).toContain("13 row(s) failed");
  });
});

it("exports correlation IDs without any free-form private data", () => {
  log.error("agent", "customer@example.com invoice 500", {apiKey:"private-key", phone:"+971500000000"});
  log.warn("private-area-name", "secret document title");
  const result = supportSummary();
  expect(result).toContain(logEntries()[0].id);
  expect(JSON.parse(result).events[1].area).toBe("app");
  for (const secret of ["customer@example.com", "private-key", "+971500000000", "private-area-name", "secret document title"]) expect(result).not.toContain(secret);
});
