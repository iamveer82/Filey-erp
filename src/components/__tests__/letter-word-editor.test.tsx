import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { blankLetterForm } from "../../lib/letters";
import {
  letterRichText,
  validateLetterRichDocument,
  type LetterRichDocument,
} from "../../lib/letterRichText";
import { LetterWordEditor } from "../LetterWordEditor";

vi.mock("../CompanyAssetImage", () => ({
  CompanyAssetImage: ({ src, alt }: { src: string; alt: string }) => (
    <img src={src} alt={alt} />
  ),
}));
vi.mock("../ui-menu", () => ({
  SelectMenu: ({
    value,
    onChange,
    options,
    ariaLabel,
    disabled,
  }: {
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
    ariaLabel: string;
    disabled?: boolean;
  }) => (
    <select
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
beforeEach(() => {
  // Browser selection geometry is tested separately; jsdom has no layout.
  Range.prototype.getBoundingClientRect = () => ({
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
});
afterEach(cleanup);
const doc = (text: string): LetterRichDocument => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
async function mount(
  form = {
    ...blankLetterForm("LTR-1"),
    closing: "",
    blocks: [],
    rich_document: doc("Hello Mary"),
  },
  disabled = false
) {
  const changed = vi.fn();
  const view = render(
    <LetterWordEditor form={form} disabled={disabled} onChange={changed} />
  );
  const canvas = await screen.findByRole("textbox", { name: "Letter canvas" });
  await waitFor(() =>
    expect((canvas as HTMLElement & { editor: Editor }).editor).toBeDefined()
  );
  const editor = (canvas as HTMLElement & { editor: Editor }).editor;
  return { ...view, changed, editor, canvas, form };
}

it("opens a legacy letter as continuous prose without dirtying it on mount or readonly changes", async () => {
  const legacy = {
    ...blankLetterForm("LTR-1"),
    title: "Authorization",
    recipient_name: "Mary",
    salutation: "Dear Mary,",
    body: "Approved wording",
    blocks: [],
    closing: "Yours sincerely,",
  };
  const changed = vi.fn();
  const view = render(<LetterWordEditor form={legacy} onChange={changed} />);
  const canvas = await screen.findByRole("textbox", { name: "Letter canvas" });
  expect(canvas.textContent).toContain(
    "MaryAuthorizationDear Mary,Approved wordingYours sincerely,"
  );
  expect(changed).not.toHaveBeenCalled();
  view.rerender(<LetterWordEditor form={legacy} disabled onChange={changed} />);
  expect(changed).not.toHaveBeenCalled();
  expect(canvas).toHaveAttribute("contenteditable", "false");
});

it("formats selected words with manual decimal size and spacing without changing adjacent text", async () => {
  const { editor, changed } = await mount();
  act(() => {
    editor.commands.setTextSelection({ from: 7, to: 11 });
  });
  fireEvent.click(screen.getByRole("button", { name: "Bold" }));
  const size = screen.getByRole("spinbutton", { name: "Font size" });
  fireEvent.change(size, { target: { value: "13.5" } });
  fireEvent.blur(size);
  for (const [label, value] of [
    ["Line spacing", "1.35"],
    ["Paragraph spacing", "7.5"],
  ]) {
    const input = screen.getByRole("spinbutton", { name: label });
    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);
  }
  const saved = changed.mock.calls[
    changed.mock.calls.length - 1
  ][0] as LetterRichDocument;
  expect(saved.content[0].attrs).toEqual(
    expect.objectContaining({ lineSpacing: 1.35, paragraphSpacing: 7.5 })
  );
  expect(saved.content[0].content).toEqual([
    expect.objectContaining({ text: "Hello " }),
    expect.objectContaining({
      text: "Mary",
      marks: expect.arrayContaining([
        { type: "bold" },
        expect.objectContaining({
          type: "textStyle",
          attrs: expect.objectContaining({ fontSize: "13.5pt" }),
        }),
      ]),
    }),
  ]);
  expect(() => validateLetterRichDocument(saved)).not.toThrow();
});

it("syncs a renamed legacy title but preserves a rich canvas heading when its document name changes", async () => {
  const legacy = {
    ...blankLetterForm("LTR-1"),
    title: "Old subject",
    body: "Approved wording",
    blocks: [],
  };
  const changed = vi.fn();
  const view = render(<LetterWordEditor form={legacy} onChange={changed} />);
  const canvas = await screen.findByRole("textbox", { name: "Letter canvas" });
  view.rerender(
    <LetterWordEditor form={{ ...legacy, title: "New subject" }} onChange={changed} />
  );
  await waitFor(() => expect(canvas).toHaveTextContent("New subject"));
  expect(canvas).not.toHaveTextContent("Old subject");
  expect(canvas).toHaveTextContent("Approved wording");
  expect(changed).not.toHaveBeenCalled();
  view.rerender(
    <LetterWordEditor
      form={{ ...legacy, title: "Document name", rich_document: doc("Canvas subject") }}
      onChange={changed}
    />
  );
  await waitFor(() => expect(canvas).toHaveTextContent("Canvas subject"));
  view.rerender(
    <LetterWordEditor
      form={{
        ...legacy,
        title: "Renamed document",
        rich_document: doc("Canvas subject"),
      }}
      onChange={changed}
    />
  );
  expect(canvas).toHaveTextContent("Canvas subject");
  expect(canvas).not.toHaveTextContent("Renamed document");
  expect(changed).not.toHaveBeenCalled();
});

it("rejects invalid custom sizes without mutating the document", async () => {
  const { changed } = await mount();
  const input = screen.getByRole("spinbutton", { name: "Font size" });
  fireEvent.change(input, { target: { value: "900" } });
  fireEvent.blur(input);
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(changed).not.toHaveBeenCalled();
});

it("persists numbered lists and supports undo and redo", async () => {
  const { editor, changed } = await mount();
  act(() => {
    editor.commands.setTextSelection({ from: 1, to: 11 });
  });
  fireEvent.click(screen.getByRole("button", { name: "Numbered list" }));
  const saved = changed.mock.calls[
    changed.mock.calls.length - 1
  ][0] as LetterRichDocument;
  expect(saved.content[0].type).toBe("orderedList");
  expect(saved.content[0].attrs).toEqual({ start: 1 });
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(editor.getJSON().content![0].type).toBe("paragraph");
  fireEvent.click(screen.getByRole("button", { name: "Redo" }));
  expect(editor.getJSON().content![0].type).toBe("orderedList");
});

it("strips external images, links and unsupported styles from pasted HTML", async () => {
  const { editor, changed } = await mount();
  act(() => {
    editor.commands.setContent(
      '<p><a href="https://example.invalid">Safe words</a><img src="https://example.invalid/tracker.png"><script>alert(1)</script><span style="font-family:evil;font-size:900px;color:red"> continued</span></p>'
    );
  });
  const saved = changed.mock.calls[
    changed.mock.calls.length - 1
  ][0] as LetterRichDocument;
  expect(letterRichText(saved)).toContain("Safe words continued");
  expect(JSON.stringify(saved)).not.toMatch(/href|tracker|script|900|evil/);
  expect(() => validateLetterRichDocument(saved)).not.toThrow();
});

it("shows the actual heading size and applies 11pt explicitly", async () => {
  const form = {
    ...blankLetterForm("LTR-1"),
    closing: "",
    blocks: [],
    rich_document: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Title" }],
        },
      ],
    } as LetterRichDocument,
  };
  const { editor, changed } = await mount(form);
  act(() => {
    editor.commands.setTextSelection({ from: 1, to: 6 });
  });
  const input = screen.getByRole("spinbutton", { name: "Font size" });
  expect(input).toHaveValue(24);
  fireEvent.change(input, { target: { value: "11" } });
  fireEvent.blur(input);
  expect(JSON.stringify(changed.mock.calls[changed.mock.calls.length - 1][0])).toContain(
    '"fontSize":"11pt"'
  );
});

it("keeps issued canvas and all formatting controls read only", async () => {
  const { canvas, changed } = await mount(undefined, true);
  expect(canvas).toHaveAttribute("contenteditable", "false");
  expect(canvas).toHaveAttribute("aria-readonly", "true");
  expect(screen.getByRole("button", { name: "Bold" })).toBeDisabled();
  expect(screen.getByRole("spinbutton", { name: "Font size" })).toBeDisabled();
  expect(changed).not.toHaveBeenCalled();
});

it("updates external saved content without emitting edits or resetting on company metadata", async () => {
  const { rerender, changed, form, canvas } = await mount();
  rerender(
    <LetterWordEditor
      form={{ ...form, company_name: "Updated company" }}
      onChange={changed}
    />
  );
  expect(canvas).toHaveTextContent("Hello Mary");
  expect(changed).not.toHaveBeenCalled();
  rerender(
    <LetterWordEditor
      form={{ ...form, rich_document: doc("Replacement wording") }}
      onChange={changed}
    />
  );
  expect(canvas).toHaveTextContent("Replacement wording");
  expect(changed).not.toHaveBeenCalled();
});
