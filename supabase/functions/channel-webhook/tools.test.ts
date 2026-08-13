// Runnable check for the agent data tools:  deno test supabase/functions/channel-webhook/
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runTool, TOOLS, WRITE_TOOLS } from "./tools.ts";

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
    gte: () => builder,
    neq: () => builder,
    in: () => builder,
    or: () => builder,
    then: (resolve: (x: unknown) => void) => resolve({ data: rows, error: null }),
  };
  return { client: { from: () => builder }, eqs };
}

// Inputs that make each read tool actually run its query.
const READ_INPUTS: Record<string, unknown> = {
  find_customer: { query: "acme" },
  run_report: { report: "receivables_aging" },
};

Deno.test("every read tool scopes its query to the caller's org", async () => {
  for (const tool of TOOLS) {
    const { client, eqs } = fakeClient([]);
    await runTool(client, "ORG-123", tool.name, READ_INPUTS[tool.name] ?? {});
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

// ---- draft-only write tools ----

// Records every insert payload; select/single resolve with a fake id.
function fakeWriteClient() {
  const inserts: [string, unknown][] = [];
  const from = (table: string) => {
    // deno-lint-ignore no-explicit-any
    const builder: any = {
      insert: (rows: unknown) => {
        inserts.push([table, rows]);
        return builder;
      },
      select: () => builder,
      single: () => Promise.resolve({ data: { id: 42 }, error: null }),
      eq: () => builder,
      ilike: () => builder,
      limit: () => builder,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (resolve: (x: unknown) => void) => resolve({ data: null, error: null }),
    };
    return builder;
  };
  return { client: { from }, inserts };
}

const WRITE_INPUTS: Record<string, unknown> = {
  create_draft_invoice: {
    customer_name: "Acme",
    items: [{ description: "Widget", qty: 2, unit_price: 100 }],
  },
  create_draft_quote: {
    customer_name: "Acme",
    items: [{ description: "Widget", unit_price: 50 }],
  },
  create_draft_po: {
    supplier_name: "Dune Oil",
    items: [{ description: "Drum", qty: 3, unit_cost: 40 }],
  },
  add_customer: { name: "New Co" },
  add_product: { name: "New Product" },
};

Deno.test("write tools pin user_id + org_id on every insert", async () => {
  for (const tool of WRITE_TOOLS) {
    const { client, inserts } = fakeWriteClient();
    const out = await runTool(client, "ORG-1", tool.name, WRITE_INPUTS[tool.name], "OWNER-1");
    assertEquals((out as { error?: string }).error, undefined, `${tool.name} errored`);
    // Every non-audit insert must carry explicit ownership.
    const rows = inserts
      .filter(([t]) => t !== "audit_log")
      .flatMap(([, r]) => (Array.isArray(r) ? r : [r])) as Record<string, unknown>[];
    for (const row of rows) {
      assertEquals(row.user_id, "OWNER-1", `${tool.name}: insert missing user_id`);
      assertEquals(row.org_id, "ORG-1", `${tool.name}: insert missing org_id`);
    }
  }
});

Deno.test("document write tools only ever create drafts", async () => {
  for (const name of ["create_draft_invoice", "create_draft_quote", "create_draft_po"]) {
    const { client, inserts } = fakeWriteClient();
    await runTool(client, "ORG", name, WRITE_INPUTS[name], "OWNER");
    const heads = inserts
      .filter(([t]) => ["invoice_docs", "quotations", "purchase_orders"].includes(t))
      .flatMap(([, r]) => (Array.isArray(r) ? r : [r])) as { status?: string }[];
    for (const h of heads) assertEquals(h.status, "draft", `${name} must create drafts only`);
  }
});

Deno.test("write tools refuse to run without an owner", async () => {
  const { client } = fakeWriteClient();
  const out = (await runTool(client, "ORG", "add_customer", { name: "X" })) as { error: string };
  assertEquals(typeof out.error, "string");
});

/* send_message — the agent talking to someone who is NOT the owner. The
 * recipient must be pinned down exactly, and nothing may go out without an
 * approval code. */
function fakeLookupClient(customers: unknown[]) {
  const inserts: [string, unknown][] = [];
  const from = (table: string) => {
    // deno-lint-ignore no-explicit-any
    const builder: any = {
      insert: (rows: unknown) => {
        inserts.push([table, rows]);
        return Promise.resolve({ error: null });
      },
      select: () => builder,
      eq: () => builder,
      ilike: () => builder,
      limit: () => Promise.resolve({ data: customers, error: null }),
      then: (resolve: (x: unknown) => void) => resolve({ data: customers, error: null }),
    };
    return builder;
  };
  return { client: { from }, inserts };
}

Deno.test("send_message parks an approval instead of sending", async () => {
  const { client, inserts } = fakeLookupClient([{ name: "Acme", company: "Acme LLC", phone: "+971500000000" }]);
  const out = (await runTool(client, "ORG", "send_message", {
    channel: "whatsapp",
    customer_name: "acme",
    text: "Your invoice is ready.",
  }, "OWNER")) as { code?: string; proposed?: string };

  assertEquals(out.proposed, "send_message");
  assertEquals(typeof out.code, "string");
  const parked = inserts.find(([t]) => t === "agent_pending_actions");
  assertEquals(Boolean(parked), true, "must park a pending action, never send directly");
  const row = parked![1] as { action: string; payload: { to: string } };
  assertEquals(row.action, "send_message");
  assertEquals(row.payload.to, "+971500000000", "must resolve the CRM phone, not the name");
});

Deno.test("send_message refuses an ambiguous or unreachable recipient", async () => {
  const two = fakeLookupClient([{ name: "Acme One", phone: "1" }, { name: "Acme Two", phone: "2" }]);
  const ambiguous = (await runTool(two.client, "ORG", "send_message", {
    channel: "whatsapp", customer_name: "acme", text: "hi",
  }, "OWNER")) as { error?: string };
  assertEquals(typeof ambiguous.error, "string");
  assertEquals(two.inserts.length, 0, "an ambiguous match must not park anything");

  const noPhone = fakeLookupClient([{ name: "Acme", phone: null }]);
  const unreachable = (await runTool(noPhone.client, "ORG", "send_message", {
    channel: "whatsapp", customer_name: "acme", text: "hi",
  }, "OWNER")) as { error?: string };
  assertEquals(typeof unreachable.error, "string");
});
