import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, useNavigate, type NavigateFunction } from "react-router-dom";
import type { ReactElement, ReactNode } from "react";
import { UIProvider } from "../../lib/ui";
import { billing } from "../../lib/api";
import { AGENT_STORAGE_EVENT } from "../../lib/agentStorage";
import { pickDocNumber } from "../../lib/numberFormat";
import { reactToPdfBytes } from "../../lib/reactPdf";
import { downloadFile, type OutFile } from "../../lib/pdfTools";
import {
  blankLetterForm,
  loadLetters,
  saveLetter,
  validateLetterForm,
  type LetterForm,
  type LetterRecord,
} from "../../lib/letters";
import Letter from "../Letter";

const workspace = vi.hoisted(() => ({
  scope: "local:org:user:owner",
  records: [] as LetterRecord[],
  previewPages: 1,
}));
vi.mock("../../lib/api", () => ({
  getCacheScope: () => "org:user:owner",
  billing: {
    getCompany: vi.fn(async () => ({ name: "Demo company" })),
    saveDoc: vi.fn(),
  },
}));
vi.mock("../../lib/agentStorage", () => ({
  AGENT_STORAGE_EVENT: "filey:agent-storage",
  agentStorageScope: () => workspace.scope,
  requireAgentStorageScope: (expected: string) => {
    if (expected !== workspace.scope) throw new Error("Your workspace changed.");
    return expected;
  },
}));
vi.mock("../../lib/numberFormat", () => ({
  loadDocFormats: vi.fn(async () => ({})),
  pickDocNumber: vi.fn(
    (_kind: string, existing: string[]) =>
      `LTR-${String(existing.length + 1).padStart(4, "0")}`
  ),
}));
vi.mock("../../lib/documentNumbers", () => ({ allocateDocumentNumber: async (...args: Parameters<typeof pickDocNumber>) => pickDocNumber(...args) }));
vi.mock("../../lib/realtime", () => ({
  useLiveSync: () => {},
  notifyDataChanged: () => {},
}));
vi.mock("../../lib/letters", async (original) => ({
  ...(await original<typeof import("../../lib/letters")>()),
  loadLetters: vi.fn(async () => structuredClone(workspace.records)),
  saveLetter: vi.fn(),
  deleteLetter: vi.fn(),
}));
vi.mock("../../lib/files", () => ({ safeName: (name: string) => name }));
vi.mock("../../lib/reactPdf", () => ({ reactToPdfBytes: vi.fn() }));
vi.mock("../../lib/pdfTools", () => ({ downloadFile: vi.fn() }));
vi.mock("../../components/StampSignatureSettings", () => ({
  EMPTY_STAMP_SIG: {},
  loadCompanyStampSig: async () => ({}),
}));
vi.mock("../../components/Letterhead", () => ({
  EMPTY_LETTERHEAD: { background: "" },
  hasLetterhead: () => false,
  loadLetterhead: async () => ({ background: "" }),
}));
vi.mock("../../components/LetterDocument", () => ({
  default: ({ form, pageIndex = 0 }: { form: LetterForm; pageIndex?: number }) => (
    <div data-testid="letter-document">{form.title} · Page {pageIndex + 1}</div>
  ),
  LETTER_TEMPLATES: [{ id: "letter-standard", label: "Standard" }],
  useLetterPages: () => Array.from({ length: workspace.previewPages }, () => ({})),
}));
vi.mock("../../components/FitPreview", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/DatePicker", () => ({
  DateField: ({
    value,
    onChange,
    ...props
  }: {
    value: string;
    onChange: (value: string) => void;
    id?: string;
    disabled?: boolean;
  }) => (
    <input
      type="date"
      value={value}
      {...props}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
vi.mock("../../components/ui-menu", async (original) => ({
  ...(await original<typeof import("../../components/ui-menu")>()),
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
      value={value}
      aria-label={ariaLabel}
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

const pdf: OutFile = { name: "letter.pdf", bytes: new Uint8Array([37, 80, 68, 70]) };
function makeRecord(form: LetterForm, id = "letter-1", revision = 1): LetterRecord {
  validateLetterForm(form);
  return {
    id,
    revision,
    created_at: "2026-10-03T10:00:00Z",
    updated_at: `2026-10-03T10:00:0${revision}Z`,
    form: structuredClone(form),
    issued_at: form.status === "issued" ? "2026-10-03T10:00:00Z" : null,
    issued_snapshot: form.status === "issued" ? structuredClone(form) : null,
  };
}
function mount(initialEntry = "/letters") {
  let navigate!: NavigateFunction;
  function Navigation() {
    navigate = useNavigate();
    return null;
  }
  const rendered = render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Navigation />
      <UIProvider>
        <Letter />
      </UIProvider>
    </MemoryRouter>
  );
  return {
    ...rendered,
    navigate: (to: string) => act(() => { void navigate(to); }),
  };
}
async function newLetter() {
  mount();
  const create = await screen.findByRole("button", { name: "New letter" });
  await waitFor(() => expect(create).toBeEnabled());
  await act(async () => { fireEvent.click(create); });
}
const change = (label: string, value: string) =>
  fireEvent.change(
    screen.getByLabelText(label === "Letter title" ? /^Letter title/ : label),
    { target: { value } }
  );
const add = (value: string) => change("Add letter block", value);
function content() {
  change("Letter title", "Authorization letter");
  change("Text 1", "The company authorizes Mary to receive these documents.");
}
function switchWorkspace(records: LetterRecord[] = []) {
  workspace.scope = "cloud:another-org:user:teammate";
  workspace.records = records;
  act(() => {
    window.dispatchEvent(new Event(AGENT_STORAGE_EVENT));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  workspace.scope = "local:org:user:owner";
  workspace.records = [];
  workspace.previewPages = 1;
  vi.mocked(loadLetters).mockImplementation(async () =>
    structuredClone(workspace.records)
  );
  vi.mocked(saveLetter).mockImplementation(async (form, id, revision) => {
    const saved = makeRecord(
      form,
      id || `letter-${workspace.records.length + 1}`,
      (revision || 0) + 1
    );
    workspace.records = [
      saved,
      ...workspace.records.filter((record) => record.id !== saved.id),
    ];
    return saved;
  });
  vi.mocked(reactToPdfBytes).mockResolvedValue(pdf);
  vi.mocked(downloadFile).mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
});

it("waits for loaded records before opening the exact saved letter from an AI link", async () => {
  const other = makeRecord({ ...blankLetterForm("LTR-0001"), title: "Similar letter" }, "letter-10");
  const requested = makeRecord({ ...blankLetterForm("LTR-0002"), title: "Requested AI draft" }, "letter-1");
  let resolveLetters!: (records: LetterRecord[]) => void;
  vi.mocked(loadLetters).mockReturnValueOnce(new Promise((resolve) => { resolveLetters = resolve; }));
  mount("/letters?letter=letter-1");
  expect(screen.queryByLabelText(/^Letter title/)).not.toBeInTheDocument();
  await act(async () => { resolveLetters([other, requested]); });
  expect(await screen.findByLabelText(/^Letter title/)).toHaveValue("Requested AI draft");
  expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
  expect(saveLetter).not.toHaveBeenCalled();
  expect(pickDocNumber).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await screen.findByRole("button", { name: "New letter" });
  expect(screen.queryByLabelText(/^Letter title/)).not.toBeInTheDocument();
});

it("opens an issued AI link using its immutable snapshot without creating or issuing a letter", async () => {
  const snapshot = { ...blankLetterForm("LTR-0003"), title: "Issued snapshot", status: "issued" as const, body: "Original issued wording" };
  const record = makeRecord(snapshot);
  record.form = { ...snapshot, title: "Changed live title", body: "Changed live wording" };
  workspace.records = [record];
  mount("/letters?letter=letter-1");
  expect(await screen.findByLabelText(/^Letter title/)).toHaveValue("Issued snapshot");
  expect(screen.getByLabelText("Introduction")).toHaveValue("Original issued wording");
  expect(screen.getByLabelText(/^Letter title/)).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Save draft" })).not.toBeInTheDocument();
  expect(saveLetter).not.toHaveBeenCalled();
  expect(pickDocNumber).not.toHaveBeenCalled();
});

it("shows a useful missing-letter message without matching a number or another letter ID", async () => {
  workspace.records = [makeRecord({ ...blankLetterForm("letter-1"), title: "Not the requested ID" }, "letter-10")];
  mount("/letters?letter=letter-1");
  await screen.findByText(/This letter was not found in this workspace/);
  expect(screen.queryByLabelText(/^Letter title/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "New letter" })).toBeEnabled();
  expect(saveLetter).not.toHaveBeenCalled();
});

it("keeps unsaved edits when a second AI link arrives and opens it only after the current draft is saved", async () => {
  workspace.records = [
    makeRecord({ ...blankLetterForm("LTR-0001"), title: "First draft" }, "letter-1"),
    makeRecord({ ...blankLetterForm("LTR-0002"), title: "Second draft" }, "letter-2"),
  ];
  const view = mount("/letters?letter=letter-1");
  await screen.findByLabelText(/^Letter title/);
  change("Letter title", "Unsaved first draft");
  view.navigate("/letters?letter=letter-2");
  await screen.findByText(/This letter has unsaved changes/);
  expect(screen.getByLabelText(/^Letter title/)).toHaveValue("Unsaved first draft");
  expect(saveLetter).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() => expect(saveLetter).toHaveBeenCalledTimes(1));
  expect(vi.mocked(saveLetter).mock.calls[0].slice(1)).toEqual(["letter-1", 1, "2026-10-03T10:00:01Z"]);
  await waitFor(() => expect(screen.getByLabelText(/^Letter title/)).toHaveValue("Second draft"));
  expect(workspace.records.find((record) => record.id === "letter-1")?.form.title).toBe("Unsaved first draft");
});

it("does not auto-open the same linked ID from a different workspace or use a delayed old response", async () => {
  let resolveLetters!: (records: LetterRecord[]) => void;
  vi.mocked(loadLetters).mockReturnValueOnce(new Promise((resolve) => { resolveLetters = resolve; }));
  mount("/letters?letter=letter-1");
  const current = makeRecord({ ...blankLetterForm("LTR-9001"), title: "Another workspace letter" });
  switchWorkspace([current]);
  await screen.findByText("Another workspace letter");
  await act(async () => {
    resolveLetters([makeRecord({ ...blankLetterForm("LTR-0001"), title: "Private previous workspace letter" })]);
  });
  expect(screen.queryByLabelText(/^Letter title/)).not.toBeInTheDocument();
  expect(screen.queryByText("Private previous workspace letter")).not.toBeInTheDocument();
  expect(screen.getByText("Another workspace letter")).toBeInTheDocument();
  expect(screen.getByText(/Your workspace changed. Open this letter from Filey AI again/)).toBeInTheDocument();
  expect(saveLetter).not.toHaveBeenCalled();
});

it("keeps page navigation and PDF export inside the keyboard-accessible modal scrolling region", async () => {
  workspace.previewPages = 3;
  workspace.records = [makeRecord({ ...blankLetterForm("LTR-0001"), title: "Long letter" })];
  mount();
  fireEvent.click(await screen.findByText("LTR-0001"));
  const dialog = within(await screen.findByRole("dialog"));
  const scrolling = dialog.getByRole("region", { name: "Letter preview" });
  scrolling.focus();
  expect(scrolling).toHaveFocus();
  const reader = within(scrolling);
  expect(reader.getByTestId("letter-document")).toHaveTextContent("Page 1");
  fireEvent.click(reader.getByRole("button", { name: "Next preview page" }));
  fireEvent.click(reader.getByRole("button", { name: "Next preview page" }));
  expect(reader.getByTestId("letter-document")).toHaveTextContent("Page 3");
  expect(reader.getByRole("button", { name: "Next preview page" })).toBeDisabled();
  fireEvent.click(reader.getByRole("button", { name: "Download PDF" }));
  await waitFor(() => expect(downloadFile).toHaveBeenCalledWith(pdf));
  expect((vi.mocked(reactToPdfBytes).mock.calls[0][0] as ReactElement<{ form: LetterForm }>).props.form.number).toBe("LTR-0001");
  expect(saveLetter).not.toHaveBeenCalled();
});

it("saves edited text, custom fields and dates in the chosen order without writing invoices", async () => {
  await newLetter();
  content();
  add("field");
  change("Label 2", "Employee name");
  change("Value 2", "Mark");
  change("Value 2", "Mary");
  change("Block 2 alignment", "right");
  add("date");
  change("Label 3", "Effective from");
  change("Date 3", "2026-10-12");
  add("text");
  change("Text 4", "Remove this temporary paragraph.");
  fireEvent.click(screen.getByRole("button", { name: "Remove block 4" }));
  expect(screen.queryByLabelText("Text 4")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Move block 3 up" }));
  fireEvent.click(screen.getByRole("button", { name: "Move block 2 up" }));
  expect(screen.getByRole("region", { name: "Date block 1" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() => expect(saveLetter).toHaveBeenCalledTimes(1));
  const saved = vi.mocked(saveLetter).mock.calls[0][0];
  expect(saved.blocks).toEqual([
    expect.objectContaining({
      type: "date",
      label: "Effective from",
      value: "2026-10-12",
      align: "left",
    }),
    expect.objectContaining({
      type: "text",
      text: "The company authorizes Mary to receive these documents.",
      align: "left",
    }),
    expect.objectContaining({
      type: "field",
      label: "Employee name",
      value: "Mary",
      align: "right",
    }),
  ]);
  expect(new Set(saved.blocks.map((block) => block.id)).size).toBe(3);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled()
  );
  change("Value 3", "Mary Smith");
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() => expect(saveLetter).toHaveBeenCalledTimes(2));
  expect(vi.mocked(saveLetter).mock.calls[1]).toEqual([
    expect.objectContaining({
      blocks: [
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ value: "Mary Smith" }),
      ],
    }),
    "letter-1",
    1,
    "2026-10-03T10:00:01Z",
  ]);
  expect(billing.saveDoc).not.toHaveBeenCalled();
});

it("keeps formatting and optional reference switches with the saved letter", async () => {
  await newLetter();
  content();
  change("Formatting target", "body");
  change("Font", "classic");
  change("Font size", "14");
  fireEvent.click(screen.getByRole("button", { name: "Align right" }));
  fireEvent.focus(screen.getByLabelText("Text 1"));
  expect(screen.getByRole("button", { name: "Align right" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  fireEvent.click(screen.getByRole("button", { name: "Bold" }));
  fireEvent.click(screen.getByRole("button", { name: "Italic" }));
  change("Line spacing", "2");
  change("Formatting target", "title");
  change("Text style", "title");
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Appearance" }), {
    button: 0,
    ctrlKey: false,
  });
  expect(
    await screen.findByRole("switch", { name: "Show letter reference" })
  ).toHaveAttribute("aria-checked", "false");
  fireEvent.click(screen.getByRole("switch", { name: "Show letter reference" }));
  fireEvent.click(screen.getByRole("switch", { name: "Show company details" }));
  expect(screen.getByRole("switch", { name: "Use company letterhead" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() => expect(saveLetter).toHaveBeenCalledTimes(1));
  const form = vi.mocked(saveLetter).mock.calls[0][0];
  expect(form.text_style).toEqual(
    expect.objectContaining({ font: "classic", fontSize: 14, align: "right" })
  );
  expect(form.blocks[0].style).toEqual({ bold: true, italic: true, lineSpacing: 2 });
  expect(form.title_style).toEqual(expect.objectContaining({ fontSize: 24, bold: true }));
  expect(form.show_reference).toBe(true);
  expect(form.show_company_header).toBe(false);
});

it("keeps body defaults live while individual block formatting and alignment stay independent", async () => {
  await newLetter();
  content();
  change("Formatting target", "body");
  fireEvent.click(screen.getByRole("button", { name: "Align center" }));
  expect(screen.getByLabelText("Block 1 alignment")).toHaveValue("center");
  fireEvent.focus(screen.getByLabelText("Text 1"));
  fireEvent.click(screen.getByRole("button", { name: "Bold" }));
  change("Block 1 alignment", "right");
  change("Formatting target", "body");
  change("Font size", "20");
  fireEvent.focus(screen.getByLabelText("Text 1"));
  expect(screen.getByLabelText("Font size")).toHaveValue("20");
  expect(screen.getByRole("button", { name: "Align right" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() => expect(saveLetter).toHaveBeenCalledTimes(1));
  const saved = vi.mocked(saveLetter).mock.calls[0][0];
  expect(saved.text_style).toEqual(
    expect.objectContaining({ fontSize: 20, align: "center" })
  );
  expect(saved.blocks[0].style).toEqual({ bold: true, align: "right" });
});

it("keeps manually typed decimal formatting through save, reload, issue and PDF export", async () => {
  await newLetter();
  content();
  change("Formatting target", "body");
  for (const [label, value] of [
    ["Font size", "13.5"], ["Line spacing", "1.35"], ["Paragraph spacing", "7.5"],
  ]) {
    const input = screen.getByRole("textbox", { name: label });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);
    expect(input).toHaveValue(value);
  }
  const custom = { fontSize: 13.5, lineSpacing: 1.35, paragraphSpacing: 7.5 };
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() => expect(saveLetter).toHaveBeenCalledTimes(1));
  expect(vi.mocked(saveLetter).mock.calls[0][0].text_style).toEqual(expect.objectContaining(custom));
  await waitFor(() => expect(screen.getByRole("button", { name: "Back" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await screen.findByRole("button", { name: "New letter" });
  fireEvent.click(await screen.findByRole("button", { name: "Quick view" }));
  await screen.findByRole("textbox", { name: "Font size" });
  expect(screen.getByRole("textbox", { name: "Font size" })).toHaveValue("13.5");
  expect(screen.getByRole("textbox", { name: "Line spacing" })).toHaveValue("1.35");
  expect(screen.getByRole("textbox", { name: "Paragraph spacing" })).toHaveValue("7.5");
  fireEvent.click(screen.getByRole("button", { name: "Issue letter" }));
  fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Issue letter" }));
  await waitFor(() => expect(saveLetter).toHaveBeenCalledTimes(2));
  const snapshot = workspace.records[0].issued_snapshot;
  expect(snapshot?.status).toBe("issued");
  expect(snapshot?.text_style).toEqual(expect.objectContaining(custom));
  await waitFor(() => expect(screen.getByRole("button", { name: "PDF" })).toBeEnabled());
  for (const label of ["Font size", "Line spacing", "Paragraph spacing"])
    expect(screen.getByRole("textbox", { name: label })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "PDF" }));
  await waitFor(() => expect(reactToPdfBytes).toHaveBeenCalledTimes(1));
  const exported = (vi.mocked(reactToPdfBytes).mock.calls[0][0] as ReactElement<{ form: LetterForm }>).props.form;
  expect(exported).toEqual(snapshot);
  expect(exported.text_style).toEqual(expect.objectContaining(custom));
});

it("preserves every draft field after a failed save so the same draft can be retried", async () => {
  vi.mocked(saveLetter).mockRejectedValueOnce(new Error("Storage unavailable"));
  await newLetter();
  content();
  add("field");
  change("Label 2", "Reference");
  change("Value 2", "JOB-42");
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await screen.findByText("Storage unavailable");
  expect(screen.getByLabelText(/^Letter title/)).toHaveValue("Authorization letter");
  expect(screen.getByLabelText("Text 1")).toHaveValue(
    "The company authorizes Mary to receive these documents."
  );
  expect(screen.getByLabelText("Value 2")).toHaveValue("JOB-42");
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() => expect(saveLetter).toHaveBeenCalledTimes(2));
  expect(vi.mocked(saveLetter).mock.calls[1][0]).toEqual(
    vi.mocked(saveLetter).mock.calls[0][0]
  );
  expect(vi.mocked(saveLetter).mock.calls[1].slice(1)).toEqual([
    undefined,
    undefined,
    undefined,
  ]);
});

it("adds starter wording without removing an existing introduction or custom content", async () => {
  const form = {
    ...blankLetterForm("LTR-0042"),
    title: "Existing draft",
    body: "Keep this saved introduction.\nIt contains agreed terms.",
    blocks: [
      {
        id: "saved-text",
        type: "text" as const,
        text: "Keep this custom paragraph.",
        align: "left" as const,
      },
      {
        id: "saved-field",
        type: "field" as const,
        label: "Existing reference",
        value: "JOB-42",
        align: "right" as const,
      },
    ],
  };
  workspace.records = [makeRecord(form)];
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Quick view" }));
  await screen.findByLabelText("Introduction");
  change("Add starter wording", "authorization");
  expect(screen.getByLabelText("Introduction")).toHaveValue(form.body);
  expect(screen.getByLabelText("Text 1")).toHaveValue("Keep this custom paragraph.");
  expect(screen.getByLabelText("Value 2")).toHaveValue("JOB-42");
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() => expect(saveLetter).toHaveBeenCalledTimes(1));
  const saved = vi.mocked(saveLetter).mock.calls[0][0];
  expect(saved.body).toBe(form.body);
  expect(saved.blocks.slice(0, 2)).toEqual(form.blocks);
  expect(saved.blocks).toHaveLength(6);
  expect(saved.blocks[5]).toEqual(
    expect.objectContaining({
      type: "text",
      text: expect.stringContaining("authorize the person named above"),
    })
  );
});

it("confirms issue, locks the issued snapshot and duplicates it into a fresh editable draft", async () => {
  await newLetter();
  content();
  fireEvent.click(screen.getByRole("button", { name: "Issue letter" }));
  const cancelled = within(await screen.findByRole("alertdialog"));
  expect(cancelled.getByText("Issue this letter?")).toBeInTheDocument();
  expect(saveLetter).not.toHaveBeenCalled();
  fireEvent.click(cancelled.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.getByLabelText("Text 1")).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Issue letter" }));
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "Issue letter",
    })
  );
  await waitFor(() => expect(saveLetter).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Duplicate draft" })).toBeEnabled()
  );
  expect(screen.getByLabelText("Text 1")).toBeDisabled();
  expect(screen.getByLabelText("Add letter block")).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Save draft" })).not.toBeInTheDocument();
  const issued = workspace.records[0];
  expect(issued.issued_snapshot).toEqual(issued.form);
  expect(issued.form.status).toBe("issued");
  const issuedBlockIds = issued.form.blocks.map((block) => block.id);
  fireEvent.click(screen.getByRole("button", { name: "Duplicate draft" }));
  await waitFor(() => expect(screen.getByLabelText("Text 1")).toBeEnabled());
  change("Text 1", "Editable duplicate wording.");
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() => expect(saveLetter).toHaveBeenCalledTimes(2));
  const copy = vi.mocked(saveLetter).mock.calls[1];
  expect(copy[0]).toEqual(
    expect.objectContaining({
      number: "LTR-0002",
      status: "draft",
      blocks: [expect.objectContaining({ text: "Editable duplicate wording." })],
    })
  );
  expect(copy.slice(1)).toEqual([undefined, undefined, undefined]);
  expect(copy[0].blocks.every((block) => !issuedBlockIds.includes(block.id))).toBe(true);
  expect(workspace.records).toHaveLength(2);
  expect(
    workspace.records.find((record) => record.id === issued.id)?.issued_snapshot
  ).toEqual(issued.issued_snapshot);
  expect(pickDocNumber).toHaveBeenLastCalledWith("letter", ["LTR-0001"], {});
});

it("exports and previews the saved issued snapshot rather than changed live form data", async () => {
  const snapshot = {
    ...blankLetterForm("LTR-0042"),
    title: "Original issued letter",
    status: "issued" as const,
    blocks: [
      {
        id: "original",
        type: "text" as const,
        text: "Frozen original wording.",
        align: "left" as const,
      },
    ],
  };
  const record = makeRecord(snapshot);
  record.form = {
    ...snapshot,
    title: "Changed live title",
    blocks: [
      { id: "changed", type: "text", text: "Changed live wording.", align: "left" },
    ],
  };
  workspace.records = [record];
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Download LTR-0042 PDF" }));
  await waitFor(() => expect(reactToPdfBytes).toHaveBeenCalledTimes(1));
  expect(
    (vi.mocked(reactToPdfBytes).mock.calls[0][0] as ReactElement<{ form: LetterForm }>)
      .props.form
  ).toEqual(snapshot);
  await waitFor(() => expect(downloadFile).toHaveBeenCalledWith(pdf));
  fireEvent.click(screen.getByRole("button", { name: "Quick view" }));
  await waitFor(() =>
    expect(screen.getByLabelText(/^Letter title/)).toHaveValue("Original issued letter")
  );
  expect(screen.getByLabelText("Text 1")).toHaveValue("Frozen original wording.");
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  const preview = within(await screen.findByRole("dialog"));
  expect(preview.getByTestId("letter-document")).toHaveTextContent(
    "Original issued letter"
  );
  expect(preview.queryByText("Changed live title")).not.toBeInTheDocument();
});

it("blocks save, export and preview from an editor whose workspace has changed", async () => {
  await newLetter();
  content();
  // Exercise stale callbacks before the storage notification closes the editor.
  workspace.scope = "cloud:another-org:user:teammate";
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "PDF" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "PDF" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Preview" })).toBeEnabled()
  );
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  expect(saveLetter).not.toHaveBeenCalled();
  expect(reactToPdfBytes).not.toHaveBeenCalled();
  expect(downloadFile).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  switchWorkspace();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "New letter" })).toBeEnabled()
  );
});

