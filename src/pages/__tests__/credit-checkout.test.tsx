import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HashRouter } from "react-router-dom";
import AiCreditsPanel from "../settings/AiCreditsPanel";
import { buyAiCredits, getCreditStatus, type CreditStatus } from "../../lib/aiCredits";
vi.mock("../../lib/aiCredits", async original => ({
  ...await original<typeof import("../../lib/aiCredits")>(),
  getCreditStatus: vi.fn(), buyAiCredits: vi.fn(),
}));
vi.mock("../../lib/supabase", () => ({ supabase: null }));
vi.mock("../../components/AiFundingControl", () => ({ default: () => null }));
afterEach(() => { cleanup(); vi.resetAllMocks(); window.history.replaceState(null, "", "/"); });
const status: CreditStatus = {
  account: { balance_micros: 0, available_micros: 0, reserved_micros: 0, task_limit_micros: 1e6, daily_limit_micros: 5e6, blocked: false },
  history: [], models: [], packs: [{ id: "pdt_test", cents: 500 }], topup_fee_cents: 50,
  custom_topup: { min_cents: 500, max_cents: 10000 },
  markup_bps: 0, configured: true, topups_enabled: true, notice: null,
};
it("reviews configured credits and fee before making exactly one checkout request", async () => {
  window.history.replaceState(null, "", "/#/settings?section=credits");
  vi.mocked(getCreditStatus).mockResolvedValue(status);
  vi.mocked(buyAiCredits).mockResolvedValue("browser");
  render(<HashRouter><AiCreditsPanel /></HashRouter>);
  fireEvent.click(await screen.findByRole("button", { name: /Paper · Pay/ }));
  await screen.findByRole("heading", { name: "Add Paper" });
  expect(screen.getByText("$5.50 USD")).toBeTruthy();
  expect(screen.getByText("$0.50")).toBeTruthy();
  expect(buyAiCredits).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }));
  await screen.findByText(/Your secure payment page is open/);
  expect(buyAiCredits).toHaveBeenCalledExactlyOnceWith("pdt_test");
  vi.mocked(getCreditStatus).mockResolvedValue({
    ...status,
    account: { ...status.account, balance_micros: 5000000, available_micros: 5000000 },
    history: [{ id: 1, kind: "topup", amount_micros: 5000000, description: "Verified payment", created_at: "2026-09-23T00:00:00Z" }],
  });
  fireEvent.focus(window);
  await screen.findByText(/Payment confirmed\./);
  fireEvent.click(screen.getByRole("button", { name: "Back to Filey" }));
  await screen.findByRole("heading", { name: "Paper wallet" });
  expect(screen.getAllByText("5 Paper").length).toBeGreaterThan(0);
  expect(screen.getByText(/\$5\.00 USD · 1 Paper = \$1/)).toBeTruthy();
  expect(buyAiCredits).toHaveBeenCalledOnce();
});
it("explains unavailable top-ups and never enables checkout through a crafted URL", async () => {
  window.history.replaceState(null, "", "/#/settings?section=credits&pack=pdt_test");
  vi.mocked(getCreditStatus).mockResolvedValue({ ...status, topups_enabled: false });
  render(<HashRouter><AiCreditsPanel /></HashRouter>);
  await screen.findByText(/Paper purchases are not available yet/);
  expect(screen.queryByRole("button", { name: "Continue to payment" })).toBeNull();
  expect(buyAiCredits).not.toHaveBeenCalled();
});

