import { beforeEach, expect, it } from "vitest";
import { setCacheOrg } from "../api";
import { readAgentStorage, writeAgentStorage } from "../agentStorage";
import { chatRecap, refreshIdleFileyAgentSession, SESSION_IDLE_MS, turnUsage } from "../fileyAgent";

it("reports each turn's own share of the session's usage totals", () => {
  expect(turnUsage("s-usage", { prompt: 16_000, output: 200, calls: 2, cache_read: 15_000 }))
    .toEqual({ type: "usage", input: 16_000, output: 200, calls: 2, cachedPct: 94 });
  expect(turnUsage("s-usage", { prompt: 33_000, output: 500, calls: 3, cache_read: 31_000 }))
    .toEqual({ type: "usage", input: 17_000, output: 300, calls: 1, cachedPct: 94 });
  expect(turnUsage("s-usage", { prompt: 33_000, output: 500, calls: 3 })).toBeNull();
  // The engine restarted: its counters began again, so these totals are the turn's alone.
  expect(turnUsage("s-usage", { prompt: 4_000, output: 90, calls: 1 })).toEqual({ type: "usage", input: 4_000, output: 90, calls: 1 });
  expect(turnUsage("s-usage", null)).toBeNull();
});

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
  setCacheOrg("test-org", "test-user");
});

it("restarts a chat's engine session only after it sat idle past the cut-off", () => {
  const now = Date.now();
  writeAgentStorage("filey.agent.hermesSessions", JSON.stringify({ idle: "s1", busy: "s2", untimed: "s3" }));
  writeAgentStorage("filey.agent.hermesSessionsAt", JSON.stringify({ idle: now - SESSION_IDLE_MS - 1, busy: now - 60_000 }));
  expect(refreshIdleFileyAgentSession("busy", now)).toBe(false);
  expect(refreshIdleFileyAgentSession("untimed", now)).toBe(false);
  expect(refreshIdleFileyAgentSession("never-seen", now)).toBe(false);
  expect(refreshIdleFileyAgentSession("idle", now)).toBe(true);
  expect(JSON.parse(readAgentStorage("filey.agent.hermesSessions") ?? "{}")).not.toHaveProperty("idle");
  expect(refreshIdleFileyAgentSession("idle", now)).toBe(false);
});

it("recaps only the last few messages, each clipped", () => {
  const long = "x".repeat(600);
  const recap = chatRecap([
    { role: "user", text: "first" }, { role: "assistant", text: "one" }, { role: "user", text: "make INV-7" },
    { role: "assistant", text: long }, { role: "system", text: "hidden" }, { role: "user", text: "  now email   it " },
  ], 3);
  expect(recap).not.toContain("first");
  expect(recap).not.toContain("hidden");
  expect(recap).toContain("Owner: make INV-7");
  expect(recap).toContain("Owner: now email it");
  expect(recap).toContain("x".repeat(280));
  expect(recap).not.toContain("x".repeat(281));
  expect(chatRecap([])).toBe("");
});
