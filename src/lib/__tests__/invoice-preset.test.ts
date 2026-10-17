import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { billing, crm, erp, setCacheOrg } from "../api";
import { runTool } from "../aiTools";
import { setDataMode } from "../dataMode";
import { setAgentMode } from "../agentMode";
import { applyInvoicePreset, unitSize } from "../invoicePresets";
vi.mock("../log", async original => ({ ...await original<typeof import("../log")>(), log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// "Always add T.Liters = qty × liters, rate per T.Liters": saved once per workspace, then every
// invoice draft the agent makes gets the column worked out and is priced by it.
beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
  setCacheOrg("test-org", "test-user");
  setAgentMode("auto");
  vi.spyOn(billing, "getCompany").mockResolvedValue({ name: "Dune Lubricants", trn: "100000000000003", currency: "AED", country_code: "AE", address: "Sharjah", default_tax_rate: 5 } as never);
  vi.spyOn(crm, "customers").mockResolvedValue([{ id: 9, name: "Rennox" }] as never);
  vi.spyOn(erp, "products").mockResolvedValue([]);
  vi.spyOn(billing, "listDocs").mockResolvedValue([]);
});
afterEach(() => { vi.restoreAllMocks(); });

const lines = [
  { description: "RC Pail 20L", qty: 48, unit: "Pail", unit_price: 0.2 },
  { description: "2. Virgin Drum", qty: 2, unit: "Drum", unit_price: 4.1 },
];

it("reads a unit's size from its name or the saved sizes", () => {
  const liters = { key: "liters", label: "T.Liters", per_unit: true };
  expect(unitSize(liters, "RC Pail 20L Pail")).toBe(20);
  expect(unitSize(liters, "Engine oil 4 Ltr can")).toBe(4);
  expect(unitSize(liters, "2. Virgin Drum Drum")).toBeUndefined();
  expect(unitSize(liters, "2. Virgin Drum Drum", { "virgin drum": 200 })).toBe(200);
  expect(unitSize({ key: "kg", label: "T.Kg", per_unit: true }, "Grease 25 kg bucket")).toBe(25);
});

it("reads the user's own item text: 'H/O 68 PAIL 20L', qty 20 at 0.20 → 400 T.Liters, unit Pail", () => {
  const preset = { columns: [{ key: "liters", label: "T.Liters", per_unit: true }], price_by: "liters" };
  const applied = applyInvoicePreset(preset, [], "", [{ description: "H/O 68 PAIL 20L", qty: 20, unit_price: 0.2 }]);
  expect(applied.missing).toEqual([]);
  expect(applied.items[0]).toMatchObject({ unit: "Pail", custom: { liters: "400" } });
  expect(applied.priceBy).toBe("liters");
});

it("applies nothing without a preset, and keeps a value the user gave", () => {
  expect(applyInvoicePreset(null, [], "", lines)).toMatchObject({ cols: [], priceBy: "", missing: [] });
  const preset = { columns: [{ key: "liters", label: "T.Liters", per_unit: true }], price_by: "liters" };
  const applied = applyInvoicePreset(preset, [], "", [{ ...lines[0], custom: { liters: "950" } }]);
  expect(applied.items[0].custom).toEqual({ liters: "950" });
});

it("saves the preset, asks once for an unknown size, then prices every line by T.Liters", async () => {
  const save = vi.spyOn(billing, "saveDoc").mockResolvedValue(1 as never);
  expect(await runTool("set_invoice_preset", { columns: [{ key: "liters", label: "T.Liters", per_unit: true }], price_by: "liters" })).toMatchObject({ ok: true });

  // "Virgin Drum" doesn't say its size: the agent is told to ask, not guess.
  const asked = await runTool("create_invoice_draft", { customer_name: "Rennox", items: lines }) as { error?: string };
  expect(asked.error).toContain("2. Virgin Drum");
  expect(save).not.toHaveBeenCalled();

  expect(await runTool("set_invoice_preset", { unit_sizes: { "Virgin Drum": 200 } })).toMatchObject({ ok: true, preset: { price_by: "liters", unit_sizes: { "virgin drum": 200 } } });
  const made = await runTool("create_invoice_draft", { customer_name: "Rennox", items: lines }) as { ok: boolean; subtotal: number; priced_by: string };
  expect(made).toMatchObject({ ok: true, subtotal: 1832, priced_by: "liters" });
  const saved = save.mock.calls[0][0] as unknown as { custom_columns: unknown; unit_price_formula: unknown; items: { custom: Record<string, string> }[] };
  expect(saved.custom_columns).toEqual([{ key: "liters", label: "T.Liters" }]);
  expect(saved.unit_price_formula).toEqual({ a: "liters", b: "unit_price" });
  expect(saved.items.map(item => item.custom.liters)).toEqual(["960", "400"]);
});

it("goes back to qty × rate once the preset is removed", async () => {
  await runTool("set_invoice_preset", { columns: [{ key: "liters", label: "T.Liters", per_unit: true }], price_by: "liters" });
  expect(await runTool("set_invoice_preset", { clear: true })).toMatchObject({ ok: true });
  const save = vi.spyOn(billing, "saveDoc").mockResolvedValue(2 as never);
  const made = await runTool("create_invoice_draft", { customer_name: "Rennox", items: [lines[0]] }) as { ok: boolean; subtotal: number; priced_by: string };
  expect(made).toMatchObject({ ok: true, subtotal: 9.6, priced_by: "qty × unit price" });
  expect((save.mock.calls[0][0] as unknown as { custom_columns?: unknown }).custom_columns).toBeUndefined();
});
