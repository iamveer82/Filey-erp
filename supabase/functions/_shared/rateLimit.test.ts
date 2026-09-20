import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { rateLimit } from "./rateLimit.ts";

Deno.test("rate reservations accept public checkout identities without UUID casts", async () => {
  const client = { rpc: async (name: string, args: unknown) => {
    assertEquals(name, "filey_take_rate_limit");
    assertEquals(args, { p_subject: "web:buyer@example.invalid", p_action: "checkout", p_limit: 5, p_window_seconds: 3600 });
    return { data: true, error: null };
  } } as unknown as Parameters<typeof rateLimit>[0];
  assertEquals(await rateLimit(client, "web:buyer@example.invalid", "checkout", 5, 3600), true);
});

Deno.test("rate limits fail closed on missing counters, errors and malformed responses", async () => {
  for (const result of [{data:null,error:{message:"offline"}},{data:null,error:null},{data:"true",error:null}]) {
    const client = {rpc:async () => result} as unknown as Parameters<typeof rateLimit>[0];
    await assertRejects(() => rateLimit(client,"account","send",10,86400),Error,"temporarily unavailable");
  }
  const blocked = {rpc:async () => ({data:false,error:null})} as unknown as Parameters<typeof rateLimit>[0];
  assertEquals(await rateLimit(blocked,"account","send",10,86400),false);
});
