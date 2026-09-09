// Runnable check for owner pinning + pairing:  deno test supabase/functions/channel-webhook/
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ownerRefusal, tryPair } from "./access.ts";
import type { InboundMsg } from "./parse.ts";

const tg = (over: Partial<InboundMsg> = {}): InboundMsg => ({
  channel: "telegram",
  externalId: "42",
  body: "hi",
  fromName: "Ada",
  ...over,
});

const io = (env: Record<string, string> = {}, dbOwner = "") => ({ env: (k: string) => env[k], dbOwner });

Deno.test("private telegram chat still pins on the chat id alone", async () => {
  assertEquals(await ownerRefusal(tg(), io({ TELEGRAM_OWNER_CHAT_ID: "42" })), null);
  const refusal = await ownerRefusal(tg({ externalId: "43" }), io({ TELEGRAM_OWNER_CHAT_ID: "42" }));
  assertEquals(typeof refusal, "string");
});

Deno.test("group chats fail closed without TELEGRAM_OWNER_USER_ID", async () => {
  // Chat id matches but it's a group and the user-id secret is unset → refuse.
  const refusal = await ownerRefusal(
    tg({ chatType: "supergroup", senderId: "7" }),
    io({ TELEGRAM_OWNER_CHAT_ID: "42" }),
  );
  assertEquals(typeof refusal, "string");
});

Deno.test("group chats require the SENDER's user id to match the secret", async () => {
  const base = { chatType: "supergroup" as const };
  assertEquals(
    await ownerRefusal(tg({ ...base, senderId: "7" }), io({ TELEGRAM_OWNER_CHAT_ID: "42", TELEGRAM_OWNER_USER_ID: "7" })),
    null,
  );
  // A different group member typing in the owner's chat must be refused.
  assertEquals(
    typeof (await ownerRefusal(
      tg({ ...base, senderId: "999" }),
      io({ TELEGRAM_OWNER_CHAT_ID: "42", TELEGRAM_OWNER_USER_ID: "7" }),
    )),
    "string",
  );
});

Deno.test("whatsapp + slack pins unchanged (digit-normalized / user id)", async () => {
  assertEquals(
    await ownerRefusal(
      { channel: "whatsapp", externalId: "+971 50 000 0000", body: "x", fromName: "O" },
      io({ WHATSAPP_OWNER_PHONE: "971500000000" }),
    ),
    null,
  );
  assertEquals(
    await ownerRefusal(
      { channel: "slack", externalId: "C1", userId: "U7", body: "x", fromName: "S" },
      io({ SLACK_OWNER_USER_ID: "U7" }),
    ),
    null,
  );
});

// ---- PAIR flow ----

/** Fake client modelling just what tryPair touches: the agent_channels row,
 *  the audit_log counter query (rateLimit) and its failure inserts. */
function fakePairClient(opts: {
  pairCode?: string | null;
  ownerRef?: string | null;
  priorFailures?: number;
  expires?: string;
  enabled?: boolean;
  loseRace?: boolean;
}) {
  const updates: { patch: Record<string, unknown>; filters: [string, unknown][] }[] = [];
  const auditInserts: Record<string, unknown>[] = [];
  let counted = opts.priorFailures ?? 0;
  const client = {
    from(table: string) {
      if (table === "agent_channels") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: opts.pairCode
                      ? { credentials: { pair_code: opts.pairCode, pair_expires_at: opts.expires ?? new Date(Date.now() + 60000).toISOString() }, owner_ref: opts.ownerRef ?? null, enabled: opts.enabled ?? true }
                      : { credentials: {}, owner_ref: opts.ownerRef ?? null },
                    error: null,
                  }),
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => {
            const filters: [string, unknown][] = [];
            const q = {
              eq: (c: string, v: unknown) => { filters.push([c, v]); return q; },
              is: (c: string, v: unknown) => { filters.push([c, v]); return q; },
              select: () => {
                updates.push({ patch, filters });
                return Promise.resolve({ data: opts.loseRace ? [] : [{ owner_ref: patch.owner_ref }], error: null });
              },
            };
            return q;
          },
        };
      }
      // audit_log: rateLimit counts rows; logAction inserts them.
      return {
        insert: (row: Record<string, unknown>) => {
          auditInserts.push(row);
          return Promise.resolve({ error: null });
        },
        select: () => ({
          eq: () => ({
            eq: () => ({
              gte: () =>
                Promise.resolve({ count: counted, error: null }),
            }),
          }),
        }),
      };
    },
  };
  return {
    client,
    updates,
    auditInserts,
    bumpFailures: () => void counted++,
  };
}

