import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DataTable } from "../ui";

afterEach(cleanup);
it("keeps a failed inline edit and prevents duplicate commits", async () => {
  const onSave = vi.fn().mockRejectedValueOnce(new Error("Connection lost"));
  render(<DataTable rows={[{ id: 7, name: "Paper" }]} rowKey={(r) => r.id} columns={[{
    key: "name", label: "Name", render: (r) => r.name,
    editable: { value: (r) => r.name, onSave },
  }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Paper" }));
  const input = screen.getByRole("textbox", { name: "Edit Name" });
  fireEvent.change(input, { target: { value: "Recycled paper" } });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.blur(input);
  await screen.findByText("Connection lost");
  expect(input).toHaveValue("Recycled paper");
  expect(onSave).toHaveBeenCalledTimes(1);
  onSave.mockResolvedValueOnce(undefined);
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  expect(onSave).toHaveBeenLastCalledWith({ id: 7, name: "Paper" }, "Recycled paper");
});

it("shows bulk errors and counts only selected rows in the current result", async () => {
  const run = vi.fn().mockRejectedValue(new Error("Could not remove record"));
  const props = { columns: [{ key: "id", label: "ID", render: (r: { id: number }) => r.id }], rowKey: (r: { id: number }) => r.id, bulkActions: [{ label: "Remove", run }] };
  const view = render(<DataTable {...props} rows={[{ id: 1 }, { id: 2 }]} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
  view.rerender(<DataTable {...props} rows={[{ id: 2 }]} />);
  expect(screen.getByText("1 selected")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await screen.findByRole("alert");
  expect(run).toHaveBeenCalledWith([{ id: 2 }]);
  expect(screen.getByText("1 selected")).toBeInTheDocument();
});
