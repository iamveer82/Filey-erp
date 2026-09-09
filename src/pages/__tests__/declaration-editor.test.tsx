import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UIProvider } from "../../lib/ui";
import DeclarationLetter from "../DeclarationLetter";
import { tools } from "../../lib/api";
import { downloadElementAsPdf } from "../../lib/pdfTools";

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
  fireEvent.click(page.getByRole("button", { name: "PDF" }));
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
