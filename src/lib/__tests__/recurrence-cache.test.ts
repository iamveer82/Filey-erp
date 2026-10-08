import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";

const cloud = vi.hoisted(() => ({ read: vi.fn(), generate: vi.fn(), changed: vi.fn() }));
vi.mock("../moduleAccess", () => ({ loadModuleAccess: async () => ({ admin: true, modules: null }) }));
vi.mock("../realtime", () => ({ notifyDataChanged: cloud.changed }));
vi.mock("../recurrenceGeneration", () => ({ generateRecurringInvoice: cloud.generate }));
vi.mock("../supabase", () => ({
  isConfigured: true, supabase: null,
  sb: () => ({ from: (table: string) => {
    const query = {
      select: () => query, eq: () => query, order: () => query, range: () => query, maybeSingle: () => query,
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => cloud.read(table).then(resolve, reject),
    };
    return query;
  } }),
}));
import { billing, recurrences, setCacheOrg } from "../api";

const due = (id = 1) => ({ id, active: true, next_run: "2026-01-01", interval: "monthly", base_invoice_id: id });
const company = { data: { id: 1, name: "Cached company", logo: "data:image/png;base64,fixture" }, error: null };
let schedules: ReturnType<typeof due>[];
let invoiceNumber: string;

beforeEach(() => {
  localStorage.clear(); localStorage.setItem("filey_data_mode", "cloud");
  setCacheOrg(null); setCacheOrg("recurrence-cache-org", "owner");
  schedules = []; invoiceNumber = "Before generation";
  cloud.changed.mockReset(); cloud.generate.mockReset().mockResolvedValue(true);
  cloud.read.mockReset().mockImplementation(async (table: string) => {
    if (table === "company_profile") return company;
    if (table === "invoice_recurrence") return { data: schedules, error: null };
    if (table === "invoice_docs") return { data: [{ id: 1, number: invoiceNumber, status: "draft" }], error: null };
    return { data: [], error: null };
  });
});
afterEach(() => { vi.restoreAllMocks(); setCacheOrg(null); });

it.each(["empty", "future"])("keeps company and invoice caches fresh after an %s recurrence scan", async kind => {
  if (kind === "future") schedules = [{ ...due(), next_run: "2999-01-01" }];
  const before = await billing.getCompany();
  await billing.listDocs();
  const companyReads = cloud.read.mock.calls.filter(([table]) => table === "company_profile").length;
  const invoiceReads = cloud.read.mock.calls.filter(([table]) => table === "invoice_docs").length;
  expect(await recurrences.generateDue()).toBe(0);
  expect(await billing.getCompany()).toEqual(before);
  await billing.listDocs();
  expect(cloud.read.mock.calls.filter(([table]) => table === "company_profile")).toHaveLength(companyReads);
  expect(cloud.read.mock.calls.filter(([table]) => table === "invoice_docs")).toHaveLength(invoiceReads);
  expect(cloud.generate).not.toHaveBeenCalled();
  expect(cloud.changed).not.toHaveBeenCalled();
});

it("does not discard a company response that was already loading when an empty scan finished", async () => {
  let release!: (value: typeof company) => void;
  cloud.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const loading = billing.getCompany();
  await waitFor(() => expect(cloud.read).toHaveBeenCalledWith("company_profile"));
  expect(await recurrences.generateDue()).toBe(0);
  release(company);
  expect((await loading).name).toBe("Cached company");
  expect(cloud.read.mock.calls.filter(([table]) => table === "company_profile")).toHaveLength(1);
  expect(cloud.changed).not.toHaveBeenCalled();
});

it.each(["created", "retired", "unconfirmed", "partial"])("refreshes invoice snapshots after a %s generation attempt", async outcome => {
  schedules = outcome === "partial" ? [due(1), due(2)] : [due()];
  expect((await billing.listDocs())[0].number).toBe("Before generation");
  if (outcome === "retired") cloud.generate.mockResolvedValue(false);
  if (outcome === "unconfirmed") cloud.generate.mockRejectedValue(new Error("Response lost"));
  if (outcome === "partial") cloud.generate.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error("Response lost"));
  if (outcome === "unconfirmed" || outcome === "partial") await expect(recurrences.generateDue()).rejects.toThrow("Response lost");
  else expect(await recurrences.generateDue()).toBe(outcome === "created" ? 1 : 0);
  invoiceNumber = "After generation attempt";
  expect((await billing.listDocs())[0].number).toBe("After generation attempt");
  expect(cloud.generate).toHaveBeenCalledTimes(outcome === "partial" ? 2 : 1);
  expect(cloud.changed).toHaveBeenCalledOnce();
  expect(cloud.read.mock.calls.filter(([table]) => table === "invoice_docs")).toHaveLength(2);
});

it("does not invalidate cache when scanning schedules fails before a write attempt", async () => {
  await billing.getCompany();
  cloud.read.mockResolvedValueOnce({ data: null, error: new Error("Schedule read failed") });
  await expect(recurrences.generateDue()).rejects.toThrow("Schedule read failed");
  expect((await billing.getCompany()).name).toBe("Cached company");
  expect(cloud.read.mock.calls.filter(([table]) => table === "company_profile")).toHaveLength(1);
  expect(cloud.generate).not.toHaveBeenCalled();
  expect(cloud.changed).not.toHaveBeenCalled();
});
