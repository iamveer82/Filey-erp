import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cloud = vi.hoisted(() => ({ rpc: vi.fn(), changed: vi.fn() }));
vi.mock("../supabase", () => ({ isConfigured: true, supabase: null, sb: () => ({ rpc: cloud.rpc }) }));
vi.mock("../realtime", () => ({ notifyDataChanged: cloud.changed }));
vi.mock("../documentNumbers", () => ({ allocateDocumentNumber: async () => "TEST-DOCUMENT-1" }));
import { billing, crm, erp, pos, quotes, setCacheOrg, suppliers } from "../api";
import { runTool } from "../aiTools";
import { setAgentMode } from "../agentMode";
import { setDataMode } from "../dataMode";
import { coachResult, createGuard } from "../agentGuard";

beforeEach(() => {
  localStorage.clear();
  setDataMode("cloud");
  setCacheOrg("document-receipt-org", "document-receipt-user");
  setAgentMode("auto");
  cloud.rpc.mockReset();
  cloud.changed.mockClear();
  vi.spyOn(billing, "getCompany").mockResolvedValue({ country_code: "AE" } as never);
  vi.spyOn(crm, "customers").mockResolvedValue([]);
  vi.spyOn(suppliers, "list").mockResolvedValue([]);
  vi.spyOn(erp, "products").mockResolvedValue([]);
  vi.spyOn(quotes, "listDocs").mockResolvedValue([]);
  vi.spyOn(pos, "list").mockResolvedValue([]);
});

afterEach(() => { vi.restoreAllMocks(); setCacheOrg(null); });

const draft = (id?: number) => ({
  ...(id === undefined ? {} : { id }), number: "QT-RECEIPT", status: "draft", template: "minimal",
  currency: "AED", tax_country_code: "AE", customer_name: "Fixture Customer", quote_date: "2026-10-05",
  items: [{ product: "Fixture service", qty: 2, rate: 10, discount: 0, tax: 0 }],
} as never);

describe("cloud document acknowledgement boundary", () => {
  it.each([42, "42"])("returns only a confirmed quotation record ID (%s)", async data => {
    cloud.rpc.mockResolvedValue({ data, error: null });
    expect(await quotes.saveDoc(draft())).toBe(42);
    expect(cloud.rpc).toHaveBeenCalledExactlyOnceWith("filey_save_document", expect.objectContaining({ p_table: "quotations", p_id: null }));
    expect(cloud.changed).toHaveBeenCalledOnce();
  });

  it.each([null, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, true, [], [42], {}, "", " ", "not-an-id"].map(data => ({ data })))(
    "rejects an invalid quotation acknowledgement without replaying ($data)", async ({ data }) => {
      cloud.rpc.mockResolvedValue({ data, error: null });
      await expect(quotes.saveDoc(draft())).rejects.toThrow(/save could not be confirmed/i);
      expect(cloud.rpc).toHaveBeenCalledOnce();
      expect(cloud.changed).not.toHaveBeenCalled();
    },
  );

  it("rejects a valid-looking ID for a different updated quotation", async () => {
    cloud.rpc.mockResolvedValue({ data: 43, error: null });
    await expect(quotes.saveDoc(draft(42))).rejects.toThrow(/save could not be confirmed/i);
    expect(cloud.rpc).toHaveBeenCalledOnce();
    expect(cloud.rpc.mock.calls[0][1]).toMatchObject({ p_id: 42 });
  });
});

describe("agent document save outcomes", () => {
  const specs = [
    { name: "create_quote", args: { customer_name: "Fixture Customer", items: [{ description: "Fixture service", qty: 2, rate: 10 }] }, mockSave: () => vi.spyOn(quotes, "saveDoc") },
    { name: "create_purchase_order", args: { supplier_name: "Fixture Supplier", items: [{ description: "Fixture service", qty: 2, unit_price: 10 }] }, mockSave: () => vi.spyOn(pos, "save") },
  ];

  it.each(specs)("returns the saved record ID for $name", async spec => {
    setDataMode("local");
    const save = spec.mockSave().mockResolvedValue(42);
    expect(await runTool(spec.name, spec.args)).toMatchObject({ ok: true, id: 42, number: "TEST-DOCUMENT-1", total: 20 });
    expect(save).toHaveBeenCalledOnce();
  });

  it.each(specs)("does not claim success or encourage a retry for an unconfirmed $name", async spec => {
    setDataMode("local");
    const save = spec.mockSave().mockResolvedValue(0);
    const result = await runTool(spec.name, spec.args);
    expect(result).toMatchObject({ error: expect.stringMatching(/save could not be confirmed/i), retry_safe: false });
    expect(result).not.toHaveProperty("ok", true);
    expect(coachResult(result, 10)).toEqual(result);
    const guard = createGuard(`Create a ${spec.name === "create_quote" ? "quote" : "purchase order"}.`);
    guard.after(spec.name, spec.args, result);
    expect(guard.before(spec.name, spec.args).short).toMatchObject({ retry_safe: false });
    expect(save).toHaveBeenCalledOnce();
  });

  it.each(specs)("treats a lost $name acknowledgement as uncertain without another save", async spec => {
    setDataMode("local");
    const save = spec.mockSave().mockRejectedValue(new Error("Document response lost"));
    expect(await runTool(spec.name, spec.args)).toMatchObject({ error: "Document response lost", retry_safe: false });
    expect(save).toHaveBeenCalledOnce();
  });
});
