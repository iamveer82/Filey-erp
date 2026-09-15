import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { UIProvider } from "../../lib/ui";
import { fin } from "../../lib/api";
import { uploadUserFile } from "../../lib/files";
import ExpenseEntry from "../ExpenseEntry";

vi.mock("../../lib/api", () => ({ fin: { accounts: vi.fn().mockResolvedValue([]), getExpense: vi.fn(), createExpense: vi.fn() } }));
vi.mock("../../lib/agentStorage", () => ({ agentStorageScope: () => "local:test" }));
vi.mock("../../lib/files", () => ({ uploadUserFile: vi.fn().mockResolvedValue("receipt-1"), getSavedFile: vi.fn(), fileBytes: vi.fn() }));
vi.mock("../../lib/exchange-rates", () => ({ getExchangeRates: async () => ({ AED: 1 }) }));
beforeEach(() => { localStorage.setItem("filey_data_mode", "local"); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("opens a separate page, calculates lines, and retains receipt and draft through a failed save without uploading twice", async () => {
  vi.mocked(fin.createExpense).mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce(42);
  const view = render(<MemoryRouter initialEntries={["/purchase"]}><UIProvider><Routes>
    <Route path="/purchase" element={<Link to="/purchase/new">Log expense</Link>} />
    <Route path="/purchase/new" element={<ExpenseEntry />} />
    <Route path="/purchase/:id" element={<p>Saved expense page</p>} />
  </Routes></UIProvider></MemoryRouter>);
  fireEvent.click(view.getByRole("link", { name: "Log expense" }));
  await view.findByRole("heading", { name: "Log expense" });
  expect(view.queryByRole("dialog")).toBeNull();
  fireEvent.change(view.getByLabelText("Vendor / paid to"), { target: { value: "Stationery store" } });
  fireEvent.change(view.getByLabelText("Item 1 description"), { target: { value: "Printer paper" } });
  fireEvent.change(view.getByLabelText("Item 1 quantity"), { target: { value: "3" } });
  fireEvent.change(view.getByLabelText("Item 1 unit price"), { target: { value: "12" } });
  fireEvent.change(view.getByLabelText("Expense tax rate"), { target: { value: "5" } });
  fireEvent.change(view.getByLabelText("Attach receipt"), { target: { files: [new File(["%PDF-test"], "receipt.pdf", { type: "application/pdf" })] } });
  fireEvent.submit(view.container.querySelector("form")!);
  await view.findByText(/Offline.*receipt is kept/);
  expect(view.getByLabelText("Vendor / paid to")).toHaveValue("Stationery store");
  expect(fin.createExpense).toHaveBeenCalledWith("Office Supplies", "Stationery store — Printer paper", 37.8, expect.any(String), null, expect.objectContaining({ receipt: expect.objectContaining({ id: "receipt-1" }), items: [{ description: "Printer paper", qty: 3, unit: "pcs", unit_price: 12 }] }));
  fireEvent.submit(view.container.querySelector("form")!);
  await view.findByText("Saved expense page");
  expect(uploadUserFile).toHaveBeenCalledOnce();
  expect(vi.mocked(fin.createExpense).mock.calls[0][5]?.submission_id).toBe(vi.mocked(fin.createExpense).mock.calls[1][5]?.submission_id);
});
it("rejects invalid dropped receipts and keeps a removed line out of the total", async () => {
  const view = render(<MemoryRouter><UIProvider><ExpenseEntry /></UIProvider></MemoryRouter>);
  await view.findByRole("heading", { name: "Log expense" });
  fireEvent.click(view.getByRole("button", { name: "Add item" }));
  fireEvent.change(view.getByLabelText("Item 2 unit price"), { target: { value: "90" } });
  fireEvent.click(view.getByRole("button", { name: "Remove item 2" }));
  expect(view.queryByLabelText("Item 2 unit price")).toBeNull();
  fireEvent.change(view.getByLabelText("Attach receipt"), { target: { files: [new File(["bad"], "receipt.exe")] } });
  await waitFor(() => expect(view.getByRole("alert")).toHaveTextContent("Choose a PDF"));
  expect(uploadUserFile).not.toHaveBeenCalled();
});
