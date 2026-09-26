import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UIProvider } from "../../lib/ui";
import DeclarationLetter from "../DeclarationLetter";
import { tools } from "../../lib/api";
import { downloadElementAsPdf } from "../../lib/pdfTools";
import { autoSaveDocument } from "../../lib/files";

vi.mock("../../lib/api", () => ({
  tools: { settings: vi.fn(), setSetting: vi.fn() },
  billing: { getCompany: vi.fn(async () => ({ name: "Test company", currency: "AED" })) },
  suppliers: { list: vi.fn(async () => []) },
  crm: { customers: vi.fn(async () => []) },
}));
vi.mock("../../lib/files", () => ({ autoSaveDocument: vi.fn(async () => false) }));
vi.mock("../../lib/pdfTools", () => ({ downloadElementAsPdf: vi.fn(), elementToPdfBytes: vi.fn() }));

beforeEach(() => {
  vi.mocked(tools.settings).mockResolvedValue([]);
  vi.mocked(tools.setSetting).mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const open = () => render(<MemoryRouter><UIProvider><DeclarationLetter /></UIProvider></MemoryRouter>);

it("keeps creation blocked after a failed read until retry succeeds", async () => {
  vi.mocked(tools.settings).mockRejectedValueOnce(new Error("Device storage is unavailable"));
  const page = open();
  expect(await page.findByRole("alert")).toHaveTextContent("Device storage is unavailable");
  expect(page.getByRole("button", { name: "New letter" })).toBeDisabled();
  fireEvent.click(page.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(page.getByRole("button", { name: "New letter" })).toBeEnabled());
  expect(tools.setSetting).not.toHaveBeenCalled();
});

it.each(["not-json", "{}", "[null]"])("refuses to replace unreadable existing letters (%s)", async (value) => {
  const page = open();
  await waitFor(() => expect(page.getByRole("button", { name: "New letter" })).toBeEnabled());
  fireEvent.click(page.getByRole("button", { name: "New letter" }));
  await page.findByDisplayValue("Test company");
  vi.mocked(tools.settings).mockResolvedValue([{ key: "declaration_letters", value }] as Awaited<ReturnType<typeof tools.settings>>);
  fireEvent.click(page.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(page.getByRole("button", { name: "Save" })).toBeEnabled());
  expect(tools.setSetting).not.toHaveBeenCalled();
});

it("preserves existing letters and reports a failed PDF export without saving", async () => {
  const page = open();
  await waitFor(() => expect(page.getByRole("button", { name: "New letter" })).toBeEnabled());
  fireEvent.click(page.getByRole("button", { name: "New letter" }));
  await page.findByDisplayValue("Test company");
  vi.mocked(downloadElementAsPdf).mockRejectedValueOnce(new Error("Folder is read-only"));
  fireEvent.click(page.getByRole("button", { name: "Download PDF" }));
  expect(await page.findByText("Folder is read-only")).toBeTruthy();
  expect(tools.setSetting).not.toHaveBeenCalled();
  const existing = { id: "retained", body: "Existing letter", ref: "DL-0001" };
  vi.mocked(tools.settings).mockResolvedValue([{ key: "declaration_letters", value: JSON.stringify([existing]) }] as Awaited<ReturnType<typeof tools.settings>>);
  fireEvent.click(page.getByRole("button", { name: "Minimize preview" }));
  fireEvent.click(page.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(tools.setSetting).toHaveBeenCalledOnce());
  const saved = JSON.parse(vi.mocked(tools.setSetting).mock.calls[0][1]);
  expect(saved).toHaveLength(2);
  expect(saved[1]).toEqual(existing);
});

it("keeps edits across tabs, exports A4 at any zoom, and restores saved appearance", async () => {
  let letters = "[]";
  vi.mocked(tools.settings).mockImplementation(async () => [
    { key: "declaration_letters", value: letters },
    { key: "company_letterhead", value: JSON.stringify({ background: "data:image/png;base64,dGVzdA==" }) },
  ] as Awaited<ReturnType<typeof tools.settings>>);
  vi.mocked(tools.setSetting).mockImplementation(async (_key, value) => { letters = value; });
  const page = open();
  await waitFor(() => expect(page.getByRole("button", { name: "New letter" })).toBeEnabled());
  fireEvent.click(page.getByRole("button", { name: "New letter" }));
  await page.findByDisplayValue("Test company");
  fireEvent.change(page.getByLabelText("Recipient name"), { target: { value: "Test recipient" } });
  fireEvent.change(page.getByLabelText("LPO number"), { target: { value: "PO-42" } });
  fireEvent.keyDown(page.getByRole("tab", { name: "Letter text" }), { key: "Enter" });
  fireEvent.change(page.getByRole("textbox", { name: "Letter text" }), { target: { value: "For {recipient}, {company} confirms order {lpo}." } });
  expect(page.getByText("For Test recipient, Test company confirms order PO-42.")).toBeVisible();
  fireEvent.keyDown(page.getByRole("tab", { name: "Appearance" }), { key: "Enter" });
  await waitFor(() => expect(page.getByRole("switch", { name: "Use letterhead" })).toBeChecked());
  fireEvent.change(page.getByLabelText("Header space (px)"), { target: { value: "210" } });
  fireEvent.click(page.getByRole("switch", { name: "Use letterhead" }));
  expect(page.getByRole("switch", { name: "Show stamp" })).toBeDisabled();
  fireEvent.keyDown(page.getByRole("tab", { name: "Details" }), { key: "Enter" });
  expect(page.getByLabelText("Recipient name")).toHaveValue("Test recipient");
  fireEvent.click(page.getByRole("button", { name: "Zoom in" }));
  fireEvent.click(page.getByRole("button", { name: "Download PDF" }));
  await waitFor(() => expect(downloadElementAsPdf).toHaveBeenCalledOnce());
  const exported = vi.mocked(downloadElementAsPdf).mock.calls[0][0];
  expect(exported.style.width).toBe("794px");
  expect(exported.style.minHeight).toBe("1123px");
  expect(tools.setSetting).not.toHaveBeenCalled();
  await waitFor(() => expect(page.getByRole("button", { name: "Save" })).toBeEnabled());
  fireEvent.click(page.getByRole("button", { name: "Save" }));
  await page.findByText("Letter saved.");
  expect(JSON.parse(letters)[0]).toMatchObject({ use_letterhead: false, header_space: 210, recipient_name: "Test recipient", lpo_ref: "PO-42" });
  expect(page.getByRole("heading", { name: "Declaration letter" })).toBeVisible();
  fireEvent.click(page.getByRole("button", { name: "Back" }));
  fireEvent.click(await page.findByText("Test recipient"));
  fireEvent.keyDown(page.getByRole("tab", { name: "Appearance" }), { key: "Enter" });
  await waitFor(() => expect(page.getByRole("switch", { name: "Use letterhead" })).toBeEnabled());
  expect(page.getByRole("switch", { name: "Use letterhead" })).not.toBeChecked();
  fireEvent.click(page.getByRole("switch", { name: "Use letterhead" }));
  expect(page.getByLabelText("Header space (px)")).toHaveValue(210);
});

it("reports an archive failure separately after successfully saving the letter", async () => {
  vi.mocked(autoSaveDocument).mockRejectedValueOnce(new Error("Archive unavailable"));
  const page = open();
  await waitFor(() => expect(page.getByRole("button", { name: "New letter" })).toBeEnabled());
  fireEvent.click(page.getByRole("button", { name: "New letter" }));
  await page.findByDisplayValue("Test company");
  fireEvent.click(page.getByRole("button", { name: "Save" }));
  expect(await page.findByText(/Letter saved, but the PDF copy/)).toBeVisible();
  expect(tools.setSetting).toHaveBeenCalledOnce();
  expect(page.getByRole("heading", { name: "Declaration letter" })).toBeVisible();
});

it.each([
  ["Authorization letter", "Authorization_letter"],
  ["خطاب / 客户", "خطاب_客户"],
])("uses a custom name throughout the letter, saved list and PDF (%s)", async (name, filename) => {
  let letters = "[]";
  vi.mocked(tools.settings).mockImplementation(async () => [
    { key: "declaration_letters", value: letters },
  ] as Awaited<ReturnType<typeof tools.settings>>);
  vi.mocked(tools.setSetting).mockImplementation(async (_key, value) => { letters = value; });
  const page = open();
  await waitFor(() => expect(page.getByRole("button", { name: "New letter" })).toBeEnabled());
  fireEvent.click(page.getByRole("button", { name: "New letter" }));
  await page.findByDisplayValue("Test company");
  fireEvent.change(page.getByLabelText("Letter name"), { target: { value: name } });
  fireEvent.change(page.getByLabelText("Reference"), { target: { value: "DL-0042" } });
  expect(page.getAllByRole("heading", { name })).toHaveLength(2);
  fireEvent.click(page.getByRole("button", { name: "Download PDF" }));
  await waitFor(() => expect(downloadElementAsPdf).toHaveBeenCalledOnce());
  const [paper, outputName] = vi.mocked(downloadElementAsPdf).mock.calls[0];
  expect(paper.querySelector("h1")).toHaveTextContent(name);
  expect(outputName).toBe(filename + "-DL-0042");
  expect(tools.setSetting).not.toHaveBeenCalled();
  await waitFor(() => expect(page.getByRole("button", { name: "Save" })).toBeEnabled());
  fireEvent.click(page.getByRole("button", { name: "Save" }));
  await page.findByText("Letter saved.");
  expect(JSON.parse(letters)[0].title).toBe(name);
  expect(autoSaveDocument).toHaveBeenCalledWith(filename + "-DL-0042.pdf", "declaration", expect.any(Function));
  fireEvent.click(page.getByRole("button", { name: "Back" }));
  fireEvent.change(page.getByPlaceholderText("Search by name, recipient or reference…"), { target: { value: name } });
  fireEvent.click(await page.findByText(name));
  expect(page.getByLabelText("Letter name")).toHaveValue(name);
  expect(page.getAllByRole("heading", { name })).toHaveLength(2);
});
