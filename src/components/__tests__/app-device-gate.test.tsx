import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PropsWithChildren } from "react";
import App from "../../App";
const mocks = vi.hoisted(() => ({ list: vi.fn(), release: vi.fn(), retry: vi.fn(), profileError: "" }));
vi.mock("../../lib/supabase", () => ({ cloudConfigured: true }));
vi.mock("../../lib/dataMode", () => ({ getDataMode: () => "cloud" }));
vi.mock("../../lib/auth", () => ({
  AuthProvider: ({ children }: PropsWithChildren) => children,
  useAuth: () => ({ configured: true, user: { id: "fixture" }, profile: { org_id: "org" },
    deviceLimitBlocked: true, retryDeviceRegistration: mocks.retry, signOut: vi.fn(),
    profileError: mocks.profileError, reloadProfile: mocks.retry }),
}));
vi.mock("../../lib/license", () => ({ ENFORCE_LICENSING: true, CLOUD_DEVICE_LIMIT: 5,
  listOrgDevices: mocks.list, releaseOrgDevice: mocks.release }));
vi.mock("../../lib/ui", () => ({ UIProvider: ({ children }: PropsWithChildren) => children }));
vi.mock("../../lib/i18n", () => ({ LanguageProvider: ({ children }: PropsWithChildren) => children }));
vi.mock("../../lib/shortcut", () => ({ maybePromptDesktopShortcut: vi.fn() }));
vi.mock("../../pages/Login", () => ({ default: () => null }));
vi.mock("../../pages/ProfileSetup", () => ({ default: () => null }));
vi.mock("../../pages/SetupNotice", () => ({ default: () => null }));
vi.mock("../PasswordRecovery", () => ({ default: () => null }));
vi.mock("../TwoFactorGate", () => ({ default: () => null }));
beforeEach(() => { vi.resetAllMocks(); mocks.profileError = ""; window.location.hash = "#/"; });
afterEach(cleanup);

it("recovers a failed device list and reports a rejected release without an unhandled rejection", async () => {
  mocks.list.mockRejectedValueOnce(new Error("Database unavailable")).mockResolvedValue([{ id: "device", device_name: "Laptop" }]);
  mocks.release.mockRejectedValue(new Error("Denied"));
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load your devices");
  fireEvent.click(screen.getByRole("button", { name: "Refresh devices" }));
  await screen.findByText("Laptop");
  fireEvent.click(screen.getByRole("button", { name: "Release" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Couldn't release this device"));
  expect(mocks.retry).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Release" })).toBeEnabled();
});

it("keeps internal profile errors out of the account screen and offers retry", async () => {
  mocks.profileError = "SQLSTATE internal schema failure";
  render(<App />);
  expect(screen.getByText("Couldn't load your profile")).toBeInTheDocument();
  expect(screen.queryByText(mocks.profileError)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(mocks.retry).toHaveBeenCalledOnce();
});
