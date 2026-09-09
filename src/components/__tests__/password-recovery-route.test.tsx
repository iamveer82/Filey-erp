import { StrictMode, type ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "../../App";

const providers = vi.hoisted(() => ({ auth: vi.fn(), user: null as { id: string } | null, mode: "cloud" }));
vi.mock("../../lib/auth", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => { providers.auth(); return children; },
  useAuth: () => ({ loading: false, configured: true, user: providers.user }),
}));
vi.mock("../../lib/dataMode", () => ({ getDataMode: () => providers.mode, isLocalMode: () => providers.mode === "local" }));
vi.mock("../../lib/modules", () => ({ ModulesProvider: () => null, useModules: () => ({ modules: [], isEnabled: () => true }) }));
vi.mock("../Layout", () => ({ default: () => null }));
vi.mock("../CommandPalette", () => ({ default: () => null }));
vi.mock("../OverdueReminder", () => ({ default: () => null }));
vi.mock("../Notifier", () => ({ default: () => null }));
vi.mock("../UpdateNotice", () => ({ default: () => null }));
vi.mock("../AgentScheduler", () => ({ default: () => null }));
vi.mock("../../pages/Login", () => ({ default: () => <p>Sign in form</p> }));
vi.mock("../../pages/Landing", () => ({ default: () => <p>Landing page</p> }));
vi.mock("../../pages/ProfileSetup", () => ({ default: () => null }));
vi.mock("../../pages/SetupNotice", () => ({ default: () => null }));

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  providers.user = null;
  providers.mode = "cloud";
  window.history.replaceState(null, "", "/");
});

it.each(["cloud", "local"])("shows sign-in immediately when signed out in %s mode", (mode) => {
  providers.mode = mode;
  render(<App />);
  expect(screen.getByText("Sign in form")).toBeInTheDocument();
  expect(screen.queryByText("Landing page")).toBeNull();
});

it("returns to sign-in when an existing session ends", () => {
  providers.user = { id: "owner" };
  const view = render(<App />);
  expect(screen.queryByText("Sign in form")).toBeNull();
  providers.user = null;
  view.rerender(<App />);
  expect(screen.getByText("Sign in form")).toBeInTheDocument();
  expect(screen.queryByText("Landing page")).toBeNull();
});

it("captures and removes the token without starting the app auth provider, including StrictMode remounts", () => {
  window.history.replaceState(null, "", "/?source=email#/reset-password?token_hash=private-hash&email=owner%40example.test");
  const view = render(<StrictMode><App /></StrictMode>);
  expect(screen.getByLabelText(/^New password/)).toBeInTheDocument();
  expect(window.location.hash).toBe("#/reset-password");
  expect(window.location.search).toBe("?source=email");
  expect(providers.auth).not.toHaveBeenCalled();
  view.rerender(<StrictMode><App /></StrictMode>);
  expect(screen.getByLabelText(/^New password/)).toBeInTheDocument();
  expect(providers.auth).not.toHaveBeenCalled();
});

it("lets an incomplete or refreshed link request a replacement", () => {
  window.history.replaceState(null, "", "/#/reset-password");
  render(<App />);
  expect(screen.getByRole("alert")).toHaveTextContent(/reset link is incomplete/);
  expect(screen.getByRole("button", { name: "Send reset link" })).toBeInTheDocument();
  expect(screen.queryByLabelText(/^New password/)).toBeNull();
  expect(providers.auth).not.toHaveBeenCalled();
});

it("returns directly to sign in without reloading or showing the marketing page", () => {
  window.history.replaceState(null, "", "/#/reset-password?token_hash=private-hash&email=owner%40example.test");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Back to sign in" }));
  expect(screen.getByText("Sign in form")).toBeInTheDocument();
  expect(screen.queryByText("Landing page")).toBeNull();
  expect(window.location.hash).toBe("#/");
});
