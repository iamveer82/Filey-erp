import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { InvoiceDocInput } from "../api";

const cloud = vi.hoisted(() => ({ rpc: vi.fn(), cap: vi.fn(), from: vi.fn(), local: null as typeof import("../localdb")["localClient"] | null }));
vi.mock("../supabase", async original => {
  const actual = await original<typeof import("../supabase")>();
  return { ...actual, isConfigured: true, supabase: null,
    sb: () => localStorage.getItem("filey_data_mode") === "local" ? cloud.local : { rpc: cloud.rpc, from: cloud.from } };
});
vi.mock("../license", async original => ({ ...await original<typeof import("../license")>(), checkFreeInvoiceCap: cloud.cap }));

const actor = "00000000-0000-4000-8000-000000000001";
const scope = `storage-workspace:user:${actor}`;
const logo = `data:image/png;base64,${"a".repeat(3_160_000)}`;
const document = (): InvoiceDocInput => ({ number: "INV-STORAGE-RECOVERY", status: "draft", currency: "AED", tax_country_code: "AE", fx_rate: 1,
  template: "minimal", accent: "#171717", seller_name: "Fixture company",
  customer_name: "Fixture customer", tax_rate: 5, discount: 0,
  custom_columns: [{ key: "liters", label: "T.Liters" }], unit_price_formula: { a: "liters", b: "unit_price" },
  items: [{ description: "H/O PAIL", qty: 50, unit_price: .2, unit: "L", custom: { liters: "1000" } },
    { description: "15W40 PAIL", qty: 15, unit_price: 4.1, unit: "L", custom: { liters: "300" } },
    { description: "20W50 PAIL", qty: 15, unit_price: 4.1, unit: "L", custom: { liters: "300" } }] });
let api: typeof import("../api");
let storage: typeof import("../deviceStorage");

beforeEach(async () => {
  vi.resetModules(); localStorage.clear();
  localStorage.setItem("filey_data_mode", "cloud");
  vi.stubGlobal("indexedDB", new IDBFactory());
  cloud.rpc.mockReset().mockResolvedValue({ data: { id: 29 }, error: null }); cloud.cap.mockReset().mockResolvedValue(undefined); cloud.from.mockReset();
  storage = await import("../deviceStorage"); cloud.local = (await import("../localdb")).localClient; api = await import("../api");
  api.setCacheOrg("storage-workspace", actor);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function quota(bytes: number) {
  const original = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
    let used = (key.length + String(value).length) * 2;
    for (let i = 0; i < this.length; i++) {
      const saved = this.key(i)!;
      if (saved !== key) used += (saved.length + this.getItem(saved)!.length) * 2;
    }
    if (used > bytes) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    original.call(this, key, value);
  });
}

it("saves a 3.16MB-logo cloud invoice while a section cache writes across browser quota migration", async () => {
  quota(10 * 1024 * 1024);
  const companyKey = `cache:${scope}:company`;
  await storage.writeDeviceValue(companyKey, JSON.stringify({ __t: Date.now(), v: { name: "Fixture company", logo } }));
  const saving = api.billing.saveDoc({ ...document(), logo });
  await storage.writeDeviceValue(`cache:${scope}:invoice-list`, JSON.stringify({ __t: Date.now(), v: Array.from({ length: 1000 }, (_, id) => ({ id, number: `INV-${id}` })) }));
  await expect(saving).resolves.toBe(29);
  expect(cloud.rpc).toHaveBeenCalledOnce();
  expect(cloud.rpc.mock.calls[0][1].p_payload.items.map((item: { custom: unknown; unit_price: number }) => [item.custom, item.unit_price]))
    .toEqual([[{ liters: "1000" }, .2], [{ liters: "300" }, 4.1], [{ liters: "300" }, 4.1]]);
  expect(await api.billing.pendingInvoiceSaves()).toEqual([]);
  expect(localStorage.getItem(companyKey)).toBeNull();
  expect((await storage.readDeviceValue(companyKey))?.length).toBeGreaterThan(3_160_000);
});

