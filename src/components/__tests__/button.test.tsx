import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Button } from "../Button";

afterEach(cleanup);

it("only submits when requested and makes a pending action non-clickable", () => {
  const submit = vi.fn(event => event.preventDefault());
  const action = vi.fn();
  const { rerender } = render(<form onSubmit={submit}><Button onClick={action}>Preview</Button><Button type="submit">Save</Button></form>);
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  expect(action).toHaveBeenCalledOnce();
  expect(submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(submit).toHaveBeenCalledOnce();
  rerender(<Button loading onClick={action}>Saving invoice</Button>);
  const pending = screen.getByRole("button", { name: "Saving invoice" });
  expect(pending).toBeDisabled();
  expect(pending).toHaveAttribute("aria-busy", "true");
  fireEvent.click(pending);
  expect(action).toHaveBeenCalledOnce();
});
