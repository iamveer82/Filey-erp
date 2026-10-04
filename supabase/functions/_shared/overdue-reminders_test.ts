import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runReminders } from "./overdue-reminders.ts";
import { acceptedEmailId } from "./email-delivery.ts";

const config = {
  owner: "OWNER",
  key: "fixture",
  from: "fixture@example.invalid",
  siteUrl: "https://example.invalid",
};
function fixture(count = 3) {
  const calls: unknown[] = [];
  const q = {
    select: () => q,
    eq: (...args: unknown[]) => {
      calls.push(args);
      return q;
    },
    or: (filter: string) => {
      calls.push(filter);
      return q;
    },
    lt: () => q,
    not: () => q,
    order: () => q,
    range: () => q,
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({
        data: Array.from({ length: count }, (_, i) => ({
          id: i + 1,
          number: `INV-${i + 1}`,
          customer_name: "<Demo>",
          customer_email: "fixture@example.invalid",
          due_date: "2026-01-01",
          share_token:"fixture-token",
          shared:i===0,
        })),
        error: null,
      }).then(resolve),
  };
  return { client: { from: () => q, rpc: async () => ({ data:true,error:null }) } as unknown as SupabaseClient, calls };
}
Deno.test(
  "reminder scope excludes purchase bills and credit notes; provider rejections and unknown acceptance are counted",
  async () => {
    const f = fixture();
    const keys: string[] = [];
    const send: typeof fetch = async (_url, init) => {
      assertEquals(init?.redirect,"error","Scheduled provider credentials must not follow redirects");
      keys.push(new Headers(init?.headers).get("Idempotency-Key")!);
      const body=JSON.parse(String(init?.body));
      assertEquals(body.html.includes("/#/portal/fixture-token"),keys.length===1,"Private invoices must not receive inaccessible portal links");
      return keys.length === 1
        ? new Response('{"id":"receipt"}')
        : keys.length === 2
          ? new Response("{}")
          : new Response('{"error":"rejected"}', { status: 422 });
    };
    assertEquals(await runReminders(f.client, "ORG", config, send, "2026-09-30"), {
      considered: 3,
      sent: 1,
      failed: 2,
    });
    assertEquals(f.calls, [
      ["org_id", "ORG"],
      ["doc_type", "invoice"],
      "invoice_type_code.is.null,invoice_type_code.not.in.(381,81)",
    ]);
    assertEquals(keys, [
      "filey-overdue/OWNER/ORG/1/2026-09-30",
      "filey-overdue/OWNER/ORG/2/2026-09-30",
      "filey-overdue/OWNER/ORG/3/2026-09-30",
    ]);
  }
);
Deno.test(
  "retrying a daily reminder keeps the same provider key and timeout stays unconfirmed",
  async () => {
    const keys: string[] = [];
    const send: typeof fetch = (_url, init) => {
      keys.push(new Headers(init?.headers).get("Idempotency-Key")!);
      throw new Error("timeout");
    };
    for (let i = 0; i < 2; i++)
      assertEquals(
        (await runReminders(fixture(1).client, "ORG", config, send, "2026-09-30")).failed,
        1
      );
    assertEquals(keys, [keys[0], keys[0]]);
  }
);
Deno.test("only a nonempty provider receipt confirms email acceptance", () => {
  for (const value of [null, {}, { id: "" }, { id: 123 }])
    assertEquals(acceptedEmailId(value), null);
  assertEquals(acceptedEmailId({ id: "receipt" }), "receipt");
});

Deno.test("scheduled reminders deny stale workspace authority after reading private recipients", async () => {
  for(const result of [{data:false,error:null},{data:null,error:null},{data:true,error:{message:"private internal"}}]) {
    const f=fixture();let sends=0;const checked:unknown[]=[];
    f.client.rpc=((name:string,args:unknown)=>{checked.push([name,args]);return Promise.resolve(result);}) as unknown as typeof f.client.rpc;
    await assertRejects(()=>runReminders(f.client,"ORIGINAL",config,async()=>{sends++;return new Response('{"id":"receipt"}');}),Error,"Scheduled delivery no longer has workspace access.");
    assertEquals(sends,0);
    assertEquals(checked,[["filey_agent_workspace_allowed",{p_owner:"OWNER",p_org:"ORIGINAL"}]]);
  }
});

Deno.test("scheduled reminders recheck authority before every email and stop after revocation", async () => {
  const f=fixture();let checks=0;let sends=0;
  f.client.rpc=(()=>Promise.resolve({data:++checks===1,error:null})) as unknown as typeof f.client.rpc;
  await assertRejects(()=>runReminders(f.client,"ORG",config,async()=>{sends++;return new Response('{"id":"receipt"}');}),Error,"Scheduled delivery no longer has workspace access.");
  assertEquals(checks,2);assertEquals(sends,1);
});

Deno.test("scheduled reminder credentials and sender retain the original reviewed config across authority awaits", async () => {
  const f=fixture(1);const mutable={...config};
  f.client.rpc=(async()=>{await Promise.resolve();Object.assign(mutable,{owner:"OTHER",key:"other-secret",from:"other@example.invalid",siteUrl:"https://other.invalid"});return {data:true,error:null};}) as unknown as typeof f.client.rpc;
  await runReminders(f.client,"ORG",mutable,async(_url,init)=>{
    assertEquals(new Headers(init?.headers).get("Authorization"),"Bearer fixture");
    assertEquals(new Headers(init?.headers).get("Idempotency-Key"),"filey-overdue/OWNER/ORG/1/"+new Date().toISOString().slice(0,10));
    const body=JSON.parse(String(init?.body));assertEquals(body.from,config.from);assertEquals(body.html.includes(config.siteUrl),true);
    return new Response('{"id":"receipt"}');
  });
});