it("returns an acknowledged cloud invoice ID when only recovery-marker cleanup fails", async () => {
  const original = storage.compareDeviceValues;
  let rejectCleanup = false;
  vi.spyOn(storage, "compareDeviceValues").mockImplementation(async (entries, expected) => {
    if (rejectCleanup && entries.some(([key]) => key === "localdb:local_business_workflow_pending")) throw new DOMException("Device storage became unavailable.", "UnknownError");
    return original(entries, expected);
  });
  cloud.rpc.mockImplementation(async () => { rejectCleanup = true; return { data: { id: 29 }, error: null }; });
  await expect(api.billing.saveDoc(document())).resolves.toBe(29);
  expect(cloud.rpc).toHaveBeenCalledOnce();
  rejectCleanup = false;
  const [pending] = await api.billing.pendingInvoiceSaves();
  expect(pending.requestId).toBe(cloud.rpc.mock.calls[0][1].p_request);
  expect(pending.input.number).toBe(document().number);
});

it("reports a fresh quota failure before any RPC as rejected and preserves cached company data", async () => {
  vi.stubGlobal("indexedDB", undefined);
  quota(10 * 1024 * 1024);
  const companyKey = `cache:${scope}:company`, company = JSON.stringify({ logo });
  await storage.writeDeviceValue(companyKey, company);
  const error = await api.billing.saveDoc({ ...document(), logo }).catch(error => error);
  expect(error.message).toContain("Browser storage is full and IndexedDB is unavailable");
  expect(api.invoiceSaveOutcome(error)).toBe("rejected");
  expect(cloud.rpc).not.toHaveBeenCalled();
  expect(await api.billing.pendingInvoiceSaves()).toEqual([]);
  expect(await storage.readDeviceValue(companyKey)).toBe(company);
});

it("keeps an acknowledged local invoice and receipt successful despite marker cleanup failure", async () => {
  localStorage.setItem("filey_data_mode", "local");
  localStorage.setItem("filey_local_workspace_owner", actor);
  const original = storage.compareDeviceValues;
  let mainCommitted = false, rejectCleanup = true;
  vi.spyOn(storage, "compareDeviceValues").mockImplementation(async (entries, expected) => {
    if (mainCommitted && rejectCleanup && entries.some(([key]) => key === "localdb:local_business_workflow_pending")) throw new DOMException("Device storage became unavailable.", "UnknownError");
    const result = await original(entries, expected);
    if (result && entries.some(([key]) => key === "localdb:invoice_docs")) mainCommitted = true;
    return result;
  });
  const id = await api.billing.saveDoc(document());
  expect(Number.isSafeInteger(id) && id > 0).toBe(true);
  expect(mainCommitted).toBe(true);
  rejectCleanup = false;
  const { localClient } = await import("../localdb");
  expect((await localClient.from("invoice_docs").select("*")).data).toMatchObject([{ id, number: document().number }]);
  expect((await localClient.from("local_business_workflow_requests").select("*")).data).toMatchObject([{ result: { id } }]);
  const [pending] = await api.billing.pendingInvoiceSaves();
  const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 5 * 60_000 + 1);
  rejectCleanup = true;
  await expect(api.billing.readPendingInvoiceSave(pending.requestId)).resolves.toMatchObject({ id, number: document().number });
  rejectCleanup = false;
  expect(await api.billing.retryInvoiceSave(pending.requestId)).toBe(id);
  expect((await localClient.from("invoice_docs").select("*")).data).toHaveLength(1);
});

