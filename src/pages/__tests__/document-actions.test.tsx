import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { ReactElement } from "react";
import { UIProvider } from "../../lib/ui";
import { notifyDataChanged } from "../../lib/realtime";
import { AuthProvider } from "../../lib/auth";
import { billing, erp, hr, quotes, receipts, recurrences, tools, setCacheOrg, type CompanyProfile, type Employee, type InvoiceDoc, type Product, type QuotationDoc, type ReceiptDoc, type ReceiptSummary } from "../../lib/api";
import * as filesApi from "../../lib/files";
import * as pdfTools from "../../lib/pdfTools";
import * as emailApi from "../../lib/email";
import * as csvApi from "../../lib/csv";
import * as localPaths from "../../lib/localPaths";
import * as invoiceXml from "../../lib/einvoiceXml";
import * as exchangeRates from "../../lib/exchange-rates";
import Inventory from "../Inventory";
import PaymentReceipt from "../PaymentReceipt";
import PayslipPage from "../PayslipPage";
import Quoting from "../Quoting";
import DeliveryChallan from "../DeliveryChallan";
import Invoicing from "../Invoicing";

// Action tests exercise the live editor/document, not four extra miniature
// documents. Real thumbnail rendering is covered by doc-template-gallery.test.
vi.mock("../../components/TemplateTilePreview", () => ({ default: () => null }));

const nativeExports = vi.hoisted(() => ({ enabled: false }));
vi.mock("../../lib/localPaths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/localPaths")>();
  return { ...actual, get hasTauri() { return nativeExports.enabled; } };
});

// ── Mock the data boundary: a chainable, awaitable stub that always yields
// {data:[], error:null}. Covers pages that call sb() directly and via lib/api. ──
vi.mock("../../lib/supabase", () => {
  const result = { data: [], error: null, count: 0 };
  const makeQuery = (): unknown => {
    const proxy: unknown = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === "then") return (res: (v: unknown) => void) => res(result);
        return () => proxy; // every builder method is chainable
      },
      apply: () => proxy,
    });
    return proxy;
  };
  const sb = () => ({
    from: makeQuery,
    rpc: makeQuery,
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
    },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => {},
    storage: {
      from: () => ({
        upload: async () => ({ data: null, error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "" } }),
      }),
    },
  });
  return { sb, supabase: null, isConfigured: true, cloudConfigured: false };
});

// Force local mode so anything reading the data mode behaves deterministically.
vi.mock("../../lib/dataMode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/dataMode")>()),
  isLocalMode: () => true,
  getDataMode: () => "local",
  effectiveDataMode: () => "local" as const,
  setDataMode: () => {},
  assertWorkspaceCurrent: () => {},
}));

// Tauri isn't present in jsdom — make invoke a no-op resolve.
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => null }));

function wrap(node: ReactElement) {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <UIProvider>{node}</UIProvider>
      </AuthProvider>
    </MemoryRouter>
  );
}

const company = { name: "Filey test company", currency: "AED", default_template: "classic", default_accent: "#111111" } as CompanyProfile;
const receipt: ReceiptDoc = {
  id: 7, number: "RCPT-AUDIT", customer_name: "Example payer", status: "draft",
  template: "voucher", amount: 120, currency: "USD", accent: "#111111",
  issue_date: "2026-09-07", created_at: "2026-09-07", updated_at: "2026-09-07",
};
const receiptRow: ReceiptSummary = { ...receipt, payment_date: "2026-09-07" };
const quotation = {
  id: 8, number: "Q-AUDIT", customer_name: "Example customer", customer_email: "customer@example.test",
  seller_name: "Filey test company", status: "draft", template: "classic", currency: "USD", accent: "#111111",
  quote_date: "2026-09-07", valid_until: "2026-10-07", total: 100,
  created_at: "2026-09-07", updated_at: "2026-09-07",
  items: [{ product: "Consultation", qty: 1, rate: 100, discount: 0, tax: 0, custom: {} }],
} as QuotationDoc;
const invoice = {
  id: 10, number: "INV-AUDIT", customer_name: "Example customer", status: "draft", doc_type: "Tax Invoice",
  seller_name: "Filey test company", template: "classic", currency: "AED", tax_country_code: "AE", accent: "#111111",
  issue_date: "2026-09-07", due_date: "2026-10-07", tax_rate: 5, discount: 0, total: 105, balance: 105,
  created_at: "2026-09-07", updated_at: "2026-09-07",
  items: [{ description: "Consultation", qty: 1, unit_price: 100, custom: {} }],
} as InvoiceDoc & { total: number; balance: number };

