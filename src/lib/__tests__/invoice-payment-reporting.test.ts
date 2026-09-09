import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { billing, type InvoiceDocInput } from "../api";
import { setDataMode } from "../dataMode";
import { overviewTrend } from "../../pages/overviewData";
import { useReportsData } from "../../pages/reports/useReportsData";

vi.mock("../exchange-rates", async (original) => ({
  ...await original<typeof import("../exchange-rates")>(),
  getExchangeRates: async () => ({ AED: 1, USD: 4 }),
}));
beforeEach(() => { localStorage.clear(); setDataMode("local"); });
afterEach(cleanup);

it("connects saved invoice payments to Reports, excludes supplier bills and refreshes a payment reversal", async () => {
  const document: InvoiceDocInput = {
    number: "INV-REPORT", status: "sent", currency: "USD", fx_rate: 3.6,
    tax_rate: 0, discount: 0, customer_name: "Customer", issue_date: "2026-08-01",
    template: "classic", accent: "#f6b62b", seller_name: "Filey test",
    items: [{ description: "Service", qty: 1, unit_price: 100 }],
  };
  const invoiceId = await billing.saveDoc(document);
  const paymentId = await billing.addPayment(invoiceId, 70, "bank", "2026-09-05");
  const billId = await billing.saveDoc({ ...document, number: "BILL-REPORT", doc_type: "purchase" });
  await billing.addPayment(billId, 100, "bank", "2026-09-05");
  expect(await billing.allPayments()).toHaveLength(2);
  const { result } = renderHook(() => useReportsData());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.error).toBe("");
  expect(result.current.invoicePayments).toEqual([
    expect.objectContaining({ id: paymentId, invoice_id: invoiceId, amount: 252, paid_at: "2026-09-05" }),
  ]);
  expect(result.current.receiptList).toEqual([]);
  const rows = overviewTrend(result.current.invoices, result.current.receiptList, [], 7,
    new Date(2026, 8, 7), result.current.invoicePayments);
  expect(rows[4]).toMatchObject({ invoiced: 0, invoicePayments: 252, received: 0 });
  await act(async () => {
    await billing.removePayment(paymentId!);
    await result.current.reload();
  });
  expect(result.current.invoicePayments).toEqual([]);
});
