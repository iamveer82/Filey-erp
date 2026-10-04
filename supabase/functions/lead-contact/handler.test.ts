import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleLead } from "./handler.ts";

Deno.test("preflight permits the browser SDK's headers", async () => {
  const response = await handleLead(new Request("https://example.test", { method: "OPTIONS" }));
  const allowed = response.headers.get("Access-Control-Allow-Headers")!;
  for (const header of ["authorization", "apikey", "x-client-info", "content-type"])
    assertStringIncludes(allowed, header);
});

Deno.test("Enterprise inquiries never mint Freedom licenses; legacy requests retain their flow", async () => {
  const previousFetch = globalThis.fetch;
  const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-key", RESEND_API_KEY: "test-key" };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, Deno.env.get(key)]));
  const writes: { table: string; body: Record<string, unknown> }[] = [];
  for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const table = url.pathname.split("/").pop()!;
    if(table==="filey_take_rate_limit") return Response.json(true);
    if (init?.method === "HEAD") return new Response(null, { headers: { "content-range": "*/0" } });
    if (init?.method === "POST") {
      if(table==="emails") assertEquals(init.redirect,"error");
      writes.push({ table, body: JSON.parse(String(init.body)) });
      const params=JSON.parse(String(init.body));
      return Response.json(table === "filey_record_lead" ? {id:1,emailed:false,code:params.p_code,expires_at:params.p_expires_at} : { id: "ok" });
    }
    if (table === "profiles") return Response.json({ id: "owner", org_id: "org" });
    return Response.json({});
  }) as typeof fetch;
  try {
    for (const purpose of ["enterprise", undefined]) {
      writes.length = 0;
      const response = await handleLead(new Request("https://example.test", { method: "POST", body: JSON.stringify({ name: "Test", phone: "+971500000001", purpose, source: "app" }) }));
      assertEquals(response.status, 200);
      const setup=writes.find(w=>w.table==="filey_record_lead")?.body;
      assertEquals(setup?.p_plan,purpose??"freedom");
      assertEquals(setup?.p_code===null,purpose==="enterprise");
      assertEquals(setup?.p_expires_at===null,purpose==="enterprise");
      assertEquals(writes.some(w => ["lead_requests","vouchers","lead_coupons","notifications"].includes(w.table)),false,"Only the transactional RPC may set up the inquiry");
      assertStringIncludes(String(writes.find(w => w.table === "emails")?.body.subject), purpose ? "Enterprise" : "Freedom");
    }
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value);
    }
  }
});

