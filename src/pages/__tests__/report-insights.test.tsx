import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Reports from "../reports/Reports";

const reads = vi.hoisted(() => ({ invoices: vi.fn(), customers: vi.fn(), settings: vi.fn(), accounts: vi.fn() }));
vi.mock("../../lib/api", async importOriginal => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, billing: { ...actual.billing, listDocs: reads.invoices }, crm: { ...actual.crm, customers: reads.customers },
    tools: { ...actual.tools, settings: reads.settings }, fin: { ...actual.fin, accounts: reads.accounts } };
});

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  reads.invoices.mockResolvedValue([{ status: "sent", issue_date: "2026-09-01" }]);
  reads.customers.mockResolvedValue([{ segment: "Retail", created_at: "2026-09-01" }]);
  reads.settings.mockResolvedValue([]);
});

function open(section = "invoices") {
  return render(<MemoryRouter initialEntries={[`/reports?tab=insights&section=${section}`]}><Reports /></MemoryRouter>);
}

it("loads only the selected section and passes its actual records to chart data tables", async () => {
  open();
  await screen.findByText("1 records in this chart");
  expect(document.querySelector("table")?.textContent).toContain("Sent1");
  expect(reads.accounts).not.toHaveBeenCalled();
  expect(reads.customers).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Insight section"), { target: { value: "customers" } });
  await waitFor(() => expect(document.querySelector("table")?.textContent).toContain("Retail1"));
  expect(screen.queryByText("Invoices by status", { selector: "caption" })).toBeNull();
});

it("does not let a previous section's slow result replace the selected section", async () => {
  let finish!: (rows: unknown[]) => void;
  reads.invoices.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  open();
  fireEvent.change(screen.getByLabelText("Insight section"), { target: { value: "customers" } });
  await screen.findByText("1 records in this chart");
  finish([{ status: "cancelled" }, { status: "cancelled" }]);
  await waitFor(() => expect(document.querySelector("table")?.textContent).toContain("Retail1"));
  expect(screen.queryByText("2 records in this chart")).toBeNull();
});

it("reports read failures and retries without showing a fabricated empty chart", async () => {
  reads.invoices.mockRejectedValueOnce(new Error("Invoices unavailable"));
  open();
  await screen.findByText("Invoices unavailable");
  expect(screen.queryByText("Add records to see your charts.")).toBeNull();
  expect(document.querySelector("table")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Refresh insights" }));
  await screen.findByText("1 records in this chart");
  expect(screen.queryByText("Invoices unavailable")).toBeNull();
});

it("reads setting-backed reports from the active workspace, never the browser's legacy cache", async () => {
  localStorage.setItem("filey_cheques", JSON.stringify([{ status: "cleared" }]));
  open("cheques");
  await screen.findByText("Add records to see your charts.");
  expect(reads.settings).toHaveBeenCalledTimes(1);
  reads.settings.mockResolvedValue([{ key: "cheque_register", value: JSON.stringify([{ status: "pending", created_at: "2026-09-01" }]) }]);
  fireEvent.click(screen.getByRole("button", { name: "Refresh insights" }));
  await screen.findByText("1 records in this chart");
  expect(document.querySelector("table")?.textContent).toContain("Pending1");
});

it("shows malformed saved data as an error instead of treating it as no records", async () => {
  reads.settings.mockResolvedValue([{ key: "cheque_register", value: "{}" }]);
  open("cheques");
  await screen.findByText(/These saved records could not be read/);
  expect(screen.queryByText("Add records to see your charts.")).toBeNull();
});
