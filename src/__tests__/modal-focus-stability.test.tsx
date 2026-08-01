// @vitest-environment jsdom
// Modal used to list `onClose` in its focus-trap effect deps. Callers pass an
// inline arrow, so every parent render re-ran the effect: the cleanup restored
// focus to whatever was focused before the modal opened, then it re-focused the
// first field. Typing one character in any field but the first kicked focus out
// of the box. This asserts focus stays put while typing.
import { test, expect } from "vitest";
import { useState } from "react";
import { render, fireEvent, screen } from "@testing-library/react";
import { Modal } from "../components/ui";

function Harness() {
  const [open, setOpen] = useState(false);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      {/* Inline arrow — the identity that changes on every render. */}
      <Modal open={open} onClose={() => setOpen(false)} title="Add expense">
        <input aria-label="first" value={a} onChange={(e) => setA(e.target.value)} />
        <input aria-label="second" value={b} onChange={(e) => setB(e.target.value)} />
      </Modal>
    </>
  );
}

test("typing in a modal field keeps focus in that field", () => {
  render(<Harness />);
  fireEvent.click(screen.getByText("Open"));

  const second = screen.getByLabelText("second") as HTMLInputElement;
  second.focus();
  expect(document.activeElement).toBe(second);

  fireEvent.change(second, { target: { value: "D" } });
  expect(document.activeElement).toBe(second);

  fireEvent.change(second, { target: { value: "Di" } });
  expect(document.activeElement).toBe(second);
  expect(second.value).toBe("Di");
});
