import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Suppliers from "../Suppliers";
import SupplierDetail from "../SupplierDetail";
import { advances, billing, erp, pos, suppliers, type CompanyProfile } from "../../lib/api";
import { supplierCustomFields, supplierInvoiceDetails } from "../../lib/supplierInvoiceDetails";

vi.mock("../../lib/ui", () => ({ useUI: () => ({ toast: { success: vi.fn(), error: vi.fn() }, confirm: async () => false }) }));
vi.mock("../../lib/realtime", () => ({ useLiveSync: () => {} }));
vi.mock("../../components/ActivityTimeline", () => ({ default: () => null }));
vi.mock("../../components/LinkedRecords", () => ({ default: () => null }));
vi.mock("../../components/PartyBankDetails", () => ({ default: () => null }));
vi.mock("../../components/AdvanceCard", () => ({ default: () => null }));
vi.mock("../../components/statements/StatementModal", () => ({ default: () => null }));

const identity = { tin: "1234567890", endpoint_id: "1234567890", endpoint_scheme: "0235", legal_id: "LIC-100" };
const supplier = { id: 18, name: "Saved supplier", tax_id: "123456789000003", created_at: "2026-10-08", bank_details: { iban: "KEEP-BANK" },
  custom_fields: { city: "Dubai", country_code: "AE", country_subdivision: "DU", einvoice_identity: JSON.stringify(identity), unrelated: "Keep this value" } };

beforeEach(() => {
  vi.spyOn(suppliers, "list").mockResolvedValue([supplier]);
  vi.spyOn(suppliers, "create").mockResolvedValue(19);
  vi.spyOn(suppliers, "update").mockResolvedValue(undefined);
  vi.spyOn(erp, "products").mockResolvedValue([]);
  vi.spyOn(pos, "list").mockResolvedValue([]);
  vi.spyOn(pos, "allPayments").mockResolvedValue([]);
  vi.spyOn(advances, "forParty").mockResolvedValue([]);
  vi.spyOn(billing, "getCompany").mockResolvedValue({ name: "Company", country_code: "AE", currency: "AED" } as CompanyProfile);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

async function newSupplier() {
  render(<MemoryRouter initialEntries={["/suppliers?new=1"]}><Suppliers /></MemoryRouter>);
  const dialog = within(await screen.findByRole("dialog", { name: "New supplier" }));
  fireEvent.change(dialog.getByLabelText("Name *"), { target: { value: "New supplier" } });
  return dialog;
}

it("creates a supplier with no electronic identity or address requirements", async () => {
  const dialog = await newSupplier();
  fireEvent.click(dialog.getByRole("button", { name: "Create supplier" }));
  await waitFor(() => expect(suppliers.create).toHaveBeenCalledWith(expect.objectContaining({ name: "New supplier", custom_fields: {} })));
});

it("stores optional identity and location in the supplier record", async () => {
  const dialog = await newSupplier();
  fireEvent.change(dialog.getByLabelText("City"), { target: { value: "Dubai" } });
  fireEvent.click(dialog.getByText("Electronic invoicing identity · optional"));
  fireEvent.change(dialog.getByLabelText("Electronic invoicing TIN"), { target: { value: identity.tin } });
  fireEvent.change(dialog.getByLabelText("Electronic invoicing address"), { target: { value: identity.endpoint_id } });
  fireEvent.change(dialog.getByLabelText("Own FTA-issued TRN"), { target: { value: "100123456700003" } });
  fireEvent.change(dialog.getByLabelText("Address scheme"), { target: { value: "0235" } });
  fireEvent.change(dialog.getByLabelText("Legal registration number"), { target: { value: "LIC-100" } });
  fireEvent.change(dialog.getByLabelText("Issuing authority / passport country"), { target: { value: "Dubai" } });
  fireEvent.keyDown(dialog.getByRole("combobox", { name: "Registration type" }), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: "Commercial / Trade license" }));
  fireEvent.click(dialog.getByRole("button", { name: "Create supplier" }));
  await waitFor(() => expect(suppliers.create).toHaveBeenCalled());
  const saved = vi.mocked(suppliers.create).mock.calls[0][0];
  expect(saved.custom_fields?.city).toBe("Dubai");
  expect(supplierInvoiceDetails(saved.custom_fields).identity).toEqual({ ...identity, corporate_trn: "100123456700003", legal_authority: "Dubai", legal_id_type: "TL" });
});

