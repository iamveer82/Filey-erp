// Runnable check for the Slack parser:  deno test supabase/functions/channel-webhook/
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isSlackUrlVerification, parseSlackEvent } from "./parse.ts";

Deno.test("isSlackUrlVerification detects the handshake only", () => {
  assertEquals(isSlackUrlVerification({ type: "url_verification", challenge: "abc" }), true);
  assertEquals(isSlackUrlVerification({ type: "event_callback" }), false);
  assertEquals(isSlackUrlVerification(null), false);
  assertEquals(isSlackUrlVerification("nope"), false);
});

Deno.test("parses a message event and strips mention tokens", () => {
  const r = parseSlackEvent({
    type: "event_callback",
    event: {
      type: "message",
      channel: "C0123",
      user: "U0456",
      text: "<@U0BOT>   what's my cash position? ",
      ts: "1765000000.000100",
    },
  });
  assertEquals(r, {
    channel: "slack",
    externalId: "C0123",
    userId: "U0456",
    body: "what's my cash position?",
    fromName: "there",
  });
});

Deno.test("ignores bot messages and every subtype", () => {
  const base = { type: "event_callback", event: { type: "message", channel: "C1", user: "U1", text: "hi" } };
  // bot_id present
  assertEquals(parseSlackEvent({ ...base, event: { ...base.event, bot_id: "B1" } }), null);
  // subtype bot_message (no human text guarantee)
  assertEquals(parseSlackEvent({ ...base, event: { ...base.event, subtype: "bot_message" } }), null);
  // subtype message_changed (edit)
  assertEquals(parseSlackEvent({ ...base, event: { ...base.event, subtype: "message_changed" } }), null);
  // a plain human message has subtype === undefined → parsed
  assertEquals(parseSlackEvent(base)?.body, "hi");
});

Deno.test("ignores non-messages, empty text and wrong payload types", () => {
  assertEquals(parseSlackEvent({ type: "url_verification", challenge: "abc" }), null);
  assertEquals(parseSlackEvent({ type: "event_callback", event: { type: "reaction_added", user: "U1" } }), null);
  // text that is only a mention strips to nothing
  assertEquals(parseSlackEvent({
    type: "event_callback",
    event: { type: "message", channel: "C1", user: "U1", text: "<@U0BOT>" },
  }), null);
  assertEquals(parseSlackEvent({
    type: "event_callback",
    event: { type: "message", channel: "C1", user: "U1", text: "   " },
  }), null);
  assertEquals(parseSlackEvent(null), null);
  assertEquals(parseSlackEvent("nope"), null);
});
