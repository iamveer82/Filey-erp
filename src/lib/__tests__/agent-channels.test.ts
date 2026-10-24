// One registry, so a channel is a row and not a fork.
//
// WhatsApp and Telegram each grew their own agent loop, and the rules that
// should have been shared drifted apart: one blocked the owner's computer, the
// other did not; one understood "YES" as approval, the other did not. The
// registry is now the single place that knows what a channel is, and these
// tests hold it to that.
import { describe, expect, it } from "vitest";
import {
  CHANNELS,
  CHANNEL_IDS,
  channelBlocksTool,
  channelIdFromAgentId,
  channelProfile,
  isAffirmative,
  isRemoteChannel,
  webhookHostAllowed,
} from "../channelRegistry";
import { offeredTools } from "../agentHarness";
import { TOOLS } from "../aiTools";

const names = (agentId?: string) =>
  offeredTools({ isOwner: true, agentId } as Parameters<typeof offeredTools>[0], new Set()).map(
    (t) => t.name
  );

describe("the channel registry", () => {
  it("knows every channel the agent can be reached on", () => {
    for (const id of ["app", "whatsapp", "telegram", "email", "slack", "teams", "discord"] as const) {
      expect(CHANNEL_IDS).toContain(id);
      const profile = CHANNELS[id];
      expect(profile.label.length).toBeGreaterThan(2);
      expect(profile.delivery.length).toBeGreaterThan(2);
      expect(profile.approveWords.length).toBeGreaterThan(0);
    }
  });

  it("reads the channel out of an agent id", () => {
    expect(channelIdFromAgentId("whatsapp:971500000001")).toBe("whatsapp");
    expect(channelIdFromAgentId("telegram:123")).toBe("telegram");
    expect(channelIdFromAgentId("link:abc")).toBe(null);
    expect(channelIdFromAgentId(undefined)).toBe(null);
    expect(isRemoteChannel("whatsapp:971500000001")).toBe(true);
    expect(isRemoteChannel("app")).toBe(false);
  });

  it("lets a phone ask for the screen but never open a shell", () => {
    expect(channelBlocksTool("whatsapp:1", "computer_use")).toBe(false);
    expect(channelBlocksTool("whatsapp:1", "browser")).toBe(false);
    expect(channelBlocksTool("whatsapp:1", "run_shell")).toBe(true);
    expect(channelBlocksTool("app", "computer_use")).toBe(false);
  });

  it("offers no card on a channel that cannot show one", () => {
    expect(channelBlocksTool("telegram:1", "show_ui")).toBe(true);
    expect(channelBlocksTool("telegram:1", "show_openui")).toBe(true);
    expect(channelBlocksTool("telegram:1", "card_templates")).toBe(true);
    expect(channelBlocksTool("app", "show_ui")).toBe(false);
  });

  it("means yes only on the exact word, per channel", () => {
    expect(isAffirmative("whatsapp", "YES")).toBe(true);
    expect(isAffirmative("whatsapp", "yes")).toBe(true);
    expect(isAffirmative("telegram", "نعم")).toBe(true);
    expect(isAffirmative("whatsapp", "yes please")).toBe(false);
    expect(isAffirmative("whatsapp", "no")).toBe(false);
  });

  it("refuses a delivery URL outside the channel's own hosts", () => {
    expect(webhookHostAllowed("slack", "https://hooks.slack.com/services/T/B/X")).toBe(true);
    expect(webhookHostAllowed("slack", "https://evil.example/steal")).toBe(false);
    expect(webhookHostAllowed("discord", "https://discord.com/api/webhooks/1/x")).toBe(true);
    expect(webhookHostAllowed("teams", "https://contoso.webhook.office.com/webhookb2/x")).toBe(true);
    expect(webhookHostAllowed("teams", "https://contoso.example/webhookb2/x")).toBe(false);
    expect(webhookHostAllowed("email", "https://hooks.slack.com/x")).toBe(false);
  });
});

describe("the agent's surface follows the channel", () => {
  it("never offers a shell to a phone", () => {
    const offered = names("whatsapp:971500000001");
    expect(offered).not.toContain("run_shell");
    // Computer use is allowed, but only the app can open a live session.
    expect(channelBlocksTool("whatsapp:971500000001", "computer_use")).toBe(false);
  });

  it("still offers them in the app", () => {
    // computer_use also needs a live computer session and its capability on;
    // what the channel decides is that the APP is never blocked from it.
    expect(channelBlocksTool("app", "computer_use")).toBe(false);
    expect(channelBlocksTool("app", "browser")).toBe(false);
  });

  it("reaches the user on any channel", () => {
    const send = TOOLS.find((t) => t.name === "send_to_channel");
    expect(send).toBeDefined();
    expect(send?.sensitive, "an outbound send must be approved").toBe(true);
    expect(TOOLS.find((t) => t.name === "list_channels")).toBeDefined();
  });

  it("keeps the profile table and the tool list in step", () => {
    const profiles = CHANNEL_IDS.map((id) => CHANNELS[id]);
    expect(profiles.every((p) => p.id && p.label)).toBe(true);
    expect(channelProfile("slack:x")?.id).toBe("slack");
  });
});
