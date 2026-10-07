import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor, cleanup, within, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { ReactElement } from "react";
import { UIProvider } from "../../lib/ui";
import { notifyDataChanged } from "../../lib/realtime";
import { AuthProvider } from "../../lib/auth";
import { billing, erp, hr, pos, quotes, receipts, recurrences, tools, setCacheOrg, type CompanyProfile, type Employee, type Payroll, type InvoiceDoc, type Product, type QuotationDoc, type ReceiptDoc, type ReceiptSummary, type PoSummary } from "../../lib/api";
import * as filesApi from "../../lib/files";
import * as pdfTools from "../../lib/pdfTools";
import * as emailApi from "../../lib/email";
import * as csvApi from "../../lib/csv";
import * as localPaths from "../../lib/localPaths";
import * as invoiceXml from "../../lib/einvoiceXml";
import * as exchangeRates from "../../lib/exchange-rates";
import * as documentMessage from "../../lib/documentMessage";
import Inventory from "../Inventory";
import PaymentReceipt from "../PaymentReceipt";
import PayslipPage from "../PayslipPage";
import Quoting from "../Quoting";
import DeliveryChallan from "../DeliveryChallan";
import Invoicing from "../Invoicing";
import PurchaseOrders from "../PurchaseOrders";
import * as documentNumbers from "../../lib/documentNumbers";
import { money, todayYmd } from "../../lib/format";

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

  it("locks invoice editing while a save is pending and restores it after acknowledgement", async () => {
    let finish!: (id: number) => void;
    vi.spyOn(billing, "saveDoc").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = wrap(<Invoicing />);
    await view.findByText("INV-AUDIT");
    setCacheOrg("document-test-org", "document-test-user");
    fireEvent.click(view.getByRole("button", { name: "More actions" }));
    fireEvent.click(await view.findByRole("menuitem", { name: "Edit" }));
    const number = await view.findByLabelText("Invoice Number");
    fireEvent.click(view.getByTitle("Save without sending (Ctrl+S)"));
    await waitFor(() => expect(billing.saveDoc).toHaveBeenCalledOnce());
    expect(number).toBeDisabled();
    expect(view.getByRole("button", { name: "Back" })).toBeDisabled();
    await act(async () => { finish(10); });
    expect(number).toBeEnabled();
  });

  it("makes e-invoice checking and messaging directly accessible beside save and PDF", async () => {
    // Cloud rows created before electronic identities were added contain null.
    vi.spyOn(billing, "getCompany").mockResolvedValue({ ...company, einvoice: null });
    vi.spyOn(billing, "getDoc").mockResolvedValue({ ...invoice, einvoice: { seller: null, buyer: null } });
    const save = vi.spyOn(billing, "saveDoc").mockResolvedValue(10);
    const view = wrap(<Invoicing />);
    await view.findByText("INV-AUDIT");
    setCacheOrg("document-test-org", "document-test-user");
    fireEvent.click(view.getByRole("button", { name: "More actions" }));
    fireEvent.click(await view.findByRole("menuitem", { name: "Edit" }));
    const actions = within(await view.findByRole("group", { name: "Invoice actions" }));
    for (const name of ["Save", "Download PDF", "Company", "WhatsApp", "Messages", "Email", "Mark as done"])
      expect(actions.getByRole("button", { name })).toBeVisible();
    expect(actions.queryByRole("button", { name: "More" })).toBeNull();
    const check = actions.getByRole("button", { name: "Check E-invoice" });
    expect(check).toHaveClass("btn-primary");
    fireEvent.click(check);
    const review = within(await view.findByRole("dialog", { name: "Check E-invoice" }));
    expect(review.getAllByRole("tab")).toHaveLength(5);
    fireEvent.mouseDown(review.getByRole("tab", { name: /^Seller/ }), { button: 0, ctrlKey: false });
    fireEvent.change(review.getByRole("textbox", { name: "Own FTA-issued TRN" }), { target: { value: "123456789012345" } });
    fireEvent.change(review.getByLabelText(/^Seller street address/), { target: { value: "Edited invoice seller address" } });
    expect(review.getByRole("textbox", { name: "Own FTA-issued TRN" })).toHaveValue("123456789012345");
    expect(review.getByRole("button", { name: "Save & export XML" })).toBeDisabled();
    fireEvent.click(review.getByRole("button", { name: "Back to invoice" }));
    await waitFor(() => expect(view.queryByRole("dialog", { name: "Check E-invoice" })).toBeNull());
    fireEvent.click(actions.getByRole("button", { name: "Check E-invoice" }));
    const reopened = within(await view.findByRole("dialog", { name: "Check E-invoice" }));
    expect(reopened.getByRole("textbox", { name: "Own FTA-issued TRN" })).toHaveValue("123456789012345");
    expect(reopened.getByLabelText(/^Seller street address/)).toHaveValue("Edited invoice seller address");
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps reverse-charge details in line metadata through editor save", async () => {
    vi.spyOn(billing, "getDoc").mockResolvedValue({ ...invoice, tax_rate: 0,
      items: [{ ...invoice.items[0], tax_category: "AE", custom: { einvoice_nature: "DL8.48.8.2", einvoice_gtin: "1234567890128" } }] });
    const save = vi.spyOn(billing, "saveDoc").mockResolvedValue(10);
    const view = wrap(<Invoicing />);
    await view.findByText("INV-AUDIT");
    setCacheOrg("document-test-org", "document-test-user");
    fireEvent.click(view.getByRole("button", { name: "More actions" }));
    fireEvent.click(await view.findByRole("menuitem", { name: "Edit" }));
    fireEvent.mouseDown(await view.findByRole("tab", { name: /Items/ }), { button: 0, ctrlKey: false });
    const gtin = await view.findByRole("textbox", { name: "GTIN product identifier for line 1" });
    expect(gtin).toHaveValue("1234567890128");
    expect(view.getByRole("combobox", { name: "Tax category for line 1" })).toBeVisible();
    fireEvent.change(gtin, { target: { value: "012345678905" } });
    fireEvent.click(view.getByTitle("Save without sending (Ctrl+S)"));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({
      items: expect.arrayContaining([expect.objectContaining({ tax_category: "AE", custom: expect.objectContaining({
        einvoice_nature: "DL8.48.8.2", einvoice_gtin: "012345678905",
      }) })]),
    })));
  });

  it("jumps from a classification issue to its actual editable line field and preserves the correction", async () => {
    vi.spyOn(billing, "getDoc").mockResolvedValue({ ...invoice,
      items: [{ ...invoice.items[0], unit: "pcs", custom: { einvoice_item_type: "G" } }] });
    const save = vi.spyOn(billing, "saveDoc").mockResolvedValue(10);
    const view = wrap(<Invoicing />);
    await view.findByText("INV-AUDIT");
    setCacheOrg("document-test-org", "document-test-user");
    fireEvent.click(view.getByRole("button", { name: "More actions" }));
    fireEvent.click(await view.findByRole("menuitem", { name: "Edit" }));
    fireEvent.click(await view.findByRole("button", { name: "Check E-invoice" }));
    const review = within(await view.findByRole("dialog", { name: "Check E-invoice" }));
    fireEvent.mouseDown(review.getByRole("tab", { name: /^Items/ }), { button: 0, ctrlKey: false });
    fireEvent.click(review.getByRole("button", { name: /Edit:.*HS classification code/ }));
    const hsCode = await view.findByRole("textbox", { name: "HS classification code for line 1" });
    await waitFor(() => expect(hsCode).toHaveFocus());
    expect(view.getByRole("tabpanel")).toHaveAccessibleName("Items 1");
    fireEvent.change(hsCode, { target: { value: "847130" } });
    fireEvent.click(view.getByTitle("Save without sending (Ctrl+S)"));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({
      items: expect.arrayContaining([expect.objectContaining({ custom: expect.objectContaining({ einvoice_item_type: "G", einvoice_hs_code: "847130" }) })]),
    })));
  });

  it("reports a native PDF failure and releases the export button without saving", async () => {
    const save = vi.spyOn(billing, "saveDoc").mockResolvedValue(10);
    vi.spyOn(pdfTools, "downloadElementAsPdf").mockRejectedValue(new Error("Folder is read-only"));
    const view = wrap(<Invoicing />);
    await view.findByText("INV-AUDIT");
    setCacheOrg("document-test-org", "document-test-user");
    fireEvent.click(view.getByRole("button", { name: "More actions" }));
    fireEvent.click(await view.findByRole("menuitem", { name: "Edit" }));
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
    fireEvent.click(view.getByRole("button", { name: "More actions" }));
    fireEvent.click(await view.findByRole("menuitem", { name: "Edit" }));
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

  it("exposes pricing beside VAT and shows missing numeric measures before a custom calculation is saved", async () => {
    vi.spyOn(billing, "getDoc").mockResolvedValue({ ...invoice,
      custom_columns: [{ key: "liters", label: "Total litres" }],
      items: [{ description: "Oil", qty: 20, unit_price: 4.1, custom: {} }],
    });
    const save = vi.spyOn(billing, "saveDoc").mockResolvedValue(10);
    const view = wrap(<Invoicing />);
    await view.findByText("INV-AUDIT");
    setCacheOrg("document-test-org", "document-test-user");
    fireEvent.click(view.getByRole("button", { name: "More actions" }));
    fireEvent.click(await view.findByRole("menuitem", { name: "Edit" }));
    fireEvent.mouseDown(await view.findByRole("tab", { name: /Items/ }), { button: 0, ctrlKey: false });
    const toolbar = within(view.getByRole("group", { name: "Invoice line controls" }));
    expect(toolbar.getByLabelText("Document tax rate percent")).toBeVisible();
    expect(toolbar.getByRole("checkbox", { name: "Line details" })).toBeVisible();
    expect(view.queryByRole("button", { name: "Line options" })).toBeNull();
    fireEvent.keyDown(toolbar.getByRole("combobox", { name: "Invoice pricing calculation" }), { key: "Enter" });
    fireEvent.keyDown(await view.findByRole("option", { name: "Total litres × unit price" }), { key: "Enter" });
    const measure = view.getByRole("textbox", { name: "Total litres for line 1" });
    expect(measure).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(measure, { target: { value: "400kg" } });
    expect(measure).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(measure, { target: { value: "400" } });
    expect(measure).not.toHaveAttribute("aria-invalid");
    expect(within(measure.closest("tr")!).getByText(/1,640\.00/)).toBeVisible();
    fireEvent.click(view.getByTitle("Save without sending (Ctrl+S)"));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({
      unit_price_formula: { a: "liters", b: "unit_price" },
      items: [expect.objectContaining({ qty: 20, unit_price: 4.1, custom: expect.objectContaining({ liters: "400" }) })],
    })));
  });

  it("restores quantity pricing when its custom column is removed and keeps unrelated formulas and manual amounts", async () => {
    vi.spyOn(billing, "getDoc").mockResolvedValue({ ...invoice,
      custom_columns: [{ key: "liters", label: "Total litres" }, { key: "length", label: "Length" }],
      unit_price_formula: { a: "liters", b: "unit_price" },
      items: [
        { description: "Oil", qty: 20, unit_price: 4.1, custom: { liters: "400", __calc_mode: "formula", __formula_a: "liters", __formula_b: "unit_price" } },
        { description: "Manual service", qty: 1, unit_price: 75, custom: { liters: "1", __calc_mode: "manual", __manual_amount: "75" } },
        { description: "Wire", qty: 2, unit_price: 10, custom: { length: "9", __calc_mode: "formula", __formula_a: "length", __formula_b: "unit_price" } },
      ],
    });
    const save = vi.spyOn(billing, "saveDoc").mockResolvedValue(10);
    const view = wrap(<Invoicing />);
    await view.findByText("INV-AUDIT");
    setCacheOrg("document-test-org", "document-test-user");
    fireEvent.click(view.getByRole("button", { name: "More actions" }));
    fireEvent.click(await view.findByRole("menuitem", { name: "Edit" }));
    fireEvent.mouseDown(await view.findByRole("tab", { name: /Items/ }), { button: 0, ctrlKey: false });
    fireEvent.click(view.getAllByTitle("Remove column")[0]);
    expect(view.getByRole("combobox", { name: "Invoice pricing calculation" })).toHaveTextContent("Quantity × unit price");
    expect(within(view.getByRole("textbox", { name: "Description for line 1" }).closest("tr")!).getByText(/82\.00/)).toBeVisible();
    expect(view.getByLabelText("Line amount for line 2")).toHaveValue(75);
    expect(view.getByRole("combobox", { name: "Calculation for line 3" })).toHaveTextContent("Length × unit price");
    fireEvent.click(view.getByTitle("Save without sending (Ctrl+S)"));
    await waitFor(() => expect(save).toHaveBeenCalled());
    const payload = save.mock.calls[0][0];
    expect(payload.unit_price_formula).toBeNull();
    expect(payload.custom_columns).toEqual([{ key: "length", label: "Length" }]);
    expect(payload.items[0].custom).not.toHaveProperty("__formula_a");
    expect(payload.items[1].custom).toMatchObject({ __calc_mode: "manual", __manual_amount: "75" });
    expect(payload.items[2].custom).toMatchObject({ length: "9", __calc_mode: "formula", __formula_a: "length" });
  });

  it.each(["canceled", "failed"] as const)("does not report XML export success when native saving is %s", async (outcome) => {
    const save = vi.spyOn(billing, "saveDoc").mockResolvedValue(10);
    vi.spyOn(invoiceXml, "validateEInvoice").mockReturnValue({ errors: [], warnings: [] });
    vi.spyOn(invoiceXml, "eInvoiceIssues").mockReturnValue([]);
    vi.spyOn(billing, "getDoc").mockResolvedValue({ ...invoice, einvoice: { uuid: "e054df09-2f88-41ee-a45e-559f1d5f5408" } });
    vi.spyOn(invoiceXml, "buildInvoiceXml").mockReturnValue("<Invoice />");
    const write = vi.spyOn(localPaths, "saveBytes");
    if (outcome === "canceled") write.mockResolvedValue(null);
    else write.mockRejectedValue(new Error("Folder is read-only"));
    const view = wrap(<Invoicing />);
    await view.findByText("INV-AUDIT");
    setCacheOrg("document-test-org", "document-test-user");
    fireEvent.click(view.getByRole("button", { name: "More actions" }));
    fireEvent.click(await view.findByRole("menuitem", { name: "Edit" }));
    fireEvent.click(await view.findByRole("button", { name: "Check E-invoice" }));
    fireEvent.click(await view.findByRole("button", { name: "Save & export XML" }));
    await waitFor(() => expect(write).toHaveBeenCalledWith("INV-AUDIT.xml", new TextEncoder().encode("<Invoice />"), "application/xml"));
    if (outcome === "failed") expect(await view.findByText("Folder is read-only")).toBeTruthy();
    expect(view.queryByText("e-Invoice XML exported (PINT-AE).")).toBeNull();
    expect(view.queryByText(/XML exported\. Recommended/)).toBeNull();
    expect(save).toHaveBeenCalled();
  });
});