it("does not reclassify a prior unknown save when replay bookkeeping fails before the next RPC", async () => {
  cloud.rpc.mockRejectedValueOnce(new Error("Acknowledgement lost after commit"));
  await expect(api.billing.saveDoc(document())).rejects.toThrow("Acknowledgement lost");
  const [pending] = await api.billing.pendingInvoiceSaves();
  vi.spyOn(storage, "compareDeviceValues").mockRejectedValueOnce(new Error("Replay bookkeeping unavailable"));
  const error = await api.billing.retryInvoiceSave(pending.requestId).catch(error => error);
  expect(error.message).toBe("Replay bookkeeping unavailable");
  expect(api.invoiceSaveOutcome(error)).not.toBe("rejected");
  expect(cloud.rpc).toHaveBeenCalledOnce();
  expect(await api.billing.pendingInvoiceSaves()).toMatchObject([{ requestId: pending.requestId }]);
});

it("still rejects a workspace change during acknowledged-result cleanup", async () => {
  const original = storage.compareDeviceValues;
  let acknowledged = false;
  vi.spyOn(storage, "compareDeviceValues").mockImplementation(async (entries, expected) => {
    if (acknowledged && entries.some(([key]) => key === "localdb:local_business_workflow_pending")) {
      api.setCacheOrg("different-workspace", actor);
      throw new Error("Cleanup interrupted by workspace change");
    }
    return original(entries, expected);
  });
  cloud.rpc.mockImplementation(async () => { acknowledged = true; return { data: { id: 29 }, error: null }; });
  const error = await api.billing.saveDoc(document()).catch(error => error);
  expect(error.message).toContain("workspace changed");
  expect(api.invoiceSaveOutcome(error)).not.toBe("rejected");
  expect(cloud.rpc).toHaveBeenCalledOnce();
});

it("recovers a lost cloud acknowledgement from the exact receipt even when marker cleanup fails", async () => {
  cloud.rpc.mockRejectedValueOnce(new Error("Acknowledgement lost after commit"));
  await expect(api.billing.saveDoc(document())).rejects.toThrow("Acknowledgement lost");
  const [pending] = await api.billing.pendingInvoiceSaves();
  const receipt = { action: "invoice:save", payload: cloud.rpc.mock.calls[0][1].p_payload, result: { id: 29 } };
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: receipt, error: null }) };
  cloud.from.mockReturnValue(query);
  const saved = { ...pending.input, id: 29, created_at: "2026-10-08", updated_at: "2026-10-08" };
  const read = vi.spyOn(api.billing, "getDoc").mockResolvedValue(saved);
  vi.spyOn(storage, "compareDeviceValues").mockRejectedValue(new Error("Cleanup storage unavailable"));
  await expect(api.billing.readPendingInvoiceSave(pending.requestId)).resolves.toEqual(saved);
  expect(read).toHaveBeenCalledWith(29, true);
  expect(await api.billing.verifyPendingInvoiceSaves(saved)).toEqual([pending.requestId]);
  expect(await api.billing.pendingInvoiceSaves()).toMatchObject([{ requestId: pending.requestId }]);
  expect(cloud.rpc).toHaveBeenCalledOnce();
});

it("does not expose receipt verification after a workspace change during marker cleanup", async () => {
  cloud.rpc.mockRejectedValueOnce(new Error("Acknowledgement lost after commit"));
  await expect(api.billing.saveDoc(document())).rejects.toThrow("Acknowledgement lost");
  const [pending] = await api.billing.pendingInvoiceSaves();
  const receipt = { action: "invoice:save", payload: cloud.rpc.mock.calls[0][1].p_payload, result: { id: 29 } };
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: receipt, error: null }) };
  cloud.from.mockReturnValue(query);
  vi.spyOn(api.billing, "getDoc").mockResolvedValue({ ...pending.input, id: 29, created_at: "2026-10-08", updated_at: "2026-10-08" });
  vi.spyOn(storage, "compareDeviceValues").mockImplementation(async () => {
    api.setCacheOrg("different-workspace", actor);
    throw new Error("Cleanup interrupted by workspace change");
  });
  await expect(api.billing.readPendingInvoiceSave(pending.requestId)).rejects.toThrow("workspace changed");
  expect(cloud.rpc).toHaveBeenCalledOnce();
});
