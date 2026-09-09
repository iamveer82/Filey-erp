import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import DocTemplateGallery from "../DocTemplateGallery";
import TemplateDesigner from "../TemplateDesigner";
import * as storage from "../../lib/customTemplates";
import { UIProvider } from "../../lib/ui";
import { setCacheOrg } from "../../lib/api";
import { loadCustomTemplates, type CustomTemplate } from "../TemplateDesigner";

const custom: CustomTemplate = {
  id: "custom-sample", name: "Studio letterhead", type: "builder", accent: "#222222", font: "sans-serif", layout: "minimal",
  showLogo: true, showSeller: true, showCustomer: true, showNotes: true, showTerms: true, showTax: true, paperSize: "A4",
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
  setCacheOrg("template-test", crypto.randomUUID());
  vi.clearAllMocks();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function seedTemplate() {
  localStorage.setItem("localdb:app_settings", JSON.stringify([{ id: 1, key: "custom_templates", value: JSON.stringify([custom]) }]));
}

describe("document template browser", () => {
  it("keeps a selected layout outside the first four visible without writing templates on mount", async () => {
    seedTemplate();
    const original = localStorage.getItem("localdb:app_settings");
    const change = vi.fn();
    const view = render(<UIProvider><DocTemplateGallery value={custom.id} onChange={change} onDesign={() => {}} docType="invoice" /></UIProvider>);
    expect(await view.findByRole("button", { name: "Use Studio letterhead template" })).toHaveAttribute("aria-pressed", "true");
    expect(localStorage.getItem("localdb:app_settings")).toBe(original);
    expect(change).not.toHaveBeenCalled();
  });

  it("filters the receipt catalogue and includes custom templates in the full browser", async () => {
    seedTemplate();
    const change = vi.fn();
    const view = render(<UIProvider><DocTemplateGallery value="voucher" onChange={change} onDesign={() => {}} docType="receipt" /></UIProvider>);
    await waitFor(() => expect(loadCustomTemplates()).toHaveLength(1));
    fireEvent.click(view.getByRole("button", { name: "Browse templates" }));
    const dialog = within(await view.findByRole("dialog", { name: "Choose a template" }));
    expect(dialog.queryByRole("button", { name: "Use Minimal template" })).toBeNull();
    fireEvent.click(dialog.getByRole("button", { name: "My templates" }));
    expect(dialog.getByRole("button", { name: "Use Studio letterhead template" })).toBeTruthy();
    fireEvent.change(dialog.getByRole("textbox", { name: "Search templates…" }), { target: { value: "no match" } });
    expect(dialog.getByText("No matching templates")).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: "Clear filters" }));
    fireEvent.click(dialog.getByRole("button", { name: "Use Receipt Minimal template" }));
    expect(change).toHaveBeenCalledExactlyOnceWith("rec-minimal");
    expect(view.queryByRole("dialog", { name: "Choose a template" })).toBeNull();
    expect(JSON.parse(localStorage.getItem("localdb:app_settings")!)[0].value).toBe(JSON.stringify([custom]));
  });

  it("previews a design without selecting it until the explicit Use action", async () => {
    const change = vi.fn();
    const view = render(<UIProvider><DocTemplateGallery value="minimal" onChange={change} onDesign={() => {}} docType="invoice" /></UIProvider>);
    fireEvent.click(view.getByRole("button", { name: "Preview Classic template" }));
    const dialog = within(await view.findByRole("dialog", { name: "Classic" }));
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole("button", { name: "Use this template" }));
    expect(change).toHaveBeenCalledExactlyOnceWith("classic");
    expect(localStorage.getItem("localdb:app_settings")).toBeNull();
  });

  it("deletes a custom receipt layout only after confirmation and selects a receipt-compatible fallback", async () => {
    seedTemplate();
    const change = vi.fn();
    function Gallery() {
      const [value, setValue] = useState(custom.id);
      return <DocTemplateGallery value={value} onChange={(next) => { change(next); setValue(next); }} onDesign={() => {}} docType="receipt" />;
    }
    const view = render(<UIProvider><Gallery /></UIProvider>);
    fireEvent.click(await view.findByRole("button", { name: "Delete template Studio letterhead" }));
    expect(loadCustomTemplates()).toHaveLength(1);
    fireEvent.click(within(await view.findByRole("dialog", { name: "Delete template" })).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(change).toHaveBeenCalledExactlyOnceWith("voucher"));
    expect(loadCustomTemplates()).toEqual([]);
    expect(view.getByRole("button", { name: "Use Receipt Voucher template" })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the selected template when deleting it cannot persist", async () => {
    seedTemplate();
    const change = vi.fn();
    const view = render(<UIProvider><DocTemplateGallery value={custom.id} onChange={change} onDesign={() => {}} docType="invoice" /></UIProvider>);
    await view.findByRole("button", { name: "Delete template Studio letterhead" });
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === "localdb:app_settings") throw new Error("Device storage is full");
      return original.call(this, key, value);
    });
    fireEvent.click(view.getByRole("button", { name: "Delete template Studio letterhead" }));
    fireEvent.click(within(await view.findByRole("dialog", { name: "Delete template" })).getByRole("button", { name: "Delete" }));
    expect(await view.findByText("Could not delete template: Device storage is full")).toBeTruthy();
    expect(change).not.toHaveBeenCalled();
    expect(loadCustomTemplates()).toEqual([custom]);
  });

  it("keeps the designer open and shows an error when saving fails", async () => {
    vi.spyOn(storage, "saveCustomTemplate").mockRejectedValueOnce(new Error("Cloud refused the write"));
    const saved = vi.fn();
    const closed = vi.fn();
    const view = render(<TemplateDesigner onSave={saved} onClose={closed} />);
    fireEvent.change(view.getByPlaceholderText("My Custom Template"), { target: { value: "My layout" } });
    fireEvent.click(view.getByRole("button", { name: "Create template" }));
    expect(await view.findByRole("alert")).toHaveTextContent("Cloud refused the write");
    expect(saved).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
    expect(view.getByRole("button", { name: "Create template" })).toBeEnabled();
  });
});
