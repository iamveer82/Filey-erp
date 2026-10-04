import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { billing, crm, erp, fin, quotes, receipts, setCacheOrg, tools as settings } from "../api";
import { runTool } from "../aiTools";
import { setAgentMode } from "../agentMode";
import { setDataMode } from "../dataMode";

beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
  setCacheOrg("finance-correctness-org", "finance-correctness-user");
  setAgentMode("auto");
});

afterEach(() => vi.restoreAllMocks());

describe("overdue invoice reporting", () => {
  it("does not count unsent or cancelled drafts as money to chase", async () => {
    vi.spyOn(crm, "customers").mockResolvedValue([]);
    vi.spyOn(erp, "products").mockResolvedValue([]);
    vi.spyOn(erp, "orders").mockResolvedValue([]);
    vi.spyOn(quotes, "listDocs").mockResolvedValue([]);
    vi.spyOn(billing, "listDocs").mockResolvedValue([
      { id: 1, number: "DRAFT-1", status: "draft", due_date: "2020-01-01", balance: 100 },
      { id: 2, number: "SENT-1", status: "sent", due_date: "2020-01-01", balance: 100 },
      { id: 3, number: "PAID-1", status: "paid", due_date: "2020-01-01", balance: 0 },
      { id: 4, number: "CANCELLED-1", status: "cancelled", due_date: "2020-01-01", balance: 100 },
      { id: 5, number: "OVERDUE-1", status: "overdue", due_date: "2020-01-01", balance: 50 },
    ] as never);
    expect(await runTool("get_stats", {})).toMatchObject({ invoices: 5, overdue_invoices: 2 });
    expect(await runTool("list_invoices", { status: "overdue" })).toEqual([
      expect.objectContaining({ id: 2 }), expect.objectContaining({ id: 5 }),
    ]);
  });
});

describe("receipt currency reporting", () => {
  it("keeps different currencies separate instead of adding their face values", async () => {
    vi.spyOn(receipts, "list").mockResolvedValue([
      { number: "R-1", customer_name: "Acme", amount: 100, currency: "USD", payment_date: "2026-10-04" },
      { number: "R-2", customer_name: "Acme", amount: 100, currency: "AED", payment_date: "2026-10-04" },
    ] as never);
    const result = await runTool("list_payment_receipts", {});
    expect(result).toMatchObject({ count: 2, totals_by_currency: { USD: 100, AED: 100 },
      receipts: [expect.objectContaining({ currency: "USD" }), expect.objectContaining({ currency: "AED" })] });
    expect(result).not.toHaveProperty("total");
  });

  it("preserves a labeled total for a single currency and reconciles cents", async () => {
    vi.spyOn(receipts, "list").mockResolvedValue([
      { number: "R-1", customer_name: "Acme", amount: 0.1, currency: "usd" },
      { number: "R-2", customer_name: "Acme", amount: 0.2, currency: "USD" },
    ] as never);
    expect(await runTool("list_payment_receipts", {})).toMatchObject({ currency: "USD", total: 0.3, totals_by_currency: { USD: 0.3 } });
  });
});

function mockInvoiceContext() {
  vi.spyOn(crm, "customers").mockResolvedValue([]);
  vi.spyOn(erp, "products").mockResolvedValue([]);
  vi.spyOn(billing, "getCompany").mockResolvedValue({ default_tax_rate: 5, country_code: "AE", name: "Company" } as never);
  vi.spyOn(billing, "listDocs").mockResolvedValue([]);
  return vi.spyOn(billing, "saveDoc").mockResolvedValue(81);
}

const item = { description: "Consulting", qty: 2, unit_price: 100 };

