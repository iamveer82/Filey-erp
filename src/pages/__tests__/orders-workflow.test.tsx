import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { UIProvider } from "../../lib/ui";
import Orders from "../Orders";

const mock = vi.hoisted(() => ({ getOrder: vi.fn(), updateOrder: vi.fn(), products: vi.fn(), refresh: undefined as undefined | (() => Promise<unknown>) }));
const orders = [
  { id: 1, order_number: "SO-0001", customer_name: "Customer A", status: "draft", total: 20, created_at: "2026-10-03" },
  { id: 2, order_number: "SO-0002", customer_name: "Customer B", status: "draft", total: 30, created_at: "2026-10-03" },
];
const product = { id: 10, name: "Product A", sku: "A", quantity: 20, unit_price: 10, cost_price: 5, reorder_level: 0, category: "Stock", created_at: "2026-10-03" };
const detail = (id: number) => ({ ...orders[id - 1], items: [{ product_id: 10, quantity: id + 1, unit_price: 10 }] });
vi.mock("../../lib/api", () => ({ erp: { orders: async () => orders, products: mock.products, getOrder: mock.getOrder, updateOrder: mock.updateOrder }, crm: { customers: async () => [] } }));
vi.mock("../../lib/realtime", () => ({ useLiveSync: (load: () => Promise<unknown>) => { mock.refresh = load; } }));
vi.mock("../../lib/numberFormat", () => ({ loadDocFormats: async () => ({}), pickDocNumber: () => "SO-0003" }));
vi.mock("../../components/ProductPicker", () => ({ default: () => null }));
vi.mock("../../components/RowActions", () => ({ RowActions: ({ onEdit }: { onEdit: () => void }) => <button onClick={onEdit}>Edit</button>, QuickViewModal: () => null, shareVia: vi.fn() }));
vi.mock("../../lib/email", () => ({ sendShareEmail: vi.fn() }));

beforeEach(() => {
  mock.getOrder.mockImplementation(async (id: number) => detail(id));
  mock.updateOrder.mockResolvedValue(undefined);
  mock.products.mockImplementation(async () => [{ ...product }]);
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const mount = () => render(<MemoryRouter><UIProvider><Orders /></UIProvider></MemoryRouter>);
async function edit(number: string) {
  const row = (await screen.findByText(number)).closest("tr")!;
  fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
  return screen.findByRole("dialog", { name: "Edit order" });
}

it("clears the previous order after a failed read and only saves the retried order", async () => {
  mount();
  await edit("SO-0001");
  expect(await screen.findByLabelText("Customer *")).toHaveValue("Customer A");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  mock.getOrder.mockRejectedValueOnce(new Error("Connection interrupted"));
  await edit("SO-0002");
  await screen.findByText("Could not load this order: Connection interrupted");
  expect(screen.queryByLabelText("Customer *")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  expect(mock.updateOrder).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByLabelText("Customer *")).toHaveValue("Customer B");
  fireEvent.change(screen.getByLabelText("Customer *"), { target: { value: "Updated B" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(mock.updateOrder).toHaveBeenCalledWith(2, { customer_name: "Updated B", status: "draft", total: 30 }, [{ product_id: 10, quantity: 3, unit_price: 10 }]));
});

it("ignores an older order response after the editor switches to another order", async () => {
  let resolve!: (value: ReturnType<typeof detail>) => void;
  mock.getOrder.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  mount();
  await edit("SO-0001");
  fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
  await edit("SO-0002");
  expect(await screen.findByLabelText("Customer *")).toHaveValue("Customer B");
  await act(async () => { resolve(detail(1)); });
  expect(screen.getByLabelText("Customer *")).toHaveValue("Customer B");
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(mock.updateOrder).toHaveBeenCalledWith(2, expect.objectContaining({ customer_name: "Customer B" }), expect.any(Array)));
});

it("retains unsaved order changes when inventory refreshes in the background", async () => {
  mount();
  await edit("SO-0001");
  const customer = await screen.findByLabelText("Customer *");
  fireEvent.change(customer, { target: { value: "Unsaved customer edit" } });
  await act(async () => { await mock.refresh?.(); });
  expect(screen.getByLabelText("Customer *")).toHaveValue("Unsaved customer edit");
  expect(mock.getOrder).toHaveBeenCalledTimes(1);
});

it("does not silently delete invalid or unlinked order lines when saving", async () => {
  mock.getOrder.mockResolvedValueOnce({ ...detail(1), items: [{ product_id: null, quantity: 2, unit_price: 10 }] });
  mount();
  await edit("SO-0001");
  await screen.findByLabelText("Quantity for Item");
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("no longer linked to a product");
  expect(mock.updateOrder).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await edit("SO-0002");
  fireEvent.change(await screen.findByLabelText("Quantity for Product A"), { target: { value: "-2" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("zero or greater");
  expect(mock.updateOrder).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Quantity for Product A"), { target: { value: "0" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(mock.updateOrder).toHaveBeenCalledWith(2, expect.objectContaining({ total: 0 }), [{ product_id: 10, quantity: 0, unit_price: 10 }]));
});
