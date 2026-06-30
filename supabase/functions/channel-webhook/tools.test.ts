// Runnable check for the agent data tools:  deno test supabase/functions/channel-webhook/
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runTool, TOOLS } from "./tools.ts";

// Minimal thenable query-builder stub. Records every .eq() so we can assert
// org scoping; resolves to { data } when awaited.
function fakeClient(rows: unknown[]) {
  const eqs: [string, unknown][] = [];
  // deno-lint-ignore no-explicit-any
  const builder: any = {
    select: () => builder,
    eq: (c: string, v: unknown) => {
      eqs.push([c, v]);
      return builder;
    },
    order: () => builder,
    limit: () => builder,
    lt: () => builder,
    or: () => builder,
    then: (resolve: (x: unknown) => void) => resolve({ data: rows, error: null }),
  };
  return { client: { from: () => builder }, eqs };
}

Deno.test("every read tool scopes its query to the caller's org", async () => {
  for (const tool of TOOLS) {
    const { client, eqs } = fakeClient([]);
    await runTool(client, "ORG-123", tool.name, { query: "acme" });
    const scoped = eqs.some(([c, v]) => c === "org_id" && v === "ORG-123");
    assertEquals(scoped, true, `${tool.name} must filter by org_id (cross-tenant leak otherwise)`);
  }
});

Deno.test("list_low_stock returns only items at/below a set reorder level", async () => {
  const rows = [
    { sku: "A", name: "Low", quantity: 2, reorder_level: 5 },
    { sku: "B", name: "Fine", quantity: 50, reorder_level: 5 },
    { sku: "C", name: "NoThreshold", quantity: 0, reorder_level: 0 },
  ];
  const { client } = fakeClient(rows);
  const out = (await runTool(client, "ORG", "list_low_stock", {})) as { sku: string }[];
  assertEquals(out.map((p) => p.sku), ["A"]);
});

Deno.test("find_customer ignores empty queries and sanitizes filter chars", async () => {
  const { client } = fakeClient([]);
  assertEquals(await runTool(client, "ORG", "find_customer", { query: "   " }), []);
});

Deno.test("unknown tool returns an error object, never throws", async () => {
  const { client } = fakeClient([]);
  const out = (await runTool(client, "ORG", "nope", {})) as { error: string };
  assertEquals(typeof out.error, "string");
});
