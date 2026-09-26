import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import Suppliers from "../Suppliers";
import EmployeeDetail from "../EmployeeDetail";
import CustomerDetail from "../CustomerDetail";
import SupplierDetail from "../SupplierDetail";
import { crm, hr, suppliers } from "../../lib/api";

vi.mock("../../lib/ui", () => ({ useUI: () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  confirm: vi.fn(async () => false),
}) }));
vi.mock("../../lib/realtime", () => ({ useLiveSync: () => {}, notifyDataChanged: () => {} }));
vi.mock("../../components/CrmRecordPanel", () => ({ default: () => null }));
vi.mock("../../lib/api", async (original) => {
  const api = await original<typeof import("../../lib/api")>();
  return { ...api,
    suppliers: { ...api.suppliers, list: vi.fn(async () => []), create: vi.fn() },
    erp: { ...api.erp, products: vi.fn(async () => []), orders: vi.fn(async () => []) },
    crm: { ...api.crm, customers: vi.fn(async () => []), opportunities: vi.fn(async () => []) },
    billing: { ...api.billing, listDocs: vi.fn(async () => []), getCompany: vi.fn(async () => null) },
    quotes: { ...api.quotes, listDocs: vi.fn(async () => []) },
    receipts: { ...api.receipts, list: vi.fn(async () => []) },
    pos: { ...api.pos, list: vi.fn(async () => []), allPayments: vi.fn(async () => []) },
    hr: { ...api.hr, employees: vi.fn(), payroll: vi.fn(async () => []), attendance: vi.fn(async () => []) },
  };
});

it.each([
  { label: "customer", route: "/customers/17", component: <CustomerDetail />, fail: () => vi.mocked(crm.customers).mockRejectedValueOnce(new Error("Read denied")) },
  { label: "supplier", route: "/suppliers/17", component: <SupplierDetail />, fail: () => vi.mocked(suppliers.list).mockRejectedValueOnce(new Error("Read denied")) },
])("shows a retryable $label error instead of claiming the record was removed", async ({ label, route, component, fail }) => {
  fail();
  render(<MemoryRouter initialEntries={[route]}><Routes>
    <Route path={`/${label}s/:id`} element={component} />
  </Routes></MemoryRouter>);
  expect(await screen.findByRole("alert")).toHaveTextContent("Read denied");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText(new RegExp(`${label} not found`, "i"));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("keeps supplier identity and draft stable during save, ignores duplicate submission and allows retry after failure", async () => {
  let reject!: (error: Error) => void;
  vi.mocked(suppliers.create).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  render(<MemoryRouter><Suppliers /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "New supplier" }));
  const dialog = screen.getByRole("dialog", { name: "New supplier" });
  const name = within(dialog).getByLabelText("Name *");
  fireEvent.change(name, { target: { value: "Supplier draft" } });
  const create = within(dialog).getByRole("button", { name: "Create supplier" });
  expect(create).toHaveClass("btn-primary");
  const form = name.closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(suppliers.create).toHaveBeenCalledTimes(1);
  expect(name).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Close dialog" }));
  expect(dialog).toBeInTheDocument();
  await act(async () => { reject(new Error("Permission denied")); });
  expect(within(dialog).getByRole("alert")).toHaveTextContent("Permission denied");
  expect(name).toHaveValue("Supplier draft");
  expect(name).toBeEnabled();
  vi.mocked(suppliers.create).mockResolvedValueOnce(17);
  fireEvent.submit(form);
  await act(async () => {});
  expect(suppliers.create).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("distinguishes an unavailable employee read from a missing employee and offers a retry", async () => {
  vi.mocked(hr.employees).mockRejectedValueOnce(new Error("Database unavailable"));
  render(<MemoryRouter initialEntries={["/people/17"]}><Routes>
    <Route path="/people/:id" element={<EmployeeDetail />} />
  </Routes></MemoryRouter>);
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load employee: Database unavailable");
  expect(screen.queryByText("That employee no longer exists.")).not.toBeInTheDocument();
  vi.mocked(hr.employees).mockResolvedValueOnce([]);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("That employee no longer exists.")).toBeInTheDocument();
});
