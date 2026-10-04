// Runnable check for outbound delivery:  deno test supabase/functions/channel-webhook/
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { messageParts, prepareChannelReply, sendApprovedChannelText, sendChannelReply, sendChannelText } from "./delivery.ts";
import type { InboundMsg } from "./parse.ts";

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
    new Response(JSON.stringify({ ok: true, result: {message_id: 1} })),
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
  assertEquals(calls[0][1]?.redirect, "error");

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

Deno.test("Telegram and Slack acceptance requires a message receipt, not only ok=true", async () => {
  for (const channel of ["telegram", "slack"] as const) {
    const missing = fakeFetch([new Response(JSON.stringify({ok: true}))]);
    await assertRejects(() => sendChannelText(channel,"fixture","hello",{token:"fixture"},missing.fn));
    assertEquals(missing.calls.length,1);
  }
});

const replyActor = (channel: InboundMsg["channel"] = "telegram"): InboundMsg => ({
  channel, externalId: "42", userId: "42", body: "Show my invoices", fromName: "Fixture",
});
const acceptance = () => new Response(JSON.stringify({
  ok: true, result: { message_id: 1 }, ts: "1.0", messages: [{ id: "wamid.fixture" }],
}));

Deno.test("final reply lookup binds private output to the same current actor configuration used for delivery", async () => {
  for (const channel of ["telegram", "whatsapp", "slack"] as const) {
    let lookups = 0;
    const config = { configured: "true", owner_ref: "42", token: "new-token", bot_token: "new-token", phone_number_id: "123" };
    const { fn, calls } = fakeFetch([acceptance()]);
    const sent = await sendChannelReply(replyActor(channel), "Private invoice details", {
      workspaceActive: async () => true,
    }, {
      credentials: async () => { lookups++; return config; }, env: () => undefined,
    }, fn);
    assertEquals(sent, "Private invoice details");
    assertEquals(lookups, 1, "the credentials and actor pin must come from one fresh snapshot");
    assertEquals(calls.length, 1);
    if (channel === "telegram") assertStringIncludes(String(calls[0][0]), "botnew-token/sendMessage");
    else assertEquals(new Headers(calls[0][1]?.headers).get("authorization"), "Bearer new-token");
  }
});

Deno.test("re-pair at the final credential lookup never sends private model or approval text to the former actor", async () => {
  for (const channel of ["telegram", "whatsapp", "slack"] as const) {
    const { fn, calls } = fakeFetch([acceptance()]);
    let owner = "42";
    const sent = await sendChannelReply(replyActor(channel), "Private invoice INV-99 customer@example.test", {
      workspaceActive: async () => true,
    }, {
      credentials: async () => {
        await Promise.resolve();
        owner = "43";
        return { configured: "true", owner_ref: owner, token: "new-token", bot_token: "new-token", phone_number_id: "123" };
      }, env: () => undefined,
    }, fn);
    assertStringIncludes(sent ?? "", "Open Filey");
    assertEquals(calls.length, 1);
    const request = String(calls[0][1]?.body);
    assertEquals(request.includes("INV-99"), false);
    assertEquals(request.includes("customer@example.test"), false);
  }
});

Deno.test("disconnect at the final reply lookup suppresses every send including legacy configured credentials", async () => {
  const { fn, calls } = fakeFetch([acceptance()]);
  const sent = await sendChannelReply(replyActor(), "Private invoice details", {
    workspaceActive: async () => true,
  }, {
    credentials: async () => ({ disabled: "true" }), env: () => "legacy-token",
  }, fn);
  assertEquals(sent, null);
  assertEquals(calls.length, 0);
});

Deno.test("a role or workspace change during the final credential lookup cannot release private output", async () => {
  let workspaceActive = true;
  const { fn, calls } = fakeFetch([acceptance()]);
  const sent = await sendChannelReply(replyActor(), "Private invoice details", {
    workspaceActive: async () => workspaceActive,
  }, {
    credentials: async () => {
      await Promise.resolve();
      workspaceActive = false;
      return { configured: "true", owner_ref: "42", bot_token: "fixture-token" };
    }, env: () => undefined,
  }, fn);
  assertStringIncludes(sent ?? "", "workspace access changed");
  assertEquals(String(calls[0][1]?.body).includes("Private invoice details"), false);
});

