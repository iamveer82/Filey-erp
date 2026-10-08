import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { billing, crm, erp, fin, quotes, receipts, setCacheOrg, suppliers, tools as settings } from "../api";
import * as documentNumbers from "../documentNumbers";
import * as moduleAccess from "../moduleAccess";
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
  vi.spyOn(documentNumbers, "allocateDocumentNumber").mockResolvedValue("INV-TEST-1");
  vi.spyOn(settings, "settings").mockResolvedValue([]);
  vi.spyOn(billing, "pendingInvoiceSaves").mockResolvedValue([]);
  vi.spyOn(crm, "customers").mockResolvedValue([]);
  vi.spyOn(erp, "products").mockResolvedValue([]);
  vi.spyOn(billing, "getCompany").mockResolvedValue({ default_tax_rate: 5, country_code: "AE", name: "Company" } as never);
  vi.spyOn(billing, "listDocs").mockResolvedValue([]);
  return vi.spyOn(billing, "saveDoc").mockResolvedValue(81);
}

const item = { description: "Consulting", qty: 2, unit_price: 100 };

describe("invoice instructions survive a tool call", () => {
  it.each(["local", "cloud"] as const)("honors an explicit %s invoice number without reserving a replacement", async mode => {
    const save = mockInvoiceContext();
    vi.spyOn(moduleAccess, "requireToolModuleAccess").mockResolvedValue();
    setDataMode(mode);
    expect(await runTool("create_invoice_draft", {
      customer_name: "Acme", invoice_number: "QA-NAV-20261008-A", items: [item],
    })).toMatchObject({ ok: true, id: 81, number: "QA-NAV-20261008-A" });
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][0]).toMatchObject({ number: "QA-NAV-20261008-A", items: [item] });
    expect(documentNumbers.allocateDocumentNumber).not.toHaveBeenCalled();
    expect(billing.listDocs).not.toHaveBeenCalled();
  });

  it("rejects blank, oversized and control-character invoice numbers before allocating or saving", async () => {
    const save = mockInvoiceContext();
    for (const invoice_number of ["", "   ", "INV\n1", "INV\u007f1", "x".repeat(161)])
      expect(await runTool("create_invoice_draft", { customer_name: "Acme", invoice_number, items: [item] }))
        .toMatchObject({ code: "invalid_arguments", retry_safe: true });
    expect(save).not.toHaveBeenCalled();
    expect(documentNumbers.allocateDocumentNumber).not.toHaveBeenCalled();
  });

  it("does not replace an explicitly requested number when the save reports a collision", async () => {
    const save = mockInvoiceContext().mockRejectedValue({ code: "23505", message: "This document number is already in use. Choose another number." });
    expect(await runTool("create_invoice_draft", { customer_name: "Acme", invoice_number: "QA-EXISTING", items: [item] }))
      .toMatchObject({ error: expect.stringContaining("already in use"), invoice_number: "QA-EXISTING" });
    expect(save).toHaveBeenCalledOnce();
    expect(documentNumbers.allocateDocumentNumber).not.toHaveBeenCalled();
  });

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
    const save = mockInvoiceContext().mockResolvedValue(9);
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
    const save = mockInvoiceContext().mockResolvedValue(9);
    vi.mocked(billing.listDocs).mockResolvedValue([{ id: 9, number: "INV-9", status: "draft" }] as never);
    vi.spyOn(billing, "getDoc").mockResolvedValue({ id: 9, number: "INV-9", status: "draft", customer_name: "Acme",
      issue_date: "2026-10-01", due_date: "2026-10-31", notes: "Original note", terms: "Original terms",
      tax_rate: 5, discount: 0, items: [item],
    } as never);
    expect(await runTool("revise_invoice", { invoice_number: "INV-9", due_date: "", notes: "", terms: "" })).toMatchObject({ ok: true });
    expect(save.mock.calls[0][0]).toMatchObject({ due_date: "", notes: "", terms: "", issue_date: "2026-10-01" });
  });
});

