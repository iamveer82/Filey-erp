import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Field, ShareToggle } from "../ui";

afterEach(cleanup);

it("connects shared field labels and feedback and preserves existing accessibility attributes", () => {
  const view = render(<Field label="Company" required error="Enter a company name"><input aria-describedby="existing" /></Field>);
  const input = screen.getByRole("textbox", { name: "Company" });
  expect(input).toHaveAttribute("aria-required", "true");
  expect(input).toHaveAttribute("aria-invalid", "true");
  const error = screen.getByRole("alert");
  expect(input.getAttribute("aria-describedby")?.split(" ")).toContain(error.id);
  view.rerender(<Field label="Company" hint="Use your registered name"><input aria-describedby="existing" /></Field>);
  expect(input).not.toHaveAttribute("aria-required");
  expect(input).not.toHaveAttribute("aria-invalid");
  expect(input.getAttribute("aria-describedby")).toContain("existing");
  view.rerender(<Field label="Company"><input aria-describedby="existing" /></Field>);
  expect(input).toHaveAttribute("aria-describedby", "existing");
});

it("changes sharing without submitting its enclosing form", () => {
  const submit = vi.fn();
  const change = vi.fn();
  render(<form onSubmit={submit}><ShareToggle shared onToggle={change} /></form>);
  fireEvent.click(screen.getByRole("button", { name: "Shared", pressed: true }));
  expect(change).toHaveBeenCalledWith(false);
  expect(submit).not.toHaveBeenCalled();
});
