import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { billing, crm, erp, pos, quotes, receipts, setCacheOrg, suppliers, tools as settings } from "../api";
import { runTool } from "../aiTools";
import { setAgentMode } from "../agentMode";
import { setDataMode } from "../dataMode";
import { setDisplayCurrency } from "../format";
import * as documentNumbers from "../documentNumbers";
import * as moduleAccess from "../moduleAccess";

beforeEach(() => {
  localStorage.clear();
  setCacheOrg("currency-test-org", "currency-test-user");
  setAgentMode("auto");
  setDisplayCurrency("USD", 3.6725);
  vi.spyOn(moduleAccess, "requireToolModuleAccess").mockResolvedValue();
  vi.spyOn(documentNumbers, "allocateDocumentNumber").mockResolvedValue("TEST-DOC-1");
  vi.spyOn(settings, "settings").mockResolvedValue([]);
  vi.spyOn(billing, "getCompany").mockResolvedValue({ name: "Fixture Company", currency: "AED", default_tax_rate: 0 } as never);
  vi.spyOn(billing, "pendingInvoiceSaves").mockResolvedValue([]);
  vi.spyOn(billing, "listDocs").mockResolvedValue([]);
  vi.spyOn(crm, "customers").mockResolvedValue([]);
  vi.spyOn(suppliers, "list").mockResolvedValue([]);
  vi.spyOn(erp, "products").mockResolvedValue([]);
  vi.spyOn(quotes, "listDocs").mockResolvedValue([]);
  vi.spyOn(pos, "list").mockResolvedValue([]);
  vi.spyOn(receipts, "list").mockResolvedValue([]);
});

afterEach(() => { vi.restoreAllMocks(); setDisplayCurrency("AED"); setCacheOrg(null); });

const line = { description: "Fixture service", qty: 2, unit_price: 100 };
const drafts = [
  { name: "create_invoice_draft", args: { customer_name: "Fixture customer", items: [line] }, save: () => vi.spyOn(billing, "saveDoc"), savedLine: { qty: 2, unit_price: 100 } },
  { name: "create_purchase_invoice_draft", args: { supplier_name: "Fixture supplier", items: [line] }, save: () => vi.spyOn(billing, "saveDoc"), savedLine: { qty: 2, unit_price: 100 } },
  { name: "create_quote", args: { customer_name: "Fixture customer", items: [{ description: line.description, qty: 2, rate: 100 }] }, save: () => vi.spyOn(quotes, "saveDoc"), savedLine: { qty: 2, rate: 100 } },
  { name: "create_purchase_order", args: { supplier_name: "Fixture supplier", items: [line] }, save: () => vi.spyOn(pos, "save"), savedLine: { quantity: 2, unit_cost: 100 } },
];

describe.each(["local", "cloud"] as const)("agent document currency in %s mode", mode => {
  it.each(drafts.slice(0, 2))("snapshots fresh company seller details for $name", async spec => {
    setDataMode(mode);
    vi.mocked(billing.getCompany).mockImplementation(async fresh => ({ name: "Fixture Company", currency: "AED", default_tax_rate: 0,
      ...(fresh ? { city: "Dubai", country_subdivision: "DXB", legal_id: "TL-CURRENT", legal_id_type: "TL", email: "current@example.test",
        einvoice: { tin: "1001234567", legal_authority: "Dubai Economy" } } : {}),
    } as never));
    const save = spec.save().mockResolvedValue(81);
    expect(await runTool(spec.name, spec.args)).toMatchObject({ ok: true });
    expect(save.mock.calls[0][0]).toMatchObject({ seller_city: "Dubai", seller_country_subdivision: "DXB", seller_legal_id: "TL-CURRENT",
      seller_email: "current@example.test", einvoice: { seller: { tin: "1001234567", legal_authority: "Dubai Economy" } } });
  });

  it.each(drafts)("uses the company currency for $name without converting or relabeling entered rates", async spec => {
    setDataMode(mode);
    const save = spec.save().mockResolvedValue(81);
    expect(await runTool(spec.name, spec.args)).toMatchObject({ ok: true, currency: "AED" });
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][0]).toMatchObject({ currency: "AED", items: [spec.savedLine] });
  });

  it.each(drafts)("honors an explicit currency for $name", async spec => {
    setDataMode(mode);
    const save = spec.save().mockResolvedValue(81);
    expect(await runTool(spec.name, { ...spec.args, currency: "EUR" })).toMatchObject({ ok: true, currency: "EUR" });
    expect(save.mock.calls[0][0]).toMatchObject({ currency: "EUR", items: [spec.savedLine] });
  });

  it("uses the same company currency contract for payment receipts", async () => {
    setDataMode(mode);
    const save = vi.spyOn(receipts, "save").mockResolvedValue(81);
    expect(await runTool("create_payment_receipt", { customer_name: "Fixture customer", amount: 200 }, () => true)).toMatchObject({ ok: true, amount: 200, currency: "AED" });
    expect(save.mock.calls[0][0]).toMatchObject({ currency: "AED", amount: 200 });
  });
});
