// Runnable check for the inbound parser:  deno test supabase/functions/channel-webhook/
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseTelegramUpdate } from "./parse.ts";

Deno.test("parses a text message and trims it", () => {
  const r = parseTelegramUpdate({
    update_id: 1,
    message: { chat: { id: 42 }, from: { first_name: "Ada", last_name: "L" }, text: "  hi  " },
  });
  assertEquals(r, { channel: "telegram", externalId: "42", body: "hi", fromName: "Ada L" });
});

Deno.test("falls back to username, then 'there'", () => {
  assertEquals(parseTelegramUpdate({ message: { chat: { id: 7 }, from: { username: "ada" }, text: "yo" } })?.fromName, "ada");
  assertEquals(parseTelegramUpdate({ message: { chat: { id: 7 }, text: "yo" } })?.fromName, "there");
});

Deno.test("ignores non-actionable updates", () => {
  assertEquals(parseTelegramUpdate({ message: { chat: { id: 1 } } }), null); // no text
  assertEquals(parseTelegramUpdate({ message: { text: "x" } }), null); // no chat id
  assertEquals(parseTelegramUpdate({ edited_message: { chat: { id: 1 }, text: "x" } }), null); // edit, not a new message
  assertEquals(parseTelegramUpdate(null), null);
  assertEquals(parseTelegramUpdate("nope"), null);
});
