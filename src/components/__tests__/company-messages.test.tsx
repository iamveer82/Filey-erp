import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { setDataMode } from "../../lib/dataMode";
import { messages, type OrgMessage } from "../../lib/api";
import { notifyDataChanged } from "../../lib/realtime";
import { UIProvider } from "../../lib/ui";
import CompanyMessages from "../CompanyMessages";
vi.mock("../../lib/auth", () => ({ useAuth: () => ({ user: { id: "local-user" } }) }));
beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("renders locally stored messages without cloud ownership columns and can reply", async () => {
  await messages.post("Disposable team test");
  render(
    <UIProvider>
      <CompanyMessages />
    </UIProvider>
  );
  expect(await screen.findByText("Disposable team test")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Delete message" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reply" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Reply to You" }), {
    target: { value: "Reply works" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Post reply" }));
  expect(await screen.findByText("Reply works", { selector: "p span" })).toBeInTheDocument();
});

const row = (id: number): OrgMessage => ({
  id, user_id: "teammate", author: "Amina", body: `Message ${id}`,
  channel: "general", created_at: "2026-09-30T09:00:00Z",
});

it("keeps the reader in place on updates and older loads, then resumes following at the bottom", async () => {
  let rows = [row(2), row(3)];
  vi.spyOn(messages, "page").mockImplementation(async (_channel, before) =>
    before ? { rows: [row(1)], next: null } : { rows, next: 2 }
  );
  render(<UIProvider><CompanyMessages /></UIProvider>);
  await screen.findByText("Message 3");
  const feed = screen.getByRole("list", { name: "Channel conversations" });
  Object.defineProperties(feed, {
    scrollHeight: { get: () => feed.children.length * 200 },
    clientHeight: { value: 200 },
  });
  feed.scrollTop = 0;
  fireEvent.scroll(feed);
  expect(screen.getByRole("button", { name: "Latest messages" })).toBeInTheDocument();
  rows = [...rows, row(4)];
  act(() => notifyDataChanged(["org_messages"]));
  await screen.findByText("Message 4");
  expect(feed.scrollTop).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "Latest messages" }));
  expect(feed.scrollTop).toBe(feed.scrollHeight);
  expect(screen.queryByRole("button", { name: "Latest messages" })).not.toBeInTheDocument();

  feed.scrollTop = 120;
  fireEvent.scroll(feed);
  const height = feed.scrollHeight;
  fireEvent.click(screen.getByRole("button", { name: "Load older conversations" }));
  await screen.findByText("Message 1");
  expect(feed.scrollTop).toBe(120 + feed.scrollHeight - height);
  feed.scrollTop = feed.scrollHeight - feed.clientHeight;
  fireEvent.scroll(feed);
  rows = [...rows, row(5)];
  act(() => notifyDataChanged(["org_messages"]));
  await screen.findByText("Message 5");
  expect(feed.scrollTop).toBe(feed.scrollHeight);
});

it("scrolls to a focused message once without resetting the reader on every refresh", async () => {
  const page = vi.spyOn(messages, "page").mockResolvedValue({ rows: [row(1), row(2)], next: null });
  const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
  render(<UIProvider><CompanyMessages focusMessage={1} /></UIProvider>);
  await screen.findByText("Message 1");
  expect(scroll).toHaveBeenCalledOnce();
  act(() => notifyDataChanged(["org_messages"]));
  await waitFor(() => expect(page).toHaveBeenCalledTimes(2));
  expect(scroll).toHaveBeenCalledOnce();
});

it("marks messages read only when the conversation is open and the reader reaches the latest message", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.spyOn(messages, "page").mockResolvedValue({ rows: [row(1), row(2)], next: null });
  const read = vi.spyOn(messages, "markRead").mockResolvedValue();
  const { rerender } = render(<UIProvider><CompanyMessages active={false} /></UIProvider>);
  await screen.findByText("Message 2");
  expect(read).not.toHaveBeenCalled();
  rerender(<UIProvider><CompanyMessages active /></UIProvider>);
  await waitFor(() => expect(read).toHaveBeenCalledWith("general", 2, undefined));
  const feed = screen.getByRole("list", { name: "Channel conversations" });
  Object.defineProperties(feed, { scrollHeight: { value: 1000 }, clientHeight: { value: 200 } });
  feed.scrollTop = 0;
  fireEvent.scroll(feed);
  read.mockClear();
  vi.mocked(messages.page).mockResolvedValue({ rows: [row(1), row(2), row(3)], next: null });
  act(() => notifyDataChanged(["org_messages"]));
  await screen.findByText("Message 3");
  expect(read).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Latest messages" }));
  await waitFor(() => expect(read).toHaveBeenCalledWith("general", 3, undefined));
});
