import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
});
