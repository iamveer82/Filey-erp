// Runnable check for channel memory + channel setup:  deno test supabase/functions/channel-webhook/
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  proposeConnectChannel,
  rankMemories,
  rememberMemory,
} from "./tools-writes.ts";

Deno.test("recall ranks reordered terms and Arabic, and leaves unrelated facts out", () => {
  const rows = [
    { text: "Office rent is due tomorrow" },
    { text: "Bapco receives a discount on invoices" },
    { text: "إرسال الفواتير كل أسبوع" },
  ];
  assertEquals(rankMemories(rows, "invoices Bapco"), [rows[1]]);
  assertEquals(rankMemories(rows, "أسبوع الفواتير"), [rows[2]]);
});

Deno.test("a correction replaces only a memory belonging to the owner", async () => {
  const filters: [string, unknown][] = [];
  const patches: Record<string, unknown>[] = [];
  // Minimal PostgREST stand-in: every builder call returns itself, and awaiting
  // it resolves the one row this owner has.
  const q = {
    select: () => q,
    eq: (key: string, value: unknown) => {
      filters.push([key, value]);
      return q;
    },
    update: (patch: Record<string, unknown>) => {
      patches.push(patch);
      return q;
    },
    then: (resolve: (v: unknown) => void) =>
      resolve({ data: [{ id: "mine", text: "old" }], error: null }),
  };
  const client = { from: () => q };

  const ok = await rememberMemory(client, "org", "owner", {
    text: "corrected",
    replace_id: "mine",
  }) as { remembered?: boolean; id?: string };
  assertEquals(ok.remembered, true);
  assertEquals(ok.id, "mine");
  assertEquals(patches.length, 1);
  assertEquals(patches[0].text, "corrected");
  // Both the lookup and the update are pinned to the owner, so one owner's
  // correction can never rewrite another's memory.
  assertEquals(filters.filter(([key]) => key === "user_id"), [
    ["user_id", "owner"],
    ["user_id", "owner"],
  ]);

  const foreign = await rememberMemory(client, "org", "owner", {
    text: "wrong",
    replace_id: "another-owner",
  }) as { error?: string };
  assertStringIncludes(String(foreign.error), "not found");
  assertEquals(patches.length, 1); // nothing was written
});

Deno.test("an incomplete channel setup is refused before anything is stored", async () => {
  const client = {
    from: () => {
      throw new Error("must not touch storage");
    },
  };
  const wa = await proposeConnectChannel(client, "owner", {
    provider: "whatsapp",
    token: "token",
    phone_number_id: "123",
  }) as { error?: string };
  assertStringIncludes(String(wa.error), "app_secret");

  const slack = await proposeConnectChannel(client, "owner", {
    provider: "slack",
    token: "token",
  }) as { error?: string };
  assertStringIncludes(String(slack.error), "signing_secret");
});