it("does not download an export that completes after switching workspaces", async () => {
  let resolvePdf!: (file: OutFile) => void;
  vi.mocked(reactToPdfBytes).mockReturnValueOnce(
    new Promise((resolve) => {
      resolvePdf = resolve;
    })
  );
  await newLetter();
  content();
  fireEvent.click(screen.getByRole("button", { name: "PDF" }));
  await waitFor(() => expect(reactToPdfBytes).toHaveBeenCalledTimes(1));
  switchWorkspace();
  await act(async () => {
    resolvePdf(pdf);
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "New letter" })).toBeEnabled()
  );
  expect(downloadFile).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("Text 1")).not.toBeInTheDocument();
});

it("blocks a stale table-row preview before the workspace notification arrives", async () => {
  workspace.records = [
    makeRecord({ ...blankLetterForm("LTR-0001"), title: "Private original draft" }),
  ];
  mount();
  const number = await screen.findByText("LTR-0001");
  workspace.scope = "cloud:another-org:user:teammate";
  fireEvent.click(number);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("does not reopen a saved draft when its response arrives after a workspace switch", async () => {
  let resolveSave!: (record: LetterRecord) => void;
  vi.mocked(saveLetter).mockReturnValueOnce(
    new Promise((resolve) => {
      resolveSave = resolve;
    })
  );
  await newLetter();
  content();
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() => expect(saveLetter).toHaveBeenCalledTimes(1));
  const saved = makeRecord(vi.mocked(saveLetter).mock.calls[0][0]);
  switchWorkspace();
  await act(async () => {
    resolveSave(saved);
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "New letter" })).toBeEnabled()
  );
  expect(screen.queryByLabelText("Text 1")).not.toBeInTheDocument();
  expect(screen.queryByText("Draft saved.")).not.toBeInTheDocument();
});

it("does not issue in a new workspace when the original confirmation is still open", async () => {
  await newLetter();
  content();
  fireEvent.click(screen.getByRole("button", { name: "Issue letter" }));
  const confirmation = within(await screen.findByRole("alertdialog"));
  switchWorkspace();
  fireEvent.click(confirmation.getByRole("button", { name: "Issue letter" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "New letter" })).toBeEnabled()
  );
  expect(saveLetter).not.toHaveBeenCalled();
  expect(screen.queryByText("Letter issued.")).not.toBeInTheDocument();
});