beforeEach(() => {
  nativeExports.enabled = false;
  vi.spyOn(billing, "getCompany").mockResolvedValue(company);
  vi.spyOn(filesApi, "autoSaveDocument").mockResolvedValue(false);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => { cleanup(); setCacheOrg(null); vi.restoreAllMocks(); });

describe("invoice editor actions", () => {
  beforeEach(() => {
    nativeExports.enabled = true;
    vi.spyOn(billing, "listDocs").mockResolvedValue([invoice]);
    vi.spyOn(billing, "getDoc").mockResolvedValue(invoice);
    vi.spyOn(recurrences, "list").mockResolvedValue([]);
    vi.spyOn(recurrences, "generateDue").mockResolvedValue(0);
    vi.spyOn(exchangeRates, "getExchangeRates").mockResolvedValue({ AED: 1 });
  });

  it("reports a native PDF failure and releases the export button without saving", async () => {
    const save = vi.spyOn(billing, "saveDoc").mockResolvedValue(10);
    vi.spyOn(pdfTools, "downloadElementAsPdf").mockRejectedValue(new Error("Folder is read-only"));
    const view = wrap(<Invoicing />);
    await view.findByText("INV-AUDIT");
    setCacheOrg("document-test-org", "document-test-user");
    fireEvent.click(view.getByRole("button", { name: "Edit" }));
    await view.findByDisplayValue("Example customer");
    const exportButton = view.getByTitle("Download PDF (Ctrl+P)");
    fireEvent.click(exportButton);
    expect(await view.findByText("Folder is read-only")).toBeTruthy();
    expect(exportButton).not.toBeDisabled();
    expect(save).not.toHaveBeenCalled();
  });

  it("preserves an advanced invoice field when its section is closed before saving", async () => {
    const save = vi.spyOn(billing, "saveDoc").mockResolvedValue(10);
    const view = wrap(<Invoicing />);
    await view.findByText("INV-AUDIT");
    setCacheOrg("document-test-org", "document-test-user");
    fireEvent.click(view.getByRole("button", { name: "Edit" }));
    const section = (await view.findByText("E-invoice details")).closest("details")!;
    const disclosure = section.querySelector("summary")!;
    expect(section).not.toHaveAttribute("open");
    fireEvent.click(disclosure);
    expect(section).toHaveAttribute("open");
    fireEvent.change(view.getByLabelText("Purchase order number"), { target: { value: "PO-COMPACT-27" } });
    fireEvent.click(disclosure);
    expect(section).not.toHaveAttribute("open");
    fireEvent.click(view.getByTitle("Save without sending (Ctrl+S)"));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({
      id: invoice.id, po_number: "PO-COMPACT-27", customer_name: invoice.customer_name,
      items: expect.arrayContaining([expect.objectContaining({ description: "Consultation", qty: 1, unit_price: 100 })]),
    })));
  });

  it.each(["canceled", "failed"] as const)("does not report XML export success when native saving is %s", async (outcome) => {
    const save = vi.spyOn(billing, "saveDoc").mockResolvedValue(10);
    vi.spyOn(invoiceXml, "validateEInvoice").mockReturnValue({ errors: [], warnings: [] });
    vi.spyOn(invoiceXml, "buildInvoiceXml").mockReturnValue("<Invoice />");
    const write = vi.spyOn(localPaths, "saveBytes");
    if (outcome === "canceled") write.mockResolvedValue(null);
    else write.mockRejectedValue(new Error("Folder is read-only"));
    const view = wrap(<Invoicing />);
    await view.findByText("INV-AUDIT");
    setCacheOrg("document-test-org", "document-test-user");
    fireEvent.click(view.getByRole("button", { name: "Edit" }));
    fireEvent.click(await view.findByRole("button", { name: "More" }));
    fireEvent.click(await view.findByRole("menuitem", { name: "XML" }));
    await waitFor(() => expect(write).toHaveBeenCalledWith("INV-AUDIT.xml", new TextEncoder().encode("<Invoice />")));
    if (outcome === "failed") expect(await view.findByText("XML export failed: Folder is read-only")).toBeTruthy();
    expect(view.queryByText("e-Invoice XML exported (PINT-AE).")).toBeNull();
    expect(view.queryByText(/XML exported\. Recommended/)).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
});

describe("receipt actions", () => {
  it("refreshes available receipts without resetting unsaved receipt edits", async () => {
    const list = vi.spyOn(receipts, "list").mockResolvedValue([receiptRow]);
    vi.spyOn(receipts, "get").mockResolvedValue(receipt);
    const save = vi.spyOn(receipts, "save").mockResolvedValue(7);
    const view = wrap(<PaymentReceipt />);
    fireEvent.click(await view.findByText("RCPT-AUDIT"));
    fireEvent.change(await view.findByDisplayValue("120"), { target: { value: "175" } });
    list.mockClear().mockResolvedValue([receiptRow, { ...receiptRow, id: 9, number: "AI-RECEIPT" }]);
    notifyDataChanged();
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(view.getByDisplayValue("175")).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });

  it("saves existing receipt edits before marking the receipt paid", async () => {
    vi.spyOn(receipts, "list").mockResolvedValue([receiptRow]);
    vi.spyOn(receipts, "get").mockResolvedValue(receipt);
    const save = vi.spyOn(receipts, "save").mockResolvedValue(7);
    const status = vi.spyOn(receipts, "setStatus").mockResolvedValue(undefined);
    const view = wrap(<PaymentReceipt />);
    fireEvent.click(await view.findByText("RCPT-AUDIT"));
    fireEvent.change(await view.findByDisplayValue("120"), { target: { value: "175" } });
    expect(view.getByRole("heading", { level: 1, name: "Edit Receipt" })).toBeTruthy();
    expect(view.queryByRole("heading", { level: 1, name: "Payment Receipts" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Mark paid" }));
    await waitFor(() => expect(status).toHaveBeenCalledWith(7, "paid"));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: 7, amount: 175, currency: "USD" }));
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(status.mock.invocationCallOrder[0]);
  });

  it("keeps mixed-currency receipt totals and exports in their original currencies", async () => {
    vi.spyOn(receipts, "list").mockResolvedValue([
      receiptRow,
      { ...receiptRow, id: 9, number: "RCPT-AED", amount: 50, currency: "AED" },
    ]);
    const csv = vi.spyOn(csvApi, "downloadCsv").mockResolvedValue(undefined);
    const view = wrap(<PaymentReceipt />);
    expect(await view.findByText("Total received (USD)")).toBeTruthy();
    expect(view.getByText("Total received (AED)")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: /export/i }));
    expect(csv).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([
      expect.objectContaining({ amount: 120, currency: "USD" }),
      expect.objectContaining({ amount: 50, currency: "AED" }),
    ]), expect.any(Array));
  });

  it("reports a native CSV failure instead of leaving an unhandled rejection", async () => {
    vi.spyOn(receipts, "list").mockResolvedValue([receiptRow]);
    vi.spyOn(csvApi, "downloadCsv").mockRejectedValue(new Error("Folder is read-only"));
    const view = wrap(<PaymentReceipt />);
    await view.findByText("RCPT-AUDIT");
    fireEvent.click(view.getByRole("button", { name: /export/i }));
    expect(await view.findByText("Folder is read-only")).toBeTruthy();
  });
});