Deno.test("same-channel reconnect with reset pairing gives generic guidance while public pair notices still work", async () => {
  const config = { configured: "true", owner_ref: "", bot_token: "new-token" };
  const io = { credentials: async () => config, env: () => undefined };
  const { fn, calls } = fakeFetch([acceptance(), acceptance()]);
  const sent = await sendChannelReply(replyActor(), "Webhook registered. PAIR 654321", {
    workspaceActive: async () => true,
  }, io, fn);
  assertStringIncludes(sent ?? "", "finish pairing");
  assertEquals(String(calls[0][1]?.body).includes("654321"), false);
  assertEquals(await sendChannelReply(replyActor(), "Paired. Open Filey to continue.", "public", io, fn), "Paired. Open Filey to continue.");
});

Deno.test("the bridge reply fence re-reads authority after awaited logging and checks workspace intent", async () => {
  let config = { configured: "true", owner_ref: "42", bot_token: "new-token" };
  let workspaceActive = true;
  const io = { credentials: async () => config, env: () => undefined };
  const authority = { workspaceActive: async () => workspaceActive };
  const generated = "Private model answer";
  assertEquals((await prepareChannelReply(replyActor(), generated, authority, io))?.text, generated);
  await Promise.resolve().then(() => { config = { ...config, owner_ref: "43" }; });
  const final = await prepareChannelReply(replyActor(), generated, authority, io);
  assertStringIncludes(final?.text ?? "", "Open Filey");
  assertEquals(final?.text.includes("Private"), false);
  config = { ...config, owner_ref: "42" };
  workspaceActive = false;
  const switched = await prepareChannelReply(replyActor(), generated, authority, io);
  assertStringIncludes(switched?.text ?? "", "workspace access changed");
  assertEquals(switched?.text.includes("Private"), false);
});

Deno.test("approved sends recheck original authority after destination lookup and block revocation or re-pair", async () => {
  for (const channel of ["telegram", "whatsapp", "slack"] as const) {
    for (const changed of ["workspace", "paired"] as const) {
      const authority = { workspace: true, paired: true };
      const steps: string[] = [];
      const { fn, calls } = fakeFetch([acceptance()]);
      await assertRejects(() => sendApprovedChannelText(channel, "approved-customer", "Approved private business text", {
        credentials: async (provider) => {
          steps.push(`credentials:${provider}`);
          await Promise.resolve();
          authority[changed] = false;
          return { token: "fixture-token", bot_token: "fixture-token", phone_number_id: "123" };
        },
        canExecute: async () => { steps.push("original-authority"); return authority.paired && authority.workspace; },
        env: () => undefined,
      }, fn), Error, "Nothing was sent");
      assertEquals(steps, [`credentials:${channel}`, "original-authority"]);
      assertEquals(calls.length, 0);
    }
  }
});

Deno.test("stable original authority permits the explicitly approved customer destination before provider dispatch", async () => {
  for (const channel of ["telegram", "whatsapp", "slack"] as const) {
    const steps: string[] = [];
    const calls: RequestInit[] = [];
    const provider = (async (_url: unknown, init?: RequestInit) => {
      steps.push("dispatch");
      calls.push(init ?? {});
      return acceptance();
    }) as typeof fetch;
    await sendApprovedChannelText(channel, "approved-customer", "Approved business message", {
      credentials: async () => {
        steps.push("credentials");
        return { configured: "true", owner_ref: "original-owner", token: "fixture-token", bot_token: "fixture-token", phone_number_id: "123" };
      },
      canExecute: async () => { steps.push("original-authority"); return true; },
      env: () => undefined,
    }, provider);
    assertEquals(steps, ["credentials", "original-authority", "dispatch"]);
    assertEquals(calls.length, 1);
    const body = JSON.parse(String(calls[0].body));
    assertEquals(body.chat_id ?? body.channel ?? body.to, "approved-customer", "the destination is not the approving actor pin");
    assertEquals(calls[0].redirect, "error");
  }
});
