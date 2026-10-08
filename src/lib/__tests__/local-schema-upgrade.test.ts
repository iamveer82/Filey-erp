import { afterAll, beforeEach, expect, it, vi } from "vitest";

// Exercise the desktop collection adapter without opening a real workspace.
const native = vi.hoisted(() => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  return { values: new Map<string, string>(), writes: [] as string[], loseInvoiceAcknowledgement: false };
});
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: { key?: string; value?: string; entries?: [string, string | null][]; expected?: [string, string | null][] }) => {
    if (command === "cache_get") return native.values.get(args.key!) ?? null;
    if (command === "cache_set") {
      native.writes.push(command); native.values.set(args.key!, args.value!); return;
    }
    if (command === "cache_set_many") {
      native.writes.push(command);
      for (const [key, value] of args.entries!) if (value !== null) native.values.set(key, value);
      return;
    }
    if (command === "cache_compare_set_many") {
      native.writes.push(command);
      if (args.expected!.some(([key, value]) => (native.values.get(key) ?? null) !== value)) return false;
      for (const [key, value] of args.entries!) {
        if (value === null) native.values.delete(key); else native.values.set(key, value);
      }
      if (native.loseInvoiceAcknowledgement && args.entries!.some(([key]) => key === "localdb:invoice_docs")) {
        native.loseInvoiceAcknowledgement = false;
        throw new Error("Desktop acknowledgement lost");
      }
      return true;
    }
    throw new Error(`Unexpected native command: ${command}`);
  },
}));
vi.mock("../nativePlatform", () => ({ isNativeApp: () => false }));
vi.mock("../moduleAccess", () => ({ requireModuleAccess: async () => {}, loadModuleAccess: async () => ({ admin: true, modules: null }) }));
vi.mock("../realtime", () => ({ notifyDataChanged: vi.fn() }));
vi.mock("../supabase", async () => {
  const { localClient } = await import("../localdb");
  return { isConfigured: true, supabase: null, sb: () => localClient };
});

import { billing, erp, suppliers, setCacheOrg } from "../api";
import { clearLocalCache, journalSnapshot, localClient } from "../localdb";
import { blankLetterForm, letterDisplayForm, loadLetters, saveLetter, type LetterRecord } from "../letters";
import { blankPackagingForm, loadPackagingLists, savePackagingList } from "../packagingLists";

const legacySetting = { id: 1, key: "legacy_fixture_setting", value: "opaque original data", extra: { preserved: true } };
const legacyInvoice = '[{"id":5,"number":"INV-FIXTURE-OLD","custom":{"original":"untouched"}}]';
beforeEach(() => {
  localStorage.clear(); localStorage.setItem("filey_data_mode", "local");
  native.values.clear(); native.writes.length = 0; native.loseInvoiceAcknowledgement = false; clearLocalCache();
  setCacheOrg("fixture-org", "fixture-owner");
  native.values.set("localdb:app_settings", JSON.stringify([legacySetting]));
  native.values.set("localdb:invoice_docs", legacyInvoice);
  native.values.set("localdb:products", '[{"id":7,"name":"Fixture stock","quantity":1.25}]');
  native.values.set("syncjournal", '{"v":2,"tables":{"invoice_docs":{"changed":[5],"deleted":[]}}}');
});
afterAll(() => { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; });

it("adds optional supplier identity to an older desktop collection and preserves it across reopen", async () => {
  const oldSupplier = { id: 10, name: "Original supplier", notes: "Original notes", bank_details: { iban: "Original bank" } };
  native.values.set("localdb:suppliers", JSON.stringify([oldSupplier]));
  const fields = { city: "Dubai", country_code: "AE", country_subdivision: "DU", einvoice_identity: JSON.stringify({ tin: "1234567890", legal_id: "LIC-1" }) };
  await suppliers.update(10, { custom_fields: fields });
  clearLocalCache();
  expect((await suppliers.list())[0]).toMatchObject({ ...oldSupplier, custom_fields: fields });
  const newId = await suppliers.create({ name: "Name only" });
  expect(newId).toBeGreaterThan(0);
  await suppliers.update(10, { custom_fields: {} });
  clearLocalCache();
  expect((await suppliers.list()).find(row => row.id === 10)).toMatchObject({ ...oldSupplier, custom_fields: {} });
  expect(native.values.get("localdb:invoice_docs")).toBe(legacyInvoice);
  expect((await journalSnapshot()).tables.suppliers.changed).toContain(10);
});