it("searches the product category promised by the inventory search field", async () => {
  vi.spyOn(erp, "products").mockResolvedValue([
    { id: 1, sku: "CHR-1", name: "Office chair", category: "Furniture", unit_price: 80, quantity: 10 } as Product,
  ]);
  const view = wrap(<Inventory />);
  await view.findByText("Office chair");
  fireEvent.change(view.getByRole("textbox", { name: "Search SKU, name or category" }), { target: { value: "Furniture" } });
  expect(view.getByText("Office chair")).toBeTruthy();
  fireEvent.change(view.getByRole("textbox", { name: "Search SKU, name or category" }), { target: { value: "Food" } });
  expect(view.queryByText("Office chair")).toBeNull();
});

it("does not post payroll when the PDF save is canceled", async () => {
  vi.spyOn(hr, "employees").mockResolvedValue([{ id: 1, name: "Test employee", salary: 1000 } as Employee]);
  vi.spyOn(hr, "payroll").mockResolvedValue([]);
  const post = vi.spyOn(hr, "runPayroll").mockResolvedValue(1);
  const download = vi.spyOn(pdfTools, "downloadElementAsPdf").mockResolvedValue(false);
  const page = render(<MemoryRouter initialEntries={["/people/1/payslip"]}><UIProvider><Routes><Route path="/people/:id/payslip" element={<PayslipPage />} /></Routes></UIProvider></MemoryRouter>);
  fireEvent.click(await page.findByRole("button", { name: "Download PDF" }));
  await waitFor(() => expect(download).toHaveBeenCalledOnce());
  await waitFor(() => expect(page.getByRole("button", { name: "Download PDF" })).not.toBeDisabled());
  expect(post).not.toHaveBeenCalled();
});

it("blocks payroll posting after a history read failure until the history is refreshed", async () => {
  vi.spyOn(hr, "employees").mockResolvedValue([{ id: 1, name: "Test employee", salary: 1000 } as Employee]);
  const history = vi.spyOn(hr, "payroll").mockRejectedValueOnce(new Error("Offline")).mockResolvedValue([]);
  const post = vi.spyOn(hr, "runPayroll").mockResolvedValue(1);
  const page = render(<MemoryRouter initialEntries={["/people/1/payslip"]}><UIProvider><Routes><Route path="/people/:id/payslip" element={<PayslipPage />} /></Routes></UIProvider></MemoryRouter>);
  expect(await page.findByRole("button", { name: "Download PDF" })).toBeDisabled();
  expect(page.getByRole("button", { name: "Save payslip" })).toBeDisabled();
  fireEvent.click(page.getByRole("button", { name: "Refresh payroll history" }));
  await waitFor(() => expect(page.getByRole("button", { name: "Download PDF" })).not.toBeDisabled());
  expect(history).toHaveBeenCalledTimes(2);
  expect(post).not.toHaveBeenCalled();
});

