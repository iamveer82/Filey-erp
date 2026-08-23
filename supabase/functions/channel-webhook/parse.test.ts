// Runnable check for the inbound parser:  deno test supabase/functions/channel-webhook/
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseSlackEvent, parseTelegramUpdate, parseWhatsAppWebhook } from "./parse.ts";

Deno.test("parses a text message and trims it", () => {
  const r = parseTelegramUpdate({
    update_id: 1,
    message: { chat: { id: 42, type: "private" }, from: { id: 7, first_name: "Ada", last_name: "L" }, text: "  hi  " },
  });
  assertEquals(r, {
    channel: "telegram",
    externalId: "42",
    body: "hi",
    fromName: "Ada L",
    chatType: "private",
    senderId: "7",
    msgId: "1",
  });
});

Deno.test("falls back to username, then 'there'", () => {
  assertEquals(
    parseTelegramUpdate({ update_id: 2, message: { chat: { id: 7 }, from: { username: "ada" }, text: "yo" } })?.fromName,
    "ada",
  );
  assertEquals(parseTelegramUpdate({ message: { chat: { id: 7 }, text: "yo" } })?.fromName, "there");
});

Deno.test("captures group type and sender id for the group-chat owner pin", () => {
  const r = parseTelegramUpdate({
    update_id: 3,
    message: { chat: { id: -100123, type: "supergroup" }, from: { id: 999 }, text: "APPROVE 1234" },
  });
  assertEquals(r?.chatType, "supergroup");
  assertEquals(r?.senderId, "999");
});

Deno.test("carries the telegram update_id as the dedup id", () => {
  assertEquals(parseTelegramUpdate({ update_id: 98, message: { chat: { id: 1 }, text: "x" } })?.msgId, "98");
  assertEquals(parseTelegramUpdate({ message: { chat: { id: 1 }, text: "x" } })?.msgId, undefined);
});

Deno.test("ignores non-actionable updates", () => {
  assertEquals(parseTelegramUpdate({ message: { chat: { id: 1 } } }), null); // no text
  assertEquals(parseTelegramUpdate({ message: { text: "x" } }), null); // no chat id
  assertEquals(parseTelegramUpdate({ edited_message: { chat: { id: 1 }, text: "x" } }), null); // edit, not a new message
  assertEquals(parseTelegramUpdate(null), null);
  assertEquals(parseTelegramUpdate("nope"), null);
});

Deno.test("whatsapp messages carry their provider message id", () => {
  const msgs = parseWhatsAppWebhook({
    entry: [{
      changes: [{
        value: {
          contacts: [{ profile: { name: "Omar" } }],
          messages: [{ type: "text", from: "971500000000", id: "wamid.ABC", text: { body: "hello" } }],
        },
      }],
    }],
  });
  assertEquals(msgs.length, 1);
  assertEquals(msgs[0].msgId, "wamid.ABC");
});

Deno.test("slack events carry the envelope event_id as the dedup id", () => {
  const r = parseSlackEvent({
    type: "event_callback",
    event_id: "Ev111",
    event: { type: "message", channel: "C1", user: "U1", text: "<@U9> hi" },
  });
  assertEquals(r?.msgId, "Ev111");
  assertEquals(r?.body, "hi");
});
