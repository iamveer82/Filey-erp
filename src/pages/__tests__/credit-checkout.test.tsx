import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HashRouter } from "react-router-dom";
import AiCreditsPanel from "../settings/AiCreditsPanel";
import { AI_CREDITS_EVENT, buyAiCredits, creditHistory, getCreditStatus, verifyCreditCheckout, type CreditStatus } from "../../lib/aiCredits";
import { setCacheOrg } from "../../lib/api";
const auth = vi.hoisted(() => ({ change: undefined as undefined | ((event: string, session: { user: { id: string } } | null) => void) }));
vi.mock("../../lib/aiCredits", async original => ({
  ...await original<typeof import("../../lib/aiCredits")>(),
  getCreditStatus: vi.fn(), buyAiCredits: vi.fn(), verifyCreditCheckout: vi.fn(), creditHistory: vi.fn(),
}));
vi.mock("../../lib/supabase", () => ({ supabase: { auth: {
  onAuthStateChange: (callback: typeof auth.change) => {
    auth.change = callback;
    return { data: { subscription: { unsubscribe: () => { auth.change = undefined; } } } };
  },
} }, isConfigured: true }));
vi.mock("../../components/AiFundingControl", () => ({ default: () => null }));
beforeEach(() => setCacheOrg("wallet-fixture", "wallet-user"));
afterEach(() => { cleanup(); vi.resetAllMocks(); setCacheOrg(null); window.history.replaceState(null, "", "/"); });
const status: CreditStatus = {
  account: { balance_micros: 0, available_micros: 0, reserved_micros: 0, task_limit_micros: 1e6, daily_limit_micros: 5e6, blocked: false },
  history: [], models: [], packs: [{ id: "pdt_test", cents: 500 }], topup_fee_cents: 50,
  custom_topup: { min_cents: 500, max_cents: 10000 },
  markup_bps: 0, configured: true, topups_enabled: true, notice: null,
};
const orderId = "00000000-0000-4000-8000-000000000051";
const promotionId = "00000000-0000-4000-8000-000000000061";
const testPromotion = () => ({
  id: promotionId,
  cents: 500,
  discount_cents: 550,
  expires_at: new Date(Date.now() + 600_000).toISOString(),
});
it("reviews configured credits and fee before making exactly one checkout request", async () => {
  window.history.replaceState(null, "", "/#/settings?section=credits");
  vi.mocked(getCreditStatus).mockResolvedValue(status);
  vi.mocked(buyAiCredits).mockResolvedValue({ mode: "browser", order_id: orderId });
  render(<HashRouter><AiCreditsPanel /></HashRouter>);
  await screen.findByText("Insufficient credit. Add Coin to continue.");
  fireEvent.click(await screen.findByRole("button", { name: /Coin · Pay/ }));
  await screen.findByRole("heading", { name: "Add Coin" });
  expect(screen.getByText("$5.50 USD")).toBeTruthy();
  expect(screen.getByText("$0.50")).toBeTruthy();
  expect(screen.getByText(/Top-ups are final and non-refundable/)).toHaveTextContent("Coin cannot be withdrawn or exchanged for cash");
  expect(buyAiCredits).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }));
  await screen.findByText(/Your secure payment page is open/);
  expect(buyAiCredits).toHaveBeenCalledExactlyOnceWith("pdt_test");
  vi.mocked(getCreditStatus).mockResolvedValue({
    ...status,
    account: { ...status.account, balance_micros: 5000000, available_micros: 5000000 },
    history: [{ id: 1, kind: "topup", amount_micros: 5000000, description: "Verified payment", created_at: "2026-09-23T00:00:00Z" }],
  });
  vi.mocked(verifyCreditCheckout).mockResolvedValue(true);
  fireEvent.focus(window);
  await screen.findByText(/Payment confirmed\./);
  expect(verifyCreditCheckout).toHaveBeenCalledExactlyOnceWith(orderId);
  fireEvent.click(screen.getByRole("button", { name: "Back to Filey" }));
  await screen.findByRole("heading", { name: "Coin wallet" });
  expect(screen.getAllByText("5 Coin").length).toBeGreaterThan(0);
  expect(screen.getByText(/\$5\.00 USD · 1 Coin = \$1/)).toBeTruthy();
  expect(buyAiCredits).toHaveBeenCalledOnce();
});
it("explains unavailable top-ups and never enables checkout through a crafted URL", async () => {
  window.history.replaceState(null, "", "/#/settings?section=credits&pack=pdt_test");
  vi.mocked(getCreditStatus).mockResolvedValue({ ...status, topups_enabled: false });
  render(<HashRouter><AiCreditsPanel /></HashRouter>);
  await screen.findByText(/Coin purchases are not available yet/);
  expect(screen.queryByRole("button", { name: "Continue to payment" })).toBeNull();
  expect(buyAiCredits).not.toHaveBeenCalled();
});

