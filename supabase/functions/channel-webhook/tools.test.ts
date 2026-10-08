// Runnable check for the agent data tools:  deno test supabase/functions/channel-webhook/
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { boundedToolResult, runTool, TOOLS, WRITE_TOOLS } from "./tools.ts";
import { RESERVED_ITEM_COLUMNS, DEFAULT_COLUMN_LABELS } from "../_shared/docItems.ts";

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
  assertEquals(typeof (await runTool(client, "ORG", "find_customer", { query: "   " }) as { error?: string }).error, "string");
});

Deno.test("unknown tool returns an error object, never throws", async () => {
  const { client } = fakeClient([]);
  const out = (await runTool(client, "ORG", "nope", {})) as { error: string };
  assertEquals(typeof out.error, "string");
});

Deno.test("hosted invoice reads and reminder proposals retain complete long numbers and reject overlong input", async () => {
  for (const name of ["get_invoice_detail", "request_payment_reminder"]) {
    for (const size of [80, 160]) {
      const f = fakeClient([]), number = `INV-${"X".repeat(size - 4)}`;
      await runTool(f.client, "ORG", name, { invoice_number: number }, "OWNER");
      assertEquals(f.eqs.some(([column, value]) => column === "number" && value === number), true, name);
    }
    const f = fakeClient([]);
    const result = await runTool(f.client, "ORG", name, { invoice_number: "X".repeat(161) }, "OWNER") as { error?: string };
    assertEquals(typeof result.error, "string");
    assertEquals(f.eqs.length, 0, "invalid number must not query a shortened identity");
  }
});

// ---- draft-only write tools ----

