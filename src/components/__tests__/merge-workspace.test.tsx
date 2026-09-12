import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import MergeStudio from "../MergeStudio";
const merge = vi.hoisted(() => vi.fn());
vi.mock("../../lib/pdfTools", () => ({ mergePdfs: merge }));
vi.mock("../../lib/ui", () => ({ useUI: () => ({ toast: { error: vi.fn() } }) }));
vi.mock("../../lib/pdfjsSafe", () => ({
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({
        getViewport: () => ({ width: 60, height: 80 }),
        render: () => ({ promise: Promise.resolve() }),
      }),
    }),
  }),
}));
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    {} as CanvasRenderingContext2D
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/png;base64,eA=="
  );
  merge.mockResolvedValue({ name: "merged.pdf", bytes: new Uint8Array([1]) });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const file = (name: string) => {
  const f = new File(["sample"], name, { type: "application/pdf" });
  Object.defineProperty(f, "arrayBuffer", { value: async () => new ArrayBuffer(1) });
  return f;
};
it("keeps the chosen merge order when adding and removing files", async () => {
  const first = file("first.pdf"),
    second = file("second.pdf"),
    third = file("third.pdf");
  function Workspace() {
    const [files, setFiles] = useState([first, second]);
    return <MergeStudio files={files} onFilesChange={setFiles} onApply={vi.fn()} />;
  }
  const view = render(<Workspace />);
  await waitFor(() =>
    expect(view.getByRole("button", { name: "Move second.pdf earlier" })).toBeEnabled()
  );
  fireEvent.click(view.getByRole("button", { name: "Move second.pdf earlier" }));
  await waitFor(() =>
    expect(view.getByRole("button", { name: "Move second.pdf earlier" })).toBeDisabled()
  );
  fireEvent.change(view.container.querySelector('input[type="file"]')!, {
    target: { files: [third] },
  });
  await waitFor(() =>
    expect(view.getByRole("button", { name: "Move third.pdf earlier" })).toBeEnabled()
  );
  fireEvent.click(view.getByRole("button", { name: "Remove first.pdf" }));
  await waitFor(() =>
    expect(view.queryByRole("button", { name: "Remove first.pdf" })).toBeNull()
  );
  fireEvent.click(view.getByRole("button", { name: "Merge and download PDF" }));
  await waitFor(() => expect(merge).toHaveBeenCalledWith([second, third]));
});