it("searches named paid and free model rates while preserving usage history", async () => {
  vi.mocked(getCreditStatus).mockResolvedValue({ ...status,
    history: [{ id: 1, kind: "usage", amount_micros: -1, description: "Private paid model", created_at: "2026-09-24T00:00:00Z" }],
    models: [
    { id: "provider/paid", name: "Private paid model", input: 1e-6, output: 2e-6, image: 0.0125, context: 8192, maxOutput: 4096, vision: true },
    { id: "provider/free", name: "Free model", input: 0, output: 0, context: 8192, maxOutput: 4096, vision: false, free: true },
  ] });
  render(<HashRouter><AiCreditsPanel /></HashRouter>);
  const table = await screen.findByRole("table", { name: "AI model rates" });
  expect(within(table).getByText("Private paid model")).toBeInTheDocument();
  expect(within(table).getByText("Up to 1 Paper")).toBeInTheDocument();
  expect(within(table).getByText("Up to 2 Paper")).toBeInTheDocument();
  expect(within(table).getByText("Up to 0.0125 Paper / input image")).toBeInTheDocument();
  expect(screen.getByText(/You pay actual usage; these rates are spending estimates/)).toBeInTheDocument();
  expect(within(table).getByText("Free model")).toBeInTheDocument();
  expect(within(table).getAllByText("Free")).toHaveLength(2);
  expect(screen.getByTitle("Private paid model")).toBeInTheDocument();
  expect(screen.getByText("-0.000001 Paper")).toBeInTheDocument();
  const search = screen.getByRole("searchbox", { name: "Search model rates" });
  fireEvent.change(search, { target: { value: "provider/paid" } });
  expect(within(table).queryByText("Free model")).toBeNull();
  expect(screen.getByText(/1 of 2 models/)).toBeInTheDocument();
  fireEvent.change(search, { target: { value: "free" } });
  expect(within(table).queryByText("Private paid model")).toBeNull();
  expect(within(table).getByText("Free model")).toBeInTheDocument();
  fireEvent.change(search, { target: { value: "missing" } });
  expect(screen.queryByRole("table", { name: "AI model rates" })).toBeNull();
  expect(screen.getByText(/No matching models/)).toBeInTheDocument();
});

it("reviews an exact custom amount and fee before opening checkout once", async () => {
  window.history.replaceState(null, "", "/#/settings?section=credits");
  vi.mocked(getCreditStatus).mockResolvedValue(status);
  vi.mocked(buyAiCredits).mockResolvedValue("browser");
  render(<HashRouter><AiCreditsPanel /></HashRouter>);
  const input = await screen.findByRole("textbox", { name: "Custom amount · USD" });
  fireEvent.change(input, { target: { value: "12,51" } });
  fireEvent.click(screen.getByRole("button", { name: "Review top-up" }));
  await screen.findByRole("heading", { name: "Add Paper" });
  expect(screen.getByText("$12.51")).toBeTruthy();
  expect(screen.getByText("12.51 Paper")).toBeTruthy();
  expect(screen.getByText("$0.50")).toBeTruthy();
  expect(screen.getByText("$13.01 USD")).toBeTruthy();
  expect(buyAiCredits).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect((screen.getByRole("textbox", { name: "Custom amount · USD" }) as HTMLInputElement).value).toBe("12,51");
  fireEvent.click(screen.getByRole("button", { name: "Review top-up" }));
  const pay = screen.getByRole("button", { name: "Continue to payment" });
  fireEvent.click(pay);
  fireEvent.click(pay);
  await screen.findByText(/Your secure payment page is open/);
  expect(buyAiCredits).toHaveBeenCalledExactlyOnceWith(1251);
});

it("validates custom amounts without rounding extra decimals or accepting scientific notation", async () => {
  vi.mocked(getCreditStatus).mockResolvedValue(status);
  render(<HashRouter><AiCreditsPanel /></HashRouter>);
  const input = await screen.findByRole("textbox", { name: "Custom amount · USD" });
  const review = screen.getByRole("button", { name: "Review top-up" }) as HTMLButtonElement;
  for (const value of ["", "-5", "0", "4.99", "100.01", "12.345", "1e1", "Infinity", "1,000", "nope"]) {
    fireEvent.change(input, { target: { value } });
    expect(review.disabled).toBe(true);
  }
  for (const value of ["5", "10.07", "100.00"]) {
    fireEvent.change(input, { target: { value } });
    expect(review.disabled).toBe(false);
  }
  expect(buyAiCredits).not.toHaveBeenCalled();
});

it.each([
  ["499", status], ["10001", status], ["500.1", status], ["5e2", status],
  ["1250&pack=pdt_test", status],
  ["1250", { ...status, custom_topup: undefined }],
  ["1250", { ...status, topups_enabled: false }],
])("rejects custom checkout URL %s when invalid or unavailable", async (amount, configured) => {
  window.history.replaceState(null, "", `/#/settings?section=credits&amount_cents=${amount}`);
  vi.mocked(getCreditStatus).mockResolvedValue(configured);
  render(<HashRouter><AiCreditsPanel /></HashRouter>);
  await screen.findByRole("heading", { name: "Add Paper" });
  expect(screen.queryByRole("button", { name: "Continue to payment" })).toBeNull();
  expect(buyAiCredits).not.toHaveBeenCalled();
});
