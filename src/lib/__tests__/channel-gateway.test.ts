import { describe, expect, it } from "vitest";
import { acceptChannelWebhook, GATEWAY_CONNECTS } from "../channelGateway";

describe("the local channel gateway", () => {
  it("connects every chat without a paid key", () => {
    expect(GATEWAY_CONNECTS.map(item => item.id)).toEqual(["whatsapp", "telegram", "slack", "discord", "teams", "email"]);
    expect(GATEWAY_CONNECTS.every(item => item.paidKey === false)).toBe(true);
    expect(GATEWAY_CONNECTS.find(item => item.id === "whatsapp")?.kind).toBe("qr");
    expect(GATEWAY_CONNECTS.find(item => item.id === "telegram")?.steps).toContain("BotFather");
  });

  it("accepts a channel's own https webhook and refuses any other address", () => {
    expect(acceptChannelWebhook("slack", "https://hooks.slack.com/services/T/B/x")).toContain("hooks.slack.com");
    expect(() => acceptChannelWebhook("slack", "https://evil.example/hook")).toThrow("Slack");
    expect(() => acceptChannelWebhook("discord", "http://discord.com/api/webhooks/1/x")).toThrow("https");
  });
});
