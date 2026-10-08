import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor, cleanup, within, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { ReactElement } from "react";
import { UIProvider } from "../../lib/ui";
import { notifyDataChanged } from "../../lib/realtime";
import { AuthProvider } from "../../lib/auth";
import { billing, crm, suppliers, erp, hr, pos, quotes, receipts, recurrences, tools, setCacheOrg, type CompanyProfile, type Employee, type Payroll, type InvoiceDoc, type Product, type QuotationDoc, type ReceiptDoc, type ReceiptSummary, type PoSummary } from "../../lib/api";
import * as filesApi from "../../lib/files";
import * as pdfTools from "../../lib/pdfTools";
import * as reactPdf from "../../lib/reactPdf";
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

  async function openNewDraft(view: ReturnType<typeof wrap>) {
    await view.findByText("INV-AUDIT");
    setCacheOrg("document-test-org", "document-test-user");
    fireEvent.click(view.getByRole("button", { name: "New invoice" }));
    await view.findByRole("heading", { name: "New Invoice" });
  }

  async function fillNewDraft(view: ReturnType<typeof wrap>) {
    await openNewDraft(view);
    fireEvent.change(view.getByRole("textbox", { name: "Customer name" }), { target: { value: "Draft customer" } });
    fireEvent.mouseDown(view.getByRole("tab", { name: /^Items/ }), { button: 0, ctrlKey: false });
    fireEvent.change(view.getByRole("textbox", { name: "Description for line 1" }), { target: { value: "Draft item" } });
  }

  it.each(["new", "edit", "duplicate"] as const)("ignores an older %s request after another invoice is opened and edited", async action => {
    let finish!: () => void;
    if (action === "new") vi.mocked(billing.getCompany).mockImplementation(fresh => fresh
      ? new Promise(resolve => { finish = () => resolve(company); }) : Promise.resolve(company));
    else vi.mocked(billing.getDoc).mockImplementationOnce(() => new Promise(resolve => {
      finish = () => resolve({ ...invoice, customer_name: "Older loaded customer" });
    }));
    const view = wrap(<Invoicing />);
    await view.findByText("INV-AUDIT");
    setCacheOrg("document-test-org", "document-test-user");
    if (action === "new") fireEvent.click(view.getByRole("button", { name: "New invoice" }));
    else {
      fireEvent.click(view.getByRole("button", { name: "More actions" }));
      fireEvent.click(await view.findByRole("menuitem", { name: action === "edit" ? "Edit" : "Duplicate" }));
    }
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    fireEvent.click(view.getByRole("button", { name: "More actions" }));
    fireEvent.click(await view.findByRole("menuitem", { name: "Edit" }));
    const customer = await view.findByRole("textbox", { name: "Customer name" });
    fireEvent.change(customer, { target: { value: "Keep this work" } });
    await act(async () => finish());
    expect(view.getByRole("heading", { name: "Edit Invoice" })).toBeInTheDocument();
    expect(view.getByRole("textbox", { name: "Customer name" })).toHaveValue("Keep this work");
  });

  it.each(["edit", "close"] as const)("does not replace the current editor when the user chooses to %s during credit note loading", async action => {
    vi.mocked(billing.getDoc).mockResolvedValue({ ...invoice, status: "sent" });
    const view = wrap(<Invoicing />);
    await view.findByText("INV-AUDIT");
    setCacheOrg("document-test-org", "document-test-user");
    fireEvent.click(view.getByRole("button", { name: "More actions" }));
    fireEvent.click(await view.findByRole("menuitem", { name: "Edit" }));
    await view.findByRole("heading", { name: "Edit Invoice" });
    let finish!: () => void;
    vi.mocked(billing.getDoc).mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(invoice); }));
    fireEvent.click(view.getByRole("button", { name: "Create credit note" }));
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    if (action === "edit") fireEvent.change(view.getByRole("textbox", { name: "Customer name" }), { target: { value: "Keep current edit" } });
    else fireEvent.click(view.getByRole("button", { name: "Back" }));
    await act(async () => finish());
    if (action === "edit") {
      expect(view.getByRole("heading", { name: "Edit Invoice" })).toBeInTheDocument();
      expect(view.getByRole("textbox", { name: "Customer name" })).toHaveValue("Keep current edit");
    } else {
      expect(view.getByRole("button", { name: "New invoice" })).toBeInTheDocument();
      expect(view.queryByRole("textbox", { name: "Customer name" })).not.toBeInTheDocument();
    }
  });

  it("fills an older draft from fresh seller presets while retaining manual values and its buyer snapshot", async () => {
    vi.mocked(billing.getCompany).mockImplementation(async fresh => ({ ...company, ...(fresh ? {
      city: "Dubai", country_subdivision: "DXB", address: "Preset address", legal_id: "TL-PRESET", legal_id_type: "TL",
      einvoice: { tin: "1001234567", legal_authority: "Dubai Economy" },
    } : {}) }));
    vi.mocked(billing.getDoc).mockResolvedValue({ ...invoice, seller_address: "Manual address", einvoice: { buyer: { tin: "1007774567" } } });
    const save = vi.spyOn(billing, "saveDoc").mockResolvedValue(10);
    const view = wrap(<Invoicing />);
    await view.findByText("INV-AUDIT");
    setCacheOrg("document-test-org", "document-test-user");
    fireEvent.click(view.getByRole("button", { name: "More actions" }));
    fireEvent.click(await view.findByRole("menuitem", { name: "Edit" }));
    fireEvent.click(await view.findByRole("button", { name: "Check E-invoice" }));
    const review = within(await view.findByRole("region", { name: "E-invoice details" }));
    fireEvent.mouseDown(review.getByRole("tab", { name: /^Seller/ }), { button: 0, ctrlKey: false });
    expect(review.getByRole("textbox", { name: "Seller city" })).toHaveValue("");
    fireEvent.click(review.getByRole("button", { name: "Fill missing seller details" }));
    await waitFor(() => expect(review.getByRole("textbox", { name: "Seller city" })).toHaveValue("Dubai"));
    expect(review.getByRole("textbox", { name: "Seller street address" })).toHaveValue("Manual address");
    expect(review.getByRole("textbox", { name: "Electronic invoicing TIN" })).toHaveValue("1001234567");
    fireEvent.click(view.getByTitle("Save without sending (Ctrl+S)"));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ seller_city: "Dubai", seller_address: "Manual address",
      seller_legal_id: "TL-PRESET", einvoice: expect.objectContaining({ buyer: { tin: "1007774567" }, seller: expect.objectContaining({ tin: "1001234567" }) }),
    })));
  });

  it("starts a new invoice with current company seller presets rather than the list's cached profile", async () => {
    vi.mocked(billing.getCompany).mockImplementation(async fresh => ({ ...company, ...(fresh ? { city: "Dubai", legal_id: "CURRENT-LICENCE",
      einvoice: { tin: "1001234567" } } : {}) }));
    const view = wrap(<Invoicing />);
    await openNewDraft(view);
    fireEvent.click(view.getByRole("button", { name: "Check E-invoice" }));
    const review = within(await view.findByRole("region", { name: "E-invoice details" }));
    fireEvent.mouseDown(review.getByRole("tab", { name: /^Seller/ }), { button: 0, ctrlKey: false });
    expect(review.getByRole("textbox", { name: "Seller city" })).toHaveValue("Dubai");
    expect(review.getByRole("textbox", { name: "Legal registration number" })).toHaveValue("CURRENT-LICENCE");
    expect(review.getByRole("textbox", { name: "Electronic invoicing TIN" })).toHaveValue("1001234567");
  });

  it("does not offer company preset enrichment on an issued invoice", async () => {
    vi.mocked(billing.getDoc).mockResolvedValue({ ...invoice, status: "sent" });
    const view = wrap(<Invoicing />);
    await view.findByText("INV-AUDIT");
    setCacheOrg("document-test-org", "document-test-user");
    fireEvent.click(view.getByRole("button", { name: "More actions" }));
    fireEvent.click(await view.findByRole("menuitem", { name: "Edit" }));
    fireEvent.click(await view.findByRole("button", { name: "Check E-invoice" }));
    const review = within(await view.findByRole("region", { name: "E-invoice details" }));
    fireEvent.mouseDown(review.getByRole("tab", { name: /^Seller/ }), { button: 0, ctrlKey: false });
    expect(review.queryByRole("button", { name: "Fill missing seller details" })).not.toBeInTheDocument();
  });

  it.each(["sales", "purchase"] as const)("uses optional %s party presets and clears the previous party's identity, tax and delivery details", async mode => {
    const identity = { identifier: "BUYER-NEW", tin: "1234567890" };
    vi.spyOn(crm, "customers").mockResolvedValue([
      { id: 31, name: "Preset party", phone_e164: "+971501234567", city: "Dubai", country_code: "AE", country_subdivision: "DU", custom_fields: { einvoice_identity: JSON.stringify(identity) } },
      { id: 32, name: "Blank party" },
    ] as Awaited<ReturnType<typeof crm.customers>>);
    vi.spyOn(suppliers, "list").mockResolvedValue([
      { id: 31, name: "Preset party", phone: "+971 50 123 4567", created_at: "", custom_fields: { city: "Dubai", country_code: "AE", country_subdivision: "DU", einvoice_identity: JSON.stringify(identity) } },
      { id: 32, name: "Blank party", created_at: "" },
    ]);
    vi.spyOn(billing, "getDoc").mockResolvedValue({ ...invoice, customer_trn: "100000000000003", buyer_city: "Old city", buyer_country_code: "US", buyer_country_subdivision: "CA", einvoice: { buyer: { identifier: "OLD" }, seller: { tin: "5555555555" }, buyer_delivery_mode: "export-unregistered", delivery: { address: "Old delivery" } } });
    const save = vi.spyOn(billing, "saveDoc").mockResolvedValue(invoice.id);
    const view = wrap(<Invoicing mode={mode} />);
    await view.findByText("INV-AUDIT");
    setCacheOrg("document-test-org", "document-test-user");
    fireEvent.click(view.getByRole("button", { name: "More actions" }));
    fireEvent.click(await view.findByRole("menuitem", { name: "Edit" }));
    const party = mode === "purchase" ? "supplier" : "customer";
    const select = await view.findByRole("combobox", { name: `Select saved ${party}` });
    await waitFor(() => expect(select).toBeEnabled());
    fireEvent.keyDown(select, { key: "ArrowDown" });
    fireEvent.click(await view.findByRole("option", { name: "Preset party" }));
    const expectedPhone = mode === "purchase" ? "+971 50 123 4567" : "+971501234567";
    expect(view.getByLabelText(`${mode === "purchase" ? "Supplier" : "Customer"} phone`)).toHaveValue(expectedPhone);
    fireEvent.click(view.getByTitle("Save without sending (Ctrl+S)"));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0]).toMatchObject({ customer_name: "Preset party", customer_trn: "", buyer_city: "Dubai", buyer_country_code: "AE", buyer_country_subdivision: "DU", einvoice: { buyer: identity, seller: { tin: "5555555555" } } });
    expect(save.mock.calls[0][0].einvoice?.buyer).toEqual({ ...identity, phone: expectedPhone });
    expect(save.mock.calls[0][0].einvoice?.delivery).toBeUndefined();
    expect(save.mock.calls[0][0].einvoice?.buyer_delivery_mode).toBeUndefined();
    await waitFor(() => expect(select).toBeEnabled());
    fireEvent.keyDown(select, { key: "ArrowDown" });
    fireEvent.click(await view.findByRole("option", { name: "Blank party" }));
    fireEvent.click(view.getByTitle("Save without sending (Ctrl+S)"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0]).toMatchObject({ customer_name: "Blank party", buyer_city: "", buyer_country_code: "", buyer_country_subdivision: "", einvoice: { buyer: {} } });
    expect(save.mock.calls[1][0].einvoice?.buyer).toEqual({ phone: "" });
  });

  it.each(["sales", "purchase"] as const)("creates an optional %s identity preset from the invoice quick-add form", async mode => {
    vi.spyOn(crm, "customers").mockResolvedValue([]);
    vi.spyOn(suppliers, "list").mockResolvedValue([]);
    const createCustomer = vi.spyOn(crm, "createCustomer").mockResolvedValue(31);
    const createSupplier = vi.spyOn(suppliers, "create").mockResolvedValue(31);
    const save = vi.spyOn(billing, "saveDoc").mockResolvedValue(invoice.id);
    const view = wrap(<Invoicing mode={mode} />);
    await view.findByText("INV-AUDIT");
    setCacheOrg("document-test-org", "document-test-user");
    fireEvent.click(view.getByRole("button", { name: "More actions" }));
    fireEvent.click(await view.findByRole("menuitem", { name: "Edit" }));
    const party = mode === "purchase" ? "supplier" : "customer";
    fireEvent.click(await view.findByRole("button", { name: `Add ${party}` }));
    const dialog = within(await view.findByRole("dialog"));
    fireEvent.change(dialog.getByRole("textbox", { name: "Company name" }), { target: { value: "Quick preset" } });
    fireEvent.change(dialog.getByRole("textbox", { name: "Phone number" }), { target: { value: "+971 50 222 3344" } });
    fireEvent.click(dialog.getByText("Electronic invoicing details (optional)"));
    fireEvent.change(dialog.getByRole("textbox", { name: "City" }), { target: { value: "Sharjah" } });
    fireEvent.change(dialog.getByRole("textbox", { name: "Buyer identifier" }), { target: { value: "CUSTOM-ID" } });
    fireEvent.click(dialog.getByRole("button", { name: `Create ${party}` }));
    await waitFor(() => expect(view.queryByRole("dialog")).not.toBeInTheDocument());
    const created = mode === "purchase" ? createSupplier.mock.calls[0][0] : createCustomer.mock.calls[0][0];
    expect(created.custom_fields?.einvoice_identity).toBe(JSON.stringify({ identifier: "CUSTOM-ID" }));
    expect(created.phone).toBe("+971 50 222 3344");
    expect(view.getByLabelText(`${mode === "purchase" ? "Supplier" : "Customer"} phone`)).toHaveValue("+971 50 222 3344");
    fireEvent.click(view.getByTitle("Save without sending (Ctrl+S)"));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ customer_name: "Quick preset", buyer_city: "Sharjah", einvoice: expect.objectContaining({ buyer: { identifier: "CUSTOM-ID", phone: "+971 50 222 3344" } }) })));
  });

  it("shows entered invoice details and the frozen buyer phone within the original preview sheet", async () => {
    vi.spyOn(billing, "getDoc").mockResolvedValue({ ...invoice, po_number: "PO-PREVIEW-OPTIONAL", einvoice: { buyer: { phone: "+971 50 333 4455", identifier: "BUYER-PREVIEW-ID" } } });
    const view = wrap(<Invoicing />);
    await view.findByText("INV-AUDIT");
    setCacheOrg("document-test-org", "document-test-user");
    fireEvent.click(view.getByRole("button", { name: "More actions" }));
    fireEvent.click(await view.findByRole("menuitem", { name: "Edit" }));
    fireEvent.click(await view.findByRole("button", { name: "Preview" }));
    const preview = within(await view.findByRole("dialog"));
    expect(preview.queryByRole("heading", { name: "Electronic invoice details" })).not.toBeInTheDocument();
    expect(preview.queryByRole("button", { name: "Next page" })).not.toBeInTheDocument();
    expect(preview.getByText(/PO-PREVIEW-OPTIONAL/)).toBeVisible();
    expect(preview.getByText("+971 50 333 4455")).toBeVisible();
    expect(preview.getByText(/BUYER-PREVIEW-ID/)).toBeVisible();
    expect(preview.getByText("Page 1 of 1")).toBeVisible();
    const buyer = preview.getByText("+971 50 333 4455").closest('[data-invoice-party="buyer"]');
    expect(buyer?.parentElement).toHaveTextContent("Example customer");
    expect(buyer).toHaveTextContent("BUYER-PREVIEW-ID");
  });

  it("does not reserve numbers for opening, previewing, canceling or duplicating a draft", async () => {
    const allocate = vi.spyOn(documentNumbers, "allocateDocumentNumber").mockResolvedValue("INV-RESERVED");
    const save = vi.spyOn(billing, "saveDoc");
    const view = wrap(<Invoicing />);
    await openNewDraft(view);
    expect(view.getByText(/Provisional — a unique number is assigned/)).toBeVisible();
    fireEvent.click(view.getByTitle("Save without sending (Ctrl+S)"));
    await view.findByText("Add at least one line item with a description");
    fireEvent.click(view.getByRole("button", { name: "Back" }));
    await view.findByText("INV-AUDIT");
    fireEvent.click(view.getByRole("button", { name: "More actions" }));
    fireEvent.click(await view.findByRole("menuitem", { name: "Duplicate" }));
    await view.findByRole("heading", { name: "New Invoice" });
    fireEvent.click(view.getByRole("button", { name: "Preview" }));
    expect(allocate).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("reuses the draft reservation ID after a lost reply and the reserved number after a save failure", async () => {
    const allocate = vi.spyOn(documentNumbers, "allocateDocumentNumber").mockRejectedValueOnce(new Error("Reservation response lost"))
      .mockResolvedValue("INV-RESERVED");
    const save = vi.spyOn(billing, "saveDoc").mockRejectedValueOnce(new Error("Save response lost")).mockResolvedValue(50);
    const view = wrap(<Invoicing />);
    await fillNewDraft(view);
    fireEvent.click(view.getByTitle("Save without sending (Ctrl+S)"));
    await view.findByText("Could not save: Reservation response lost");
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(view.getByTitle("Save without sending (Ctrl+S)"));
    await view.findByText("Could not save: Save response lost");
    expect(allocate).toHaveBeenCalledTimes(2);
    expect(allocate.mock.calls[0][3]).toMatch(/^[\da-f]{8}-[\da-f-]{27}$/i);
    expect(allocate.mock.calls[1][3]).toBe(allocate.mock.calls[0][3]);
    expect(save.mock.calls[0][0].number).toBe("INV-RESERVED");
    fireEvent.click(view.getByTitle("Save without sending (Ctrl+S)"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0].number).toBe("INV-RESERVED");
    expect(allocate).toHaveBeenCalledTimes(2);
    await view.findByRole("heading", { name: "Edit Invoice" });
  });

  it("reserves once across concurrent save commands and does not renumber the saved invoice", async () => {
    let finish!: (number: string) => void;
    const allocate = vi.spyOn(documentNumbers, "allocateDocumentNumber").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const save = vi.spyOn(billing, "saveDoc").mockResolvedValue(50);
    const view = wrap(<Invoicing />);
    await fillNewDraft(view);
    act(() => {
      fireEvent.keyDown(window, { key: "s", ctrlKey: true });
      fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    });
    await waitFor(() => expect(allocate).toHaveBeenCalledOnce());
    expect(save).not.toHaveBeenCalled();
    await act(async () => finish("INV-RESERVED"));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    fireEvent.click(view.getByTitle("Save without sending (Ctrl+S)"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0]).toMatchObject({ id: 50, number: "INV-RESERVED" });
    expect(allocate).toHaveBeenCalledOnce();
  });

  it.each(["manual", "original prediction"])("preserves an explicitly entered %s number without reserving another", async choice => {
    const allocate = vi.spyOn(documentNumbers, "allocateDocumentNumber");
    const save = vi.spyOn(billing, "saveDoc").mockResolvedValue(50);
    const view = wrap(<Invoicing />);
    await fillNewDraft(view);
    fireEvent.mouseDown(view.getByRole("tab", { name: "Details" }), { button: 0, ctrlKey: false });
    const field = view.getByRole("textbox", { name: "Invoice number" }) as HTMLInputElement;
    const selected = choice === "manual" ? "MANUAL-2026-1" : field.value;
    fireEvent.change(field, { target: { value: "TEMPORARY-CHOICE" } });
    fireEvent.change(field, { target: { value: selected } });
    fireEvent.click(view.getByTitle("Save without sending (Ctrl+S)"));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ number: selected })));
    expect(allocate).not.toHaveBeenCalled();
  });

  it.each(["button", "print shortcut"])("saves a new invoice before PDF export via %s and renders its allocated number", async trigger => {
    const allocate = vi.spyOn(documentNumbers, "allocateDocumentNumber").mockResolvedValue("INV-PDF-RESERVED");
    const save = vi.spyOn(billing, "saveDoc").mockResolvedValue(50);
    vi.spyOn(billing, "getDoc").mockResolvedValue({ ...invoice, id: 50, number: "INV-PDF-RESERVED", fx_rate: 3.6725, einvoice: { uuid: "persisted-uuid" } });
    const renderPdf = vi.spyOn(reactPdf, "reactToPdfBytes").mockResolvedValue({ name: "invoice.pdf", bytes: new Uint8Array([1, 2]) });
    const write = vi.spyOn(localPaths, "saveBytes").mockResolvedValue("invoice.pdf");
    const view = wrap(<Invoicing />);
    await fillNewDraft(view);
    if (trigger === "button") fireEvent.click(view.getByTitle("Download PDF (Ctrl+P)"));
    else fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    await waitFor(() => expect(write).toHaveBeenCalledWith("INV-PDF-RESERVED.pdf", new Uint8Array([1, 2]), "application/pdf"));
    expect(allocate).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();
    expect(renderPdf).toHaveBeenCalledWith(expect.objectContaining({ props: expect.objectContaining({ form: expect.objectContaining({ id: 50, number: "INV-PDF-RESERVED", fx_rate: 3.6725, einvoice: expect.objectContaining({ uuid: "persisted-uuid" }) }) }) }), "INV-PDF-RESERVED");
  });

  it("retains the saved id when metadata readback fails and retries PDF without a second create", async () => {
    const allocate = vi.spyOn(documentNumbers, "allocateDocumentNumber").mockResolvedValue("INV-SAVED");
    const save = vi.spyOn(billing, "saveDoc").mockResolvedValue(50);
    vi.spyOn(billing, "getDoc").mockRejectedValueOnce(new Error("Read response lost"))
      .mockResolvedValue({ ...invoice, id: 50, number: "INV-SAVED", einvoice: { uuid: "confirmed-uuid" } });
    const renderPdf = vi.spyOn(reactPdf, "reactToPdfBytes").mockResolvedValue({ name: "invoice.pdf", bytes: new Uint8Array([1, 2]) });
    const write = vi.spyOn(localPaths, "saveBytes").mockResolvedValue(null);
    const view = wrap(<Invoicing />);
    await fillNewDraft(view);
    fireEvent.click(view.getByTitle("Download PDF (Ctrl+P)"));
    await view.findByText("Invoice saved, but saved details could not be reloaded. Retry export or save.");
    expect(view.getByRole("heading", { name: "Edit Invoice" })).toBeVisible();
    expect(renderPdf).not.toHaveBeenCalled();
    expect(save.mock.calls[0][0].id).toBeUndefined();
    fireEvent.click(view.getByTitle("Download PDF (Ctrl+P)"));
    await waitFor(() => expect(write).toHaveBeenCalledWith("INV-SAVED.pdf", new Uint8Array([1, 2]), "application/pdf"));
    expect(save.mock.calls[1][0]).toMatchObject({ id: 50, number: "INV-SAVED" });
    expect(allocate).toHaveBeenCalledOnce();
  });

  it.each(["Edit", "Duplicate"])("preserves a saved line VAT override through %s and save", async action => {
    vi.spyOn(billing, "getDoc").mockResolvedValue({ ...invoice, items: [{ ...invoice.items[0], custom: { __tax_pct: "7.5" } }] });
    vi.spyOn(documentNumbers, "allocateDocumentNumber").mockResolvedValue("INV-COPY");
    const save = vi.spyOn(billing, "saveDoc").mockResolvedValue(50);
    const view = wrap(<Invoicing />);
    await view.findByText("INV-AUDIT");
    setCacheOrg("document-test-org", "document-test-user");
    fireEvent.click(view.getByRole("button", { name: "More actions" }));
    fireEvent.click(await view.findByRole("menuitem", { name: action }));
    fireEvent.mouseDown(await view.findByRole("tab", { name: /^Items/ }), { button: 0, ctrlKey: false });
    expect(view.getByRole("spinbutton", { name: "VAT rate for line 1" })).toHaveValue(7.5);
    fireEvent.click(view.getByTitle("Save without sending (Ctrl+S)"));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ items: [expect.objectContaining({ custom: expect.objectContaining({ __tax_pct: "7.5" }) })] })));
  });

  it("finalizes a new draft through the shared reserved-number save and archives only the confirmed snapshot", async () => {
    const allocate = vi.spyOn(documentNumbers, "allocateDocumentNumber").mockResolvedValue("INV-FINAL-RESERVED");
    const save = vi.spyOn(billing, "saveDoc").mockResolvedValue(50);
    const view = wrap(<Invoicing />);
    await fillNewDraft(view);
    fireEvent.click(view.getByRole("button", { name: "Mark as done" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ number: "INV-FINAL-RESERVED", status: "sent" })));
    await waitFor(() => expect(filesApi.autoSaveDocument).toHaveBeenCalledWith("INV-FINAL-RESERVED.pdf", "invoice", expect.any(Function)));
    expect(allocate).toHaveBeenCalledOnce();
  });

  it("exports XML with the newly allocated invoice number instead of the provisional preview", async () => {
    vi.spyOn(documentNumbers, "allocateDocumentNumber").mockResolvedValue("INV-XML-RESERVED");
    vi.spyOn(billing, "saveDoc").mockResolvedValue(50);
    vi.spyOn(billing, "getDoc").mockResolvedValue({ ...invoice, id: 50, number: "INV-XML-RESERVED", einvoice: { uuid: "test-document-uuid" } });
    vi.spyOn(invoiceXml, "validateEInvoice").mockReturnValue({ errors: [], warnings: [] });
    vi.spyOn(invoiceXml, "eInvoiceIssues").mockReturnValue([]);
    const xml = vi.spyOn(invoiceXml, "buildInvoiceXml").mockReturnValue("<Invoice />");
    const write = vi.spyOn(localPaths, "saveBytes").mockResolvedValue(null);
    const view = wrap(<Invoicing />);
    await fillNewDraft(view);
    fireEvent.click(view.getByRole("button", { name: "Check E-invoice" }));
    fireEvent.click(view.getByRole("button", { name: "Save & export XML" }));
    await waitFor(() => expect(write).toHaveBeenCalledWith("INV-XML-RESERVED.xml", expect.anything(), "application/xml"));
    expect(Array.from(write.mock.calls[0][1])).toEqual(Array.from(new TextEncoder().encode("<Invoice />")));
    expect(xml).toHaveBeenCalledWith(expect.objectContaining({ id: 50, number: "INV-XML-RESERVED", einvoice: { uuid: "test-document-uuid" } }));
  });

  it("does not display a finalized state or archive a PDF when finalization has no acknowledgement", async () => {
    vi.spyOn(documentNumbers, "allocateDocumentNumber").mockResolvedValue("INV-UNCERTAIN");
    vi.spyOn(billing, "saveDoc").mockRejectedValue(new Error("Save response lost"));
    const view = wrap(<Invoicing />);
    await fillNewDraft(view);
    fireEvent.click(view.getByRole("button", { name: "Mark as done" }));
    await view.findByText("Could not save: Save response lost");
    expect(view.getByRole("button", { name: "Mark as done" })).toBeEnabled();
    expect(filesApi.autoSaveDocument).not.toHaveBeenCalled();
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
    const review = within(await view.findByRole("region", { name: "E-invoice details" }));
    expect(view.queryByRole("dialog", { name: "Check E-invoice" })).toBeNull();
    expect(view.getByRole("tab", { name: "E-invoice", selected: true })).toBeVisible();
    expect(review.getAllByRole("tab")).toHaveLength(5);
    fireEvent.mouseDown(review.getByRole("tab", { name: /^Seller/ }), { button: 0, ctrlKey: false });
    fireEvent.change(review.getByRole("textbox", { name: "Own FTA-issued TRN" }), { target: { value: "123456789012345" } });
    fireEvent.change(review.getByLabelText(/^Seller street address/), { target: { value: "Edited invoice seller address" } });
    expect(review.getByRole("textbox", { name: "Own FTA-issued TRN" })).toHaveValue("123456789012345");
    expect(review.getByRole("button", { name: "Save & export XML" })).toBeDisabled();
    fireEvent.click(review.getByRole("button", { name: "Back to details" }));
    await waitFor(() => expect(view.queryByRole("region", { name: "E-invoice details" })).toBeNull());
    fireEvent.click(actions.getByRole("button", { name: "Check E-invoice" }));
    const reopened = within(await view.findByRole("region", { name: "E-invoice details" }));
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

  it("saves editable identity, delivery and bank fields from the invoice tab while allowing an incomplete draft", async () => {
    vi.spyOn(billing, "getDoc").mockResolvedValue({ ...invoice, transaction_type: "10000001", payment_means_code: "30", einvoice: {} });
    const save = vi.spyOn(billing, "saveDoc").mockResolvedValue(10);
    const view = wrap(<Invoicing />);
    await view.findByText("INV-AUDIT");
    setCacheOrg("document-test-org", "document-test-user");
    fireEvent.click(view.getByRole("button", { name: "More actions" }));
    fireEvent.click(await view.findByRole("menuitem", { name: "Edit" }));
    fireEvent.mouseDown(await view.findByRole("tab", { name: "E-invoice" }), { button: 0, ctrlKey: false });
    const review = within(await view.findByRole("region", { name: "E-invoice details" }));
    fireEvent.change(review.getByLabelText(/^Free-zone beneficiary identifier/), { target: { value: "DEMO-BENEFICIARY" } });
    fireEvent.change(review.getByLabelText(/^Delivery city/), { target: { value: "Mumbai" } });
    fireEvent.mouseDown(review.getByRole("tab", { name: /^Seller/ }), { button: 0, ctrlKey: false });
    fireEvent.change(review.getByRole("textbox", { name: "Electronic invoicing TIN" }), { target: { value: "1001234567" } });
    fireEvent.change(review.getByRole("textbox", { name: "Legal registration number" }), { target: { value: "TL-DEMO" } });
    fireEvent.mouseDown(review.getByRole("tab", { name: /^Buyer/ }), { button: 0, ctrlKey: false });
    fireEvent.change(review.getByRole("textbox", { name: "Buyer identifier" }), { target: { value: "BUYER-DEMO" } });
    fireEvent.mouseDown(review.getByRole("tab", { name: /^Tax & Payment/ }), { button: 0, ctrlKey: false });
    fireEvent.change(review.getByRole("textbox", { name: "Bank account / IBAN" }), { target: { value: "AE-DEMO-ACCOUNT" } });
    expect(review.getByRole("button", { name: "Save & export XML" })).toBeDisabled();
    fireEvent.click(view.getByTitle("Save without sending (Ctrl+S)"));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({
      status: "draft", seller_legal_id: "TL-DEMO", einvoice: expect.objectContaining({
        seller: expect.objectContaining({ tin: "1001234567", legal_id: "TL-DEMO" }),
        buyer: expect.objectContaining({ identifier: "BUYER-DEMO" }), beneficiary_id: "DEMO-BENEFICIARY",
        delivery: { city: "Mumbai" }, payment_account_id: "AE-DEMO-ACCOUNT",
      }),
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
    const review = within(await view.findByRole("region", { name: "E-invoice details" }));
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
    const section = (await view.findByText("E-invoice details", { selector: "summary" })).closest("details")!;
    const disclosure = section.querySelector("summary")!;
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

