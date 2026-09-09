import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import FormFillPanel from "../FormFillPanel";

const engine = vi.hoisted(() => ({ read: vi.fn(), fill: vi.fn() }));
vi.mock("../../lib/pdfTools", () => ({ readFormFields: engine.read, fillForm: engine.fill }));
afterEach(cleanup);

it("sends empty text when clearing a saved field and discards old values when the file changes", async () => {
  engine.read.mockResolvedValue([{ name: "Customer", kind: "Text", value: "Previous customer" }]);
  engine.fill.mockResolvedValue({ name: "filled.pdf", bytes: new Uint8Array([1]) });
  const onDone = vi.fn();
  const first = new File(["first"], "first.pdf");
  const view = render(<FormFillPanel file={first} onDone={onDone} />);
  const input = await view.findByRole("textbox", { name: "Customer" });
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.click(view.getByRole("button", { name: "Fill and download" }));
  await waitFor(() => expect(engine.fill).toHaveBeenCalledWith(first, '{"Customer":""}'));
  expect(onDone).toHaveBeenCalledOnce();

  engine.read.mockResolvedValue([{ name: "Reference", kind: "Text", value: "New file" }]);
  view.rerender(<FormFillPanel file={new File(["second"], "second.pdf")} onDone={onDone} />);
  expect(view.queryByRole("textbox", { name: "Customer" })).toBeNull();
  expect(await view.findByRole("textbox", { name: "Reference" })).toHaveValue("New file");
});