// Records every insert payload; select/single resolve with a fake id.
function fakeWriteClient() {
  const inserts: [string, unknown][] = [];
  const rpcRequests: Record<string, unknown>[] = [];
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
  return { client: { from, rpc: (name: string, input: Record<string, unknown>): Promise<{ data: { created: string; id: number; number: string } | null; error: { code: string } | null }> => {
    assertEquals(name, "filey_channel_create_draft");
    rpcRequests.push(input);
    return Promise.resolve({ data: { created: "draft", id: 42, number: "DEMO-42" }, error: null });
  } }, inserts, rpcRequests };
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

Deno.test("hosted T.Liters draft preserves physical quantities, units, rates and custom columns", async () => {
  const f = fakeWriteClient();
  const input = { customer_name: "Fixture buyer", issue_date: "2026-09-23", due_date: "2026-10-01", notes: "Keep this\nexactly.", terms: "Delivery after payment.",
    custom_columns: [{ key: "liters", label: "T.Liters" }], price_by: "liters",
    items: [{ description: "H/O 68 PAIL 20L", qty: 50, unit: "L", unit_price: 0.20, custom: { liters: "1000" } },
      { description: "15W40 PAIL 20L", qty: 15, unit: "L", unit_price: 4.10, custom: { liters: "300" } }] };
  const result = await runTool(f.client, "ORG", "create_draft_invoice", input, "OWNER");
  assertEquals((result as { created: string }).created, "draft");
  assertEquals(f.rpcRequests, [{ p_owner: "OWNER", p_org: "ORG", p_kind: "invoice", p_input: input }]);
});

Deno.test("hosted invoice dates and tax precision validate before any allocation", async () => {
  const f = fakeWriteClient();
  for (const fields of [{ issue_date: "2026-02-31" }, { issue_date: "23/09/26" }, { issue_date: "" },
    { due_date: "2026-13-01" }, { due_date: null }, { tax_rate: 5.1234 }, { tax_rate: 101 }, { notes: 123 }]) {
    const result = await runTool(f.client, "ORG", "create_draft_invoice", { ...WRITE_INPUTS.create_draft_invoice as object, ...fields }, "OWNER") as { error?: string };
    assertEquals(typeof result.error, "string", JSON.stringify(fields));
  }
  assertEquals(f.rpcRequests.length, 0);
  const result = await runTool(f.client, "ORG", "create_draft_invoice", { ...WRITE_INPUTS.create_draft_invoice as object, due_date: "", notes: "", terms: "", tax_rate: 5.123 }, "OWNER") as { created?: string };
  assertEquals(result.created, "draft");
  assertEquals(f.rpcRequests.length, 1);
});

Deno.test("hosted definitive draft validation is rejected while unknown database failures remain uncertain", async () => {
  for (const [code,message] of [["22023", "Every invoice line needs a numeric pricing multiplier"],
    ["22023", "private_schema.secret internal failure"], ["57014", "statement timeout"]]) {
    const client = { rpc: () => Promise.resolve({ data: null, error: { code, message } }) };
    const result = await runTool(client, "ORG", "create_draft_invoice", WRITE_INPUTS.create_draft_invoice, "OWNER") as { code: string; error: string; save_outcome?: string; retry_safe: boolean };
    assertEquals(result.code, code === "22023" ? "invalid_arguments" : "unconfirmed_write");
    assertEquals(result.retry_safe, code === "22023");
    assertEquals(result.error.includes("private_schema"), false);
    if (code === "22023") assertEquals(result.save_outcome, "rejected");
  }
});

Deno.test("hosted unsupported manual pricing stops before allocation without stripping values", async () => {
  for (const extra of [{ amount: 123 }, { custom: { __manual_amount: "123", __calc_mode: "manual" } }, { itemFormula: { a: "liters" } }]) {
    const f = fakeWriteClient();
    const result = await runTool(f.client, "ORG", "create_draft_invoice", { customer_name: "Fixture buyer",
      items: [{ description: "Item", qty: 50, unit_price: 0.2, ...extra }] }, "OWNER");
    assertEquals((result as { code: string }).code, "unsupported_invoice_calculation");
    assertEquals(f.rpcRequests.length, 0);
  }
});

Deno.test("hosted custom pricing rejects malformed objects without weakening other tool allowlists", async () => {
  const f = fakeWriteClient();
  for (const input of [
    { customer_name: "Fixture buyer", items: [{ description: "Item", unit_price: 1, custom: { liters: { nested: 3 } } }] },
    { customer_name: "Fixture buyer", items: [{ description: "Item", unit_price: 1 }], status: "sent" },
  ]) {
    assertEquals(typeof (await runTool(f.client, "ORG", "create_draft_invoice", input, "OWNER") as { error: unknown }).error, "string");
  }
  assertEquals(f.rpcRequests.length, 0);
});

Deno.test("hosted custom columns reject every editor-reserved key and heading before allocation", async () => {
  const f = fakeWriteClient();
  for (const column of [
    ...[...RESERVED_ITEM_COLUMNS].map(key => ({ key, label: "T.Liters" })),
    ...[...DEFAULT_COLUMN_LABELS].flatMap(label => ["  ", "\t", "\u00a0\uFEFF"].map(space => ({ key: "liters", label: `${space}${label.toUpperCase()}${space}` }))),
  ]) {
    const result = await runTool(f.client, "ORG", "create_draft_invoice", {
      customer_name: "Fixture buyer", custom_columns: [column], price_by: column.key,
      items: [{ description: "Item", qty: 50, unit_price: 0.2, custom: { [column.key]: "1000" } }],
    }, "OWNER") as { error?: string };
    assertEquals(typeof result.error, "string", JSON.stringify(column));
  }
  assertEquals(f.rpcRequests.length, 0);
});

Deno.test("write tools pin user_id + org_id on every insert", async () => {
  for (const tool of WRITE_TOOLS) {
    const { client, inserts, rpcRequests } = fakeWriteClient();
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
    for (const params of rpcRequests) {
      assertEquals(params.p_owner, "OWNER-1");
      assertEquals(params.p_org, "ORG-1");
    }
  }
});

Deno.test("document write tools only ever create drafts", async () => {
  for (const name of ["create_draft_invoice", "create_draft_quote", "create_draft_po"]) {
    const { client, inserts, rpcRequests } = fakeWriteClient();
    const result = await runTool(client, "ORG", name, WRITE_INPUTS[name], "OWNER") as { created: string };
    assertEquals(result.created, "draft");
    assertEquals(rpcRequests.length, 1);
    assertEquals(rpcRequests[0].p_kind, name.replace("create_draft_", ""));
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

Deno.test("one hosted task reuses successful write receipts even if the model changes property order", async () => {
  for (const tool of WRITE_TOOLS) {
    const f = fakeWriteClient();
    const receipts = new Map<string, Promise<unknown>>();
    const input = WRITE_INPUTS[tool.name] as Record<string, unknown>;
    const reordered = Object.fromEntries(Object.entries(input).reverse());
    const source = { channel: "whatsapp" as const, externalId: "971500000000" };
    const [first, repeat] = await Promise.all([
      runTool(f.client, "ORG", tool.name, input, "OWNER", source, receipts),
      runTool(f.client, "ORG", tool.name, reordered, "OWNER", source, receipts),
    ]);
    assertEquals(repeat, first);
    assertEquals(f.rpcRequests.length + f.inserts.filter(([table]) => table !== "audit_log").length, 1, tool.name);
    await runTool(f.client, "ORG", tool.name, input, "OWNER", source, new Map());
    assertEquals(f.rpcRequests.length + f.inserts.filter(([table]) => table !== "audit_log").length, 2, "a later user task can deliberately repeat the write");
  }
});

Deno.test("write receipts keep distinct inputs and workspace/conversation identities separate", async () => {
  const f = fakeWriteClient();
  const receipts = new Map<string, Promise<unknown>>();
  const source = { channel: "telegram" as const, externalId: "42" };
  await runTool(f.client, "ORG", "add_customer", { name: "One" }, "OWNER", source, receipts);
  await runTool(f.client, "ORG", "add_customer", { name: "Two" }, "OWNER", source, receipts);
  await runTool(f.client, "OTHER", "add_customer", { name: "One" }, "OWNER", source, receipts);
  await runTool(f.client, "ORG", "add_customer", { name: "One" }, "OTHER-OWNER", source, receipts);
  await runTool(f.client, "ORG", "add_customer", { name: "One" }, "OWNER", { ...source, externalId: "43" }, receipts);
  assertEquals(f.inserts.filter(([table]) => table === "crm_customers").length, 5);
});

Deno.test("lost or malformed additive write receipts stop rather than creating duplicates on retry", async () => {
  for (const name of ["add_customer", "add_product", "log_expense"]) {
    for (const outcome of ["throw", "error", "missing-id"]) {
      let inserted = 0;
      const client = { from: () => {
        const builder = {
          insert: () => { inserted++; return builder; },
          select: () => builder,
          single: () => outcome === "throw" ? Promise.reject(new Error("response lost after commit"))
            : Promise.resolve(outcome === "error" ? { data: null, error: { code: "FetchError" } } : { data: {}, error: null }),
        };
        return builder;
      } };
      const receipts = new Map<string, Promise<unknown>>();
      const first = await runTool(client, "ORG", name, WRITE_INPUTS[name], "OWNER", undefined, receipts) as { created?: string; code?: string; retry_safe?: boolean };
      assertEquals(first.created, undefined);
      assertEquals(first.code, "unconfirmed_write", `${name} ${outcome}`);
      assertEquals(first.retry_safe, false);
      assertEquals(await runTool(client, "ORG", name, WRITE_INPUTS[name], "OWNER", undefined, receipts), first);
      assertEquals(inserted, 1);
    }
  }
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

Deno.test("repeated message proposals reuse the exact approval instead of creating multiple pending sends", async () => {
  const f = fakeLookupClient([]);
  const receipts = new Map<string, Promise<unknown>>();
  const input = { channel: "telegram", to: "42", text: "Demo notice" };
  const source = { channel: "whatsapp" as const, externalId: "971500000000" };
  const first = await runTool(f.client, "ORG", "send_message", input, "OWNER", source, receipts);
  assertEquals(await runTool(f.client, "ORG", "send_message", input, "OWNER", source, receipts), first);
  assertEquals(f.inserts.filter(([table]) => table === "agent_pending_actions").length, 1);
});

Deno.test("an uncertain approval insert preserves its unsafe receipt instead of parking a second send", async () => {
  let saved = 0;
  const client = { from: () => ({ insert: () => { saved++; return Promise.reject(new Error("approval response lost after commit")); } }) };
  const receipts = new Map<string, Promise<unknown>>();
  const input = { channel: "telegram", to: "42", text: "Demo notice" };
  const first = await runTool(client, "ORG", "send_message", input, "OWNER", undefined, receipts) as { code?: string; retry_safe?: boolean };
  assertEquals(first.code, "unconfirmed_write");
  assertEquals(first.retry_safe, false);
  assertEquals(await runTool(client, "ORG", "send_message", input, "OWNER", undefined, receipts), first);
  assertEquals(saved, 1);
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
    by_currency: Record<string, unknown>[];
  };
  void docs;
  // The shared fake returns [] for the items fetch → zero nets, but the
  // shape and org scoping are what we're pinning here.
  assertEquals(out.by_currency, [{ currency: "AED", output_net: 0, output_tax: 0, input_net: 0, input_tax: 0, net_vat: 0 }]);
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

// ---- confirmation gate ----

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

Deno.test("status-only mark-paid is not exposed as a hosted agent tool", async () => {
  const f = fakeProposalClient({ id: 77, number: "INV-77", status: "sent" });
  const out = (await runTool(f.client, "ORG-9", "propose_mark_invoice_paid", {
    invoice_number: "INV-77",
  }, "OWNER")) as { error?: string };
  assertEquals(typeof out.error, "string");
  assertEquals(f.inserts.length, 0);
});

Deno.test("payment reminder proposal binds trusted source without accepting model-supplied approval metadata", async () => {
  const f = fakeProposalClient({ id: 77, number: "INV-77", status: "sent", customer_email: "customer@example.invalid" });
  const injected = (await runTool(f.client, "ORG-9", "request_payment_reminder", {
    invoice_number: "INV-77", approval_channel: "whatsapp", approval_chat_id: "ATTACKER",
  }, "OWNER", { channel: "telegram", externalId: "42" })) as { error?: string };
  assertEquals(typeof injected.error, "string");
  assertEquals(f.inserts.length, 0);
  const out = (await runTool(f.client, "ORG-9", "request_payment_reminder", {
    invoice_number: "INV-77",
  }, "OWNER", { channel: "telegram", externalId: "42" })) as { proposed?: string; approval_code?: string };
  assertEquals(out.proposed, "send_payment_reminder");
  assertEquals(/^\d{4}$/.test(out.approval_code ?? ""), true);
  const parked = f.inserts[0][1];
  assertEquals(parked.org_id, "ORG-9");
  const payload = parked.payload as Record<string, unknown>;
  assertEquals(payload.approval_channel, "telegram");
  assertEquals(payload.approval_chat_id, "42");
  assertEquals(typeof parked.expires_at, "string");
});

Deno.test("proposal codes come from the CSPRNG and retry on live-code collision", async () => {
  const f = fakeProposalClient({ id: 78, number: "INV-78", status: "sent", customer_email: "customer@example.invalid" }, 2);
  const out = (await runTool(f.client, "ORG", "request_payment_reminder", {
    invoice_number: "INV-78",
  }, "OWNER")) as { approval_code?: string };
  assertEquals(typeof out.approval_code, "string");
  assertEquals(f.attempts, 3, "two 23505 collisions then success");
  assertEquals(new Set(f.codes).size, f.codes.length, "a colliding code must never be reused");
});

Deno.test("payment reminder validates status before parking anything", async () => {
  for (const status of ["paid", "draft"]) {
    const f = fakeProposalClient({ id: 79, number: "INV-79", status });
    const out = (await runTool(f.client, "ORG", "request_payment_reminder", {
      invoice_number: "INV-79",
    }, "OWNER")) as { error?: string };
    assertEquals(typeof out.error, "string", `${status} must be refused`);
    assertEquals(f.inserts.length, 0, `nothing parked for a ${status} invoice`);
  }

  const missing = fakeProposalClient(null);
  const nf = (await runTool(missing.client, "ORG", "request_payment_reminder", {
    invoice_number: "NOPE",
  }, "OWNER")) as { error?: string };
  assertEquals(typeof nf.error, "string");
});

Deno.test("hosted tool inputs reject oversized lines, wrong types and injected fields before any write", async () => {
  for (const input of [
    { customer_name: "Demo", items: Array.from({ length: 31 }, () => ({ description: "Item", unit_price: 10 })) },
    { customer_name: "Demo", items: [{ description: "Item", qty: "2", unit_price: 10 }] },
    { customer_name: "Demo", items: [{ description: "Item", qty: -1, unit_price: 10 }] },
    { customer_name: "Demo", status: "paid", items: [{ description: "Item", unit_price: 10 }] },
  ]) {
    const f = fakeWriteClient();
    const result = await runTool(f.client, "ORG", "create_draft_invoice", input, "OWNER") as { error?: string };
    assertEquals(typeof result.error, "string");
    assertEquals(f.rpcRequests.length, 0);
    assertEquals(f.inserts.length, 0);
  }
});

Deno.test("pending message proposals record their exact source conversation", async () => {
  const f = fakeProposalClient(null);
  await runTool(f.client, "ORG", "send_message", { channel: "telegram", to: "12", text: "Demo" }, "OWNER", { channel: "whatsapp", externalId: "971500000000" });
  const payload = f.inserts[0][1].payload as Record<string, unknown>;
  assertEquals(payload.approval_channel, "whatsapp");
  assertEquals(payload.approval_chat_id, "971500000000");
});

Deno.test("an unconfirmed atomic draft RPC never promises that nothing was saved or invites a retry", async () => {
  const f = fakeWriteClient();
  f.client.rpc = () => Promise.resolve({ data: null, error: { code: "PGRST202" } });
  const result = await runTool(f.client, "ORG", "create_draft_quote", WRITE_INPUTS.create_draft_quote, "OWNER") as { error?: string; code?: string; retry_safe?: boolean };
  assertEquals(result.code, "unconfirmed_write");
  assertEquals(result.retry_safe, false);
  assertEquals(result.error?.includes("Check Filey before retrying"), true);
  assertEquals(result.error?.includes("No partial draft was saved"), false);
  assertEquals(f.inserts.length, 0);
});

Deno.test("a lost draft response stays unconfirmed after the database may have committed", async () => {
  for (const name of ["create_draft_invoice", "create_draft_quote", "create_draft_po"]) {
    const f = fakeWriteClient();
    let committed = 0;
    f.client.rpc = () => {
      committed++;
      return Promise.reject(new Error("synthetic response lost after commit"));
    };
    const result = await runTool(f.client, "ORG", name, WRITE_INPUTS[name], "OWNER") as { error?: string; code?: string; retry_safe?: boolean; created?: string };
    assertEquals(committed, 1, "the transport must not retry an ambiguous write");
    assertEquals(result.created, undefined);
    assertEquals(result.code, "unconfirmed_write");
    assertEquals(result.retry_safe, false);
    assertEquals(result.error?.includes("may already have been saved"), true);
  }
});

Deno.test("a malformed draft receipt cannot become success or a safe retry", async () => {
  const client = { rpc: () => Promise.resolve({ data: { created: "draft" }, error: null }) };
  const result = await runTool(client, "ORG", "create_draft_invoice", WRITE_INPUTS.create_draft_invoice, "OWNER") as { error?: string; code?: string; retry_safe?: boolean; created?: string };
  assertEquals(result.created, undefined);
  assertEquals(result.code, "unconfirmed_write");
  assertEquals(result.retry_safe, false);
  assertEquals(typeof result.error, "string");
});

Deno.test("bounded model results stay valid JSON and identify previews", () => {
  const result = boundedToolResult({ rows: Array.from({ length: 1000 }, () => ({ name: 'Demo "company"' })) });
  assertEquals(JSON.parse(result).truncated, true);
  assertEquals(result.length < 6000, true);
  assertEquals(JSON.parse(boundedToolResult(undefined)).error, "No result was returned.");
});

Deno.test("report line failures cannot become invented zero totals", async () => {
  for (const [name, input] of [["run_report", { report: "sales_by_month" }], ["run_report", { report: "top_customers" }], ["get_vat_summary", {}]] as const) {
    const scope: string[] = [];
    const client = { from(table: string) {
      const b: Record<string, unknown> = {};
      for (const method of ["select", "neq", "gte", "lte", "in"]) b[method] = () => b;
      b.eq = (column: string, value: string) => { if (column === "org_id") scope.push(value); return b; };
      b.then = (resolve: (value: unknown) => void) => resolve(table === "invoice_docs"
        ? { data: [{ id: 1, issue_date: "2026-09-30", doc_type: "invoice" }], error: null }
        : { data: null, error: { message: "offline" } });
      return b;
    } };
    const result = await runTool(client, "ORG", name, input) as { error?: string };
    assertEquals(typeof result.error, "string");
    assertEquals(scope, ["ORG", "ORG"], "both header and child query must pin the workspace");
  }
});
