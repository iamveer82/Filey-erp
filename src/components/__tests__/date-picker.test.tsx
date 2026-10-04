import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DateField } from "../DatePicker";

afterEach(cleanup);

describe("date editing", () => {
  it("preserves an edit in the middle of the date across parent renders", () => {
    const onChange = vi.fn();
    const { rerender } = render(<DateField value="2026-09-28" onChange={onChange} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "28/0/2026", selectionStart: 4, selectionEnd: 4 } });
    expect(input).toHaveValue("28/0/2026");
    expect(input.selectionStart).toBe(4);
    rerender(<DateField value="2026-09-28" onChange={onChange} />);
    expect(input).toHaveValue("28/0/2026");
    fireEvent.change(input, { target: { value: "28/08/2026" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith("2026-08-28");
    rerender(<DateField value="2026-10-12" onChange={onChange} />);
    expect(input).toHaveValue("12/10/2026");
  });

  it.each(["28092026", "28/9/2026", "2026-09-28", "28 Sep 2026"])(
    "formats %s only when editing finishes",
    (text) => {
      const onChange = vi.fn();
      render(<DateField onChange={onChange} />);
      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: text } });
      expect(input).toHaveValue(text);
      fireEvent.blur(input);
      expect(onChange).toHaveBeenLastCalledWith("2026-09-28");
      expect(input).toHaveValue("28/09/2026");
    },
  );

  it.each(["31/02/2026", "2026-02-31", "28/09/202", "20/09/2026"])(
    "keeps the saved date for invalid or out-of-range input %s",
    (text) => {
      const onChange = vi.fn();
      render(<DateField value="2026-09-28" min="2026-09-25" onChange={onChange} />);
      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: text } });
      fireEvent.blur(input);
      expect(onChange).not.toHaveBeenCalled();
      expect(input).toHaveValue("28/09/2026");
    },
  );

  it("commits once on Enter without submitting the surrounding form", () => {
    const onChange = vi.fn();
    render(<DateField value="2026-09-28" onChange={onChange} />);
    const input = screen.getByRole("textbox");
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "29/09/2026" } });
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
    expect(onChange).toHaveBeenCalledExactlyOnceWith("2026-09-29");
    expect(input).not.toHaveFocus();
  });

  it("allows an optional date to be cleared", () => {
    const onChange = vi.fn();
    render(<DateField value="2026-09-28" onChange={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("edits the month with arrow keys, cancels with Escape and avoids saving unchanged dates", () => {
    const change = vi.fn();
    render(<DateField aria-label="Invoice date" value="2026-09-28" onChange={change} />);
    const input = screen.getByRole("textbox", { name: "Invoice date" }) as HTMLInputElement;
    fireEvent.blur(input);
    expect(change).not.toHaveBeenCalled();
    act(() => input.focus());
    input.setSelectionRange(3, 5);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveValue("28/10/2026");
    expect(change).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("28/09/2026");
    fireEvent.blur(input);
    expect(change).not.toHaveBeenCalled();
  });

  it("explains rejected dates and respects the upper bound and required date", () => {
    const change = vi.fn();
    render(<DateField value="2026-09-28" max="2026-09-30" required onChange={change} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "01/10/2026" } });
    fireEvent.blur(input);
    expect(screen.getByRole("alert")).toHaveTextContent("Choose 30/09/2026 or earlier. Kept 28/09/2026.");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(input).toHaveValue("28/09/2026");
    expect(change).not.toHaveBeenCalled();
  });

  it("opens from the keyboard, moves focus from the selected day, and returns a calendar selection", async () => {
    const change = vi.fn();
    render(<DateField value="2026-09-28" max="2026-09-29" onChange={change} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "ArrowDown", altKey: true });
    const selected = screen.getByRole("button", { name: /Monday, September 28th, 2026/ });
    await waitFor(() => expect(selected).toHaveFocus());
    fireEvent.keyDown(selected, { key: "ArrowRight" });
    const next = screen.getByRole("button", { name: /Tuesday, September 29th, 2026/ });
    await waitFor(() => expect(next).toHaveFocus());
    expect(screen.getByRole("button", { name: /Wednesday, September 30th, 2026/ })).toBeDisabled();
    fireEvent.click(next);
    expect(change).toHaveBeenCalledExactlyOnceWith("2026-09-29");
    expect(screen.queryByRole("dialog", { name: "Choose a date" })).not.toBeInTheDocument();
  });

  it("closes the calendar when its form becomes disabled", () => {
    const change = vi.fn();
    const { rerender } = render(<DateField value="2026-09-28" onChange={change} />);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    expect(screen.getByRole("dialog", { name: "Choose a date" })).toBeInTheDocument();
    rerender(<DateField disabled value="2026-09-28" onChange={change} />);
    expect(screen.queryByRole("dialog", { name: "Choose a date" })).not.toBeInTheDocument();
    expect(change).not.toHaveBeenCalled();
  });

  it("does not change a date through a portaled calendar after its fieldset becomes disabled", () => {
    const change = vi.fn();
    const view = render(<fieldset><DateField value="2026-09-28" onChange={change} /></fieldset>);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    const next = screen.getByRole("button", { name: /Tuesday, September 29th, 2026/ });
    view.rerender(<fieldset disabled><DateField value="2026-09-28" onChange={change} /></fieldset>);
    fireEvent.click(next);
    expect(change).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Choose a date" })).not.toBeInTheDocument();
  });
});
