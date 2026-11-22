import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { UIProvider } from "../../lib/ui";
import * as composio from "../../lib/composio";
import * as appEvents from "../../lib/appEvents";
import * as agentStorage from "../../lib/agentStorage";
import AppConnect from "../AppConnect";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

beforeEach(() => {
  vi.spyOn(composio, "composioKeySource").mockResolvedValue("platform");
  vi.spyOn(appEvents, "activeConnection").mockResolvedValue("ca_1");
  vi.spyOn(appEvents, "appEventTypes").mockResolvedValue([
    { slug: "GMAIL_NEW_GMAIL_MESSAGE", name: "New message", description: "A new email arrives" },
    { slug: "GMAIL_LABEL_ADDED", name: "Label added", config: { properties: { label: { type: "string", title: "Label" } }, required: ["label"] } },
  ]);
  vi.spyOn(appEvents, "appEventsOn").mockResolvedValue([]);
  vi.spyOn(appEvents, "recentAppEvents").mockResolvedValue([
    { id: 1, toolkit: "gmail", trigger_slug: "GMAIL_NEW_GMAIL_MESSAGE", data: { subject: "Order 42" }, received_at: "2026-11-21" },
  ]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const mount = () => render(
  <UIProvider>
    <MemoryRouter initialEntries={["/integrations/app/gmail"]}>
      <Routes><Route path="/integrations/app/:toolkit" element={<AppConnect />} /></Routes>
    </MemoryRouter>
  </UIProvider>,
);

it("lists the app's events and recent deliveries, and turns one on", async () => {
  const on = vi.spyOn(appEvents, "turnOnAppEvent").mockResolvedValue("ti_1");
  mount();
  expect(await screen.findByText("New message")).toBeTruthy();
  expect(screen.getByText(/subject: Order 42/)).toBeTruthy();
  fireEvent.click(screen.getAllByRole("button", { name: "Turn on" })[0]);
  await waitFor(() => expect(on).toHaveBeenCalledWith("gmail", "GMAIL_NEW_GMAIL_MESSAGE", {}));
});

it("asks for required settings before turning an event on", async () => {
  const on = vi.spyOn(appEvents, "turnOnAppEvent").mockResolvedValue("ti_2");
  mount();
  await screen.findByText("Label added");
  fireEvent.click(screen.getAllByRole("button", { name: "Turn on" })[1]);
  const dialogButton = await screen.findAllByRole("button", { name: "Turn on" });
  const save = dialogButton[dialogButton.length - 1];
  expect((save as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Leads" } });
  fireEvent.click(save);
  await waitFor(() => expect(on).toHaveBeenCalledWith("gmail", "GMAIL_LABEL_ADDED", { label: "Leads" }));
});

it("explains that events need Filey's connection when the owner uses their own key", async () => {
  vi.mocked(composio.composioKeySource).mockResolvedValue("own");
  mount();
  expect(await screen.findByText(/You are using your own Composio key/)).toBeTruthy();
  expect(appEvents.appEventTypes).not.toHaveBeenCalled();
});

it("walks a new app through connecting and keeps the sign-in link when a popup is blocked", async () => {
  vi.mocked(appEvents.activeConnection).mockResolvedValue(null);
  vi.spyOn(agentStorage, "agentStorageScope").mockReturnValue("cloud:org:a:user:a");
  const opened = vi.spyOn(window, "open").mockReturnValue(null);
  vi.spyOn(composio, "composioConnect").mockResolvedValue({ redirect_url: "https://connect.composio.dev/link/x", connected_account_id: "ca_9" });
  const status = vi.spyOn(composio, "composioStatus").mockResolvedValue({ status: "INITIATED" });
  mount();
  expect(await screen.findByText("How it works")).toBeTruthy();
  vi.useFakeTimers();
  try {
    fireEvent.click(screen.getByRole("button", { name: "Connect Gmail" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(opened).toHaveBeenCalledWith("https://connect.composio.dev/link/x", "_blank", "noopener,noreferrer");
    expect(screen.getByRole("link", { name: "open the Gmail sign-in page" })).toHaveAttribute("href", "https://connect.composio.dev/link/x");
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(status).toHaveBeenCalledWith("ca_9");
  } finally { vi.useRealTimers(); }
});

it("never opens a sign-in that started under another account", async () => {
  vi.mocked(appEvents.activeConnection).mockResolvedValue(null);
  const scope = vi.spyOn(agentStorage, "agentStorageScope").mockReturnValue("cloud:org:a:user:a");
  const opened = vi.spyOn(window, "open").mockReturnValue(null);
  let finish: (v: { redirect_url: string; connected_account_id: string }) => void = () => {};
  vi.spyOn(composio, "composioConnect").mockImplementation(() => new Promise((r) => { finish = r; }));
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Connect Gmail" }));
  scope.mockReturnValue("cloud:org:b:user:b");
  await act(async () => { finish({ redirect_url: "https://connect.composio.dev/link/x", connected_account_id: "ca_9" }); });
  expect(opened).not.toHaveBeenCalled();
  expect(screen.queryByRole("link", { name: /sign-in page/ })).toBeNull();
});
