import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Customers from "../Customers";
import CustomerDetail from "../CustomerDetail";
import { advances, billing, crm, erp, quotes, receipts, type CompanyProfile, type CrmCustomer } from "../../lib/api";
import { customerOpeningBalanceInputs, readCustomerOpeningBalance } from "../../lib/customerOpeningBalance";

vi.mock("../../lib/ui", () => ({ useUI: () => ({ toast: { success: vi.fn(), error: vi.fn() }, confirm: async () => false }) }));
vi.mock("../../lib/realtime", () => ({ useLiveSync: () => {} }));
vi.mock("../../lib/customFields", async original => ({ ...await original<typeof import("../../lib/customFields")>(), syncCustomFields: async () => [] }));
vi.mock("../../components/ActivityTimeline", () => ({ default: () => null }));
vi.mock("../../components/StickyNotes", () => ({ default: () => null }));
vi.mock("../../components/LinkedRecords", () => ({ default: () => null }));
vi.mock("../../components/CrmRecordPanel", () => ({ default: () => null }));
vi.mock("../../components/ContactsPanel", () => ({ default: () => null }));
vi.mock("../../components/PartyBankDetails", () => ({ default: () => null }));
vi.mock("../../components/FollowUps", () => ({ default: () => null }));
vi.mock("../../components/AdvanceCard", () => ({ default: () => null }));
vi.mock("../../components/statements/StatementModal", () => ({ default: () => null }));

const customer = { id: 17, name: "Demo customer", credit_limit: 750, opening_balance: 0, created_at: "2026-10-04" } satisfies CrmCustomer;