it("does not confirm a pending checkout when another tab adds Coin", async () => {
  vi.mocked(getCreditStatus).mockResolvedValue(status);
  vi.mocked(buyAiCredits).mockResolvedValue({ mode: "browser", order_id: orderId });
  vi.mocked(verifyCreditCheckout).mockResolvedValue(false);
  render(<HashRouter><AiCreditsPanel /></HashRouter>);
  fireEvent.click(await screen.findByRole("button", { name: /Coin · Pay/ }));
  fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }));
  await screen.findByText(/Your secure payment page is open/);
  vi.mocked(getCreditStatus).mockResolvedValue({ ...status,
    account: { ...status.account, balance_micros: 5000000, available_micros: 5000000 },
    history: [{ id: 1, kind: "topup", amount_micros: 5000000, description: "Other checkout", created_at: "2026-10-04T00:00:00Z" }],
  });
  fireEvent.focus(window);
  await screen.findByText(/Payment is not confirmed yet/);
  expect(screen.queryByText(/Payment confirmed\./)).toBeNull();
  expect(verifyCreditCheckout).toHaveBeenCalledExactlyOnceWith(orderId);
  expect(buyAiCredits).toHaveBeenCalledOnce();
  // This order can be confirmed later even if its top-up is outside the latest
  // history page. Verification never depends on a change to the shown ledger.
  vi.mocked(verifyCreditCheckout).mockResolvedValue(true);
  fireEvent.click(screen.getByRole("button", { name: "I’ve paid · Check payment" }));
  await screen.findByText(/Payment confirmed\./);
  expect(verifyCreditCheckout).toHaveBeenCalledTimes(2);
  expect(buyAiCredits).toHaveBeenCalledOnce();
});

it("verifies the returned order instead of trusting a success URL or a changed balance", async () => {
  window.history.replaceState(null, "", `/#/settings?section=credits&credit_checkout=returned&credit_order=${orderId}`);
  vi.mocked(getCreditStatus).mockResolvedValue({ ...status,
    account: { ...status.account, balance_micros: 5000000, available_micros: 5000000 },
  });
  vi.mocked(verifyCreditCheckout).mockResolvedValue(false);
  render(<HashRouter><AiCreditsPanel /></HashRouter>);
  await screen.findByText(/Payment is not confirmed yet/);
  expect(verifyCreditCheckout).toHaveBeenCalledExactlyOnceWith(orderId);
  expect(window.location.hash).not.toContain("credit_order");
  expect(window.location.hash).not.toContain("credit_checkout");
  expect(screen.queryByText(/Payment confirmed\./)).toBeNull();
  vi.mocked(verifyCreditCheckout).mockResolvedValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Refresh balance" }));
  await screen.findByText("Payment confirmed. Your Coin is ready to use.");
  expect(verifyCreditCheckout).toHaveBeenCalledTimes(2);
  expect(buyAiCredits).not.toHaveBeenCalled();
});

it("checks server payment state without trusting a cancelled return URL", async () => {
  window.history.replaceState(null, "", `/#/settings?section=credits&credit_checkout=cancelled&credit_order=${orderId}`);
  vi.mocked(getCreditStatus).mockResolvedValue(status);
  vi.mocked(verifyCreditCheckout).mockResolvedValue(false);
  render(<HashRouter><AiCreditsPanel /></HashRouter>);
  await screen.findByText("Checkout closed. Your balance shows any confirmed Coin.");
  await screen.findByText("Insufficient credit. Add Coin to continue.");
  expect(verifyCreditCheckout).toHaveBeenCalledExactlyOnceWith(orderId);
  expect(buyAiCredits).not.toHaveBeenCalled();
});

