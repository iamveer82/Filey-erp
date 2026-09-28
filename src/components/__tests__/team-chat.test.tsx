import { afterEach, expect, it, vi } from "vitest";
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
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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
  fireEvent.click(screen.getByRole("button", { name: "Channels" }));
  await screen.findByText("#general");
  expect(mock.page).toHaveBeenLastCalledWith("general", undefined, undefined);
});
