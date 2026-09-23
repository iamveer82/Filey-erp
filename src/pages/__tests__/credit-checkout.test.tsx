import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  markup_bps: 0, configured: true, topups_enabled: true, notice: null,
};
it("reviews configured credits and fee before making exactly one checkout request", async () => {
  window.history.replaceState(null, "", "/#/settings?section=credits");
  vi.mocked(getCreditStatus).mockResolvedValue(status);
  vi.mocked(buyAiCredits).mockResolvedValue("browser");
  render(<HashRouter><AiCreditsPanel /></HashRouter>);
  fireEvent.click(await screen.findByRole("button", { name: /credit · Pay/ }));
  await screen.findByRole("heading", { name: "Add AI credits" });
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
  await screen.findByRole("heading", { name: "AI wallet" });
  expect(screen.getByText("$5.00")).toBeTruthy();
  expect(buyAiCredits).toHaveBeenCalledOnce();
});
it("explains unavailable top-ups and never enables checkout through a crafted URL", async () => {
  window.history.replaceState(null, "", "/#/settings?section=credits&pack=pdt_test");
  vi.mocked(getCreditStatus).mockResolvedValue({ ...status, topups_enabled: false });
  render(<HashRouter><AiCreditsPanel /></HashRouter>);
  await screen.findByText(/Credit purchases are not available yet/);
  expect(screen.queryByRole("button", { name: "Continue to payment" })).toBeNull();
  expect(buyAiCredits).not.toHaveBeenCalled();
});
