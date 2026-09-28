import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UIProvider } from "../../lib/ui";
import { money, setDisplayCurrency } from "../../lib/format";
import BankAccounts from "../BankAccounts";

const settings = vi.hoisted(() => vi.fn());
const setSetting = vi.hoisted(() => vi.fn<(key: string, value: string) => Promise<void>>().mockResolvedValue(undefined));
vi.mock("../../lib/api", () => ({ tools: { settings, setSetting }, billing: { getCompany: async () => ({ name: "India company", country_code: "IN", currency: "INR" }) }, fin: {}, getCacheScope: () => "test-org:user:test-user" }));
const formatted = (amount: number, currency: string) => money(amount, currency).replace(/\s/g, " ");

afterEach(() => {
  cleanup();
  localStorage.removeItem(`filey_bank_accounts:${encodeURIComponent("cloud:test-org:user:test-user")}`);
  setDisplayCurrency("AED");
  vi.clearAllMocks();
});

it("creates an Indian bank account with an IFSC and keeps its currency after reopening", async () => {
  settings.mockResolvedValue([]);
  const view = render(<MemoryRouter><UIProvider><BankAccounts /></UIProvider></MemoryRouter>);
  fireEvent.click(await view.findByRole("button", { name: "Add account" }));
  const ifsc = await view.findByLabelText("IFSC Code");
  expect(view.queryByLabelText("IBAN")).toBeNull();
  fireEvent.change(view.getByLabelText("Bank Name *"), { target: { value: "Fixture bank" } });
  fireEvent.change(view.getByLabelText("Account Name *"), { target: { value: "Operating" } });
  fireEvent.change(ifsc, { target: { value: "bad" } });
  expect(view.getByRole("button", { name: "Create account" })).toBeDisabled();
  fireEvent.change(ifsc, { target: { value: "HDFC0001234" } });
  fireEvent.click(view.getByRole("button", { name: "Create account" }));
  await waitFor(() => expect(setSetting).toHaveBeenCalledOnce());
  const saved = JSON.parse(setSetting.mock.calls[0][1]);
  expect(saved[0]).toMatchObject({ country_code: "IN", currency: "INR", ifsc: "HDFC0001234", iban: "" });
  view.unmount();
  settings.mockResolvedValue([{ key: "bank_accounts", value: JSON.stringify(saved) }]);
  const reopened = render(<MemoryRouter><UIProvider><BankAccounts /></UIProvider></MemoryRouter>);
  expect(await reopened.findByText("IFSC HDFC0001234")).toBeVisible();
  expect(reopened.getByText("Total balance (INR)")).toBeVisible();
});

it("groups native AED/USD balances without conversion and preserves account currencies in rows and quick view", async () => {
  const accounts = [
    { id: 1, bank_name: "Dirham Bank", account_name: "Operating", currency: "AED", current_balance: 100 },
    { id: 2, bank_name: "Dirham Savings", account_name: "Reserve", currency: "AED", current_balance: 50 },
    { id: 3, bank_name: "Dollar Bank", account_name: "Export", currency: "USD", current_balance: 100 },
  ].map(account => ({ ...account, account_number: "", iban: "", opening_balance: account.current_balance, created_at: "2026-09-07" }));
  settings.mockResolvedValue([{ key: "bank_accounts", value: JSON.stringify(accounts) }]);
  // A different dashboard display currency must not relabel native balances.
  setDisplayCurrency("USD", 3.67);
  const view = render(<MemoryRouter><UIProvider><BankAccounts /></UIProvider></MemoryRouter>);
  expect(await view.findByText("Total balance (AED)")).toBeTruthy();
  expect(view.getByText("Total balance (USD)")).toBeTruthy();
  expect(view.getByText(formatted(150, "AED"))).toBeTruthy();
  expect(view.queryByText(formatted(250, "AED"))).toBeNull();
  expect(view.queryByText(formatted(250 / 3.67, "USD"))).toBeNull();
  const dollarRow = await view.findByRole("row", { name: /Dollar Bank/ });
  const dirhamRow = view.getByRole("row", { name: /Dirham Bank/ });
  expect(within(dollarRow).getByText(formatted(100, "USD"))).toBeTruthy();
  expect(within(dirhamRow).getByText(formatted(100, "AED"))).toBeTruthy();
  fireEvent.click(dollarRow);
  const detail = await view.findByRole("dialog");
  expect(within(detail).getAllByText(formatted(100, "USD")).length).toBeGreaterThan(0);
  expect(within(detail).queryByText(formatted(100, "AED"))).toBeNull();
});
