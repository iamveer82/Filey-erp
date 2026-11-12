import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import IntegrationConnect from "../IntegrationConnect";
import ChannelGateway from "../../components/ChannelGateway";
import { invalidateChannelAuth } from "../../lib/channelOAuth";

const store = vi.hoisted(() => ({
  secrets: [] as string[],
  saved: [] as { name: string; value: string }[],
  deleted: [] as string[],
}));

const composio = vi.hoisted(() => ({
  connect: vi.fn(),
  list: vi.fn(),
  status: vi.fn(),
  opened: [] as string[],
}));

vi.mock("../../lib/secretStore", () => ({
  listSecrets: () => store.secrets.slice(),
  saveSecret: async (name: string, value: string) => {
    store.saved.push({ name, value });
    store.secrets = [...new Set([...store.secrets, name])];
  },
  deleteSecret: async (name: string) => {
    store.deleted.push(name);
    store.secrets = store.secrets.filter(secret => secret !== name);
  },
}));
vi.mock("../../lib/composio", () => ({
  hasDesktop: true,
  composioConnect: (...args: unknown[]) => composio.connect(...args),
  composioList: (...args: unknown[]) => composio.list(...args),
  composioStatus: (...args: unknown[]) => composio.status(...args),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: async (url: string) => { composio.opened.push(url); },
}));
vi.mock("../../lib/nativePlatform", () => ({
  isNativeApp: () => false,
  openNativeExternal: async () => {},
}));
vi.mock("../../lib/ui", () => ({
  useUI: () => ({ toast: { error: vi.fn(), success: vi.fn() }, notice: vi.fn(), confirm: vi.fn(async () => true) }),
}));
vi.mock("../../components/TelegramAgentConnection", () => ({ default: () => <section aria-label="Telegram agent connection" /> }));
vi.mock("../../components/EmailConnection", () => ({ default: () => <section aria-label="Email connection" /> }));
vi.mock("../../components/WhatsAppConnection", () => ({ default: () => <section aria-label="WhatsApp connection" /> }));

function show(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/integrations/:app" element={<IntegrationConnect />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  store.secrets = [];
  store.saved = [];
  store.deleted = [];
  composio.connect.mockReset();
  composio.list.mockReset();
  composio.status.mockReset();
  composio.opened = [];
  composio.list.mockResolvedValue({ items: [] });
  composio.connect.mockResolvedValue({
    redirect_url: "https://backend.composio.dev/api/v3/s/link/abc",
    connected_account_id: "ca_slack_1",
  });
  composio.status.mockResolvedValue({ status: "ACTIVE" });
  invalidateChannelAuth();
});

afterEach(cleanup);

