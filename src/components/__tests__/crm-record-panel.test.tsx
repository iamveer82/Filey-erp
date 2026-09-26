import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CrmRecordPanel from "../CrmRecordPanel";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  error: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("../../lib/crmWorkspace", () => ({ loadCrmRecordContext: mocks.load }));
vi.mock("../../lib/api", () => ({
  persistCrmRecord: mocks.save,
  removeCrmRecord: mocks.remove,
}));
vi.mock("../../lib/ui", () => ({
  useUI: () => ({ toast: { error: mocks.error }, confirm: mocks.confirm }),
}));

const note = (id: number, body: string) => ({
  id,
  body,
  target_type: "company",
  target_id: id,
  created_at: "2026-09-07T10:00:00Z",
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue({ notes: [], tasks: [] });
  mocks.save.mockResolvedValue(1);
  mocks.confirm.mockResolvedValue(true);
});
afterEach(cleanup);

it("refreshes on a local write and never shows an old response or draft after switching records", async () => {
  let finishOld!: (value: unknown) => void;
  mocks.load.mockResolvedValueOnce({ notes: [note(1, "First record")], tasks: [] });
  const ui = render(<CrmRecordPanel targetType="company" targetId={1} />);
  await screen.findByText("First record");
  fireEvent.change(screen.getByLabelText("New note"), {
    target: { value: "Private draft for first record" },
  });
  mocks.load.mockReturnValueOnce(
    new Promise((resolve) => {
      finishOld = resolve;
    })
  );
  window.dispatchEvent(new Event("filey:local-write"));
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
  mocks.load.mockResolvedValueOnce({ notes: [note(2, "Second record")], tasks: [] });
  ui.rerender(<CrmRecordPanel targetType="company" targetId={2} />);
  await screen.findByText("Second record");
  expect(screen.getByLabelText("New note")).toHaveValue("");
  await act(async () => finishOld({ notes: [note(1, "Stale first record")], tasks: [] }));
  expect(screen.queryByText("Stale first record")).not.toBeInTheDocument();
  expect(screen.getByText("Second record")).toBeInTheDocument();
});

it("shows a failed context read with retry instead of empty records", async () => {
  mocks.load.mockRejectedValueOnce(new Error("Read denied"));
  render(<CrmRecordPanel targetType="company" targetId={1} />);
  await screen.findByText(/Could not load notes and tasks: Read denied/);
  expect(screen.queryByText("No notes yet.")).not.toBeInTheDocument();
  expect(screen.getByLabelText("New note")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("No notes yet.");
  expect(screen.getByLabelText("New note")).not.toBeDisabled();
});

it("preserves a failed task draft, captures the native date, and blocks duplicate pending writes", async () => {
  let rejectSave!: (reason: Error) => void;
  mocks.save.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      rejectSave = reject;
    })
  );
  render(<CrmRecordPanel targetType="company" targetId={7} />);
  await screen.findByText("No notes yet.");
  fireEvent.click(screen.getByRole("button", { name: "tasks" }));
  const date = screen.getByLabelText("Due date") as HTMLInputElement;
  date.value = "2026-09-10";
  fireEvent.change(screen.getByLabelText("New task"), {
    target: { value: "Call customer" },
  });
  const form = date.closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(mocks.save).toHaveBeenCalledWith(
    "crm_tasks",
    expect.objectContaining({
      target_id: 7,
      title: "Call customer",
      due_date: "2026-09-10",
      status: "open",
    })
  );
  expect(screen.getByLabelText("New task")).toBeDisabled();
  expect(screen.getByRole("button", { name: "notes" })).toBeDisabled();
  await act(async () => rejectSave(new Error("Write denied")));
  expect(mocks.error).toHaveBeenCalledWith("Write denied");
  expect(screen.getByLabelText("New task")).toHaveValue("Call customer");
  expect(date).toHaveValue("2026-09-10");
  expect(screen.getByLabelText("New task")).not.toBeDisabled();
});

it("treats cancelled tasks as closed and offers an explicit reopen action", async () => {
  mocks.load.mockResolvedValue({
    notes: [],
    tasks: [
      {
        id: 1,
        title: "Cancelled order",
        status: "cancelled",
        target_type: "company",
        target_id: 1,
        due_date: "2020-01-01",
        created_at: "2020-01-01",
      },
    ],
  });
  render(<CrmRecordPanel targetType="company" targetId={1} />);
  await screen.findByText("No notes yet.");
  const tasks = screen.getByRole("button", { name: "tasks" });
  expect(tasks).toHaveTextContent(/^tasks$/);
  fireEvent.click(tasks);
  fireEvent.click(screen.getByRole("button", { name: "Reopen task: Cancelled order" }));
  await waitFor(() =>
    expect(mocks.save).toHaveBeenCalledWith(
      "crm_tasks",
      { status: "open", completed_at: null },
      1
    )
  );
});
