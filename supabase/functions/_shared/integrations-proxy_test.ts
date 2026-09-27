import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("integration writes reserve quota before calling providers and fail closed on settings errors", async () => {
  const savedFetch = globalThis.fetch, savedServe = Deno.serve;
  const env = { SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "fixture-key", COMPOSIO_API_KEY: "fixture-provider-key" };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, Deno.env.get(key)]));
  for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
  let handler!: (req: Request) => Promise<Response>;
  Deno.serve = ((fn: typeof handler) => { handler = fn; return {}; }) as typeof Deno.serve;
  const calls: string[] = [];
  let permitted = false, quotaError = false, keyError = false;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const name = url.pathname.split("/").pop()!;
    calls.push(name);
    if (name === "user") return Response.json({ id: "fixture-user" });
    if (name === "profiles") return Response.json({ org_id: "fixture-org" });
    if (name === "org_members") return Response.json({ role: "owner", modules: null });
    if (name === "integration_keys") return keyError ? Response.json({ message: "unavailable" }, { status: 503 }) : Response.json(null);
    if (name === "organizations") return Response.json({ plan: "free" });
    if (name === "filey_take_rate_limit") {
      assertEquals(JSON.parse(String(init?.body)), { p_subject: "fixture-user", p_action: "integration_action", p_limit: 25, p_window_seconds: 86400 });
      return quotaError ? Response.json({ message: "unavailable" }, { status: 503 }) : Response.json(permitted);
    }
    if (name === "audit_log") return new Response(null, { status: 201 });
    if (url.hostname === "backend.composio.dev") return Response.json({ successful: true });
    throw new Error(`Unexpected fixture request: ${url.pathname}`);
  }) as typeof fetch;
  try {
    await import("../integrations/index.ts");
    Deno.serve = savedServe;
    const request = () => new Request("https://fixture.test", { method: "POST", headers: { Authorization: "Bearer fixture-token" },
      body: JSON.stringify({ provider: "composio", action: "execute", payload: { tool_slug: "FIXTURE_TOOL", arguments: {} } }) });
    assertEquals((await handler(request())).status, 429);
    assertEquals(calls.includes("FIXTURE_TOOL"), false);
    calls.length = 0; quotaError = true;
    assertEquals((await handler(request())).status, 500);
    assertEquals(calls.includes("FIXTURE_TOOL"), false);
    calls.length = 0; quotaError = false; keyError = true;
    assertEquals((await handler(request())).status, 503);
    assertEquals(calls.includes("filey_take_rate_limit"), false);
    calls.length = 0; keyError = false; permitted = true;
    assertEquals((await handler(request())).status, 200);
    assertEquals(calls.indexOf("filey_take_rate_limit") < calls.indexOf("FIXTURE_TOOL"), true);
  } finally {
    globalThis.fetch = savedFetch; Deno.serve = savedServe;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value);
    }
  }
});
