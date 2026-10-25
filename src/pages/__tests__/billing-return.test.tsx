import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HashRouter } from "react-router-dom";
import { UIProvider } from "../../lib/ui";
import { awaitCloudPlan, getSubscription, openBillingPortal, startCheckout, type Subscription } from "../../lib/subscription";
import BillingPanel from "../settings/BillingPanel";
import { licensePurchased, claimPurchasedLicense } from "../../lib/license";
import SetupNotice from "../SetupNotice";

const mode = vi.hoisted(() => ({ local: false, count: vi.fn(async () => 2) }));

vi.mock("../../lib/subscription", async (original) => ({
  ...await original<typeof import("../../lib/subscription")>(),
  getSubscription: vi.fn(), awaitCloudPlan: vi.fn(), openBillingPortal: vi.fn(), startCheckout: vi.fn(),
}));
vi.mock("../../lib/license", () => ({
  CLOUD_DEVICE_LIMIT: 20,
  verifyStoredLicense: async () => ({ valid: false }), entitlement: async () => "free",
  cloudAccess: async () => ({ reason: "free" }), FREE_LIMITS: { invoicesPerMonth: 5 },
  licensePurchased: vi.fn(async () => false), claimPurchasedLicense: vi.fn(),
}));
vi.mock("../../lib/api", () => ({
  erp: { products: async () => [], orders: async () => [] },
  crm: { customers: async () => [] }, quotes: { listDocs: async () => [] },
  billing: { listDocs: async () => [] }, invoicesThisMonth: mode.count,
}));
vi.mock("../../lib/dataMode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/dataMode")>()),
  isLocalMode: () => mode.local,
}));
vi.mock("../../lib/supabase", () => ({ supabase: null, cloudConfigured: true }));

beforeEach(() => {
  mode.local = false;
  mode.count.mockResolvedValue(2);
  vi.mocked(getSubscription).mockResolvedValue({ plan: "free" });
  vi.mocked(licensePurchased).mockResolvedValue(false);
  window.history.replaceState(null, "", "/#/settings?section=billing&checkout=success");
});

it("shows unlimited local usage from the first render without fetching a monthly quota", async () => {
  mode.local = true;
  window.history.replaceState(null, "", "/#/settings?section=billing");
  render(<HashRouter><UIProvider><BillingPanel /></UIProvider></HashRouter>);
  const usage = within(screen.getByRole("region", { name: "Usage" }));
  expect(usage.getByText("Unlimited local invoices")).toBeInTheDocument();
  expect(usage.getByText(/Use all core local modules/)).toHaveTextContent("unbranded local PDFs");
  expect(usage.queryByRole("progressbar")).not.toBeInTheDocument();
  await waitFor(() => expect(getSubscription).toHaveBeenCalled());
  expect(usage.getByText("Unlimited local invoices")).toBeInTheDocument();
  expect(mode.count).not.toHaveBeenCalled();
});

it("offers the 14-day trial on this device and Pro for the cloud on startup", () => {
  render(<SetupNotice />);
  const localChoice = screen.getByRole("button", { name: /Use on this device/ });
  expect(localChoice).toHaveTextContent("14-day free trial");
  expect(localChoice).toHaveTextContent("try every app for 14 days on this device");
  expect(localChoice).toHaveTextContent("$1 of Filey AI to try the agent");
  expect(localChoice).toHaveTextContent("Then Freedom: 1499 AED once, yours for life");
  expect(screen.getByRole("button", { name: /Use Filey Cloud/ })).toHaveTextContent("Pro · 36 AED / month");
});

it("offers the trial, Freedom for life and Pro in the cloud at their real prices", async () => {
  mode.local = true;
  window.history.replaceState(null, "", "/#/settings?section=billing");
  render(<HashRouter><UIProvider><BillingPanel /></UIProvider></HashRouter>);
  await waitFor(() => expect(screen.getByRole("button", { name: "Get Freedom - 1499 AED" })).toBeEnabled());
  const plans = within(screen.getByRole("region", { name: "Available plans" }));
  expect(plans.getByText("Free")).toBeInTheDocument();
  expect(plans.getByText("36 AED")).toBeInTheDocument();
  expect(plans.getByText("1499 AED")).toBeInTheDocument();
  expect(plans.getByText("Filey on your computer for life. Pay once, own it.")).toBeInTheDocument();
  expect(plans.getByText("Regular updates and support")).toBeInTheDocument();
  expect(plans.getByText("On 2 computers, and move it to a new PC any time")).toBeInTheDocument();
});

