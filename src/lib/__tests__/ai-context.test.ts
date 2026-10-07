import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAiContext, clearAiContextCache } from "../aiContext";
import { setDataMode } from "../dataMode";
import { billing, crm, erp, quotes, setCacheOrg } from "../api";
import { setDisplayCurrency } from "../format";
import { loadModuleAccess } from "../moduleAccess";

vi.mock("../moduleAccess", async original => ({ ...await original<typeof import("../moduleAccess")>(), loadModuleAccess: vi.fn(async () => ({ admin: true, modules: null })) }));

beforeEach(async () => {
  localStorage.clear();
  clearAiContextCache();
  setDataMode("local");
  setCacheOrg("brief-test", "fixture-user");
  setDisplayCurrency("AED");
  vi.mocked(loadModuleAccess).mockReset().mockResolvedValue({ admin: true, modules: null });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); clearAiContextCache(); setCacheOrg(null); setDisplayCurrency("AED"); });

function mockBriefReads() {
  const customers = vi.spyOn(crm, "customers").mockResolvedValue([]);
  vi.spyOn(billing, "listDocs").mockResolvedValue([]);
  vi.spyOn(erp, "products").mockResolvedValue([]);
  vi.spyOn(quotes, "listDocs").mockResolvedValue([]);
  vi.spyOn(erp, "orders").mockResolvedValue([]);
  const company = vi.spyOn(billing, "getCompany").mockResolvedValue({ name: "Fixture company" } as Awaited<ReturnType<typeof billing.getCompany>>);
  return { customers, company };
}

