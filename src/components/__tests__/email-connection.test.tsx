import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { setCacheOrg } from "../../lib/api";
import EmailConnection from "../EmailConnection";
import { readLocalEmailConnection, saveLocalEmailConnection } from "../../lib/localEmail";

const boundary = vi.hoisted(() => ({ native: vi.fn(), hosted: vi.fn(), vault: new Map<string, string>() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: boundary.native }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false }, CapacitorHttp: { request: vi.fn() } }));
vi.mock("../../lib/supabase", async importOriginal => ({ ...await importOriginal<typeof import("../../lib/supabase")>(), invokeFn: boundary.hosted }));
beforeEach(() => {
  localStorage.clear(); localStorage.setItem("filey_data_mode", "local");
  setCacheOrg(null); setCacheOrg("email-ui-org", "email-ui-user");
  vi.clearAllMocks(); boundary.vault.clear();
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  boundary.native.mockImplementation(async (command, args) => {
    const key = `${args.scope}:${args.name}`;
    if (command === "credential_write") { if (args.value) boundary.vault.set(key, args.value); else boundary.vault.delete(key); return; }
    if (command === "credential_read") return boundary.vault.get(key) ?? null;
    throw new Error("No email delivery allowed in this setup test");
  });
});
afterEach(() => { cleanup(); Reflect.deleteProperty(window, "__TAURI_INTERNALS__"); setCacheOrg(null); vi.restoreAllMocks(); });
const mount = () => render(<MemoryRouter><EmailConnection /></MemoryRouter>);

it("saves a masked personal key, clears the plaintext input and checks setup without sending", async () => {
  const network = vi.spyOn(globalThis, "fetch");
  mount();
  const key = screen.getByLabelText("Resend API key");
  expect(key).toHaveAttribute("type", "password");
  fireEvent.change(key, { target: { value: "re_settings_fixture_123" } });
  fireEvent.change(screen.getByLabelText("Verified sender email"), { target: { value: "accounts@company.example" } });
  fireEvent.click(screen.getByRole("button", { name: "Save email setup" }));
  await screen.findByText("Email setup saved. No email was sent.");
  expect(key).toHaveValue(""); expect(key).toHaveAttribute("placeholder", "Saved key · enter a new key to replace");
  expect(JSON.stringify(localStorage)).not.toContain("re_settings_fixture_123");
  fireEvent.click(screen.getByRole("button", { name: "Check saved setup" }));
  await screen.findByText(/Resend verifies the key and sender/);
  expect(boundary.native.mock.calls.map(([command]) => command)).toEqual(["credential_write", "credential_read"]);
  expect(boundary.hosted).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  expect(screen.getByText(/Resend receives the recipient/)).toBeVisible();
});

it("drops typed secrets and sender metadata when the account or workspace changes", async () => {
  mount();
  fireEvent.change(screen.getByLabelText("Resend API key"), { target: { value: "re_unsaved_fixture_123" } });
  fireEvent.change(screen.getByLabelText("Verified sender email"), { target: { value: "old@company.example" } });
  act(() => setCacheOrg("new-email-org", "new-email-user"));
  expect(screen.getByLabelText("Resend API key")).toHaveValue(""); expect(screen.getByLabelText("Verified sender email")).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "Save email setup" }));
  await screen.findByText("Enter one valid verified sender email address.");
  expect(boundary.native).not.toHaveBeenCalled();
});

it("does not publish a stale vault save into the next workspace or show its success", async () => {
  mount();
  let resume!: () => void;
  boundary.native.mockImplementationOnce(() => new Promise<void>(resolve => { resume = resolve; }));
  fireEvent.change(screen.getByLabelText("Resend API key"), { target: { value: "re_pending_fixture_123" } });
  fireEvent.change(screen.getByLabelText("Verified sender email"), { target: { value: "old@company.example" } });
  fireEvent.click(screen.getByRole("button", { name: "Save email setup" }));
  await waitFor(() => expect(resume).toBeTypeOf("function"));
  act(() => setCacheOrg("next-email-org", "next-email-user"));
  await act(async () => resume());
  expect(screen.queryByText("Email setup saved. No email was sent.")).toBeNull();
  expect(readLocalEmailConnection().senderEmail).toBe("");
  expect(screen.getByLabelText("Resend API key")).toHaveValue("");
});

it("requires verified sender setup and explains browser sending limitations truthfully", async () => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  await saveLocalEmailConnection({ senderEmail: "accounts@company.example", senderName: "Company" }, "re_browser_fixture_123");
  mount();
  expect(screen.getByText(/Browser local mode can save your setup but cannot send/)).toBeVisible();
  expect(screen.getByText(/memory for this session only/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Check saved setup" }));
  await waitFor(() => expect(screen.getAllByText(/Personal email sending requires the installed Filey/)).toHaveLength(2));
  expect(boundary.hosted).not.toHaveBeenCalled(); expect(boundary.native).not.toHaveBeenCalled();
});
