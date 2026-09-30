import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { PDFDocument } from "pdf-lib";
import { FileText } from "lucide-react";
import LivePreview from "../LivePreview";
import type { Tool } from "../PdfToolbox";

if (!Blob.prototype.arrayBuffer) Blob.prototype.arrayBuffer = function () {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(this);
  });
};

const boundary = vi.hoisted(() => ({ destroy: vi.fn() }));
vi.mock("../../lib/pdfjsSafe", () => ({ getDocument: () => ({
  destroy: boundary.destroy,
  promise: Promise.resolve({ getPage: async () => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 300 * scale, height: 200 * scale }),
    render: () => ({ promise: Promise.resolve() }),
  }) }),
}) }));

beforeEach(() => {
  boundary.destroy.mockReset().mockResolvedValue(undefined);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,eA==");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const inputFile = (bytes: Uint8Array) => {
  const file = new File([bytes.slice()], "preview.pdf", { type: "application/pdf" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.slice().buffer });
  return file;
};

it("previews complete N-up sheets and retains the document count for page numbering", async () => {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 5; i++) pdf.addPage([300, 200]);
  const file = inputFile(await pdf.save());
  const counts: number[] = [];
  const tool: Tool = { id: "nup", name: "Booklet", cat: "Organize", accept: "application/pdf", desc: "", fields: [], icon: FileText,
    run: async files => {
      const bytes = new Uint8Array(await files[0].arrayBuffer());
      counts.push((await PDFDocument.load(bytes)).getPageCount());
      return [{ name: "preview.pdf", bytes }];
    },
  };
  const view = render(<LivePreview tool={tool} file={file} params={{ n: "2" }} />);
  await waitFor(() => expect(boundary.destroy).toHaveBeenCalledTimes(1));
  view.rerender(<LivePreview tool={tool} file={file} params={{ n: "4" }} />);
  await waitFor(() => expect(boundary.destroy).toHaveBeenCalledTimes(2));
  view.rerender(<LivePreview tool={{ ...tool, id: "numbers", name: "Page Numbers" }} file={file} params={{}} />);
  await waitFor(() => expect(boundary.destroy).toHaveBeenCalledTimes(3));
  expect(counts).toEqual([2, 4, 5]);
});

it("stops the loader after an invalid PDF instead of displaying a perpetual preview spinner", async () => {
  const tool: Tool = { id: "watermark", name: "Watermark", cat: "Edit", accept: "application/pdf", desc: "", fields: [], icon: FileText, run: vi.fn() };
  const view = render(<LivePreview tool={tool} file={inputFile(new TextEncoder().encode("not a PDF"))} params={{}} />);
  await waitFor(() => expect(view.container).toHaveTextContent("This file could not be previewed"));
  expect(view.container.querySelector(".animate-spin")).toBeNull();
  expect(tool.run).not.toHaveBeenCalled();
  expect(view.queryByRole("img")).toBeNull();
});
