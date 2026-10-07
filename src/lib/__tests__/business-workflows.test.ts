import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
const cloud = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), changed: vi.fn(), cap: vi.fn(), rates: { EUR: 4, AED: 1 } }));
vi.mock("../realtime", () => ({ notifyDataChanged: cloud.changed }));
vi.mock("../supabase", () => ({ isConfigured: true, supabase: null, sb: () => ({ rpc: cloud.rpc, from: cloud.from }) }));
vi.mock("../exchange-rates", async original => ({ ...await original<typeof import("../exchange-rates")>(), getExchangeRates: async () => cloud.rates }));
vi.mock("../license", async original => ({ ...await original<typeof import("../license")>(), checkFreeInvoiceCap: cloud.cap }));
import { billing, erp, invoiceSaveIntentMatches, invoiceSaveOutcome, pos, setCacheOrg } from "../api";
import { localClient } from "../localdb";
const actor = "00000000-0000-4000-8000-000000000001";
beforeEach(() => {
  localStorage.clear(); localStorage.setItem("filey_data_mode", "cloud");
  setCacheOrg(null); setCacheOrg("workspace-a", actor);
  cloud.rpc.mockReset(); cloud.from.mockReset(); cloud.changed.mockClear(); cloud.cap.mockReset().mockResolvedValue(undefined); cloud.rates = { EUR: 4, AED: 1 };
});
afterEach(() => { setCacheOrg(null); vi.restoreAllMocks(); });

it("uses one workspace/account-bound atomic RPC for posting, payments, PO receiving and stock", async () => {
  cloud.rpc.mockResolvedValueOnce({ data: { id: 7 }, error: null });
  await billing.setStatus(7, "sent");
  cloud.rpc.mockResolvedValueOnce({ data: { id: 7, payment_id: 42 }, error: null });
  expect(await billing.addPayment(7, 10, "bank", "2026-10-04")).toBe(42);
  cloud.rpc.mockResolvedValueOnce({ data: { id: 8 }, error: null });
  await pos.receive(8);
  cloud.rpc.mockResolvedValueOnce({ data: { id: 9 }, error: null });
  await erp.updateStock(9, .5);
  expect(cloud.rpc.mock.calls.map(([name]) => name)).toEqual(["filey_business_workflow", "filey_business_workflow", "filey_business_workflow", "filey_stock_workflow"]);
  for (const [, args] of cloud.rpc.mock.calls) expect(args).toMatchObject({ p_actor: actor, p_org: "workspace-a", p_request: expect.stringMatching(/^[\da-f-]{36}$/) });
});

it("recovers a lost acknowledgement with the original request and reviewed exchange rate", async () => {
  cloud.rpc.mockRejectedValueOnce(new Error("Response lost"));
  await expect(billing.addPayment(7, 10, "bank", "2026-10-04")).rejects.toThrow("Response lost");
  const original = cloud.rpc.mock.calls[0][1];
  cloud.rates = { EUR: 99, AED: 1 };
  cloud.rpc.mockResolvedValueOnce({ data: { id: 7, payment_id: 42 }, error: null });
  expect(await billing.addPayment(7, 10, "bank", "2026-10-04")).toBe(42);
  expect(cloud.rpc.mock.calls[1][1]).toEqual(original);
  cloud.rpc.mockResolvedValueOnce({ data: { id: 7, payment_id: 43 }, error: null });
  await billing.addPayment(7, 10, "bank", "2026-10-04");
  expect(cloud.rpc.mock.calls[2][1].p_request).not.toBe(original.p_request);
});

it("does not merge simultaneous intentional equal stock adjustments", async () => {
  const releases: ((value: unknown) => void)[] = [];
  cloud.rpc.mockImplementation(() => new Promise(resolve => releases.push(resolve)));
  const pending = [erp.updateStock(9, .5), erp.updateStock(9, .5)];
  await waitFor(() => expect(cloud.rpc).toHaveBeenCalledTimes(2));
  expect(cloud.rpc.mock.calls[0][1].p_request).not.toBe(cloud.rpc.mock.calls[1][1].p_request);
  releases.forEach(release => release({ data: { id: 9 }, error: null }));
  await Promise.all(pending);
});