const pairMsg = (over: Partial<InboundMsg> = {}): InboundMsg => ({
  channel: "telegram",
  externalId: "555",
  body: "PAIR 654321",
  fromName: "Stranger",
  ...over,
});

Deno.test("correct PAIR code sets owner_ref and spends the one-time code", async () => {
  const f = fakePairClient({ pairCode: "654321" });
  let paired = false;
  const reply = await tryPair(f.client, "OWNER-1", pairMsg(), "PAIR 654321", () => void (paired = true));
  assertEquals(reply?.startsWith("✅ Paired"), true);
  assertEquals(paired, true);
  assertEquals(f.updates.length, 1);
  assertEquals(f.updates[0].patch.owner_ref, "555");
  assertEquals((f.updates[0].patch.credentials as { pair_code?: string }).pair_code, undefined);
});

Deno.test("wrong PAIR code logs a failed attempt against the sender", async () => {
  const f = fakePairClient({ pairCode: "654321" });
  const reply = await tryPair(f.client, "OWNER-1", pairMsg(), "PAIR 000000");
  assertEquals(reply, "That pairing code isn't right.");
  assertEquals(f.auditInserts.length, 1);
  assertEquals(String(f.auditInserts[0].action).startsWith("pair_attempt:telegram:555"), true);
  assertEquals(f.updates.length, 0, "a wrong code must never set owner_ref");
});

Deno.test("PAIR brute force trips after 5 failed attempts per sender", async () => {
  const f = fakePairClient({ pairCode: "654321", priorFailures: 5 });
  const reply = await tryPair(f.client, "OWNER-1", pairMsg(), "PAIR 654321");
  // Even the CORRECT code is refused once the window is burnt.
  assertEquals(reply?.startsWith("Too many attempts"), true);
  assertEquals(f.updates.length, 0, "throttled attempt must not pair");
  assertEquals(f.auditInserts.length, 0, "blocked attempts add no new rows");
});

Deno.test("already-paired channel refuses to re-pair before any throttle work", async () => {
  const f = fakePairClient({ pairCode: "654321", ownerRef: "555" });
  const reply = await tryPair(f.client, "OWNER-1", pairMsg(), "PAIR 654321");
  assertEquals(reply, "This channel is already paired.");
  assertEquals(f.auditInserts.length, 0);
});

Deno.test("expired, disabled and group pairing never claim an account", async () => {
  for (const opts of [{ expires: "2020-01-01" }, { enabled: false }]) {
    const f = fakePairClient({ pairCode: "654321", ...opts });
    await tryPair(f.client, "OWNER-1", pairMsg(), "PAIR 654321");
    assertEquals(f.updates.length, 0);
  }
  const f = fakePairClient({ pairCode: "654321" });
  await tryPair(f.client, "OWNER-1", pairMsg({ chatType: "supergroup" }), "PAIR 654321");
  assertEquals(f.updates.length, 0);
});

Deno.test("a racing pairing cannot overwrite an already claimed identity", async () => {
  const f = fakePairClient({ pairCode: "654321", loseRace: true });
  const reply = await tryPair(f.client, "OWNER-1", pairMsg(), "PAIR 654321");
  assertEquals(reply?.includes("already used"), true);
  assertEquals(f.updates[0].filters.some(([c, v]) => c === "owner_ref" && v === null), true);
});
