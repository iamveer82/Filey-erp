import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import ESignStudio from "../ESignStudio";
import { UIProvider } from "../../lib/ui";

const engine = vi.hoisted(() => ({ stamp: vi.fn(), normalize: vi.fn() }));
vi.mock("../../lib/pdfTools", () => ({ placeStamp: engine.stamp, ensurePdf: engine.normalize, downloadFile: vi.fn() }));
vi.mock("../../lib/pdfjsSafe", () => ({ getDocument: () => ({ promise: Promise.resolve({ numPages: 3, getPage: async () => ({ getViewport: () => ({ width: 600, height: 800 }), render: () => ({ promise: Promise.resolve() }) }) }) }) }));

beforeEach(() => {
  engine.normalize.mockImplementation(async (file: File) => file);
  engine.stamp.mockReset().mockResolvedValue({ name: "source-stamped.pdf", bytes: new Uint8Array([1, 2, 3]) });
  const context = { beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, drawImage() {}, strokeRect() {}, setLineDash() {}, clearRect() {} };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,AQID");
  vi.stubGlobal("Image", class {
    naturalWidth = 600;
    naturalHeight = 200;
    onload?: () => void;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function draw(container: HTMLElement) {
  const canvas = container.querySelector('canvas[style*="max-width: 600px"]')!;
  fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 });
  fireEvent.mouseMove(canvas, { clientX: 100, clientY: 40 });
  fireEvent.mouseUp(canvas);
}

it("downloads a drawn signature without requiring an uploaded document", async () => {
  const done = vi.fn();
  const view = render(<UIProvider><ESignStudio onApply={done} /></UIProvider>);
  draw(view.container);
  fireEvent.click(view.getByRole("button", { name: "Download Signature" }));
  await waitFor(() => expect(done).toHaveBeenCalledWith({ name: "signature.png", bytes: new Uint8Array([1, 2, 3]) }));
  expect(engine.stamp).not.toHaveBeenCalled();
});

it("signs the original multi-page PDF and returns a PDF instead of exporting one page as PNG", async () => {
  const done = vi.fn();
  const file = new File(["three-page fixture"], "source.pdf", { type: "application/pdf" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(1) });
  const view = render(<UIProvider><ESignStudio file={file} onApply={done} /></UIProvider>);
  await view.findByRole("button", { name: "Sign & Download" });
  draw(view.container);
  fireEvent.click(view.getByRole("button", { name: "Sign & Download" }));
  await waitFor(() => expect(engine.stamp).toHaveBeenCalledWith(file, "data:image/png;base64,AQID", expect.objectContaining({ pageIndex: 0 })));
  expect(done).toHaveBeenCalledWith({ name: "source-signed.pdf", bytes: new Uint8Array([1, 2, 3]) });
});