describe("the business brief", () => {
  it("releases a stopped chat while a record fetch is stalled and ignores its late result", async () => {
    const { customers, company } = mockBriefReads();
    let finish!: (rows: Awaited<ReturnType<typeof crm.customers>>) => void;
    customers.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const controller = new AbortController();
    const pending = buildAiContext(undefined, controller.signal);
    await vi.waitFor(() => expect(customers).toHaveBeenCalledOnce());
    const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejection;
    finish([]);
    await Promise.resolve(); await Promise.resolve();
    expect(company).not.toHaveBeenCalled();
    expect(await buildAiContext()).toContain("Fixture company");
    expect(customers).toHaveBeenCalledTimes(2);
  });

  it("bounds the optional snapshot and explicitly describes unavailable data", async () => {
    vi.useFakeTimers();
    mockBriefReads().customers.mockReturnValueOnce(new Promise(() => {}));
    const pending = buildAiContext();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await pending).toContain("missing data is unknown, not empty");
    expect(vi.getTimerCount()).toBe(0);
    const controller = new AbortController(); controller.abort();
    await expect(buildAiContext(undefined, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("states identity the agent would otherwise guess", async () => {
    await billing.saveCompany({
      name: "Rennox Trading",
      trn: "100123456700003",
      default_tax_rate: 5,
      default_accent: "#FFD600",
      default_template: "minimal",
    });
    clearAiContextCache();

    const brief = await buildAiContext();
    expect(brief).toContain("Rennox Trading");
    expect(brief).toContain("TRN 100123456700003");
    // A guessed tax rate on a tax invoice is the expensive kind of wrong.
    expect(brief).toContain("default VAT 5%");
  });

  it("names what is outstanding, not just how many invoices exist", async () => {
    await crm.createCustomer({ name: "Acme" });
    await billing.saveDoc({
      number: "INV-1",
      status: "sent",
      template: "minimal",
      accent: "#FFD600",
      currency: "AED",
      seller_name: "Rennox Trading",
      customer_name: "Acme",
      issue_date: "2026-01-01",
      due_date: "2026-01-15",
      tax_rate: 0,
      discount: 0,
      items: [{ description: "Widget", qty: 1, unit_price: 500 }],
    });
    clearAiContextCache();

    const brief = await buildAiContext();
    expect(brief).toMatch(/Invoices: 1 total/);
    expect(brief).toMatch(/outstanding/);
  });

  it("points at the tools rather than at the user", async () => {
    const brief = await buildAiContext();
    // It used to end by telling the model to ask the user to open a page —
    // written before the agent could look anything up itself.
    expect(brief).not.toMatch(/open the relevant page/i);
    expect(brief).toMatch(/use the find\/list tools/i);
  });

  it("stays small enough to sit in every system prompt", async () => {
    for (let i = 0; i < 40; i++) await crm.createCustomer({ name: `Customer ${i}` });
    clearAiContextCache();

    const brief = await buildAiContext();
    // Counts are exact, examples are capped — 40 customers must not mean 40
    // lines of prompt on every single turn.
    expect(brief).toContain("Customers: 40");
    expect(brief.length).toBeLessThan(4000);
  });

  it("serves a repeat call from the memo instead of re-reading five tables", async () => {
    await crm.createCustomer({ name: "First" });
    const one = await buildAiContext();
    await crm.createCustomer({ name: "Second" });
    expect(await buildAiContext()).toBe(one); // within the window
    clearAiContextCache();
    expect(await buildAiContext()).not.toBe(one);
  });

  it("never reuses another account or store's brief and refreshes display currency", async () => {
    const { customers } = mockBriefReads();
    customers.mockResolvedValue([{ name: "Private Alpha customer" }] as Awaited<ReturnType<typeof crm.customers>>);
    const first = await buildAiContext();
    expect(await buildAiContext()).toBe(first);
    expect(customers).toHaveBeenCalledTimes(1);
    setCacheOrg("other-org", "other-user");
    customers.mockResolvedValue([{ name: "Beta customer" }] as Awaited<ReturnType<typeof crm.customers>>);
    const second = await buildAiContext();
    expect(second).toContain("Beta customer");
    expect(second).not.toContain("Private Alpha");
    setDataMode("cloud");
    await buildAiContext();
    expect(customers).toHaveBeenCalledTimes(3);
    setDisplayCurrency("INR");
    expect(await buildAiContext()).toContain("display currency INR");
    expect(customers).toHaveBeenCalledTimes(4);
  });

  it("discards a pending old-workspace read before loading another company's identity", async () => {
    const { customers, company } = mockBriefReads();
    let finish!: (value: Awaited<ReturnType<typeof crm.customers>>) => void;
    customers.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = buildAiContext();
    await vi.waitFor(() => expect(customers).toHaveBeenCalled());
    setCacheOrg("next-org", "next-user");
    const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    finish([{ name: "Private old customer" }] as Awaited<ReturnType<typeof crm.customers>>);
    await rejection;
    expect(company).not.toHaveBeenCalled();
    customers.mockResolvedValue([{ name: "Current customer" }] as Awaited<ReturnType<typeof crm.customers>>);
    const current = await buildAiContext();
    expect(current).toContain("Current customer");
    expect(current).not.toContain("Private old customer");
  });

  it("does not read business records without an attributed account", async () => {
    const { customers, company } = mockBriefReads();
    setCacheOrg(null);
    expect(await buildAiContext()).toContain("unavailable until the user signs in");
    expect(customers).not.toHaveBeenCalled();
    expect(company).not.toHaveBeenCalled();
  });

  it("rechecks permissions before serving a memo and drops cached records after same-account access is revoked", async () => {
    const { customers } = mockBriefReads();
    customers.mockResolvedValue([{ name: "Previously accessible customer" }] as Awaited<ReturnType<typeof crm.customers>>);
    expect(await buildAiContext()).toContain("Previously accessible customer");
    vi.mocked(loadModuleAccess).mockResolvedValue({ admin: false, modules: ["inventory"] });
    const restricted = await buildAiContext();
    expect(restricted).not.toContain("Previously accessible customer");
    expect(restricted).toContain("customers (workspace access restricted)");
    expect(restricted).toContain("invoices (workspace access restricted)");
    expect(customers).toHaveBeenCalledTimes(1);
    expect(erp.products).toHaveBeenCalledTimes(2);
    expect(loadModuleAccess).toHaveBeenCalledTimes(4);
    expect(await buildAiContext()).toBe(restricted);
    expect(loadModuleAccess).toHaveBeenCalledTimes(6);
    expect(erp.products).toHaveBeenCalledTimes(3);
  });

  it("refreshes staff briefs through RLS even when allowed modules stay unchanged", async () => {
    const { customers } = mockBriefReads();
    vi.mocked(loadModuleAccess).mockResolvedValue({ admin: false, modules: null });
    customers.mockResolvedValueOnce([{ name: "Previously shared customer" }] as Awaited<ReturnType<typeof crm.customers>>);
    expect(await buildAiContext()).toContain("Previously shared customer");
    customers.mockResolvedValue([]);
    expect(await buildAiContext()).not.toContain("Previously shared customer");
    expect(customers).toHaveBeenCalledTimes(2);
  });

  it("discards an in-flight brief when same-account permissions change before it can reach the model", async () => {
    const { customers } = mockBriefReads();
    let finish!: (value: Awaited<ReturnType<typeof crm.customers>>) => void;
    customers.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = buildAiContext();
    await vi.waitFor(() => expect(customers).toHaveBeenCalled());
    vi.mocked(loadModuleAccess).mockResolvedValue({ admin: false, modules: ["inventory"] });
    const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    finish([{ name: "Private pre-revocation customer" }] as Awaited<ReturnType<typeof crm.customers>>);
    await rejection;
    expect(await buildAiContext()).not.toContain("Private pre-revocation customer");
  });

  it("refuses a cached brief when current workspace permissions cannot be verified", async () => {
    const { customers } = mockBriefReads();
    customers.mockResolvedValue([{ name: "Private cached customer" }] as Awaited<ReturnType<typeof crm.customers>>);
    await buildAiContext();
    vi.mocked(loadModuleAccess).mockRejectedValueOnce(new Error("Workspace permissions could not be verified."));
    await expect(buildAiContext()).rejects.toThrow("permissions could not be verified");
    expect(customers).toHaveBeenCalledTimes(1);
  });

  it("keeps invoice currencies separate and converts AED product prices instead of relabelling them", async () => {
    mockBriefReads();
    vi.mocked(billing.listDocs).mockResolvedValue([
      { number: "AED-old", balance: 100, status: "sent", due_date: "2000-01-01" },
      { number: "USD-1", currency: "USD", balance: 100, status: "sent", due_date: "2000-01-01" },
      { number: "Draft-not-owed", currency: "USD", balance: 999, status: "draft", due_date: "2000-01-01" },
      { number: "Cancelled-not-owed", currency: "USD", balance: 888, status: "cancelled", due_date: "2000-01-01" },
    ] as Awaited<ReturnType<typeof billing.listDocs>>);
    vi.mocked(erp.products).mockResolvedValue([{ name: "AED product", unit_price: 10 }] as Awaited<ReturnType<typeof erp.products>>);
    setDisplayCurrency("USD", 3.6725);
    const brief = (await buildAiContext()).replace(/\u00a0/g, " ");
    expect(brief).toContain("AED 100.00 + $100.00 outstanding (separate currencies");
    expect(brief).toContain("AED-old —  — AED 100.00 due");
    expect(brief).toContain("AED product ($2.72)");
    expect(brief).toContain("Invoices: 4 total · 2 unpaid · 2 overdue");
    expect(brief).not.toContain("Draft-not-owed");
    expect(brief).not.toContain("Cancelled-not-owed");
    expect(brief).not.toContain("$200.00 outstanding");
  });
});
