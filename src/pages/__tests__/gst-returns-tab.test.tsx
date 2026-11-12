import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { billing, type CompanyProfile, type InvoiceDoc, type InvoiceDocSummary } from "../../lib/api";
import { downloadText } from "../../lib/localPaths";
import GstTab from "../reports/GstTab";

vi.mock("../../lib/api", () => ({ billing: { listDocs: vi.fn(), getDoc: vi.fn(), allPayments: vi.fn(async () => []) }, tools: { settings: vi.fn(async () => []) } }));
vi.mock("../../lib/localPaths", () => ({ downloadText: vi.fn(async () => {}) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const company = { name: "Seller", country_code: "IN", country_subdivision: "Maharashtra", trn: "27AAPFU0939F1ZV", currency: "INR" } as CompanyProfile;
const month = new Date().toISOString().slice(0, 7);

it("shows GSTR-3B and GSTR-1 for the month and saves the GSTR-1 JSON", async () => {
  vi.mocked(billing.listDocs).mockImplementation(async (kind) => kind === "sales"
    ? [{ id: 1, number: "INV-1", status: "sent", issue_date: `${month}-03` }, { id: 2, number: "INV-D", status: "draft", issue_date: `${month}-04` }] as InvoiceDocSummary[]
    : []);
  vi.mocked(billing.getDoc).mockResolvedValue({
    id: 1, number: "INV-1", status: "sent", issue_date: `${month}-03`, currency: "INR", tax_rate: 18, customer_name: "Buyer",
    customer_trn: "27AAPFU0939F1ZV", buyer_country_subdivision: "Maharashtra", items: [{ description: "Oil", qty: 1, unit_price: 1000, custom: { hsn: "2710" } }],
  } as unknown as InvoiceDoc);
  render(<MemoryRouter><GstTab company={company} /></MemoryRouter>);
  expect(await screen.findByText("B2B invoices")).toBeInTheDocument();
  expect(billing.getDoc).toHaveBeenCalledTimes(1); // the draft is left out
  expect(screen.getByText("3.1(a) Outward taxable supplies")).toBeInTheDocument();
  expect(screen.getAllByText("INV-1").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: /GSTR-1 JSON/ }));
  await waitFor(() => expect(downloadText).toHaveBeenCalledOnce());
  expect(JSON.parse(vi.mocked(downloadText).mock.calls[0][1]).b2b[0].ctin).toBe("27AAPFU0939F1ZV");
});

it("tells the owner to set the state and GSTIN first", async () => {
  vi.mocked(billing.listDocs).mockResolvedValue([]);
  render(<MemoryRouter><GstTab company={{ ...company, trn: "", country_subdivision: "" }} /></MemoryRouter>);
  expect(await screen.findByRole("alert")).toHaveTextContent(/business state is not set.*GSTIN is not set/);
  expect(screen.getByRole("button", { name: /GSTR-1 JSON/ })).toBeDisabled();
});

it("shows CMP-08 for a composition dealer instead of GSTR-1 and 3B", async () => {
  const { tools } = await import("../../lib/api");
  vi.mocked(tools.settings).mockResolvedValueOnce([{ key: "company_registration_in", value: JSON.stringify({ gst_scheme: "composition", composition_rate: "1" }) }] as never);
  vi.mocked(billing.listDocs).mockImplementation(async (kind) => kind === "sales" ? [{ id: 1, number: "BOS-1", status: "sent", issue_date: `${month}-03` }] as InvoiceDocSummary[] : []);
  vi.mocked(billing.getDoc).mockResolvedValue({ id: 1, number: "BOS-1", status: "sent", issue_date: `${month}-03`, currency: "INR", tax_rate: 0,
    customer_name: "Walk-in", buyer_country_subdivision: "Maharashtra", items: [{ description: "Oil", qty: 1, unit_price: 50000 }] } as unknown as InvoiceDoc);
  render(<MemoryRouter><GstTab company={company} /></MemoryRouter>);
  expect(await screen.findByText("CMP-08 for the quarter")).toBeInTheDocument();
  expect(screen.getByText("₹500.00")).toBeInTheDocument();
  expect(screen.queryByText("B2B invoices")).toBeNull();
  expect(screen.queryByRole("button", { name: /GSTR-1 JSON/ })).toBeNull();
});