it("reads legacy issued letters without rewriting missing typography flags or their frozen snapshot", async () => {
  const form = { ...blankLetterForm("LTR-FIXTURE-OLD"), status: "issued" as const,
    title: "Original issued content", body: "Original body", use_letterhead: true,
    letterhead: { background: "data:image/png;base64,Zml4dHVyZQ==" } };
  delete form.show_reference; delete form.show_company_header;
  delete form.text_style; delete form.title_style;
  const old: LetterRecord = { id: "fixture-old", revision: 3, created_at: "2026-10-03T00:00:00Z",
    updated_at: "2026-10-03T01:00:00Z", issued_at: "2026-10-03T01:00:00Z",
    form, issued_snapshot: structuredClone(form) };
  native.values.set("localdb:app_settings", JSON.stringify([legacySetting, { id: 2, key: "letters", value: JSON.stringify([old]) }]));
  const before = [...native.values];
  expect(await loadLetters()).toEqual([old]);
  expect(letterDisplayForm((await loadLetters())[0])).toEqual(old.issued_snapshot);
  clearLocalCache();
  expect(await loadLetters()).toEqual([old]);
  expect([...native.values]).toEqual(before);
  expect(native.writes).toEqual([]);
});

it("adds current documents and local receipts to an older desktop store, then reopens without losing existing data", async () => {
  const letter = { ...blankLetterForm("LTR-FIXTURE-NEW"), status: "issued" as const,
    title: "Formatted fixture", body: "Preserved paragraph.\n".repeat(800),
    show_reference: false, show_company_header: false,
    text_style: { font: "classic" as const, fontSize: 13, bold: false, italic: true, underline: true,
      color: "#123456", align: "center" as const, lineSpacing: 1.8, paragraphSpacing: 20 },
    blocks: [{ id: "fixture-field", type: "field" as const, align: "left" as const,
      label: "Fixture", value: "Preserved value", style: { fontSize: 9, bold: true, align: "right" as const } }] };
  const packaging = blankPackagingForm("PL-FIXTURE-NEW");
  packaging.recipient_name = "Fixture recipient";
  packaging.items[0] = { ...packaging.items[0], description: "Fixture item", qty: 0.5,
    package_count: 2, net_weight: 1.25, gross_weight: 1.5 };
  const request = "12345678-1234-1234-1234-123456789abc";
  const [savedLetter, savedPackaging] = await Promise.all([
    saveLetter(letter), savePackagingList(packaging), erp.recordStocktake(7, 0.125, 1.25, request),
  ]);
  const journal = await journalSnapshot();
  expect(journal.tables.invoice_docs.changed).toEqual([5]);
  expect(journal.tables.app_settings.changed).toHaveLength(2);
  expect(journal.tables).not.toHaveProperty("local_stocktake_requests");
  expect(native.values.get("localdb:invoice_docs")).toBe(legacyInvoice);
  expect(native.writes).toContain("cache_compare_set_many");
  // Large document bodies use the existing durable blob split, not a new SQL column.
  expect([...native.values.keys()].some(key => key.startsWith("localdb:blob:"))).toBe(true);
  clearLocalCache();
  expect(await loadLetters()).toEqual([savedLetter]);
  expect(letterDisplayForm((await loadLetters())[0])).toEqual(letter);
  expect(await loadPackagingLists()).toEqual([savedPackaging]);
  expect((await localClient.from("app_settings").select().eq("key", legacySetting.key).single()).data).toEqual(legacySetting);
  await erp.recordStocktake(7, 0.125, 1.25, request);
  expect((await localClient.from("products").select().eq("id", 7).single()).data.quantity).toBe(0.125);
  expect((await localClient.from("stock_movements").select()).data).toHaveLength(1);
  expect((await localClient.from("local_stocktake_requests").select()).data).toHaveLength(1);
  expect(await journalSnapshot()).toEqual(journal);
});

