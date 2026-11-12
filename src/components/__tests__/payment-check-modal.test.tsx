import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UIProvider } from "../../lib/ui";
import { billing, tools, type InvoiceDocSummary } from "../../lib/api";
import * as composio from "../../lib/composio";
import PaymentCheckModal from "../PaymentCheckModal";

let settings: { key: string; value: string }[] = [];
beforeEach(() => {
  settings = [];
  vi.spyOn(tools, "settings").mockImplementation(async () => settings as never);
  vi.spyOn(tools, "setSetting").mockImplementation(async (key, value) => { settings = [...settings.filter((s) => s.key !== key), { key, value }]; });
  vi.spyOn(composio, "composioList").mockResolvedValue({ items: [] });
  vi.spyOn(billing, "listDocs").mockResolvedValue([{ id: 4, number: "INV-4", customer_name: "Ravi Traders", status: "sent", currency: "INR", total: 1180, balance: 1180, issue_date: "2026-10-30" } as InvoiceDocSummary]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("matches a pasted bank SMS to the unpaid invoice and records it on confirm", async () => {
  const pay = vi.spyOn(billing, "addPayment").mockResolvedValue(9);
  const onRecorded = vi.fn();
  render(<MemoryRouter><UIProvider><PaymentCheckModal open onClose={() => {}} onRecorded={onRecorded} /></UIProvider></MemoryRouter>);
  expect(await screen.findByText(/Connect Gmail under/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Bank SMS or email"), { target: { value: "Rs.1180.00 credited to HDFC Bank A/c XX4321 on 01-11-26 from VPA ravi.traders@okaxis (UPI 430512345678)" } });
  fireEvent.click(screen.getByRole("button", { name: "Check this message" }));
  const record = await screen.findByRole("button", { name: /Record on INV-4/ });
  expect(pay).not.toHaveBeenCalled();
  fireEvent.click(record);
  await waitFor(() => expect(pay).toHaveBeenCalledWith(4, 1180, "UPI 430512345678", "2026-11-01"));
  expect(onRecorded).toHaveBeenCalled();
  expect(await screen.findByText("No payments waiting. New ones show up here.")).toBeInTheDocument();
});
