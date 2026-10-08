import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";

const cloud = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), access: { admin: true, modules: null as string[] | null } }));
vi.mock("../moduleAccess", () => ({ loadModuleAccess: async () => ({ ...cloud.access }) }));
vi.mock("../supabase", () => ({
  isConfigured: true, supabase: null,
  sb: () => ({ from: () => {
    let writing = false;
    const q = {
      select: () => q, single: () => q, order: () => q, range: () => q, eq: () => q,
      update: () => { writing = true; return q; },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => (writing ? cloud.write() : cloud.read()).then(resolve, reject),
    };
    return q;
  } }),
}));
import { billing, erp, setCacheOrg } from "../api";

const result = (name: string) => ({ data: [{ id: 1, name }], error: null });
beforeEach(() => {
  localStorage.clear(); localStorage.setItem("filey_data_mode", "cloud");
  setCacheOrg(null); setCacheOrg("org", "alice");
  cloud.read.mockReset(); cloud.write.mockReset().mockResolvedValue({ data: { id: 1 }, error: null });
  cloud.access = { admin: true, modules: null };
  cloud.read.mockResolvedValue(result("Current"));
});
afterEach(() => vi.restoreAllMocks());

it("shares simultaneous list reads and serves a fresh snapshot without another network call", async () => {
  const rows = await Promise.all(Array.from({ length: 8 }, () => erp.products()));
  expect(cloud.read).toHaveBeenCalledTimes(1);
  expect(rows.every(row => row[0].name === "Current")).toBe(true);
  await erp.products();
  expect(cloud.read).toHaveBeenCalledTimes(1);
});

it.each([null, ["inventory"]])("does not reuse admin-only rows after a downgrade to staff (modules: %j)", async modules => {
  cloud.read.mockResolvedValue(result("Private teammate record"));
  await erp.products();
  cloud.access = { admin: false, modules };
  cloud.read.mockResolvedValue(result("Staff visible record"));
  expect((await erp.products())[0].name).toBe("Staff visible record");
  expect(cloud.read).toHaveBeenCalledTimes(2);
  cloud.read.mockResolvedValue({ data: null, error: { message: "Access denied", code: "42501" } });
  await expect(erp.products()).rejects.toMatchObject({ message: "Access denied" });
});

it("requires a fresh acknowledged product read for reconciliation and never falls back to a saved snapshot", async () => {
  await erp.products();
  cloud.read.mockResolvedValue(result("Reconciled stock"));
  expect((await erp.products({ fresh: true }))[0].name).toBe("Reconciled stock");
  expect(cloud.read).toHaveBeenCalledTimes(2);
  cloud.read.mockRejectedValue(new Error("Connection lost"));
  await expect(erp.products({ fresh: true })).rejects.toThrow("Connection lost");
});

it("never uses an invoice snapshot as proof of a save when a fresh reconciliation read fails", async () => {
  cloud.read.mockResolvedValueOnce({ data: { id: 7, number: "INV-7", status: "draft" }, error: null })
    .mockResolvedValueOnce({ data: [{ invoice_id: 7, description: "Oil", qty: 2, unit_price: 10 }], error: null });
  expect((await billing.getDoc(7, false)).items).toHaveLength(1);
  cloud.read.mockRejectedValue(new Error("Invoice connection lost"));
  await expect(billing.getDoc(7, true)).rejects.toThrow("Invoice connection lost");
  cloud.read.mockResolvedValue({ data: [], error: null });
  expect(await billing.listDocs("sales")).toEqual([]);
  cloud.read.mockRejectedValue(new Error("Invoice list connection lost"));
  await expect(billing.listDocs("sales", true)).rejects.toThrow("Invoice list connection lost");
});

async function cacheOldInvoice() {
  cloud.read.mockResolvedValueOnce({ data: { id: 7, number: "INV-047", issue_date: "2026-10-08", status: "draft" }, error: null })
    .mockResolvedValueOnce({ data: [{ invoice_id: 7, description: "Old invoice line", qty: 2, unit_price: 10 }], error: null });
  await billing.getDoc(7, false);
  expect((await billing.getDoc(7, false)).number).toBe("INV-047");
  expect(cloud.read).toHaveBeenCalledTimes(2);
}

it("opens the latest invoice by default even when its cloud detail snapshot predates a remote edit", async () => {
  await cacheOldInvoice();
  cloud.read.mockResolvedValueOnce({ data: { id: 7, number: "INV-029", issue_date: "2026-09-23", status: "sent" }, error: null })
    .mockResolvedValueOnce({ data: [{ invoice_id: 7, description: "Updated invoice line", qty: 3, unit_price: 20 }], error: null });
  const invoice = await billing.getDoc(7);
  expect(invoice).toMatchObject({ id: 7, number: "INV-029", issue_date: "2026-09-23", status: "sent", items: [
    { description: "Updated invoice line", qty: 3, unit_price: 20 },
  ] });
  expect(cloud.read).toHaveBeenCalledTimes(4);
});

