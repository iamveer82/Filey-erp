import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DataTable } from "../ui";

afterEach(cleanup);

it("saves against the row revision opened for editing when live data refreshes", async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const original = { id: 7, name: "Paper", revision: 1 };
  const props = { rowKey: (r: typeof original) => r.id, columns: [{ key: "name", label: "Name", render: (r: typeof original) => r.name, editable: { value: (r: typeof original) => r.name, onSave } }] };
  const view = render(<DataTable {...props} rows={[original]} />);
  fireEvent.click(screen.getByRole("button", { name: "Paper" }));
  const input = screen.getByRole("textbox", { name: "Edit Name" });
  fireEvent.change(input, { target: { value: "Recycled paper" } });
  view.rerender(<DataTable {...props} rows={[{ ...original, revision: 2 }]} />);
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(onSave).toHaveBeenCalledExactlyOnceWith(original, "Recycled paper"));
});

it("keeps a draft and blocks an overwrite when a live refresh changes the same value", async () => {
  const onSave = vi.fn();
  const props = { rowKey: (r: {id:number;name:string}) => r.id, columns: [{key:"name",label:"Name",render:(r:{id:number;name:string})=>r.name,editable:{value:(r:{id:number;name:string})=>r.name,onSave}}] };
  const view=render(<DataTable {...props} rows={[{id:7,name:"Original"}]}/>);
  fireEvent.click(screen.getByRole("button",{name:"Original"}));
  fireEvent.change(screen.getByRole("textbox"),{target:{value:"My draft"}});
  view.rerender(<DataTable {...props} rows={[{id:7,name:"Latest saved value"}]}/>);
  fireEvent.keyDown(screen.getByRole("textbox"),{key:"Enter"});
  expect(screen.getByRole("alert")).toHaveTextContent("This value changed while you were editing");
  expect(screen.getByRole("textbox")).toHaveValue("My draft");expect(onSave).not.toHaveBeenCalled();
  fireEvent.blur(screen.getByRole("textbox"));
  expect(onSave).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Cancel editing Name"}));
  fireEvent.click(screen.getByRole("button",{name:"Latest saved value"}));
  expect(screen.getByRole("textbox")).toHaveValue("Latest saved value");
});

it("does not submit a surrounding form or write an unchanged inline value", async () => {
  const onSave = vi.fn(), submit = vi.fn();
  render(<form onSubmit={submit}><DataTable rows={[{ id: 7, name: "Paper" }]} rowKey={r => r.id} columns={[{ key: "name", label: "Name", render: r => r.name, editable: { value: r => r.name, onSave } }]} /></form>);
  fireEvent.click(screen.getByRole("button", { name: "Paper" }));
  expect(fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" })).toBe(false);
  expect(onSave).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Paper" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Discarded edit" } });
  expect(fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" })).toBe(false);
  expect(onSave).not.toHaveBeenCalled(); expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});

it("keeps a pending inline save from discarding a second row's editor", async () => {
  let complete!: () => void;
  const onSave = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
  render(<DataTable rows={[{ id: 7, name: "Paper" }, { id: 8, name: "Pens" }]} rowKey={r => r.id} columns={[{ key: "name", label: "Name", render: r => r.name, editable: { value: r => r.name, onSave } }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Paper" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Recycled paper" } });
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  expect(screen.getByRole("button", { name: "Pens" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Pens" }));
  await act(async () => complete());
  fireEvent.click(screen.getByRole("button", { name: "Pens" }));
  expect(screen.getByRole("textbox")).toHaveValue("Pens");
});
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
