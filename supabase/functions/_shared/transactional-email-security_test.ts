import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fixtureJwt } from "./test-auth-fixture.ts";

Deno.test("email/invitation boundaries bound bodies, recheck paid membership and redact database/provider failures", async()=>{
  const savedFetch=globalThis.fetch,savedServe=Deno.serve;
  const env={SUPABASE_URL:"https://fixture.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"fixture-service",SUPABASE_ANON_KEY:"fixture-anon",RESEND_API_KEY:"fixture-mail-key",EMAIL_FROM:"Filey <mail@example.invalid>"};
  const previous=Object.fromEntries(Object.keys(env).map(key=>[key,Deno.env.get(key)]));
  for(const [key,value] of Object.entries(env)) Deno.env.set(key,value);
  let handler!:(req:Request)=>Promise<Response>,email!:(req:Request)=>Promise<Response>,invite!:(req:Request)=>Promise<Response>;
  let member=true,licence=false,verifiedFactor=false,profileError=false,providerError=false,providerThrow=false,inviteError="";
  let profileOrg:string|null|undefined="fixture-paid-org",profileExists=true;
  const privateDetail="fixture-private-key-and-private-customer-email",calls:string[]=[],limits:number[]=[];
  Deno.serve=((fn:typeof handler)=>{handler=fn;return {};}) as typeof Deno.serve;
  globalThis.fetch=(async(input:string|URL|Request,init?:RequestInit)=>{
    const url=new URL(input instanceof Request?input.url:String(input)),name=url.pathname.split("/").pop()!;
    calls.push(name);
    if(name==="user") return Response.json({id:"fixture-user",email_confirmed_at:"2026-10-04",factors:verifiedFactor?[{status:"verified"}]:[]});
    if(name==="profiles") return profileError?Response.json({message:privateDetail},{status:503}):Response.json(profileExists?{org_id:profileOrg}:null);
    if(name==="org_members") {
      assertEquals(url.searchParams.get("org_id"),"eq.fixture-paid-org");assertEquals(url.searchParams.get("user_id"),"eq.fixture-user");
      return Response.json(member?{role:"staff"}:null);
    }
    if(name==="organizations") return Response.json({plan:"pro",plan_status:"active"});
    if(name==="licenses") return Response.json(licence?{id:"own-license"}:null);
    if(name==="filey_take_rate_limit") {
      const args=JSON.parse(String(init?.body));assertEquals(args.p_subject,"fixture-user");limits.push(args.p_limit);return Response.json(true);
    }
    if(name==="filey_prepare_invitation") return inviteError?Response.json({message:inviteError},{status:400}):Response.json({id:"60000000-0000-4000-8000-000000000001",email:"recipient@example.invalid",email_send_id:"attempt-1",email_status:"sending",workspace_name:"Fixture",role:"staff"});
    if(name==="invitations"||name==="audit_log") return new Response(null,{status:204});
    if(url.hostname==="api.resend.com") {
      assertEquals(init?.redirect,"error","Credentialed email delivery must reject redirects");
      if(providerThrow) throw new Error(privateDetail);
      if(providerError) return Response.json({message:privateDetail},{status:422});
      return Response.json({id:"provider-receipt"});
    }
    throw new Error(`Unexpected fixture request: ${url.pathname}`);
  }) as typeof fetch;
  const request=(body:unknown)=>new Request("https://fixture.test",{method:"POST",headers:{Authorization:`Bearer ${fixtureJwt("fixture-user")}`},body:JSON.stringify(body)});
  const emailBody={to:"recipient@example.invalid",subject:"Invoice",html:"<p>Invoice attached</p>",requestId:"request-1"};
  const inviteBody={email:"recipient@example.invalid",role:"staff",modules:["team"]};
  try {
    await import("../send-email/index.ts");email=handler;
    await import("../team-invite/index.ts");invite=handler;Deno.serve=savedServe;
    for(const endpoint of [email,invite]) {
      for(const method of ["GET","PUT","DELETE"]) assertEquals((await endpoint(new Request("https://fixture.test",{method}))).status,405);
      for(const value of [null,[],true]) assertEquals((await endpoint(request(value))).status,400);
    }
    assertEquals(calls,[],"Invalid method/object must stop before authentication or providers");
    for(const [endpoint,size] of [[email,20971521],[invite,16385]] as const) {
      assertEquals((await endpoint(new Request("https://fixture.test",{method:"POST",headers:{"content-length":String(size)},body:"{}"}))).status,413);
      let cancelled=false;
      const stream=new ReadableStream<Uint8Array>({pull(c){c.enqueue(new Uint8Array(65536));},cancel(){cancelled=true;}});
      assertEquals((await endpoint(new Request("https://fixture.test",{method:"POST",headers:{"content-length":"1"},body:stream}))).status,413);
      assertEquals(cancelled,true,"Lying/absent length must not buffer an unlimited request");
    }
    assertEquals(calls,[]);
    verifiedFactor=true;assertEquals((await email(request(emailBody))).status,403);assertEquals((await invite(request(inviteBody))).status,403);verifiedFactor=false;
    const workspaceChanged={error:"Your workspace changed. Review the email again before sending."};
    for(const action of [emailBody,{action:"status"}]) {
      for(const expected_org_id of [null,"",0,{},[]," fixture-paid-org","fixture-paid-org ","fixture\norg","a".repeat(256)]) {
        calls.length=0;
        const invalid=await email(request({...action,expected_org_id}));
        assertEquals(invalid.status,409);assertEquals(await invalid.json(),workspaceChanged);
        assertEquals(calls,["user"],"Malformed intent must stop before profile, hosted quota and provider access");
      }
      calls.length=0;
      const stale=await email(request({...action,expected_org_id:"previous-workspace"}));
      assertEquals(stale.status,409);assertEquals(await stale.json(),workspaceChanged);
      assertEquals(calls,["user","profiles"],"Same-account workspace drift must stop before paid-plan, sender status, quota or provider access");
    }
    calls.length=0;
    const status=await email(request({action:"status",expected_org_id:"fixture-paid-org"}));
    assertEquals(status.status,200);assertEquals(await status.json(),{configured:true,from:env.EMAIL_FROM});
    assertEquals(calls,["user","profiles"],"A valid scoped status check must not reserve sends or contact the provider");
    calls.length=0;
    assertEquals((await email(request({...emailBody,expected_org_id:"fixture-paid-org"}))).status,200);
    assertEquals(calls.filter(name=>name==="profiles").length,1,"Scoped sends must reuse the authoritative profile when resolving the tier");
    assertEquals(limits.at(-1),5000);
    for(const missingOrg of [null,undefined]) {
      profileOrg=missingOrg;calls.length=0;
      assertEquals((await email(request({...emailBody,expected_org_id:"default"}))).status,200);
      assertEquals(limits.at(-1),10,"Accounts without an organization retain the default hosted allowance");
      assertEquals(calls.includes("org_members"),false);
      calls.length=0;
      assertEquals((await email(request({action:"status",expected_org_id:"fixture-paid-org"}))).status,409);
      assertEquals(calls,["user","profiles"]);
    }
    profileExists=false;calls.length=0;
    assertEquals((await email(request({action:"status",expected_org_id:"default"}))).status,200);
    assertEquals(calls,["user","profiles"],"A missing profile has only the account-level default scope");
    profileExists=true;profileOrg="fixture-paid-org";profileError=true;calls.length=0;
    const unavailable=await email(request({action:"status",expected_org_id:"fixture-paid-org"}));
    assertEquals(unavailable.status,503);assertEquals((await unavailable.text()).includes(privateDetail),false);
    assertEquals(calls.includes("profiles"),true);
    assertEquals(calls.every(name=>name==="user"||name==="profiles"),true,"A failed authority lookup may retry its read, but must not expose sender configuration or contact providers");
    profileError=false;calls.length=0;
    assertEquals((await email(request({action:"status"}))).status,200);
    assertEquals(calls,["user"],"Legacy status clients without workspace intent retain their account-level behavior");
    calls.length=0;
    assertEquals((await email(request(emailBody))).status,200);assertEquals(limits.at(-1),5000);
    member=false;calls.length=0;
    assertEquals((await email(request(emailBody))).status,200);assertEquals(limits.at(-1),10);
    assertEquals(calls.includes("organizations"),false,"Former members cannot borrow a stale paid workspace's allowance");
    licence=true;assertEquals((await email(request(emailBody))).status,200);assertEquals(limits.at(-1),5000,"An active personal desktop license retains its paid allowance");licence=false;
    profileError=true;calls.length=0;
    const sqlFailure=await email(request(emailBody));assertEquals(sqlFailure.status,503);assertEquals((await sqlFailure.text()).includes(privateDetail),false);assertEquals(calls.includes("emails"),false);profileError=false;
    providerError=true;const rejected=await email(request(emailBody));assertEquals(rejected.status,422);assertEquals((await rejected.text()).includes(privateDetail),false);providerError=false;
    providerThrow=true;const thrown=await email(request(emailBody));assertEquals(thrown.status,500);assertEquals((await thrown.text()).includes(privateDetail),false);providerThrow=false;
    inviteError=privateDetail;const sqlInvite=await invite(request(inviteBody));assertEquals(sqlInvite.status,400);assertEquals((await sqlInvite.text()).includes(privateDetail),false);
    inviteError="Workspace invitation limit reached. Try again tomorrow";assertEquals(await (await invite(request(inviteBody))).json(),{error:inviteError});inviteError="";
    assertEquals((await invite(request({...inviteBody,modules:["x".repeat(129)]}))).status,400);
    const sent=await invite(request(inviteBody));assertEquals(sent.status,200);assertEquals((await sent.json()).status,"accepted");
    providerThrow=true;const unknown=await invite(request(inviteBody));assertEquals((await unknown.json()).status,"unknown");providerThrow=false;
  } finally {
    globalThis.fetch=savedFetch;Deno.serve=savedServe;
    for(const [key,value] of Object.entries(previous)) if(value===undefined) Deno.env.delete(key);else Deno.env.set(key,value);
  }
});
