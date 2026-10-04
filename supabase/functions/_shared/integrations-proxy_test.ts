import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fixtureJwt } from "./test-auth-fixture.ts";

Deno.test("integration writes reserve quota before calling providers and fail closed on settings errors", async () => {
  const savedFetch = globalThis.fetch, savedServe = Deno.serve;
  const env = { SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "fixture-key", COMPOSIO_API_KEY: "fixture-provider-key" };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, Deno.env.get(key)]));
  for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
  let handler!: (req: Request) => Promise<Response>;
  Deno.serve = ((fn: typeof handler) => { handler = fn; return {}; }) as typeof Deno.serve;
  const calls: string[] = [];
  let permitted = false, quotaError = false, keyError = false, verifiedFactor = false;
  let thrownDatabaseError = false, providerFailure = false, thrownProviderError = false, ownKey = false;
  const privateDetail = "fixture-private-key-and-private-customer-address";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const name = url.pathname.split("/").pop()!;
    calls.push(name);
    if (name === "user") return Response.json({ id: "fixture-user", factors: verifiedFactor ? [{ status: "verified" }] : [] });
    if (name === "profiles") return Response.json({ org_id: "fixture-org" });
    if (name === "org_members") {
      if (thrownDatabaseError) throw new Error(privateDetail);
      return Response.json({ role: "owner", modules: null });
    }
    if (name === "integration_keys") return keyError ? Response.json({ message: "unavailable" }, { status: 503 }) : Response.json(ownKey ? { api_key: "fixture-own-provider-key" } : null);
    if (name === "organizations") return Response.json({ plan: "free" });
    if (name === "filey_take_rate_limit") {
      assertEquals(JSON.parse(String(init?.body)), { p_subject: "fixture-user", p_action: "integration_action", p_limit: 25, p_window_seconds: 86400 });
      return quotaError ? Response.json({ message: privateDetail }, { status: 503 }) : Response.json(permitted);
    }
    if (name === "audit_log") return new Response(null, { status: 201 });
    if (["backend.composio.dev", "zernio.com"].includes(url.hostname)) {
      assertEquals(init?.redirect, "error", "Credentialed providers must not follow redirects");
      if (thrownProviderError) throw new Error(privateDetail);
      if (providerFailure) return Response.json({ message: privateDetail }, { status: 400 });
      return Response.json({ successful: true });
    }
    throw new Error(`Unexpected fixture request: ${url.pathname}`);
  }) as typeof fetch;
  try {
    await import("../integrations/index.ts");
    Deno.serve = savedServe;
    const request = (intent: Record<string,unknown> = {}) => new Request("https://fixture.test", { method: "POST", headers: { Authorization: `Bearer ${fixtureJwt("fixture-user")}` },
      body: JSON.stringify({ provider: "composio", action: "execute", payload: { tool_slug: "FIXTURE_TOOL", arguments: {} }, ...intent }) });
    for (const method of ["GET", "PUT", "DELETE"]) {
      assertEquals((await handler(new Request("https://fixture.test", { method }))).status, 405);
    }
    assertEquals((await handler(new Request("https://fixture.test", { method: "OPTIONS" }))).status, 200);
    for (const body of ["null", "[]", "false", '"value"', "{", '{"provider":"composio","action":{}}',
      '{"provider":"composio","action":"execute","payload":[]}',
      '{"provider":"composio","action":"execute","payload":"value"}']) {
      assertEquals((await handler(new Request("https://fixture.test", { method: "POST", body }))).status, 400);
    }
    for (const length of [undefined, "1", "1048577"]) {
      const headers = new Headers(length ? { "content-length": length } : undefined);
      assertEquals((await handler(new Request("https://fixture.test", {
        method: "POST", headers, body: JSON.stringify({ action: "execute", extra: "a".repeat(1_048_577) }),
      }))).status, 413, "Actual bytes must be bounded even with a lying length header");
    }
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(65_536)); },
      cancel() { cancelled = true; },
    });
    assertEquals((await handler(new Request("https://fixture.test", { method: "POST", body: stream }))).status, 413);
    assertEquals(cancelled, true, "An oversized streamed body must cancel its remainder");
    assertEquals(calls, [], "Method/body rejection must precede auth, database and providers");
    verifiedFactor = true;
    assertEquals((await handler(request())).status, 403);
    assertEquals(calls, ["user"], "MFA refusal must happen before credentials, quota or provider calls");
    verifiedFactor = false; calls.length = 0;
    const stale = await handler(request({ expected_org_id: "previous-workspace" }));
    assertEquals(stale.status, 409);
    assertEquals(await stale.json(), { error: "Workspace changed. Reopen Integrations before continuing." });
    assertEquals(calls, ["user", "profiles"], "A same-account workspace switch must stop before module/key/quota/provider access");
    for (const invalid of [null, "", {}, "a".repeat(201)]) {
      calls.length = 0;
      assertEquals((await handler(request({ expected_org_id: invalid }))).status, 409);
      assertEquals(calls, ["user"], "Malformed intent must stop before workspace data access");
    }
    calls.length = 0;
    assertEquals((await handler(request())).status, 429);
    assertEquals(calls.includes("FIXTURE_TOOL"), false);
    calls.length = 0; quotaError = true;
    const quotaFailure = await handler(request());
    assertEquals(quotaFailure.status, 500);
    assertEquals((await quotaFailure.text()).includes(privateDetail), false, "Thrown SQL quota details must not escape the handler");
    assertEquals(calls.includes("FIXTURE_TOOL"), false);
    calls.length = 0; quotaError = false; keyError = true;
    assertEquals((await handler(request())).status, 503);
    assertEquals(calls.includes("filey_take_rate_limit"), false);
    calls.length = 0; keyError = false; permitted = true;
    assertEquals((await handler(request())).status, 200);
    assertEquals(calls.indexOf("filey_take_rate_limit") < calls.indexOf("FIXTURE_TOOL"), true);
    calls.length = 0;
    assertEquals((await handler(request({ expected_org_id: "fixture-org" }))).status, 200);
    assertEquals(calls.indexOf("filey_take_rate_limit") < calls.indexOf("FIXTURE_TOOL"), true,
      "Current workspace intent preserves legitimate integrations");
    calls.length = 0; thrownDatabaseError = true;
    const databaseFailure = await handler(request());
    assertEquals(databaseFailure.status, 403, "Membership lookup failure retains its static access-denial response");
    assertEquals((await databaseFailure.text()).includes(privateDetail), false, "Thrown SQL/client errors must not expose private details");
    assertEquals(calls.includes("FIXTURE_TOOL"), false);
    thrownDatabaseError = false; providerFailure = true;
    const rawProviderError = await handler(request());
    assertEquals(rawProviderError.status, 400);
    assertEquals(await rawProviderError.json(), { error: "The app rejected that action" }, "Provider body messages must not be forwarded");
    providerFailure = false; thrownProviderError = true;
    const providerError = await handler(request());
    assertEquals(providerError.status, 500);
    assertEquals((await providerError.text()).includes(privateDetail), false, "Thrown provider errors must not expose private details");
    thrownProviderError = false; ownKey = true;
    assertEquals((await handler(request({ provider: "zernio", action: "delete_post", payload: { post_id: "fixture-post" } }))).status, 200,
      "Direct DELETE must preserve the same credential redirect policy and normal output");
    const unknownAction = await handler(request({ action: "unknown_action_with_private_suffix" }));
    assertEquals(unknownAction.status, 400);
    assertEquals(await unknownAction.json(), { error: "Unknown Composio action" }, "Static validation must not echo untrusted tails");
  } finally {
    globalThis.fetch = savedFetch; Deno.serve = savedServe;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value);
    }
  }
});