describe("receipt actions", () => {
  it("keeps the saved receipt id and can finalize when the list refresh fails", async () => {
    const list = vi.spyOn(receipts, "list").mockResolvedValue([receiptRow]);
    vi.spyOn(receipts, "get").mockResolvedValue(receipt);
    vi.spyOn(documentNumbers, "allocateDocumentNumber").mockResolvedValue("RCPT-COPY");
    let finish!: (id: number) => void;
    const save = vi.spyOn(receipts, "save").mockResolvedValue(9).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const status = vi.spyOn(receipts, "setStatus").mockResolvedValue(undefined);
    const view = wrap(<PaymentReceipt />);
    fireEvent.click(await view.findByText("RCPT-AUDIT"));
    await view.findByDisplayValue("120");
    setCacheOrg("document-test-org", "document-test-user");
    fireEvent.click(view.getByRole("button", { name: "Duplicate" }));
    await view.findByDisplayValue("RCPT-COPY");
    list.mockRejectedValue(new Error("Connection interrupted"));
    fireEvent.click(view.getByRole("button", { name: "Mark paid" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(view.getByRole("button", { name: "Duplicate" })).toBeDisabled();
    expect(view.getByDisplayValue("120")).toBeDisabled();
    await act(async () => { finish(9); });
    await waitFor(() => expect(status).toHaveBeenCalledWith(9, "paid"));
    await waitFor(() => expect(view.getByRole("button", { name: "Save" })).toBeEnabled());
    expect(view.queryByText(/^Save failed:/)).toBeNull();
    expect(view.getByRole("heading", { name: "Edit Receipt" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0]).toMatchObject({ id: 9, number: "RCPT-COPY", status: "paid" });
  });

  it("does not copy an app login link or claim sharing success after public sharing fails", async () => {
    vi.spyOn(receipts, "list").mockResolvedValue([receiptRow]);
    vi.spyOn(documentMessage, "receiptPublicLink").mockRejectedValue(new Error("Public sharing is unavailable"));
    const view = wrap(<PaymentReceipt />);
    await view.findByText("RCPT-AUDIT");
    fireEvent.click(view.getByRole("button", { name: "More actions" }));
    fireEvent.click(await view.findByRole("menuitem", { name: "Copy link" }));
    expect(await view.findByText("Public sharing is unavailable")).toBeTruthy();
    expect(view.queryByText("Public receipt link copied")).toBeNull();
  });

  it("keeps the latest selected receipt when a slower earlier load finishes", async () => {
    const second = { ...receipt, id: 9, number: "RCPT-SECOND", amount: 200 };
    vi.spyOn(receipts, "list").mockResolvedValue([receiptRow, { ...second, payment_date: "2026-09-07" }]);
    let finishFirst!: (row: ReceiptDoc) => void;
    const first = new Promise<ReceiptDoc>(resolve => { finishFirst = resolve; });
    vi.spyOn(receipts, "get").mockImplementation(id => id === 7 ? first : Promise.resolve(second));
    const view = wrap(<PaymentReceipt />);
    fireEvent.click(await view.findByText("RCPT-AUDIT"));
    fireEvent.click(view.getByText("RCPT-SECOND"));
    await view.findByDisplayValue("200");
    await act(async () => { finishFirst(receipt); await first; });
    expect(view.getByDisplayValue("200")).toBeTruthy();
    expect(view.queryByDisplayValue("120")).toBeNull();
  });

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

  it("counts only confirmed receipts as received money while keeping draft currencies and history", async () => {
    const date = todayYmd();
    vi.spyOn(receipts, "list").mockResolvedValue([
      { ...receiptRow, status: "paid", amount: 120, payment_date: date },
      { ...receiptRow, id: 8, number: "RCPT-DRAFT", amount: 9000, payment_date: date },
      { ...receiptRow, id: 9, number: "RCPT-CANCELLED", status: "cancelled", amount: 8000, payment_date: date },
      { ...receiptRow, id: 10, number: "RCPT-AED-DRAFT", currency: "AED", amount: 252, payment_date: date },
      { ...receiptRow, id: 11, number: "RCPT-OLDER", status: "paid", amount: 40, payment_date: "2020-01-01" },
    ]);
    const view = wrap(<PaymentReceipt />);
    const total = await view.findByText("Total received (USD)");
    expect(total.parentElement?.parentElement).toHaveTextContent(money(160, "USD").replace(/\s/g, " "));
    expect(total.parentElement?.parentElement).toHaveTextContent("2 confirmed receipts");
    expect(view.getByText("This month (USD)").parentElement?.parentElement).toHaveTextContent(money(120, "USD").replace(/\s/g, " "));
    expect(view.getByText("Total received (AED)").parentElement?.parentElement).toHaveTextContent(money(0, "AED").replace(/\s/g, " "));
    expect(view.getByText("This month (AED)").parentElement?.parentElement).toHaveTextContent(money(0, "AED").replace(/\s/g, " "));
    expect(view.getByText("RCPT-DRAFT")).toBeTruthy();
    expect(view.getByText("RCPT-CANCELLED")).toBeTruthy();
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

it("keeps purchase-order dashboard amounts in their own currencies", async () => {
  vi.spyOn(pos, "list").mockResolvedValue([
    { id: 1, po_number: "PO-USD", supplier_name: "Supplier", status: "draft", total: 120, currency: "USD" },
    { id: 2, po_number: "PO-AED", supplier_name: "Supplier", status: "draft", total: 50, currency: "AED" },
  ] as PoSummary[]);
  const view = wrap(<PurchaseOrders />);
  const usd = await view.findByText("Total value (USD)");
  const aed = view.getByText("Total value (AED)");
  expect(usd.parentElement?.parentElement).toHaveTextContent(/120/);
  expect(aed.parentElement?.parentElement).toHaveTextContent(/50/);
  expect(view.queryByText("Total Value")).toBeNull();
});

it("locks purchase-order editing while its saved snapshot is pending", async () => {
  const purchaseOrder = { id: 1, po_number: "PO-SAVE", supplier_name: "Supplier", status: "draft", total: 120, currency: "USD", items: [{ description: "Stock", quantity: 1, unit_cost: 120 }] } as Awaited<ReturnType<typeof pos.get>>;
  vi.spyOn(pos, "list").mockResolvedValue([{ ...purchaseOrder, supplier_name: "Supplier", items_count: 1 }]);
  vi.spyOn(pos, "get").mockResolvedValue(purchaseOrder);
  let finish!: (id: number) => void;
  vi.spyOn(pos, "save").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = wrap(<PurchaseOrders />);
  await view.findByText("PO-SAVE");
  fireEvent.click(view.getByRole("button", { name: "More actions" }));
  fireEvent.click(await view.findByRole("menuitem", { name: "Edit" }));
  const supplier = await view.findByLabelText("Supplier Name");
  fireEvent.click(view.getAllByRole("button", { name: "Save" })[0]);
  await waitFor(() => expect(pos.save).toHaveBeenCalledOnce());
  expect(supplier).toBeDisabled();
  expect(view.getByRole("button", { name: "Duplicate" })).toBeDisabled();
  await act(async () => { finish(1); });
  expect(supplier).toBeEnabled();
});

it("does not silently drop a priced purchase-order line with an empty description", async () => {
  const purchaseOrder = { id: 1, po_number: "PO-LINES", supplier_name: "Supplier", status: "draft", total: 125, currency: "USD", items: [{ description: "Stock", quantity: 1, unit_cost: 120 }, { description: "", quantity: 1, unit_cost: 5 }] } as Awaited<ReturnType<typeof pos.get>>;
  vi.spyOn(pos, "list").mockResolvedValue([{ ...purchaseOrder, supplier_name: "Supplier", items_count: 2 }]);
  vi.spyOn(pos, "get").mockResolvedValue(purchaseOrder);
  vi.spyOn(pos, "save").mockResolvedValue(1);
  const view = wrap(<PurchaseOrders />);
  await view.findByText("PO-LINES");
  fireEvent.click(view.getByRole("button", { name: "More actions" }));
  fireEvent.click(await view.findByRole("menuitem", { name: "Edit" }));
  await view.findByLabelText("Supplier Name");
  fireEvent.click(view.getAllByRole("button", { name: "Save" })[0]);
  expect(await view.findByText("Add a description to every priced item before saving.")).toBeTruthy();
  expect(pos.save).not.toHaveBeenCalled();
  const descriptions = view.getAllByPlaceholderText("Item description");
  fireEvent.change(descriptions[1], { target: { value: "Freight charge" } });
  fireEvent.click(view.getAllByRole("button", { name: "Save" })[0]);
  await waitFor(() => expect(pos.save).toHaveBeenCalledWith(expect.objectContaining({ items: [expect.objectContaining({ description: "Stock", unit_cost: 120 }), expect.objectContaining({ description: "Freight charge", unit_cost: 5 })] })));
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

it("exports the recorded payslip amounts after the employee's salary changes", async () => {
  vi.spyOn(hr, "employees").mockResolvedValue([{ id: 1, name: "Test employee", salary: 6000 } as Employee]);
  vi.spyOn(hr, "payroll").mockResolvedValue([{
    id: 1, employee_id: 1, employee_name: "Test employee", period: "2026-06",
    basic: 5000, allowances: 250, deductions: 50, net_pay: 5200, status: "paid",
  } as Payroll]);
  const post = vi.spyOn(hr, "runPayroll").mockResolvedValue(1);
  const download = vi.spyOn(pdfTools, "downloadElementAsPdf").mockResolvedValue(true);
  const page = render(<MemoryRouter initialEntries={["/people/1/payslip"]}><UIProvider><Routes><Route path="/people/:id/payslip" element={<PayslipPage />} /></Routes></UIProvider></MemoryRouter>);
  fireEvent.change(await page.findByLabelText("Month"), { target: { value: "2026-06" } });
  expect(page.getByLabelText(/Basic Salary/)).toHaveValue(5000);
  expect(page.getByLabelText(/Allowances/)).toHaveValue(250);
  expect(page.getByLabelText(/Allowances/)).toBeDisabled();
  expect(page.getByLabelText(/Deductions/)).toHaveValue(50);
  expect(page.getByLabelText(/Deductions/)).toBeDisabled();
  fireEvent.click(page.getByRole("button", { name: "Download PDF" }));
  await waitFor(() => expect(download).toHaveBeenCalledOnce());
  const sheet = download.mock.calls[0][0] as HTMLElement;
  expect(sheet.textContent).toContain("5,200.00");
  expect(sheet.textContent).not.toContain("6,000.00");
  expect(post).not.toHaveBeenCalled();
  fireEvent.change(page.getByLabelText("Month"), { target: { value: "" } });
  expect(page.getByRole("button", { name: "Download PDF" })).toBeDisabled();
  expect(page.getByRole("button", { name: "Save payslip" })).toBeDisabled();
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
  setCacheOrg("document-test-org", "document-test-user");
  fireEvent.click(create);
  fireEvent.click(await view.findByRole("button", { name: "Save" }));
  expect(await view.findByText("Device storage is full")).toBeTruthy();
  expect(save).toHaveBeenCalledOnce();
  expect(view.getByRole("button", { name: "Save" })).not.toBeDisabled();
  expect(view.queryByText("Challan saved.")).toBeNull();
  expect(filesApi.autoSaveDocument).not.toHaveBeenCalled();
});

it("preserves delivery edits when the company profile loads slowly", async () => {
  vi.spyOn(tools, "settings").mockResolvedValue([]);
  let finish!: (profile: CompanyProfile) => void;
  vi.mocked(billing.getCompany).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = wrap(<DeliveryChallan />);
  const create = await view.findByRole("button", { name: "Assign driver" });
  await waitFor(() => expect(create).toBeEnabled());
  setCacheOrg("document-test-org", "document-test-user");
  fireEvent.click(create);
  const party = await view.findByLabelText("Party Name");
  fireEvent.change(party, { target: { value: "Unsaved recipient" } });
  await act(async () => { finish(company); });
  expect(party).toHaveValue("Unsaved recipient");
});

