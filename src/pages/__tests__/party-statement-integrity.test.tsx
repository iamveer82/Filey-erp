import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  advances, billing, crm, erp, pos, quotes, receipts, suppliers,
  type CompanyProfile, type CrmCustomer, type InvoiceDocSummary, type PoSummary,
} from "../../lib/api";
import CustomerDetail from "../CustomerDetail";
import SupplierDetail from "../SupplierDetail";
import * as pdfTools from "../../lib/pdfTools";
import * as salesJournal from "../../components/statements/buildSalesJournal";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("../../lib/ui", () => ({ useUI: () => ({ toast, confirm: async () => false }) }));
vi.mock("../../components/ActivityTimeline", () => ({ default: () => null }));
vi.mock("../../components/StickyNotes", () => ({ default: () => null }));
vi.mock("../../components/LinkedRecords", () => ({ default: () => null }));
vi.mock("../../components/CrmRecordPanel", () => ({ default: () => null }));
vi.mock("../../components/ContactsPanel", () => ({ default: () => null }));
vi.mock("../../components/PartyBankDetails", () => ({ default: () => null }));
vi.mock("../../components/FollowUps", () => ({ default: () => null }));
vi.mock("../../components/AdvanceCard", () => ({ default: () => null }));
vi.mock("../../components/statements/StatementModal", () => ({ default: () => null }));

const customer = { id: 1, name: "Test customer", opening_balance: 75 } as CrmCustomer;
const doc = { id: 1, number: "INV-TEST", customer_name: customer.name, currency: "USD", status: "sent", total: 100, issue_date: "2026-09-01" } as InvoiceDocSummary;
const po = { id: 2, po_number: "PO-TEST", supplier_id: 1, supplier_name: "Test supplier", currency: "AED", status: "sent", total: 100, order_date: "2026-09-01" } as PoSummary;

