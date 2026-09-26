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
    if (init?.method === "HEAD") return new Response(null, { headers: { "content-range": "*/0" } });
    if (init?.method === "POST") {
      writes.push({ table, body: JSON.parse(String(init.body)) });
      return Response.json(table === "lead_requests" ? { id: 1 } : { id: "ok" });
    }
    if (table === "profiles") return Response.json({ id: "owner", org_id: "org" });
    return Response.json({});
  }) as typeof fetch;
  try {
    for (const purpose of ["enterprise", undefined]) {
      writes.length = 0;
      const response = await handleLead(new Request("https://example.test", { method: "POST", body: JSON.stringify({ name: "Test", phone: "+971500000001", purpose, source: "app" }) }));
      assertEquals(response.status, 200);
      assertEquals(writes.some(w => w.table === "vouchers"), purpose === undefined);
      assertEquals(writes.some(w => w.table === "lead_coupons"), purpose === undefined);
      assertStringIncludes(String(writes.find(w => w.table === "emails")?.body.subject), purpose ? "Enterprise" : "Freedom");
      assertStringIncludes(String(writes.find(w => w.table === "notifications")?.body.body), purpose ? "Enterprise" : "Freedom");
    }
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value);
    }
  }
});
