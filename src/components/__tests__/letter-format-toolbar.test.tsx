import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { LetterTextStyle } from "../../lib/letters";
import LetterFormatToolbar from "../LetterFormatToolbar";

vi.mock("../ui-menu", () => ({
  SelectMenu: ({
    id,
    value,
    onChange,
    options,
    ariaLabel,
    disabled,
  }: {
    id: string;
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
    ariaLabel: string;
    disabled?: boolean;
  }) => (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
afterEach(() => {
  cleanup();
});
function Editor({
  initial,
  onChange,
}: {
  initial: LetterTextStyle;
  onChange: (value: LetterTextStyle) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <LetterFormatToolbar
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
      targetLabel="Selected paragraph"
    />
  );
}
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

it("applies presets and toggles emphasis without dropping unrelated formatting", () => {
  const initial: LetterTextStyle = {
    font: "mono",
    fontSize: 11,
    italic: true,
    underline: true,
    color: "#123456",
    lineSpacing: 2,
    paragraphSpacing: 24,
    align: "center",
  };
  const onChange = vi.fn();
  render(<Editor initial={initial} onChange={onChange} />);
  change("Text style", "heading");
  expect(onChange).toHaveBeenLastCalledWith({ ...initial, fontSize: 16, bold: true });
  expect(screen.getByRole("button", { name: "Bold" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  fireEvent.click(screen.getByRole("button", { name: "Italic" }));
  expect(onChange).toHaveBeenLastCalledWith({
    ...initial,
    fontSize: 16,
    bold: true,
    italic: false,
  });
  expect(screen.getByRole("button", { name: "Italic" })).toHaveAttribute(
    "aria-pressed",
    "false"
  );
  fireEvent.click(screen.getByRole("button", { name: "Underline" }));
  expect(screen.getByRole("button", { name: "Underline" })).toHaveAttribute(
    "aria-pressed",
    "false"
  );
  change("Font", "classic");
  change("Font size", "18");
  expect(onChange).toHaveBeenLastCalledWith({
    ...initial,
    font: "classic",
    fontSize: 18,
    bold: true,
    italic: false,
    underline: false,
  });
  fireEvent.click(screen.getByRole("button", { name: "Align right" }));
  expect(onChange).toHaveBeenLastCalledWith({
    ...initial,
    font: "classic",
    fontSize: 18,
    bold: true,
    italic: false,
    underline: false,
    align: "right",
  });
  expect(screen.getByRole("button", { name: "Align right" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  expect(screen.getByRole("button", { name: "Align center" })).toHaveAttribute(
    "aria-pressed",
    "false"
  );
  expect(screen.getByLabelText("Text style")).toHaveValue("custom");
  expect(initial).toEqual({
    font: "mono",
    fontSize: 11,
    italic: true,
    underline: true,
    color: "#123456",
    lineSpacing: 2,
    paragraphSpacing: 24,
    align: "center",
  });
});

it("changes color and spacing independently while retaining valid custom values", () => {
  const initial: LetterTextStyle = {
    fontSize: 13,
    bold: true,
    color: "#234567",
    lineSpacing: 1.2,
    paragraphSpacing: 10,
  };
  const onChange = vi.fn();
  render(<Editor initial={initial} onChange={onChange} />);
  expect(screen.getByLabelText("Font size")).toHaveValue("13");
  expect(screen.getByLabelText("Line spacing")).toHaveValue("1.2");
  expect(screen.getByLabelText("Paragraph spacing")).toHaveValue("10");
  expect(screen.getByRole("option", { name: "13 pt" })).toBeInTheDocument();
  change("Text color", "#aabbcc");
  change("Line spacing", "1.15");
  change("Paragraph spacing", "0");
  expect(onChange).toHaveBeenLastCalledWith({
    ...initial,
    color: "#aabbcc",
    lineSpacing: 1.15,
    paragraphSpacing: 0,
  });
  change("Text style", "small");
  expect(onChange).toHaveBeenLastCalledWith({
    ...initial,
    fontSize: 9,
    bold: false,
    color: "#aabbcc",
    lineSpacing: 1.15,
    paragraphSpacing: 0,
  });
});

it("disables all formatting controls and identifies separate formatting targets", () => {
  const onChange = vi.fn();
  const initial: LetterTextStyle = { fontSize: 24, bold: true };
  render(
    <>
      <LetterFormatToolbar
        value={initial}
        disabled
        onChange={onChange}
        targetLabel="Whole letter"
      />
      <LetterFormatToolbar value={{}} onChange={onChange} targetLabel="Signature label" />
    </>
  );
  const disabled = within(screen.getByRole("group", { name: "Whole letter formatting" }));
  for (const control of [
    ...disabled.getAllByRole("combobox"),
    ...disabled.getAllByRole("textbox"),
    ...disabled.getAllByRole("button"),
    disabled.getByLabelText("Text color"),
  ])
    expect(control).toBeDisabled();
  fireEvent.click(disabled.getByRole("button", { name: "Bold" }));
  fireEvent.change(disabled.getByLabelText("Font size"), { target: { value: "36" } });
  expect(onChange).not.toHaveBeenCalled();
  const enabled = within(
    screen.getByRole("group", { name: "Signature label formatting" })
  );
  expect(enabled.getByLabelText("Font")).toHaveValue("modern");
  expect(enabled.getByLabelText("Font size")).toHaveValue("11");
  expect(enabled.getByLabelText("Line spacing")).toHaveValue("1.5");
  expect(enabled.getByLabelText("Paragraph spacing")).toHaveValue("16");
  expect(enabled.getByRole("button", { name: "Align left" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  fireEvent.click(enabled.getByRole("button", { name: "Bold" }));
  expect(onChange).toHaveBeenCalledWith({ bold: true });
});

it("accepts exact custom decimals and retains quick presets", () => {
  const onChange = vi.fn();
  render(<Editor initial={{ italic: true }} onChange={onChange} />);
  change("Font size", "13.5");
  change("Line spacing", "1.35");
  change("Paragraph spacing", "7,5");
  fireEvent.blur(screen.getByLabelText("Paragraph spacing"));
  expect(onChange).toHaveBeenLastCalledWith({
    italic: true,
    fontSize: 13.5,
    lineSpacing: 1.35,
    paragraphSpacing: 7.5,
  });
  expect(screen.getByLabelText("Font size")).toHaveValue("13.5");
  expect(screen.getByLabelText("Line spacing")).toHaveValue("1.35");
  expect(screen.getByLabelText("Paragraph spacing")).toHaveValue("7.5");
  change("Font size presets", "14");
  change("Line spacing presets", "2");
  change("Paragraph spacing presets", "16");
  expect(screen.getByLabelText("Font size")).toHaveValue("14");
  expect(screen.getByLabelText("Line spacing")).toHaveValue("2");
  expect(screen.getByLabelText("Paragraph spacing")).toHaveValue("16");
  expect(onChange).toHaveBeenLastCalledWith({
    italic: true,
    fontSize: 14,
    lineSpacing: 2,
    paragraphSpacing: 16,
  });
});

it("preserves incomplete typing without saving blanks as zero or losing decimal separators", () => {
  const onChange = vi.fn();
  render(<Editor initial={{}} onChange={onChange} />);
  change("Font size", "");
  change("Font size", "1");
  expect(screen.getByLabelText("Font size")).toHaveValue("1");
  expect(onChange).not.toHaveBeenCalled();
  change("Font size", "13.");
  expect(screen.getByLabelText("Font size")).toHaveValue("13.");
  change("Font size", "13.5");
  expect(onChange).toHaveBeenLastCalledWith({ fontSize: 13.5 });
  onChange.mockClear();
  change("Paragraph spacing", "");
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.blur(screen.getByLabelText("Paragraph spacing"));
  expect(screen.getByLabelText("Paragraph spacing")).toHaveValue("16");
  expect(screen.getByRole("status")).toHaveTextContent("Use 0–32 px.");
  change("Paragraph spacing", "0");
  expect(onChange).toHaveBeenLastCalledWith({ fontSize: 13.5, paragraphSpacing: 0 });
});

it("restores the last valid value for invalid entries and Enter does not submit the letter", () => {
  const onChange = vi.fn(),
    submit = vi.fn();
  render(
    <form onSubmit={submit}>
      <Editor initial={{}} onChange={onChange} />
    </form>
  );
  for (const [label, invalid, previous] of [
    ["Font size", "7", "11"],
    ["Font size", "37", "11"],
    ["Line spacing", "0.9", "1.5"],
    ["Line spacing", "2.6", "1.5"],
    ["Paragraph spacing", "33", "16"],
    ["Paragraph spacing", "-1", "16"],
    ["Font size", "NaN", "11"],
    ["Font size", "1e309", "11"],
  ]) {
    change(label, invalid);
    fireEvent.blur(screen.getByLabelText(label));
    expect(screen.getByLabelText(label)).toHaveValue(previous);
  }
  expect(onChange).not.toHaveBeenCalled();
  screen.getByLabelText("Font size").focus();
  change("Font size", "12.5");
  fireEvent.keyDown(screen.getByLabelText("Font size"), { key: "Enter" });
  expect(onChange).toHaveBeenLastCalledWith({ fontSize: 12.5 });
  expect(screen.getByLabelText("Font size")).not.toHaveFocus();
  expect(submit).not.toHaveBeenCalled();
});

it("resets partial drafts when the selected formatting target or external preset changes", () => {
  const onChange = vi.fn();
  const view = render(
    <LetterFormatToolbar value={{}} onChange={onChange} targetLabel="Paragraph 1" />
  );
  change("Font size", "3");
  view.rerender(
    <LetterFormatToolbar value={{}} onChange={onChange} targetLabel="Paragraph 2" />
  );
  expect(screen.getByLabelText("Font size")).toHaveValue("11");
  change("Line spacing", "");
  view.rerender(
    <LetterFormatToolbar
      value={{ lineSpacing: 2 }}
      onChange={onChange}
      targetLabel="Paragraph 2"
    />
  );
  expect(screen.getByLabelText("Line spacing")).toHaveValue("2");
  change("Paragraph spacing", "99");
  fireEvent.keyDown(screen.getByLabelText("Paragraph spacing"), { key: "Escape" });
  expect(screen.getByLabelText("Paragraph spacing")).toHaveValue("16");
  expect(onChange).not.toHaveBeenCalled();
});
