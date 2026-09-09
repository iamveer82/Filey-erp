// Runnable check for outbound delivery:  deno test supabase/functions/channel-webhook/
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { messageParts, sendChannelText } from "./delivery.ts";

/** Canned responses in order; records what it was called with. */
function fakeFetch(steps: (Response | Error)[]) {
  const calls: [string | URL | Request, RequestInit | undefined][] = [];
  const fn = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push([url, init]);
    const step = steps.shift();
    if (step instanceof Error) return Promise.reject(step);
    return Promise.resolve(step ?? new Response("{}"));
  }) as typeof fetch;
  return { fn, calls };
}

Deno.test("a long Unicode reply splits losslessly and stays within the message limit", () => {
  const text = "مرحبا 👋\n".repeat(1200);
  const parts = messageParts(text);
  assertEquals(parts.length > 1, true);
  assertEquals(parts.join(""), text);
  assertEquals(parts.every((p) => p.length <= 4000), true);
});

Deno.test("an HTTP-200 provider failure is a failure, and is not retried", async () => {
  // Slack answers 200 with { ok: false } — the status alone proves nothing.
  const { fn, calls } = fakeFetch([
    new Response(JSON.stringify({ ok: false, error: "invalid_auth" })),
  ]);
  await assertRejects(
    () => sendChannelText("slack", "U1", "hello", { token: "secret" }, fn),
    Error,
    "not confirmed",
  );
  assertEquals(calls.length, 1);
});

Deno.test("partial delivery is reported without leaking the token or resending", async () => {
  const { fn, calls } = fakeFetch([
    new Response(JSON.stringify({ ok: true })),
    // Telegram's own errors quote the request URL, which carries the bot token.
    new Error("https://api.telegram.org/botSECRET/sendMessage"),
  ]);
  const err = await assertRejects(() =>
    sendChannelText("telegram", "42", "x".repeat(4500), { token: "SECRET" }, fn)
  );
  assertStringIncludes(
    (err as Error).message,
    "telegram delivery not confirmed; 1 part(s) accepted.",
  );
  assertEquals((err as Error).message.includes("SECRET"), false);
  assertEquals(calls.length, 2); // the accepted part is not sent again
});

Deno.test("WhatsApp is only accepted once the provider returns a message id", async () => {
  const { fn, calls } = fakeFetch([
    new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] })),
  ]);
  await sendChannelText(
    "whatsapp",
    "971500000000",
    "hello",
    { token: "secret", phoneNumberId: "123" },
    fn,
  );
  assertEquals(calls.length, 1);
  assertEquals(JSON.parse(String(calls[0][1]?.body)).type, "text");

  const missingId = fakeFetch([new Response(JSON.stringify({ messages: [] }))]);
  await assertRejects(
    () =>
      sendChannelText(
        "whatsapp",
        "971500000000",
        "hello",
        { token: "secret", phoneNumberId: "123" },
        missingId.fn,
      ),
    Error,
    "not confirmed",
  );
});
