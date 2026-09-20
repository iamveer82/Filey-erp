import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HashRouter } from "react-router-dom";
import { UIProvider } from "../../lib/ui";
import { awaitCloudPlan, getSubscription, openBillingPortal, type Subscription } from "../../lib/subscription";
import BillingPanel from "../settings/BillingPanel";

vi.mock("../../lib/subscription", async (original) => ({
  ...await original<typeof import("../../lib/subscription")>(),
  getSubscription: vi.fn(), awaitCloudPlan: vi.fn(), openBillingPortal: vi.fn(),
}));
vi.mock("../../lib/license", () => ({
  verifyStoredLicense: async () => ({ valid: false }), entitlement: async () => "free",
  cloudAccess: async () => ({ reason: "free" }), FREE_LIMITS: { invoicesPerMonth: 5 },
}));
vi.mock("../../lib/api", () => ({
  erp: { products: async () => [], orders: async () => [] },
  crm: { customers: async () => [] }, quotes: { listDocs: async () => [] },
  billing: { listDocs: async () => [] }, invoicesThisMonth: async () => 2,
}));
vi.mock("../../lib/dataMode", () => ({ isLocalMode: () => false }));
vi.mock("../../lib/supabase", () => ({ supabase: null }));

beforeEach(() => {
  vi.mocked(getSubscription).mockResolvedValue({ plan: "free" });
  window.history.replaceState(null, "", "/#/settings?section=billing&checkout=success");
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
  expect(screen.getByRole("button", { name: /Get Ultra/ })).toBeDisabled();
  opened("browser");
  await waitFor(() => expect(screen.getByRole("button", { name: "Manage billing" })).toBeEnabled());
  expect(openBillingPortal).toHaveBeenCalledTimes(1);
});
