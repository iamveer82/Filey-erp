import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import InvoiceImportModal from "../InvoiceImportModal";
import { billing, type InvoiceDocInput, type InvoiceDocSummary } from "../../lib/api";
import { setDataMode } from "../../lib/dataMode";

vi.mock("../../lib/ui", () => ({ useUI: () => ({ toast: { success: vi.fn(), error: vi.fn() } }) }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

test("an interrupted batch keeps saved drafts, retries only remaining rows, and stops on workspace change", async () => {
  setDataMode("local");
  const rows: InvoiceDocSummary[] = [];
  vi.spyOn(billing, "listDocs").mockImplementation(async () => [...rows]);
  const save = vi.spyOn(billing, "saveDoc").mockImplementationOnce(async doc => {
    rows.push({ id: 1, number: doc.number } as InvoiceDocSummary); return 1;
  }).mockRejectedValueOnce(new Error("Connection interrupted")).mockImplementationOnce(async doc => {
    rows.push({ id: 2, number: doc.number } as InvoiceDocSummary); return 2;
  });
  const base: InvoiceDocInput = { number: "", customer_name: "", seller_name: "Sample seller", status: "draft", template: "corporate", accent: "#222", currency: "AED", tax_rate: 5, discount: 0, items: [] };
  const ui = render(<InvoiceImportModal base={base} onClose={() => {}} onSaved={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Excel or CSV" }));
  const file = new File([], "invoices.csv");
  Object.defineProperty(file, "text", { value: async () => "number,customer_name,issue_date,description,qty,unit_price\nINV-1,Sample,2026-09-29,Work,1,100\nINV-2,Sample,2026-09-29,Work,1,200\nINV-3,Sample,2026-09-29,Work,1,300" });
  fireEvent.change(ui.baseElement.querySelector('input[type="file"]')!, { target: { files: [file] } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Review invoices" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Review invoices" }));
  fireEvent.click(await screen.findByRole("button", { name: "Save 3 drafts" }));
  await screen.findByText("Connection interrupted");
  expect(save.mock.calls.map(([doc]) => doc.number)).toEqual(["INV-1", "INV-2"]);
  expect(save.mock.calls.every(([doc]) => doc.status === "draft" && doc.id === undefined)).toBe(true);
  expect(screen.getByText(/1 drafts saved/)).toBeInTheDocument();
  // The destination is rechecked before any write after a workspace switch.
  setDataMode("cloud");
  fireEvent.click(screen.getByRole("button", { name: "Save 2 drafts" }));
  await screen.findByText(/Your workspace changed/);
  expect(save).toHaveBeenCalledTimes(2);
  setDataMode("local");
  save.mockImplementationOnce(async doc => { rows.push({ id: 3, number: doc.number } as InvoiceDocSummary); return 3; });
  fireEvent.click(screen.getByRole("button", { name: "Save 2 drafts" }));
  await screen.findByText(/3 drafts saved/);
  expect(save.mock.calls.map(([doc]) => doc.number)).toEqual(["INV-1", "INV-2", "INV-2", "INV-3"]);
});