it("confirms a settled order even when the return URL says cancelled", async () => {
  window.history.replaceState(null, "", `/#/settings?section=credits&credit_checkout=cancelled&credit_order=${orderId}`);
  vi.mocked(getCreditStatus).mockResolvedValue({ ...status,
    account: { ...status.account, balance_micros: 5000000, available_micros: 5000000 },
  });
  vi.mocked(verifyCreditCheckout).mockResolvedValue(true);
  render(<HashRouter><AiCreditsPanel /></HashRouter>);
  await screen.findByText("Payment confirmed. Your Coin is ready to use.");
  expect(screen.queryByText(/No Coin was added/)).toBeNull();
  expect(verifyCreditCheckout).toHaveBeenCalledExactlyOnceWith(orderId);
  expect(buyAiCredits).not.toHaveBeenCalled();
});

it("preserves checkout when the same account signs in again on browser return", async () => {
  vi.mocked(getCreditStatus).mockResolvedValue(status);
  vi.mocked(buyAiCredits).mockResolvedValue({ mode: "browser", order_id: orderId });
  vi.mocked(verifyCreditCheckout).mockResolvedValue(true);
  render(<HashRouter><AiCreditsPanel /></HashRouter>);
  fireEvent.click(await screen.findByRole("button", { name: /Coin · Pay/ }));
  fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }));
  await screen.findByText(/Your secure payment page is open/);
  act(() => auth.change!("SIGNED_IN", { user: { id: "wallet-user" } }));
  expect(screen.getByRole("button", { name: "I’ve paid · Check payment" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Continue to payment" })).toBeNull();
  fireEvent.focus(window);
  await screen.findByText(/Payment confirmed\./);
  expect(verifyCreditCheckout).toHaveBeenCalledExactlyOnceWith(orderId);
  expect(buyAiCredits).toHaveBeenCalledOnce();
});

it("discards a pending payment confirmation after switching accounts", async () => {
  let finishVerify!: (confirmed: boolean) => void;
  vi.mocked(getCreditStatus).mockResolvedValue(status);
  vi.mocked(buyAiCredits).mockResolvedValue({ mode: "browser", order_id: orderId });
  vi.mocked(verifyCreditCheckout).mockImplementationOnce(() => new Promise(resolve => { finishVerify = resolve; }));
  render(<HashRouter><AiCreditsPanel /></HashRouter>);
  fireEvent.click(await screen.findByRole("button", { name: /Coin · Pay/ }));
  fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }));
  await screen.findByText(/Your secure payment page is open/);
  fireEvent.click(screen.getByRole("button", { name: "I’ve paid · Check payment" }));
  await waitFor(() => expect(verifyCreditCheckout).toHaveBeenCalledOnce());
  act(() => {
    setCacheOrg("other-wallet", "other-user");
    auth.change!("SIGNED_IN", { user: { id: "other-user" } });
  });
  await screen.findByRole("button", { name: "Continue to payment" });
  await act(async () => finishVerify(true));
  expect(screen.queryByText(/Payment confirmed\./)).toBeNull();
  expect(buyAiCredits).toHaveBeenCalledOnce();
  expect(getCreditStatus).toHaveBeenCalledTimes(2);
});

it("refreshes Coin after AI usage and coalesces native resume events", async () => {
  vi.mocked(getCreditStatus).mockResolvedValue({ ...status,
    account: { ...status.account, balance_micros: 5000000, available_micros: 5000000 },
  });
  render(<HashRouter><AiCreditsPanel /></HashRouter>);
  await screen.findByText("5 Coin");
  vi.mocked(getCreditStatus).mockResolvedValue({ ...status,
    account: { ...status.account, balance_micros: 4500000, available_micros: 4500000 },
  });
  act(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event(AI_CREDITS_EVENT));
  });
  await screen.findByText("4.5 Coin");
  expect(getCreditStatus).toHaveBeenCalledTimes(2);
  expect(getCreditStatus).toHaveBeenLastCalledWith(true);
});

