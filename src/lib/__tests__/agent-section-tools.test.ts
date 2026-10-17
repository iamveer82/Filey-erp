import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { billing, setCacheOrg } from "../api";
import { runTool } from "../aiTools";
import { setDataMode } from "../dataMode";
import { setAgentMode } from "../agentMode";
import { todayYmd } from "../format";
vi.mock("../log", async original => ({ ...await original<typeof import("../log")>(), log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// Sections the agent used to have no tools for: it can now make and read them, on this device.
beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
  setCacheOrg("test-org", "test-user");
  setAgentMode("auto");
  vi.spyOn(billing, "getCompany").mockResolvedValue({ name: "Dune Lubricants", trn: "100000000000003", currency: "AED", country_code: "AE" } as never);
});
afterEach(() => { vi.restoreAllMocks(); });

it("makes a packing list with today's date and reads it back", async () => {
  const made = await runTool("create_packing_list", { recipient_name: "Rennox", invoice_reference: "INV-031",
    items: [{ description: "RC 20L", qty: 48, unit: "pail", package_type: "pallet", package_count: 4, gross_weight: 21 }, { description: "" }] }) as { ok: boolean; number: string; lines: number };
  expect(made).toMatchObject({ ok: true, lines: 1 });
  const listed = await runTool("list_packing_lists", { recipient: "renn" }) as { packing_lists: Record<string, unknown>[] };
  expect(listed.packing_lists).toEqual([expect.objectContaining({ number: made.number, recipient: "Rennox", issue_date: todayYmd(), status: "draft", packages: 4, gross_weight: 1008 })]);
});

it("refuses a packing list with no lines", async () => {
  expect(await runTool("create_packing_list", { recipient_name: "Rennox", items: [] })).toMatchObject({ error: expect.stringContaining("at least one line") });
});

it("makes a VAT declaration letter in the standard wording and reads it back", async () => {
  const made = await runTool("create_declaration_letter", { recipient_name: "Bapco", lpo_ref: "2231", qty: "20", amount: "AED 52,000" }) as { ok: boolean; ref: string };
  expect(made.ok).toBe(true);
  const listed = await runTool("list_declaration_letters", {}) as { declaration_letters: Record<string, unknown>[] };
  expect(listed.declaration_letters).toEqual([expect.objectContaining({ ref: made.ref, recipient: "Bapco", lpo: "2231", qty: "20", unit: "MT", amount: "52000", date: todayYmd() })]);
});
