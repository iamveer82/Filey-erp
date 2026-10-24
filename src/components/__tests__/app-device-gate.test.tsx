import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PropsWithChildren } from "react";
import App from "../../App";
const mocks = vi.hoisted(() => ({ profileError: "", mode: "cloud" as "local" | "cloud" | null, signedIn: true }));
vi.mock("../../lib/supabase", () => ({ cloudConfigured: true }));
vi.mock("../../lib/dataMode", () => ({ getDataMode: () => mocks.mode }));
vi.mock("../../lib/auth", () => ({
  AuthProvider: ({ children }: PropsWithChildren) => children,
  useAuth: () => ({ configured: true, user: mocks.signedIn ? { id: "fixture" } : null, profile: { org_id: "org" },
    profileError: mocks.profileError, reloadProfile: vi.fn() }),
}));
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
  render(<App />);
  expect(screen.queryByText("Choose local or cloud")).not.toBeInTheDocument();
  // No device limit screen - signed-in user doesn't see login or device limit
  expect(screen.queryByText("Sign in")).not.toBeInTheDocument();
});

it("keeps internal profile errors out of the account screen and offers retry", async () => {
  mocks.profileError = "SQLSTATE internal schema failure";
  render(<App />);
  expect(screen.getByText("Couldn't load your profile")).toBeInTheDocument();
  expect(screen.queryByText(mocks.profileError)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
});
