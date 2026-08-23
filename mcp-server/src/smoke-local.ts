/**
 * Offline self-check for LOCAL mode: build a throwaway filey-erp.db shaped like
 * the desktop app's (JSON collections in kv_cache), point the server at it, then
 * drive the real tool handlers against it. No network, no Supabase, and the
 * user's own database is never touched.
 *
 * Run: npm run build && npm run smoke:local
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "filey-mcp-"));
const dbFile = path.join(dir, "filey-erp.db");
const ORG = "org-1";
const USER = "user-1";

/** Seed dates must be relative to "now" so the reports' time windows (6 months,
 *  90 days, aging buckets) hit the same rows no matter when this runs. */
const daysAgo = (days: number): string =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

function seed(): void {
  const db = new DatabaseSync(dbFile);
  db.exec("CREATE TABLE kv_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT)");
  const put = (coll: string, rows: unknown) =>
    db
      .prepare("INSERT INTO kv_cache (key, value, updated_at) VALUES (?, ?, datetime('now'))")
      .run("localdb:" + coll, JSON.stringify(rows));

  put("profiles", [{ id: USER, org_id: ORG, email: "owner@example.com" }]);
  put("crm_customers", [
    { id: 1, org_id: ORG, name: "Acme Trading", company: "Acme LLC", email: "ap@acme.test" },
    { id: 2, org_id: ORG, name: "Zenith Foods", company: "Zenith FZE", email: "pay@zenith.test" },
  ]);
  put("invoice_docs", [
    // Real rows keep a printed title in doc_type, not the literal "invoice".
    {
      id: 10,
      org_id: ORG,
      doc_type: "Tax Invoice",
      number: "INV-2025-A0001",
      status: "sent",
      customer_name: "Acme Trading",
      customer_email: "ap@acme.test",
      issue_date: daysAgo(30),
      due_date: daysAgo(10),
      tax_rate: 5,
    },
    // Created while offline: no org_id and no doc_type at all. A tenant filter
    // or an `eq(doc_type,…)` filter would both hide it — the regression guard.
    {
      id: 11,
      number: "INV-2025-A0002",
      status: "draft",
      customer_name: "Zenith Foods",
      issue_date: daysAgo(20),
      tax_rate: 5,
    },
    // A purchase bill lives in the same collection and must NOT be listed.
    {
      id: 12,
      org_id: ORG,
      doc_type: "purchase",
      number: "BILL-2025-0007",
      status: "sent",
      customer_name: "Some Supplier",
      issue_date: daysAgo(40),
      tax_rate: 5,
    },
    // Sent long ago with a doc-level discount: net 200 − 50 = 150, +5% tax →
    // 157.50. Due 120 days back → the 90+ aging bucket.
    {
      id: 13,
      org_id: ORG,
      number: "INV-2025-A0003",
      status: "sent",
      customer_name: "Globex Ltd",
      customer_email: "ar@globex.test",
      issue_date: daysAgo(160),
      due_date: daysAgo(120),
      tax_rate: 5,
      discount: 50,
    },
  ]);
  put("invoice_doc_items", [
    { id: 100, org_id: ORG, invoice_id: 10, description: "Widgets", qty: 10, unit_price: 25, position: 0 },
    { id: 101, org_id: ORG, invoice_id: 10, description: "Freight", qty: 1, unit_price: 50, position: 1 },
    { id: 102, org_id: ORG, invoice_id: 13, description: "Consulting", qty: 2, unit_price: 100, position: 0 },
  ]);
  // Acme has a part payment on file: aging must count its BALANCE (315 − 15 =
  // 300), not the billed total — mirrors src/lib/aiTools.ts receivables_aging.
  put("invoice_payments", [{ id: 200, org_id: ORG, invoice_id: 10, amount: 15 }]);
  put("products", [
    { id: 1, org_id: ORG, name: "Bolt M8", sku: "B8", quantity: 3, reorder_level: 10, unit_price: 2 },
    { id: 2, org_id: ORG, name: "Nut M8", sku: "N8", quantity: 900, reorder_level: 10, unit_price: 1 },
  ]);
  db.close();
}

function readColl(coll: string): any[] {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  const row = db.prepare("SELECT value FROM kv_cache WHERE key = ?").get("localdb:" + coll) as
    | { value?: string }
    | undefined;
  db.close();
  return row?.value ? JSON.parse(row.value) : [];
}