describe("invoice instructions survive a tool call", () => {
  it("saves requested dates, wording, discount, VAT and rounding with the returned record ID", async () => {
    const save = mockInvoiceContext();
    expect(await runTool("create_invoice_draft", {
      customer_name: "Acme", items: [item], issue_date: "2026-10-04", due_date: "2026-11-04",
      notes: "As agreed", terms: "Bank transfer", discount: 20, tax_rate: 7.5, round_off: true,
    })).toMatchObject({ ok: true, id: 81, subtotal: 200, discount: 20, tax: 13.5, total: 194, round_off: 0.5 });
    expect(save.mock.calls[0][0]).toMatchObject({ issue_date: "2026-10-04", due_date: "2026-11-04",
      notes: "As agreed", terms: "Bank transfer", discount: 20, tax_rate: 7.5, round_off: true });
  });

  it("honors zero VAT and preserves all unrelated draft metadata during revisions", async () => {
    const save = mockInvoiceContext();
    vi.mocked(billing.listDocs).mockResolvedValue([{ id: 9, number: "INV-9", status: "draft" }] as never);
    vi.spyOn(billing, "getDoc").mockResolvedValue({ id: 9, number: "INV-9", status: "draft", customer_name: "Acme",
      issue_date: "2026-10-01", due_date: "2026-10-31", notes: "Original note", terms: "Original terms",
      tax_rate: 5, discount: 10, round_off: true, items: [item], einvoice: { uuid: "existing-invoice-uuid" },
    } as never);
    expect(await runTool("revise_invoice", { invoice_number: "INV-9", due_date: "2026-11-30", tax_rate: 0, discount: 20, round_off: false })).toMatchObject({ ok: true, total: 180, tax: 0 });
    expect(save.mock.calls[0][0]).toMatchObject({ id: 9, issue_date: "2026-10-01", due_date: "2026-11-30",
      notes: "Original note", terms: "Original terms", tax_rate: 0, discount: 20, round_off: false,
      einvoice: { uuid: "existing-invoice-uuid" }, items: [item] });
  });

  it("rejects invalid dates, out-of-range totals and unsupported instructions before saving", async () => {
    const save = mockInvoiceContext();
    for (const extra of [{ due_date: "2026-02-31" }, { issue_date: "yesterday" }, { tax_rate: -1 },
      { tax_rate: 101 }, { discount: -1 }, { unknown_payment_option: "silently ignored" }]) {
      expect(await runTool("create_invoice_draft", { customer_name: "Acme", items: [item], ...extra })).toMatchObject({ code: "invalid_arguments", retry_safe: true });
    }
    expect(save).not.toHaveBeenCalled();
  });

  it("copies saved line metadata into fresh lines without reusing old database IDs", async () => {
    const save = mockInvoiceContext();
    expect(await runTool("create_invoice_draft", { customer_name: "Acme", items: [
      { ...item, id: 123, tax_category: "Z", custom: { __disc_pct: "10", __pagebreak: "1" } },
    ], discount: 5, tax_rate: 5, notes: "Repeat service" })).toMatchObject({ ok: true, subtotal: 200, discount: 25, tax: 0, total: 175 });
    expect(save.mock.calls[0][0].items).toEqual([{ ...item, tax_category: "Z", custom: { __disc_pct: "10", __pagebreak: "1" } }]);
    expect(save.mock.calls[0][0]).not.toHaveProperty("id");
    expect(save.mock.calls[0][0]).toMatchObject({ status: "draft", notes: "Repeat service" });
  });

  it("rejects a blank buyer before creating a document", async () => {
    const save = mockInvoiceContext();
    expect(await runTool("create_invoice_draft", { customer_name: "   ", items: [item] })).toMatchObject({ code: "invalid_arguments", retry_safe: true });
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects explicit zero quantities instead of creating a one-unit invoice", async () => {
    const save = mockInvoiceContext();
    expect(await runTool("create_invoice_draft", { customer_name: "Acme", items: [{ ...item, qty: 0 }] })).toMatchObject({ code: "invalid_arguments", retry_safe: true });
    expect(save).not.toHaveBeenCalled();
  });

  it("takes the buyer identity from the selected saved customer", async () => {
    const save = mockInvoiceContext();
    vi.mocked(crm.customers).mockResolvedValue([{ id: 7, name: "Acme", email: "billing@acme.test", address: "Saved address", trn: "100000000000001" }] as never);
    expect(await runTool("create_invoice_draft", { customer_name: "Acme", customer_id: 7, items: [item] })).toMatchObject({ ok: true });
    expect(save.mock.calls[0][0]).toMatchObject({ customer_id: 7, customer_email: "billing@acme.test", customer_address: "Saved address", customer_trn: "100000000000001" });
    expect(await runTool("create_invoice_draft", { customer_name: "Acme", customer_id: 9, items: [item] })).toMatchObject({ code: "invalid_arguments" });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("clears optional wording and due date only when explicitly requested", async () => {
    const save = mockInvoiceContext();
    vi.mocked(billing.listDocs).mockResolvedValue([{ id: 9, number: "INV-9", status: "draft" }] as never);
    vi.spyOn(billing, "getDoc").mockResolvedValue({ id: 9, number: "INV-9", status: "draft", customer_name: "Acme",
      issue_date: "2026-10-01", due_date: "2026-10-31", notes: "Original note", terms: "Original terms",
      tax_rate: 5, discount: 0, items: [item],
    } as never);
    expect(await runTool("revise_invoice", { invoice_number: "INV-9", due_date: "", notes: "", terms: "" })).toMatchObject({ ok: true });
    expect(save.mock.calls[0][0]).toMatchObject({ due_date: "", notes: "", terms: "", issue_date: "2026-10-01" });
  });
});

describe("cash document preflight", () => {
  it("refuses invalid receipt dates or fractional cents before any receipt write", async () => {
    vi.spyOn(billing, "getCompany").mockResolvedValue({} as never);
    vi.spyOn(receipts, "list").mockResolvedValue([]);
    const save = vi.spyOn(receipts, "save").mockResolvedValue(1);
    for (const extra of [{ payment_date: "2026-02-31" }, { payment_date: "tomorrow" }, { amount: 0.001 }, { amount: 1e12 }]) {
      expect(await runTool("create_payment_receipt", { customer_name: "Acme", amount: 1, ...extra })).toMatchObject({ code: "invalid_arguments", retry_safe: true });
    }
    expect(save).not.toHaveBeenCalled();
  });

  it("refuses negative cheques and invalid calendar dates before changing the register", async () => {
    const get = vi.spyOn(settings, "settings").mockResolvedValue([]);
    const set = vi.spyOn(settings, "setSetting").mockResolvedValue(undefined);
    for (const extra of [{ amount: -10 }, { amount: 0 }, { amount: 0.001 }, { issue_date: "2026-02-31" }, { due_date: "soon" }]) {
      expect(await runTool("record_cheque", { cheque_no: "CH-1", type: "received", party: "Acme", amount: 100, ...extra })).toMatchObject({ code: "invalid_arguments", retry_safe: true });
    }
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });
});

describe("expense acknowledgements", () => {
  it("returns the saved expense ID instead of an unverified success message", async () => {
    const save = vi.spyOn(fin, "createExpense").mockResolvedValue(42);
    expect(await runTool("log_expense", { category: "Office", description: "Supplies", amount: 10, date: "2026-10-04" })).toMatchObject({ ok: true, id: 42 });
    expect(save).toHaveBeenCalledExactlyOnceWith("Office", "Supplies", 10, "2026-10-04", null);
  });

  it("marks a lost or invalid acknowledgement as uncertain without claiming success", async () => {
    const save = vi.spyOn(fin, "createExpense").mockRejectedValueOnce(new Error("Expense save could not be confirmed. Check your expenses before trying again."));
    expect(await runTool("log_expense", { amount: 10 })).toMatchObject({ error: expect.stringMatching(/could not be confirmed/), retry_safe: false });
    expect(save).toHaveBeenCalledOnce();
  });
});
