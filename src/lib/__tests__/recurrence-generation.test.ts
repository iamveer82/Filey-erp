import { beforeEach, afterEach, expect, it, vi } from "vitest";
const cloud = vi.hoisted(() => ({ rpc: vi.fn(), session: vi.fn() }));
vi.mock("../supabase", () => ({ sb: () => ({ auth: { getSession: cloud.session }, rpc: cloud.rpc }), supabase: null, isConfigured: false, cloudConfigured: false }));
import { setCacheOrg } from "../api";
import { setDataMode } from "../dataMode";
import { clearLocalCache, loadColl, localClient } from "../localdb";
import { generateRecurringInvoice } from "../recurrenceGeneration";

const user = "00000000-0000-4000-8000-000000000001";
beforeEach(async () => {
  localStorage.clear(); clearLocalCache(); vi.clearAllMocks(); setCacheOrg("org", user); setDataMode("local");
  await localClient.from("invoice_docs").insert({ id: 1, org_id: "org", user_id: user, number: "INV-2026-0010", status: "sent", seller_name: "Filey", customer_name: "Mary", currency: "AED", advance_applied: 50, due_date: "2026-08-31", quotation_id: 8, order_id: 9, shared: true, share_token: "private", einvoice: { uuid: "old", buyer: { city: "Dubai" } }, unit_price_formula: { a: "hours", b: "unit_price" } });
  await localClient.from("invoice_doc_items").insert({ id: 1, org_id: "org", invoice_id: 1, description: "Retainer", qty: 1, unit_price: 10, custom: { hours: "12.5", __calc_mode: "manual", __manual_amount: "1200" } });
  await localClient.from("invoice_recurrence").insert({ id: 1, org_id: "org", base_invoice_id: 1, next_run: "2026-09-01", interval: "monthly", active: true });
  cloud.session.mockResolvedValue({ data: { session: { user: { id: user }, access_token: "fixture" } }, error: null });
});
afterEach(() => { vi.restoreAllMocks(); });
it("commits only one draft and schedule across eight simultaneous overdue generators", async () => {
  const made = await Promise.all(Array.from({ length: 8 }, () => generateRecurringInvoice(1, "2026-09-01", "2026-10-04", "2026-11-01")));
  expect(made.filter(Boolean)).toHaveLength(1);
  expect(await loadColl("invoice_docs")).toHaveLength(2);
  expect((await loadColl("invoice_recurrence"))[0]).toMatchObject({ next_run: "2026-11-01", last_run: "2026-10-04" });
  const draft = (await loadColl("invoice_docs")).find(row => row.id !== 1)!;
  expect(draft).toMatchObject({ advance_applied: 0, status: "draft", issue_date: "2026-10-04", unit_price_formula: { a: "hours", b: "unit_price" }, einvoice: { buyer: { city: "Dubai" } } });
  expect(draft.einvoice.uuid).not.toBe("old");
  for (const key of ["shared", "share_token", "due_date", "quotation_id", "order_id"]) expect(draft[key]).toBeUndefined();
  expect((await loadColl("invoice_doc_items")).find(row => row.invoice_id === draft.id)?.custom).toEqual({ hours: "12.5", __calc_mode: "manual", __manual_amount: "1200" });
});
it("rolls back the draft and lines if writing the schedule fails", async () => {
  const original = Storage.prototype.setItem; let once = true;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (once && key === "localdb:invoice_recurrence" && value.includes('"last_run"')) { once = false; throw new Error("Disk full"); }
    return original.call(this, key, value);
  });
  await expect(generateRecurringInvoice(1, "2026-09-01", "2026-10-04", "2026-11-01")).rejects.toThrow("Disk full");
  expect(await loadColl("invoice_docs")).toHaveLength(1); expect(await loadColl("invoice_doc_items")).toHaveLength(1);
  expect((await loadColl("invoice_recurrence"))[0].next_run).toBe("2026-09-01");
  expect(await generateRecurringInvoice(1, "2026-09-01", "2026-10-04", "2026-11-01")).toBe(true);
});
it("rejects stale or invalid schedule updates and preserves the original invoice", async () => {
  await expect(generateRecurringInvoice(1, "2026-09-01", "2026-10-04", "2026-12-01")).rejects.toThrow("schedule changed");
  await expect(generateRecurringInvoice(1, "2026-02-30", "2026-10-04", "2026-11-01")).rejects.toThrow("schedule is invalid");
  expect(await loadColl("invoice_docs")).toHaveLength(1);
  expect(await generateRecurringInvoice(1, "2026-08-01", "2026-10-04", "2026-11-01")).toBe(false);
});
it("retires a genuinely missing local base without minting a replacement", async () => {
  await localClient.from("invoice_docs").delete().eq("id", 1);
  expect(await generateRecurringInvoice(1, "2026-09-01", "2026-10-04", "2026-11-01")).toBe(false);
  expect((await loadColl("invoice_recurrence"))[0].active).toBe(false);
  expect(await loadColl("document_number_reservations")).toEqual([]);
});
it("pins cloud identity, does not fall back after an unconfirmed response, and rejects late workspace responses", async () => {
  setDataMode("cloud");
  cloud.rpc.mockImplementation(() => ({ setHeader: async () => ({ data: null, error: new Error("Response lost") }) }));
  await expect(generateRecurringInvoice(1, "2026-09-01", "2026-10-04", "2026-11-01")).rejects.toThrow("Response lost");
  expect(cloud.rpc).toHaveBeenCalledWith("filey_generate_recurring_invoice", expect.objectContaining({ p_actor: user, p_org: "org" }));
  expect(await loadColl("invoice_docs")).toHaveLength(1);
  cloud.rpc.mockImplementation(() => ({ setHeader: async () => { setCacheOrg("other", user); return { data: true, error: null }; } }));
  await expect(generateRecurringInvoice(1, "2026-09-01", "2026-10-04", "2026-11-01")).rejects.toThrow("account changed");
});
