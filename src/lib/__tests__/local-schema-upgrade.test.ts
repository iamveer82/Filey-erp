import { afterAll, beforeEach, expect, it, vi } from "vitest";

// Exercise the desktop collection adapter without opening a real workspace.
const native = vi.hoisted(() => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  return { values: new Map<string, string>(), writes: [] as string[] };
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

import { erp, setCacheOrg } from "../api";
import { clearLocalCache, journalSnapshot, localClient } from "../localdb";
import { blankLetterForm, letterDisplayForm, loadLetters, saveLetter, type LetterRecord } from "../letters";
import { blankPackagingForm, loadPackagingLists, savePackagingList } from "../packagingLists";

const legacySetting = { id: 1, key: "legacy_fixture_setting", value: "opaque original data", extra: { preserved: true } };
const legacyInvoice = '[{"id":5,"number":"INV-FIXTURE-OLD","custom":{"original":"untouched"}}]';
beforeEach(() => {
  localStorage.clear(); localStorage.setItem("filey_data_mode", "local");
  native.values.clear(); native.writes.length = 0; clearLocalCache();
  setCacheOrg("fixture-org", "fixture-owner");
  native.values.set("localdb:app_settings", JSON.stringify([legacySetting]));
  native.values.set("localdb:invoice_docs", legacyInvoice);
  native.values.set("localdb:products", '[{"id":7,"name":"Fixture stock","quantity":1.25}]');
  native.values.set("syncjournal", '{"v":2,"tables":{"invoice_docs":{"changed":[5],"deleted":[]}}}');
});
afterAll(() => { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; });

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