Deno.test("public inquiries have bounded bodies and atomic admission before writes, with safe failure output",async()=>{
  const savedFetch=globalThis.fetch;
  const env={SUPABASE_URL:"https://example.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"fixture-service",RESEND_API_KEY:"fixture-mail"};
  const previous=Object.fromEntries(Object.keys(env).map(key=>[key,Deno.env.get(key)]));
  for(const [key,value] of Object.entries(env)) Deno.env.set(key,value);
  let admitted=0,writes=0,rateFailure=false,insertFailure=false,mailReceipt=true;
  const privateDetail="fixture-private-credential-and-admin-email",calls:string[]=[];
  globalThis.fetch=(async(input:string|URL|Request,init?:RequestInit)=>{
    const url=new URL(input instanceof Request?input.url:String(input)),name=url.pathname.split("/").pop()!;calls.push(name);
    if(name==="filey_take_rate_limit") {
      assertEquals(JSON.parse(String(init?.body)),{p_subject:"lead-ip:fixture-ip",p_action:"lead_contact",p_limit:5,p_window_seconds:3600});
      if(rateFailure) return Response.json({message:privateDetail},{status:503});
      return Response.json(++admitted<=5);
    }
    if(name==="filey_record_lead"&&init?.method==="POST") {
      writes++;return insertFailure?Response.json({message:privateDetail},{status:500}):Response.json({id:writes,emailed:false,code:null,expires_at:null});
    }
    if(name==="profiles") return Response.json(null);
    if(name==="emails") {assertEquals(init?.redirect,"error");return Response.json(mailReceipt?{id:"receipt"}:{});}
    return Response.json({});
  }) as typeof fetch;
  const request=(body:unknown={name:"Test",phone:"+971500000001",purpose:"enterprise"})=>new Request("https://example.test",{method:"POST",headers:{"x-forwarded-for":"fixture-ip"},body:JSON.stringify(body)});
  try {
    for(const body of [null,[],{name:{},phone:"+971500000001"},{name:"Test",phone:"+971500000001",request_id:null},{name:"Test",phone:"+971500000001",request_id:"not-a-uuid"}]) assertEquals((await handleLead(request(body))).status,400);
    assertEquals((await handleLead(request({name:"Test",phone:"+971500000001",extra:"a".repeat(16385)}))).status,413);
    assertEquals(calls,[],"Invalid public bodies must stop before service-role calls");
    const responses=await Promise.all(Array.from({length:8},()=>handleLead(request())));
    assertEquals(responses.map(r=>r.status).filter(s=>s===200).length,5);assertEquals(responses.map(r=>r.status).filter(s=>s===429).length,3);assertEquals(writes,5);
    admitted=0;rateFailure=true;const quotaError=await handleLead(request());assertEquals(quotaError.status,503);assertEquals((await quotaError.text()).includes(privateDetail),false);rateFailure=false;
    insertFailure=true;const sqlError=await handleLead(request());assertEquals(sqlError.status,500);assertEquals((await sqlError.text()).includes(privateDetail),false);insertFailure=false;
    mailReceipt=false;const receiptError=await handleLead(request());assertEquals(await receiptError.json(),{ok:true,emailed:false},"A 200 provider response without a receipt must not claim an email was accepted");
  } finally {
    globalThis.fetch=savedFetch;
    for(const [key,value] of Object.entries(previous)) if(value===undefined) Deno.env.delete(key);else Deno.env.set(key,value);
  }
});

Deno.test("stable inquiry retries retain the original coupon and email idempotency key; accepted replay sends nothing",async()=>{
  const savedFetch=globalThis.fetch;
  const env={SUPABASE_URL:"https://example.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"fixture-service",RESEND_API_KEY:"fixture-mail"};
  const previous=Object.fromEntries(Object.keys(env).map(key=>[key,Deno.env.get(key)]));
  for(const [key,value] of Object.entries(env)) Deno.env.set(key,value);
  const stableId="b2000000-0000-4000-8000-000000000001";
  const originalCode="FL-ABCDE-FGHJK-LMNPQ-RSTUV",originalExpiry="2026-11-01T00:00:00.000Z";
  let emailed=false,attempts=0,setups=0;const idempotency:string[]=[];const proposed:string[]=[];
  globalThis.fetch=(async(input:string|URL|Request,init?:RequestInit)=>{
    const url=new URL(input instanceof Request?input.url:String(input)),name=url.pathname.split("/").pop()!;
    if(name==="filey_take_rate_limit") return Response.json(true);
    if(name==="filey_record_lead") {
      setups++;const body=JSON.parse(String(init?.body));assertEquals(body.p_request,stableId);
      proposed.push(body.p_code);return Response.json({id:17,emailed,code:originalCode,expires_at:originalExpiry});
    }
    if(name==="emails") {
      attempts++;assertEquals(init?.redirect,"error");idempotency.push(new Headers(init?.headers).get("Idempotency-Key")!);
      assertStringIncludes(JSON.parse(String(init?.body)).html,originalCode);
      return attempts===1?Response.json({error:"temporary"},{status:503}):Response.json({id:"accepted"});
    }
    if(name==="lead_requests"&&init?.method==="PATCH") {emailed=true;return Response.json({});}
    throw new Error("Unexpected non-atomic setup call: "+name);
  }) as typeof fetch;
  const request=()=>new Request("https://example.test",{method:"POST",body:JSON.stringify({request_id:stableId,name:"Test",phone:"+971500000001",purpose:"freedom"})});
  try {
    assertEquals(await (await handleLead(request())).json(),{ok:true,emailed:false});
    assertEquals(await (await handleLead(request())).json(),{ok:true,emailed:true});
    assertEquals(await (await handleLead(request())).json(),{ok:true,emailed:true});
    assertEquals(setups,3);assertEquals(attempts,2);assertEquals(idempotency,["filey-lead/17","filey-lead/17"]);
    assertEquals(new Set(proposed).size,3,"Generated proposals must not replace the persisted coupon on retry");
    const conflicting=new Request("https://example.test",{method:"POST",headers:{"idempotency-key":"b2000000-0000-4000-8000-000000000002"},body:JSON.stringify({request_id:stableId,name:"Test",phone:"+971500000001"})});
    assertEquals((await handleLead(conflicting)).status,400);assertEquals(setups,3);
  } finally {
    globalThis.fetch=savedFetch;
    for(const [key,value] of Object.entries(previous)) if(value===undefined) Deno.env.delete(key);else Deno.env.set(key,value);
  }
});
