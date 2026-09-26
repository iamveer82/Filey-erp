import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { UIProvider } from "../../lib/ui";
import Comms from "../Comms";
import Team from "../Team";
import { channels } from "../../lib/api";

const api = vi.hoisted(() => ({ addCall: vi.fn(), createChannel: vi.fn() }));
vi.mock("../../lib/api", () => ({
  emailLog: { list: async () => [] },
  callLog: { list: async () => [], add: api.addCall },
  channels: {
    list: async () => [{ id: 1, name: "general", purpose: "" }],
    create: api.createChannel,
  },
}));
vi.mock("../../lib/realtime", () => ({ useLiveSync: () => {} }));
vi.mock("../../components/CompanyMessages", () => ({ default: () => <div>Messages</div> }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("opens the default team room without creating records and displays legacy duplicate names once", async () => {
  const read = vi.spyOn(channels, "list").mockResolvedValue([]);
  const page = render(<MemoryRouter><UIProvider><Team /></UIProvider></MemoryRouter>);
  await screen.findByRole("button", { name: "general" });
  expect(api.createChannel).not.toHaveBeenCalled();
  page.unmount();
  read.mockResolvedValue([{ id: 1, name: "general", created_at: "" }, { id: 2, name: "general", created_at: "" }]);
  render(<MemoryRouter><UIProvider><Team /></UIProvider></MemoryRouter>);
  await screen.findByRole("button", { name: "general" });
  expect(screen.getAllByRole("button", { name: "general" })).toHaveLength(1);
  expect(api.createChannel).not.toHaveBeenCalled();
  read.mockRestore();
});

it("rejects negative call durations and keeps a pending save from being submitted twice", async () => {
  let finish!: () => void;
  api.addCall.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  render(<MemoryRouter><UIProvider><Comms /></UIProvider></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Calls (0)" }));
  fireEvent.click(screen.getByRole("button", { name: "Log a call" }));
  const dialog = within(screen.getByRole("dialog"));
  fireEvent.change(dialog.getByLabelText("Contact"), { target: { value: "Alex" } });
  fireEvent.change(dialog.getByLabelText("Duration (minutes)"), { target: { value: "-1" } });
  fireEvent.click(dialog.getByRole("button", { name: "Save call" }));
  expect(api.addCall).not.toHaveBeenCalled();
  expect(await screen.findByText("Enter a duration of zero minutes or more.")).toBeInTheDocument();
  fireEvent.change(dialog.getByLabelText("Duration (minutes)"), { target: { value: "1.5" } });
  fireEvent.click(dialog.getByRole("button", { name: "Save call" }));
  expect(dialog.getByRole("button", { name: "Saving…" })).toBeDisabled();
  expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
  fireEvent.click(dialog.getByRole("button", { name: "Saving…" }));
  expect(api.addCall).toHaveBeenCalledTimes(1);
  expect(api.addCall).toHaveBeenCalledWith(expect.objectContaining({ contact_name: "Alex", duration_secs: 90 }));
  finish();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("creates a channel through its labeled form and locks the controls while saving", async () => {
  let finish!: () => void;
  api.createChannel.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  render(<MemoryRouter><UIProvider><Team /></UIProvider></MemoryRouter>);
  await screen.findByRole("button", { name: "general" });
  fireEvent.click(screen.getByRole("button", { name: "New channel" }));
  const name = screen.getByLabelText("Channel name");
  fireEvent.change(name, { target: { value: "sales" } });
  fireEvent.submit(name.closest("form")!);
  expect(api.createChannel).toHaveBeenCalledWith("sales");
  expect(name).toBeDisabled();
  expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
  finish();
  await waitFor(() => expect(screen.queryByLabelText("Channel name")).toBeNull());
});
