import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { UIProvider } from "../../lib/ui";
import Inventory from "../Inventory";

const mock = vi.hoisted(() => ({ recordStocktake: vi.fn(), recordStockEntry: vi.fn(), products: vi.fn(), StocktakeChangedError: class StocktakeChangedError extends Error {} }));
const products = [
  { id: 1, name: "Product A", sku: "A", quantity: 10, unit_price: 10, cost_price: 5, reorder_level: 0, category: "Stock", created_at: "2026-10-03" },
  { id: 2, name: "Product B", sku: "B", quantity: 20, unit_price: 20, cost_price: 5, reorder_level: 0, category: "Stock", created_at: "2026-10-03" },
];
vi.mock("../../lib/api", () => ({ StocktakeChangedError: mock.StocktakeChangedError, erp: { products: mock.products, stockMovements: async () => ({}), recordStocktake: mock.recordStocktake, recordStockEntry: mock.recordStockEntry }, pos: { createDraftsFromLowStock: vi.fn() }, shareRecord: vi.fn(), insertedBefore: () => 0, billing: { listDocs: async () => [] } }));
vi.mock("../../lib/realtime", () => ({ useLiveSync: () => {} }));
vi.mock("../../components/BarcodeScanner", () => ({ default: () => null }));
vi.mock("../../components/ImportCsvModal", () => ({ default: () => null }));
vi.mock("../../components/RowActions", () => ({ RowActions: () => null, QuickViewModal: () => null, shareVia: vi.fn() }));
beforeEach(() => { mock.products.mockImplementation(async () => products.map(p => ({ ...p }))); mock.recordStocktake.mockResolvedValue(undefined); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });
async function mount() {
  render(<MemoryRouter><UIProvider><Inventory /></UIProvider></MemoryRouter>);
  await screen.findByText("Product A");
  fireEvent.click(screen.getByRole("button", { name: "Stocktake" }));
  await screen.findByRole("dialog", { name: "Stocktake: physical count" });
}
function count(name: string, value: string) { fireEvent.change(screen.getByLabelText(`Counted quantity for ${name}`), { target: { value } }); }

it("retries only the remaining adjustments after a later stocktake row fails", async () => {
  mock.recordStocktake.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Connection interrupted")).mockResolvedValueOnce(undefined);
  await mount();
  count("Product A", "12"); count("Product B", "23");
  fireEvent.click(screen.getByRole("button", { name: /Post adjustments/ }));
  await screen.findByText("Connection interrupted");
  expect(screen.getByLabelText("Counted quantity for Product A")).toHaveValue(null);
  expect(screen.getByLabelText("Counted quantity for Product B")).toHaveValue(23);
  await waitFor(() => expect(screen.getByRole("button", { name: /Post adjustments/ })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: /Post adjustments/ }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Stocktake: physical count" })).not.toBeInTheDocument());
  expect(mock.recordStocktake.mock.calls).toEqual([
    [1, 12, 10, expect.any(String)],
    [2, 23, 20, expect.any(String)],
    [2, 23, 20, expect.any(String)],
  ]);
  expect(mock.recordStocktake.mock.calls[2][3]).toBe(mock.recordStocktake.mock.calls[1][3]);
  expect(mock.recordStockEntry).not.toHaveBeenCalled();
});

it("preserves fractional quantities rather than silently rounding stock counts", async () => {
  mock.products.mockResolvedValue(products.map(p => ({ ...p, quantity: p.id === 1 ? 10.25 : p.quantity })));
  await mount(); count("Product A", "12.75");
  expect(screen.getByLabelText("Counted quantity for Product A")).toHaveAttribute("step", "0.001");
  fireEvent.click(screen.getByRole("button", { name: /Post adjustments/ }));
  await waitFor(() => expect(mock.recordStocktake).toHaveBeenCalledWith(1, 12.75, 10.25, expect.any(String)));
});

it("blocks a partial post while any entered count is invalid", async () => {
  await mount(); count("Product A", "-1"); count("Product B", "23");
  expect(screen.getByRole("alert")).toHaveTextContent("Enter a quantity of 0 or more");
  expect(screen.getByRole("button", { name: /Post adjustments/ })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /Post adjustments/ }));
  expect(mock.recordStocktake).not.toHaveBeenCalled();
});