it("retains an unconfirmed request and rejects invalid receipts or a changed receipt identity", async () => {
  const results = [{ id: true, payment_id: 42 }, { id: 8, payment_id: 42 }, { id: 7 }, null];
  for (const data of results) {
    cloud.rpc.mockResolvedValueOnce({ data, error: null });
    await expect(billing.addPayment(7, 10, "bank", "2026-10-04")).rejects.toThrow("could not be confirmed");
  }
  expect(new Set(cloud.rpc.mock.calls.map(([, args]) => args.p_request)).size).toBe(1);
  expect(cloud.changed).not.toHaveBeenCalled();
});

it("clears only definite SQL rejections and preserves a pending request on transport failure", async () => {
  cloud.rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "Invalid payment" } });
  await expect(billing.addPayment(7, 10, "bank", "2026-10-04")).rejects.toMatchObject({ message: "Invalid payment" });
  cloud.rpc.mockResolvedValueOnce({ data: { id: 7, payment_id: 42 }, error: null });
  await billing.addPayment(7, 10, "bank", "2026-10-04");
  expect(cloud.rpc.mock.calls[1][1].p_request).not.toBe(cloud.rpc.mock.calls[0][1].p_request);
});

it("refuses a foreign-renderer active receipt after a crash instead of posting another payment", async () => {
  const request = "00000000-0000-4000-8000-000000000099";
  const payload = { id: 7, amount: 10, method: "bank", paid_at: "2026-10-04", rates: { EUR: 4, AED: 1 } };
  const fingerprint = JSON.stringify({ amount: 10, id: 7, method: "bank", paid_at: "2026-10-04" });
  const rows = { [`invoice:payment-add:${fingerprint}:${request}`]: { request, payload, owner: "crashed-renderer", activeUntil: Date.now() + 60_000 } };
  await localClient.from("local_business_workflow_pending").insert({ registry_key: `business-workflow:cloud:workspace-a:user:${actor}`, requests: rows });
  await expect(billing.addPayment(7, 10, "bank", "2026-10-04")).rejects.toThrow("another window");
  expect(cloud.rpc).not.toHaveBeenCalled();
  const record = (await localClient.from("local_business_workflow_pending").select().single()).data;
  const unchanged = Object.values(record.requests)[0] as any;
  expect(unchanged.owner).toBe("crashed-renderer");
  unchanged.activeUntil = 0;
  await localClient.from("local_business_workflow_pending").update({ requests: structuredClone(record.requests) }).eq("id", record.id);
  cloud.rpc.mockResolvedValueOnce({ data: { id: 7, payment_id: 42 }, error: null });
  await billing.addPayment(7, 10, "bank", "2026-10-04");
  expect(cloud.rpc.mock.calls[0][1].p_request).toBe(request);
});

it("checks the captured workspace immediately before dispatch and rejects stale acknowledgements", async () => {
  let release!: (value: unknown) => void;
  cloud.rpc.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const action = billing.setStatus(7, "sent"), rejected = expect(action).rejects.toThrow("workspace changed");
  await waitFor(() => expect(cloud.rpc).toHaveBeenCalledOnce());
  setCacheOrg("workspace-b", actor); release({ data: { id: 7 }, error: null });
  await rejected;
  expect(cloud.rpc.mock.calls[0][1]).toMatchObject({ p_org: "workspace-a", p_actor: actor });
  expect(cloud.changed).not.toHaveBeenCalled();
});

it("does not dispatch under a new workspace while the durable request is being read", async () => {
  const get = Storage.prototype.getItem;
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key) {
    if (key.startsWith("business-workflow:")) setCacheOrg("workspace-b", actor);
    return get.call(this, key);
  });
  await expect(billing.setStatus(7, "sent")).rejects.toThrow("workspace changed");
  expect(cloud.rpc).not.toHaveBeenCalled();
});

