import { afterEach, expect, it, vi } from "vitest";
import { fileToImages } from "../docScan";
import { getDocument } from "../pdfjsSafe";

vi.mock("../pdfjsSafe", () => ({ getDocument: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

function fixture(pages = 2, width = 1200, height = 1600) {
  const page = { getViewport: () => ({ width, height }), render: vi.fn(() => ({ promise: Promise.resolve() })), cleanup: vi.fn() };
  const pdf = { numPages: pages, getPage: vi.fn(async (_pageNumber: number) => page), destroy: vi.fn(async () => {}) };
  vi.mocked(getDocument).mockReturnValue({ promise: Promise.resolve(pdf), destroy: pdf.destroy } as never);
  const canvas = { width: 0, height: 0, getContext: () => ({}), toDataURL: () => "data:image/png;base64,fixture" };
  vi.spyOn(document, "createElement").mockReturnValue(canvas as unknown as HTMLCanvasElement);
  const file = { type: "application/pdf", name: "invoice.pdf", arrayBuffer: async () => new ArrayBuffer(0) } as File;
  return { file, pdf, page, canvas };
}

it("renders every permitted page in order and releases PDF/canvas memory", async () => {
  const { file, pdf, page, canvas } = fixture();
  expect(await fileToImages(file)).toHaveLength(2);
  expect(pdf.getPage.mock.calls.map(call => call[0])).toEqual([1, 2]);
  expect(page.cleanup).toHaveBeenCalledTimes(2);
  expect(pdf.destroy).toHaveBeenCalledOnce();
  expect(canvas.width * canvas.height).toBe(0);
});

it("rejects a document over the page limit instead of silently dropping items", async () => {
  const { file, pdf } = fixture(9);
  await expect(fileToImages(file)).rejects.toThrow("so no pages are missed");
  expect(pdf.getPage).not.toHaveBeenCalled();
  expect(pdf.destroy).toHaveBeenCalledOnce();
});

it("destroys the loading task when a PDF cannot be opened", async () => {
  const { file } = fixture();
  const destroy = vi.fn(async () => {});
  vi.mocked(getDocument).mockReturnValue({ promise: Promise.reject(new Error("Password required")), destroy } as never);
  await expect(fileToImages(file)).rejects.toThrow("Password required");
  expect(destroy).toHaveBeenCalledOnce();
  expect(document.createElement).not.toHaveBeenCalled();
});

it("releases PDF/canvas resources when rendering fails", async () => {
  const { file, pdf, page, canvas } = fixture();
  page.render.mockImplementation(() => ({ promise: Promise.reject(new Error("Render failed")) }));
  await expect(fileToImages(file)).rejects.toThrow("Render failed");
  expect(pdf.destroy).toHaveBeenCalledOnce();
  expect(page.cleanup).toHaveBeenCalledOnce();
  expect(canvas.width * canvas.height).toBe(0);
});

it("rejects oversized pages before allocating a canvas", async () => {
  const { file, pdf, page } = fixture(1, 100000, 100000);
  await expect(fileToImages(file)).rejects.toThrow("too large");
  expect(page.render).not.toHaveBeenCalled();
  expect(document.createElement).not.toHaveBeenCalled();
  expect(pdf.destroy).toHaveBeenCalledOnce();
});
