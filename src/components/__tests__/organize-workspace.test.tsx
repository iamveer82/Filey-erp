import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import OrganizeStudio from "../OrganizeStudio";

const pdf = vi.hoisted(() => ({ render: vi.fn(), destroy: vi.fn(), organize: vi.fn() }));
vi.mock("../../lib/ui", () => ({ useUI: () => ({ toast: { error: vi.fn() } }) }));
vi.mock("../../lib/pdfTools", () => ({ organizePages: pdf.organize, splitAtPoints: vi.fn() }));
vi.mock("../../lib/pdfjsSafe", () => ({ getDocument: () => ({ destroy: pdf.destroy, promise: Promise.resolve({ numPages: 3, getPage: async () => ({
  getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }), render: pdf.render, cleanup: vi.fn(),
}) }) }) }));
beforeEach(() => {
  pdf.destroy.mockResolvedValue(undefined);
  pdf.render.mockReturnValue({ promise: Promise.resolve() });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,eA==");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });
const file = () => Object.assign(new File(["fixture"], "fixture.pdf", { type: "application/pdf" }), { arrayBuffer: async () => new ArrayBuffer(1) });
it("renders only thumbnails until a page is focused, then releases the full preview worker", async () => {
  const view = render(<OrganizeStudio file={file()} action="organize" onApply={vi.fn()} />);
  await view.findByAltText("page 3");
  expect(pdf.render).toHaveBeenCalledTimes(3);
  fireEvent.click(view.getByAltText("page 1"));
  await waitFor(() => expect(pdf.render).toHaveBeenCalledTimes(4));
  await waitFor(() => expect(pdf.destroy).toHaveBeenCalledTimes(2));
  expect(pdf.render.mock.calls[3][0].viewport.width).toBe(720);
});
it("blocks output and displays a durable error when page previews cannot render", async () => {
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
  const view = render(<OrganizeStudio file={file()} action="organize" onApply={vi.fn()} />);
  expect(await view.findByRole("alert")).toHaveTextContent("Page previews are unavailable");
  expect(view.getByRole("button", { name: "Create PDF" })).toBeDisabled();
  expect(pdf.organize).not.toHaveBeenCalled();
});
