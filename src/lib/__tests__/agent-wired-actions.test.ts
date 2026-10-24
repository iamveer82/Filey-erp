import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { billing, setCacheOrg } from "../api";
import { runTool } from "../aiTools";
import { setDataMode } from "../dataMode";
import { setAgentMode } from "../agentMode";
vi.mock("../log", async original => ({ ...await original<typeof import("../log")>(), log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// The actions the 2026-10-23 wiring audit added, run against the real local data layer.
beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
  setCacheOrg("test-org", "test-user");
  setAgentMode("auto");
  vi.spyOn(billing, "getCompany").mockResolvedValue({ name: "Dune Lubricants", trn: "100000000000003", currency: "AED", country_code: "AE" } as never);
});
afterEach(() => { vi.restoreAllMocks(); });

it("takes a quote from sent to accepted to an invoice, and converting twice gives the same invoice", async () => {
  await runTool("create_customer", { name: "Rennox Trading" });
  const quote = await runTool("create_quote", { customer_name: "Rennox Trading", items: [{ description: "RC 20L", qty: 2, rate: 100 }] }) as Record<string, unknown>;
  expect(quote.error).toBeUndefined();
  const listed = await runTool("list_quotes", {}) as { quotes: { number: string }[] };
  const number = listed.quotes[0].number;
  expect(await runTool("set_quote_status", { quote_number: number, status: "accepted" })).toMatchObject({ ok: true, status: "accepted" });
  expect(await runTool("get_quote", { quote_number: number })).toMatchObject({ number, status: "accepted", lines: [expect.objectContaining({ product: "RC 20L", qty: 2, rate: 100 })] });
  const first = await runTool("convert_quote_to_invoice", { quote_number: number }) as { ok: boolean; invoice_number: string };
  expect(first.ok).toBe(true);
  expect(first.invoice_number).toBeTruthy();
  expect(await runTool("convert_quote_to_invoice", { quote_number: number })).toMatchObject({ invoice_number: first.invoice_number });
});

it("records a customer advance as credit and lists it", async () => {
  await runTool("create_customer", { name: "Rennox Trading" });
  expect(await runTool("record_advance", { party: "customer", name: "rennox", amount: 500, note: "deposit" })).toMatchObject({ ok: true, party: "Rennox Trading" });
  expect(await runTool("list_advances", { party: "customer", name: "Rennox Trading" })).toMatchObject({ credit_available: 500, entries: [expect.objectContaining({ amount: 500 })] });
});

it("refuses an ambiguous customer instead of picking one", async () => {
  await runTool("create_customer", { name: "Rennox Trading" });
  await runTool("create_customer", { name: "Rennox Logistics" });
  await expect(runTool("record_advance", { party: "customer", name: "rennox", amount: 500 })).resolves.toMatchObject({ error: expect.stringContaining("More than one customer") });
});

it("moves a follow-up and pins a CRM note", async () => {
  await runTool("create_customer", { name: "Rennox Trading" });
  await runTool("add_reminder", { title: "Call Rennox about the pails", due_date: "2026-11-01" });
  expect(await runTool("reschedule_follow_up", { follow_up: "call rennox", due_date: "2026-11-05" })).toMatchObject({ ok: true, due_date: "2026-11-05" });
  const board = await runTool("list_follow_ups", {}) as Record<string, unknown>;
  expect(JSON.stringify(board)).toContain("2026-11-05");
  expect(await runTool("add_crm_note", { about: "customer", name: "Rennox", note: "Prefers Monday deliveries" })).toMatchObject({ ok: true });
});
