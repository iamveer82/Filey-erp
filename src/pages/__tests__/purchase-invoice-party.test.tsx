import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UIProvider } from "../../lib/ui";
import { AuthProvider } from "../../lib/auth";
import { advances, billing, crm, recurrences, suppliers, setCacheOrg, type CompanyProfile, type InvoiceDoc, type Supplier } from "../../lib/api";
import * as files from "../../lib/files";
import * as exchangeRates from "../../lib/exchange-rates";
import Invoicing from "../Invoicing";

// Keep the real editor and picker; thumbnail rendering has its own gallery
// suite and adds four unrelated document trees to every party interaction.
vi.mock("../../components/TemplateTilePreview", () => ({ default: () => null }));

vi.mock("../../lib/supabase", () => {
  const query = (): unknown => {
    const proxy: unknown = new Proxy(function () {}, {
      get(_target, key) {
        if (key === "then") return (resolve: (result: unknown) => void) => resolve({ data: [], error: null, count: 0 });
        return () => proxy;
      },
      apply: () => proxy,
    });
    return proxy;
  };
  return {
    sb: () => ({
      from: query, rpc: query,
      auth: {
        getUser: async () => ({ data: { user: null }, error: null }),
        getSession: async () => ({ data: { session: null }, error: null }),
      },
      channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
      removeChannel: () => {},
    }),
    supabase: null, isConfigured: true, cloudConfigured: false,
  };
});
vi.mock("../../lib/dataMode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/dataMode")>()),
  isLocalMode: () => true,
  getDataMode: () => "local" as const,
  effectiveDataMode: () => "local" as const,
  setDataMode: () => {},
  assertWorkspaceCurrent: () => {},
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => null }));

const invoice = {
  id: 10, number: "PINV-PARTY", doc_type: "purchase", customer_name: "Legacy party", customer_id: 7,
  advance_applied: 25, status: "draft", seller_name: "Filey test company", template: "classic", currency: "AED",
  tax_country_code: "AE", accent: "#111111", issue_date: "2026-09-07", due_date: "2026-10-07",
  tax_rate: 5, discount: 0, created_at: "2026-09-07", updated_at: "2026-09-07",
  items: [{ description: "Office supplies", qty: 1, unit_price: 100, custom: {} }],
} as InvoiceDoc;
const vendor: Supplier = { id: 42, name: "Gulf Supplies", email: "billing@gulf.example", address: "Dubai", tax_id: "100123456789003", created_at: "2026-09-01" };

async function openPurchase() {
  const view = render(<MemoryRouter><AuthProvider><UIProvider><Invoicing mode="purchase" /></UIProvider></AuthProvider></MemoryRouter>);
  await view.findByText("PINV-PARTY");
  setCacheOrg("purchase-test-org", "purchase-test-user");
  fireEvent.click(view.getByRole("button", { name: "Edit" }));
  await view.findByLabelText("Supplier name");
  return view;
}

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.spyOn(billing, "getCompany").mockResolvedValue({ name: "Filey test company", currency: "AED", default_template: "classic" } as CompanyProfile);
  vi.spyOn(billing, "listDocs").mockResolvedValue([{ ...invoice, total: 105 }]);
  vi.spyOn(billing, "getDoc").mockResolvedValue(invoice);
  vi.spyOn(billing, "saveDoc").mockResolvedValue(10);
  vi.spyOn(suppliers, "list").mockResolvedValue([vendor]);
  vi.spyOn(suppliers, "create").mockResolvedValue(51);
  vi.spyOn(crm, "customers").mockResolvedValue([]);
  vi.spyOn(crm, "createCustomer").mockResolvedValue(99);
  vi.spyOn(advances, "creditForInvoice").mockResolvedValue(100);
  vi.spyOn(advances, "applyToInvoice").mockResolvedValue(undefined);
  vi.spyOn(recurrences, "list").mockResolvedValue([]);
  vi.spyOn(recurrences, "generateDue").mockResolvedValue(0);
  vi.spyOn(files, "autoSaveDocument").mockResolvedValue(false);
  vi.spyOn(exchangeRates, "getExchangeRates").mockResolvedValue({ AED: 1 });
});
afterEach(() => { cleanup(); setCacheOrg(null); vi.restoreAllMocks(); });