it("shows account-owned Freedom without a local activation token or a second purchase button", async () => {
  window.history.replaceState(null, "", "/#/settings?section=billing");
  vi.mocked(licensePurchased).mockResolvedValue(true);
  render(<HashRouter><UIProvider><BillingPanel /></UIProvider></HashRouter>);
  await waitFor(() => expect(screen.queryByRole("button", { name: /Get Freedom/ })).toBeNull());
  expect(screen.getByRole("link", { name: "Open Coin wallet" })).toHaveAttribute("href", "#/settings?section=credits");
});

it("activates a Freedom return without waiting for a Pro subscription", async () => {
  window.history.replaceState(null, "", "/#/settings?section=billing&checkout=success&plan=ultra");
  vi.mocked(claimPurchasedLicense).mockResolvedValue({ valid: true });
  render(<HashRouter><UIProvider><BillingPanel /></UIProvider></HashRouter>);
  await screen.findByText("Freedom is active on this device.");
  expect(claimPurchasedLicense).toHaveBeenCalledTimes(1);
  expect(awaitCloudPlan).not.toHaveBeenCalled();
});
afterEach(() => { cleanup(); vi.resetAllMocks(); window.history.replaceState(null, "", "/"); });

it("preserves the billing route and waits for a verified plan before confirming payment", async () => {
  let complete!: (sub: Subscription) => void;
  vi.mocked(awaitCloudPlan).mockReturnValue(new Promise((resolve) => { complete = resolve; }));
  render(<HashRouter><UIProvider><BillingPanel /></UIProvider></HashRouter>);
  await screen.findByText("Confirming your payment…");
  expect(window.location.hash).toBe("#/settings?section=billing");
  expect(screen.queryByText("Pro is active on this workspace.")).toBeNull();
  vi.mocked(getSubscription).mockResolvedValue({ plan: "cloud", plan_status: "active" });
  complete({ plan: "cloud", plan_status: "active" });
  await screen.findByText("Pro is active on this workspace.");
  expect(awaitCloudPlan).toHaveBeenCalledTimes(1);
  expect(await screen.findByRole("button", { name: "Manage billing" })).toBeEnabled();
});

it("reports an unconfirmed payment without claiming the plan is active", async () => {
  vi.mocked(awaitCloudPlan).mockResolvedValue(null);
  render(<HashRouter><UIProvider><BillingPanel /></UIProvider></HashRouter>);
  await screen.findByText("Payment is still processing. Reopen Billing to check again.");
  expect(screen.queryByText("Pro is active on this workspace.")).toBeNull();
});

it("re-enables billing controls when the desktop portal opens in another browser", async () => {
  window.history.replaceState(null, "", "/#/settings?section=billing");
  vi.mocked(getSubscription).mockResolvedValue({ plan: "cloud" });
  let opened!: (result: "browser") => void;
  vi.mocked(openBillingPortal).mockReturnValue(new Promise((resolve) => { opened = resolve; }));
  render(<HashRouter><UIProvider><BillingPanel /></UIProvider></HashRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Manage billing" }));
  expect(screen.getByRole("button", { name: "Opening…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: /Get Freedom/ })).toBeDisabled();
  opened("browser");
  await waitFor(() => expect(screen.getByRole("button", { name: "Manage billing" })).toBeEnabled());
  expect(openBillingPortal).toHaveBeenCalledTimes(1);
});


it("opens a review section before contacting the payment provider", async () => {
  window.history.replaceState(null, "", "/#/settings?section=billing");
  vi.mocked(startCheckout).mockResolvedValue("browser");
  render(<HashRouter><UIProvider><BillingPanel /></UIProvider></HashRouter>);
  const get = await screen.findByRole("button", { name: "Get Pro" });
  await waitFor(() => expect(get).toBeEnabled());
  fireEvent.click(get);
  await screen.findByRole("heading", { name: "Get Filey Pro" });
  expect(startCheckout).not.toHaveBeenCalled();
  expect(window.location.hash).toContain("purchase=cloud");
  fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }));
  await screen.findByText(/Your secure payment page is open/);
  expect(startCheckout).toHaveBeenCalledExactlyOnceWith("cloud");
});
