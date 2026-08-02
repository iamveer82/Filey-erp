import { describe, it, expect, vi, beforeEach } from "vitest";

const aiChat = vi.fn();
const aiReady = vi.fn();
vi.mock("../ai", () => ({ aiChat, aiReady }));

const { narrateInsights } = await import("../insightsNarrative");
import type { Insight } from "../insights";

const insight = (over: Partial<Insight> = {}): Insight => ({
  kind: "overdue",
  severity: "critical",
  title: "AED 12,000 overdue from 2 customers",
  detail: "Largest: Acme — AED 9,000, oldest 45 days late.",
  ...over,
});

beforeEach(() => {
  aiChat.mockReset().mockResolvedValue("  You are owed AED 12,000.  ");
  aiReady.mockReset().mockReturnValue(true);
});

describe("narrateInsights", () => {
  it("passes every finding to the model and trims the reply", async () => {
    const out = await narrateInsights([insight(), insight({ kind: "stock" })], {
      currency: "AED",
    });
    expect(out).toBe("You are owed AED 12,000.");

    const [messages] = aiChat.mock.calls[0];
    expect(messages[0].role).toBe("system");
    // The guardrail that keeps invented numbers out of a money summary.
    expect(messages[0].text).toMatch(/only the figures given/i);
    expect(messages[1].text).toContain("Currency: AED");
    expect(messages[1].text.match(/^- \(/gm)).toHaveLength(2);
  });

  it("stays silent with no findings or no key, without calling the model", async () => {
    expect(await narrateInsights([])).toBe("");

    aiReady.mockReturnValue(false);
    expect(await narrateInsights([insight()])).toBe("");

    expect(aiChat).not.toHaveBeenCalled();
  });
});
