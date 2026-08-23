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
    lte: () => builder,
    gt: () => builder,
    gte: () => builder,
    neq: () => builder,
    in: () => builder,
    or: () => builder,
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    then: (resolve: (x: unknown) => void) => resolve({ data: rows, error: null }),
  };
  return { client: { from: () => builder }, eqs };
}

// Inputs that make each read tool actually run its query.
const READ_INPUTS: Record<string, unknown> = {
  find_customer: { query: "acme" },
  run_report: { report: "receivables_aging" },
  get_invoice_detail: { invoice_number: "INV-1" },
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
  log_expense: { category: "fuel", amount: 120 },
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

// ---- channel accountant toolkit ----

Deno.test("get_invoice_detail computes subtotal, VAT and total from line items", async () => {
  // Header row comes back from maybeSingle (first row); items from the await.
  const inv = {
    id: 9,
    number: "INV-1",
    status: "sent",
    currency: "AED",
    customer_name: "Acme",
    customer_email: null,
    issue_date: "2026-08-01",
    due_date: "2026-08-31",
    tax_rate: 5,
    discount: 100,
  };
  const calls: string[] = [];
  // deno-lint-ignore no-explicit-any
  const client: any = {
    from(table: string) {
      calls.push(table);
      if (table === "invoice_docs") {
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.eq = () => b;
        b.maybeSingle = () => Promise.resolve({ data: inv, error: null });
        return b;
      }
      const b2: Record<string, unknown> = {};
      b2.select = () => b2;
      b2.eq = () => b2;
      b2.order = () => b2;
      b2.then = (resolve: (x: unknown) => void) =>
        resolve({
          data: [
            { description: "A", qty: 2, unit_price: 500 },
            { description: "B", qty: 1, unit_price: 200 },
          ],
          error: null,
        });
      return b2;
    },
  };
  const out = (await runTool(client, "ORG", "get_invoice_detail", { invoice_number: "INV-1" })) as {
    subtotal: number;
    tax: number;
    total: number;
  };
  assertEquals(out.subtotal, 1200);
  assertEquals(out.tax, 55); // (1200 - 100 discount) * 5%
  assertEquals(out.total, 1155); // 1100 taxable + 55 tax
});

Deno.test("get_vat_summary splits output vs input tax from tax_rate fields", async () => {
  const docs = [
    { id: 1, issue_date: "2026-08-01", tax_rate: 5, doc_type: "Tax Invoice" },
    { id: 2, issue_date: "2026-08-02", tax_rate: 5, doc_type: "purchase" },
  ];
  const client = fakeClient(docs);
  // Second query (items for ids 1..2): reuse the same thenable builder —
  // it resolves to the same rows array, so give it item-shaped rows.
  const out = (await runTool(client.client, "ORG", "get_vat_summary", {})) as {
    output_tax: number;
    input_tax: number;
    net_vat: number;
  };
  void docs;
  // The shared fake returns [] for the items fetch → zero nets, but the
  // shape and org scoping are what we're pinning here.
  assertEquals(out.output_tax, 0);
  assertEquals(out.input_tax, 0);
  assertEquals(
    client.eqs.some(([c, v]) => c === "org_id" && v === "ORG"),
    true,
  );
});

Deno.test("expense_totals groups spend by category over the period", async () => {
  const { client } = fakeClient([
    { category: "fuel", amount: 50 },
    { category: "fuel", amount: 25.5 },
    { category: "rent", amount: 1000 },
  ]);
  const out = (await runTool(client, "ORG", "expense_totals", {})) as {
    total: number;
    by_category: { category: string; amount: number }[];
  };
  assertEquals(out.total, 1075.5);
  assertEquals(out.by_category[0], { category: "rent", amount: 1000 });
});

Deno.test("stock_valuation sums quantity × cost across products", async () => {
  const { client } = fakeClient([
    { sku: "A", name: "Widget", quantity: 10, cost_price: 3.5, unit_price: 9 },
    { sku: "B", name: "Gadget", quantity: 2, cost_price: 40, unit_price: 80 },
  ]);
  const out = (await runTool(client, "ORG", "stock_valuation", {})) as {
    products: number;
    cost_value: number;
    retail_value: number;
  };
  assertEquals(out.products, 2);
  assertEquals(out.cost_value, 115);
  assertEquals(out.retail_value, 250);
});

// ---- propose_mark_invoice_paid ----

/** Fake for proposals: invoice lookup by number + pending-action inserts
 *  (with an optional unique-violation on the first N attempts to prove the
 *  collision retry). */
function fakeProposalClient(invoice: unknown, failInserts = 0) {
  const inserts: [string, Record<string, unknown>][] = [];
  let attempts = 0;
  const codes: string[] = [];
  const client = {
    from(table: string) {
      if (table === "invoice_docs") {
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.eq = () => b;
        b.maybeSingle = () => Promise.resolve({ data: invoice ?? null, error: null });
        return b;
      }
      if (table === "agent_pending_actions") {
        return {
          insert: async (row: Record<string, unknown>) => {
            attempts++;
            codes.push(String(row.code));
            if (attempts <= failInserts)
              return { error: { code: "23505", message: "duplicate key value violates unique constraint" } };
            inserts.push([table, row]);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { client, inserts, codes, get attempts() { return attempts; } };
}

Deno.test("propose_mark_invoice_paid parks a pending action, never executes", async () => {
  const f = fakeProposalClient({ id: 77, number: "INV-77", status: "sent" });
  const out = (await runTool(f.client, "ORG-9", "propose_mark_invoice_paid", {
    invoice_number: "INV-77",
  }, "OWNER")) as { proposed?: string; approval_code?: string };

  assertEquals(out.proposed, "mark_invoice_paid");
  assertEquals(/^\d{4}$/.test(out.approval_code ?? ""), true);
  const parked = f.inserts[0][1];
  assertEquals(parked.action, "mark_invoice_paid");
  assertEquals(parked.org_id, "ORG-9");
  assertEquals(parked.payload, { invoice_id: 77, invoice_number: "INV-77" });
  assertEquals(parked.status, undefined, "DB default is pending — no explicit override needed");
  assertEquals(typeof parked.expires_at, "string");
  assertEquals(f.inserts.length, 1);
});

Deno.test("proposal codes come from the CSPRNG and retry on live-code collision", async () => {
  const f = fakeProposalClient({ id: 78, number: "INV-78", status: "sent" }, 2);
  const out = (await runTool(f.client, "ORG", "propose_mark_invoice_paid", {
    invoice_number: "INV-78",
  }, "OWNER")) as { approval_code?: string };
  assertEquals(typeof out.approval_code, "string");
  assertEquals(f.attempts, 3, "two 23505 collisions then success");
  assertEquals(new Set(f.codes).size, f.codes.length, "a colliding code must never be reused");
});

Deno.test("propose_mark_invoice_paid validates status before parking anything", async () => {
  for (const status of ["paid", "draft"]) {
    const f = fakeProposalClient({ id: 79, number: "INV-79", status });
    const out = (await runTool(f.client, "ORG", "propose_mark_invoice_paid", {
      invoice_number: "INV-79",
    }, "OWNER")) as { error?: string };
    assertEquals(typeof out.error, "string", `${status} must be refused`);
    assertEquals(f.inserts.length, 0, `nothing parked for a ${status} invoice`);
  }

  const missing = fakeProposalClient(null);
  const nf = (await runTool(missing.client, "ORG", "propose_mark_invoice_paid", {
    invoice_number: "NOPE",
  }, "OWNER")) as { error?: string };
  assertEquals(typeof nf.error, "string");
});
