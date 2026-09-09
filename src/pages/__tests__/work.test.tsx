import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Work from "../Work";
import { UIProvider } from "../../lib/ui";
import { work } from "../../lib/api";

vi.mock("../../lib/auth", () => ({
  useAuth: () => ({ user: { email: "owner@example.test" } }),
}));
vi.mock("../../lib/api", () => ({
  work: { list: vi.fn(async () => []), save: vi.fn(async () => 1) },
  crm: { customers: async () => [] },
  billing: { listDocs: async () => [] },
}));
beforeEach(() => {
  vi.mocked(work.save).mockResolvedValue(1);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("saves project tasks and time together, and retains edits after a failed save", async () => {
  render(
    <MemoryRouter initialEntries={["/projects"]}>
      <UIProvider>
        <Work />
      </UIProvider>
    </MemoryRouter>
  );
  const create = screen.getByRole("button", { name: "New project" });
  await waitFor(() => expect(create).toBeEnabled());
  fireEvent.click(create);
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "Customer onboarding" },
  });
  fireEvent.change(screen.getByLabelText("New task"), {
    target: { value: "Import opening stock" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add task" }));
  fireEvent.click(screen.getByRole("button", { name: "Add time entry" }));
  vi.mocked(work.save).mockRejectedValueOnce(new Error("Connection interrupted"));
  fireEvent.click(screen.getAllByRole("button", { name: "Create project" })[0]);
  await screen.findByText("Connection interrupted");
  expect(screen.getByLabelText("Title")).toHaveValue("Customer onboarding");
  expect(screen.getByLabelText("Import opening stock")).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button", { name: "Create project" })[0]);
  await waitFor(() => expect(work.save).toHaveBeenCalledTimes(2));
  expect(work.save).toHaveBeenLastCalledWith(
    expect.objectContaining({
      kind: "project",
      title: "Customer onboarding",
      checklist: [
        expect.objectContaining({ title: "Import opening stock", done: false }),
      ],
      time_entries: [
        expect.objectContaining({ minutes: 30, person: "owner@example.test" }),
      ],
    }),
    undefined,
    undefined
  );
});

it("uses the helpdesk lifecycle on the support route", async () => {
  render(
    <MemoryRouter initialEntries={["/helpdesk"]}>
      <UIProvider>
        <Work />
      </UIProvider>
    </MemoryRouter>
  );
  const create = screen.getByRole("button", { name: "New ticket" });
  await waitFor(() => expect(create).toBeEnabled());
  fireEvent.click(create);
  expect(screen.getByLabelText("Status")).toHaveValue("open");
  expect(screen.getByRole("option", { name: "resolved" })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "planned" })).not.toBeInTheDocument();
});