beforeEach(() => {
  vi.spyOn(billing, "getCompany").mockResolvedValue({ name: "Test company", currency: "AED" } as CompanyProfile);
  vi.spyOn(crm, "customers").mockResolvedValue([customer]);
  vi.spyOn(billing, "listDocs").mockResolvedValue([doc]);
  vi.spyOn(quotes, "listDocs").mockResolvedValue([]);
  vi.spyOn(erp, "orders").mockResolvedValue([]);
  vi.spyOn(crm, "opportunities").mockResolvedValue([]);
  vi.spyOn(receipts, "list").mockResolvedValue([]);
  vi.spyOn(billing, "payments").mockResolvedValue([]);
  vi.spyOn(advances, "forParty").mockResolvedValue([]);
  vi.spyOn(suppliers, "list").mockResolvedValue([{ id: 1, name: "Test supplier", created_at: "2026-09-01" }]);
  vi.spyOn(pos, "list").mockResolvedValue([po]);
  vi.spyOn(pos, "payments").mockResolvedValue([]);
  vi.spyOn(pdfTools, "downloadElementAsPdf").mockResolvedValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

function open(kind: "customer" | "supplier") {
  return render(<MemoryRouter initialEntries={["/party/1"]}><Routes>
    <Route path="/party/:id" element={kind === "customer" ? <CustomerDetail /> : <SupplierDetail />} />
  </Routes></MemoryRouter>);
}

for (const kind of ["customer", "supplier"] as const) {
  it(`${kind} statements block incomplete exports and retry missing payment data`, async () => {
    const payments = kind === "customer" ? billing.payments : pos.payments;
    vi.mocked(payments).mockRejectedValueOnce(new Error("Payment read failed"));
    const view = open(kind);
    await view.findByRole("button", { name: "Retry statement" });
    expect(view.getByRole("button", { name: "Download PDF" })).toBeDisabled();
    expect(view.getByRole("button", { name: "Print" })).toBeDisabled();
    expect(view.getByRole("button", { name: "Email" })).toBeDisabled();
    expect(view.queryByText("All settled")).not.toBeInTheDocument();
    vi.mocked(payments).mockResolvedValue([{ id: 10, invoice_id: doc.id, po_id: po.id, amount: 60, paid_at: "2026-09-02", method: "cash" }]);
    fireEvent.click(view.getByRole("button", { name: "Retry statement" }));
    await waitFor(() => expect(view.getByRole("button", { name: "Download PDF" })).toBeEnabled());
    expect(view.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Download PDF" }));
    await waitFor(() => expect(pdfTools.downloadElementAsPdf).toHaveBeenCalledTimes(1));
    expect(vi.mocked(pdfTools.downloadElementAsPdf).mock.calls[0][0].textContent).toContain("40.00");
  });
}

it("does not issue a customer statement when its receipt source is unavailable", async () => {
  vi.mocked(receipts.list).mockRejectedValue(new Error("Receipt read failed"));
  const view = open("customer");
  await view.findByRole("alert");
  expect(view.queryByRole("button", { name: "Download PDF" })).not.toBeInTheDocument();
  expect(pdfTools.downloadElementAsPdf).not.toHaveBeenCalled();
});

it("keeps customer statement amounts in one currency and excludes AED opening balances and advances", async () => {
  vi.mocked(billing.listDocs).mockResolvedValue([doc, { ...doc, id: 3, number: "AED-OTHER", currency: "AED", total: 900 }]);
  vi.mocked(receipts.list).mockResolvedValue([{ id: 4, number: "RCPT-AED", customer_name: customer.name, status: "issued", template: "voucher", currency: "AED", amount: 800, payment_date: "2026-09-02", updated_at: "2026-09-02" }]);
  vi.mocked(advances.forParty).mockResolvedValue([{ id: 5, party_type: "customer", party_id: 1, party_name: customer.name, amount: 50, paid_at: "2026-09-02", created_at: "2026-09-02" }]);
  const view = open("customer");
  await waitFor(() => expect(view.getByRole("button", { name: "Download PDF" })).toBeEnabled());
  fireEvent.click(view.getByRole("button", { name: "Download PDF" }));
  await waitFor(() => expect(pdfTools.downloadElementAsPdf).toHaveBeenCalledTimes(1));
  const exported = vi.mocked(pdfTools.downloadElementAsPdf).mock.calls[0][0].textContent;
  expect(exported).toContain("$100.00");
  expect(exported).toContain("100.00");
  expect(exported).not.toContain("AED-OTHER");
  expect(exported).not.toContain("RCPT-AED");
});

it("exports the selected sales journal instead of silently downloading the ledger", async () => {
  vi.spyOn(salesJournal, "buildSalesJournal").mockResolvedValue({
    currency: "USD",
    company: { name: "Test company" }, customer: { name: customer.name },
    period: { from: "01 Sep 2026", to: "01 Oct 2026" },
    summary: { totalSales: 100, totalReceived: 0, totalVat: 0, netBalance: 100 },
    transactions: [{ date: "01 Sep 2026", description: "Unique journal line", unit: "hour", qty: "1", rate: "100", amount: "100", vat: "0", total: "100", invoiceNo: doc.number, received: "—" }],
  });
  const view = open("customer");
  await waitFor(() => expect(view.getByRole("button", { name: "Download PDF" })).toBeEnabled());
  fireEvent.click(view.getByRole("button", { name: "Sales Journal" }));
  await waitFor(() => expect(view.getByRole("button", { name: "Download PDF" })).toBeEnabled());
  fireEvent.click(view.getByRole("button", { name: "Download PDF" }));
  await waitFor(() => expect(pdfTools.downloadElementAsPdf).toHaveBeenCalledTimes(1));
  const [element, name] = vi.mocked(pdfTools.downloadElementAsPdf).mock.calls[0];
  expect(element.textContent).toContain("Unique journal line");
  expect(name).toMatch(/^Sales-Journal-/);
});

it("uses the saved customer ID after a rename and never inherits another customer's matching name", async () => {
  const journal = vi.spyOn(salesJournal, "buildSalesJournal").mockRejectedValue(new Error("Journal probe"));
  vi.mocked(crm.customers).mockResolvedValue([customer, { ...customer, id: 2 }]);
  vi.mocked(billing.listDocs).mockResolvedValue([
    { ...doc, customer_id: 1, customer_name: "Name before rename" },
    { ...doc, id: 3, number: "FOREIGN-INVOICE", customer_id: 2, total: 900 },
    { ...doc, id: 4, number: "AMBIGUOUS-LEGACY", total: 450 },
  ]);
  vi.mocked(receipts.list).mockResolvedValue([{ id: 5, number: "AMBIGUOUS-RECEIPT", customer_name: customer.name, status: "issued", template: "voucher", currency: "USD", amount: 800, payment_date: "2026-09-02", updated_at: "2026-09-02" }]);
  const view = open("customer");
  await waitFor(() => expect(view.getByRole("button", { name: "Download PDF" })).toBeEnabled());
  fireEvent.click(view.getByRole("button", { name: "Download PDF" }));
  await waitFor(() => expect(pdfTools.downloadElementAsPdf).toHaveBeenCalledTimes(1));
  const exported = vi.mocked(pdfTools.downloadElementAsPdf).mock.calls[0][0].textContent;
  expect(exported).toContain(doc.number);
  expect(exported).toContain("$100.00");
  expect(exported).not.toContain("FOREIGN-INVOICE");
  expect(exported).not.toContain("AMBIGUOUS-");
  fireEvent.click(view.getByRole("button", { name: "Sales Journal" }));
  await waitFor(() => expect(journal).toHaveBeenCalledTimes(1));
  expect(journal.mock.calls[0][0].invoiceIds).toEqual([doc.id]);
  expect(journal.mock.calls[0][0].receipts).toEqual([]);
});
