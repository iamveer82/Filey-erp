import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { billing, setCacheOrg } from "../api";
import { runTool } from "../aiTools";
import { offeredTools } from "../agentHarness";
import { setAgentMode } from "../agentMode";
import { setCapabilityEnabled } from "../capabilities";
import { setDataMode } from "../dataMode";
import { supabase } from "../supabase";

vi.mock("../supabase", () => ({ supabase: { rpc: vi.fn() } }));

beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
  setCacheOrg("test-org", "test-user");
});
afterEach(() => vi.restoreAllMocks());

it("finds older invoices before paginating while preserving the default summary array", async () => {
  const docs = Array.from({ length: 45 }, (_, index) => ({
    id: index + 1, number: `INV-${index + 1}`, customer_name: index >= 35 ? "Mary Studio" : "Mark Studio",
    total: index + 100, balance: index + 100, status: index % 2 ? "draft" : "sent", currency: "AED",
  }));
  vi.spyOn(billing, "listDocs").mockResolvedValue(docs as never);
  const defaultPage = await runTool("list_invoices", {}) as typeof docs;
  expect(defaultPage).toHaveLength(30);
  expect(defaultPage[0]).toMatchObject({ id: 1, number: "INV-1" });
  const secondPage = await runTool("list_invoices", { offset: 30 }) as typeof docs;
  expect(secondPage).toHaveLength(15);
  expect(secondPage[0]).toMatchObject({ id: 31 });
  const filtered = await runTool("list_invoices", { query: " MARY ", status: "draft", limit: 2, offset: 1 });
  expect(filtered).toEqual([expect.objectContaining({ id: 38 }), expect.objectContaining({ id: 40 })]);
  expect(await runTool("list_invoices", { query: "INV-45" })).toEqual([expect.objectContaining({ id: 45 })]);
});

it("reads persisted lines and pricing after edits without sending branding image bytes to the model", async () => {
  vi.spyOn(billing, "listDocs").mockResolvedValue([{ id: 7, number: "INV-7", total: 420, balance: 400, paid: 20 }] as never);
  const doc = vi.spyOn(billing, "getDoc").mockResolvedValue({
    id: 7, number: "INV-7", customer_name: "Mary Studio", customer_trn: "100000000000003",
    items: [{ description: "Oil", qty: 2, unit_price: 1, custom: { liters: "400" } }],
    unit_price_formula: { a: "liters", b: "unit_price" },
    einvoice: { payment_account: "fixture-bank-account" },
    logo: "data:image/png;base64,PRIVATE_LOGO",
    stamp: { data: "PRIVATE_STAMP", x: 1, y: 2 }, signature: { data: "PRIVATE_SIGNATURE", x: 3, y: 4 },
  } as never);
  const confirm = vi.fn(() => true);
  const result = await runTool("get_invoice", { invoice_number: "INV-7" }, confirm);
  expect(doc).toHaveBeenCalledExactlyOnceWith(7);
  expect(result).toMatchObject({
    total: 420, balance: 400, paid: 20,
    items: [{ qty: 2, unit_price: 1, custom: { liters: "400" } }],
    unit_price_formula: { a: "liters" }, einvoice: { payment_account: "fixture-bank-account" },
    has_logo: true, has_stamp: true, has_signature: true,
  });
  expect(JSON.stringify(result)).not.toContain("PRIVATE_");
  expect(confirm).not.toHaveBeenCalled();
});

it("refuses ambiguous or missing numbers and uses explicit IDs for duplicates", async () => {
  vi.spyOn(billing, "listDocs").mockResolvedValue([
    { id: 7, number: "INV-7" }, { id: 8, number: "INV-7" },
  ] as never);
  const doc = vi.spyOn(billing, "getDoc").mockResolvedValue({ id: 8, number: "INV-7", items: [] } as never);
  expect(await runTool("get_invoice", { invoice_number: "INV-7" })).toMatchObject({ error: expect.stringContaining("More than one invoice") });
  expect(await runTool("get_invoice", { invoice_number: "missing" })).toHaveProperty("error");
  expect(await runTool("get_invoice", { invoice_number: " " })).toHaveProperty("error");
  expect(doc).not.toHaveBeenCalled();
  expect(await runTool("get_invoice", { invoice_number: "id:8" })).toMatchObject({ id: 8 });
  expect(doc).toHaveBeenCalledExactlyOnceWith(8);
});

it("keeps read-back available in Plan mode but refuses a role without invoice access", async () => {
  setAgentMode("plan");
  setCapabilityEnabled("sales", false);
  expect(offeredTools({ isOwner: true }, new Set()).map(tool => tool.name)).toContain("get_invoice");
  setDataMode("cloud");
  vi.mocked(supabase!.rpc).mockResolvedValue({ data: { allowed: true, admin: false, modules: ["customers"] }, error: null } as never);
  const list = vi.spyOn(billing, "listDocs");
  expect(await runTool("get_invoice", { invoice_number: "INV-7" })).toMatchObject({ error: expect.stringContaining("does not have access to invoicing") });
  expect(list).not.toHaveBeenCalled();
});

it("rejects invalid pagination before reading records", async () => {
  const list = vi.spyOn(billing, "listDocs");
  for (const args of [{ limit: 0 }, { limit: 101 }, { offset: -1 }, { offset: 0.5 }, { query: "x".repeat(201) }])
    expect(await runTool("list_invoices", args)).toMatchObject({ code: "invalid_arguments" });
  expect(list).not.toHaveBeenCalled();
});
