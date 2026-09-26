import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import TemplateDesigner, { type CustomTemplate } from "../TemplateDesigner";
import * as templates from "../../lib/customTemplates";
import * as letterhead from "../Letterhead";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("keeps a saving template dialog open and preserves its draft when saving fails", async () => {
  vi.spyOn(templates, "customTemplateScope").mockReturnValue("local:template-dialog-test");
  vi.spyOn(letterhead, "loadLetterhead").mockResolvedValue(letterhead.EMPTY_LETTERHEAD);
  let rejectSave!: (reason: Error) => void;
  const pendingSave = new Promise<CustomTemplate[]>((_resolve, reject) => { rejectSave = reject; });
  const save = vi.spyOn(templates, "saveCustomTemplate").mockReturnValue(pendingSave);
  const saved = vi.fn();
  const closed = vi.fn();
  const view = render(<TemplateDesigner inDialog onSave={saved} onClose={closed} />);
  fireEvent.change(view.getByPlaceholderText("My Custom Template"), { target: { value: "Retain this layout" } });
  fireEvent.click(view.getByRole("button", { name: "Create template" }));
  expect(save).toHaveBeenCalledOnce();
  fireEvent.click(view.getByRole("button", { name: "Close dialog" }));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(closed).not.toHaveBeenCalled();
  expect(view.getByRole("dialog", { name: "Create template" })).toBeVisible();

  await act(async () => { rejectSave(new Error("Cloud refused the write")); });
  expect(await view.findByRole("alert")).toHaveTextContent("Cloud refused the write");
  expect(view.getByPlaceholderText("My Custom Template")).toHaveValue("Retain this layout");
  expect(view.getByRole("button", { name: "Create template" })).toBeEnabled();
  expect(saved).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: "Close dialog" }));
  expect(closed).toHaveBeenCalledOnce();
});