describe("invoice save acknowledgement", () => {
  const exact = { customer_name: "Acme", items: [{ description: "RC drum", qty: 6, unit: "drum", unit_price: 0.2, custom: { liters: "1200" } }],
    custom_columns: [{ key: "liters", label: "T.Liters" }], price_by: "liters" };

  it("discovers only pending invoice identities of the requested type without exposing document contents or writing", async () => {
    const save = mockInvoiceContext();
    const requestId = "12345678-1234-1234-1234-123456789abc";
    vi.mocked(billing.pendingInvoiceSaves).mockResolvedValue([
      { requestId, active: false, input: { number: "INV-047", customer_name: "Acme", logo: "private-artwork", items: exact.items } as never },
      { requestId: "purchase-request", active: true, input: { number: "PI-001", customer_name: "Supplier", doc_type: "purchase", notes: "private-notes", items: exact.items } as never },
    ]);
    setAgentMode("plan");
    expect(await runTool("list_pending_invoice_saves", { query: "acme" })).toEqual([
      { number: "INV-047", customer_name: "Acme", request_id: requestId, active: false, doc_type: "sales" },
    ]);
    expect(await runTool("list_pending_invoice_saves", { doc_type: "purchase" })).toEqual([
      { number: "PI-001", customer_name: "Supplier", request_id: "purchase-request", active: true, doc_type: "purchase" },
    ]);
    expect(await runTool("list_pending_invoice_saves", { query: "absent" })).toEqual([]);
    expect(save).not.toHaveBeenCalled();
    expect(documentNumbers.allocateDocumentNumber).not.toHaveBeenCalled();
  });

  it("directs an unknown retry request to pending-save discovery instead of asking for an internal ID", async () => {
    mockInvoiceContext();
    const retry = vi.spyOn(billing, "retryInvoiceSave");
    expect(await runTool("retry_invoice_save", { request_id: "12345678-1234-1234-1234-123456789abc" }, () => true))
      .toMatchObject({ error: expect.stringContaining("Use list_pending_invoice_saves"), retry_safe: false });
    expect(retry).not.toHaveBeenCalled();
  });

  it.each(["local", "cloud"] as const)("keeps a %s invoice's original number across a later turn and rejects changed-argument retries", async mode => {
    const save = mockInvoiceContext();
    vi.spyOn(moduleAccess, "requireToolModuleAccess").mockResolvedValue();
    setDataMode(mode);
    const requestId = "12345678-1234-1234-1234-123456789abc";
    save.mockImplementationOnce(async input => {
      vi.mocked(billing.pendingInvoiceSaves).mockResolvedValue([{ requestId, input, active: false }]);
      throw new Error("Save acknowledgement lost");
    });
    const read = vi.spyOn(billing, "readPendingInvoiceSave").mockResolvedValue(null);
    expect(await runTool("create_invoice_draft", exact)).toMatchObject({ save_outcome: "unconfirmed", save_request_id: requestId, invoice_number: "INV-TEST-1" });
    // Separate tool invocations with no shared in-memory run guard simulate a
    // follow-up chat after the failed run has ended.
    expect(await runTool("create_invoice_draft", exact)).toMatchObject({ save_outcome: "unconfirmed", save_request_id: requestId });
    expect(await runTool("create_invoice_draft", { ...exact, items: [{ ...exact.items[0], unit_price: 200, custom: {} }], price_by: "", custom_columns: [] }))
      .toMatchObject({ save_outcome: "unconfirmed", save_request_id: requestId });
    expect(save).toHaveBeenCalledOnce();
    expect(documentNumbers.allocateDocumentNumber).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledExactlyOnceWith(requestId);
    const retry = vi.spyOn(billing, "retryInvoiceSave").mockResolvedValue(81);
    expect(await runTool("retry_invoice_save", { request_id: requestId }, () => true)).toMatchObject({ ok: true, id: 81, number: "INV-TEST-1" });
    expect(retry).toHaveBeenCalledExactlyOnceWith(requestId);
    expect(save).toHaveBeenCalledOnce();
    expect(documentNumbers.allocateDocumentNumber).toHaveBeenCalledOnce();
  });

  it("recovers a committed earlier invoice instead of allocating another number", async () => {
    const save = mockInvoiceContext();
    const requestId = "12345678-1234-1234-1234-123456789abc";
    save.mockImplementationOnce(async input => {
      vi.mocked(billing.pendingInvoiceSaves).mockResolvedValue([{ requestId, input, active: false }]);
      throw new Error("Response lost after commit");
    });
    await runTool("create_invoice_draft", exact);
    const read = vi.spyOn(billing, "readPendingInvoiceSave").mockResolvedValue({ ...save.mock.calls[0][0], id: 81 } as never);
    expect(await runTool("create_invoice_draft", exact)).toMatchObject({ ok: true, id: 81, number: "INV-TEST-1", verified_save_requests: [requestId] });
    expect(read).toHaveBeenCalledExactlyOnceWith(requestId);
    expect(save).toHaveBeenCalledOnce();
    expect(documentNumbers.allocateDocumentNumber).toHaveBeenCalledOnce();
  });

  it("only recovers an explicitly numbered pending invoice when its number matches", async () => {
    const save = mockInvoiceContext();
    const requestId = "12345678-1234-1234-1234-123456789abc";
    save.mockImplementationOnce(async input => {
      vi.mocked(billing.pendingInvoiceSaves).mockResolvedValue([{ requestId, input, active: false }]);
      throw { code: "57014", message: "canceling statement due to statement timeout" };
    });
    expect(await runTool("create_invoice_draft", { ...exact, invoice_number: "QA-ORIGINAL" }))
      .toMatchObject({ save_outcome: "unconfirmed", save_failure: "timeout", invoice_number: "QA-ORIGINAL" });
    const read = vi.spyOn(billing, "readPendingInvoiceSave").mockResolvedValue({ ...save.mock.calls[0][0], id: 81 } as never);
    expect(await runTool("create_invoice_draft", { ...exact, invoice_number: "QA-OTHER" }))
      .toMatchObject({ save_outcome: "unconfirmed", invoice_number: "QA-ORIGINAL", save_request_id: requestId });
    expect(read).not.toHaveBeenCalled();
    expect(await runTool("create_invoice_draft", { ...exact, invoice_number: "QA-ORIGINAL" }))
      .toMatchObject({ ok: true, id: 81, number: "QA-ORIGINAL", verified_save_requests: [requestId] });
    expect(read).toHaveBeenCalledExactlyOnceWith(requestId);
    expect(save).toHaveBeenCalledOnce();
    expect(documentNumbers.allocateDocumentNumber).not.toHaveBeenCalled();
  });

  it("never substitutes an identical pending edit of another record for this invoice", async () => {
    const save = mockInvoiceContext().mockResolvedValue(9);
    const doc = { id: 9, number: "INV-9", status: "draft", customer_name: "Acme", tax_rate: 5, discount: 0,
      items: [item], custom_columns: [], unit_price_formula: null };
    vi.mocked(billing.listDocs).mockResolvedValue([doc] as never);
    vi.spyOn(billing, "getDoc").mockResolvedValue(doc as never);
    vi.mocked(billing.pendingInvoiceSaves).mockResolvedValue([{ requestId: "12345678-1234-1234-1234-123456789abc", input: { ...doc, id: 1, notes: "New note" } as never, active: false }]);
    const read = vi.spyOn(billing, "readPendingInvoiceSave");
    expect(await runTool("revise_invoice", { invoice_number: "INV-9", notes: "New note" })).toMatchObject({ ok: true, id: 9 });
    expect(read).not.toHaveBeenCalled();
    expect(save.mock.calls[0][0]).toMatchObject({ id: 9, number: "INV-9" });
  });

  it("does not recover a pending update as a newly requested invoice", async () => {
    const save = mockInvoiceContext();
    await runTool("create_invoice_draft", exact);
    vi.mocked(billing.pendingInvoiceSaves).mockResolvedValue([{ requestId: "12345678-1234-1234-1234-123456789abc", input: { ...save.mock.calls[0][0], id: 9 }, active: false }]);
    const read = vi.spyOn(billing, "readPendingInvoiceSave");
    expect(await runTool("create_invoice_draft", exact)).toMatchObject({ ok: true, id: 81 });
    expect(read).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("verifies a fresh full invoice before exposing a recovery receipt without images", async () => {
    mockInvoiceContext();
    vi.mocked(billing.listDocs).mockResolvedValue([{ id: 81, number: "INV-1", total: 240 }] as never);
    const doc = { id: 81, number: "INV-1", logo: "private-logo", items: exact.items };
    const get = vi.spyOn(billing, "getDoc").mockResolvedValue(doc as never);
    const verify = vi.spyOn(billing, "verifyPendingInvoiceSaves").mockResolvedValue(["request-1"]);
    const result = await runTool("get_invoice", { invoice_number: "INV-1" });
    expect(billing.listDocs).toHaveBeenCalledExactlyOnceWith("sales", true);
    expect(get).toHaveBeenCalledExactlyOnceWith(81, true);
    expect(verify).toHaveBeenCalledExactlyOnceWith(doc);
    expect(result).toMatchObject({ id: 81, number: "INV-1", verified_save_requests: ["request-1"], has_logo: true });
    expect(result).not.toHaveProperty("logo");
  });

  it.each([undefined, "381"])("puts totals from the returned invoice lines before optional header fields (type %s)", invoice_type_code => {
    mockInvoiceContext();
    vi.mocked(billing.listDocs).mockResolvedValue([{ id: 81, number: "INV-028", total: 50934.96, balance: 50934.96, paid: 0 }] as never);
    vi.spyOn(billing, "getDoc").mockResolvedValue({
      ...Object.fromEntries(Array.from({ length: 55 }, (_, i) => [`optional_field_${i}`, "Header detail"])),
      id: 81, number: "INV-028", issue_date: "2026-09-01", currency: "AED", invoice_type_code,
      tax_rate: 5, discount: 0, unit_price_formula: { a: "liters", b: "unit_price" },
      items: [{ description: "Oil", qty: 50, unit_price: 0.2, custom: { liters: "1000" } }],
    } as never);
    vi.spyOn(billing, "verifyPendingInvoiceSaves").mockResolvedValue([]);
    return runTool("get_invoice", { invoice_number: "INV-028" }).then(result => {
      const sign = invoice_type_code ? -1 : 1;
      expect(result).toMatchObject({ number: "INV-028", issue_date: "2026-09-01", total: 210 * sign,
        net_total: 200 * sign, tax_total: 10 * sign, items: [expect.objectContaining({ amount: 200 })] });
      expect(Object.keys(result as object).slice(0, 20)).toEqual(expect.arrayContaining(["number", "issue_date", "total", "net_total", "tax_total", "balance", "items"]));
    });
  });

  it.each(["local", "cloud"] as const)("retains supplied per-litre pricing when a %s save times out", async mode => {
    const save = mockInvoiceContext().mockRejectedValue({ code: "57014", message: "canceling statement due to statement timeout" });
    vi.spyOn(moduleAccess, "requireToolModuleAccess").mockResolvedValue();
    setDataMode(mode);
    const result = await runTool("create_invoice_draft", exact);
    expect(result).toMatchObject({ save_outcome: "unconfirmed", save_failure: "timeout", retry_safe: false, invoice_number: expect.any(String) });
    expect(result).not.toHaveProperty("ok", true);
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][0]).toMatchObject({ items: exact.items, custom_columns: exact.custom_columns });
    expect(save.mock.calls[0][0]).toMatchObject({ unit_price_formula: { a: "liters", b: "unit_price" } });
    expect(save.mock.calls[0][0].items[0].custom).toMatchObject({ liters: "1200" });
  });

  it.each([0, -1, 1.5, Number.NaN])("does not claim a draft was created from invalid save ID %s", async id => {
    const save = mockInvoiceContext().mockResolvedValue(id);
    expect(await runTool("create_invoice_draft", exact)).toMatchObject({ save_outcome: "unconfirmed", retry_safe: false });
    expect(save).toHaveBeenCalledOnce();
  });

  it("keeps the exact identity of an uncertain revision instead of accepting a different record ID", async () => {
    const save = mockInvoiceContext().mockResolvedValue(81);
    vi.mocked(billing.listDocs).mockResolvedValue([{ id: 9, number: "INV-9", status: "draft" }] as never);
    vi.spyOn(billing, "getDoc").mockResolvedValue({ id: 9, number: "INV-9", status: "draft", customer_name: "Acme", items: [item], tax_rate: 5 } as never);
    expect(await runTool("revise_invoice", { invoice_number: "INV-9", notes: "Requested note" })).toMatchObject({
      save_outcome: "unconfirmed", retry_safe: false, invoice_id: 9, invoice_number: "INV-9",
    });
    expect(save).toHaveBeenCalledOnce();
  });

  it("reports purchase invoice save failures as unconfirmed too", async () => {
    const save = mockInvoiceContext().mockRejectedValue(new Error("Connection lost"));
    vi.spyOn(suppliers, "list").mockResolvedValue([]);
    expect(await runTool("create_purchase_invoice_draft", { supplier_name: "Fixture supplier", items: [item] })).toMatchObject({
      save_outcome: "unconfirmed", retry_safe: false, invoice_number: expect.any(String),
    });
    expect(save).toHaveBeenCalledOnce();
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
