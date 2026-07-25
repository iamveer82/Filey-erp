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
      issue_date: "2025-01-15",
      due_date: "2025-02-15",
      tax_rate: 5,
    },
    // Created while offline: no org_id and no doc_type at all. A tenant filter
    // or an `eq(doc_type,…)` filter would both hide it — the regression guard.
    {
      id: 11,
      number: "INV-2025-A0002",
      status: "draft",
      customer_name: "Zenith Foods",
      issue_date: "2025-03-02",
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
      issue_date: "2025-02-01",
      tax_rate: 5,
    },
  ]);
  put("invoice_doc_items", [
    { id: 100, org_id: ORG, invoice_id: 10, description: "Widgets", qty: 10, unit_price: 25, position: 0 },
    { id: 101, org_id: ORG, invoice_id: 10, description: "Freight", qty: 1, unit_price: 50, position: 1 },
  ]);
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
  assert.equal(invoices.count, 2, "both sales invoices listed, the purchase bill excluded");
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

  noError(await call("get_financial_summary"), "get_financial_summary");
  noError(await call("run_report", { report: "receivables_aging" }), "run_report");

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
  assert.equal(stored.length, 4, "draft persisted into the collection");
  const draft = stored.find((r) => r.number === created.number);
  assert.ok(draft, "draft findable by its number");
  assert.equal(draft.status, "draft", "writes are draft-only");
  assert.equal(draft.org_id, ORG, "org stamped from the local profile");
  assert.equal(draft.user_id, USER, "user stamped from the local profile");
  assert.equal(draft.id, 13, "id continues the collection's numbering");

  const journal = JSON.parse(
    (() => {
      const db = new DatabaseSync(dbFile, { readOnly: true });
      const r = db.prepare("SELECT value FROM kv_cache WHERE key = 'syncjournal'").get() as any;
      db.close();
      return r?.value ?? "null";
    })()
  );
  assert.ok(journal?.tables?.invoice_docs?.changed?.includes(13), "row marked dirty for cloud sync");

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