describe("quotation actions", () => {
  beforeEach(() => {
    vi.spyOn(quotes, "listDocs").mockResolvedValue([{ ...quotation, total: 100 }]);
    vi.spyOn(quotes, "getDoc").mockResolvedValue(quotation);
    vi.spyOn(quotes, "publicLink").mockResolvedValue("test-link");
    vi.spyOn(exchangeRates, "getExchangeRates").mockResolvedValue({ AED: 1, USD: 1 / 3.6725 });
  });

  it("reports a native PDF failure without saving the quotation", async () => {
    const save = vi.spyOn(quotes, "saveDoc").mockResolvedValue(8);
    vi.spyOn(pdfTools, "downloadElementAsPdf").mockRejectedValue(new Error("Folder is read-only"));
    const view = wrap(<Quoting />);
    const row = await view.findByText("Q-AUDIT");
    setCacheOrg("document-test-org", "document-test-user");
    fireEvent.click(row);
    await view.findByDisplayValue("Example customer");
    fireEvent.click(view.getAllByRole("button", { name: "PDF" })[0]);
    expect(await view.findByText("Could not export quotation: Folder is read-only")).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });

  it("closes the document preview and restores focus without saving", async () => {
    const save = vi.spyOn(quotes, "saveDoc").mockResolvedValue(8);
    const view = wrap(<Quoting />);
    const row = await view.findByText("Q-AUDIT");
    setCacheOrg("document-test-org", "document-test-user");
    fireEvent.click(row);
    const preview = await view.findByRole("button", { name: "Preview" });
    preview.focus();
    fireEvent.click(preview);
    expect(await view.findByRole("dialog", { name: "Q-AUDIT" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Close dialog" }));
    await waitFor(() => expect(view.queryByRole("dialog", { name: "Q-AUDIT" })).toBeNull());
    expect(preview).toHaveFocus();
    expect(save).not.toHaveBeenCalled();
  });

  it("saves current edits and includes the generated PDF before sending", async () => {
    const save = vi.spyOn(quotes, "saveDoc").mockResolvedValue(8);
    vi.spyOn(pdfTools, "elementToPdfBytes").mockResolvedValue({ name: "quote.pdf", bytes: new Uint8Array([1, 2, 3]) });
    const send = vi.spyOn(emailApi, "sendEmail").mockResolvedValue(undefined);
    const view = wrap(<Quoting />);
    const row = await view.findByText("Q-AUDIT");
    setCacheOrg("document-test-org", "document-test-user");
    fireEvent.click(row);
    fireEvent.change(await view.findByDisplayValue("Example customer"), { target: { value: "Updated customer" } });
    fireEvent.click(view.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ customer_name: "Updated customer" }));
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ attachments: [{ filename: "Q-AUDIT.pdf", content: "AQID" }] }));
  });

  it("does not send a quotation without its PDF when rendering fails", async () => {
    const save = vi.spyOn(quotes, "saveDoc").mockResolvedValue(8);
    const pdf = vi.spyOn(pdfTools, "elementToPdfBytes").mockRejectedValue(new Error("PDF renderer failed"));
    const send = vi.spyOn(emailApi, "sendEmail").mockResolvedValue(undefined);
    const view = wrap(<Quoting />);
    const row = await view.findByText("Q-AUDIT");
    setCacheOrg("document-test-org", "document-test-user");
    fireEvent.click(row);
    await view.findByDisplayValue("Example customer");
    fireEvent.click(view.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    await waitFor(() => expect(pdf).toHaveBeenCalledOnce());
    expect(await view.findByText(/The email was not sent/)).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
  });
});

it("keeps a failed challan save open without a success toast or PDF archive", async () => {
  vi.spyOn(tools, "settings").mockResolvedValue([]);
  const save = vi.spyOn(tools, "setSetting").mockRejectedValue(new Error("Device storage is full"));
  const view = wrap(<DeliveryChallan />);
  const create = await view.findByRole("button", { name: "Assign driver" });
  await waitFor(() => expect(create).not.toBeDisabled());
  fireEvent.click(create);
  fireEvent.click(await view.findByRole("button", { name: "Save" }));
  expect(await view.findByText("Device storage is full")).toBeTruthy();
  expect(save).toHaveBeenCalledOnce();
  expect(view.getByRole("button", { name: "Save" })).not.toBeDisabled();
  expect(view.queryByText("Challan saved.")).toBeNull();
  expect(filesApi.autoSaveDocument).not.toHaveBeenCalled();
});

