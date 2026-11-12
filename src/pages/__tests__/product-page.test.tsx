import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { UIProvider } from "../../lib/ui";
import { erp, suppliers, type Product, type Supplier } from "../../lib/api";
import { BATCHES_KEY, readBatches } from "../../lib/batches";
import { barcodeKind } from "../../lib/barcode";
import * as receipt from "../../lib/receipt";
import ProductPage from "../ProductPage";

const existing = { id: 7, name: "Paracetamol", sku: "PCM", barcode: "4006381333931", category: "Tablets", quantity: 20, unit_price: 10, cost_price: 6,
  reorder_level: 0, created_at: "", custom_fields: { [BATCHES_KEY]: JSON.stringify([{ no: "A1", exp: "2099-01-31", qty: 20 }]), colour: "white" } } as Product;

beforeEach(() => {
  vi.spyOn(suppliers, "list").mockResolvedValue([{ id: 3, name: "Medi Distributors" }] as Supplier[]);
  vi.spyOn(erp, "products").mockResolvedValue([existing]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

const open = (path: string) => render(<MemoryRouter initialEntries={[path]}><UIProvider><Routes>
  <Route path="/inventory" element={<p>Inventory list</p>} />
  <Route path="/inventory/:id" element={<ProductPage />} />
</Routes></UIProvider></MemoryRouter>);

it("adds a product barcode-first: generated in-store EAN-13, opening batch, supplier, then back to Inventory", async () => {
  const create = vi.spyOn(erp, "createProduct").mockResolvedValue(1);
  open("/inventory/new");
  fireEvent.click(await screen.findByRole("button", { name: /Generate/ }));
  const code = (screen.getByLabelText("Barcode") as HTMLInputElement).value;
  expect(barcodeKind(code)).toBe("ean13");
  expect(code.startsWith("2")).toBe(true);
  expect(screen.getByText(/check digit correct · in-store code/)).toBeInTheDocument();
  expect(document.querySelector("[data-barcode-preview] svg")).not.toBeNull();
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Paracetamol 500mg Strip" } });
  fireEvent.click(screen.getByRole("button", { name: "From name" }));
  expect(screen.getByLabelText("SKU")).toHaveValue("PARA-500-STRI");
  fireEvent.click(screen.getByRole("radio", { name: "strip" }));
  fireEvent.change(screen.getByLabelText("Selling price"), { target: { value: "12" } });
  fireEvent.change(screen.getByLabelText("Cost price"), { target: { value: "9" } });
  expect(screen.getByText("25.0% margin")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Tax code"), { target: { value: "3004" } });
  fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "50" } });
  await screen.findByRole("option", { name: "Medi Distributors" });
  fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: "3" } });
  fireEvent.change(screen.getByLabelText("Opening batch number"), { target: { value: "b2401" } });
  fireEvent.change(screen.getByLabelText("Opening batch expiry"), { target: { value: "06/27" } });
  fireEvent.click(screen.getByRole("button", { name: "Save product" }));
  await waitFor(() => expect(create).toHaveBeenCalled());
  const saved = create.mock.calls[0][0] as Product;
  expect(saved).toMatchObject({ name: "Paracetamol 500mg Strip", sku: "PARA-500-STRI", unit: "strip", quantity: 50, barcode: code, supplier_id: 3, batch_number: "B2401", expiry_date: "2027-06-30" });
  expect(saved.custom_fields?.hsn).toBe("3004");
  expect(readBatches(saved)).toEqual([expect.objectContaining({ no: "B2401", exp: "2027-06-30", qty: 50 })]);
  expect(await screen.findByText("Inventory list")).toBeInTheDocument();
});

it("warns about a barcode or SKU another product already uses, and a wrong check digit", async () => {
  const create = vi.spyOn(erp, "createProduct").mockResolvedValue(1);
  open("/inventory/new");
  const code = await screen.findByLabelText("Barcode");
  fireEvent.change(code, { target: { value: "4006381333931" } });
  expect(screen.getByText(/Already used by/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Paracetamol" })).toHaveAttribute("href", "/inventory/7");
  fireEvent.change(code, { target: { value: "4006381333932" } });
  expect(screen.getByText(/last digit should be 1/)).toBeInTheDocument();
  fireEvent.change(code, { target: { value: "4006381333931" } });
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Copy" } });
  fireEvent.change(screen.getByLabelText("SKU"), { target: { value: "pcm" } });
  fireEvent.click(screen.getByRole("button", { name: "Save product" }));
  expect((await screen.findAllByText("Another product already uses this SKU.")).length).toBeGreaterThan(0);
  expect(create).not.toHaveBeenCalled();
});

it("saves and starts the next product, keeping category, unit and supplier", async () => {
  vi.spyOn(erp, "createProduct").mockResolvedValue(2);
  open("/inventory/new");
  fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Cough syrup" } });
  fireEvent.change(screen.getByLabelText("SKU"), { target: { value: "CS1" } });
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Syrups" } });
  fireEvent.click(screen.getByRole("radio", { name: "bottle" }));
  fireEvent.click(screen.getByRole("button", { name: "Save and add another" }));
  await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue(""));
  expect(screen.getByLabelText("Category")).toHaveValue("Syrups");
  expect(screen.getByRole("radio", { name: "bottle" })).toHaveAttribute("aria-checked", "true");
});

it("edits without touching stock, keeps batch data, and prints barcode labels", async () => {
  const update = vi.spyOn(erp, "updateProduct").mockResolvedValue(undefined as never);
  const print = vi.spyOn(receipt, "printHtml").mockResolvedValue(undefined);
  open("/inventory/7");
  expect(await screen.findByText(/20 left · exp/)).toBeInTheDocument();
  expect(screen.getByLabelText("Quantity")).toHaveAttribute("readonly");
  expect(screen.getByRole("button", { name: /Manage batches/ })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Copies"), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Print 3 labels" }));
  expect(print).toHaveBeenCalledOnce();
  const html = print.mock.calls[0][0];
  expect(html.match(/<svg/g)).toHaveLength(3);
  expect(html).toContain("Paracetamol");
  fireEvent.change(screen.getByLabelText("Selling price"), { target: { value: "11" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(update).toHaveBeenCalled());
  const patch = update.mock.calls[0][1] as Partial<Product>;
  expect(patch).not.toHaveProperty("quantity");
  expect(patch.unit_price).toBe(11);
  expect(patch.custom_fields).toMatchObject({ colour: "white", [BATCHES_KEY]: existing.custom_fields![BATCHES_KEY] });
});

it("says when a product no longer exists", async () => {
  open("/inventory/999");
  expect(await screen.findByText("This product no longer exists.")).toBeInTheDocument();
});
