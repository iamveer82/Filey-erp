import {
  cleanup,
  render as renderComponent,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import RecordEditor from "../crm/RecordEditor";
import { emptyCrmData } from "../../lib/crmWorkspace";
vi.mock("../../lib/customFields", async original => ({ ...await original<object>(), syncCustomFields: vi.fn(async () => []) }));
afterEach(cleanup);
const render = (element: ReactElement) =>
  renderComponent(<MemoryRouter>{element}</MemoryRouter>);

it("discards cancelled edits and opens a linked deal prefilled with company and contact", () => {
  const data = emptyCrmData();
  data.companies = [{ id: 1, company: "North Harbour" }];
  const contact = { id: 2, name: "Sam", company_id: 1 };
  data.contacts = [contact];
  const add = vi.fn();
  render(
    <RecordEditor
      kind="contacts"
      row={contact}
      data={data}
      onSave={async () => {}}
      onClose={() => {}}
      onDelete={async () => {}}
      onConvert={async () => {}}
      onOpen={() => {}}
      onAdd={add}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByLabelText("Full name *"), {
    target: { value: "Unsaved name" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByLabelText("Full name *")).toHaveValue("Sam");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Add deal" }));
  expect(add).toHaveBeenCalledWith("deals", { customer_id: "1", person_id: "2" });
});

it("updates stage probability and locks a pending save against duplicate submissions", async () => {
  let complete!: () => void;
  const save = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      })
  );
  const data = emptyCrmData();
  data.companies = [{ id: 1, company: "Company" }];
  render(
    <RecordEditor
      kind="deals"
      data={data}
      initial={{ customer_id: "1" }}
      onSave={save}
      onClose={() => {}}
      onDelete={async () => {}}
      onConvert={async () => {}}
      onOpen={() => {}}
      onAdd={() => {}}
    />
  );
  fireEvent.change(screen.getByLabelText("Deal name *"), { target: { value: "Supply" } });
  fireEvent.change(screen.getByLabelText("Stage"), { target: { value: "proposal" } });
  expect(screen.getByLabelText("Probability (%)")).toHaveValue(45);
  const form = screen.getByLabelText("Stage").closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ stage: "proposal", probability: "45", customer_id: "1" })
  );
  expect(screen.getByLabelText("Deal name *")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await act(async () => complete());
});

it("submits the visible native date value even when browser autofill bypasses React change events", async () => {
  const save = vi.fn(async () => {});
  render(
    <RecordEditor
      kind="tasks"
      data={emptyCrmData()}
      onSave={save}
      onClose={() => {}}
      onDelete={async () => {}}
      onConvert={async () => {}}
      onOpen={() => {}}
      onAdd={() => {}}
    />
  );
  fireEvent.change(screen.getByLabelText("Task title *"), {
    target: { value: "Follow up" },
  });
  const date = screen.getByLabelText("Due date") as HTMLInputElement;
  date.value = "2026-09-10";
  fireEvent.change(screen.getByLabelText("Assignee"), {
    target: { value: "Sales team" },
  });
  fireEvent.submit(date.closest("form")!);
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Follow up",
        due_date: "2026-09-10",
        status: "open",
      })
    )
  );
});

it("keeps a failed save editable and blocks mutation after a failed workspace refresh", async () => {
  const save = vi.fn().mockRejectedValue(new Error("Connection lost. Try again."));
  const props = {
    kind: "contacts" as const,
    data: emptyCrmData(),
    onSave: save,
    onClose: vi.fn(),
    onDelete: vi.fn(),
    onConvert: vi.fn(),
    onOpen: vi.fn(),
    onAdd: vi.fn(),
  };
  render(<RecordEditor {...props} />);
  fireEvent.change(screen.getByLabelText("Full name *"), { target: { value: "Sam" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Create contact" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Create contact" }));
  await screen.findByText("Connection lost. Try again.");
  expect(screen.getByLabelText("Full name *")).toHaveValue("Sam");
  expect(screen.getByRole("button", { name: "Create contact" })).toBeEnabled();
  cleanup();
  render(<RecordEditor {...props} row={{ id: 4, name: "Sam" }} mutationDisabled />);
  expect(screen.getByRole("button", { name: "Edit" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Delete contact" })).toBeDisabled();
});
