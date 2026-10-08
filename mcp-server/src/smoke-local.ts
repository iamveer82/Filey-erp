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
import { Worker } from "node:worker_threads";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createLocalClient, readLocalIdentity } from "./localdb.js";
import { z } from "zod";
import { loadDraftPresets } from "./draftPresets.js";
import type { Ctx } from "./client.js";

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
  put("invoice_payments", [{ id: 200, org_id: ORG, invoice_id: 10, amount: 15 },
    { id: 201, org_id: "other-org", invoice_id: 10, amount: 9999 }]);
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
    return tool!.handler(z.object(tool!.inputSchema).parse(args)) as Promise<any>;
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

  const financial = noError(await call("get_financial_summary"), "get_financial_summary");
  assert.equal(financial.outstanding_receivables, 457.5, "summary subtracts payments in the current workspace");
  assert.equal(financial.overdue_receivables, 457.5, "overdue summary agrees with aging");

  // Stdio has no paired actor. Do not create unusable, unbound approval codes.
  const reminder = noError(
    await call("request_payment_reminder", { invoice_number: "INV-2025-A0001" }),
    "request_payment_reminder"
  );
  assert.equal(reminder.status, "requires_channel_proposal");
  assert.equal(reminder.approval_code, undefined);
  assert.deepEqual(readColl("agent_pending_actions"), []);

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

  noError(await call("create_draft_quote", { customer_name: "Acme", items: [{ description: "Quote line", unit_price: 7 }] }), "quote");
  const quoteLine = readColl("quotation_items")[0];
  assert.equal(quoteLine.product, "Quote line", "quotation schema uses product");
  assert.equal(quoteLine.rate, 7, "quotation schema uses rate");
  assert.equal(quoteLine.unit_price, undefined);
  noError(await call("create_draft_po", { supplier_name: "Supplier", items: [{ description: "PO line", unit_cost: 9 }] }), "purchase order");
  assert.equal(readColl("purchase_order_items")[0].unit_cost, 9);

  const writer = new DatabaseSync(dbFile);
  const setRaw = (key: string, raw: string) => writer.prepare("INSERT INTO kv_cache (key,value,updated_at) VALUES (?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, raw);
  const raw = (key: string): string | undefined => (writer.prepare("SELECT value FROM kv_cache WHERE key=?").get(key) as any)?.value;
  const local = createLocalClient(dbFile, { userId: USER, orgId: ORG });
  setRaw("localdb:scope_check", JSON.stringify([{ id: 1, org_id: ORG }, { id: 2, org_id: "other-org" }, { id: 3 }]));
  assert.deepEqual((await local.from("scope_check").select("id").eq("org_id", ORG)).data.map((r: any) => r.id), [1, 3]);
  assert.ok((await local.from("scope_check").select().maybeSingle()).error, "ambiguous single-row lookups fail");
  // Visibility is an implicit boundary, not an optional caller query filter.
  // Cached role strings never grant authority to another user's private rows.
  setRaw("localdb:privacy_check", JSON.stringify([
    { id: 1, org_id: ORG, user_id: USER, private_text: "own document" },
    { id: 2, org_id: ORG, user_id: "other-user", private_text: "foreign private document" },
    { id: 3, org_id: ORG, user_id: "other-user", shared: true },
    { id: 4, org_id: ORG, user_id: "other-user", shared_with: [USER] },
    { id: 5, org_id: "other-org", user_id: USER, shared: true, shared_with: [USER] },
    { id: 6 }, // genuinely untagged historical local record
    { id: 7, org_id: ORG }, // historical workspace record without an author
    { id: 8, user_id: "other-user", shared: true }, // no proof of shared org
    { id: 9, user_id: USER },
    { id: 10, org_id: ORG, user_id: "other-user", shared_with: ["someone-else"] },
  ]));
  assert.deepEqual((await local.from("privacy_check").select("id")).data.map((r: any) => r.id), [1, 3, 4, 6, 7, 9]);
  assert.equal((await local.from("privacy_check").select().eq("id", 2).maybeSingle()).data, null, "an exact private-row ID is not an access grant");
  assert.deepEqual((await local.from("privacy_check").select("id").or("id.eq.2,id.eq.5")).data, [], "or/projection cannot bypass identity visibility");
  const unsigned = createLocalClient(dbFile);
  assert.deepEqual((await unsigned.from("privacy_check").select("id")).data.map((r: any) => r.id), [6], "no selected profile sees only genuinely untagged rows");
  unsigned.close();
  const privateHeadsBefore = raw("localdb:invoice_docs")!;
  const privateItemsBefore = raw("localdb:invoice_doc_items")!;
  try {
    setRaw("localdb:invoice_docs", JSON.stringify([...JSON.parse(privateHeadsBefore),
      { id: 950, org_id: ORG, user_id: "other-user", number: "PRIVATE-BOUNDARY", customer_name: "synthetic-private-customer", tax_rate: 5 },
      { id: 951, org_id: ORG, user_id: "other-user", number: "SHARED-BOUNDARY", shared_with: [USER], tax_rate: 5 }]));
    setRaw("localdb:invoice_doc_items", JSON.stringify([...JSON.parse(privateItemsBefore),
      { id: 9500, org_id: ORG, user_id: USER, shared: true, invoice_id: 950, description: "synthetic-private-line", qty: 1, unit_price: 999 },
      { id: 9510, org_id: ORG, user_id: "other-user", invoice_id: 951, description: "synthetic-shared-line", qty: 2, unit_price: 10 },
      { id: 9511, org_id: "other-org", user_id: USER, invoice_id: 951, description: "foreign-org-line", qty: 1, unit_price: 999 }]));
    const deniedInvoice = await call("get_invoice", { number: "PRIVATE-BOUNDARY" });
    assert.ok(deniedInvoice.error?.includes("not found"), "actual MCP tools cannot fetch another author's private invoice");
    assert.ok(!JSON.stringify(deniedInvoice).includes("synthetic-private-customer"));
    assert.deepEqual((await local.from("invoice_doc_items").select().eq("invoice_id", 950)).data, [], "owned/shared children do not grant a private parent");
    const sharedInvoice = noError(await call("get_invoice", { number: "SHARED-BOUNDARY" }), "targeted shared invoice");
    assert.equal(sharedInvoice.items.length, 1, "shared parent lines inherit visibility without leaking foreign-org children");
    assert.equal(sharedInvoice.items[0].description, "synthetic-shared-line");
    assert.equal(sharedInvoice.total, 21, "targeted invoice shares preserve correct totals");
  } finally {
    setRaw("localdb:invoice_docs", privateHeadsBefore);
    setRaw("localdb:invoice_doc_items", privateItemsBefore);
  }
  const owned = await local.from("owned_check").insert({ org_id: "forged-org", user_id: "forged-user" }).select().single();
  assert.equal(owned.data.org_id, ORG);
  assert.equal(owned.data.user_id, USER);

  for (const damaged of ["{bad", "{}", "[null]", ""]) {
    setRaw("localdb:damaged", damaged);
    assert.ok((await local.from("damaged").select()).error);
    assert.ok((await local.from("damaged").insert({ name: "must not overwrite" })).error);
    assert.equal(raw("localdb:damaged"), damaged);
  }
  const journalBefore = raw("syncjournal")!;
  for (const damaged of ["{bad", '{"v":1,"tables":{"products":{"changed":null,"deleted":[]}}}']) {
    setRaw("syncjournal", damaged);
    assert.ok((await local.from("journal_check").insert({ name: "must roll back" })).error);
    assert.equal(raw("localdb:journal_check"), undefined);
    assert.equal(raw("syncjournal"), damaged);
  }
  setRaw("syncjournal", journalBefore);
  const headsBefore = raw("localdb:invoice_docs");
  const itemsBefore = raw("localdb:invoice_doc_items");
  setRaw("localdb:invoice_doc_items", "{damaged");
  const failed = await call("create_draft_invoice", { customer_name: "Rollback", items: [{ description: "invalid storage", unit_price: 1 }] });
  assert.ok(failed.error, "failed lines reject the document");
  assert.equal(raw("localdb:invoice_docs"), headsBefore, "header is rolled back with rejected lines");
  assert.equal(raw("syncjournal"), journalBefore, "journal is rolled back with rejected lines");
  setRaw("localdb:invoice_doc_items", itemsBefore!);

  // Explicit per-line VAT receives the document discount, and mixed-rate penny
  // allocations agree with the shared frontend calculation.
  const calculationHead = { id: 90, org_id: ORG, number: "CALC", tax_rate: 5, discount: 50 };
  setRaw("localdb:invoice_docs", JSON.stringify([...readColl("invoice_docs"), calculationHead]));
  setRaw("localdb:invoice_doc_items", JSON.stringify([...readColl("invoice_doc_items"),
    { id: 900, org_id: ORG, invoice_id: 90, qty: 1, unit_price: 100, custom: { __tax_pct: "10" } }]));
  const calculation = noError(await call("get_invoice", { number: "CALC" }), "discounted line VAT");
  assert.equal(calculation.net, 50);
  assert.equal(calculation.tax, 5);
  assert.equal(calculation.total, 55);
  // Cancelled documents never become sales; credit notes reduce sales rather
  // than increase them. Different currencies never share an aggregate.
  setRaw("localdb:invoice_docs", JSON.stringify([...readColl("invoice_docs"),
    { id: 91, org_id: ORG, number: "CREDIT", customer_name: "Acme Trading", status: "sent", doc_type: "invoice", invoice_type_code: "381", currency: "AED", issue_date: daysAgo(0), tax_rate: 5 },
    { id: 92, org_id: ORG, number: "CANCELLED", customer_name: "Acme Trading", status: "cancelled", doc_type: "invoice", currency: "AED", issue_date: daysAgo(0), tax_rate: 5 },
    { id: 93, org_id: ORG, number: "USD-OVERDUE", customer_name: "US Customer", status: "overdue", doc_type: "invoice", currency: "USD", issue_date: daysAgo(0), due_date: daysAgo(10), tax_rate: 5 }]));
  setRaw("localdb:invoice_doc_items", JSON.stringify([...readColl("invoice_doc_items"),
    { id: 901, org_id: ORG, invoice_id: 91, qty: 1, unit_price: 100 },
    { id: 902, org_id: ORG, invoice_id: 92, qty: 1, unit_price: 9999 },
    { id: 903, org_id: ORG, invoice_id: 93, qty: 1, unit_price: 20 }]));
  const mixedSales = noError(await call("run_report", { report: "sales_by_month" }), "posted sales by currency");
  assert.equal(mixedSales.months, undefined, "mixed currencies have no misleading flat sales total");
  assert.equal(mixedSales.by_currency.find((entry: any) => entry.currency === "AED").months.reduce((sum: number, month: any) => sum + month.total, 0), 367.5);
  assert.equal(mixedSales.by_currency.find((entry: any) => entry.currency === "USD").months[0].total, 21);
  const mixedCustomers = noError(await call("run_report", { report: "top_customers" }), "posted customers by currency");
  assert.equal(mixedCustomers.customers, undefined);
  assert.equal(mixedCustomers.by_currency.find((entry: any) => entry.currency === "AED").customers[0].total, 210);
  const mixedSummary = noError(await call("get_financial_summary"), "receivables by currency");
  assert.equal(mixedSummary.outstanding_receivables, undefined);
  assert.equal(mixedSummary.receivables_by_currency.find((entry: any) => entry.currency === "AED").outstanding, 457.5);
  assert.equal(mixedSummary.receivables_by_currency.find((entry: any) => entry.currency === "USD").outstanding, 21);
  const mixedAging = noError(await call("run_report", { report: "receivables_aging" }), "aging by currency");
  assert.equal(mixedAging.buckets, undefined);
  assert.equal(mixedAging.by_currency.find((entry: any) => entry.currency === "AED").buckets["1-30"].total, 300);
  assert.equal(mixedAging.by_currency.find((entry: any) => entry.currency === "USD").buckets["1-30"].total, 21);
  setRaw("localdb:profiles", JSON.stringify([{ id: USER, org_id: ORG }, { id: "user-2", org_id: "other-org" }]));
  assert.throws(() => readLocalIdentity(dbFile), /FILEY_LOCAL_USER_ID/);
  process.env.FILEY_LOCAL_USER_ID = "user-2";
  assert.deepEqual(readLocalIdentity(dbFile), { userId: "user-2", orgId: "other-org" });
  delete process.env.FILEY_LOCAL_USER_ID;

  // Separate SQLite connections race from separate threads; every insert and
  // every journal entry must survive, with unique IDs.
  const workerCode = `const { parentPort, workerData } = require('node:worker_threads');
    import(workerData.module).then(({ createLocalClient }) => {
      const client = createLocalClient(workerData.file);
      parentPort.once('message', async () => {
        for (let index=0; index<50; index++) {
          const result = await client.from('concurrent').insert({ worker: workerData.worker, index });
          if (result.error) throw Error(result.error.message);
        }
        client.close(); parentPort.postMessage('done');
      });
      parentPort.postMessage('ready');
    });`;
  const workers = [1, 2].map(worker => new Worker(workerCode, { eval: true,
    workerData: { file: dbFile, module: new URL('./localdb.js', import.meta.url).href, worker } }));
  const ready = workers.map(worker => new Promise<void>((resolve, reject) => {
    worker.once('error', reject); worker.once('message', () => resolve());
  }));
  await Promise.all(ready);
  const done = workers.map(worker => new Promise<void>((resolve, reject) => {
    worker.once('error', reject); worker.once('message', () => resolve());
  }));
  workers.forEach(worker => worker.postMessage('start'));
  await Promise.all(done);
  await Promise.all(workers.map(worker => worker.terminate()));
  const concurrent = readColl("concurrent");
  assert.equal(concurrent.length, 100);
  assert.equal(new Set(concurrent.map(row => row.id)).size, 100);
  assert.equal(JSON.parse(raw("syncjournal")!).tables.concurrent.changed.length, 100);

  // A real second OS process writes through the shipped MCP SQLite client.
  // This process exercises the desktop's BEGIN IMMEDIATE compare/write contract;
  // native Rust and frontend tests separately verify the actual IPC primitive.
  const runProcess = promisify(execFile);
  const peerInsert = async (collection: string, payload: Record<string, unknown>) => {
    const source = `import {createLocalClient} from ${JSON.stringify(new URL("./localdb.js", import.meta.url).href)};
      const client=createLocalClient(process.argv[1]);
      const result=await client.from(process.argv[2]).insert(JSON.parse(process.argv[3])).select().single();
      client.close(); if(result.error)throw Error(result.error.message); console.log(JSON.stringify(result.data));`;
    const result = await runProcess(process.execPath, ["--input-type=module", "-e", source, dbFile, collection, JSON.stringify(payload)], { timeout: 15000 });
    return JSON.parse(result.stdout.trim());
  };
  const readValue = (key: string): string | null => raw(key) ?? null;
  const compareWrite = (expected: Map<string, string | null>, writes: Map<string, string | null>): boolean => {
    writer.exec("BEGIN IMMEDIATE");
    try {
      for (const [key, value] of expected) if (readValue(key) !== value) { writer.exec("ROLLBACK"); return false; }
      for (const [key, value] of writes) {
        assert.ok(expected.has(key), "every desktop write is bound to its original read");
        if (value === null) writer.prepare("DELETE FROM kv_cache WHERE key=?").run(key);
        else setRaw(key, value);
      }
      writer.exec("COMMIT"); return true;
    } catch (error) { writer.exec("ROLLBACK"); throw error; }
  };
  const staleDesktop = new Map([["localdb:products", readValue("localdb:products")], ["syncjournal", readValue("syncjournal")], ["localdb:orphan", null]]);
  const external = await peerInsert("products", { id: 2 ** 52 + 100, name: "Independent MCP process", quantity: 20, sync_revision: 7 });
  assert.equal(compareWrite(staleDesktop, new Map([["localdb:products", "[]"], ["syncjournal", '{"v":0,"tables":{}}'], ["localdb:orphan", "stale header"]])), false);
  assert.equal(raw("localdb:orphan"), undefined, "failed stale batch cannot leave another collection behind");
  assert.ok(readColl("products").some(row => row.id === external.id), "MCP record survives stale desktop collection replacement");
  const refreshed = new Map([["localdb:products", readValue("localdb:products")], ["syncjournal", readValue("syncjournal")]]);
  const desktopId = external.id + 1;
  const freshJournal = JSON.parse(refreshed.get("syncjournal")!);
  freshJournal.v++; freshJournal.tables.products.changed.push(desktopId);
  assert.equal(compareWrite(refreshed, new Map([
    ["localdb:products", JSON.stringify([...readColl("products"), { id: desktopId, name: "Desktop refreshed", quantity: 1 }])],
    ["syncjournal", JSON.stringify(freshJournal)],
  ])), true);
  const deletionSnapshot = new Map([["localdb:products", readValue("localdb:products")], ["syncjournal", readValue("syncjournal")]]);
  const afterRefresh = await peerInsert("products", { name: "MCP after desktop" });
  assert.ok(Number.isSafeInteger(afterRefresh.id) && afterRefresh.id !== desktopId);
  assert.equal(compareWrite(deletionSnapshot, new Map([["localdb:products", "[]"], ["syncjournal", JSON.stringify(freshJournal)]])), false);
  const beforeDelete = new Map([["localdb:products", readValue("localdb:products")], ["syncjournal", readValue("syncjournal")]]);
  const deletedJournal = JSON.parse(beforeDelete.get("syncjournal")!);
  deletedJournal.v++; deletedJournal.tables.products.deleted.push(external.id);
  deletedJournal.tables.products.deletedRevisions = { [String(external.id)]: 7 };
  assert.equal(compareWrite(beforeDelete, new Map([
    ["localdb:products", JSON.stringify(readColl("products").filter(row => row.id !== external.id))],
    ["syncjournal", JSON.stringify(deletedJournal)],
  ])), true);
  const finalPeer = await peerInsert("products", { name: "MCP preserves tombstone" });
  const finalProducts = readColl("products");
  assert.equal(new Set(finalProducts.map(row => row.id)).size, finalProducts.length, "independent writers preserve unique IDs");
  assert.ok(!finalProducts.some(row => row.id === external.id), "later MCP writes cannot resurrect desktop deletion");
  const finalEntry = JSON.parse(raw("syncjournal")!).tables.products;
  assert.ok(finalEntry.changed.includes(desktopId) && finalEntry.changed.includes(finalPeer.id));
  assert.ok(finalEntry.deleted.includes(external.id));
  assert.equal(finalEntry.deletedRevisions[String(external.id)], 7);

  // Desktop and MCP share the same private reservation collection, even before
  // either has saved its draft. Reservations never enter the sync journal.
  const reserveArgs = { p_kind: "invoice", p_pattern: "INV-{YYYY}-A{0001}", p_year: new Date().getFullYear(),
    p_actor: USER, p_org: ORG, p_request: crypto.randomUUID() };
  const ledger = readColl("document_number_reservations");
  ledger.push({ id: "desktop-held", scope: `${ORG}:user:${USER}`, namespace: "invoice", request_id: crypto.randomUUID(),
    pattern: reserveArgs.p_pattern, year: reserveArgs.p_year, number: `INV-${reserveArgs.p_year}-A0042` });
  setRaw("localdb:document_number_reservations", JSON.stringify(ledger));
  const journalAtReservation = raw("syncjournal");
  const reserved = await local.rpc("filey_reserve_document_number", reserveArgs);
  assert.equal(reserved.error, null); assert.equal(reserved.data, `INV-${reserveArgs.p_year}-A0043`);
  assert.deepEqual(await local.rpc("filey_reserve_document_number", reserveArgs), reserved, "request replay returns the identical number");
  assert.ok((await local.rpc("filey_reserve_document_number", { ...reserveArgs, p_year: reserveArgs.p_year + 1 })).error);
  assert.ok((await local.rpc("filey_reserve_document_number", { ...reserveArgs, p_actor: "other-account" })).error);
  assert.equal(raw("syncjournal"), journalAtReservation, "private number reservations do not make cloud tables dirty");
  const peerReserve = async (request: string) => {
    const source = `import {createLocalClient} from ${JSON.stringify(new URL("./localdb.js", import.meta.url).href)};
      const client=createLocalClient(process.argv[1],JSON.parse(process.argv[2]));
      const result=await client.rpc('filey_reserve_document_number',JSON.parse(process.argv[3]));
      client.close();if(result.error)throw Error(result.error.message);console.log(JSON.stringify(result.data));`;
    const result = await runProcess(process.execPath, ["--input-type=module", "-e", source, dbFile,
      JSON.stringify({ userId: USER, orgId: ORG }), JSON.stringify({ ...reserveArgs, p_request: request })], { timeout: 15000 });
    return JSON.parse(result.stdout.trim());
  };
  const beforePeers = new Map([["localdb:document_number_reservations", readValue("localdb:document_number_reservations")]]);
  const concurrentNumbers = await Promise.all(Array.from({ length: 4 }, () => peerReserve(crypto.randomUUID())));
  assert.equal(new Set(concurrentNumbers).size, 4, "four real MCP processes reserve unique unsaved draft numbers");
  assert.equal(compareWrite(beforePeers, beforePeers), false, "desktop cannot restore an old reservation ledger over new MCP reservations");
  assert.equal(raw("syncjournal"), journalAtReservation);
  const beforeDuplicate = raw("localdb:invoice_docs");
  assert.ok((await local.from("invoice_docs").insert({ number: " inv-2025-a0001 " })).error, "manual duplicate number is rejected case/whitespace insensitively");
  assert.equal(raw("localdb:invoice_docs"), beforeDuplicate);
  setRaw("localdb:id_exhaustion", JSON.stringify([{ id: Number.MAX_SAFE_INTEGER }]));
  assert.ok((await local.from("id_exhaustion").insert({ name: "not allocated" })).error);
  assert.equal(readColl("id_exhaustion").length, 1, "unsafe numeric IDs never reach records or journal");
  assert.equal(raw("syncjournal"), journalAtReservation);
  const completeLedger = raw("localdb:document_number_reservations")!;
  const exhaustedLedger = [...JSON.parse(completeLedger), { id: "exhausted", org_id: ORG, user_id: USER, namespace: "invoice",
    request_id: crypto.randomUUID(), pattern: reserveArgs.p_pattern, year: reserveArgs.p_year,
    number: `INV-${reserveArgs.p_year}-A${Number.MAX_SAFE_INTEGER}` }];
  setRaw("localdb:document_number_reservations", JSON.stringify(exhaustedLedger));
  assert.ok((await local.rpc("filey_reserve_document_number", { ...reserveArgs, p_request: crypto.randomUUID() })).error,
    "a 16-digit exhausted counter must fail rather than be ignored and restart at one");
  assert.equal(raw("localdb:document_number_reservations"), JSON.stringify(exhaustedLedger));
  setRaw("localdb:document_number_reservations", completeLedger);

  // Draft preset parity: real registered tools and schema parsing, exclusively
  // against this throwaway DB. Existing docs keep their independent snapshots.
  const company = {
    id: 1, user_id: USER, org_id: ORG, name: "Synthetic Seller", currency: "USD", default_tax_rate: 0,
    country_code: "AE", address: "Seller address", city: "Dubai", country_subdivision: "DU",
    trn: "", vat_number: "100000000000001", email: "seller@example.test", phone: "+971500000001",
    einvoice: { tin: "1000000001", endpoint_id: "SELLER-ID", endpoint_scheme: "0235", legal_id: "NESTED-TL", legal_id_type: "TL", uuid: "must-not-reuse", secret: "must-not-copy" },
    unit_price_formula: { a: "litres", b: "unit_price" },
  };
  setRaw("localdb:company_profile", JSON.stringify([company, { ...company, id: 2, org_id: "other-org", name: "Wrong Seller" }]));
  setRaw("localdb:app_settings", JSON.stringify([
    { id: 1, user_id: USER, org_id: ORG, key: "invoice_number_format", value: "INV-DLS-{003}-{YY}" },
    { id: 2, user_id: USER, org_id: ORG, key: "quote_number_format", value: "QU-{YYYY}-{001}" },
    { id: 3, user_id: USER, org_id: ORG, key: "purchase_order_number_format", value: "BUY-{001}-{YY}" },
    { id: 4, user_id: "another-user", org_id: ORG, shared: true, key: "invoice_number_format", value: "WRONG-{001}" },
    { id: 5, user_id: USER, org_id: "other-org", key: "invoice_number_format", value: "WRONG-ORG-{001}" },
    { id: 6, key: "invoice_number_format", value: "LEGACY-{001}" },
  ]));
  const year = new Date().toISOString().slice(0, 4);
  setRaw("localdb:invoice_docs", JSON.stringify([...readColl("invoice_docs"), { id: 8000, user_id: USER, org_id: ORG, number: `INV-DLS-028-${year.slice(2)}`, status: "draft" }]));
  const customer = { id: 1, user_id: USER, org_id: ORG, name: "Acme Trading", company: "Acme LLC", email: "ap@acme.test",
    address: "Buyer address", trn: "100000000000002", city: "Abu Dhabi", country_code: "AE", country_subdivision: "AZ",
    phone_e164: "+971500000002", custom_fields: { private_note: "not-an-identity-field", einvoice_identity: JSON.stringify({ legal_id: "BUY-TL", tin: "1000000002", endpoint_id: "BUYER-ID", secret: "do-not-copy" }) } };
  setRaw("localdb:crm_customers", JSON.stringify([customer,
    { ...customer, id: 2, org_id: "other-org", trn: "WRONG" },
    { ...customer, id: 3, user_id: "private-other-user", trn: "WRONG" },
  ]));
  const presetInvoice = noError(await call("create_draft_invoice", {
    customer_name: "aCmE LLC", items: [{ description: "Unchanged line", qty: 2, unit_price: 12.25 }], public_shared: true,
  }), "invoice presets");
  assert.equal(presetInvoice.number, `INV-DLS-029-${year.slice(2)}`, "saved format continues the existing sequence");
  assert.equal(presetInvoice.total, 24.5, "saved zero VAT survives schema parsing and invoice totals");
  const presetSaved = readColl("invoice_docs").find(row => row.number === presetInvoice.number);
  assert.equal(presetSaved.currency, "USD");
  assert.equal(presetSaved.tax_rate, 0);
  assert.equal(presetSaved.customer_name, "aCmE LLC", "preserve the requested printed customer name");
  assert.equal(presetSaved.customer_id, customer.id);
  assert.equal(presetSaved.customer_email, customer.email);
  assert.equal(presetSaved.customer_address, customer.address);
  assert.equal(presetSaved.customer_trn, customer.trn);
  assert.equal(presetSaved.buyer_country_subdivision, "AZ");
  assert.equal(presetSaved.seller_name, company.name);
  assert.equal(presetSaved.seller_trn, company.vat_number);
  assert.equal(presetSaved.seller_legal_id, "NESTED-TL");
  assert.equal(presetSaved.einvoice.seller.tin, "1000000001");
  assert.equal(presetSaved.einvoice.buyer.tin, "1000000002");
  assert.equal(presetSaved.einvoice.buyer.phone, customer.phone_e164);
  assert.equal(presetSaved.einvoice.seller.secret, undefined);
  assert.equal(presetSaved.einvoice.buyer.secret, undefined);
  assert.equal(presetSaved.unit_price_formula, undefined, "unsupported preset calculation fields are not inherited");
  assert.equal(presetSaved.public_shared, undefined);
  assert.match(presetSaved.einvoice.uuid, /^[0-9a-f-]{36}$/);
  const snapshot = JSON.stringify(presetSaved);
  setRaw("localdb:company_profile", JSON.stringify([{ ...company, default_tax_rate: 5 }]));
  const override = noError(await call("create_draft_invoice", { customer_name: "Acme Trading", currency: "EUR", tax_rate: 0,
    customer_email: "manual@example.test", items: [{ description: "Zero price", qty: 3, unit_price: 0 }] }), "explicit overrides");
  const overrideSaved = readColl("invoice_docs").find(row => row.number === override.number);
  assert.equal(overrideSaved.currency, "EUR"); assert.equal(overrideSaved.tax_rate, 0); assert.equal(override.total, 0);
  assert.equal(overrideSaved.customer_email, "manual@example.test");
  assert.notEqual(overrideSaved.einvoice.uuid, presetSaved.einvoice.uuid, "each invoice has its own preparation UUID");
  assert.equal(JSON.stringify(readColl("invoice_docs").find(row => row.number === presetInvoice.number)), snapshot, "later preset changes preserve saved identity and UUID");
  const quotePreset = noError(await call("create_draft_quote", { customer_name: "Acme Trading", items: [{ description: "Quote", unit_price: 10 }] }), "quote presets");
  assert.equal(quotePreset.number, `QU-${year}-001`); assert.equal(quotePreset.total, 10.5);
  const quoteSaved = readColl("quotations").find(row => row.number === quotePreset.number);
  assert.equal(quoteSaved.customer_trn, customer.trn); assert.equal(quoteSaved.seller_name, company.name);
  setRaw("localdb:suppliers", JSON.stringify([{ id: 11, user_id: USER, org_id: ORG, name: "Supply Co", tax_id: "SUPPLIER-TRN", email: "supply@example.test", phone: "1234", address: "Supplier address" },
    { id: 12, org_id: "other-org", name: "Supply Co", tax_id: "WRONG" }]));
  const poPreset = noError(await call("create_draft_po", { supplier_name: "supply co", items: [{ description: "PO", qty: 2, unit_cost: 3.75 }] }), "PO presets");
  const poSaved = readColl("purchase_orders").find(row => row.po_number === poPreset.po_number);
  assert.equal(poPreset.po_number, `BUY-001-${year.slice(2)}`); assert.equal(poPreset.total, 7.88);
  assert.equal(poSaved.total, poPreset.total); assert.equal(poSaved.supplier_trn, "SUPPLIER-TRN"); assert.equal(poSaved.supplier_id, 11);
  setRaw("localdb:company_profile", JSON.stringify([{ ...company, tax_type: "None", default_tax_rate: 5 }]));
  const noTax = noError(await call("create_draft_invoice", { customer_name: "Manual party", items: [{ description: "No tax", unit_price: 10 }] }), "no-tax company");
  assert.equal(noTax.total, 10);
  const explicitTax = noError(await call("create_draft_invoice", { customer_name: "Manual party", tax_rate: 5, items: [{ description: "Explicit VAT", unit_price: 10 }] }), "explicit tax override");
  assert.equal(explicitTax.total, 10.5);

  setRaw("localdb:crm_customers", JSON.stringify([customer, { ...customer, id: 20, name: "ACME TRADING" }]));
  setRaw("localdb:suppliers", JSON.stringify([{ id: 11, org_id: ORG, name: "Supply Co" }, { id: 12, org_id: ORG, name: "SUPPLY CO" }]));
  const beforeAmbiguous = raw("localdb:document_number_reservations");
  for (const tool of ["create_draft_invoice", "create_draft_quote", "create_draft_po"]) {
    const rejected = await call(tool, tool.endsWith("_po") ? { supplier_name: "Supply Co", items: [{ description: "x", unit_cost: 1 }] }
      : { customer_name: "Acme Trading", items: [{ description: "x", unit_price: 1 }] });
    assert.match(rejected.error, /Multiple (customers|suppliers)/);
  }
  assert.equal(raw("localdb:document_number_reservations"), beforeAmbiguous, "ambiguous parties consume no numbers");
  const direct = noError(await local.rpc("filey_save_document", { p_table: "invoice_docs", p_header: { status: "draft", number: "STRIP-SHARING", public_shared: true, shared: true, share_token: "forged" }, p_items: [{ description: "Private", qty: 1, unit_price: 1, public_shared: true }] }), "defensive adapter strip");
  assert.equal(readColl("invoice_docs").find(row => row.id === direct.data).public_shared, undefined);
  assert.equal(readColl("invoice_doc_items").find(row => row.invoice_id === direct.data).public_shared, undefined);

  // Cloud-shaped queries must pin settings to the actor and all presets to the
  // workspace. This mock never connects to Supabase or reads account secrets.
  const cloudRows: Record<string, any[]> = { company_profile: [company, { ...company, org_id: "other-org" }],
    app_settings: [{ user_id: USER, org_id: ORG, key: "invoice_number_format", value: "CLOUD-{0001}-{YYYY}" },
      { user_id: "other-user", org_id: ORG, key: "invoice_number_format", value: "WRONG-{001}" }],
    crm_customers: [customer, { ...customer, id: 99, org_id: "other-org" }], suppliers: [] };
  let failTable = "";
  const cloud = { local: false, userId: USER, orgId: ORG, supabase: { from(table: string) {
    const eq: Array<[string, unknown]> = [], ilike: Array<[string, string]> = [];
    let limit = Infinity;
    const query = { select() { return query; }, eq(key: string, value: unknown) { eq.push([key, value]); return query; },
      ilike(key: string, value: string) { ilike.push([key, value]); return query; }, limit(value: number) { limit = value; return query; },
      then(resolve: (result: unknown) => unknown) {
        assert.ok(eq.some(([key, value]) => key === "org_id" && value === ORG), `${table} is workspace scoped`);
        if (table === "app_settings") assert.ok(eq.some(([key, value]) => key === "user_id" && value === USER), "settings are actor scoped");
        if (table === failTable) return Promise.resolve(resolve({ data: null, error: { message: "Synthetic access denied" } }));
        const data = (cloudRows[table] ?? []).filter(row => eq.every(([key, value]) => row[key] === value) &&
          ilike.every(([key, value]) => String(row[key] ?? "").toLowerCase() === value.replace(/\\(.)/g, "$1").toLowerCase())).slice(0, limit);
        return Promise.resolve(resolve({ data, error: null }));
      } };
    return query;
  } } } as unknown as Ctx;
  const cloudPreset = await loadDraftPresets(cloud, "invoice", "aCmE LLC");
  assert.equal(cloudPreset.pattern, "CLOUD-{0001}-{YYYY}"); assert.equal(cloudPreset.header.seller_name, company.name);
  assert.equal(cloudPreset.header.customer_trn, customer.trn); assert.equal(cloudPreset.taxRate, 0);
  cloudRows.company_profile = [{ ...company, default_tax_rate: "0" }];
  assert.equal((await loadDraftPresets(cloud, "invoice", "Acme Trading")).taxRate, 0, "legacy numeric-string zero stays zero");
  cloudRows.company_profile = [{ ...company, default_tax_rate: "7.5" }];
  assert.equal((await loadDraftPresets(cloud, "invoice", "Acme Trading")).taxRate, 7.5);
  for (const malformed of [false, [], {}, "", "   ", "invalid"]) {
    cloudRows.company_profile = [{ ...company, default_tax_rate: malformed }];
    await assert.rejects(loadDraftPresets(cloud, "invoice", "Acme Trading"), /saved company tax rate is invalid/, "malformed defaults must not become zero VAT");
  }
  cloudRows.company_profile = [{ ...company, currency: "EUR", country_code: "DE", default_tax_rate: null }];
  await assert.rejects(loadDraftPresets(cloud, "invoice", "Acme Trading"), /explicit tax_rate/, "missing non-UAE rate cannot silently use UAE VAT");
  assert.equal((await loadDraftPresets(cloud, "invoice", "Acme Trading", { tax_rate: 0 })).taxRate, 0);
  cloudRows.company_profile = [company];
  cloudRows.crm_customers = [{ ...customer, name: "A_%.,(B)\\Co", company: "" }];
  assert.equal((await loadDraftPresets(cloud, "invoice", "A_%.,(B)\\Co")).header.customer_id, customer.id, "LIKE and filter metacharacters match literally");
  cloudRows.crm_customers.push({ ...cloudRows.crm_customers[0], id: 2 });
  await assert.rejects(loadDraftPresets(cloud, "invoice", "A_%.,(B)\\Co"), /Multiple customers/);
  failTable = "company_profile";
  await assert.rejects(loadDraftPresets(cloud, "invoice", "New customer"), /Synthetic access denied/, "read errors cannot silently fall back to incomplete documents");
  failTable = "";
  cloudRows.company_profile = []; cloudRows.app_settings = [];
  assert.equal((await loadDraftPresets(cloud, "quote", "Manual party")).pattern, "QT-{YYYY}-{0001}", "unsaved format matches the app default");
  local.close();
  writer.close();

  console.log("LOCAL SMOKE OK — all checks passed against a throwaway database.");
}

/** Best-effort: the server keeps its SQLite handle open for the process
 *  lifetime, and Windows refuses to unlink an open file. It's a temp dir. */
function cleanup(): void {
  try {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
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
