import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UIProvider } from "../../lib/ui";
import { billing, crm, erp, type CompanyProfile, type CrmCustomer, type InvoiceDocSummary, type InvoicePayment, type Product } from "../../lib/api";
import * as counter from "../../lib/counter";
import * as receipt from "../../lib/receipt";
import { BATCHES_KEY } from "../../lib/batches";
import { todayYmd } from "../../lib/format";
import Counter from "../Counter";

const modules = vi.hoisted(() => ({ pharmaMode: false }));
vi.mock("../../lib/modules", () => ({ useModules: () => ({ pharmaMode: modules.pharmaMode }) }));
vi.mock("../../lib/auth", () => ({ useAuth: () => ({ user: { id: "me" } }) }));

const today = todayYmd();
const year = Number(today.slice(0, 4));
const products = [
  { id: 1, name: "Paracetamol 500mg", sku: "PCM500", barcode: "890123", quantity: 20, unit_price: 10, cost_price: 6, reorder_level: 0, created_at: "",
    custom_fields: { [BATCHES_KEY]: JSON.stringify([{ no: "NEW2", exp: `${year + 1}-06-30`, qty: 20, mrp: 12 }]) } },
  { id: 2, name: "Old syrup", sku: "OS1", quantity: 3, unit_price: 50, cost_price: 30, reorder_level: 5, created_at: "",
    custom_fields: { [BATCHES_KEY]: JSON.stringify([{ no: "X1", exp: `${year - 1}-01-31`, qty: 3 }]) } },
  { id: 3, name: "Cotton T-shirt", sku: "TS-M", barcode: "555", quantity: 0, unit_price: 25, cost_price: 12, reorder_level: 0, created_at: "", custom_fields: {} },
] as Product[];

let country = "AE";
beforeEach(() => {
  modules.pharmaMode = false;
  country = "AE";
  vi.spyOn(erp, "products").mockResolvedValue(products);
  vi.spyOn(billing, "listDocs").mockResolvedValue([]);
  vi.spyOn(billing, "getCompany").mockImplementation(async () => ({ name: "Shop", country_code: country, currency: country === "IN" ? "INR" : "AED" }) as CompanyProfile);
  vi.spyOn(crm, "customers").mockResolvedValue([{ id: 44, name: "Asha Traders" }] as CrmCustomer[]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

const view = () => render(<MemoryRouter><UIProvider><Counter /></UIProvider></MemoryRouter>);

it("bills any product by barcode, picks a saved customer, charges and prints the receipt in one click", async () => {
  const sell = vi.spyOn(counter, "sellAtCounter").mockResolvedValue({ id: 9, number: "CM-9", total: 25 });
  const print = vi.spyOn(receipt, "printSavedReceipt").mockResolvedValue();
  view();
  expect(await screen.findByRole("heading", { name: "Counter" })).toBeInTheDocument();
  expect(screen.queryByText("Prescription details")).toBeNull();
  const search = screen.getByLabelText("Find an item");
  fireEvent.change(search, { target: { value: "555" } });
  fireEvent.keyDown(search, { key: "Enter" });
  expect(await screen.findByLabelText("Quantity of Cotton T-shirt")).toHaveValue(1);
  fireEvent.change(screen.getByLabelText("Customer"), { target: { value: "Asha Traders" } });
  expect(await screen.findByText(/Saved customer/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "Card" }));
  fireEvent.click(screen.getByRole("button", { name: /Charge/ }));
  await waitFor(() => expect(sell).toHaveBeenCalledWith(expect.objectContaining({ method: "card", customerId: 44, customer: "Asha Traders",
    lines: [expect.objectContaining({ productId: 3, qty: 1, price: 25 })] })));
  expect(sell.mock.calls[0][0]).not.toHaveProperty("patient");
  fireEvent.click(await screen.findByRole("button", { name: /Print receipt/ }));
  await waitFor(() => expect(print).toHaveBeenCalledWith(9, undefined));
});

it("shows UPI only for an Indian business", async () => {
  view();
  await screen.findByRole("radio", { name: "Cash" });
  expect(screen.queryByRole("radio", { name: "UPI" })).toBeNull();
  cleanup();
  country = "IN";
  view();
  expect(await screen.findByRole("radio", { name: "UPI" })).toBeInTheDocument();
});

it("shows expiry for everyone and refuses expired stock; Pharma mode adds prescription details", async () => {
  view();
  expect(await screen.findByText(/batch X1/)).toBeInTheDocument();
  expect(screen.getByText("Expired")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Find an item"), { target: { value: "syrup" } });
  expect(await screen.findByText("Not sellable")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Old syrup/ })).toBeDisabled();
  cleanup();
  modules.pharmaMode = true;
  view();
  expect(await screen.findByRole("heading", { name: "Pharmacy" })).toBeInTheDocument();
  expect(screen.getByText("Prescription details")).toBeInTheDocument();
  expect(screen.getByLabelText("Find a medicine")).toBeInTheDocument();
});

it("lists past receipts with payment and cashier filters, and reprints one", async () => {
  vi.mocked(billing.listDocs).mockResolvedValue([
    { id: 5, number: "R-5", customer_name: "Walk-in customer", status: "paid", template: "receipt", total: 40, issue_date: today, user_id: "me" },
    { id: 6, number: "R-6", customer_name: "Asha Traders", status: "paid", template: "receipt", total: 60, issue_date: today, user_id: "other" },
    { id: 7, number: "INV-7", customer_name: "Big Co", status: "sent", template: "minimal", total: 900, issue_date: today },
  ] as InvoiceDocSummary[]);
  vi.spyOn(billing, "allPayments").mockResolvedValue([
    { id: 1, invoice_id: 5, amount: 40, method: "cash", paid_at: today }, { id: 2, invoice_id: 6, amount: 60, method: "card", paid_at: today },
  ] as InvoicePayment[]);
  const print = vi.spyOn(receipt, "printSavedReceipt").mockResolvedValue();
  view();
  fireEvent.click(await screen.findByRole("tab", { name: "Sales history" }));
  expect(await screen.findByText("R-5")).toBeInTheDocument();
  expect(screen.getByText("R-6")).toBeInTheDocument();
  expect(screen.queryByText("INV-7")).toBeNull();
  fireEvent.change(screen.getByLabelText("Paid by"), { target: { value: "card" } });
  expect(screen.queryByText("R-5")).toBeNull();
  fireEvent.change(screen.getByLabelText("Paid by"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("Cashier"), { target: { value: "me" } });
  expect(screen.queryByText("R-6")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Print R-5" }));
  await waitFor(() => expect(print).toHaveBeenCalledWith(5));
});
