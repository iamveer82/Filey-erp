import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import { fixtureJwt } from "./test-auth-fixture.ts";

Deno.test("tool execution atomically claims immutable owner jobs and does not publish stale or failed claims", async () => {
  const savedFetch=globalThis.fetch,savedServe=Deno.serve;
  const env={SUPABASE_URL:"https://fixture.supabase.co",SUPABASE_ANON_KEY:"fixture-anon",SUPABASE_SERVICE_ROLE_KEY:"fixture-service"};
  const previous=Object.fromEntries(Object.keys(env).map(key=>[key,Deno.env.get(key)]));
  for(const [key,value] of Object.entries(env)) Deno.env.set(key,value);
  const user="00000000-0000-0000-0000-000000000001",id="50000000-0000-4000-8000-000000000001";
  const original={id,user_id:user,tool:"rotate",engine:"edge",status:"pending",input_path:`${user}/input.pdf`,params:{degrees:-90},file_name:"invoice.pdf",updated_at:"2026-10-04T12:00:00.000Z"};
  let job={...original},handler!:(req:Request)=>Promise<Response>;
  let authenticated=true,verifiedFactor=false,failClaim=false,failUpload=false,replaceClaim=false;
  const privateDetail="fixture-private-credential-and-file-path",calls:string[]=[];
  let downloads=0,uploads=0;
  const pdf=await PDFDocument.create();pdf.addPage();const bytes=await pdf.save();
  Deno.serve=((fn:typeof handler)=>{handler=fn;return {};}) as typeof Deno.serve;
  globalThis.fetch=(async(input:string|URL|Request,init?:RequestInit)=>{
    const url=new URL(input instanceof Request?input.url:String(input)),name=url.pathname.split("/").pop()!;
    const method=init?.method??(input instanceof Request?input.method:"GET");
    calls.push(`${method} ${name}`);
    if(name==="user") return authenticated?Response.json({id:user,factors:verifiedFactor?[{status:"verified"}]:[]}):Response.json({message:privateDetail},{status:401});
    if(name==="tool_jobs") {
      if(method==="GET") return Response.json({...job});
      assertEquals(new Headers(init?.headers).get("authorization"),"Bearer fixture-service","Claims/results must use trusted server credentials");
      if(method==="PATCH") {
        assertEquals(url.searchParams.get("id"),`eq.${id}`);
        assertEquals(url.searchParams.get("user_id"),`eq.${user}`);
        const expectedTimestamp=url.searchParams.get("updated_at");
        assertEquals(typeof expectedTimestamp,"string","Every claim/result must carry the captured timestamp");
        if(expectedTimestamp!==`eq.${job.updated_at}`) return Response.json(null);
        const changes=JSON.parse(String(init?.body));
        if(changes.status==="processing") {
          assertEquals(url.searchParams.get("engine"),"eq.edge");
          assertEquals(url.searchParams.get("status"),"eq.pending");
          if(failClaim) return Response.json({message:privateDetail},{status:503});
          if(job.status!=="pending") return Response.json(null);
          job={...job,...changes};return Response.json({...job});
        }
        assertEquals(url.searchParams.get("status"),"eq.processing");
        if(job.status!=="processing") return Response.json(null);
        if(changes.status==="error") assertEquals(changes.error.includes(privateDetail),false,"Stored job errors must be safe for the owner");
        job={...job,...changes};return Response.json({id});
      }
    }
    if(name==="audit_log") return new Response(null,{status:201});
    if(url.pathname.includes("/tool-inputs/")) {
      downloads++;
      if(replaceClaim) job={...job,status:"pending"};
      return new Response(new Blob([bytes as BlobPart],{type:"application/pdf"}));
    }
    if(url.pathname.includes("/tool-outputs/")) {
      uploads++;
      assertEquals(url.pathname.includes(`/${id}/`),true);
      assertEquals(url.pathname.endsWith("/0_invoice-rotated.pdf"),true);
      if(failUpload) return Response.json({message:privateDetail},{status:500});
      return Response.json({Key:"accepted"});
    }
    throw new Error(`Unexpected fixture request: ${url.pathname}`);
  }) as typeof fetch;
  const request=(body:unknown={jobId:id})=>new Request("https://fixture.test",{method:"POST",headers:{Authorization:`Bearer ${fixtureJwt(user)}`},body:JSON.stringify(body)});
  try {
    await import("../run-tool/index.ts");Deno.serve=savedServe;
    for(const method of ["GET","PUT","DELETE"]) assertEquals((await handler(new Request("https://fixture.test",{method}))).status,405);
    assertEquals(calls.length,0);
    for(const body of [null,[],{}, {jobId:{}},{jobId:"invalid"}]) assertEquals((await handler(request(body))).status,400);
    assertEquals((await handler(request({jobId:id,extra:"a".repeat(4097)}))).status,413);
    assertEquals(calls.every(call=>call==="GET user"),true,"Invalid requests must stop before job data/mutation");
    calls.length=0;authenticated=false;assertEquals((await handler(request())).status,401);authenticated=true;
    verifiedFactor=true;assertEquals((await handler(request())).status,403);verifiedFactor=false;
    assertEquals(downloads,0);
    failClaim=true;
    const claimFailure=await handler(request());assertEquals(claimFailure.status,500);
    assertEquals((await claimFailure.text()).includes(privateDetail),false);
    assertEquals(job.status,"pending");assertEquals(downloads,0);assertEquals(uploads,0);
    failClaim=false;
    const results=await Promise.all([handler(request()),handler(request())]);
    assertEquals(results.map(r=>r.status).sort(),[200,409]);
    assertEquals(job.status,"done");assertEquals(downloads,1);assertEquals(uploads,1);
    assertEquals(calls.some(call=>call.includes("filey_take_rate_limit")),false,"Running admitted jobs must not reserve another quota slot");
    job={...original};replaceClaim=true;
    const stale=await handler(request());assertEquals(stale.status,409);assertEquals(job.status,"pending");replaceClaim=false;
    job={...original};failUpload=true;
    const failed=await handler(request());assertEquals(failed.status,500);
    assertEquals((await failed.text()).includes(privateDetail),false);assertEquals(job.status,"error");
    failUpload=false;job={...original,engine:"worker"};
    assertEquals((await handler(request())).status,400);
    job={...original,input_path:"another-user/input.pdf"};assertEquals((await handler(request())).status,403);
  } finally {
    globalThis.fetch=savedFetch;Deno.serve=savedServe;
    for(const [key,value] of Object.entries(previous)) if(value===undefined) Deno.env.delete(key);else Deno.env.set(key,value);
  }
});
