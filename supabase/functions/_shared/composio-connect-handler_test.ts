import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fixtureJwt } from "./test-auth-fixture.ts";
import { integrationEntity } from "./integration-access.ts";

Deno.test("Composio BYOK handler validates config and Connect Link without forwarding tokens or caller identity", async () => {
  const savedFetch = globalThis.fetch, savedServe = Deno.serve;
  const env = { SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key", COMPOSIO_API_KEY: "fixture-platform-key" };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, Deno.env.get(key)]));
  for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
  let handler!: (req: Request) => Promise<Response>;
  Deno.serve = ((fn: typeof handler) => { handler = fn; return {}; }) as typeof Deno.serve;
  const entity = await integrationEntity("fixture-org", "fixture-user");
  const calls: { url: URL; init?: RequestInit }[] = [];
  let config: unknown = { items: [{ id: "ac_fixture", toolkit: { slug: "gmail" }, status: "ENABLED" }] };
  let created: unknown = { toolkit: { slug: "gmail" }, auth_config: { id: "ac_created" } };
  let link: unknown = { redirect_url: "https://connect.composio.dev/link/fixture", connected_account_id: "ca_fixture", link_token: "fixture-private-token", state: { access_token: "fixture-private-token" } };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const name = url.pathname.split("/").pop();
    if (name === "user") return Response.json({ id: "fixture-user", factors: [] });
    if (name === "profiles") return Response.json({ org_id: "fixture-org" });
    if (name === "org_members") return Response.json({ role: "owner", modules: null });
    if (name === "integration_keys") {
      assertEquals(url.searchParams.get("user_id"), "eq.fixture-user");
      assertEquals(url.searchParams.get("provider"), "eq.composio");
      return Response.json({ api_key: "fixture-own-key" });
    }
    if (url.hostname === "backend.composio.dev") {
      calls.push({ url, init });
      assertEquals(url.protocol, "https:");
      assertEquals(init?.redirect, "error");
      assertEquals(new Headers(init?.headers).get("x-api-key"), "fixture-own-key");
      if (url.pathname === "/api/v3/auth_configs") {
        if (init?.method === "POST") {
          assertEquals(JSON.parse(String(init.body)), { toolkit: { slug: "gmail" }, auth_config: { type: "use_composio_managed_auth" } });
          return Response.json(created, { status: 201 });
        }
        assertEquals(url.searchParams.get("toolkit_slug"), "gmail");
        assertEquals(url.searchParams.get("limit"), "1");
        return Response.json(config);
      }
      if (url.pathname === "/api/v3/connected_accounts/link") {
        assertEquals(init?.method, "POST");
        assertEquals(JSON.parse(String(init?.body)), { auth_config_id: Array.isArray((config as {items?:unknown[]})?.items) && (config as {items:unknown[]}).items.length ? "ac_fixture" : "ac_created", user_id: entity });
        return Response.json(link, { status: 201 });
      }
    }
    throw new Error("Unexpected synthetic request.");
  }) as typeof fetch;
  try {
    await import("../integrations/index.ts");
    Deno.serve = savedServe;
    const request = (toolkit: unknown = "GMAIL") => new Request("https://fixture.test", {
      method: "POST", headers: { Authorization: `Bearer ${fixtureJwt("fixture-user")}` },
      body: JSON.stringify({ provider: "composio", action: "connect", expected_org_id: "fixture-org",
        payload: { toolkit, user_id: "forged-user", auth_config_id: "forged-config", experimental: { account_type: "SHARED" } } }),
    });
    const existing = await handler(request());
    assertEquals(existing.status, 200);
    assertEquals(await existing.json(), { redirect_url: "https://connect.composio.dev/link/fixture", connected_account_id: "ca_fixture" });
    assertEquals(calls.length, 2);
    assertEquals(calls.some(call => call.init?.method === "POST" && call.url.pathname.endsWith("auth_configs")), false);

    calls.length = 0; config = { items: [] };
    assertEquals((await handler(request())).status, 200);
    assertEquals(calls.length, 3, "A genuinely missing config creates one then uses the supported link endpoint");

    for (const invalid of [null, {}, { items: null }, { items: [{ id: "ac_fixture", toolkit: { slug: "slack" } }] },
      { items: [{ id: "ac_fixture", toolkit: { slug: "gmail" }, status: "DISABLED" }] }]) {
      calls.length = 0; config = invalid;
      assertEquals((await handler(request())).status, 502);
      assertEquals(calls.length, 1, "Invalid config lookup must never create or initiate authorization");
    }
    config = { items: [] }; created = { toolkit: { slug: "slack" }, auth_config: { id: "ac_created" } };
    calls.length = 0;
    assertEquals((await handler(request())).status, 502);
    assertEquals(calls.length, 2, "A mismatched created config must never start another app's authorization");

    config = { items: [{ id: "ac_fixture", toolkit: { slug: "gmail" }, status: "ENABLED" }] };
    for (const invalid of [null, {}, { redirect_url: "https://fixture.test/" },
      { redirect_url: "javascript:alert(1)", connected_account_id: "ca_fixture" },
      { redirect_url: "https://fixture.test/", connected_account_id: "ca/foreign" }]) {
      link = invalid;
      const response = await handler(request());
      assertEquals(response.status, 502);
      assertEquals(await response.json(), { error: "Could not verify the app sign-in link. Try connecting again." });
    }
    for (const invalid of [null, {}, "", "gmail?user_id=foreign", "a".repeat(257), "gmail\n"]) {
      calls.length = 0;
      assertEquals((await handler(request(invalid))).status, 400);
      assertEquals(calls.length, 0, "Invalid toolkit must not reach the provider");
    }
  } finally {
    globalThis.fetch = savedFetch; Deno.serve = savedServe;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value);
    }
  }
});
