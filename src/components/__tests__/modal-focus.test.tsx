import { useRef, useState } from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Modal } from "../ui";

afterEach(cleanup);
it("keeps typing focus stable and Escape closes only the nested dialog", async () => {
  function Forms() {
    const [open, setOpen] = useState(false);
    const [nested, setNested] = useState(false);
    const [value, setValue] = useState("");
    return <><button onClick={() => setOpen(true)}>Open editor</button>
      <Modal open={open} title="Record" onClose={() => setOpen(false)}>
        <input aria-label="Record name" value={value} onChange={(e) => setValue(e.target.value)} />
        <button onClick={() => setNested(true)}>Choose company</button>
        <Modal open={nested} title="Company" onClose={() => setNested(false)}><input aria-label="Company name" /></Modal>
      </Modal></>;
  }
  render(<Forms />);
  const trigger = screen.getByText("Open editor");
  trigger.focus(); fireEvent.click(trigger);
  const input = screen.getByRole("textbox", { name: "Record name" });
  input.focus(); fireEvent.change(input, { target: { value: "Falcon" } });
  expect(input).toHaveFocus();
  fireEvent.click(screen.getByText("Choose company"));
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Company name" }), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Company" })).toBeNull());
  expect(screen.getByRole("dialog", { name: "Record" })).toBeInTheDocument();
  fireEvent.keyDown(input, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(trigger).toHaveFocus();
});

it("runs the optional close-focus callback after restoring the trigger", async () => {
  let restoredTo: Element | null = null;
  function Forms() {
    const [open, setOpen] = useState(false);
    const destination = useRef<HTMLInputElement>(null);
    return <><button onClick={() => setOpen(true)}>Check invoice</button>
      <input ref={destination} aria-label="Description for line 1" />
      <Modal open={open} title="Review" onClose={() => setOpen(false)} onCloseAutoFocus={() => {
        restoredTo = document.activeElement;
        destination.current?.focus();
      }}><button onClick={() => setOpen(false)}>Edit line</button></Modal></>;
  }
  render(<Forms />);
  const trigger = screen.getByRole("button", { name: "Check invoice" });
  trigger.focus(); fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("button", { name: "Edit line" }));
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Description for line 1" })).toHaveFocus());
  expect(restoredTo).toBe(trigger);
});
