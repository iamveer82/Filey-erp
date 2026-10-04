import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { composioAuthConfig, composioConnectLink, composioIdentifier, createdComposioAuthConfig } from "./composio-connect.ts";

Deno.test("Composio config lookup distinguishes no configuration from malformed data", () => {
  assertEquals(composioAuthConfig({ items: [] }, "gmail"), null);
  assertEquals(composioAuthConfig({ items: [{ id: "ac_fixture", toolkit: { slug: "gmail" }, status: "ENABLED" }] }, "gmail"), "ac_fixture");
  for (const body of [null, {}, { items: null }, { items: [null] },
    { items: [{ id: "ac_fixture", toolkit: { slug: "slack" } }] },
    { items: [{ id: "ac_fixture", toolkit: { slug: "gmail" }, status: "DISABLED" }] },
    { items: [{ id: "private?key=fixture", toolkit: { slug: "gmail" } }] }]) {
    assertThrows(() => composioAuthConfig(body, "gmail"));
  }
});

Deno.test("Composio created config must belong to the requested toolkit", () => {
  assertEquals(createdComposioAuthConfig({ toolkit: { slug: "gmail" }, auth_config: { id: "ac_fixture" } }, "gmail"), "ac_fixture");
  for (const body of [null, {}, { auth_config: { id: "ac_fixture" } },
    { toolkit: { slug: "slack" }, auth_config: { id: "ac_fixture" } },
    { toolkit: { slug: "gmail" }, auth_config: { id: "" } }]) {
    assertThrows(() => createdComposioAuthConfig(body, "gmail"));
  }
});

Deno.test("Composio connect response projects only the hosted link and poll identity", () => {
  assertEquals(composioConnectLink({ redirect_url: "https://connect.composio.dev/link/fixture", connected_account_id: "ca_fixture",
    link_token: "fixture-private", state: { access_token: "fixture-private" }, experimental: { account_type: "SHARED" } }),
  { redirect_url: "https://connect.composio.dev/link/fixture", connected_account_id: "ca_fixture" });
});

Deno.test("Composio connect rejects malformed or incomplete authorization responses", () => {
  for (const body of [null, {}, { redirect_url: "https://fixture.test/" },
    { redirect_url: "https://fixture.test/", connected_account_id: "ca/other" },
    { redirect_url: "https://fixture.test/", connected_account_id: "a".repeat(257) },
    ...["javascript:alert(1)", "http://fixture.test/", "https://owner:secret@fixture.test/", "https://fixture.test/\n", "https://fixture.test/ ", ""].map(redirect_url => ({ redirect_url, connected_account_id: "ca_fixture" })),
    { redirect_url: `https://fixture.test/${"a".repeat(8192)}`, connected_account_id: "ca_fixture" }]) {
    assertThrows(() => composioConnectLink(body));
  }
});

Deno.test("Composio identifiers are bounded path and query-safe slugs", () => {
  for (const value of ["gmail", "ca_fixture-123", "ac_fixture"]) assertEquals(composioIdentifier(value), true);
  for (const value of [null, {}, 1, "", "gmail?user_id=other", "a".repeat(257), "gmail\n", "ca_fixture\n"]) assertEquals(composioIdentifier(value), false);
});