async function main(): Promise<void> {
  seed();
  process.env.FILEY_LOCAL_DB = dbFile;
  delete process.env.SUPABASE_URL;

  // Imported after the env is set — getCtx() reads it on first tool call.
  const { allTools } = await import("./tools.js");
  const call = (name: string, args: any = {}) => {
    const tool = allTools.find((t) => t.name === name);
    assert.ok(tool, `tool ${name} is not registered`);
    return tool!.handler(args) as Promise<any>;
  };
  const noError = (r: any, what: string) => {
    assert.ok(!r?.error, `${what} returned an error: ${r?.error}`);
    return r;
  };

  // Reads — including the offline row that carries no org_id.
  const invoices = noError(await call("list_invoices"), "list_invoices");
  assert.equal(invoices.count, 3, "all three sales invoices listed, the purchase bill excluded");
  assert.ok(
    !invoices.invoices.some((i: any) => i.number === "BILL-2025-0007"),
    "purchase documents must not appear as invoices"
  );

  const drafts = noError(await call("list_invoices", { status: "draft" }), "list_invoices(draft)");
  assert.equal(drafts.count, 1, "status filter");
  assert.equal(drafts.invoices[0].number, "INV-2025-A0002");

  const one = noError(await call("get_invoice", { number: "INV-2025-A0001" }), "get_invoice");
  assert.equal(one.items.length, 2, "line items joined by invoice_id");
  assert.equal(one.net, 300, "10*25 + 1*50");
  assert.equal(one.total, 315, "net + 5% tax");

  const found = noError(await call("find_customer", { query: "acme" }), "find_customer");
  assert.equal(found.count, 1, "ilike is case-insensitive");
  assert.equal(found.customers[0].name, "Acme Trading");
  assert.deepEqual(
    Object.keys(found.customers[0]).sort(),
    ["company", "email", "id", "name", "phone", "segment"].sort(),
    "select() projects only the requested columns"
  );

  const low = noError(await call("list_low_stock"), "list_low_stock");
  assert.equal(low.count, 1, "only quantity <= reorder_level");
  assert.equal(low.products[0].sku, "B8");

  // run_report math must agree with the app's own reports: totals include
  // head tax_rate AND doc discount; aging counts outstanding balances only.
  const salesByMonth = noError(
    await call("run_report", { report: "sales_by_month" }),
    "run_report(sales_by_month)"
  );
  assert.equal(salesByMonth.months.length, 2, "two distinct issue months in the 6-month window");
  for (const m of salesByMonth.months) {
    if (m.total === 315) assert.equal(m.invoice_count, 1, "Acme month: net 300 + 5% tax");
    else if (m.total === 157.5) assert.equal(m.invoice_count, 1, "Globex month: (200 − 50) + 5%");
    else assert.fail(`unexpected month bucket ${m.month} total ${m.total}`);
  }

  const topCustomers = noError(
    await call("run_report", { report: "top_customers" }),
    "run_report(top_customers)"
  );
  assert.equal(topCustomers.customers.length, 1, "Globex issued >90 days ago drops out");
  assert.equal(topCustomers.customers[0].customer_name, "Acme Trading");
  assert.equal(topCustomers.customers[0].total, 315, "tax-inclusive, matching list_invoices");

  const aging = noError(
    await call("run_report", { report: "receivables_aging" }),
    "run_report(receivables_aging)"
  );
  // Acme's balance (300, paid 15 of 315) is 10 days late → 1-30. Globex is
  // unpaid 157.50, 120 days late → 90+. Drafts and the purchase bill drop out.
  assert.equal(aging.buckets["1-30"].total, 300, "aging counts balance, not billed total");
  assert.deepEqual(aging.buckets["1-30"].invoices, ["INV-2025-A0001"]);
  assert.equal(aging.buckets["90+"].total, 157.5, "discount-aware total lands in 90+");
  assert.deepEqual(aging.buckets["90+"].invoices, ["INV-2025-A0003"]);
  assert.equal(aging.buckets.current.total, 0);

  noError(await call("get_financial_summary"), "get_financial_summary");

  // Confirm-gated flow — the pending action row must carry expires_at (the new
  // schema's partial unique index lives on live pending codes).
  const reminder = noError(
    await call("request_payment_reminder", { invoice_number: "INV-2025-A0001" }),
    "request_payment_reminder"
  );
  assert.match(reminder.approval_code, /^\d{4}$/, "4-digit approval code");
  const actions = readColl("agent_pending_actions");
  const pending = actions.find((a: any) => a.code === reminder.approval_code);
  assert.ok(pending, "pending action stored with the returned code");
  assert.equal(pending.status, "pending");
  const expectedExpiry = new Date(Date.now() + 24 * 86_400_000).getTime();
  const actualExpiry = new Date(pending.expires_at).getTime();
  assert.ok(
    Math.abs(expectedExpiry - actualExpiry) < 60_000,
    "expires_at is created_at + ~24h"
  );

  // Write — lands in the app's own store, stamped and journalled for sync.
  const created = noError(
    await call("create_draft_invoice", {
      customer_name: "Acme Trading",
      items: [{ description: "Service", qty: 2, unit_price: 100 }],
    }),
    "create_draft_invoice"
  );
  assert.equal(created.total, 210, "200 + 5% default tax");

  const stored = readColl("invoice_docs");
  assert.equal(stored.length, 5, "draft persisted into the collection");
  const draft = stored.find((r) => r.number === created.number);
  assert.ok(draft, "draft findable by its number");
  assert.equal(draft.status, "draft", "writes are draft-only");
  assert.equal(draft.org_id, ORG, "org stamped from the local profile");
  assert.equal(draft.user_id, USER, "user stamped from the local profile");
  assert.equal(draft.id, 14, "id continues the collection's numbering");

  const journal = JSON.parse(
    (() => {
      const db = new DatabaseSync(dbFile, { readOnly: true });
      const r = db.prepare("SELECT value FROM kv_cache WHERE key = 'syncjournal'").get() as any;
      db.close();
      return r?.value ?? "null";
    })()
  );
  assert.ok(journal?.tables?.invoice_docs?.changed?.includes(14), "row marked dirty for cloud sync");

  console.log("LOCAL SMOKE OK — all checks passed against a throwaway database.");
}

/** Best-effort: the server keeps its SQLite handle open for the process
 *  lifetime, and Windows refuses to unlink an open file. It's a temp dir. */
function cleanup(): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* the OS reclaims it */
  }
}

main()
  .then(() => {
    cleanup();
    process.exit(0);
  })
  .catch((err) => {
    console.error(`LOCAL SMOKE FAIL: ${err?.message ?? err}`);
    cleanup();
    process.exit(1);
  });
