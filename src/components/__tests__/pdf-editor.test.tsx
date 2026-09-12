import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import InlinePdfEditor, { type PdfEditorHandle } from "../InlinePdfEditor";

const boundary = vi.hoisted(() => ({
  save: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("../../lib/ui", () => ({ useUI: () => ({ toast: boundary.toast }) }));
vi.mock("../../lib/pdfAnnotations", () => ({ savePdfAnnotations: boundary.save }));
vi.mock("../../lib/pdfjsSafe", () => ({
  getDocument: () => ({
    destroy: () => Promise.resolve(),
    promise: Promise.resolve({
      numPages: 2,
      getPage: async () => ({
        getViewport: ({ scale }: { scale: number }) => ({
          width: 600 * scale,
          height: 800 * scale,
        }),
        render: () => ({ promise: Promise.resolve() }),
      }),
    }),
  }),
}));
beforeEach(() => {
  boundary.save.mockReset().mockResolvedValue(new File(["edited"], "edited.pdf"));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    {} as CanvasRenderingContext2D
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/png;base64,eA=="
  );
  vi.stubGlobal("PointerEvent", MouseEvent);
  Element.prototype.setPointerCapture = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("draws, undoes, redoes and erases marks; prepares edits using page coordinates after resizing", async () => {
  const file = new File(["source"], "source.pdf");
  Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(1) });
  const ref = createRef<PdfEditorHandle>();
  const view = render(<InlinePdfEditor file={file} editorRef={ref} onApply={vi.fn()} />);
  const page = await view.findByRole("group", { name: "Editable PDF page 1" });
  let screenWidth = 300;
  vi.spyOn(page, "getBoundingClientRect").mockImplementation(() => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: screenWidth,
    bottom: (screenWidth * 4) / 3,
    width: screenWidth,
    height: (screenWidth * 4) / 3,
    toJSON() {},
  }));
  fireEvent.click(view.getByRole("button", { name: "Brush" }));
  fireEvent.pointerDown(page, { clientX: 30, clientY: 40, button: 0, pointerId: 1 });
  fireEvent.pointerMove(page, { clientX: 60, clientY: 60, pointerId: 1 });
  fireEvent.pointerUp(page, { pointerId: 1 });
  expect(view.getByRole("button", { name: "Brush stroke" })).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Undo" }));
  expect(view.queryByRole("button", { name: "Brush stroke" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Redo" }));
  screenWidth = 600;
  await ref.current!.prepare();
  expect(boundary.save).toHaveBeenCalledWith(
    file,
    [
      expect.objectContaining({
        kind: "ink",
        points: [
          { x: 60, y: 80 },
          { x: 120, y: 120 },
        ],
      }),
    ],
    {}
  );
  fireEvent.click(view.getByRole("button", { name: "Eraser" }));
  fireEvent.pointerDown(
    view.getByRole("button", { name: "Brush stroke" }).querySelector("polyline")!,
    { button: 0 }
  );
  expect(view.queryByRole("button", { name: "Brush stroke" })).toBeNull();
  expect(await ref.current!.prepare()).toBe(file);
  await waitFor(() =>
    expect(view.getByRole("button", { name: "Save edits" })).toBeDisabled()
  );
});
