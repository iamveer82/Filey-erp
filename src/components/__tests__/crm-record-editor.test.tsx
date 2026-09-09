import { cleanup, render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import RecordEditor from "../crm/RecordEditor";
import { emptyCrmData } from "../../lib/crmWorkspace";
afterEach(cleanup);

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