it("retains the exact request after the stock count commits but its acknowledgement is lost", async () => {
  let quantity = 10;
  let movements = 0;
  const receipts = new Set<string>();
  mock.recordStocktake.mockImplementation(async (_id: number, counted: number, expected: number, request: string) => {
    if (receipts.has(request)) return counted;
    expect(quantity).toBe(expected);
    quantity = counted; movements++; receipts.add(request);
    throw new Error("Response lost after commit");
  });
  await mount(); count("Product A", "12");
  fireEvent.click(screen.getByRole("button", { name: /Post adjustments/ }));
  await screen.findByText("Response lost after commit");
  expect(screen.getByLabelText("Counted quantity for Product A")).toHaveValue(12);
  expect(screen.getByLabelText("Counted quantity for Product A")).toBeDisabled();
  mock.products.mockRejectedValueOnce(new Error("Could not verify current stock"));
  fireEvent.click(screen.getByRole("button", { name: "Reload stock" }));
  await screen.findByText("Could not verify current stock");
  expect(mock.products).toHaveBeenLastCalledWith({ fresh: true });
  fireEvent.click(screen.getByRole("button", { name: /Post adjustments/ }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Stocktake: physical count" })).not.toBeInTheDocument());
  expect(mock.recordStocktake.mock.calls).toHaveLength(2);
  expect(mock.recordStocktake.mock.calls[1]).toEqual(mock.recordStocktake.mock.calls[0]);
  expect(quantity).toBe(12);
  expect(movements).toBe(1);
  expect(mock.recordStockEntry).not.toHaveBeenCalled();
});

it("reloads verified book stock for a reviewed new count after a concurrent change", async () => {
  mock.recordStocktake.mockRejectedValueOnce(new mock.StocktakeChangedError("Stock changed. Reload stock and review the physical count."));
  await mount(); count("Product A", "12");
  fireEvent.click(screen.getByRole("button", { name: /Post adjustments/ }));
  await screen.findByText("Stock changed. Reload stock and review the physical count.");
  mock.products.mockResolvedValueOnce(products.map(p => ({ ...p, quantity: p.id === 1 ? 11 : p.quantity })));
  fireEvent.click(screen.getByRole("button", { name: "Reload stock" }));
  await screen.findByText("Stock reloaded. Review your physical counts before posting.");
  expect(mock.products).toHaveBeenLastCalledWith({ fresh: true });
  expect(screen.getByLabelText("Counted quantity for Product A")).toHaveValue(12);
  fireEvent.click(screen.getByRole("button", { name: /Post adjustments/ }));
  await waitFor(() => expect(mock.recordStocktake).toHaveBeenCalledTimes(2));
  expect(mock.recordStocktake.mock.calls[0]).toEqual([1, 12, 10, expect.any(String)]);
  expect(mock.recordStocktake.mock.calls[1]).toEqual([1, 12, 11, expect.any(String)]);
  expect(mock.recordStocktake.mock.calls[1][3]).not.toBe(mock.recordStocktake.mock.calls[0][3]);
});

it("keeps an ambiguous request unchanged even after a successful fresh read", async () => {
  mock.recordStocktake.mockRejectedValueOnce(new Error("Request timed out"));
  await mount(); count("Product A", "12");
  fireEvent.click(screen.getByRole("button", { name: /Post adjustments/ }));
  await screen.findByText("Request timed out");
  mock.products.mockResolvedValueOnce(products.map(p => ({ ...p, quantity: p.id === 1 ? 12 : p.quantity })));
  fireEvent.click(screen.getByRole("button", { name: "Reload stock" }));
  await screen.findByText("Stock reloaded. Review your physical counts before posting.");
  expect(screen.getByLabelText("Counted quantity for Product A")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /Post adjustments/ }));
  await waitFor(() => expect(mock.recordStocktake).toHaveBeenCalledTimes(2));
  expect(mock.recordStocktake.mock.calls[1]).toEqual(mock.recordStocktake.mock.calls[0]);
});

it("keeps an unsupported cloud count for retry without replaying an unsafe delta", async () => {
  mock.recordStocktake.mockRejectedValue(new Error("Cloud stocktake migration is required"));
  await mount(); count("Product A", "12");
  fireEvent.click(screen.getByRole("button", { name: /Post adjustments/ }));
  await screen.findByText("Cloud stocktake migration is required");
  expect(screen.getByLabelText("Counted quantity for Product A")).toHaveValue(12);
  expect(mock.recordStockEntry).not.toHaveBeenCalled();
});
