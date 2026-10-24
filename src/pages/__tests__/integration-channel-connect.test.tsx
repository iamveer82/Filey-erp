import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import IntegrationConnect from "../IntegrationConnect";
import ChannelGateway from "../../components/ChannelGateway";

const store = vi.hoisted(() => ({
  secrets: [] as string[],
  saved: [] as { name: string; value: string }[],
  deleted: [] as string[],
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
});

afterEach(cleanup);

it("connects Slack on its own page with a validated webhook", async () => {
  show("/integrations/slack");
  expect(screen.getByRole("heading", { level: 1, name: "Slack" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open Slack apps" })).toHaveAttribute("href", "https://api.slack.com/apps");

  const input = screen.getByRole("textbox", { name: "Slack webhook" });
  expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();

  fireEvent.change(input, { target: { value: "https://evil.example/hook" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Slack needs an https address");
  expect(store.saved).toEqual([]);

  fireEvent.change(input, { target: { value: "https://hooks.slack.com/services/T/B/x" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  await waitFor(() => expect(store.saved).toEqual([
    { name: "channel.slack.webhook", value: "https://hooks.slack.com/services/T/B/x" },
  ]));
  expect(screen.getByText("Connected")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Disconnect Slack" })).toBeInTheDocument();
});

it("shows an already connected channel and disconnects it from its page", async () => {
  store.secrets = ["channel.teams.webhook"];
  show("/integrations/teams");
  expect(screen.getByRole("heading", { level: 1, name: "Microsoft Teams" })).toBeInTheDocument();
  expect(screen.getByText("Connected")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Disconnect Microsoft Teams" }));
  await waitFor(() => expect(store.deleted).toEqual(["channel.teams.webhook"]));
  expect(screen.getByText("Not connected")).toBeInTheDocument();
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

it("opens each webhook channel's own page from the channel list", () => {
  render(<MemoryRouter><ChannelGateway /></MemoryRouter>);
  const connect = screen.getAllByRole("link", { name: "Connect" });
  expect(connect.map(link => link.getAttribute("href"))).toEqual([
    "/integrations/slack",
    "/integrations/discord",
    "/integrations/teams",
  ]);
});