beforeEach(() => {
  vi.spyOn(crm, "customers").mockResolvedValue([customer]);
  vi.spyOn(crm, "createCustomer").mockResolvedValue(18);
  vi.spyOn(crm, "updateCustomer").mockResolvedValue(undefined);
  vi.spyOn(billing, "getCompany").mockResolvedValue({ name: "Demo company", currency: "AED", country_code: "AE" } as CompanyProfile);
  vi.spyOn(billing, "listDocs").mockResolvedValue([]);
  vi.spyOn(billing, "payments").mockResolvedValue([]);
  vi.spyOn(advances, "forParty").mockResolvedValue([]);
  vi.spyOn(crm, "opportunities").mockResolvedValue([]);
  vi.spyOn(erp, "orders").mockResolvedValue([]);
  vi.spyOn(quotes, "listDocs").mockResolvedValue([]);
  vi.spyOn(receipts, "list").mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

async function newCustomer() {
  render(<MemoryRouter initialEntries={["/customers?new=1"]}><Customers /></MemoryRouter>);
  const dialog = within(await screen.findByRole("dialog", { name: "New customer" }));
  fireEvent.change(dialog.getByLabelText("Contact name *"), { target: { value: "New demo customer" } });
  await waitFor(() => expect(dialog.getByRole("button", { name: "Create customer" })).toBeEnabled());
  return dialog;
}

it.each([
  { label: "Debit / Payable", value: "125.75", expected: -125.75 },
  { label: "Credit / Receivable", value: "125.75", expected: 125.75 },
])("creates a signed customer opening balance from $label and keeps credit limit independent", async ({ label, value, expected }) => {
  const dialog = await newCustomer();
  expect(dialog.getByLabelText("Debit / Payable")).toHaveClass("border-danger");
  expect(dialog.getByLabelText("Credit / Receivable")).toHaveClass("border-success");
  expect(dialog.getByLabelText(label)).toHaveAttribute("inputmode", "decimal");
  fireEvent.change(dialog.getByLabelText(label), { target: { value } });
  fireEvent.change(dialog.getByLabelText("Credit limit (AED)"), { target: { value: "500" } });
  fireEvent.click(dialog.getByRole("button", { name: "Create customer" }));
  await waitFor(() => expect(crm.createCustomer).toHaveBeenCalledWith(expect.objectContaining({ opening_balance: expected, credit_limit: 500 })));
});

it("does not silently net two nonzero opening amounts and lets the user correct the choice", async () => {
  const dialog = await newCustomer();
  fireEvent.change(dialog.getByLabelText("Debit / Payable"), { target: { value: "50" } });
  fireEvent.change(dialog.getByLabelText("Credit / Receivable"), { target: { value: "100" } });
  fireEvent.click(dialog.getByRole("button", { name: "Create customer" }));
  expect(dialog.getByRole("alert")).toHaveTextContent("Enter either payable or receivable");
  expect(dialog.getByLabelText("Credit / Receivable")).toHaveAccessibleDescription(/Clear one amount/);
  expect(crm.createCustomer).not.toHaveBeenCalled();
  fireEvent.change(dialog.getByLabelText("Debit / Payable"), { target: { value: "" } });
  fireEvent.click(dialog.getByRole("button", { name: "Create customer" }));
  await waitFor(() => expect(crm.createCustomer).toHaveBeenCalledWith(expect.objectContaining({ opening_balance: 100 })));
});

it.each(["-10", "1.234", "Infinity", "NaN", "1e9", "1,000", "100000000000000000000", "90071992547409.90"])("blocks invalid amount %s before creating a customer", async value => {
  const dialog = await newCustomer();
  fireEvent.change(dialog.getByLabelText("Credit / Receivable"), { target: { value } });
  fireEvent.click(dialog.getByRole("button", { name: "Create customer" }));
  expect(dialog.getByRole("alert")).toBeInTheDocument();
  expect(dialog.getByLabelText("Credit / Receivable")).toHaveAttribute("aria-invalid", "true");
  expect(crm.createCustomer).not.toHaveBeenCalled();
});

it.each([125.75, -125.75])("opens the full customer editor on the correct side and saves %s unchanged", async opening_balance => {
  vi.mocked(crm.customers).mockResolvedValue([{ ...customer, opening_balance }]);
  render(<MemoryRouter initialEntries={["/customers/17"]}><Routes><Route path="/customers/:id" element={<CustomerDetail />} /></Routes></MemoryRouter>);
  const direction = await screen.findByText(opening_balance > 0 ? "Credit / Receivable" : "Debit / Payable");
  expect(direction.parentElement).toHaveClass(opening_balance > 0 ? "text-success" : "text-danger");
  expect(direction.parentElement).not.toHaveTextContent("-125.75");
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  const dialog = within(await screen.findByRole("dialog", { name: "Edit customer" }));
  expect(dialog.getByLabelText("Debit / Payable")).toHaveValue(opening_balance < 0 ? "125.75" : "");
  expect(dialog.getByLabelText("Credit / Receivable")).toHaveValue(opening_balance > 0 ? "125.75" : "");
  fireEvent.click(dialog.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(crm.updateCustomer).toHaveBeenCalledWith(17, expect.objectContaining({ opening_balance, credit_limit: 750 })));
});

it("clears a previously saved balance explicitly to zero through the directory editor", async () => {
  vi.mocked(crm.customers).mockResolvedValue([{ ...customer, opening_balance: -50 }]);
  render(<MemoryRouter><Customers /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "More actions" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
  const dialog = within(await screen.findByRole("dialog", { name: "Edit customer" }));
  expect(dialog.getByLabelText("Debit / Payable")).toHaveValue("50");
  await waitFor(() => expect(dialog.getByRole("button", { name: "Save changes" })).toBeEnabled());
  fireEvent.change(dialog.getByLabelText("Debit / Payable"), { target: { value: "" } });
  fireEvent.click(dialog.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(crm.updateCustomer).toHaveBeenCalledWith(17, expect.objectContaining({ opening_balance: 0 })));
});

it.each([0, 0.01, -0.01, 123456.78, -123456.78])("round trips stored balance %s without changing the accounting sign", value => {
  expect(readCustomerOpeningBalance(customerOpeningBalanceInputs(value))).toEqual({ value, error: null });
});

it("preserves decimal typing and permits a zero on the unused side", () => {
  expect(readCustomerOpeningBalance({ payable: "0.00", receivable: " .25 " })).toEqual({ value: 0.25, error: null });
  expect(readCustomerOpeningBalance({ payable: "25.", receivable: "0" })).toEqual({ value: -25, error: null });
});
