import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UIProvider } from "../../lib/ui";
import Team from "../../pages/Team";
const mock = vi.hoisted(() => ({
  post: vi.fn(),
  page: vi.fn().mockResolvedValue({ rows: [], next: null }),
}));
vi.mock("../../lib/auth", () => ({ useAuth: () => ({ user: { id: "me" } }) }));
vi.mock("../../lib/dataMode", () => ({ isLocalMode: () => false }));
vi.mock("../../lib/realtime", () => ({ useLiveSync: () => {} }));
vi.mock("../../lib/api", () => ({
  channels: { list: async () => [], create: vi.fn() },
  org: {
    members: async () => [
      { user_id: "me", name: "Me", role: "owner" },
      {
        user_id: "peer",
        name: "Alex",
        email: "alex@example.test",
        role: "staff",
        modules: ["team"],
      },
    ],
  },
  messages: {
    page: mock.page,
    post: mock.post,
    unread: async () => ({}),
    unreadDirect: async () => ({ peer: 2 }),
    markRead: async () => {},
    thread: async () => [],
  },
}));
beforeEach(() => mock.page.mockResolvedValue({ rows: [], next: null }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("keeps channel messages chronological and the composer below the feed", async () => {
  mock.page.mockResolvedValue({ rows: [
    { id: 2, user_id: "peer", author: "Alex", body: "Later update", channel: "general", created_at: "2026-09-30T09:10:00Z" },
    { id: 1, user_id: "peer", author: "Alex", body: "Earlier update", channel: "general", created_at: "2026-09-30T09:00:00Z" },
  ], next: null });
  render(<MemoryRouter initialEntries={["/team?channel=general"]}><UIProvider><Team/></UIProvider></MemoryRouter>);
  const feed = await screen.findByRole("list", { name: "Channel conversations" });
  await screen.findByText("Earlier update");
  expect(feed.textContent!.indexOf("Earlier update")).toBeLessThan(feed.textContent!.indexOf("Later update"));
  const composer = screen.getByRole("combobox", { name: "Team update" }).closest("fieldset")!;
  expect(composer).toHaveClass("order-2");
  fireEvent.click(screen.getAllByRole("button", { name: "Reply" })[0]);
  fireEvent.click(screen.getByRole("button", { name: "Cancel reply" }));
  expect(screen.queryByRole("button", { name: "Post reply" })).not.toBeInTheDocument();
});

it("focuses the whole conversation when a notification points at a reply", async () => {
  const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
  mock.page.mockResolvedValue({ rows: [
    { id: 1, user_id: "peer", author: "Alex", body: "Original update", channel: "general", created_at: "2026-09-30T09:00:00Z" },
    { id: 2, parent_id: 1, user_id: "peer", author: "Alex", body: "Reply to open", channel: "general", created_at: "2026-09-30T09:10:00Z" },
  ], next: null });
  render(<MemoryRouter initialEntries={["/team?channel=general&message=2"]}><UIProvider><Team/></UIProvider></MemoryRouter>);
  await screen.findByText("Reply to open");
  expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
  expect(scroll.mock.contexts[scroll.mock.contexts.length - 1]).toHaveTextContent("Original update");
  expect(scroll.mock.contexts[scroll.mock.contexts.length - 1]).toHaveTextContent("Reply to open");
  scroll.mockRestore();
});
it("switches between a private chat and a channel, retaining failed attachment sends for retry", async () => {
  render(
    <MemoryRouter>
      <UIProvider>
        <Team />
      </UIProvider>
    </MemoryRouter>
  );
  fireEvent.click(await screen.findByRole("button", { name: /Alex staff/ }));
  await screen.findByText("Start the conversation. Send a message, photo or document.");
  expect(mock.page).toHaveBeenCalledWith("general", undefined, "peer");
  const file = new File(["invoice"], "invoice.pdf", { type: "application/pdf" });
  fireEvent.change(
    screen.getByLabelText("Attach files to message", { selector: "input" }),
    { target: { files: [file] } }
  );
  mock.post
    .mockRejectedValueOnce(new Error("Connection interrupted"))
    .mockResolvedValueOnce(undefined);
  fireEvent.click(screen.getByRole("button", { name: "Post message" }));
  await screen.findByText("Could not post: Connection interrupted");
  expect(screen.getByText("invoice.pdf")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Post message" }));
  await waitFor(() => expect(screen.queryByText("invoice.pdf")).not.toBeInTheDocument());
  expect(mock.post).toHaveBeenLastCalledWith("", null, "general", [file], "peer");
  fireEvent.change(screen.getByRole("combobox", { name: "Team update" }), { target: { value: "Unsent draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Channels" }));
  await screen.findByText("#general");
  expect(mock.page).toHaveBeenLastCalledWith("general", undefined, undefined);
  fireEvent.click(screen.getByRole("button", { name: "Chats" }));
  fireEvent.click(await screen.findByRole("button", { name: /Alex staff/ }));
  expect(await screen.findByRole("combobox", { name: "Team update" })).toHaveValue("Unsent draft");
});