it("recovers the last allowed invoice's lost acknowledgement without treating the committed save as a new invoice", async () => {
  vi.spyOn(billing, "getCompany").mockResolvedValue({ name: "Fixture" } as never);
  const doc = { number: "LOST-LAST-INVOICE", status: "draft", currency: "AED", tax_rate: 0, discount: 0, customer_name: "Buyer", items: [] } as never;
  cloud.rpc.mockRejectedValueOnce(new Error("Response lost after save"));
  await expect(billing.saveDoc(doc)).rejects.toThrow("Response lost");
  cloud.cap.mockRejectedValue(new Error("Monthly limit reached"));
  cloud.rpc.mockResolvedValueOnce({ data: { id: 7 }, error: null });
  expect(await billing.saveDoc(doc)).toBe(7);
  expect(cloud.cap).toHaveBeenCalledOnce();
  expect(cloud.rpc.mock.calls[1][1].p_request).toBe(cloud.rpc.mock.calls[0][1].p_request);
  await expect(billing.saveDoc({ ...(doc as any), number: "ANOTHER-INVOICE" })).rejects.toThrow("Monthly limit");
  expect(cloud.rpc).toHaveBeenCalledTimes(2);
});

const recoveryInvoice = () => ({ number: "INV-RECOVER", status: "draft", currency: "EUR", tax_rate: 5, discount: 0,
  customer_name: "Buyer", unit_price_formula: { a: "liters", b: "unit_price" },
  items: [{ description: "Oil", qty: 6, unit: "L", unit_price: .2, custom: { liters: "1200" } }] }) as never;

it("does not reconcile ordinary quantity pricing with additional formula, manual amount or VAT metadata", () => {
  const ordinary = { items: [{ description: "Oil", qty: 2, unit_price: 10 }] };
  expect(invoiceSaveIntentMatches(ordinary, { ...ordinary, items: [{ ...ordinary.items[0], custom: { __calc_mode: "manual", __manual_amount: "500" } }] })).toBe(false);
  expect(invoiceSaveIntentMatches(ordinary, { ...ordinary, unit_price_formula: { a: "liters", b: "unit_price" } })).toBe(false);
  expect(invoiceSaveIntentMatches(ordinary, { ...ordinary, items: [{ ...ordinary.items[0], tax_category: "Z" }] })).toBe(false);
  expect(invoiceSaveIntentMatches(ordinary, { ...ordinary, tax_rate: 5 })).toBe(false);
  expect(invoiceSaveIntentMatches(ordinary, { ...ordinary, discount: 5 })).toBe(false);
  expect(invoiceSaveIntentMatches(ordinary, { ...ordinary, round_off: true })).toBe(false);
  expect(invoiceSaveIntentMatches(ordinary, { ...ordinary, items: [{ ...ordinary.items[0], custom: {} }], tax_rate: 0, discount: 0, round_off: false })).toBe(true);
});

it("recovers an invoice in a later turn using its frozen number, inferred FX and original request", async () => {
  vi.spyOn(billing, "getCompany").mockResolvedValue({ name: "Fixture", country_code: "AE" } as never);
  cloud.rpc.mockRejectedValueOnce(new Error("Response lost"));
  await expect(billing.saveDoc(recoveryInvoice())).rejects.toThrow("Response lost");
  const original = cloud.rpc.mock.calls[0][1];
  setCacheOrg(null); setCacheOrg("workspace-a", actor);
  cloud.rates = { EUR: 99, AED: 1 };
  const [pending] = await billing.pendingInvoiceSaves();
  expect(pending).toMatchObject({ active: false, requestId: original.p_request,
    input: { number: "INV-RECOVER", fx_rate: 4, tax_country_code: "AE", items: [{ custom: { liters: "1200" }, unit_price: .2 }] } });
  cloud.rpc.mockResolvedValueOnce({ data: { id: 7 }, error: null });
  expect(await billing.retryInvoiceSave(pending.requestId)).toBe(7);
  expect(cloud.rpc.mock.calls[1][1]).toEqual(original);
  expect(await billing.pendingInvoiceSaves()).toEqual([]);
  await expect(billing.retryInvoiceSave(pending.requestId)).rejects.toThrow("no longer available");
  expect(cloud.rpc).toHaveBeenCalledTimes(2);
});

