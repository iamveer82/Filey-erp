import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PropsWithChildren } from "react";
import App from "../../App";
const mocks = vi.hoisted(() => ({ list: vi.fn(), release: vi.fn(), retry: vi.fn(), profileError: "", mode: "cloud" as "local" | "cloud" | null, signedIn: true }));
vi.mock("../../lib/supabase", () => ({ cloudConfigured: true }));
vi.mock("../../lib/dataMode", () => ({ getDataMode: () => mocks.mode }));
vi.mock("../../lib/auth", () => ({
  AuthProvider: ({ children }: PropsWithChildren) => children,
  useAuth: () => ({ configured: true, user: mocks.signedIn ? { id: "fixture" } : null, profile: { org_id: "org" },
    deviceLimitBlocked: true, retryDeviceRegistration: mocks.retry, signOut: vi.fn(),
    profileError: mocks.profileError, reloadProfile: mocks.retry }),
}));
vi.mock("../../lib/license", () => ({ ENFORCE_LICENSING: true, CLOUD_DEVICE_LIMIT: 20,
  listOrgDevices: mocks.list, releaseOrgDevice: mocks.release }));
vi.mock("../../lib/ui", () => ({ UIProvider: ({ children }: PropsWithChildren) => children }));
vi.mock("../../lib/i18n", () => ({ LanguageProvider: ({ children }: PropsWithChildren) => children }));
vi.mock("../../lib/shortcut", () => ({ maybePromptDesktopShortcut: vi.fn() }));
vi.mock("../../pages/Login", () => ({ default: () => <div>Sign in</div> }));
vi.mock("../../pages/ProfileSetup", () => ({ default: () => null }));
vi.mock("../../pages/SetupNotice", () => ({ default: () => <div>Choose local or cloud</div> }));
vi.mock("../PasswordRecovery", () => ({ default: () => null }));
vi.mock("../TwoFactorGate", () => ({ default: () => null }));
beforeEach(() => { vi.resetAllMocks(); mocks.profileError = ""; mocks.mode = "cloud"; mocks.signedIn = true; window.location.hash = "#/"; });
afterEach(cleanup);

it("asks new users once and preserves selected or existing signed-in workspaces", () => {
  mocks.signedIn = false;
  mocks.mode = null;
  render(<App />);
  expect(screen.getByText("Choose local or cloud")).toBeInTheDocument();
  cleanup();
  mocks.mode = "local";
  render(<App />);
  expect(screen.getByText("Sign in")).toBeInTheDocument();
  cleanup();
  mocks.mode = null;
  mocks.signedIn = true;
  mocks.list.mockResolvedValue([]);
  render(<App />);
  expect(screen.queryByText("Choose local or cloud")).not.toBeInTheDocument();
  expect(screen.getByText(/Your workspace already has 20 devices/)).toBeInTheDocument();
});

it("recovers a failed device list and reports a rejected release without an unhandled rejection", async () => {
  mocks.list.mockRejectedValueOnce(new Error("Database unavailable")).mockResolvedValue([{ id: "device", device_name: "Laptop" }]);
  mocks.release.mockRejectedValue(new Error("Denied"));
  render(<App />);
  expect(screen.getByText(/Your workspace already has 20 devices connected/)).toBeInTheDocument();
  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load your devices");
  fireEvent.click(screen.getByRole("button", { name: "Refresh devices" }));
  await screen.findByText("Laptop");
  fireEvent.click(screen.getByRole("button", { name: "Log out" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Couldn't log out this device"));
  expect(mocks.retry).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Log out" })).toBeEnabled();
});

it("keeps internal profile errors out of the account screen and offers retry", async () => {
  mocks.profileError = "SQLSTATE internal schema failure";
  render(<App />);
  expect(screen.getByText("Couldn't load your profile")).toBeInTheDocument();
  expect(screen.queryByText(mocks.profileError)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(mocks.retry).toHaveBeenCalledOnce();
});