it("directory editing loads saved identity and allows clearing fields while preserving unrelated metadata", async () => {
  render(<MemoryRouter><Suppliers /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "More actions" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
  const dialog = within(await screen.findByRole("dialog", { name: "Edit supplier" }));
  fireEvent.click(dialog.getByText("Electronic invoicing identity · optional"));
  expect(dialog.getByLabelText("Electronic invoicing TIN")).toHaveValue(identity.tin);
  expect(dialog.getByLabelText("City")).toHaveValue("Dubai");
  fireEvent.change(dialog.getByLabelText("City"), { target: { value: "" } });
  fireEvent.change(dialog.getByLabelText("Electronic invoicing TIN"), { target: { value: "" } });
  fireEvent.click(dialog.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(suppliers.update).toHaveBeenCalled());
  const saved = vi.mocked(suppliers.update).mock.calls[0][1];
  expect(saved.custom_fields).toMatchObject({ city: "", unrelated: "Keep this value" });
  expect(supplierInvoiceDetails(saved.custom_fields).identity).toEqual({ ...identity, tin: "" });
  expect(saved).not.toHaveProperty("bank_details");
});

it("full supplier editor preserves the same saved metadata", async () => {
  render(<MemoryRouter initialEntries={["/suppliers/18"]}><Routes><Route path="/suppliers/:id" element={<SupplierDetail />} /></Routes></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  const dialog = within(await screen.findByRole("dialog", { name: "Edit supplier" }));
  fireEvent.click(dialog.getByText("Electronic invoicing identity · optional"));
  expect(dialog.getByLabelText("Legal registration number")).toHaveValue("LIC-100");
  fireEvent.click(dialog.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(suppliers.update).toHaveBeenCalledWith(18, expect.objectContaining({ custom_fields: supplier.custom_fields })));
});

it.each(["directory", "detail"])("clears outdated tax and contact presets in the %s supplier editor", async editor => {
  vi.mocked(suppliers.list).mockResolvedValue([{ ...supplier, contact_person: "Old contact", email: "old@example.test",
    phone: "+971501234567", address: "Old address", notes: "Old instructions" }]);
  if (editor === "directory") {
    render(<MemoryRouter><Suppliers /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
  } else {
    render(<MemoryRouter initialEntries={["/suppliers/18"]}><Routes><Route path="/suppliers/:id" element={<SupplierDetail />} /></Routes></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  }
  const dialog = within(await screen.findByRole("dialog", { name: "Edit supplier" }));
  for (const label of ["Contact person", "TRN", "Email", "Phone", "Address"]) {
    expect(dialog.getByLabelText(label)).not.toHaveValue("");
    fireEvent.change(dialog.getByLabelText(label), { target: { value: "" } });
  }
  if (editor === "directory") fireEvent.change(dialog.getByLabelText("Notes"), { target: { value: "" } });
  fireEvent.click(dialog.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(suppliers.update).toHaveBeenCalledWith(18, expect.objectContaining({
    contact_person: "", tax_id: "", email: "", phone: "", address: "", custom_fields: supplier.custom_fields,
    ...(editor === "directory" ? { notes: "" } : {}),
  })));
});

it("strictly reads imported metadata without converting objects or numbers into legal identifiers", () => {
  const malformed = { city: 42, country_code: ["AE"], country_subdivision: {}, einvoice_identity: JSON.stringify({ tin: 123, endpoint_id: {}, legal_id: "KEPT" }), unrelated: "preserved" };
  expect(supplierCustomFields(malformed)).toEqual({ einvoice_identity: malformed.einvoice_identity, unrelated: "preserved" });
  expect(supplierInvoiceDetails(malformed)).toEqual({ city: "", country_code: "", country_subdivision: "", identity: { legal_id: "KEPT" } });
  for (const value of [null, undefined, [], 15, "invalid", { einvoice_identity: "not json" }]) {
    expect(supplierInvoiceDetails(value)).toEqual({ city: "", country_code: "", country_subdivision: "", identity: {} });
  }
});