it("does not treat a replay rejection as proof that the original unacknowledged invoice was rolled back", async () => {
  vi.spyOn(billing, "getCompany").mockResolvedValue({ name: "Fixture", country_code: "AE" } as never);
  cloud.rpc.mockRejectedValueOnce(new Error("Response lost after commit"));
  await expect(billing.saveDoc(recoveryInvoice())).rejects.toThrow("Response lost");
  const [pending] = await billing.pendingInvoiceSaves();
  for (const code of ["22023", "42501", "57014", "42883"]) {
    cloud.rpc.mockResolvedValueOnce({ data: null, error: { code, message: "Replay failed before reading the old receipt" } });
    const error = await billing.retryInvoiceSave(pending.requestId).catch(error => error);
    expect(invoiceSaveOutcome(error)).toBe("unconfirmed");
    expect(await billing.pendingInvoiceSaves()).toMatchObject([{ requestId: pending.requestId }]);
  }
  cloud.rpc.mockResolvedValueOnce({ data: { id: 7 }, error: null });
  expect(await billing.retryInvoiceSave(pending.requestId)).toBe(7);
  expect(new Set(cloud.rpc.mock.calls.map(([, args]) => args.p_request)).size).toBe(1);
});

it("distinguishes trusted preflight and first SQL rejection from an unconfirmed timeout", async () => {
  vi.spyOn(billing, "getCompany").mockResolvedValue({ name: "Fixture", country_code: "AE" } as never);
  const invalid = { ...(recoveryInvoice() as any), items: [{ qty: -1, unit_price: .2 }] };
  expect(invoiceSaveOutcome(await billing.saveDoc(invalid).catch(error => error))).toBe("rejected");
  expect(cloud.rpc).not.toHaveBeenCalled();
  cloud.rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "Invalid invoice" } });
  expect(invoiceSaveOutcome(await billing.saveDoc(recoveryInvoice()).catch(error => error))).toBe("rejected");
  expect(await billing.pendingInvoiceSaves()).toEqual([]);
  cloud.rpc.mockResolvedValueOnce({ data: null, error: { code: "57014", message: "Statement timed out" } });
  expect(invoiceSaveOutcome(await billing.saveDoc(recoveryInvoice()).catch(error => error))).toBe("unconfirmed");
  expect(await billing.pendingInvoiceSaves()).toHaveLength(1);
});

it("reconciles only an exact fresh invoice with its matching committed receipt, leaving missing or changed outcomes pending", async () => {
  vi.spyOn(billing, "getCompany").mockResolvedValue({ name: "Fixture", country_code: "AE" } as never);
  cloud.rpc.mockRejectedValueOnce(new Error("Response lost after commit"));
  await expect(billing.saveDoc(recoveryInvoice())).rejects.toThrow("Response lost");
  const [pending] = await billing.pendingInvoiceSaves();
  let receipt: any = null;
  const query: any = { select: vi.fn(() => query), eq: vi.fn(() => query), maybeSingle: vi.fn(async () => ({ data: receipt, error: null })) };
  cloud.from.mockReturnValue(query);
  expect(await billing.readPendingInvoiceSave(pending.requestId)).toBeNull();
  expect(await billing.pendingInvoiceSaves()).toHaveLength(1);
  receipt = { action: "invoice:save", payload: cloud.rpc.mock.calls[0][1].p_payload, result: { id: 7 } };
  const doc = { ...pending.input, id: 7 };
  const read = vi.spyOn(billing, "getDoc").mockResolvedValue({ ...doc, items: [{ ...doc.items[0], unit_price: 200 }] } as never);
  expect(await billing.readPendingInvoiceSave(pending.requestId)).toBeNull();
  expect(await billing.pendingInvoiceSaves()).toHaveLength(1);
  read.mockResolvedValue(doc as never);
  expect(await billing.readPendingInvoiceSave(pending.requestId)).toEqual(doc);
  expect(read).toHaveBeenLastCalledWith(7, true);
  expect(query.eq).toHaveBeenCalledWith("user_id", actor);
  expect(query.eq).toHaveBeenCalledWith("org_id", "workspace-a");
  expect(await billing.pendingInvoiceSaves()).toEqual([]);
  expect(cloud.rpc).toHaveBeenCalledOnce();
});