it("rejects a failed default invoice read instead of opening a stale editable snapshot", async () => {
  await cacheOldInvoice();
  cloud.read.mockRejectedValue(new Error("Latest invoice unavailable"));
  await expect(billing.getDoc(7)).rejects.toThrow("Latest invoice unavailable");
  expect(cloud.read).toHaveBeenCalledTimes(3);
});

it("keeps local invoice reads on their source even when cached reads are explicitly requested", async () => {
  await cacheOldInvoice();
  localStorage.setItem("filey_data_mode", "local");
  for (const fresh of [undefined, false]) {
    cloud.read.mockResolvedValueOnce({ data: { id: 7, number: "LOCAL-029", status: "draft" }, error: null })
      .mockResolvedValueOnce({ data: [{ invoice_id: 7, description: "Local invoice line", qty: 4, unit_price: 5 }], error: null });
    expect(await billing.getDoc(7, fresh)).toMatchObject({ number: "LOCAL-029", items: [{ description: "Local invoice line", qty: 4 }] });
  }
  expect(cloud.read).toHaveBeenCalledTimes(6);
});

it.each(["cloud", "local"])("rejects a fresh %s product read after an account switch without caching the old result", async mode => {
  localStorage.setItem("filey_data_mode", mode);
  let release!: (value: ReturnType<typeof result>) => void;
  cloud.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const reading = erp.products({ fresh: true });
  const rejection = expect(reading).rejects.toThrow("workspace changed");
  await waitFor(() => expect(cloud.read).toHaveBeenCalledOnce());
  setCacheOrg("other-org", "bob");
  release(result("Previous workspace stock"));
  await rejection;
  expect((await erp.products())[0].name).toBe("Current");
});

it("rejects a fresh cloud product read after switching to local mode", async () => {
  let release!: (value: ReturnType<typeof result>) => void;
  cloud.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const reading = erp.products({ fresh: true });
  const rejection = expect(reading).rejects.toThrow("workspace changed");
  await waitFor(() => expect(cloud.read).toHaveBeenCalledOnce());
  localStorage.setItem("filey_data_mode", "local");
  release(result("Previous cloud stock"));
  await rejection;
  expect((await erp.products())[0].name).toBe("Current");
});

it("an old in-flight response cannot overwrite a completed save, even in the same millisecond", async () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.now());
  let release!: (value: ReturnType<typeof result>) => void;
  cloud.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const oldRead = erp.products();
  await waitFor(() => expect(cloud.read).toHaveBeenCalledTimes(1));
  await erp.updateProduct(1, { name: "Saved" });
  cloud.read.mockResolvedValue(result("Saved"));
  const current = await erp.products();
  release(result("Old"));
  expect((await oldRead)[0].name).toBe("Saved");
  expect(current[0].name).toBe("Saved");
  expect((await erp.products())[0].name).toBe("Saved");
  expect(cloud.read).toHaveBeenCalledTimes(2);
});

it("rejects a late response across sign-out/sign-in and never stores it for the next session", async () => {
  let release!: (value: ReturnType<typeof result>) => void;
  cloud.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const oldRead = erp.products();
  const rejection = expect(oldRead).rejects.toThrow("workspace changed");
  await waitFor(() => expect(cloud.read).toHaveBeenCalledTimes(1));
  setCacheOrg(null); setCacheOrg("org", "alice");
  release(result("Previous session"));
  await rejection;
  expect((await erp.products())[0].name).toBe("Current");
});

it("invalidates fresh snapshots when another client changes data", async () => {
  await erp.products();
  cloud.read.mockResolvedValue(result("Remote update"));
  window.dispatchEvent(new Event("filey:cloud-change"));
  expect((await erp.products())[0].name).toBe("Remote update");
  expect(cloud.read).toHaveBeenCalledTimes(2);
});

it("keeps unrelated snapshots fresh and only reloads the changed table", async () => {
  await erp.products(); await erp.orders();
  expect(cloud.read).toHaveBeenCalledTimes(2);
  window.dispatchEvent(new CustomEvent("filey:cloud-change", { detail: { tables: ["notifications"] } }));
  await erp.products(); await erp.orders();
  expect(cloud.read).toHaveBeenCalledTimes(2);
  window.dispatchEvent(new CustomEvent("filey:cloud-change", { detail: { tables: ["products"] } }));
  await erp.products(); await erp.orders();
  expect(cloud.read).toHaveBeenCalledTimes(3);
});