it("upgrades an old desktop collection with current invoice fields and recovers a lost save acknowledgement without a duplicate", async () => {
  const logo = `data:image/png;base64,${"a".repeat(3 * 1024 * 1024)}`;
  const input = {
    number: "INV-FIXTURE-CURRENT", status: "draft", currency: "AED", tax_country_code: "AE",
    issue_date: "2026-09-23", customer_name: "Fixture customer", tax_rate: 5, discount: 0, logo,
    custom_columns: [{ key: "liters", label: "T.Liters" }],
    unit_price_formula: { a: "liters", b: "unit_price" },
    einvoice: { payment_means_code: "30" },
    items: [
      { description: "H/O 68 PAIL 20L", qty: 50, unit: "L", unit_price: 0.20, custom: { liters: "1000" } },
      { description: "15W40 PAIL 20L", qty: 15, unit: "L", unit_price: 0.20, custom: { liters: "300" } },
      { description: "20W50 PAIL 20L", qty: 15, unit: "L", unit_price: 0.20, custom: { liters: "300" } },
    ],
  };
  const request = "12345678-1234-4234-8234-123456789def";
  native.loseInvoiceAcknowledgement = true;
  await expect(billing.saveDoc(input as never, request)).rejects.toThrow("Desktop acknowledgement lost");
  clearLocalCache();
  expect(await billing.pendingInvoiceSaves()).toMatchObject([{ requestId: request, active: false }]);
  const id = await billing.retryInvoiceSave(request);
  clearLocalCache();
  const saved = await billing.getDoc(id);
  expect(saved).toMatchObject({ ...input, einvoice: { ...input.einvoice, uuid: expect.any(String) } });
  expect((await billing.listDocs()).find(doc => doc.id === id)).toMatchObject({ total: 336, net_total: 320, tax_total: 16 });
  expect(JSON.parse(native.values.get("localdb:invoice_docs")!)).toHaveLength(2);
  expect(JSON.parse(native.values.get("localdb:invoice_docs")!)[0]).toEqual(JSON.parse(legacyInvoice)[0]);
  expect(JSON.parse(native.values.get("localdb:invoice_doc_items")!)).toHaveLength(3);
  expect(JSON.parse(native.values.get("localdb:local_business_workflow_requests")!)).toHaveLength(1);
  expect(native.values.get("localdb:invoice_docs")!.length).toBeLessThan(4096);
  expect((await journalSnapshot()).tables).not.toHaveProperty("local_business_workflow_requests");
  expect((await localClient.from("app_settings").select().eq("key", legacySetting.key).single()).data).toEqual(legacySetting);
});

it("confirms a committed desktop invoice from its local receipt without replaying the write", async () => {
  native.loseInvoiceAcknowledgement = true;
  await expect(billing.saveDoc({ number: "LOCAL-CONFIRMED", status: "draft", currency: "AED", tax_country_code: "AE", tax_rate: 0,
    discount: 0, customer_name: "Fixture", items: [{ description: "Fixture", qty: 2, unit_price: 10 }] } as never)).rejects.toThrow("Desktop acknowledgement lost");
  clearLocalCache();
  const [pending] = await billing.pendingInvoiceSaves();
  const doc = await billing.readPendingInvoiceSave(pending.requestId);
  expect(doc).toMatchObject({ number: "LOCAL-CONFIRMED", items: [{ qty: 2, unit_price: 10 }] });
  expect(await billing.pendingInvoiceSaves()).toEqual([]);
  expect(JSON.parse(native.values.get("localdb:invoice_docs")!)).toHaveLength(2);
  expect(JSON.parse(native.values.get("localdb:invoice_doc_items")!)).toHaveLength(1);
  expect(JSON.parse(native.values.get("localdb:local_business_workflow_requests")!)).toHaveLength(1);
});