it("opens Slack's authorization page instead of asking for a webhook", async () => {
  show("/integrations/slack");
  expect(screen.getByRole("heading", { level: 1, name: "Slack" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open Slack apps" })).toHaveAttribute("href", "https://api.slack.com/apps");

  fireEvent.click(screen.getByRole("button", { name: "Connect Slack" }));

  await waitFor(() => expect(composio.connect).toHaveBeenCalledWith("slack"));
  await waitFor(() => expect(composio.opened).toEqual([
    "https://backend.composio.dev/api/v3/s/link/abc",
  ]));
  expect(await screen.findByRole("status")).toHaveTextContent("Approve the request in the browser");
  await waitFor(() => expect(screen.getByText("Connected")).toBeInTheDocument(), { timeout: 5000 });
  expect(screen.getByRole("button", { name: "Reconnect Slack" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Manage access/ })).toHaveAttribute("href", "https://slack.com/apps/manage");
});

it("explains when Slack refuses the authorization", async () => {
  composio.status.mockResolvedValue({ status: "FAILED", error: { message: "access_denied" } });
  show("/integrations/slack");
  fireEvent.click(screen.getByRole("button", { name: "Connect Slack" }));
  await waitFor(
    () => expect(screen.getByRole("status")).toHaveTextContent("did not authorize"),
    { timeout: 5000 }
  );
  expect(screen.getByText("Not connected")).toBeInTheDocument();
});

it("explains how to enable one-click authorization when the service is not set up", async () => {
  composio.connect.mockRejectedValueOnce(new Error("Integrations aren't configured yet."));
  show("/integrations/slack");
  fireEvent.click(screen.getByRole("button", { name: "Connect Slack" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Add your own Composio key");
  expect(screen.getByRole("link", { name: /Add a Composio key/ })).toHaveAttribute(
    "href",
    "/integrations?tab=available"
  );
});

it("still connects a webhook as the one-way fallback on the channel page", async () => {
  show("/integrations/slack");
  expect(screen.getByRole("button", { name: "Connect Slack" })).toBeInTheDocument();

  fireEvent.click(screen.getByText("Use an incoming webhook instead"));
  const input = screen.getByRole("textbox", { name: "Slack webhook" });
  expect(screen.getByRole("button", { name: "Save webhook" })).toBeDisabled();

  fireEvent.change(input, { target: { value: "https://evil.example/hook" } });
  fireEvent.click(screen.getByRole("button", { name: "Save webhook" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Slack needs an https address");
  expect(store.saved).toEqual([]);

  fireEvent.change(input, { target: { value: "https://hooks.slack.com/services/T/B/x" } });
  fireEvent.click(screen.getByRole("button", { name: "Save webhook" }));
  await waitFor(() => expect(store.saved).toEqual([
    { name: "channel.slack.webhook", value: "https://hooks.slack.com/services/T/B/x" },
  ]));
  expect(screen.getByText("Connected")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Remove webhook" })).toBeInTheDocument();
});

it("shows an already connected webhook channel and removes it from its page", async () => {
  store.secrets = ["channel.teams.webhook"];
  show("/integrations/teams");
  expect(screen.getByRole("heading", { level: 1, name: "Microsoft Teams" })).toBeInTheDocument();
  expect(screen.getByText("Connected")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Remove webhook" }));
  await waitFor(() => expect(store.deleted).toEqual(["channel.teams.webhook"]));
  expect(screen.getByText("Not connected")).toBeInTheDocument();
});

it("opens the provider authorization from the Slack channel row", async () => {
  render(<MemoryRouter><ChannelGateway /></MemoryRouter>);
  const slack = within(screen.getByRole("group", { name: "Slack channel" }));

  expect(slack.getByText("Not connected")).toBeInTheDocument();
  // The list no longer asks for a pasted webhook; that lives on the setup page.
  expect(slack.queryByRole("textbox")).not.toBeInTheDocument();
  expect(slack.getByRole("link", { name: "Setup guide" })).toHaveAttribute("href", "/integrations/slack");

  fireEvent.click(slack.getByRole("button", { name: "Connect Slack" }));
  await waitFor(() => expect(composio.connect).toHaveBeenCalledWith("slack"));
  await waitFor(() => expect(composio.opened).toHaveLength(1));
  await waitFor(() => expect(slack.getByText("Connected")).toBeInTheDocument(), { timeout: 5000 });
  expect(slack.getByRole("link", { name: "Manage" })).toHaveAttribute("href", "/integrations/slack");
});

it("shows the other chat channels with their own authorization buttons", () => {
  render(<MemoryRouter><ChannelGateway /></MemoryRouter>);
  const discord = within(screen.getByRole("group", { name: "Discord channel" }));
  const teams = within(screen.getByRole("group", { name: "Microsoft Teams channel" }));
  expect(discord.getByRole("button", { name: "Connect Discord" })).toBeInTheDocument();
  expect(teams.getByRole("button", { name: "Connect Microsoft Teams" })).toBeInTheDocument();
});

it.each([
  ["telegram", "Telegram agent connection"],
  ["email", "Email connection"],
  ["whatsapp", "WhatsApp connection"],
])("reuses the %s connection surface on its own page", (app, region) => {
  show(`/integrations/${app}`);
  expect(screen.getByRole("region", { name: region })).toBeInTheDocument();
});

it("keeps the unknown-integration fallback for apps that are not channels", () => {
  show("/integrations/not-a-real-app");
  expect(screen.getByRole("heading", { name: "Unknown integration" })).toBeInTheDocument();
});
