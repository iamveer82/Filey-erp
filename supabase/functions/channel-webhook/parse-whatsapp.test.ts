// Runnable check for the WhatsApp parser:  deno test supabase/functions/channel-webhook/
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseWhatsAppWebhook } from "./parse.ts";

Deno.test("parses a text message from a Meta Cloud API payload", () => {
  const r = parseWhatsAppWebhook({
    object: "whatsapp_business_account",
    entry: [{
      id: "123",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "971500000001", phone_number_id: "999" },
          contacts: [{ profile: { name: "Ada Lovelace" }, wa_id: "971500000002" }],
          messages: [{
            from: "971500000002",
            id: "wamid.abc",
            timestamp: "1765000000",
            type: "text",
            text: { body: "  what's my cash position?  " },
          }],
        },
      }],
    }],
  });
  assertEquals(r, [{
    channel: "whatsapp",
    externalId: "971500000002",
    body: "what's my cash position?",
    fromName: "Ada Lovelace",
    msgId: "wamid.abc", // dedup id — a redelivered webhook must not answer twice
  }]);
});

Deno.test("handles multiple messages across entries and falls back to 'there'", () => {
  const r = parseWhatsAppWebhook({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [{
          value: {
            contacts: [],
            messages: [
              { from: "111", type: "text", text: { body: "one" } },
              { from: "111", type: "image", image: { id: "x" } }, // non-text ignored
              { from: "111", type: "text", text: { body: "two" } },
            ],
          },
        }],
      },
      {
        changes: [{
          value: {
            messages: [{ from: "222", type: "text", text: { body: "three" } }],
          },
        }],
      },
    ],
  });
  assertEquals(r.map((m) => m.body), ["one", "two", "three"]);
  assertEquals(r[0].fromName, "there");
});

Deno.test("returns [] for status callbacks, empty text and junk", () => {
  // Read receipts / delivery statuses carry `statuses`, not `messages`.
  assertEquals(parseWhatsAppWebhook({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value: { statuses: [{ id: "wamid.abc", status: "read" }] } }] }],
  }), []);
  assertEquals(parseWhatsAppWebhook({
    entry: [{ changes: [{ value: { messages: [{ from: "1", type: "text", text: { body: "   " } }] } }] }],
  }), []);
  assertEquals(parseWhatsAppWebhook({ object: "whatsapp_business_account", entry: [] }), []);
  assertEquals(parseWhatsAppWebhook(null), []);
  assertEquals(parseWhatsAppWebhook("nope"), []);
});
