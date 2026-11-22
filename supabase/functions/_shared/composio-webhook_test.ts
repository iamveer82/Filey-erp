import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { MAX_EVENT_BYTES, parseComposioEvent, signComposio, storableData, verifyComposio } from "./composio-webhook.ts";

const NOW = 1_800_000_000;
const body = JSON.stringify({ id: "msg_1", type: "composio.trigger.message" });

Deno.test("accepts a fresh, correctly signed request and refuses everything else", async () => {
  const signature = await signComposio("secret-1", "msg_1", String(NOW), body);
  const headers = { id: "msg_1", timestamp: String(NOW), signature: `v1,${signature}` };
  assert(await verifyComposio("secret-1", headers, body, NOW));
  assert(await verifyComposio("secret-1", { ...headers, signature: `v1,wrong v1,${signature}` }, body, NOW), "rotation lists several");
  assert(!(await verifyComposio("secret-2", headers, body, NOW)), "other secret");
  assert(!(await verifyComposio("secret-1", headers, body + " ", NOW)), "changed body");
  assert(!(await verifyComposio("secret-1", headers, body, NOW + 301)), "replayed late");
  assert(!(await verifyComposio("", headers, body, NOW)), "no secret configured");
  assert(!(await verifyComposio("secret-1", { ...headers, signature: null }, body, NOW)));
});

Deno.test("reads a millisecond timestamp and a whsec_ secret", async () => {
  const ms = String(NOW * 1000);
  const secret = `whsec_${btoa("raw-key-bytes")}`;
  const signature = await signComposio(secret, "msg_2", ms, body);
  assert(await verifyComposio(secret, { id: "msg_2", timestamp: ms, signature: `v1,${signature}` }, body, NOW));
});

Deno.test("parses trigger and expiry envelopes, ignores the rest", () => {
  assertEquals(parseComposioEvent({
    id: "msg_9", type: "composio.trigger.message",
    metadata: { trigger_id: "ti_1", trigger_slug: "GMAIL_NEW_GMAIL_MESSAGE", connected_account_id: "ca_1", user_id: "filey-abc" },
    data: { subject: "Hi" },
  }, "wh_1"), {
    kind: "trigger", key: "msg_9", triggerId: "ti_1", triggerSlug: "GMAIL_NEW_GMAIL_MESSAGE",
    connectedAccountId: "ca_1", userId: "filey-abc", data: { subject: "Hi" },
  });
  assertEquals(parseComposioEvent({ type: "composio.connected_account.expired", data: { id: "ca_1", toolkit: { slug: "gmail" } } }, "wh_2"),
    { kind: "connection_expired", key: "wh_2", connectedAccountId: "ca_1", toolkit: "gmail" });
  assertEquals(parseComposioEvent({ type: "composio.trigger.message", metadata: {} }, "wh_3"), null);
  assertEquals(parseComposioEvent({ type: "something.else" }, "wh_4"), null);
  assertEquals(parseComposioEvent([], "wh_5"), null);
});

Deno.test("cuts an oversized payload to a preview", () => {
  const small = { a: 1 };
  assertEquals(storableData(small), small);
  const big = storableData({ text: "x".repeat(MAX_EVENT_BYTES * 2) }) as { preview: string };
  assert(big.preview.length < MAX_EVENT_BYTES);
});