it("does not replace a fresh balance with an older load that finishes later", async () => {
  let finishOld!: (value: CreditStatus) => void;
  vi.mocked(getCreditStatus).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  render(<HashRouter><AiCreditsPanel /></HashRouter>);
  vi.mocked(getCreditStatus).mockResolvedValue({ ...status,
    account: { ...status.account, balance_micros: 4500000, available_micros: 4500000 },
  });
  fireEvent.focus(window);
  await screen.findByText("4.5 Coin");
  await act(async () => finishOld({ ...status,
    account: { ...status.account, balance_micros: 5000000, available_micros: 5000000 },
  }));
  expect(screen.getByText("4.5 Coin")).toBeInTheDocument();
  expect(screen.queryByText("5 Coin")).toBeNull();
});

it("discards an older history page when a newer wallet refresh finishes", async () => {
  let finishHistory!: (value: CreditStatus["history"]) => void;
  vi.mocked(getCreditStatus).mockResolvedValue({ ...status, history: Array.from({ length: 30 }, (_, i) => ({
    id: 30 - i, kind: "usage", amount_micros: -1, description: "Coin used", created_at: "2026-10-04T00:00:00Z",
  })) });
  vi.mocked(creditHistory).mockImplementationOnce(() => new Promise(resolve => { finishHistory = resolve; }));
  render(<HashRouter><AiCreditsPanel /></HashRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Load earlier activity" }));
  await waitFor(() => expect(creditHistory).toHaveBeenCalledOnce());
  vi.mocked(getCreditStatus).mockResolvedValue({ ...status, history: [] });
  fireEvent.focus(window);
  await waitFor(() => expect(getCreditStatus).toHaveBeenCalledTimes(2));
  await act(async () => finishHistory([{ id: 0, kind: "topup", amount_micros: 9900000, description: "Old history", created_at: "2026-10-04T00:00:00Z" }]));
  expect(screen.queryByText("+9.9 Coin")).toBeNull();
});

it("shows Coin charges without token rates or provider details from historical usage and refunds", async () => {
  vi.mocked(getCreditStatus).mockResolvedValue({ ...status,
    history: [
      { id: 1, kind: "usage", amount_micros: -1, description: "Private paid model", created_at: "2026-09-24T00:00:00Z" },
      { id: 2, kind: "refund", amount_micros: 123456, description: "provider/paid unused request", created_at: "2026-09-24T00:00:00Z" },
    ],
    models: [
    { id: "filey-ai", name: "Private paid model", input: 1e-6, output: 2e-6, image: 0.0125, context: 8192, maxOutput: 4096, vision: true },
    { id: "provider/paid", name: "Private paid model", input: 1e-6, output: 2e-6, image: 0.0125, context: 8192, maxOutput: 4096, vision: true },
    { id: "provider/free", name: "Free model", input: 0, output: 0, context: 8192, maxOutput: 4096, vision: false, free: true },
  ] });
  render(<HashRouter><AiCreditsPanel /></HashRouter>);
  await screen.findByText("Coin usage");
  expect(screen.getByText("Filey AI")).toBeInTheDocument();
  expect(screen.queryByRole("table", { name: "Filey AI rates" })).toBeNull();
  expect(document.body).not.toHaveTextContent(/tokens|Up to 1 Coin|Up to 2 Coin|input image|spending estimates|Free model|no usage markup|Spending limits|Brand videos|0\.25 Coin/i);
  expect(screen.queryByRole("button", { name: "Save limits" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Video setup & history" })).toBeNull();
  expect(screen.queryByRole("searchbox")).toBeNull();
  expect(screen.queryByTitle("Private paid model")).toBeNull();
  expect(document.body).not.toHaveTextContent("Private paid model");
  expect(document.body).not.toHaveTextContent("provider/paid");
  expect(document.body).not.toHaveTextContent("Seedance");
  expect(screen.getByText("Filey AI usage")).toBeInTheDocument();
  expect(screen.getByText("Unused Coin restored to your wallet.")).toBeInTheDocument();
  expect(screen.getByText("-0.000001 Coin")).toBeInTheDocument();
  expect(screen.getByText("+0.123456 Coin")).toBeInTheDocument();
});

it("explains prepaid non-withdrawable Coin and displays a reversed payment as a debit", async () => {
  vi.mocked(getCreditStatus).mockResolvedValue({ ...status,
    account: { ...status.account, balance_micros: -500000, available_micros: -500000 },
    history: [{ id: 3, kind: "refund", amount_micros: -500000, description: "Provider-internal reversal detail", created_at: "2026-09-24T00:00:00Z" }],
  });
  render(<HashRouter><AiCreditsPanel /></HashRouter>);
  await screen.findByText(/Payment adjustment:/);
  expect(screen.getByText(/Top-ups are final and non-refundable/)).toHaveTextContent("Coin cannot be withdrawn or exchanged for cash");
  expect(screen.getByText("Coin removed after a payment reversal.")).toBeInTheDocument();
  expect(screen.queryByText(/Unused Coin restored/)).toBeNull();
  expect(screen.queryByRole("button", { name: /withdraw|refund|cash out/i })).toBeNull();
  expect(document.body).not.toHaveTextContent("Provider-internal reversal detail");
});

it("reviews an exact custom amount and fee before opening checkout once", async () => {
  window.history.replaceState(null, "", "/#/settings?section=credits");
  vi.mocked(getCreditStatus).mockResolvedValue(status);
  vi.mocked(buyAiCredits).mockResolvedValue({ mode: "browser", order_id: orderId });
  render(<HashRouter><AiCreditsPanel /></HashRouter>);
  const input = await screen.findByRole("textbox", { name: "Custom amount · USD" });
  fireEvent.change(input, { target: { value: "12,51" } });
  fireEvent.click(screen.getByRole("button", { name: "Review top-up" }));
  await screen.findByRole("heading", { name: "Add Coin" });
  expect(screen.getByText("$12.51")).toBeTruthy();
  expect(screen.getByText("12.51 Coin")).toBeTruthy();
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

it("quick recharge reviews the smallest configured top-up beside the balance before payment", async () => {
  vi.mocked(getCreditStatus).mockResolvedValue({ ...status,
    packs: [{ id: "pdt_large", cents: 2500 }, { id: "pdt_test", cents: 500 }],
  });
  render(<HashRouter><AiCreditsPanel /></HashRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Quick recharge · 5 Coin" }));
  await screen.findByRole("heading", { name: "Add Coin" });
  expect(screen.getByText("$5.50 USD")).toBeInTheDocument();
  expect(screen.getByText("5 Coin")).toBeInTheDocument();
  expect(buyAiCredits).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await screen.findByRole("heading", { name: "Coin wallet" });
  expect(buyAiCredits).not.toHaveBeenCalled();
});

it("quick recharge supports custom-only checkout and stays disabled while top-ups are unavailable", async () => {
  vi.mocked(getCreditStatus).mockResolvedValue({ ...status, packs: [] });
  render(<HashRouter><AiCreditsPanel /></HashRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Quick recharge · 5 Coin" }));
  expect(window.location.hash).toContain("amount_cents=500");
  await screen.findByRole("heading", { name: "Add Coin" });
  expect(screen.getByText("$5.50 USD")).toBeInTheDocument();
  expect(buyAiCredits).not.toHaveBeenCalled();
  cleanup();
  vi.mocked(getCreditStatus).mockResolvedValue({ ...status, topups_enabled: false });
  window.history.replaceState(null, "", "/#/settings?section=credits");
  render(<HashRouter><AiCreditsPanel /></HashRouter>);
  const quick = await screen.findByRole("button", { name: "Quick recharge · 5 Coin" });
  expect(quick).toBeDisabled();
  fireEvent.click(quick);
  expect(screen.queryByRole("button", { name: "Continue to payment" })).toBeNull();
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
  await screen.findByRole("heading", { name: "Add Coin" });
  expect(screen.queryByRole("button", { name: "Continue to payment" })).toBeNull();
  expect(buyAiCredits).not.toHaveBeenCalled();
});

it("reviews the selected user's one-use 5 Coin offer with a full fee discount before checkout", async () => {
  vi.mocked(getCreditStatus).mockResolvedValue({ ...status, test_promotion: testPromotion() });
  vi.mocked(buyAiCredits).mockResolvedValue({ mode: "browser", order_id: orderId });
  render(<HashRouter><AiCreditsPanel /></HashRouter>);
  await screen.findByText(/One-use test offer: add 5 Coin for \$0\.00/);
  fireEvent.click(screen.getByRole("button", { name: "5 Coin · Pay $0.00" }));
  await screen.findByRole("heading", { name: "Add Coin" });
  expect(screen.getByText("5 Coin")).toBeInTheDocument();
  expect(screen.getByText("$5.00")).toBeInTheDocument();
  expect(screen.getByText("$0.50")).toBeInTheDocument();
  expect(screen.getByText("100% test discount")).toBeInTheDocument();
  expect(screen.getByText("-$5.50")).toBeInTheDocument();
  expect(screen.getByText("$0.00 USD")).toBeInTheDocument();
  expect(buyAiCredits).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }));
  await screen.findByText(/Your secure payment page is open/);
  expect(buyAiCredits).toHaveBeenCalledExactlyOnceWith("pdt_test", promotionId);
});

it("keeps the reviewed free offer while checking its exact order after the offer is claimed", async () => {
  vi.mocked(getCreditStatus).mockResolvedValue({ ...status, test_promotion: testPromotion() });
  vi.mocked(buyAiCredits).mockResolvedValue({ mode: "browser", order_id: orderId });
  vi.mocked(verifyCreditCheckout).mockResolvedValue(false);
  render(<HashRouter><AiCreditsPanel /></HashRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "5 Coin · Pay $0.00" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }));
  await screen.findByText(/Your secure payment page is open/);
  vi.mocked(getCreditStatus).mockResolvedValue(status);
  fireEvent.focus(window);
  await screen.findByText(/Payment is not confirmed yet/);
  expect(screen.getByText("100% test discount")).toBeInTheDocument();
  expect(screen.getByText("$0.00 USD")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Continue to payment" })).toBeNull();
  expect(verifyCreditCheckout).toHaveBeenCalledExactlyOnceWith(orderId);
  expect(buyAiCredits).toHaveBeenCalledExactlyOnceWith("pdt_test", promotionId);
  vi.mocked(verifyCreditCheckout).mockResolvedValue(true);
  fireEvent.click(screen.getByRole("button", { name: "I’ve paid · Check payment" }));
  await screen.findByText(/Payment confirmed\./);
  expect(verifyCreditCheckout).toHaveBeenCalledTimes(2);
  expect(buyAiCredits).toHaveBeenCalledOnce();
});

it("does not apply a 5 Coin test promotion to another custom amount", async () => {
  vi.mocked(getCreditStatus).mockResolvedValue({ ...status, test_promotion: testPromotion() });
  vi.mocked(buyAiCredits).mockResolvedValue({ mode: "browser", order_id: orderId });
  render(<HashRouter><AiCreditsPanel /></HashRouter>);
  const input = await screen.findByRole("textbox", { name: "Custom amount · USD" });
  fireEvent.change(input, { target: { value: "12.50" } });
  fireEvent.click(screen.getByRole("button", { name: "Review top-up" }));
  await screen.findByRole("heading", { name: "Add Coin" });
  expect(screen.getByText("$13.00 USD")).toBeInTheDocument();
  expect(screen.queryByText("100% test discount")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }));
  await screen.findByText(/Your secure payment page is open/);
  expect(buyAiCredits).toHaveBeenCalledExactlyOnceWith(1250);
});

it.each([
  ["expired", { expires_at: "2000-01-01T00:00:00Z" }],
  ["invalid expiry", { expires_at: "not-a-date" }],
  ["wrong Coin amount", { cents: 1000 }],
  ["partial discount", { discount_cents: 500 }],
  ["invalid identity", { id: "not-a-promotion-id" }],
])("keeps normal paid pricing when the test offer has %s", async (_reason, invalid) => {
  vi.mocked(getCreditStatus).mockResolvedValue({ ...status, test_promotion: { ...testPromotion(), ...invalid } });
  vi.mocked(buyAiCredits).mockResolvedValue({ mode: "browser", order_id: orderId });
  render(<HashRouter><AiCreditsPanel /></HashRouter>);
  const normal = await screen.findByRole("button", { name: "5 Coin · Pay $5.50" });
  expect(screen.queryByText(/One-use test offer/)).toBeNull();
  fireEvent.click(normal);
  await screen.findByRole("heading", { name: "Add Coin" });
  expect(screen.getByText("$5.50 USD")).toBeInTheDocument();
  expect(screen.queryByText("100% test discount")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }));
  await screen.findByText(/Your secure payment page is open/);
  expect(buyAiCredits).toHaveBeenCalledExactlyOnceWith("pdt_test");
});
