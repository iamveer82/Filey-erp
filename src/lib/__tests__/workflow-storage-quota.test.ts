import { afterEach, beforeEach, expect, it, vi } from "vitest";
const cloud = vi.hoisted(() => ({ rpc: vi.fn(), cap: vi.fn() }));
vi.mock("../supabase", async original => {
  const actual = await original<typeof import("../supabase")>();
  const { localClient } = await import("../localdb");
  return { ...actual, isConfigured: true, supabase: null,
    sb: () => localStorage.getItem("filey_data_mode") === "local" ? localClient : { rpc: cloud.rpc } };
});
vi.mock("../license", async original => ({ ...await original<typeof import("../license")>(), checkFreeInvoiceCap: cloud.cap }));
import { billing, setCacheOrg } from "../api";
import { clearLocalCache, localClient } from "../localdb";

const actor = "00000000-0000-4000-8000-000000000001";
const scope = `quota-workspace:user:${actor}`;
const logo = `data:image/png;base64,${"a".repeat(90 * 1024)}`;
const document = (number: string) => ({ number, status: "draft", currency: "AED", tax_country_code: "AE", fx_rate: 1,
  customer_name: "Buyer", tax_rate: 0, discount: 0, logo,
  items: [{ description: "Service", qty: 1, unit_price: 100 }] });
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) :
  value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined)
    .map(key => [key, canonical(value[key])])) : value;
const rows = async (table: string) => (await localClient.from(table).select("*")).data as any[];
const bytes = () => Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)!)
  .reduce((total, key) => total + 2 * (key.length + (localStorage.getItem(key)?.length ?? 0)), 0);

beforeEach(() => {
  localStorage.clear(); clearLocalCache(); localStorage.setItem("filey_data_mode", "local");
  setCacheOrg(null); setCacheOrg("quota-workspace", actor);
  cloud.rpc.mockReset(); cloud.cap.mockReset().mockResolvedValue(undefined);
  vi.spyOn(billing, "getCompany").mockResolvedValue({ name: "Fixture", country_code: "AE" } as never);
});
afterEach(() => { vi.restoreAllMocks(); setCacheOrg(null); clearLocalCache(); });

it("saves and edits 35 real large-logo invoices within a five-megabyte browser quota", async () => {
  const set = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    const previous = this.getItem(key);
    const nextSize = bytes() - (previous == null ? 0 : 2 * (key.length + previous.length)) + 2 * (key.length + String(value).length);
    if (nextSize > 5 * 1024 * 1024) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    set.call(this, key, value);
  });
  let id = 0;
  for (let index = 1; index <= 35; index++) id = await billing.saveDoc(document(`INV-QUOTA-${index}`) as never);
  for (let index = 0; index < 5; index++) await billing.saveDoc({ ...document("INV-QUOTA-35"), id, notes: `Edit ${index}` } as never);
  expect(await rows("invoice_docs")).toHaveLength(35);
  expect((await billing.getDoc(id)).logo).toBe(logo);
  expect((await billing.getDoc(id)).notes).toBe("Edit 4");
  expect(await rows("local_business_workflow_requests")).toHaveLength(40);
  expect((await rows("local_business_workflow_requests")).every(receipt => /^sha256:[a-f0-9]{64}$/.test(receipt.fingerprint))).toBe(true);
  expect(bytes()).toBeLessThan(1024 * 1024);
});

it("compacts legacy local receipt identities and recovers the saved invoice without duplicating it", async () => {
  const request = "00000000-0000-4000-8000-000000000099";
  const doc = document("LEGACY-RECEIPT");
  const id = await billing.saveDoc(doc as never, request);
  const { items: _items, ...header } = doc;
  const serialized = JSON.stringify(canonical({ id: null, header, items: [{ description: "Service", qty: 1, unit_price: 100,
    unit: null, custom: null, tax_category: null, position: 0, product_id: null }] }));
  const receipt = (await rows("local_business_workflow_requests"))[0];
  await localClient.from("local_business_workflow_requests").update({ fingerprint: serialized }).eq("id", receipt.id);
  expect(await billing.saveDoc(doc as never, request)).toBe(id);
  expect(await rows("invoice_docs")).toHaveLength(1);
  const updated = (await rows("local_business_workflow_requests"))[0];
  expect(updated.request_key).toBe(`${scope}:${request}`);
  expect(updated.result).toEqual(receipt.result);
  expect(updated.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
  await expect(billing.saveDoc({ ...doc, customer_name: "Changed buyer" } as never, request)).rejects.toThrow("already used for different changes");
  expect(await rows("invoice_docs")).toHaveLength(1);
});

it("migrates an old large pending key and retries cloud saves with the original reviewed payload and request", async () => {
  localStorage.setItem("filey_data_mode", "cloud");
  const doc = document("CLOUD-LOST-ACK");
  cloud.rpc.mockRejectedValueOnce(new Error("Acknowledgement lost"));
  await expect(billing.saveDoc(doc as never)).rejects.toThrow("Acknowledgement lost");
  const dispatched = cloud.rpc.mock.calls[0][1];
  const registry = (await rows("local_business_workflow_pending"))[0];
  const pending = Object.values(registry.requests)[0] as any;
  const serialized = JSON.stringify(canonical(pending.payload));
  const legacyKey = `invoice:save:${serialized}:${pending.request}`;
  await localClient.from("local_business_workflow_pending").update({ requests: { [legacyKey]: pending } }).eq("id", registry.id);
  cloud.cap.mockRejectedValue(new Error("Cloud monthly limit reached"));
  cloud.rpc.mockResolvedValueOnce({ data: { id: 27 }, error: null });
  expect(await billing.saveDoc(doc as never)).toBe(27);
  expect(cloud.rpc.mock.calls[1][1]).toEqual(dispatched);
  expect(cloud.cap).toHaveBeenCalledOnce();
  expect((await rows("local_business_workflow_pending"))[0].requests).toEqual({});
});

it("retains legacy active ownership while migrating a request identity", async () => {
  localStorage.setItem("filey_data_mode", "cloud");
  const request = "00000000-0000-4000-8000-000000000098";
  const payload = { id: 7, amount: 10, method: "bank", paid_at: "2026-10-04", rates: { AED: 1 } };
  const fingerprint = JSON.stringify(canonical({ id: 7, amount: 10, method: "bank", paid_at: "2026-10-04" }));
  const pending = { request, payload, owner: "other-window", activeUntil: Date.now() + 60_000 };
  await localClient.from("local_business_workflow_pending").insert({ registry_key: `business-workflow:cloud:${scope}`,
    requests: { [`invoice:payment-add:${fingerprint}:${request}`]: pending } });
  await expect(billing.addPayment(7, 10, "bank", "2026-10-04")).rejects.toThrow("another window");
  expect(cloud.rpc).not.toHaveBeenCalled();
  const stored = (await rows("local_business_workflow_pending"))[0];
  expect(Object.values(stored.requests)).toEqual([pending]);
});
