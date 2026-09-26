import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import DocumentPreviewControls from "../DocumentPreviewControls";
import { ResizablePanels } from "../ResizablePanels";

afterEach(cleanup);
it("keeps preview sizes selectable and zoom within its limits", () => {
  function Preview() {
    const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
    const [zoom, setZoom] = useState(50);
    return <DocumentPreviewControls device={device} onDeviceChange={setDevice} zoom={zoom} onZoomChange={setZoom} maxZoom={60} />;
  }
  const page = render(<Preview />);
  expect(page.getByRole("button", { name: "Zoom out" })).toBeDisabled();
  fireEvent.click(page.getByRole("button", { name: "Zoom in" }));
  expect(page.getByLabelText("Preview zoom level")).toHaveTextContent("60%");
  expect(page.getByRole("button", { name: "Zoom in" })).toBeDisabled();
  fireEvent.click(page.getByRole("button", { name: "Mobile preview" }));
  expect(page.getByRole("button", { name: "Mobile preview" })).toHaveAttribute("aria-pressed", "true");
});
it("releases the drag cursor if the editor is closed while resizing", () => {
  const page = render(<ResizablePanels left={<input aria-label="Draft" />} right={<p>Preview</p>} />);
  fireEvent.mouseDown(page.getByRole("button", { name: "Drag to resize preview" }), { clientX: 500 });
  expect(document.body.style.cursor).toBe("col-resize");
  fireEvent.mouseMove(window, { clientX: 480 });
  expect(document.body.style.cursor).toBe("col-resize");
  expect(document.body.style.userSelect).toBe("none");
  page.unmount();
  expect(document.body.style.cursor).toBe("");
  expect(document.body.style.userSelect).toBe("");
});
it("keeps the document mounted for export when its preview is minimized", () => {
  const page = render(<ResizablePanels left={<p>Editor</p>} right={<p data-testid="sheet">Letter content</p>} />);
  const sheet = page.getByTestId("sheet");
  fireEvent.click(page.getByRole("button", { name: "Minimize preview" }));
  expect(page.getByTestId("sheet")).toBe(sheet);
  expect(sheet.parentElement).toHaveAttribute("inert");
  fireEvent.click(page.getByRole("button", { name: "Expand preview" }));
  expect(sheet.parentElement).not.toHaveAttribute("inert");
});
it("can start minimized and expand the same mounted document", () => {
  const page = render(<ResizablePanels defaultCollapsed left={<p>Editor</p>} right={<p data-testid="sheet">Invoice content</p>} />);
  const sheet = page.getByTestId("sheet");
  expect(sheet.parentElement).toHaveAttribute("inert");
  fireEvent.click(page.getByRole("button", { name: "Expand preview" }));
  expect(page.getByTestId("sheet")).toBe(sheet);
  expect(sheet.parentElement).not.toHaveAttribute("inert");
});