describe("purchase invoice parties", () => {
  it("opens the invoice preview legible on a phone, and still fits the A4 sheet without reflowing it", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(326);
    const view = await openPurchase();
    fireEvent.click(view.getByRole("button", { name: "Preview" }));
    const dialog = view.getByRole("dialog", { name: invoice.number });
    expect(dialog).toHaveClass("filey-document-dialog");
    const paper = () => dialog.querySelector<HTMLElement>(".invoice-print")!;
    // A 326px panel fits 294/794 = 37% of the sheet, so the viewer opens at a
    // legible zoom instead of a whole page of ~4px text.
    await waitFor(() => expect(paper().parentElement).toHaveStyle({ width: "638px" }));
    expect(paper()).toHaveStyle({ width: "794px", minHeight: "1123px", padding: "48px" });
    expect(within(dialog).getByRole("columnheader", { name: /Amount/ })).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Fit width" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    // One tap returns the whole page, which is what fit-width means.
    fireEvent.click(within(dialog).getByRole("button", { name: "Fit width" }));
    expect(paper().parentElement).toHaveStyle({ width: "294px" });
    // …and the sheet itself is never reflowed or re-measured by either mode.
    expect(paper()).toHaveStyle({ width: "794px", minHeight: "1123px", padding: "48px" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Zoom in on document" }));
    expect(paper().parentElement).toHaveStyle({ width: "441px" });
    expect(billing.saveDoc).not.toHaveBeenCalled();
  });

  it.each(["Save", "Mark as done"])("%s saves supplier snapshots without a CRM foreign key or customer advance", async (action) => {
    const view = await openPurchase();
    const selector = view.getByLabelText("Select saved supplier");
    await waitFor(() => expect(selector).not.toBeDisabled());
    fireEvent.click(selector);
    fireEvent.click(within(view.getByRole("menu")).getByText(vendor.name));
    expect(view.getByLabelText("Supplier name")).toHaveValue(vendor.name);
    expect(view.getByLabelText("Supplier email")).toHaveValue(vendor.email);
    expect(view.queryByText("Apply customer advance")).toBeNull();
    if (action === "Save") fireEvent.click(view.getByTitle("Save without sending (Ctrl+S)"));
    else {
      fireEvent.click(view.getByRole("button", { name: "More" }));
      fireEvent.click(view.getByRole("menuitem", { name: action }));
    }
    await waitFor(() => expect(billing.saveDoc).toHaveBeenCalledWith(expect.objectContaining({
      doc_type: "purchase", customer_id: null, advance_applied: 0,
      customer_name: vendor.name, customer_email: vendor.email, customer_address: vendor.address, customer_trn: vendor.tax_id,
      status: action === "Save" ? "draft" : "sent",
    })));
    expect(crm.customers).not.toHaveBeenCalled();
    expect(advances.creditForInvoice).not.toHaveBeenCalled();
    expect(advances.applyToInvoice).not.toHaveBeenCalled();
  });

  it("creates a supplier in the supplier directory and applies its billing snapshot", async () => {
    const view = await openPurchase();
    fireEvent.click(view.getByRole("button", { name: "Add supplier" }));
    const dialog = within(view.getByRole("dialog", { name: "Add supplier" }));
    fireEvent.change(dialog.getByLabelText("Company name"), { target: { value: "New Supplier LLC" } });
    fireEvent.change(dialog.getByLabelText("Contact name"), { target: { value: "Sam" } });
    fireEvent.change(dialog.getByLabelText("Email address"), { target: { value: "sam@supplier.example" } });
    fireEvent.click(dialog.getByRole("button", { name: "Create supplier" }));
    await waitFor(() => expect(view.queryByRole("dialog", { name: "Add supplier" })).toBeNull());
    expect(suppliers.create).toHaveBeenCalledWith(expect.objectContaining({ name: "New Supplier LLC", contact_person: "Sam", email: "sam@supplier.example" }));
    expect(crm.createCustomer).not.toHaveBeenCalled();
    fireEvent.click(view.getByTitle("Save without sending (Ctrl+S)"));
    await waitFor(() => expect(billing.saveDoc).toHaveBeenCalledWith(expect.objectContaining({ customer_name: "New Supplier LLC", customer_id: null, advance_applied: 0 })));
  });

  it("shows a failed supplier read and retries instead of claiming the directory is empty", async () => {
    vi.mocked(suppliers.list).mockRejectedValueOnce(new Error("Directory offline"));
    const view = await openPurchase();
    expect(await view.findByText(/Could not load suppliers: Directory offline/)).toBeTruthy();
    expect(view.getByLabelText("Select saved supplier")).toBeDisabled();
    expect(view.queryByText("No saved suppliers yet")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Retry directory" }));
    await waitFor(() => expect(view.getByLabelText("Select saved supplier")).not.toBeDisabled());
    expect(suppliers.list).toHaveBeenCalledTimes(2);
  });
});
