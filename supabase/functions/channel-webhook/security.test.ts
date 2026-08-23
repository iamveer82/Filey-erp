// Runnable check for the webhook security primitives.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  claimSeenMessage,
  randomCode,
  timingSafeEqualStr,
  verifySlackSignature,
  verifyWhatsAppSignature,
} from "./security.ts";

Deno.test("timingSafeEqualStr matches equal strings and rejects others", async () => {
  assertEquals(await timingSafeEqualStr("abc", "abc"), true);
  assertEquals(await timingSafeEqualStr("abc", "abd"), false);
  // Length mismatches must be false — never a throw, never a leak-through.
  assertEquals(await timingSafeEqualStr("abc", "ab"), false);
  assertEquals(await timingSafeEqualStr("", ""), true);
  assertEquals(await timingSafeEqualStr("", "x"), false);
});

Deno.test("randomCode draws only valid digit codes and varies", () => {
  for (let i = 0; i < 200; i++) {
    const c = randomCode(4);
    assertEquals(c.length, 4);
    assertEquals(/^\d{4}$/.test(c), true, `not 4 digits: ${c}`);
  }
  const seen = new Set<string>();
  for (let i = 0; i < 100; i++) seen.add(randomCode(4));
  // A Math.random-style generator would still pass uniqueness checks by luck;
  // what this really pins is format + spread across the space.
  if (seen.size < 50) throw new Error(`suspiciously few distinct codes: ${seen.size}`);
});

// ---- fail-closed signature verification ----

function slackReq(ts: number, sig: string): Request {
  return new Request("https://x.test/webhook", {
    method: "POST",
    headers: { "X-Slack-Request-Timestamp": String(ts), "X-Slack-Signature": sig },
    body: "{}",
  });
}

Deno.test("slack signature verifies with the right secret and replay window", async () => {
  const ts = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode("s3cret"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`v0:${ts}:{"a":1}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  assertEquals(await verifySlackSignature(slackReq(ts, `v0=${hex}`), '{"a":1}', "s3cret"), true);
  // wrong secret → reject
  assertEquals(await verifySlackSignature(slackReq(ts, `v0=${hex}`), '{"a":1}', "other"), false);
  // stale timestamp (>5min) → reject even with the right secret
  assertEquals(
    await verifySlackSignature(slackReq(ts - 601, `v0=${hex}`), '{"a":1}', "s3cret"),
    false,
  );
});

Deno.test("unset secrets REJECT (fail-closed, was skip-when-unset)", async () => {
  const req = new Request("https://x.test", { method: "POST", body: "{}" });
  assertEquals(await verifySlackSignature(req, "{}", undefined), false);
  assertEquals(await verifyWhatsAppSignature(req, "{}", undefined), false);
});

Deno.test("whatsapp signature verifies against the raw body", async () => {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode("app-secret"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode('{"object":"whatsapp_business_account"}'));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const req = new Request("https://x.test", {
    method: "POST",
    headers: { "X-Hub-Signature-256": `sha256=${hex}` },
    body: "{}",
  });
  assertEquals(
    await verifyWhatsAppSignature(req, '{"object":"whatsapp_business_account"}', "app-secret"),
    true,
  );
  assertEquals(await verifyWhatsAppSignature(req, '{"tampered":true}', "app-secret"), false);
});

Deno.test("dedup claim wins once and loses on the duplicate id", async () => {
  const inserted: unknown[] = [];
  let first = true;
  const client = {
    from(table: string) {
      assertEquals(table, "channel_seen_messages");
      return {
        // Mirrors the real supabase-js surface: upsert(values, options) then
        // select(). The previous mock invented .insert().onConflict().ignore(),
        // which does not exist on the client, so it hid a runtime TypeError.
        upsert(row: unknown, opts: { onConflict?: string; ignoreDuplicates?: boolean }) {
          inserted.push(row);
          assertEquals(opts?.onConflict, "channel,external_id");
          assertEquals(opts?.ignoreDuplicates, true);
          return {
            select() {
              // ON CONFLICT DO NOTHING + select returns only the rows this
              // statement actually wrote.
              return Promise.resolve(
                first ? { data: [{ id: "m1" }], error: null } : { data: [], error: null },
              );
            },
          };
        },
      };
    },
  };
  assertEquals(await claimSeenMessage(client, "telegram", "u1"), true); // won
  first = false;
  assertEquals(await claimSeenMessage(client, "telegram", "u1"), false); // lost
  assertEquals(inserted.length, 2);
});
